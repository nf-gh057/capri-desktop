# Chatterbox T3 (text -> speech tokens) with each decode step replayed from a CUDA graph.
# The stock loop spends ~40 ms a token in Python and kernel launches on a model the GPU runs in a few: one graph
# replay per token instead (about 5x faster on an RTX 3060 laptop, with the transformer in bfloat16). Same
# sampling, CFG and hallucination guard (AlignmentStreamAnalyzer) as the original, fed from the attention of the
# 3 layers it watches. Two fixes to the stock loop on the way:
# - the guard switched all 30 layers to the slow eager attention for those 3: only they are eager here;
# - it added 3 forward hooks for every line and never removed them (a server got slower line after line).
import copy, types, torch
from transformers import StaticCache, AttentionInterface
from transformers.models.llama.modeling_llama import eager_attention_forward
from transformers.generation.logits_process import MinPLogitsWarper, TopPLogitsWarper, RepetitionPenaltyLogitsProcessor
from chatterbox.models.t3.inference import alignment_stream_analyzer as asa

# conditioning + text + speech tokens: her text comes in sentences (src/main/tts.js), and attention over a
# shorter cache is faster; anything longer goes through the stock loop
MAX_LEN = 768
ATTN = {}  # layer -> attention weights of its last forward (the graph's own memory while replaying)


class TooLong(Exception):
    """The text leaves too little of the cache for its speech: say it in two halves."""


def _eager_bool(module, query, key, value, attention_mask, **kwargs):
    # the 3 watched layers need attention weights (eager), but share the mask built for SDPA: a boolean
    # "may attend" mask, which eager would add as 0/1 instead of masking
    if attention_mask is not None and attention_mask.dtype == torch.bool:
        attention_mask = torch.zeros_like(attention_mask, dtype=query.dtype).masked_fill(
            ~attention_mask, torch.finfo(query.dtype).min)
    return eager_attention_forward(module, query, key, value, attention_mask, **kwargs)


AttentionInterface.register('eager_bool', _eager_bool)


def _no_spy(self, tfmr, buffer_idx, layer_idx, head_idx):
    pass  # the hooks below fill ATTN once; inference() hands the maps to the guard


class Runner:
    def __init__(self, t3, dtype=None):
        self.t3 = t3
        tf = t3.tfmr
        if dtype is not None:
            tf.to(dtype)
        tf.config._attn_implementation = 'sdpa'
        for layer, _ in asa.LLAMA_ALIGNED_HEADS:
            attn = tf.layers[layer].self_attn
            cfg = copy.copy(attn.config)
            cfg._attn_implementation = 'eager_bool'
            attn.config = cfg
            attn.register_forward_hook(self._hook(layer))
        asa.AlignmentStreamAnalyzer._add_attention_spy = _no_spy
        dev, dt = t3.device, next(tf.parameters()).dtype
        self.cache = StaticCache(config=tf.config, max_cache_len=MAX_LEN)
        self.emb = torch.zeros(2, 1, tf.config.hidden_size, device=dev, dtype=dt)
        self.pos = torch.zeros(1, dtype=torch.long, device=dev)
        self.graph = None

    def _hook(self, layer):
        def hook(module, inputs, output):
            if isinstance(output, tuple) and len(output) > 1 and output[1] is not None:
                ATTN[layer] = output[1]
        return hook

    def _step(self):
        out = self.t3.tfmr(inputs_embeds=self.emb, past_key_values=self.cache, cache_position=self.pos, use_cache=True)
        return self.t3.speech_head(out.last_hidden_state.float())

    def prefill(self, embeds):
        self.cache.reset()
        pos = torch.arange(embeds.size(1), device=embeds.device)
        out = self.t3.tfmr(inputs_embeds=embeds.to(self.emb.dtype), past_key_values=self.cache, cache_position=pos,
                           use_cache=True)
        return self.t3.speech_head(out.last_hidden_state.float())

    def capture(self):
        # warm up on a side stream, then record one decode step at a scratch position (the next prefill
        # clears the cache)
        self.pos.fill_(MAX_LEN - 2)
        s = torch.cuda.Stream()
        s.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(s):
            for _ in range(3):
                self._step()
        torch.cuda.current_stream().wait_stream(s)
        self.graph = torch.cuda.CUDAGraph()
        with torch.cuda.graph(self.graph):
            self.logits = self._step()
        self.attn = dict(ATTN)

    def decode(self, embed, position):
        self.emb.copy_(embed)
        self.pos.fill_(position)
        self.graph.replay()
        ATTN.update(self.attn)
        return self.logits


@torch.inference_mode()
def inference(self, *, t3_cond, text_tokens, max_new_tokens=1000, temperature=0.8, top_p=1.0, min_p=0.05,
              repetition_penalty=2.0, cfg_weight=0.5, **_):
    run = self._runner
    text_tokens = torch.atleast_2d(text_tokens).to(dtype=torch.long, device=self.device)
    start = self.hp.start_speech_token * torch.ones_like(text_tokens[:, :1])
    embeds, len_cond = self.prepare_input_embeds(t3_cond=t3_cond, text_tokens=text_tokens, speech_tokens=start,
                                                 cfg_weight=cfg_weight)
    if embeds.size(1) + 3 * text_tokens.size(-1) > MAX_LEN:  # no room left for its speech: the server halves it
        raise TooLong()
    guard = asa.AlignmentStreamAnalyzer(self.tfmr, None, text_tokens_slice=(len_cond, len_cond + text_tokens.size(-1)),
                                        alignment_layer_idx=9, eos_idx=self.hp.stop_speech_token)
    bos = torch.tensor([[self.hp.start_speech_token]], dtype=torch.long, device=self.device)
    bos_embed = self.speech_emb(bos) + self.speech_pos_emb.get_fixed_embedding(0)
    inputs = torch.cat([embeds, torch.cat([bos_embed, bos_embed])], dim=1)
    n0 = inputs.size(1)
    max_new_tokens = min(max_new_tokens, MAX_LEN - n0 - 1, getattr(self, 'cap', None) or max_new_tokens)
    if run.graph is None:
        run.capture()
    logits_all = run.prefill(inputs)

    top_p_w, min_p_w = TopPLogitsWarper(top_p=top_p), MinPLogitsWarper(min_p=min_p)
    rep = RepetitionPenaltyLogitsProcessor(penalty=float(repetition_penalty))
    generated = bos.clone()
    predicted = []
    for i in range(max_new_tokens):
        step = logits_all[:, -1, :]
        cond, uncond = step[0:1], step[1:2]
        logits = cond + cfg_weight * (cond - uncond)
        guard.last_aligned_attns = [ATTN[l][0, h].float() for l, h in asa.LLAMA_ALIGNED_HEADS]
        try:
            logits = guard.step(logits, next_token=generated[0, -1].item())
        except IndexError:
            pass  # its maps are empty for a word or two ("Ok."), where the stock loop fails outright
        logits = rep(generated[:1], logits)
        if temperature != 1.0:
            logits = logits / temperature
        logits = top_p_w(generated[:1], min_p_w(generated[:1], logits))
        nxt = torch.multinomial(torch.softmax(logits, dim=-1), num_samples=1)
        predicted.append(nxt)
        generated = torch.cat([generated, nxt], dim=1)
        if nxt.view(-1).item() == self.hp.stop_speech_token:
            break
        e = self.speech_emb(nxt) + self.speech_pos_emb.get_fixed_embedding(i + 1)
        logits_all = run.decode(torch.cat([e, e]), n0 + i)
    return torch.cat(predicted, dim=1)


def apply(model, dtype=torch.bfloat16):
    t3 = model.t3
    t3._runner = Runner(t3, dtype)
    t3.inference = types.MethodType(inference, t3)
