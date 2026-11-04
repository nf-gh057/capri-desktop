// Her voice out loud (src/main/tts.js, voice/server.py): her line goes to her voice server, which makes it a
// sentence at a time; each piece of audio is queued right behind the one before, so she talks while the rest is
// still being made. A chat answer still coming in goes out a whole sentence at a time as it arrives.

// The part of a growing answer that's whole sentences, past what's gone out already (as tts.js ready()).
function ready(text, said, done) {
  const rest = text.slice(said);
  if (done) return { text: rest, upTo: text.length };
  const m = rest.match(/^[\s\S]*[.!?…]["”»)]*(?=\s)/);
  return m ? { text: m[0], upTo: said + m[0].length } : { text: '', upTo: said };
}

export class Speech {
  constructor({ host, voice }) {
    this.host = host;
    this.voice = voice;      // her sounds (voice.js): its AudioContext
    this.on = false;
    this.mode = 'chat';      // 'chat': her chat's answers; 'all': every line in her bubble
    this.volume = 0.9;
    this.muted = false;
    this.id = null;          // what she's saying now
    this.n = 0;
    this.said = 0;           // of a chat answer coming in: how much has gone out
    this.sent = '';          // ...and that text
    this.streaming = false;
    this.sources = [];
    this.endAt = 0;          // when the audio queued so far ends (AudioContext time)
    this.waitUntil = 0;      // asked, nothing back yet: her blips stay quiet until then (performance.now())
    this.chain = Promise.resolve();
    this.out = null;
    this.onPiece = null;     // () => void, as each piece starts (her mouth)
    host.onVoicePiece((piece) => {
      this.chain = this.chain.then(() => this.play(piece)).catch(() => {});
    });
  }

  configure(cfg) {
    this.on = Boolean(cfg.voiceOn);
    this.mode = cfg.voiceMode === 'all' ? 'all' : 'chat';
    this.volume = typeof cfg.voiceVolume === 'number' ? cfg.voiceVolume : 0.9;
    this.muted = Boolean(cfg.muted);
    if (this.out) this.out.gain.value = this.volume;
    if (!this.on || this.muted) this.stop();
  }

  // speaking, or about to (her bubble's typing blips stay quiet)
  get active() {
    if (!this.id) return false;
    const ctx = this.voice.ctx;
    return performance.now() < this.waitUntil || (ctx && ctx.currentTime < this.endAt);
  }

  wanted(chat) {
    return this.on && !this.muted && (this.mode === 'all' || chat);
  }

  // A line of hers, whole (chat: it's her chat's, said in either mode; force: Mainframe's "Listen")
  say(text, { chat = false, force = false } = {}) {
    if (!text || !(force ? this.on && !this.muted : this.wanted(chat))) return false;
    this.stop();
    this.id = `say-${++this.n}`;
    this.send(text);
    return true;
  }

  // A chat answer starting: what comes in through stream() is said as it arrives
  turn() {
    this.stop();
    if (!this.wanted(true)) return;
    this.id = `turn-${++this.n}`;
    this.said = 0;
    this.sent = '';
    this.streaming = true;
  }

  stream(text, done) {
    if (!this.streaming || !this.id) return;
    // rewritten rather than added to ("loading the model…", then her answer): the new text from its start
    if (!text.startsWith(this.sent)) this.said = 0;
    const next = ready(text, this.said, done);
    this.sent = text.slice(0, next.upTo);
    this.said = next.upTo;
    if (next.text.trim()) this.send(next.text);
    if (done) this.streaming = false;
  }

  async send(text) {
    const id = this.id;
    this.waitUntil = performance.now() + 8000;
    const ok = await this.host.voiceSpeak(id, text).catch(() => false);
    if (!ok && this.id === id && !this.sources.length) this.waitUntil = 0; // her voice isn't ready: blips it is
  }

  async play({ id, wav, error }) {
    if (id !== this.id || error || !wav) return;
    const ctx = this.voice.ensure();
    if (ctx.state === 'suspended') await ctx.resume();
    const bytes = wav instanceof Uint8Array ? wav : new Uint8Array(wav);
    const buffer = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (id !== this.id) return;
    if (!this.out) {
      this.out = ctx.createGain();
      this.out.connect(ctx.destination);
    }
    this.out.gain.value = this.volume;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.out);
    const at = Math.max(ctx.currentTime + 0.03, this.endAt);
    src.start(at);
    this.endAt = at + buffer.duration;
    this.waitUntil = 0;
    this.sources.push(src);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
    };
    setTimeout(() => id === this.id && this.onPiece?.(), Math.max(0, (at - ctx.currentTime) * 1000));
  }

  stop() {
    if (this.id) this.host.voiceHush(this.id);
    this.id = null;
    this.streaming = false;
    this.waitUntil = 0;
    this.endAt = 0;
    for (const src of this.sources) {
      try {
        src.stop();
      } catch { /* not started yet */ }
    }
    this.sources = [];
  }
}
