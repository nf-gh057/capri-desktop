'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A Claude Code of our own on the PATH: stream-json in and out like `claude -p --input-format
// stream-json`, its answer's turn ending a while before its result (as the real one sums the turn up)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-llm-'));
const runs = path.join(dir, 'runs.log');
fs.writeFileSync(path.join(dir, 'fake-claude.js'), `
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(runs)}, JSON.stringify(process.argv.slice(2)) + '\\n');
const out = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
const ev = (event) => out({ type: 'stream_event', event });
let queue = Promise.resolve();
let buf = '';
let said = 0;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    const text = JSON.parse(line).message.content;
    queue = queue.then(() => turn(text));
  }
});
process.stdin.on('end', () => queue.then(() => process.exit(0)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function turn(text) {
  out({ type: 'system', subtype: 'init' });
  if (text.includes('SLOW')) await wait(5000);
  ev({ type: 'message_start' });
  for (const piece of ['an', 'swer ', String(++said)]) ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: piece } });
  ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' } });
  out({ type: 'assistant' });
  fs.appendFileSync(${JSON.stringify(runs)}, 'heard ' + JSON.stringify(text) + '\\n');
  await wait(700); // summing the turn up
  out({ type: 'result', is_error: false, result: 'answer ' + said });
}
`);
if (process.platform === 'win32') fs.writeFileSync(path.join(dir, 'claude.cmd'), `@node "${path.join(dir, 'fake-claude.js')}" %*\r\n`);
else fs.writeFileSync(path.join(dir, 'claude'), `#!/bin/sh\nexec node "${path.join(dir, 'fake-claude.js')}" "$@"\n`, { mode: 0o755 });
process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;

const llm = require('../src/main/llm');

const cfg = { claudeMode: 'default', claudeCwd: dir };
const ask = (text, { persona = 'You are Capri.', signal = new AbortController().signal, config = cfg } = {}) => {
  const pieces = [];
  return llm.chat('claude', config, { messages: [{ role: 'system', content: persona }, { role: 'user', content: text }] }, (p) => pieces.push(p), signal)
    .then((answer) => ({ answer, pieces }));
};
const launches = () => fs.readFileSync(runs, 'utf8').split('\n').filter((l) => l.startsWith('['));
const heard = () => fs.readFileSync(runs, 'utf8').split('\n').filter((l) => l.startsWith('heard ')).map((l) => JSON.parse(l.slice(6)));

test.after(() => {
  llm.resetAgents();
  setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 500);
});

test('her answer is hers once its turn ends, word by word, and the next message goes to the same Claude Code', async () => {
  const t0 = Date.now();
  const first = await ask('hi');
  assert.equal(first.answer, 'answer 1');
  assert.deepEqual(first.pieces, ['an', 'swer ', '1']);
  const second = await ask('and you?'); // sent while the first one is still being summed up: it waits for it
  assert.equal(second.answer, 'answer 2');
  assert.ok(Date.now() - t0 < 6000);
  const started = launches();
  assert.equal(started.length, 1, 'one Claude Code for both');
  assert.ok(started[0].includes('--input-format') && started[0].includes('--session-id'));
});

test('her persona changed: only the new lines go with your message', async () => {
  await ask('again', { persona: 'You are Capri.\nCodex is idle.' });
  assert.equal(heard().at(-1), '[Updated instructions: these lines replace your older ones on the same things]\nCodex is idle.\n\n[The user\'s message]\nagain');
  assert.equal(launches().length, 1);
});

test('stopped mid-answer: Claude Code goes, the next message picks the conversation up again', async () => {
  const abort = new AbortController();
  const slow = ask('SLOW one', { persona: 'You are Capri.\nCodex is idle.', signal: abort.signal });
  setTimeout(() => abort.abort(), 300);
  await assert.rejects(slow, /stopped/);
  const next = await ask('still there?', { persona: 'You are Capri.\nCodex is idle.' });
  assert.match(next.answer, /^answer 1$/); // a new Claude Code (the fake counts from 1 again)
  const started = launches();
  assert.equal(started.length, 2);
  assert.ok(started[1].includes('--resume'), 'the same session, resumed');
});

test('from your phone (read only): another Claude Code, with only reading tools and no MCP', async () => {
  await ask('from the phone', { persona: 'You are Capri.\nCodex is idle.', config: { ...cfg, readOnly: true } });
  const last = JSON.parse(launches().at(-1));
  assert.ok(last.includes('--strict-mcp-config'));
  assert.equal(last[last.indexOf('--tools') + 1], 'Read,Grep,Glob');
});
