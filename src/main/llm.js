'use strict';

// Who she talks with: Ollama, any OpenAI-compatible server (local, cloud, or a keyless gateway),
// or Claude Code itself (headless `claude -p`, so your messages become its prompts), or Codex
// (`codex app-server`, signed in with a ChatGPT plan: no API key, no paying per token).
// Keys come from config.json's `apiKeys` ({ openai: "sk-..." }) or the provider's env variable.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const ollama = require('./ollama');

const PROVIDERS = {
  ollama: { label: 'Ollama (local)', kind: 'ollama', local: true },
  lmstudio: { label: 'LM Studio (local)', url: 'http://127.0.0.1:1234/v1', local: true },
  llamacpp: { label: 'llama.cpp / vLLM (local :8080)', url: 'http://127.0.0.1:8080/v1', local: true },
  pollinations: {
    label: 'Pollinations (no key)', url: 'https://text.pollinations.ai/openai', modelsUrl: 'https://text.pollinations.ai/models',
  },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY' },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY' },
  groq: { label: 'Groq', url: 'https://api.groq.com/openai/v1', env: 'GROQ_API_KEY' },
  gemini: { label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY' },
  deepseek: { label: 'DeepSeek', url: 'https://api.deepseek.com/v1', env: 'DEEPSEEK_API_KEY' },
  mistral: { label: 'Mistral', url: 'https://api.mistral.ai/v1', env: 'MISTRAL_API_KEY' },
  custom: { label: 'Custom (customUrl in config)' },
  claude: { label: 'Claude Code (sends to the terminal agent)', kind: 'claude' },
  codex: { label: 'Codex (ChatGPT plan, sends to the terminal agent)', kind: 'codex' },
};

// no bypassPermissions: a chat bubble on the desktop shouldn't run anything without asking
const CLAUDE_MODES = ['default', 'acceptEdits'];
// the same two for Codex, as its sandboxes: it reads, or it also edits in its folder
const CODEX_SANDBOX = { default: 'read-only', acceptEdits: 'workspace-write' };
// Claude Code's tools when it only reads (from your phone): nothing that changes or runs anything,
// nothing that reaches out, and no MCP server
const READ_ONLY_TOOLS = 'Read,Grep,Glob';
// the terminal agents: they keep the conversation themselves and really work in a folder
const isAgent = (id) => ['claude', 'codex'].includes(PROVIDERS[id]?.kind);

function endpoint(id, cfg) {
  const p = PROVIDERS[id];
  const url = (id === 'custom' ? cfg.customUrl : p.url) || '';
  const key = cfg.apiKeys?.[id] || (p.env && process.env[p.env]) || '';
  return { ...p, url: url.replace(/\/+$/, ''), key };
}

const headers = (key) => ({ 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) });

// Why a server said no, in a sentence (Gemini sends its error inside an array), with a code when it's
// worth another try: 'busy' (too many people on it right now), 'gone' (that model isn't served anymore).
async function failure(res) {
  const body = await res.text().catch(() => '');
  let message = body.slice(0, 200) || `answered ${res.status}`;
  try {
    const parsed = JSON.parse(body);
    const err = (Array.isArray(parsed) ? parsed[0] : parsed)?.error;
    if (err) message = typeof err === 'string' ? err : err.message || message;
  } catch {
    // not JSON: the start of the body says it
  }
  const code = res.status === 429 || res.status === 503 || /overloaded|high demand|unavailable/i.test(message) ? 'busy'
    : res.status === 404 ? 'gone' : null;
  return Object.assign(new Error(message), { status: res.status, code });
}

// Gemini lists every model it has (embeddings, speech, images…): only the ones to chat with, a current
// stable Flash first (older ones get closed to new keys, previews come and go).
function geminiModels(names) {
  const version = (n) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1] || 0);
  const rank = (n) => (/preview|exp/.test(n) ? 4 : 0) + (/flash-lite/.test(n) ? 1 : /flash/.test(n) ? 0 : 2);
  return names
    .filter((n) => /gemini/.test(n) && !/embed|tts|image|audio|live|veo|imagen|computer-use|robotics|aqa/.test(n))
    .sort((a, b) => rank(a) - rank(b) || version(b) - version(a));
}

// The provider's models by name; null when it can't be reached (Ollama only), throws with why otherwise.
async function models(id, cfg) {
  const p = endpoint(id, cfg);
  if (p.kind === 'ollama') return ollama.models().catch(() => null);
  if (p.kind === 'claude') return claudeVersion().then(() => ['Claude Code']);
  if (p.kind === 'codex') return codexModels();
  // what's missing has a code, so her setup knows what to ask for (setup.js)
  if (!p.url) throw Object.assign(new Error('no address set for this server'), { code: 'nourl' });
  if (p.env && !p.key) throw Object.assign(new Error(`no API key (or ${p.env})`), { code: 'nokey' });
  const res = await fetch(p.modelsUrl || `${p.url}/models`, { headers: headers(p.key), signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw await failure(res);
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.data || body.models || [];
  const names = list.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
  return id === 'gemini' ? geminiModels(names) : names;
}

function warm(id, model) {
  if (PROVIDERS[id].kind === 'ollama') ollama.warm(model);
  if (PROVIDERS[id].kind === 'codex') codexServer().catch(() => {}); // started while you type
}

// OpenAI-style streaming (server-sent events): onDelta(piece) as it comes, resolves with all of it.
async function openaiChat(p, { model, messages }, onDelta, signal) {
  const res = await fetch(`${p.url}/chat/completions`, {
    method: 'POST',
    headers: headers(p.key),
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!res.ok) throw await failure(res);
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return text;
      const msg = JSON.parse(data);
      if (msg.error) throw new Error(msg.error.message || msg.error);
      const piece = msg.choices?.[0]?.delta?.content || ''; // reasoning comes apart, and is left out
      if (piece) {
        text += piece;
        onDelta(piece);
      }
    }
  }
  return text;
}

// --- Claude Code ---------------------------------------------------------------------------------
// The prompt goes in on stdin, never on the command line: the shell (needed for an npm claude.cmd)
// only ever sees fixed arguments.

const quote = (s) => (process.platform === 'win32' ? `"${s}"` : s); // cmd joins the arguments
// its session id, picked here so her hooks can tell its events from your other sessions' (main.js)
let claudeSession = null;
let claudeStarted = false; // each message after the first continues the same conversation

function claudeVersion() {
  return new Promise((resolve, reject) => {
    execFile('claude', ['--version'], { shell: process.platform === 'win32', timeout: 10000 }, (err, out) => (
      err ? reject(new Error('Claude Code not found (is `claude` on your PATH?)')) : resolve(out.trim())));
  });
}

function claudeChat(cfg, text, persona, onDelta, signal) {
  // her persona, from a file: too long and too full of quotes and newlines for cmd's command line
  const personaFile = path.join(os.tmpdir(), 'capri-persona.txt');
  fs.writeFileSync(personaFile, persona);
  const args = ['-p', '--output-format', 'stream-json', '--verbose',
    '--permission-mode', CLAUDE_MODES.includes(cfg.claudeMode) ? cfg.claudeMode : 'default',
    '--append-system-prompt-file', quote(personaFile)];
  // from your phone (main.js): it reads, and that's all, whatever your Claude Code settings allow
  if (cfg.readOnly) args.push('--tools', READ_ONLY_TOOLS, '--strict-mcp-config');
  if (!claudeSession) claudeSession = randomUUID();
  args.push(claudeStarted ? '--resume' : '--session-id', claudeSession);
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: cfg.claudeCwd || os.homedir(),
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    const kill = () => (process.platform === 'win32'
      ? execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => {})
      : child.kill());
    signal.addEventListener('abort', kill, { once: true });
    let buffer = '';
    let all = '';
    let result = null;
    let errors = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        claudeStarted = true;
        if (msg.type === 'assistant') {
          for (const block of msg.message?.content || []) {
            if (block.type !== 'text' || !block.text) continue;
            const piece = (all ? '\n' : '') + block.text;
            all += piece;
            onDelta(piece);
          }
        } else if (msg.type === 'result') {
          result = msg;
        }
      }
    });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.stdin.end(text);
    child.on('error', reject);
    child.on('close', () => {
      if (signal.aborted) return reject(new Error('stopped'));
      if (result?.is_error) return reject(new Error(result.result || 'Claude Code failed'));
      if (!result) return reject(new Error(errors.trim().slice(0, 300) || 'Claude Code gave no answer'));
      resolve(result.result || all);
    });
  });
}

// --- Codex ---------------------------------------------------------------------------------------
// One `codex app-server` for all her answers (JSON-RPC, a message per line on stdio), started when
// she first needs it and closed after a while unused: no new Codex for every message, and her words
// stream into the bubble as they come. Its command line is fixed: everything else goes over stdio.

const CODEX_EFFORTS = ['low', 'medium', 'high'];
const CODEX_IDLE_MS = 15 * 60 * 1000;

let codexThread = null; // its conversation, set by Codex's first answer
let codexPersona = null; // her persona as that conversation last heard it
let codex = null; // the server: { child, request, notify, handlers, loaded, idle }
// a thread id is saved in her memory and comes back from it: nothing else than one passes
const threadId = (id) => (typeof id === 'string' && /^[\w-]{1,100}$/.test(id) ? id : null);

// Codex's error messages may carry the server's answer as JSON in a string: its message
function codexError(message) {
  try {
    const parsed = JSON.parse(message);
    return parsed.error?.message || parsed.message || message;
  } catch {
    return message;
  }
}

function stopCodex() {
  if (!codex) return;
  const { child, idle } = codex;
  codex = null;
  clearTimeout(idle);
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => {});
  else child.kill();
}

// closed once unused for a while, never in the middle of an answer
function idleLater(server) {
  clearTimeout(server.idle);
  server.idle = setTimeout(() => (server.handlers.size ? idleLater(server) : codex === server && stopCodex()), CODEX_IDLE_MS);
}

// The server, running and greeted: started on first use (through cmd on Windows, where an npm
// install only has codex.cmd).
function codexServer() {
  if (codex) {
    idleLater(codex);
    return codex.ready;
  }
  const child = spawn('codex', ['app-server'], { cwd: os.homedir(), shell: process.platform === 'win32', windowsHide: true });
  const pending = new Map();
  let next = 0;
  let buffer = '';
  let errors = '';
  const server = {
    child,
    handlers: new Set(), // notifications: (method, params)
    loaded: null, // the thread this server has open
    idle: null,
    request: (method, params) => new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    }),
    notify: (method, params) => child.stdin.write(`${JSON.stringify({ method, params })}\n`),
  };
  codex = server;
  idleLater(server);
  child.stdin.on('error', () => {}); // gone: its exit says why
  child.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-2000); });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.method && msg.id !== undefined) {
        // it asks something (approval is "never": nothing should come): no, to whatever it is
        const approval = /requestApproval$|Approval$/.test(msg.method);
        child.stdin.write(`${JSON.stringify(approval ? { id: msg.id, result: { decision: 'decline' } }
          : { id: msg.id, error: { code: -32601, message: 'not supported' } })}\n`);
      } else if (msg.method) {
        server.handlers.forEach((handle) => handle(msg.method, msg.params || {}));
      } else if (pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(codexError(msg.error.message || 'Codex said no')));
        else resolve(msg.result);
      }
    }
  });
  const gone = (err) => {
    if (codex === server) codex = null;
    clearTimeout(server.idle);
    const why = err || new Error(errors.trim().split('\n').at(-1)?.slice(0, 300) || 'Codex stopped');
    pending.forEach(({ reject }) => reject(why));
    pending.clear();
    server.handlers.forEach((handle) => handle('capri/exit', { error: why }));
  };
  child.on('error', (err) => gone(new Error(`Codex not found (is \`codex\` on your PATH?) ${err.message}`)));
  child.on('exit', (code) => gone(code === 1 && !buffer && /not recognized|not found/i.test(errors)
    ? new Error('Codex not found (is `codex` on your PATH?)') : null));
  server.ready = server.request('initialize', { clientInfo: { name: 'capri', title: 'Capri', version: '1' }, capabilities: null })
    .then(() => {
      server.notify('initialized', {});
      return server;
    });
  server.ready.catch(() => stopCodex());
  return server.ready;
}

// Its models you can pick, the one Codex uses by default first
async function codexModels() {
  const server = await codexServer();
  const { data = [] } = await server.request('model/list', {});
  return data.filter((m) => !m.hidden).sort((a, b) => b.isDefault - a.isDefault).map((m) => m.model);
}

// What changed in her persona since the conversation last heard it (what's open, what your assistant
// is doing…): only those lines, said with your message. Codex keeps the persona a conversation
// started with, whatever comes after.
function personaNews(persona) {
  if (codexPersona === persona) return '';
  const known = new Set((codexPersona || '').split('\n'));
  const news = persona.split('\n').filter((line) => line.trim() && !known.has(line));
  return news.length ? `[Updated instructions: these lines replace your older ones on the same things]\n${news.join('\n')}\n\n[The user's message]\n` : '';
}

const sandboxPolicy = (mode) => (mode === 'workspace-write'
  ? { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }
  : { type: 'readOnly', networkAccess: false });

async function codexChat(cfg, model, text, persona, onDelta, signal) {
  const server = await codexServer();
  const cwd = cfg.claudeCwd || os.homedir();
  const sandbox = CODEX_SANDBOX[cfg.claudeMode] || 'read-only';
  const effort = CODEX_EFFORTS.includes(cfg.codexEffort) ? cfg.codexEffort : 'low';
  const settings = { cwd, sandbox, approvalPolicy: 'never', model };
  // the conversation open on this server: the saved one picked up again, else a new one
  if (codexThread && server.loaded !== codexThread) {
    await server.request('thread/resume', { ...settings, threadId: codexThread, excludeTurns: true })
      .then(() => { server.loaded = codexThread; })
      .catch(() => { codexThread = null; }); // gone from Codex's history: a new one
  }
  let news = personaNews(persona);
  if (!codexThread) {
    const started = await server.request('thread/start', { ...settings, developerInstructions: persona });
    codexThread = threadId(started.thread?.id);
    if (!codexThread) throw new Error('Codex gave no conversation');
    server.loaded = codexThread;
    news = '';
  }
  codexPersona = persona;
  if (signal.aborted) throw new Error('stopped');

  return new Promise((resolve, reject) => {
    let all = '';
    let item = null;
    let turn = null;
    let failed = null;
    const finish = (err, value) => {
      server.handlers.delete(handle);
      signal.removeEventListener('abort', stop);
      if (err) reject(err);
      else resolve(value);
    };
    const handle = (method, params) => {
      if (method === 'capri/exit') return finish(params.error);
      if (params.threadId && params.threadId !== codexThread) return;
      if (method === 'item/agentMessage/delta' && params.delta) {
        // its messages between two steps of work, one per line
        const piece = (item && item !== params.itemId ? '\n' : '') + params.delta;
        item = params.itemId;
        all += piece;
        onDelta(piece);
      } else if (method === 'error' && !params.willRetry) {
        failed = codexError(params.error?.message || '');
      } else if (method === 'turn/completed') {
        const { status, error } = params.turn || {};
        if (signal.aborted || status === 'interrupted') finish(new Error('stopped'));
        else if (status === 'failed') finish(new Error(codexError(error?.message || failed || 'Codex failed')));
        else if (!all) finish(new Error(failed || 'Codex gave no answer'));
        else finish(null, all);
      }
    };
    const stop = () => {
      if (turn) server.request('turn/interrupt', { threadId: codexThread, turnId: turn }).catch(() => {});
      else finish(new Error('stopped'));
    };
    server.handlers.add(handle);
    signal.addEventListener('abort', stop, { once: true });
    server.request('turn/start', {
      threadId: codexThread, cwd, model, effort, approvalPolicy: 'never', sandboxPolicy: sandboxPolicy(sandbox),
      input: [{ type: 'text', text: news + text, text_elements: [] }],
    }).then((res) => {
      turn = res.turn?.id || null;
      if (signal.aborted) stop();
    }, (err) => finish(err));
  });
}

function resetAgents() {
  claudeSession = null;
  claudeStarted = false;
  codexThread = null;
  codexPersona = null;
}

// The terminal agents' conversations, to save and pick up again after a restart.
const agentMemory = () => ({
  claude: { session: claudeSession, started: claudeStarted },
  codex: codexThread && { thread: codexThread, persona: codexPersona },
});
function restoreAgents(saved = {}) {
  claudeSession = saved.claude?.session || null;
  claudeStarted = Boolean(claudeSession && saved.claude.started);
  // saved by an older Capri: the thread alone, its persona unknown (all of it goes with the next message)
  codexThread = threadId(typeof saved.codex === 'string' ? saved.codex : saved.codex?.thread);
  codexPersona = (codexThread && typeof saved.codex?.persona === 'string') ? saved.codex.persona : null;
}

// Codex's hooks send its thread as "codex:<thread>" (hooks/capri-codex-hook.js)
const isChatSession = (id) => Boolean(id) && (id === claudeSession || (Boolean(codexThread) && id === `codex:${codexThread}`));

async function chat(id, cfg, { model, messages }, onDelta, signal) {
  const p = endpoint(id, cfg);
  if (p.kind === 'ollama') return ollama.chat({ model, messages }, onDelta, signal);
  // the terminal agents keep their own memory of the conversation: only her persona and your last message go
  if (p.kind === 'claude') return claudeChat(cfg, messages.at(-1).content, messages[0].content, onDelta, signal);
  if (p.kind === 'codex') return codexChat(cfg, model || null, messages.at(-1).content, messages[0].content, onDelta, signal);
  return openaiChat(p, { model, messages }, onDelta, signal);
}

// Whether her answers stay on this PC: a server on this machine (and with Ollama, not a cloud model).
function isLocal(id, cfg, model) {
  if (id === 'ollama') {
    return !ollama.isCloud(model) && /^(https?:\/\/)?(127\.0\.0\.1|localhost|0\.0\.0\.0|\[?::1\]?)(:|\/|$)/.test(process.env.OLLAMA_HOST || '127.0.0.1');
  }
  if (id === 'custom') return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(cfg.customUrl || '');
  return Boolean(PROVIDERS[id].local);
}

module.exports = {
  isLocal, isAgent, PROVIDERS, CLAUDE_MODES, CODEX_SANDBOX, CODEX_EFFORTS, models, warm, chat, resetAgents, isChatSession, agentMemory,
  restoreAgents, stopAgents: stopCodex,
};
