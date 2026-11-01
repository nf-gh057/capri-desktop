'use strict';

// Her app's key, as Google vouches for it (Android Key Attestation): the phone's secure hardware signs a
// certificate for the key it made, up to one of Google's roots (attest-roots.json, from
// android.googleapis.com/attestation/root), saying what the key is. Her PCs check, with nothing taken on the
// app's word: the chain up to a Google root, that its last certificate is the key paired, that the key lives in
// the phone's secure hardware (its TEE or StrongBox, not software), that it signs, that it can be used only right
// after a fingerprint, each time (no "for a while"), and, when pairing, that it was made for this pairing (its
// challenge). Revoked keys (Google's status list) aren't looked up: that would ask a server of Google's.

const crypto = require('node:crypto');
const ROOTS = require('./attest-roots.json').map((pem) => new crypto.X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));

const OID = Buffer.from('060a2b06010401d679020111', 'hex'); // 1.3.6.1.4.1.11129.2.1.17, the key's description
const TEE = 1;
const STRONGBOX = 2;
const FINGERPRINT = 2; // HardwareAuthenticatorType: biometric

// one DER element at `at`: { tag (class bits and number), cons, start (of its contents), end }
function element(buf, at) {
  let i = at;
  const first = buf[i++];
  let number = first & 0x1f;
  if (number === 0x1f) { // a high tag number, as the key's authorizations' [503], [504]…
    number = 0;
    let b;
    do {
      b = buf[i++];
      number = number * 128 + (b & 0x7f);
    } while (b & 0x80);
  }
  let len = buf[i++];
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + buf[i++];
  }
  if (i + len > buf.length) throw new Error('short');
  return { cls: first >> 6, cons: Boolean(first & 0x20), number, start: i, end: i + len };
}

// the elements inside a constructed one
function inside(buf, el) {
  const out = [];
  for (let at = el.start; at < el.end;) {
    const e = element(buf, at);
    out.push(e);
    at = e.end;
  }
  return out;
}

const int = (buf, el) => buf.subarray(el.start, el.end).reduce((n, b) => n * 256 + b, 0);

// An AuthorizationList's fields by their tag number: { 1: purposes, 503: noAuthRequired, … }
function authorizations(buf, el) {
  const out = {};
  for (const field of inside(buf, el)) out[field.number] = field;
  return out;
}

// The key's description in a certificate (DER): its security level, challenge and what the hardware enforces
function description(der) {
  const at = der.indexOf(OID);
  if (at < 0) return null;
  let next = element(der, at).end;
  let e = element(der, next);
  if (e.number === 1 && e.cls === 0) { // critical: a BOOLEAN first
    next = e.end;
    e = element(der, next);
  }
  const value = der.subarray(e.start, e.end); // OCTET STRING holding the KeyDescription
  const parts = inside(value, element(value, 0));
  return {
    level: int(value, parts[3]), // where the key lives (KeyMint's security level)
    challenge: Buffer.from(value.subarray(parts[4].start, parts[4].end)),
    hardware: { buf: value, auth: authorizations(value, parts[7]) },
  };
}

// A phone key's chain (base64 DER, the key's certificate first) checked: { ok: true, strongBox } or { ok: false,
// why }. `jwk`: the key it must be ({ x, y }); `challenge`: what it must have been made for (a Buffer), if known;
// `roots`: the roots to end in (Google's; tests have their own).
function check(chain, jwk, challenge = null, roots = ROOTS) {
  try {
    if (!Array.isArray(chain) || chain.length < 2 || chain.length > 6) return { ok: false, why: 'noChain' };
    const certs = chain.map((b64) => new crypto.X509Certificate(Buffer.from(String(b64), 'base64')));
    for (let i = 0; i < certs.length - 1; i++) {
      if (!certs[i].verify(certs[i + 1].publicKey)) return { ok: false, why: 'brokenChain' };
    }
    const root = certs.at(-1);
    if (!root.verify(root.publicKey) || !roots.includes(root.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'))) {
      return { ok: false, why: 'notGoogle' };
    }
    const leaf = certs[0].publicKey.export({ format: 'jwk' });
    if (leaf.crv !== 'P-256' || leaf.x !== jwk?.x || leaf.y !== jwk?.y) return { ok: false, why: 'otherKey' };
    const d = description(certs[0].raw);
    if (!d) return { ok: false, why: 'noDescription' };
    if (d.level !== TEE && d.level !== STRONGBOX) return { ok: false, why: 'software' };
    if (challenge && (d.challenge.length !== challenge.length || !crypto.timingSafeEqual(d.challenge, challenge))) {
      return { ok: false, why: 'otherChallenge' };
    }
    const { buf, auth } = d.hardware;
    const set = auth[1] && inside(buf, auth[1])[0]; // [1] EXPLICIT SET OF INTEGER
    const purposes = set ? inside(buf, set).map((p) => int(buf, p)) : [];
    if (!purposes.includes(2)) return { ok: false, why: 'notSigning' }; // SIGN
    if (auth[503]) return { ok: false, why: 'noFingerprint' }; // noAuthRequired
    const type = auth[504] && int(buf, inside(buf, auth[504])[0]);
    if (!type || !(type & FINGERPRINT)) return { ok: false, why: 'noFingerprint' };
    if (auth[505] && int(buf, inside(buf, auth[505])[0]) > 0) return { ok: false, why: 'notEachTime' }; // authTimeout
    return { ok: true, strongBox: d.level === STRONGBOX };
  } catch {
    return { ok: false, why: 'bad' };
  }
}

module.exports = { check, description, element, inside };
