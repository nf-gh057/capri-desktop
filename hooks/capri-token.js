'use strict';

// The bridge's secret: Capri writes a new one each time she starts, her hooks (and the demo) read it
// and send it with every event. A page that reaches 127.0.0.1 through DNS rebinding, or another
// account on this PC, can't read your home folder, so it can't puppet her. CAPRI_TOKEN_FILE moves it
// (the tests do, so they never change the running Capri's).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const HEADER = 'x-capri-token';

const tokenFile = () => process.env.CAPRI_TOKEN_FILE || path.join(os.homedir(), '.capri', 'bridge-token');

// '' when there's none yet (Capri never started): the bridge says no, and the hook gives up quietly
function readToken() {
  try {
    return fs.readFileSync(tokenFile(), 'utf8').trim();
  } catch {
    return '';
  }
}

function createToken() {
  const token = randomBytes(32).toString('hex');
  const file = tokenFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, token, { mode: 0o600 });
  return token;
}

module.exports = { HEADER, tokenFile, readToken, createToken };
