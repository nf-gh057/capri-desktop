# Her voice: a small HTTP server on 127.0.0.1 around Chatterbox Multilingual (text -> speech cloned from a short
# recording), started and stopped by Capri (src/main/tts.js). It runs in its own Python environment, set up by
# voice/setup.ps1 in %USERPROFILE%\.capri\voice (the "home": env\, profiles\, cache\), never in the repo.
#
# A profile is a folder in home\profiles: ref.wav (10-15 s of the voice, clean) and profile.json
# ({ name, lang, exaggeration, cfg, temperature, fx }). Which one speaks: the one asked for, else the one
# made from a recording in the language she speaks, else any.
#
#   GET  /health                       -> { state: loading|ready|error, error, device, profiles: [...] }
#   POST /say { text, lang, profile, fx } -> audio/wav (24 kHz mono), kept in home\cache
#   POST /profile { src, id, name, lang } -> a new profile from a recording: its speech, up to ~12 s
#
# Every request carries the token Capri passes in CAPRI_VOICE_TOKEN (x-voice-token): nothing else on the PC
# gets to make her say things.
import argparse, hashlib, io, json, os, re, sys, threading, time, traceback, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
VERSION = 2            # part of every cache key: bump when the sound changes for the same text
CACHE_MB = 300
# words her languages read wrong (Chatterbox reads "choom" as "hom" in Polish)
SPELL = {
    'pl': {'choom': 'czum', 'Choom': 'Czum'},
}

state = {'state': 'loading', 'error': None, 'device': None}
model = None
conds = {}             # a profile's recording (stamp) -> its conditionals, computed once
lock = threading.Lock()


def log(*parts):
    print('[voice]', *parts, file=sys.stderr, flush=True)


def profiles(home):
    out = []
    root = os.path.join(home, 'profiles')
    for pid in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        try:
            with open(os.path.join(root, pid, 'profile.json'), encoding='utf-8') as f:
                p = json.load(f)
            if os.path.isfile(os.path.join(root, pid, p.get('ref', 'ref.wav'))):
                out.append({**p, 'id': pid})
        except (OSError, ValueError):
            pass
    return out


def pick(home, wanted, lang):
    found = profiles(home)
    return (next((p for p in found if p['id'] == wanted), None)
            or next((p for p in found if p.get('lang') == lang), None)
            or (found[0] if found else None))


def load(home):
    global model
    try:
        import torch
        import chatterbox.models.t3.t3 as t3mod
        t3mod.tqdm = lambda it, **_: it  # no progress bars in her log
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        cuda = torch.cuda.is_available()
        state['device'] = torch.cuda.get_device_name(0) if cuda else 'cpu'
        m = ChatterboxMultilingualTTS.from_pretrained(device='cuda' if cuda else 'cpu')
        if cuda:
            import fast_t3
            fast_t3.apply(m)
            # the speech tokenizer only reads a profile's recording (once, cond_for): off the card meanwhile
            # (~470 MB). S3Gen tells its device by the tokenizer's: by its flow's, which stays on it
            type(m.s3gen).device = property(lambda self: next(self.flow.parameters()).device)
            m.s3gen.tokenizer.to('cpu')
            torch.cuda.empty_cache()
        model = m
        p = pick(home, None, None)
        if p:  # warm up (and record the CUDA graph) before her first line
            synth(home, p, 'Ok.', p.get('lang') or 'en')
        state['state'] = 'ready'
        log('ready on', state['device'])
    except Exception as e:  # noqa: BLE001 - shown in Mainframe
        traceback.print_exc()
        state.update(state='error', error=f'{type(e).__name__}: {e}')


def stamp(home, p):
    # which recording a profile speaks with, as it is now: a reference swapped in its folder counts at once
    ref = os.path.join(home, 'profiles', p['id'], p.get('ref', 'ref.wav'))
    st = os.stat(ref)
    return ref, f"{p['id']}:{st.st_mtime_ns}:{st.st_size}:{p.get('exaggeration', 0.5)}"


def cond_for(home, p):
    ref, key = stamp(home, p)
    if key not in conds:
        import torch
        tok = model.s3gen.tokenizer
        tok.to(model.device)
        try:
            model.prepare_conditionals(ref, exaggeration=float(p.get('exaggeration', 0.5)))
        finally:
            tok.to('cpu')
            if model.device == 'cuda':
                torch.cuda.empty_cache()
        conds[key] = model.conds
    model.conds = conds[key]


def synth(home, p, text, lang):
    import numpy as np
    import torch
    from fast_t3 import TooLong
    for word, said in SPELL.get(lang, {}).items():
        text = re.sub(rf'\b{word}\b', said, text)
    cond_for(home, p)
    torch.manual_seed(int(hashlib.sha256(text.encode()).hexdigest()[:8], 16))  # the same line sounds the same
    # now and then the model keeps babbling after the sentence: never past ~2.5x its length (25 tokens a second)
    model.t3.cap = int(25 * max(3.0, 2.5 * expected(text)))
    try:
        wav = model.generate(text, language_id=lang, exaggeration=float(p.get('exaggeration', 0.5)),
                             cfg_weight=float(p.get('cfg', 0.5)), temperature=float(p.get('temperature', 0.8)))
        return tail_cut(wav.squeeze(0).numpy(), model.sr, expected(text))
    except TooLong:
        cut = halve(text)
        if not cut:
            raise
        gap = np.zeros(int(model.sr * 0.12), dtype=np.float32)
        return np.concatenate([synth(home, p, cut[0], lang), gap, synth(home, p, cut[1], lang)])


def expected(text):
    # about how long a line takes to say, in seconds (her pace: ~14 characters a second)
    return len(text) / 14


def tail_cut(x, sr, seconds):
    # her sentence ends, a pause, then more that isn't in the text: cut at the pause
    import numpy as np
    if len(x) < sr * max(2.0, seconds * 1.4):
        return x
    hop = int(sr * 0.02)
    db = 20 * np.log10(np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) + 1e-9 for i in range(0, len(x) - hop, hop)]))
    quiet = db < db.max() - 40
    start = int(seconds * 0.7 / 0.02)
    run = 0
    for i in range(start, len(quiet)):
        run = run + 1 if quiet[i] else 0
        if run >= 18:  # 0.36 s of silence
            return x[: (i - run + 1) * hop + int(sr * 0.15)]
    return x


def halve(text):
    # at the punctuation nearest the middle, else at the space nearest it
    mid = len(text) // 2
    for marks in (',;:–—-', ' '):
        spots = [i for i, c in enumerate(text) if c in marks and 0 < i < len(text) - 1]
        if spots:
            i = min(spots, key=lambda s: abs(s - mid)) + 1
            return text[:i].strip(), text[i:].strip()
    return None


def to_wav(x, sr):
    import numpy as np
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm)
    return buf.getvalue()


def prune(cache):
    files = [os.path.join(cache, f) for f in os.listdir(cache)]
    files.sort(key=os.path.getatime)
    total = sum(os.path.getsize(f) for f in files)
    while files and total > CACHE_MB * 1e6:
        f = files.pop(0)
        total -= os.path.getsize(f)
        os.remove(f)


def say(home, body):
    import fx
    text = str(body.get('text') or '').strip()[:600]
    lang = str(body.get('lang') or 'en')
    p = pick(home, body.get('profile'), lang)
    if not text:
        raise ValueError('no text')
    if not p:
        raise ValueError('no voice profile')
    strength = float(body.get('fx', 1.0))
    key = hashlib.sha256(json.dumps([VERSION, text, lang, p, stamp(home, p)[1], strength], sort_keys=True).encode()).hexdigest()[:32]
    cache = os.path.join(home, 'cache')
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(cache, key + '.wav')
    if os.path.isfile(path):
        os.utime(path)
        with open(path, 'rb') as f:
            return f.read(), True
    with lock:
        t = time.time()
        x = synth(home, p, text, lang)
        x = fx.apply(x, model.sr, p.get('fx') or {}, strength)
        data = to_wav(x, model.sr)
        log(f'{len(x) / model.sr:.1f}s in {time.time() - t:.1f}s: {text[:60]}')
    with open(path, 'wb') as f:
        f.write(data)
    prune(cache)
    return data, False


def make_profile(home, body):
    # her voice from a recording: its speech (silences cut), up to ~12 s, at a steady level
    import numpy as np
    import librosa
    import soundfile as sf
    src = str(body.get('src') or '')
    pid = re.sub(r'[^a-z0-9-]+', '-', str(body.get('id') or 'voice').lower()).strip('-')[:40] or 'voice'
    x, sr = librosa.load(src, sr=24000, mono=True)
    parts = [x[a:b] for a, b in librosa.effects.split(x, top_db=35) if b - a > sr * 0.8]
    if not parts:
        raise ValueError('no speech in that recording')
    out, gap = [], np.zeros(int(sr * 0.25), dtype=np.float32)
    for part in sorted(parts, key=len, reverse=True):
        if sum(len(o) for o in out) > sr * 12:
            break
        out += [part, gap]
    y = np.concatenate(out)
    y *= 0.1 / max(float(np.sqrt(np.mean(y ** 2))), 1e-6)  # about -20 dBFS
    y = np.clip(y, -0.98, 0.98)
    folder = os.path.join(home, 'profiles', pid)
    os.makedirs(folder, exist_ok=True)
    sf.write(os.path.join(folder, 'ref.wav'), y, sr)
    p = {'name': str(body.get('name') or pid), 'lang': str(body.get('lang') or 'en'), 'ref': 'ref.wav',
         'source': os.path.basename(src), 'exaggeration': 0.5, 'cfg': 0.5, 'temperature': 0.8,
         'fx': {'eq': True, 'octave': 0.18, 'comb': 0.25, 'crush': 0.2}}
    with open(os.path.join(folder, 'profile.json'), 'w', encoding='utf-8') as f:
        json.dump(p, f, ensure_ascii=False, indent=2)
    return {**p, 'id': pid, 'seconds': round(len(y) / sr, 1)}


def serve(home, token, port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, code, data, kind='application/json', extra=None):
            body = data if isinstance(data, bytes) else json.dumps(data).encode()
            self.send_response(code)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def allowed(self):
            if self.headers.get('x-voice-token') == token:
                return True
            self.reply(403, {'error': 'token'})
            return False

        def do_GET(self):
            if not self.allowed():
                return
            if self.path == '/health':
                return self.reply(200, {**state, 'profiles': profiles(home)})
            self.reply(404, {'error': 'not found'})

        def do_POST(self):
            if not self.allowed():
                return
            try:
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
                if self.path == '/say':
                    if state['state'] != 'ready':
                        return self.reply(503, {'error': state['error'] or 'loading'})
                    data, cached = say(home, body)
                    return self.reply(200, data, 'audio/wav', {'x-cached': '1' if cached else '0'})
                if self.path == '/profile':
                    return self.reply(200, make_profile(home, body))
                self.reply(404, {'error': 'not found'})
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                self.reply(500, {'error': f'{type(e).__name__}: {e}'})

    httpd = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(json.dumps({'port': httpd.server_address[1]}), flush=True)  # Capri reads where to knock
    threading.Thread(target=load, args=(home,), daemon=True).start()
    threading.Thread(target=orphan, daemon=True).start()
    httpd.serve_forever()


def orphan():
    # when Capri goes (quit or crashed), the GPU is let go too. Not by reading a stdin she holds open: on Windows
    # a pending read on a pipe blocks anything else that looks at it (torch's import does), the whole process
    pid = int(os.environ.get('CAPRI_PID') or 0)
    if not pid:
        return
    if os.name == 'nt':
        import ctypes
        k32 = ctypes.windll.kernel32
        handle = k32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if handle:
            k32.WaitForSingleObject(handle, 0xFFFFFFFF)
    else:
        while True:
            time.sleep(2)
            try:
                os.kill(pid, 0)
            except OSError:
                break
    os._exit(0)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--home', default=os.path.join(os.path.expanduser('~'), '.capri', 'voice'))
    ap.add_argument('--port', type=int, default=0)
    a = ap.parse_args()
    token = os.environ.get('CAPRI_VOICE_TOKEN')
    if not token:
        sys.exit('CAPRI_VOICE_TOKEN is not set')
    serve(a.home, token, a.port)
