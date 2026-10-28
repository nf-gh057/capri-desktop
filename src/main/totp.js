'use strict';

// The code from your authenticator app (TOTP, RFC 6238: six digits, a new one every 30 seconds) that
// unlocks her chat on Telegram. Its secret is made here, shown once as a QR code in Mainframe, then
// sealed like her keys.

const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const qrcode = require('qrcode-generator');

const STEP = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(bytes) {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return bits.match(/.{1,5}/g).map((chunk) => ALPHABET[parseInt(chunk.padEnd(5, '0'), 2)]).join('');
}

function unbase32(text) {
  const bits = [...String(text).toUpperCase().replace(/[\s=]/g, '')]
    .map((c) => ALPHABET.indexOf(c).toString(2).padStart(5, '0')).join('');
  return Buffer.from((bits.match(/.{8}/g) || []).map((b) => parseInt(b, 2)));
}

// A new secret: 20 random bytes, in base32 as authenticator apps take it
const secret = () => base32(randomBytes(20));

// The code for a 30-second step
function code(key, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', unbase32(key)).update(counter).digest();
  const at = mac[mac.length - 1] & 0xf;
  return String((mac.readUInt32BE(at) & 0x7fffffff) % 10 ** DIGITS).padStart(DIGITS, '0');
}

const stepAt = (now = Date.now()) => Math.floor(now / 1000 / STEP);

// The step a code typed now belongs to (this one, or the one before or after: a clock a little off),
// else null. A step already used (`after`) doesn't count again: a code works once.
function check(key, typed, { now = Date.now(), after = -1 } = {}) {
  const given = String(typed || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return null;
  const at = stepAt(now);
  for (const step of [at, at - 1, at + 1]) {
    if (step <= after) continue;
    if (timingSafeEqual(Buffer.from(code(key, step)), Buffer.from(given))) return step;
  }
  return null;
}

// What authenticator apps scan: the link, and its QR code as a picture (a data: URL)
function link(key, account) {
  const label = encodeURIComponent(`Capri:${account}`);
  return `otpauth://totp/${label}?secret=${key}&issuer=Capri&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;
}

function qr(text) {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  return code.createDataURL(5, 10);
}

module.exports = { secret, code, check, stepAt, link, qr, STEP };
