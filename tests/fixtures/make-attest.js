'use strict';
// Makes tests/fixtures/attest.json: made-up attestation chains (a CA of its own, not Google's), as a phone's secure
// hardware would sign one, for tests/pocket.test.js. Run once with OpenSSL on the PATH: node tests/fixtures/make-attest.js
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-'));
const run = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });

// DER, enough of it
const len = (n) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]));
const tlv = (tag, body) => Buffer.concat([Buffer.from(tag), len(body.length), body]);
const intDer = (n) => tlv([0x02], Buffer.from(n < 128 ? [n] : [0, n]));
const seq = (...xs) => tlv([0x30], Buffer.concat(xs));
const set = (...xs) => tlv([0x31], Buffer.concat(xs));
const octets = (b) => tlv([0x04], b);
const enumDer = (n) => tlv([0x0a], Buffer.from([n]));
const nul = tlv([0x05], Buffer.alloc(0));
// [n] EXPLICIT, high tag numbers as KeyMint's ([503] is bf 83 77)
function tagged(n, body) {
  if (n < 31) return tlv([0xa0 | n], body);
  const bytes = [];
  for (let v = n; v > 0; v = Math.floor(v / 128)) bytes.unshift(v % 128);
  return tlv([0xbf, ...bytes.map((b, i) => (i < bytes.length - 1 ? b | 0x80 : b))], body);
}

function description({ level = 1, challenge, noAuth = false, authType = 2, timeout = null }) {
  const hw = Buffer.concat([
    tagged(1, set(intDer(2))), // purpose: SIGN
    tagged(2, intDer(3)),      // algorithm: EC
    ...(noAuth ? [tagged(503, nul)] : []),
    ...(authType ? [tagged(504, intDer(authType))] : []),
    ...(timeout !== null ? [tagged(505, intDer(timeout))] : []),
  ]);
  return seq(intDer(200), enumDer(level), intDer(200), enumDer(level), octets(challenge), octets(Buffer.alloc(0)), seq(), seq(hw));
}

run('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'ca.key');
run('req', '-x509', '-new', '-key', 'ca.key', '-subj', '/CN=Made-up attestation root', '-days', '7300', '-out', 'ca.pem');
const caDer = new crypto.X509Certificate(fs.readFileSync(path.join(dir, 'ca.pem')));

const challenge = crypto.createHash('sha256').update('ABCDE23456').digest();
const out = { root: caDer.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), challenge: challenge.toString('base64'), cases: {} };
const cases = {
  good: {},
  software: { level: 0 },
  noAuth: { noAuth: true, authType: 0 },
  forAWhile: { timeout: 300 },
  otherChallenge: { challenge: crypto.randomBytes(32) },
};
for (const [name, opts] of Object.entries(cases)) {
  run('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'leaf.key');
  run('req', '-new', '-key', 'leaf.key', '-subj', '/CN=Android Keystore Key', '-out', 'leaf.csr');
  const ext = description({ challenge, ...opts }).toString('hex').toUpperCase();
  fs.writeFileSync(path.join(dir, 'ext.cnf'), `[x]\n1.3.6.1.4.1.11129.2.1.17=DER:${ext}\n`);
  run('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '3650', '-extfile', 'ext.cnf', '-extensions', 'x', '-out', 'leaf.pem');
  const leaf = new crypto.X509Certificate(fs.readFileSync(path.join(dir, 'leaf.pem')));
  const jwk = leaf.publicKey.export({ format: 'jwk' });
  // (its private half too: a throwaway key, for the tests to sign with as her app would)
  const key = fs.readFileSync(path.join(dir, 'leaf.key'), 'utf8');
  out.cases[name] = { chain: [leaf.raw.toString('base64'), caDer.raw.toString('base64')], jwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, key };
}
fs.writeFileSync(path.join(__dirname, 'attest.json'), `${JSON.stringify(out, null, 1)}\n`);
fs.rmSync(dir, { recursive: true, force: true });
console.log('ok', Object.keys(out.cases).join(', '));
