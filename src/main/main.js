'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, protocol, net, shell, globalShortcut, nativeImage,
  clipboard, ClipboardItem, dialog, powerMonitor, desktopCapturer,
} = require('electron');
const { randomUUID, createHash } = require('node:crypto');

const config = require('./config');
const { TRAY, LANGS } = require('./labels');
const { createBridge } = require('./bridge');
const { startWindowWatch } = require('./windows');
const llm = require('./llm');
const ollama = require('./ollama');
const setup = require('./setup');
const apps = require('./apps');
const launch = require('./launch');
const files = require('./files');
const { ASSISTANTS, assistant } = require('./assistants');
const { createMainframe } = require('./mainframe');
const phone = require('./phone');
const totp = require('./totp');
const swarm = require('./swarm');
const update = require('./update');
const { createMind } = require('./mind');
const activeAssistant = () => assistant(config.load().assistant); // Claude Code or Codex
const activeHooks = () => activeAssistant().hooks;
const demoSteps = require('../../scripts/demo-sequence');

const ROOT = path.resolve(__dirname, '..', '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.CAPRI_PORT) || 47823;
const SOUND_EXT = /\.(mp3|wav|ogg|m4a)$/i;

const OLLAMA_SITE = 'https://ollama.com';

protocol.registerSchemesAsPrivileged([
  { scheme: 'capri', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let overlay = null;
let tray = null;
let trayMenu = null; // also what she opens when you right-click her
let demoTimer = null;
let windowWatch = null;
let mainframe = null; // her settings window (mainframe.js)
// her swarm (swarm.js): the link to her on your other PCs, and what Tailscale says here
let hive = null;
let hiveTailscale = null; // { ip, name, state } or null (not there)
let hiveAway = null;      // the name of your other PC she's on (put away here meanwhile), else null
let hiveError = null;
let hiveInvite = null;    // { text, until }: a code for another PC, shown in Mainframe
let screenLocked = false;
let hiveFake = null;      // --dev: { locked, idle } instead of this PC's (two Capris on one PC)
let hiveIsland = false;   // --dev: as if this PC had no network (her swarm down, her mind kept)
let hiveFound = [];       // Capris on your other devices on Tailscale, not in her swarm yet: [{ host, port, name, version }]
// her shared mind (mind.js), while her swarm is on: what one Capri knows on all your PCs
let mind = null;
let mindSaveTimer = null;
let mindApplying = false; // a change that came from another PC: not written back as ours
let hiveAlone = null;     // since when no other PC answers (an island), then { from, at } once one does
// her own updates (update.js): what GitHub has, and what she's doing about it
let updateInfo = null;
let updateBusy = null;    // 'checking' or 'applying'
let updateError = null;
let updateAt = 0;         // when she last looked
// the watcher only speaks when something changes: the overlay asks for this when it (re)loads
let lastWindows = null;
let chatModels = null; // the provider's models, as last seen (null: not reached)
let chatError = null;  // why not, when the provider said
let chatErrorCode = null; // 'nokey' or 'nourl': what her setup should ask for
// Ollama's cloud, as last seen: your account ({ name } or { signin }) and the models free with it
let cloud = { at: 0, account: null, free: [] };
const chats = new Map(); // id -> AbortController of an answer being streamed
// her messages to your phone (phone.js): the pairing she waits for, why the last try failed
let phonePair = null; // { code, link, until, abort } until `/start <code>` comes
let phoneError = null;
const phoneLimit = phone.limiter();
// her chat on Telegram (below syncPhoneChat)
let phoneListener = null;  // AbortController of the bot being listened to
let phoneOpen = null;      // unlocked: { until, last } (till when, and your last message)
let phoneFails = 0;        // wrong codes in a row
let phoneAwaySeen = false; // you were away from the PC since it was unlocked
let phoneMuted = 0;        // till when her messages wait ("quiet for an hour", a button under one)
let totpDraft = null;      // { secret, wrong }: the code being set up in Mainframe
let phoneQueue = Promise.resolve(); // your messages, answered one after the other
const phoneTurns = new Map(); // id -> done(answer): her answers being written by the overlay
const phoneReplies = phone.limiter(20);

const userSoundsDir = () => path.join(app.getPath('userData'), 'sounds');

// What went wrong, in capri.log next to her settings: the last ~200 KB, the same error once a minute
const logFile = () => path.join(app.getPath('userData'), 'capri.log');
const logged = new Map(); // line -> when it was last written
function logError(line) {
  const now = Date.now();
  if (now - (logged.get(line) || 0) < 60000) return;
  logged.set(line, now);
  if (logged.size > 200) logged.delete(logged.keys().next().value);
  try {
    if ((fs.statSync(logFile(), { throwIfNoEntry: false })?.size || 0) > 200 * 1024) fs.renameSync(logFile(), `${logFile()}.old`);
    fs.appendFileSync(logFile(), `${new Date().toISOString()} ${line}\n`);
  } catch {} // a log that can't be written stops nothing
}

// Her memory of your chats, across restarts: { history: [{ role, content }], claude: Claude Code's session }
const memoryFile = () => path.join(app.getPath('userData'), 'memory.json');
function readMemory() {
  try {
    return JSON.parse(fs.readFileSync(memoryFile(), 'utf8'));
  } catch {
    return {};
  }
}
function saveMemory(patch) {
  try {
    fs.writeFileSync(memoryFile(), JSON.stringify({ ...readMemory(), ...patch }));
  } catch (err) {
    console.error('[capri] could not save her memory:', err.message);
  }
}
function forgetChats() {
  llm.resetAgents();
  saveMemory({ history: [], claude: null, codex: null });
  if (mind?.write('forgot', Date.now())) mindSave(); // on all your PCs
  sendCommand('forget');
}

// capri://app/...        -> files of this repo
// capri://usersounds/... -> the user's own sound overrides
function serveProtocol() {
  protocol.handle('capri', (request) => {
    const url = new URL(request.url);
    const base = url.host === 'usersounds' ? userSoundsDir() : ROOT;
    const target = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (target !== base && !target.startsWith(base + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

// Your screens. In --dev with CAPRI_SCREENS=2 and only one screen, it's cut in two halves side by
// side, to try her going from one to the other without a second monitor.
function displays() {
  const real = screen.getAllDisplays();
  if (!DEV || process.env.CAPRI_SCREENS !== '2' || real.length > 1) return real;
  const d = screen.getPrimaryDisplay();
  const half = (r, i) => ({ x: r.x + Math.floor(r.width / 2) * i, y: r.y, width: Math.floor(r.width / 2), height: r.height });
  return [0, 1].map((i) => ({ ...d, id: d.id * 10 + i + 1, bounds: half(d.bounds, i), workArea: half(d.workArea, i), size: { width: Math.floor(d.size.width / 2), height: d.size.height } }));
}

// The screen a point (DIP) is on, else the nearest one.
function displayAt(p) {
  const all = displays();
  const inside = all.find(({ bounds: b }) => p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height);
  if (inside) return inside;
  const near = screen.getDisplayNearestPoint(p);
  return all.find((d) => d.id === near.id) || all[0];
}

function targetDisplay() {
  const { displayId } = config.load();
  const all = displays();
  return all.find((d) => d.id === displayId) || all.find((d) => d.id === screen.getPrimaryDisplay().id) || all[0];
}

// Her window over to another screen (she's on her way there, screens.js). Set twice: going to a
// screen with another scale, Windows resizes the window once it lands there.
function moveOverlay(id) {
  if (!displays().some((d) => d.id === id)) return null;
  config.save({ displayId: id });
  fitOverlay();
  const { area } = overlayArea();
  overlay.setBounds(area);
  windowWatch?.refresh();
  rebuildTray();
  return area;
}

// Ctrl+Alt+C by default, or what was picked in her menu (null: none). On a Polish keyboard
// Ctrl+Alt+C is AltGr+C, "ć": taken by her, it can't be typed anymore.
const STOW_KEYS = ['Control+Alt+C', 'Control+Alt+H', 'Control+Shift+F12'];
let stowKey = null; // the one registered
function registerStowKey(accelerator = config.load().stowKey) {
  if (stowKey) globalShortcut.unregister(stowKey);
  stowKey = null;
  if (!accelerator) return true;
  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, () => toggleVisible());
  } catch {
    ok = false; // not something Electron can register
  }
  if (ok) stowKey = accelerator;
  return ok;
}

// A new one from her menu or her panel: kept only if Windows lets her have it; the old one back otherwise.
function setStowKey(accelerator) {
  const before = config.load().stowKey;
  if (accelerator && !registerStowKey(accelerator)) {
    registerStowKey(before);
    return { ok: false, error: 'taken' };
  }
  if (!accelerator) registerStowKey(null);
  updateConfig({ stowKey: accelerator || null });
  return { ok: true };
}

// Her window: the work area, or the whole screen while she rests on the taskbar (her legs hang
// over it), less its top row of pixels: a window on top covering the whole screen is a fullscreen
// app to Windows (animated wallpapers pause, notifications wait). `gap`: how much of her window is
// below the top of the taskbar (0, or its height). Sitting on the taskbar while she rests in her
// corner, her window goes down over it too, or her legs would be cut off at its top (less the
// screen's last row of pixels, for the same reason).
let onTaskbar = false; // she sits on the taskbar (the overlay says so)
function overlayArea() {
  const { workArea, bounds } = targetDisplay();
  let area = workArea;
  if (config.load().rest === 'taskbar') area = { ...bounds, y: bounds.y + 1, height: bounds.height - 1 };
  else if (onTaskbar) area = { ...workArea, height: bounds.y + bounds.height - workArea.y - 1 };
  return { area, gap: area.y + area.height - (workArea.y + workArea.height) };
}

function fitOverlay() {
  if (!overlay) return;
  const { area, gap } = overlayArea();
  overlay.setBounds(area);
  overlay.webContents.send('overlay:resize', { width: area.width, height: area.height, gap });
}

// The pointer reaches her click-through window through a mouse hook, and Windows drops a hook that
// doesn't answer in time without a word (waking from sleep, a locked screen, a stall): she can't be
// clicked anymore. Off then on puts in a new one; her place on top and her size are set again too.
function rearmOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setIgnoreMouseEvents(false);
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  fitOverlay();
  sendCommand('rearmed'); // click-through again: she waits for the pointer to be on her
  console.log('[capri] mouse hook set up again');
}

// Back on top of everything, the taskbar included (it comes up over her when it's clicked). Twice:
// the taskbar can come up again a moment later, as its menus and previews open.
function raiseOverlay() {
  for (const wait of [0, 400]) {
    setTimeout(() => {
      if (!overlay || overlay.isDestroyed()) return;
      overlay.setAlwaysOnTop(true, 'screen-saver');
      overlay.moveTop();
    }, wait);
  }
}

function createOverlay() {
  overlay = new BrowserWindow({
    ...overlayArea().area,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadURL('capri://app/src/renderer/index.html');
  // always shown: put away, she's still there as her biochip in the corner. Sized again first:
  // Windows keeps a new window inside the work area, and resting on the taskbar it covers it too.
  overlay.once('ready-to-show', () => {
    fitOverlay();
    overlay.showInactive();
  });
  overlay.webContents.on('render-process-gone', (_e, details) => {
    console.error('[capri] renderer gone:', details.reason);
    logError(`[renderer gone] ${details.reason}`);
  });
  // what her overlay says: on the console in dev, and its errors in capri.log too (an installed
  // Capri has no console: that's where to look when something of hers does nothing)
  overlay.webContents.on('console-message', (e) => {
    const { level, message, lineNumber, sourceId } = e;
    const line = `[renderer:${level}] ${message} (${String(sourceId).split('/').pop()}:${lineNumber})`;
    if (DEV) console.log(line);
    if (level === 'error') logError(line);
  });
  if (DEV && process.env.CAPRI_DEVTOOLS) overlay.webContents.openDevTools({ mode: 'detach' });
}

function sendCommand(name, payload = {}) {
  overlay?.webContents.send('capri:command', { name, ...payload });
}

// Ctrl+Alt+C: she folds herself away into her biochip in the corner, or comes back out of it.
function toggleVisible(force) {
  const visible = typeof force === 'boolean' ? force : !config.load().visible;
  config.save({ visible });
  sendCommand('stow', { on: !visible });
  rebuildTray();
}

function playDemo() {
  clearTimeout(demoTimer);
  const steps = demoSteps(resolveLang(config.load().lang)); // in her language
  let i = 0;
  const next = () => {
    if (i >= steps.length) return;
    const [delay, evt] = steps[i++];
    demoTimer = setTimeout(() => {
      overlay?.webContents.send('claude:event', evt);
      next();
    }, delay);
  };
  next();
}

// During the demo, a little fake terminal for her to sit on and take over (window tracking is
// Windows only, so only there). Opened without stealing focus; closing it drops her off it.
let demoWin = null;
const DEMO_TERMINAL = `<body style="margin:0;background:#14101c;color:#8f8aa3;font:13px/1.7 Consolas,monospace;padding:14px 18px">
<div style="color:#36ff7a">PS C:\\night-city-api&gt; npm test -- gigs</div>
<div>&nbsp;&nbsp;GET /gigs</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ returns 20 items per page</div>
<div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ paginates with a cursor</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ rejects a bad cursor</div>
<div>&nbsp;&nbsp;6 passing (212ms)</div><div style="color:#36ff7a">PS C:\\night-city-api&gt; _</div></body>`;

function demoWindow(open) {
  demoWin?.destroy();
  demoWin = null;
  if (!open || process.platform !== 'win32') return false;
  const b = overlay.getBounds();
  demoWin = new BrowserWindow({
    x: Math.round(b.x + b.width * 0.5 - 310), y: Math.round(b.y + b.height * 0.42), width: 620, height: 300,
    show: false, alwaysOnTop: true, title: 'night-city-api — npm test', backgroundColor: '#14101c', autoHideMenuBar: true,
  });
  demoWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(DEMO_TERMINAL)}`);
  demoWin.once('ready-to-show', () => demoWin?.showInactive());
  demoWin.on('closed', () => { demoWin = null; });
  return true;
}

// 'auto' -> the first system language Capri speaks, English otherwise.
function resolveLang(setting) {
  if (LANGS.includes(setting)) return setting;
  const preferred = [...app.getPreferredSystemLanguages(), app.getSystemLocale(), app.getLocale()];
  for (const tag of preferred) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

// What the overlay gets: `lang` is the resolved one, `langSetting` what the user picked.
function rendererConfig() {
  const { apiKeys, telegram, swarm: hiveKeys, ...cfg } = config.load(); // the keys stay here: the overlay only learns which ones are set
  return {
    ...cfg, keys: Object.keys(apiKeys || {}), assistant: activeAssistant().id, lang: resolveLang(cfg.lang), langSetting: cfg.lang,
    floorGap: overlayArea().gap, screens: displays().length, hiveAway: hiveAway !== null,
  };
}

function updateConfig(patch) {
  config.save(patch);
  if (!mindApplying && MIND_KEYS.some((key) => key in patch)) mindCapture();
  if ('rest' in patch) {
    fitOverlay(); // the taskbar in her window or not
    windowWatch?.refresh();
  }
  const cfg = rendererConfig();
  overlay?.webContents.send('capri:config', cfg);
  rebuildTray();
  return cfg;
}

// Her menu's words in her language, with the assistant she watches named for Claude Code.
function trayLabels(cfg = config.load()) {
  const watched = activeAssistant();
  return Object.fromEntries(Object.entries(TRAY[resolveLang(cfg.lang)]).map(([key, value]) =>
    [key, typeof value === 'string' && watched.id !== 'claude' ? value.replaceAll('Claude Code', watched.name) : value]));
}

// a screen picked in Mainframe: she goes there herself, as from her menu
function pickScreen(id) {
  if (displays().some((d) => d.id === id) && id !== targetDisplay().id) sendCommand('goScreen', { id });
}

// the coding assistant she watches (a new one: she says hello and offers to plug herself in), or none
function pickWatch(id) {
  if (id === 'none') {
    updateConfig({ claude: false });
    return;
  }
  if (!ASSISTANTS[id]) return;
  const other = activeAssistant().id !== id;
  updateConfig({ claude: true, assistant: id, ...(other && { linked: false, welcomed: false }) });
  if (other) sendCommand('assistantChanged');
}

// only read when she starts: she restarts in the mode picked
function pickRender(render) {
  if (config.load().render === render) return;
  config.save({ render });
  app.relaunch();
  app.exit(0);
}

const SIZES = [['small', 0.45], ['medium', 0.6], ['large', 0.8]];

// How close she is to you (bond.js): STAGES there, 1000 xp is 100 %
function syncLabel(cfg, t) {
  const xp = cfg.bond?.xp || 0;
  const stage = [0, 100, 300, 550, 850].filter((at) => xp >= at).length - 1;
  return t.sync(Math.min(100, Math.floor(xp / 10)), t.stages[stage]);
}

// The reminders she keeps (reminders.js), soonest first: { id, label } with when, as she'd say it
function reminderList(cfg) {
  const when = (at) => {
    const d = new Date(at);
    const sameDay = d.toDateString() === new Date().toDateString();
    return new Intl.DateTimeFormat(resolveLang(cfg.lang), sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
  };
  return [...(cfg.reminders || [])].sort((a, b) => a.at - b.at)
    .map((r) => ({ id: r.id, label: `${when(r.at)} · ${(r.text || '…').slice(0, 50)}` }));
}

const cancelReminder = (id) => updateConfig({ reminders: (config.load().reminders || []).filter((r) => r.id !== id) });

function rebuildTray() {
  mainframe?.refresh();
  if (!tray) return;
  const cfg = config.load();
  const hookState = activeHooks().status();
  const watched = activeAssistant();
  const t = trayLabels(cfg);

  const screens = displays();
  const current = targetDisplay().id;
  const reminders = reminderList(cfg);

  const screenItem = {
    label: t.screen,
    enabled: screens.length > 1,
    submenu: [
      ...screens.map((d, i) => ({
        label: `${i + 1} — ${d.size.width}×${d.size.height}`,
        type: 'radio',
        checked: d.id === current,
        click: () => d.id !== current && sendCommand('goScreen', { id: d.id }), // she goes over there herself
      })),
      { type: 'separator' },
      { label: t.follow, type: 'checkbox', checked: cfg.follow !== false, click: (item) => updateConfig({ follow: item.checked }) },
    ],
  };
  // what she does: first in both menus
  const actions = [
    { label: t.online(PORT), enabled: false },
    { label: syncLabel(cfg, t), enabled: false },
    { type: 'separator' },
    { label: t.teleport, click: () => sendCommand('teleport') },
    { label: t.satellite, click: () => sendCommand('satellite') },
    { label: t.demo, click: playDemo },
    { label: t.help, click: () => sendCommand('welcome') },
    ...(cfg.claude ? [{ label: t.report, click: () => sendCommand('report') }] : []),
    { label: t.talk, click: () => sendCommand('chat') },
    { label: t.lookNow, click: () => sendCommand('look') },
    {
      label: t.reminders,
      submenu: reminders.length
        ? reminders.map((r) => ({ label: r.label, submenu: [{ label: t.cancelReminder, click: () => cancelReminder(r.id) }] }))
        : [{ label: t.noReminders, enabled: false }],
    },
    { label: t.custom, click: () => sendCommand('customize') },
    { label: cfg.visible ? t.hide : t.show, ...(stowKey && { accelerator: stowKey }), click: () => toggleVisible() },
    { type: 'separator' },
  ];
  // the short one: that, her screen, her settings window for all the rest, and quitting
  const menu = Menu.buildFromTemplate(cfg.menu === 'compact' ? [
    ...actions,
    screenItem,
    { label: t.settings, click: () => mainframe.open() },
    { type: 'separator' },
    { label: t.quit, click: () => app.quit() },
  ] : [
    ...actions,
    { label: t.settings, click: () => mainframe.open() },
    {
      label: t.size,
      submenu: SIZES.map(([size, scale]) => [t[size], scale]).map(([label, scale]) => ({
        label, type: 'radio', checked: Math.abs(cfg.scale - scale) < 0.01, click: () => updateConfig({ scale }),
      })),
    },
    {
      label: t.sound,
      submenu: [
        { label: t.mute, type: 'checkbox', checked: cfg.muted, click: (item) => updateConfig({ muted: item.checked }) },
        { type: 'separator' },
        {
          label: t.soundsDir,
          click: () => {
            fs.mkdirSync(userSoundsDir(), { recursive: true });
            shell.openPath(userSoundsDir());
          },
        },
      ],
    },
    screenItem,
    // the key that puts her away and brings her back: one of these, one you press in her panel, or none
    {
      label: t.stowKey,
      submenu: [
        ...[...new Set([...STOW_KEYS, ...(cfg.stowKey ? [cfg.stowKey] : [])])].map((key) => ({
          label: keyLabel(key), type: 'radio', checked: cfg.stowKey === key, click: () => setStowKey(key),
        })),
        { label: t.stowKeyOff, type: 'radio', checked: !cfg.stowKey, click: () => setStowKey(null) },
        { type: 'separator' },
        { label: t.stowKeyCustom, click: () => sendCommand('stowKey') },
      ],
    },
    {
      label: t.chatModel,
      submenu: [
        { label: t.aiSetup, click: () => sendCommand('setupChat') },
        { type: 'separator' },
        ...Object.entries(llm.PROVIDERS).map(([provider, p]) => ({
          label: p.label, type: 'radio', checked: cfg.provider === provider, click: () => pickProvider(provider),
        })),
        { type: 'separator' },
        ...(chatModels?.length
          ? chatModels.map((name) => ({
            label: cloud.free.includes(name) ? `${name} · ${t.cloudFree}` : name,
            type: 'radio', checked: name === pickModel(cfg), click: () => updateConfig({ chatModel: name }),
          }))
          : [{ label: (chatError || t.noOllama).slice(0, 80), enabled: false }]),
        // Ollama's free cloud models when you're signed in to it, fetched on the click (it takes a second)
        ...(cfg.provider === 'ollama' && chatModels ? [
          ...cloud.free.filter((name) => !chatModels.includes(name)).map((name) => ({
            label: `${name} · ${t.cloudFree}`, type: 'radio', checked: false, click: () => fetchModel(name).catch(() => rebuildTray()),
          })),
          ...(cloud.account?.signin ? [{ label: t.cloudSignin, click: signInToOllama }] : []),
        ] : []),
        { type: 'separator' },
        ...(llm.isAgent(cfg.provider) ? [
          { label: `${agentName(cfg)}: ${cfg.claudeCwd || app.getPath('home')}`, click: pickClaudeFolder },
          {
            label: `${agentName(cfg)} permissions`,
            submenu: llm.CLAUDE_MODES.map((mode) => ({
              label: cfg.provider === 'codex' ? llm.CODEX_SANDBOX[mode] : mode,
              type: 'radio', checked: cfg.claudeMode === mode, click: () => updateConfig({ claudeMode: mode }),
            })),
          },
          ...(cfg.provider === 'codex' ? [{
            label: t.effort,
            submenu: llm.CODEX_EFFORTS.map((effort) => ({
              label: effort, type: 'radio', checked: cfg.codexEffort === effort, click: () => updateConfig({ codexEffort: effort }),
            })),
          }] : []),
          { label: t.agentPowers, type: 'checkbox', checked: Boolean(cfg.agentPowers), click: (item) => updateConfig({ agentPowers: item.checked }) },
        ] : []),
        { label: t.forget, click: forgetChats },
        // the key (or the address) of the one picked, pasted in her panel
        { label: t.apiKey, click: () => sendCommand('setupKey') },
      ],
    },
    { label: t.wander, type: 'checkbox', checked: cfg.wander, click: (item) => updateConfig({ wander: item.checked }) },
    { label: t.possess, type: 'checkbox', checked: cfg.possess, click: (item) => updateConfig({ possess: item.checked }) },
    { label: t.jealous, type: 'checkbox', checked: cfg.jealous !== false, click: (item) => updateConfig({ jealous: item.checked }) },
    { label: t.pcReact, type: 'checkbox', checked: cfg.pcReact !== false, click: (item) => updateConfig({ pcReact: item.checked }) },
    {
      // she asks first (what she'll send where), then turns it on herself
      label: t.lookAuto, type: 'checkbox', checked: Boolean(cfg.watchScreen),
      click: (item) => {
        sendCommand('watchScreen', { on: item.checked });
        rebuildTray(); // as it is until she's asked
      },
    },
    {
      label: t.rest,
      submenu: [['corner', t.restCorner], ['taskbar', t.restTaskbar]].map(([rest, label]) => ({
        label, type: 'radio', checked: cfg.rest === rest, click: () => updateConfig({ rest }),
      })),
    },
    {
      label: t.watch,
      submenu: [
        ...Object.entries(ASSISTANTS).map(([id, { name }]) => ({
          label: name, type: 'radio', checked: cfg.claude && watched.id === id, click: () => pickWatch(id),
        })),
        { label: t.watchNone, type: 'radio', checked: !cfg.claude, click: () => pickWatch('none') },
      ],
    },
    {
      label: t.motion,
      submenu: [['auto', t.motionAuto], ['full', t.motionFull], ['reduced', t.motionReduced]].map(([motion, label]) => ({
        label, type: 'radio', checked: cfg.motion === motion, click: () => updateConfig({ motion, motionAsked: true }),
      })),
    },
    {
      label: t.display,
      submenu: [['auto', t.displayAuto], ['gl', t.displayGl], ['software', t.displaySoftware]].map(([render, label]) => ({
        label, type: 'radio', checked: cfg.render === render, click: () => pickRender(render),
      })),
    },
    {
      label: t.lang,
      submenu: [[t.auto, 'auto'], ...LANGS.map((lang) => [TRAY[lang].name, lang])].map(([label, lang]) => ({
        label, type: 'radio', checked: cfg.lang === lang, click: () => updateConfig({ lang }),
      })),
    },
    {
      label: t.startup,
      type: 'checkbox',
      checked: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
      click: (item) => app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: item.checked }),
    },
    {
      label: t.menuMode,
      submenu: [['full', t.menuFull], ['compact', t.menuCompact]].map(([mode, label]) => ({
        label, type: 'radio', checked: (cfg.menu || 'full') === mode, click: () => updateConfig({ menu: mode }),
      })),
    },
    // her hooks, while she watches Claude Code
    ...(cfg.claude ? [
      { type: 'separator' },
      hookState.installed
        ? { label: t.hooksOn, enabled: false }
        : { label: t.hooksOff, click: () => runHooks('install') },
      ...(hookState.installed ? [{ label: t.hooksRemove, click: () => runHooks('uninstall') }] : []),
    ] : []),
    { type: 'separator' },
    { label: t.quit, click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  trayMenu = menu;
}

// What her settings window shows (renderer/js/mainframe.js): her menu's choices, with what's picked.
function mainframeState() {
  const cfg = config.load();
  const t = trayLabels(cfg);
  const agent = llm.isAgent(cfg.provider);
  const current = targetDisplay().id;
  return {
    version: app.getVersion(),
    lang: resolveLang(cfg.lang),
    t: Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === 'string')),
    brain: {
      provider: cfg.provider,
      providers: Object.entries(llm.PROVIDERS).map(([id, p]) => ({ id, label: p.label })),
      model: pickModel(cfg),
      // with Ollama's free cloud models when you're signed in to it (fetched when picked)
      models: [...(chatModels || []), ...(cfg.provider === 'ollama' && chatModels ? cloud.free.filter((name) => !chatModels.includes(name)) : [])]
        .map((name) => ({ id: name, label: cloud.free.includes(name) ? `${name} · ${t.cloudFree}` : name })),
      signin: cfg.provider === 'ollama' && Boolean(cloud.account?.signin),
      showModel: cfg.chatShowModel !== false,
      showNote: cfg.chatShowNote !== false,
      error: chatModels?.length ? null : (chatError || t.noOllama),
      where: agent ? `${t.agentIn} ${cfg.claudeCwd || app.getPath('home')}` : llm.isLocal(cfg.provider, cfg, pickModel(cfg)) ? t.local : t.cloud,
      agent: agent && {
        name: agentName(cfg),
        cwd: cfg.claudeCwd || app.getPath('home'),
        mode: cfg.claudeMode,
        modes: llm.CLAUDE_MODES.map((id) => ({ id, label: cfg.provider === 'codex' ? llm.CODEX_SANDBOX[id] : id })),
        powers: Boolean(cfg.agentPowers),
        effort: cfg.provider === 'codex' ? cfg.codexEffort : null,
        efforts: llm.CODEX_EFFORTS.map((id) => ({ id, label: id })),
      },
    },
    capri: {
      visible: cfg.visible,
      size: SIZES.find(([, scale]) => Math.abs(cfg.scale - scale) < 0.01)?.[0] || null,
      wander: cfg.wander,
      possess: cfg.possess,
      muted: cfg.muted,
      rest: cfg.rest,
      stowKey: cfg.stowKey,
      stowKeys: [...new Set([...STOW_KEYS, ...(cfg.stowKey ? [cfg.stowKey] : [])])].map((id) => ({ id, label: keyLabel(id) })),
      screen: current,
      screens: displays().map((d, i) => ({ id: d.id, label: `${i + 1} — ${d.size.width}×${d.size.height}` })),
      follow: cfg.follow !== false,
      jealous: cfg.jealous !== false,
      pcReact: cfg.pcReact !== false,
      lookAuto: Boolean(cfg.watchScreen),
      sync: syncLabel(cfg, t),
      reminders: reminderList(cfg),
    },
    watch: {
      id: cfg.claude ? activeAssistant().id : 'none',
      assistants: Object.entries(ASSISTANTS).map(([id, { name }]) => ({ id, label: name })),
      hooks: cfg.claude ? activeHooks().status().installed : null,
    },
    phone: {
      // held by another of your PCs (her swarm): your messages go out from there
      elsewhere: (() => {
        const holder = phoneHolder(cfg);
        return holder && holder !== 'here' ? t.phoneElsewhere(holder.name) : null;
      })(),
      bot: cfg.telegram?.bot || null,
      linked: cfg.telegram?.chat ? cfg.telegram.name : null,
      pairing: phonePair?.code || null,
      error: phoneError && (t[`phoneErr${phoneError[0].toUpperCase()}${phoneError.slice(1)}`] || phoneError),
      on: Boolean(cfg.phoneOn),
      away: String(cfg.phoneAway ?? 5),
      detail: cfg.phoneDetail === 'quote' ? 'quote' : 'line',
      // her chat on Telegram: the code from your authenticator app, set up here
      totp: Boolean(cfg.telegram?.totp),
      draft: totpDraft && { qr: totpDraft.qr, key: totpDraft.secret.match(/.{1,4}/g).join(' ') },
      draftError: totpDraft?.wrong ? t.phoneErrTotp : null,
      chat: Boolean(cfg.phoneChat),
      lockout: cfg.phoneLockout ? t.phoneErrLockout : null,
      hours: String(phoneHours(cfg)),
      open: phoneOpen ? t.phoneOpenUntil(phoneTime(phoneOpen.until, cfg)) : null,
    },
    update: updateState(cfg, t),
    swarm: {
      on: Boolean(cfg.swarmOn),
      name: hiveName(cfg),
      tailscale: hiveTailscale?.ip || null,
      tailscaleState: hiveTailscale ? hiveTailscale.state : 'missing',
      invite: hiveInvite && hive?.state().pairing ? hiveInvite.text : null, // until it's used, cancelled or runs out
      error: hiveError && (t[`swarmErr${hiveError[0].toUpperCase()}${hiveError.slice(1)}`] || hiveError),
      peers: hive ? hive.state().peers.map((p) => ({
        id: p.id, name: p.name,
        status: [p.active ? t.swarmHere : !p.online ? t.swarmOffline : p.locked ? t.swarmLocked : t.swarmOnline,
          p.version && p.version !== app.getVersion() ? `v${p.version}` : ''].filter(Boolean).join(' · '), // another version: shown
      })) : (cfg.swarm?.peers || []).map((p) => ({ id: p.id, name: p.name, status: t.swarmOff })),
      here: hive ? hive.state().here : true,
      found: hiveFound.map(({ host, port, name, version }) => ({ id: `${host}:${port}`, name, version })),
      update: cfg.swarmUpdate !== false,
    },
    system: {
      lang: cfg.lang,
      langs: [['auto', t.auto], ...LANGS.map((lang) => [lang, TRAY[lang].name])].map(([id, label]) => ({ id, label })),
      motion: cfg.motion,
      render: cfg.render,
      startup: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
      menu: cfg.menu || 'full',
    },
  };
}

// What her settings window asks for: the same as her menu's items, each value checked first.
async function mainframeAct(name, value) {
  const one = (list) => list.includes(value);
  switch (name) {
    case 'provider': if (llm.PROVIDERS[value]) await pickProvider(value); break;
    case 'model':
      if (chatModels?.includes(value)) updateConfig({ chatModel: value });
      else if (config.load().provider === 'ollama' && cloud.free.includes(value)) await fetchModel(value).catch(() => rebuildTray());
      break;
    case 'cloudSignin': signInToOllama(); break;
    case 'chatShowModel': case 'chatShowNote': updateConfig({ [name]: Boolean(value) }); break;
    case 'refresh': await refreshModels(); rebuildTray(); break;
    case 'aiSetup': sendCommand('setupChat'); break;
    case 'apiKey': sendCommand('setupKey'); break;
    case 'forget': forgetChats(); break;
    case 'folder': await pickClaudeFolder(); break;
    case 'mode': if (one(llm.CLAUDE_MODES)) updateConfig({ claudeMode: value }); break;
    case 'agentPowers': updateConfig({ agentPowers: Boolean(value) }); break;
    case 'effort': if (one(llm.CODEX_EFFORTS)) updateConfig({ codexEffort: value }); break;
    case 'visible': toggleVisible(); break;
    case 'teleport': sendCommand('teleport'); break;
    case 'talk': sendCommand('chat'); break;
    case 'custom': sendCommand('customize'); break;
    case 'help': sendCommand('welcome'); break;
    case 'size': { const size = SIZES.find(([id]) => id === value); if (size) updateConfig({ scale: size[1] }); break; }
    case 'wander': case 'possess': case 'muted': case 'follow': case 'jealous': case 'pcReact': updateConfig({ [name]: Boolean(value) }); break;
    case 'lookNow': sendCommand('look'); break;
    case 'lookAuto': sendCommand('watchScreen', { on: Boolean(value) }); break; // she asks first, then turns it on herself
    case 'cancelReminder': cancelReminder(value); break;
    case 'rest': if (one(['corner', 'taskbar'])) updateConfig({ rest: value }); break;
    case 'stowKey': if (value === null || STOW_KEYS.includes(value) || value === config.load().stowKey) setStowKey(value); break;
    case 'stowKeyCustom': sendCommand('stowKey'); break;
    case 'screen': pickScreen(Number(value)); break;
    case 'watch': pickWatch(String(value)); break;
    case 'hooks': if (one(['install', 'uninstall'])) runHooks(value); break;
    case 'lang': if (value === 'auto' || LANGS.includes(value)) updateConfig({ lang: value }); break;
    case 'motion': if (one(['auto', 'full', 'reduced'])) updateConfig({ motion: value, motionAsked: true }); break;
    case 'render': if (one(['auto', 'gl', 'software'])) pickRender(value); break;
    case 'startup': app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: Boolean(value) }); rebuildTray(); break;
    case 'menu': if (one(['full', 'compact'])) updateConfig({ menu: value }); break;
    case 'phoneToken': if (typeof value === 'string') await phoneSetToken(value); break;
    case 'phoneBotFather': shell.openExternal('https://t.me/BotFather'); break;
    case 'phoneOpenChat': if (phonePair) shell.openExternal(phonePair.link); break;
    case 'phonePair': startPairing(); break;
    case 'phoneOn': updateConfig({ phoneOn: Boolean(value) && Boolean(config.load().telegram?.chat) }); break;
    case 'phoneAway': if (one(['0', '5', '15'])) updateConfig({ phoneAway: Number(value) }); break;
    case 'phoneDetail': if (one(['line', 'quote'])) updateConfig({ phoneDetail: value }); break;
    case 'phoneTest': await phoneSend(trayLabels().phoneTestText, { always: true }); break;
    case 'phoneForget':
      stopPairing();
      phoneError = null;
      totpDraft = null;
      updateConfig({ telegram: null, phoneOn: false, phoneChat: false, phoneLockout: false });
      break;
    case 'phoneTotpSet': {
      const { telegram } = config.load();
      if (!telegram?.chat) break;
      const secret = totp.secret();
      totpDraft = { secret, qr: totp.qr(totp.link(secret, telegram.bot)) };
      break;
    }
    case 'phoneTotpCancel': totpDraft = null; break;
    case 'phoneTotpCheck': if (typeof value === 'string') checkTotpDraft(value); break;
    case 'phoneTotpRemove': updateConfig({ telegram: { ...config.load().telegram, totp: null }, phoneChat: false }); break;
    case 'phoneChat':
      phoneFails = 0;
      updateConfig({ phoneChat: Boolean(value) && Boolean(config.load().telegram?.totp), phoneLockout: false });
      break;
    case 'phoneHours': if (one(['1', '4', '8'])) updateConfig({ phoneUnlockHours: Number(value) }); break;
    case 'phoneLock': phoneLock('phoneBotLockedNow'); break;
    case 'updateCheckNow': await checkUpdate(); break;
    case 'updateApply': applyUpdate(); break; // she restarts when it's done
    case 'updateCheck': case 'updateAuto': updateConfig({ [name]: Boolean(value) }); break;
    case 'swarmOn': updateConfig({ swarmOn: Boolean(value) }); await syncHive(); await hiveLook(); break;
    case 'swarmName': if (typeof value === 'string' && value.trim()) { updateConfig({ swarmName: value.trim().slice(0, 40) }); await syncHive(true); } break;
    case 'swarmInvite': hiveInviteNew(); break;
    case 'swarmInviteCancel': hive?.stopPairing(); hiveInvite = null; break;
    case 'swarmJoin': if (typeof value === 'string') await hiveJoin(value); break;
    case 'swarmLook': await hiveLook(); break;
    case 'swarmJoinTailnet': if (typeof value === 'string') await hiveJoinTailnet(value); break;
    case 'swarmUpdate': updateConfig({ swarmUpdate: Boolean(value) }); break;
    case 'swarmRemove': if (typeof value === 'string') await hive?.remove(value); break;
    case 'tailscaleGet': shell.openExternal('https://tailscale.com/download/windows'); break;
    case 'tailscaleCheck': await syncHive(); break;
    case 'quit': app.quit(); break;
    default: break;
  }
  syncPhoneChat(); // her chat on Telegram may have been turned on or off
}

// The code from your authenticator app, being set up: its secret shown once (QR code and text), and
// kept, sealed, only when the app's code checks out (so the app has it right)
function checkTotpDraft(typed) {
  const cfg = config.load();
  if (!totpDraft || !cfg.telegram?.chat) return;
  const step = totp.check(totpDraft.secret, typed);
  if (step === null) {
    totpDraft.wrong = true;
    return;
  }
  phoneFails = 0;
  // `step`: the last code that worked, kept across restarts (that one doesn't unlock her chat too)
  updateConfig({ telegram: { ...cfg.telegram, totp: setup.sealKey(totpDraft.secret), step }, phoneChat: true, phoneLockout: false });
  totpDraft = null;
}

// Her bot on Telegram (phone.js), set up in Mainframe: its token checked with Telegram, then sealed
// like her API keys, and a pairing code to send it from your phone.
const phoneToken = (cfg = config.load()) => setup.openKey(cfg.telegram?.token);

async function phoneSetToken(value) {
  stopPairing();
  phoneError = null;
  const token = value.trim();
  try {
    const { username } = await phone.bot(token);
    updateConfig({ telegram: { token: setup.sealKey(token), bot: username }, phoneOn: false, phoneChat: false });
    startPairing();
  } catch (err) {
    phoneError = err.message;
  }
}

function stopPairing() {
  phonePair?.abort.abort();
  phonePair = null;
}

function startPairing() {
  const cfg = config.load();
  if (!cfg.telegram?.bot) return;
  stopPairing();
  phoneError = null;
  const pair = { ...phone.pairing(cfg.telegram.bot), abort: new AbortController() };
  phonePair = pair;
  phone.waitForPair(phoneToken(cfg), pair.code, pair.abort.signal).then((who) => {
    if (phonePair !== pair) return;
    phonePair = null;
    // another phone may have paired: her chat there starts locked, and off until you turn it on again
    phoneLock();
    updateConfig({ telegram: { ...config.load().telegram, ...who, totp: null }, phoneOn: true, phoneChat: false });
    phoneSend(trayLabels().phoneLinked, { always: true });
  }, (err) => {
    if (phonePair !== pair) return;
    phonePair = null;
    if (err.message !== 'stopped') phoneError = err.message;
    mainframe?.refresh();
  });
  mainframe?.refresh();
}

// You're away from this PC: its screen locked, or no key or mouse for `phoneAway` minutes (0: always)
// You're away: from this PC (its screen locked, or no key or mouse for `phoneAway` minutes; 0: always),
// and from every other one of yours in her swarm, as they last said
function phoneAway(cfg = config.load()) {
  const minutes = Number(cfg.phoneAway ?? 5);
  if (!minutes) return true;
  return lastUse() >= minutes * 60;
}

// Seconds since you last used any of your PCs (a locked one isn't in use): this one, and the others in
// her swarm that answer
function lastUse() {
  const mine = hiveHere();
  const all = [mine.locked ? Infinity : mine.idle];
  for (const p of hive?.state().peers || []) if (p.online && !p.locked && Number.isFinite(p.idle)) all.push(p.idle);
  return Math.min(...all);
}

// Your phone in her swarm: the PC that holds it (its Telegram bot paired there), 'here', or null (none).
// Two PCs paired with the same bot: the one with the lower id holds it while it answers (the bot can be
// read from one place only), the other takes over when it's gone. A PC without one sends to it.
function phoneHolder(cfg = config.load()) {
  const mine = cfg.telegram?.chat ? cfg.telegram.bot : null;
  const state = hive?.state();
  const others = (state?.peers || []).filter((p) => p.online && p.phone).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (mine) return others.find((p) => p.phone === mine && p.id < state?.me.id) || 'here';
  return others[0] || null;
}

// For your phone: sent from here (if this PC holds it, and you're away from all of them), else handed to
// the PC that does (`from`: the PC it came from, for its name next to the project)
async function phoneNote(note, from = null) {
  const cfg = config.load();
  const holder = phoneHolder(cfg);
  if (holder && holder !== 'here') return from ? false : hive.phone(holder.id, note);
  if (!holder || !cfg.phoneOn || !phoneAway(cfg) || Date.now() < phoneMuted) return false;
  const project = [note.project, from && !String(note.project || '').includes(from.name) ? from.name : ''].filter(Boolean).join(' · ');
  return phoneSend(phone.compose({ line: note.line, project, quote: note.quote }, cfg.phoneDetail), { buttons: true });
}

// To your phone, if it's paired and her messages are on (`always`: Mainframe's own, on or off), a few
// a minute at most
async function phoneSend(text, { always = false, buttons = false } = {}) {
  const cfg = config.load();
  if (!cfg.telegram?.chat || (!always && !cfg.phoneOn) || !phoneLimit(text)) return false;
  try {
    // under it, while she listens to the bot: "remind me in 30 min", "quiet for an hour"
    const t = trayLabels(cfg);
    const under = buttons && phoneListener ? { buttons: [[{ text: t.phoneLater, data: 'later' }, { text: t.phoneMute, data: 'mute' }]] } : {};
    await phone.send(phoneToken(cfg), cfg.telegram.chat, text, under);
    if (phoneError) mainframe?.refresh();
    phoneError = null;
    return true;
  } catch (err) {
    phoneError = err.message;
    mainframe?.refresh();
    return false;
  }
}

// --- Her chat on Telegram --------------------------------------------------------------------------
// Turned on in Mainframe once the code from your authenticator app checks out: the bot then listens
// to your one paired chat, nobody else's. `/unlock 123456` opens her chat for a few hours; before
// that and after, nothing you send reaches her. It locks again when you're back at the PC, after an
// hour of silence, or with `/lock`; three wrong codes turn it off until you turn it on again here.
// Her chat from there is the one on your desktop, the same memory, without her powers, and Claude
// Code or Codex only read (chat:send). Buttons under her messages need no code: they run nothing.

const PHONE_FAILS = 3;
const PHONE_QUIET_MS = 60 * 60 * 1000;
const PHONE_ANSWER_MS = 6 * 60 * 1000;
const PHONE_LATER_MS = 30 * 60 * 1000;

const phoneHours = (cfg = config.load()) => ([1, 4, 8].includes(cfg.phoneUnlockHours) ? cfg.phoneUnlockHours : 8);
const phoneTime = (at, cfg = config.load()) => new Date(at).toLocaleTimeString(resolveLang(cfg.lang), { hour: '2-digit', minute: '2-digit' });

// listening to the bot while her chat there is on (and not while a new pairing waits for its code)
function syncPhoneChat() {
  const cfg = config.load();
  const want = Boolean(cfg.phoneChat && cfg.telegram?.chat && cfg.telegram?.totp) && !phonePair && phoneHolder(cfg) === 'here';
  if (want && !phoneListener) {
    const listener = new AbortController();
    phoneListener = listener;
    const t = trayLabels(cfg);
    const token = phoneToken(cfg);
    phone.commands(token, [['unlock', t.phoneCmdUnlock], ['lock', t.phoneCmdLock]]);
    phone.listen(token, onPhoneUpdate, listener.signal, (err) => {
      if (!(err instanceof phone.PhoneError)) console.error('[capri] her chat on Telegram:', err.message);
      else if (['badToken', 'conflict'].includes(err.message)) {
        phoneError = err.message;
        mainframe?.refresh();
      }
    }).finally(() => {
      if (phoneListener === listener) phoneListener = null;
    });
  } else if (!want && phoneListener) {
    phoneListener.abort();
    phoneListener = null;
    phoneLock();
  }
}

// Locked again (`why`: what she tells your phone, if anything); an answer on its way stays here.
function phoneLock(why = null) {
  if (!phoneOpen) return;
  phoneOpen = null;
  phoneAwaySeen = false;
  for (const id of phoneTurns.keys()) chats.get(id)?.abort();
  mainframe?.refresh();
  if (why) phoneReply(trayLabels()[why]);
}

// what she says back on Telegram (her chat's answers have their own way: sendLong)
async function phoneReply(text) {
  const cfg = config.load();
  if (!cfg.telegram?.chat || !text || !phoneReplies(text)) return;
  await phone.send(phoneToken(cfg), cfg.telegram.chat, text).catch(() => {});
}

// Every 5 seconds while it's unlocked: the time it was opened for, an hour of silence, and you at the
// PC again after being away (a key or the mouse; the screen unlocked is seen at once, at startup)
function watchPhone() {
  setInterval(() => {
    if (!phoneOpen) return;
    const now = Date.now();
    if (now > phoneOpen.until) return phoneLock('phoneBotExpired');
    if (now - phoneOpen.last > PHONE_QUIET_MS) return phoneLock('phoneBotQuiet');
    const idle = lastUse(); // any of your PCs
    if (idle >= 120) phoneAwaySeen = true;
    else if (phoneAwaySeen && idle < 10) phoneLock('phoneBotBack');
  }, 5000);
}

// What comes to the bot. Only from you, in your chat with it: anything else is not even answered.
async function onPhoneUpdate(update) {
  const cfg = config.load();
  if (!cfg.telegram?.chat || !cfg.phoneChat) return;
  const said = phone.fromOwner(update, cfg.telegram);
  if (!said) return;
  const t = trayLabels(cfg);
  const token = phoneToken(cfg);
  if (said.press) {
    if (said.data === 'mute') {
      phoneMuted = Date.now() + 60 * 60 * 1000;
      return phone.answered(token, said.press, t.phoneMuted(phoneTime(phoneMuted, cfg)));
    }
    if (said.data === 'later' && said.text) {
      setTimeout(() => phoneSend(said.text, { buttons: true }), PHONE_LATER_MS);
      return phone.answered(token, said.press, t.phoneLaterSet);
    }
    return phone.answered(token, said.press);
  }
  if (said.command === 'unlock') return phoneUnlock(said.rest, said.message);
  if (said.command === 'lock') return phoneOpen ? phoneLock('phoneBotLockedNow') : phoneReply(t.phoneBotLockedNow);
  if (!phoneOpen) return phoneReply(`${t.phoneBotLocked}\n${t.phoneBotHelp}`);
  if (said.command) return phoneReply(t.phoneBotHelp);
  if (!said.text) return phoneReply(t.phoneBotTextOnly);
  phoneOpen.last = Date.now();
  phoneQueue = phoneQueue.then(() => phoneAnswer(said.text)).catch(() => {});
}

async function phoneUnlock(typed, message) {
  const cfg = config.load();
  const t = trayLabels(cfg);
  phone.unsend(phoneToken(cfg), cfg.telegram.chat, message); // the code doesn't stay in the chat
  const step = totp.check(setup.openKey(cfg.telegram.totp), typed, { after: cfg.telegram.step ?? -1 }); // a code works once
  if (step === null) {
    phoneFails += 1;
    if (phoneFails < PHONE_FAILS) return phoneReply(t.phoneBotWrong(phoneFails, PHONE_FAILS));
    // three in a row: off until you turn it on again at the PC
    phoneLock();
    updateConfig({ phoneChat: false, phoneLockout: true });
    syncPhoneChat();
    mainframe?.refresh();
    return phoneReply(t.phoneBotOff);
  }
  phoneFails = 0;
  updateConfig({ telegram: { ...cfg.telegram, step } });
  phoneOpen = { until: Date.now() + phoneHours(cfg) * 60 * 60 * 1000, last: Date.now() };
  phoneAwaySeen = false;
  mainframe?.refresh();
  return phoneReply(t.phoneBotUnlocked(phoneTime(phoneOpen.until, cfg)));
}

// Your message to her chat (chat.js fromPhone, in the overlay), and her answer back to your phone
async function phoneAnswer(text) {
  const cfg = config.load();
  if (!phoneOpen || !overlay || !cfg.telegram?.chat) return;
  const t = trayLabels(cfg);
  const token = phoneToken(cfg);
  const id = `phone-${randomUUID()}`;
  phone.typing(token, cfg.telegram.chat);
  const typing = setInterval(() => phone.typing(token, cfg.telegram.chat), 4500);
  try {
    const answer = await new Promise((resolve) => {
      phoneTurns.set(id, resolve);
      overlay.webContents.send('phone:chat', { id, text });
      setTimeout(() => {
        chats.get(id)?.abort();
        resolve({ ok: false, error: 'timeout' });
      }, PHONE_ANSWER_MS);
    });
    if (!phoneOpen) return; // locked meanwhile: what she says stays here
    await phone.sendLong(token, cfg.telegram.chat, answer.ok ? answer.text : t.phoneBotFailed(answer.error)).catch(() => {});
  } finally {
    clearInterval(typing);
    phoneTurns.delete(id);
  }
}

// "Control+Alt+C" as people write it: "Ctrl+Alt+C"
const keyLabel = (accelerator) => accelerator.replace(/\bControl\b/g, 'Ctrl').replace(/\bSuper\b/g, 'Win');

// Run from a clone (`npm start`), electron.exe alone would open the default Electron app at login:
// it needs the project folder as argument.
function loginItemOptions() {
  return app.isPackaged ? {} : { path: process.execPath, args: [ROOT] };
}

// From the tray, she says how it went; from her welcome panel (quiet), the panel does.
function runHooks(action, { quiet = false } = {}) {
  let outcome;
  try {
    const result = action === 'install' ? activeHooks().install() : activeHooks().uninstall();
    outcome = { action, ok: true, file: result.file };
  } catch (err) {
    outcome = { action, ok: false, error: err.message };
  }
  if (!quiet) sendCommand('hooks', outcome);
  rebuildTray();
  return outcome;
}

// The model she talks with: the one picked in her menu if it's still installed, else the first one
// on this PC (a cloud model only once you pick it).
function pickModel(cfg = config.load()) {
  if (!chatModels?.length) return null;
  if (chatModels.includes(cfg.chatModel)) return cfg.chatModel;
  return chatModels.find((m) => !ollama.isCloud(m)) || chatModels[0];
}

async function refreshModels() {
  const cfg = config.load();
  chatError = null;
  chatErrorCode = null;
  chatModels = await llm.models(cfg.provider, llmConfig(cfg)).catch((err) => {
    chatError = err.message;
    chatErrorCode = err.code || null;
    return null;
  });
  rebuildTray();
  if (cfg.provider === 'ollama' && chatModels) refreshCloud(); // in the background: it asks ollama.com
  return chatModels;
}

// Whether you're signed in to Ollama, and its free cloud models if so. Once a minute at most.
let cloudCheck = null; // the look under way
function refreshCloud(force = false) {
  if (!force && Date.now() - cloud.at < 60000) return cloudCheck || Promise.resolve(cloud);
  const at = Date.now();
  cloud.at = at;
  cloudCheck = (async () => {
    const account = await ollama.account();
    const free = account?.name ? await ollama.freeModels() : [];
    cloud = { at, account, free };
    rebuildTray();
    return cloud;
  })().finally(() => { cloudCheck = null; });
  return cloudCheck;
}

// A model fetched with Ollama (a cloud one is only a small file), then her chat on it.
async function fetchModel(name, onProgress, signal) {
  await setup.pullModel(name, onProgress, signal);
  updateConfig({ provider: 'ollama' });
  await refreshModels();
  const model = chatModels?.find((m) => m === name || m.startsWith(`${name}:`));
  if (model) updateConfig({ chatModel: model });
  return model;
}

// The page that links this PC to your Ollama account, then a look every few seconds until you're in.
async function signInToOllama() {
  if (!cloud.account?.signin) return;
  shell.openExternal(cloud.account.signin);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    if ((await refreshCloud(true)).account?.name) return;
  }
}

// Her answer from the model picked, or from the next one when that one can't: too busy twice in a row
// (Gemini's "high demand", an Ollama cloud model out of free use), not served anymore (an older model
// closed to new keys), or signed out of Ollama. A model on this PC first. The model that answered is
// kept for next time.
async function chatWithFallback(cfg, messages, send, signal, streamed) {
  let model = pickModel(cfg);
  const tried = new Set();
  let busy = 0;
  for (;;) {
    try {
      const text = await llm.chat(cfg.provider, llmConfig(cfg), { model, messages }, send, signal);
      if (model !== pickModel(cfg)) updateConfig({ chatModel: model });
      return text;
    } catch (err) {
      if (signal.aborted || streamed() || !['busy', 'gone', 'signin'].includes(err.code)) throw err;
      if (err.code === 'busy' && busy++ === 0) {
        await new Promise((r) => setTimeout(r, 1500)); // usually gone a moment later
        continue;
      }
      tried.add(model);
      const next = chatModels?.find((m) => !tried.has(m) && !ollama.isCloud(m)) || chatModels?.find((m) => !tried.has(m));
      if (!next || tried.size >= 3) throw err;
      model = next;
      busy = 0;
    }
  }
}

// No network, and her brain is online (Codex, Claude Code, a provider with a key, an Ollama cloud
// model): it can't answer. CAPRI_OFFLINE=1 in --dev: as if the network were gone.
function brainCut(cfg = config.load()) {
  const online = net.isOnline() && !(DEV && process.env.CAPRI_OFFLINE === '1');
  return !online && !llm.isLocal(cfg.provider, cfg, pickModel(cfg) || cfg.chatModel);
}

// A model on this PC to think with meanwhile: Ollama's first one that isn't in its cloud (Ollama woken
// up if it's installed but asleep). null without one.
async function localModel() {
  let list = await ollama.models().catch(() => null);
  if (!list && (await setup.ollamaState()).installed && (await setup.startOllama()).ok) list = await ollama.models().catch(() => null);
  return list?.find((m) => !ollama.isCloud(m)) || null;
}

// The network gone with her brain online: the model on this PC loaded right away, so her first answer
// doesn't wait for it (a few seconds' look; Electron says nothing when the network goes).
let wasCut = false;
function watchBrain() {
  setInterval(async () => {
    const cut = brainCut();
    if (cut && !wasCut) {
      const model = await localModel();
      if (model) ollama.warm(model);
    }
    wasCut = cut;
  }, 5000);
}

// She looks at your screen (look.js): a picture of the screen she's on, kept here in memory a moment
// for her AI to look at, never written anywhere. 1280 px wide at most: enough to read, light to send.
const snaps = new Map(); // id -> the picture, base64 JPEG
async function snapScreen() {
  const d = targetDisplay();
  const k = d.scaleFactor || 1;
  const fit = Math.min(1, 1280 / (d.bounds.width * k));
  const size = { width: Math.round(d.bounds.width * k * fit), height: Math.round(d.bounds.height * k * fit) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const src = sources.find((s) => s.display_id === String(d.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) throw new Error('no picture of the screen');
  return src.thumbnail.toJPEG(72).toString('base64');
}

// What her AI says about that picture, as her (`persona`), asked `prompt`. With a code when it can't:
// 'noai' (nothing to ask), 'novision' (that model can't look at pictures).
async function sayAboutSnap({ id, persona, prompt, history = [] }) {
  const image = snaps.get(id);
  snaps.delete(id);
  if (!image) return { ok: false, error: 'the picture is gone' };
  const cfg = config.load();
  if (!chatModels?.length) await refreshModels();
  const model = pickModel(cfg);
  if (!model) return { ok: false, code: 'noai' };
  if (llm.isAgent(cfg.provider)) return { ok: false, code: 'novision', model: agentName(cfg) }; // Claude Code or Codex: text only
  if (cfg.provider === 'ollama' && !(await ollama.canSee(model))) return { ok: false, code: 'novision', model };
  const user = cfg.provider === 'ollama'
    ? { role: 'user', content: prompt, images: [image] }
    : { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } }] };
  // asked in her chat: the conversation so far comes before it (text only)
  const before = (Array.isArray(history) ? history : []).filter((m) => typeof m?.content === 'string' && ['user', 'assistant'].includes(m.role));
  const messages = [{ role: 'system', content: persona }, ...before, user];
  for (let attempt = 0; ; attempt++) {
    try {
      const text = await llm.chat(cfg.provider, llmConfig(cfg), { model, messages }, () => {}, AbortSignal.timeout(120000));
      return { ok: true, text, model };
    } catch (err) {
      if (err.code === 'busy' && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const novision = /image|vision|multimodal|modalit|image_url|content.*(part|type)/i.test(err.message);
      return { ok: false, error: err.message, code: novision ? 'novision' : err.code || null, model };
    }
  }
}

async function pickProvider(provider) {
  updateConfig({ provider });
  await refreshModels();
  if (chatErrorCode) sendCommand('setupKey'); // it needs a key or an address: she asks for it
}

// What llm.js gets: the config with its keys opened (they're kept encrypted, setup.js)
function llmConfig(cfg = config.load()) {
  return { ...cfg, apiKeys: setup.openKeys(cfg.apiKeys) };
}

const agentName = (cfg) => (cfg.provider === 'codex' ? 'Codex' : 'Claude Code');

async function pickClaudeFolder() {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: config.load().claudeCwd || app.getPath('home') });
  if (canceled || !filePaths[0]) return;
  llm.resetAgents(); // a new folder, a new Claude Code or Codex conversation (hers goes on)
  saveMemory({ claude: null, codex: null });
  updateConfig({ claudeCwd: filePaths[0] });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icons', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Capri');
  tray.on('click', () => sendCommand('status'));
  rebuildTray();
}

function registerIpc() {
  ipcMain.on('overlay:interactive', (_e, on) => {
    overlay?.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.on('overlay:rearm', () => rearmOverlay()); // the pointer moved over her and she never heard of it
  ipcMain.handle('overlay:cursor', () => {
    const p = screen.getCursorScreenPoint();
    const b = overlay.getBounds();
    const inside = p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height;
    return { x: p.x - b.x, y: p.y - b.y, inside, display: displayAt(p).id };
  });
  // your screens (their bounds), the one she's on, and where her window is
  ipcMain.handle('screens:list', () => {
    const o = overlay.getBounds();
    return {
      current: targetDisplay().id,
      origin: { x: o.x, y: o.y },
      list: displays().map(({ id, bounds: b }) => ({ id, x: b.x, y: b.y, w: b.width, h: b.height })),
    };
  });
  ipcMain.handle('screens:move', async (_e, id) => {
    const area = moveOverlay(id);
    if (!area) return null;
    await new Promise((r) => setTimeout(r, 60));
    overlay.setBounds(area); // again, once Windows has settled it on its new screen
    const o = overlay.getBounds();
    return { origin: { x: o.x, y: o.y }, width: o.width, height: o.height, gap: overlayArea().gap };
  });
  ipcMain.handle('config:get', () => rendererConfig());
  // she sat down on the taskbar, or got up: her window over it, or back to the work area
  ipcMain.on('overlay:taskbar', (_e, on) => {
    if (Boolean(on) === onTaskbar) return;
    onTaskbar = Boolean(on);
    if (config.load().rest === 'taskbar') return; // her window covers it already
    fitOverlay();
    if (onTaskbar) raiseOverlay(); // over the taskbar, not under it
  });
  // her panel taking a new key: hers isn't listened for meanwhile (pressing it there just records it)
  ipcMain.on('stowKey:pause', (_e, on) => registerStowKey(on ? null : config.load().stowKey));
  ipcMain.handle('stowKey:set', (_e, accelerator) => setStowKey(typeof accelerator === 'string' ? accelerator : null));
  ipcMain.handle('hooks:status', () => activeHooks().status());
  ipcMain.handle('config:set', (_e, patch) => updateConfig(patch));
  ipcMain.handle('demo:window', (_e, open) => demoWindow(open));
  // right-clicking her: the same menu as the tray icon (which Windows often hides behind the ^ by the clock)
  ipcMain.on('menu:open', () => trayMenu?.popup({ window: overlay }));
  // her welcome panel's buttons
  ipcMain.handle('hooks:install', () => runHooks('install', { quiet: true }));
  ipcMain.handle('claude:found', () => fs.existsSync(path.dirname(activeHooks().status().file))); // Claude Code keeps its settings there
  ipcMain.on('claude:help', () => shell.openExternal(activeAssistant().help));
  ipcMain.handle('windows:get', () => lastWindows);
  // talking to her (chat.js): is Ollama there, with a model to talk with
  ipcMain.handle('chat:status', async () => {
    const cfg = config.load(true); // keys may have been edited by hand
    const { provider } = cfg;
    const models = await refreshModels();
    // no network and her brain lives online: her chat opens anyway, a model on this PC answers (chat:send)
    if (!models && brainCut(cfg)) {
      return { ok: true, provider, model: cfg.chatModel, agent: llm.isAgent(provider), powers: !llm.isAgent(provider) || Boolean(cfg.agentPowers), local: false, warmup: false };
    }
    if (!models) return { ok: false, error: chatError || 'offline', code: chatErrorCode, provider };
    if (!models.length) return { ok: false, error: 'nomodel', provider };
    const model = pickModel();
    llm.warm(provider, model); // loading while you type your first message
    const local = llm.isLocal(provider, cfg, model);
    return { ok: true, provider, model, agent: llm.isAgent(provider), powers: !llm.isAgent(provider) || Boolean(cfg.agentPowers), local, warmup: provider === 'ollama' && local };
  });
  // her answer, streamed to the overlay piece by piece as `chat:delta`
  // `local`: a model on this PC to answer with instead (her brain online, and no network: see brainCut)
  ipcMain.handle('chat:send', async (_e, { id, messages, local = null }) => {
    const abort = new AbortController();
    chats.set(id, abort);
    let streamed = false;
    // from your phone: Claude Code or Codex only read, whatever Mainframe says for the desktop
    const cfg = phoneTurns.has(id) ? { ...config.load(), claudeMode: 'default', readOnly: true } : config.load();
    try {
      const send = (text) => {
        streamed = true;
        overlay?.webContents.send('chat:delta', { id, text });
      };
      if (local) {
        if (local !== (await localModel())) return { ok: false, error: 'no local model', code: 'offline' };
        return { ok: true, text: await llm.chat('ollama', llmConfig(cfg), { model: local, messages }, send, abort.signal), local };
      }
      if (brainCut(cfg)) return { ok: false, error: 'offline', code: 'offline', local: await localModel() };
      const text = await chatWithFallback(cfg, messages, send, abort.signal, () => streamed);
      if (llm.isAgent(cfg.provider)) saveMemory(llm.agentMemory());
      return { ok: true, text };
    } catch (err) {
      // the network went in the middle of it
      if (!abort.signal.aborted && !streamed && !local && brainCut(cfg)) return { ok: false, error: 'offline', code: 'offline', local: await localModel() };
      return { ok: false, error: abort.signal.aborted ? 'stopped' : err.message, code: err.code || null };
    } finally {
      chats.delete(id);
    }
  });
  ipcMain.on('chat:stop', (_e, id) => chats.get(id)?.abort());
  // she looks at your screen (look.js): the picture first, then what her AI says about it
  ipcMain.handle('look:snap', async () => {
    try {
      const id = randomUUID();
      snaps.set(id, await snapScreen());
      setTimeout(() => snaps.delete(id), 120000);
      return { ok: true, id };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('look:say', (_e, request) => sayAboutSnap(request || {}));
  // how hard the processor works, in %, since the last time she asked (pc.js)
  let cpuBefore = null;
  ipcMain.handle('pc:cpu', () => {
    const now = os.cpus().map(({ times: t }) => ({ idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq }));
    const before = cpuBefore;
    cpuBefore = now;
    if (!before) return null;
    let idle = 0, total = 0;
    now.forEach((c, i) => {
      idle += c.idle - (before[i]?.idle || 0);
      total += c.total - (before[i]?.total || 0);
    });
    return total > 0 ? Math.round(100 * (1 - idle / total)) : null;
  });
  // where her AI runs, for what she tells you before she looks: { local, provider, model }
  ipcMain.handle('look:where', () => {
    const cfg = config.load();
    const model = pickModel(cfg);
    const provider = cfg.provider === 'ollama' && ollama.isCloud(model) ? 'Ollama' : llm.PROVIDERS[cfg.provider]?.label || cfg.provider;
    return { local: llm.isLocal(cfg.provider, cfg, model), provider, model };
  });
  ipcMain.handle('chat:memory', () => readMemory().history || []);
  ipcMain.on('chat:remember', (_e, history) => {
    if (!Array.isArray(history)) return;
    saveMemory({ history });
    mindCapture();
  });
  ipcMain.on('chat:ollama', () => shell.openExternal(OLLAMA_SITE));
  // something worth telling you about (brain.js), sent to your phone only while you're away
  ipcMain.handle('phone:notify', (_e, note) => {
    const text = (key) => (typeof note?.[key] === 'string' ? note[key] : '');
    return phoneNote({ line: text('line'), project: text('project'), quote: text('quote') });
  });
  // her answer to a message from your phone (chat.js fromPhone)
  ipcMain.on('phone:answer', (_e, answer) => {
    const done = phoneTurns.get(answer?.id);
    if (done) done({ ok: Boolean(answer.ok), text: String(answer.text || ''), error: String(answer.error || '') });
  });
  // setting her up with buttons (setup.js): Ollama and a model, or a key, or an address
  const progress = (payload) => overlay?.webContents.send('setup:progress', payload);
  let pulling = null; // AbortController of the model being fetched
  ipcMain.handle('setup:info', async () => {
    // the free cloud models too, when Ollama is up and you're signed in to it
    const { free } = (await ollama.models().catch(() => null)) ? await refreshCloud() : { free: [] };
    return { models: setup.MODELS, cloud: free, ram: os.totalmem(), keyed: Object.keys(setup.KEY_PAGES) };
  });
  ipcMain.handle('setup:ollama', () => setup.ollamaState());
  ipcMain.handle('setup:install', () => setup.installOllama((line) => progress({ kind: 'install', line })));
  ipcMain.handle('setup:start', async () => {
    const res = await setup.startOllama();
    await refreshModels();
    return res;
  });
  ipcMain.handle('setup:pull', async (_e, name) => {
    if (!setup.MODELS.some((m) => m.name === name) && !cloud.free.includes(name)) return { ok: false, error: 'unknown model' };
    pulling?.abort();
    const abort = new AbortController();
    pulling = abort;
    try {
      const model = await fetchModel(name, (p) => progress({ kind: 'pull', ...p }), abort.signal);
      return { ok: true, model };
    } catch (err) {
      return { ok: false, error: abort.signal.aborted ? 'stopped' : err.message };
    } finally {
      if (pulling === abort) pulling = null;
    }
  });
  ipcMain.on('setup:cancel', () => pulling?.abort());
  // who answers her chat, with its key or address if it needs one: saved, tried, and undone if it fails
  ipcMain.handle('setup:use', async (_e, { provider, key, url }) => {
    if (!llm.PROVIDERS[provider]) return { ok: false, error: 'unknown provider' };
    const before = config.load();
    const patch = { provider };
    if (key) patch.apiKeys = { ...before.apiKeys, [provider]: setup.sealKey(String(key).trim()) };
    if (url) patch.customUrl = String(url).trim();
    updateConfig(patch);
    const models = await refreshModels();
    if (models?.length) return { ok: true, model: pickModel() };
    const error = models ? 'no model' : chatError || 'offline';
    updateConfig({ provider: before.provider, apiKeys: before.apiKeys, customUrl: before.customUrl });
    await refreshModels();
    return { ok: false, error };
  });
  ipcMain.on('setup:keyPage', (_e, provider) => setup.KEY_PAGES[provider] && shell.openExternal(setup.KEY_PAGES[provider]));
  ipcMain.handle('setup:launch', (_e, integration) => setup.launchThroughOllama(integration));
  // closing an app you asked her to close, once you've clicked to confirm (apps.js)
  const appInfo = (app) => app && { name: app.process, label: app.label };
  ipcMain.handle('apps:list', async () => (await apps.list().catch(() => [])).map(appInfo));
  ipcMain.handle('apps:find', async (_e, wanted) => appInfo(await apps.find(wanted).catch(() => null)));
  ipcMain.handle('apps:close', (_e, { name, force }) => apps.close(name, { force }).catch((err) => ({ error: err.message })));
  // opening things you ask her to (launch.js): an app or a game, your music, a website
  ipcMain.handle('apps:findLaunch', async (_e, text) => {
    const item = await launch.find(String(text || '')).catch(() => null);
    return item && { ...item, risky: launch.risky(item) }; // a program or a script: behind a button
  });
  ipcMain.handle('apps:youtube', (_e, query) => launch.youtube(query).catch(() => null));
  ipcMain.handle('apps:roblox', (_e, query) => launch.roblox(query).catch(() => null));
  // your files (files.js): a search, opening what it found, a screenshot, a search on the web
  ipcMain.handle('files:search', (_e, query) => files.search(query).catch(() => []));
  ipcMain.handle('files:open', (_e, { file, reveal }) => files.open(String(file), { reveal: Boolean(reveal) }).then(() => true, () => false));
  ipcMain.handle('files:screenshot', () => files.screenshot(targetDisplay()).catch(() => null));
  ipcMain.handle('web:search', (_e, query) => {
    const q = String(query || '').trim().slice(0, 300);
    if (!q) return false;
    return shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(q)}`).then(() => true, () => false);
  });
  ipcMain.handle('apps:launch', (_e, item) => launch.launch(item).then(() => ({ ok: true }), (err) => ({ ok: false, error: err.message })));
  ipcMain.handle('apps:media', (_e, action) => launch.media(action));
  ipcMain.handle('apps:music', (_e, query) => launch.music(query).catch(() => false));
  ipcMain.handle('apps:site', (_e, address) => launch.site(address).catch(() => false));
  // typing to her: the overlay takes the keyboard while the chat is open, and gives it back after
  ipcMain.on('overlay:focus', (_e, on) => {
    if (!overlay) return;
    overlay.setFocusable(Boolean(on));
    if (on) overlay.focus();
    else overlay.blur();
  });
  // her report card's copy button: a picture of that part of the overlay, on the clipboard
  ipcMain.handle('panel:copy', async (_e, rect) => {
    const image = await overlay.webContents.capturePage(rect);
    if (image.isEmpty()) return false;
    const png = new Blob([image.toPNG()], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  });
  // her guide: where her tray icon is (it lives in the taskbar, off the overlay, hence overlay
  // coordinates past its edge), and the corner by the clock in case Windows hid it behind the ^
  ipcMain.handle('guide:tray', () => {
    const o = overlay.getBounds();
    const d = targetDisplay().bounds;
    const b = tray?.getBounds();
    const icon = b && b.width > 0 ? { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height } : null;
    const corner = { x: d.x + d.width - 150 - o.x, y: d.y + d.height - 44 - o.y, w: 140, h: 40 };
    return { icon, corner };
  });
  // her guide: Claude Code's folder (~/.claude) in Explorer, its settings file selected
  ipcMain.handle('guide:claudeFolder', () => {
    const file = activeHooks().status().file;
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) return { found: false, dir };
    if (fs.existsSync(file)) shell.showItemInFolder(file);
    else shell.openPath(dir);
    return { found: true, dir, file: fs.existsSync(file), label: fs.existsSync(file) ? path.basename(file) : path.basename(dir) };
  });
  ipcMain.handle('sounds:list', () => {
    try {
      return fs.readdirSync(userSoundsDir())
        .filter((f) => SOUND_EXT.test(f))
        .map((f) => ({ name: f.replace(SOUND_EXT, '').toLowerCase(), url: `capri://usersounds/${encodeURIComponent(f)}` }));
    } catch {
      return [];
    }
  });
}

// Only in --dev: lets scripts drive the overlay and grab frames of it (no desktop content, just our window).
const testWins = new Map(); // name -> test window

// --- Her updates ------------------------------------------------------------------------------------
// Installed with install.ps1, she's a git clone: she looks at her branch on GitHub (her `origin`) a
// minute after starting and every 6 hours, tells you once about a new version, and updates herself
// when you click (or, if you said so, once you've been away a quarter of an hour). A developer's clone
// (--dev) is only told: they pull themselves.

const UPDATE_EVERY = 6 * 60 * 60 * 1000;
// her packages failed after the last update and she's back where she was (update-finish.js says so
// once, to this start only: not to the next one)
const updateRolledBack = process.env.CAPRI_UPDATE_FAILED === '1';
delete process.env.CAPRI_UPDATE_FAILED;
const updateLocked = () => DEV && process.env.CAPRI_UPDATE_DEV !== '1';

async function checkUpdate() {
  if (app.isPackaged || updateBusy) return updateInfo;
  updateBusy = 'checking';
  mainframe?.refresh();
  try {
    updateInfo = await update.check(ROOT);
    updateAt = Date.now();
    updateError = null;
  } catch (err) {
    updateError = err.output || err.message;
  }
  updateBusy = null;
  // a new version: she says so once (per version)
  if (updateInfo?.state === 'behind' && updateInfo.theirs !== config.load().updateTold) {
    updateConfig({ updateTold: updateInfo.theirs });
    sendCommand('updateFound', { version: updateInfo.version || '' });
  }
  mainframe?.refresh();
  return updateInfo;
}

async function applyUpdate() {
  if (updateBusy || updateLocked()) return;
  const info = await checkUpdate();
  if (info?.state !== 'behind' || update.blocked(info)) return;
  updateBusy = 'applying';
  mainframe?.refresh();
  let done = null;
  try {
    done = await update.apply(ROOT, info);
    updateConfig({ updatedFrom: app.getVersion() });
    // her packages changed: a helper installs them once she's closed, then starts her again
    if (done.install) await update.handOff(ROOT, done.from, [process.execPath, ...process.argv.slice(1)]);
    else app.relaunch();
    app.quit();
  } catch (err) {
    if (done) await update.rollback(ROOT, done.from).catch(() => {});
    updateConfig({ updatedFrom: null });
    updateBusy = null;
    updateError = err.output || err.message;
    mainframe?.refresh();
  }
}

// Another of your PCs (her swarm) runs a newer her: this one looks on GitHub, and updates as soon as
// you're not at it (or not using it for a minute), nothing of hers in the middle of an answer
async function hiveUpgrade() {
  if (!hive || config.load().swarmUpdate === false || app.isPackaged || updateBusy || updateLocked()) return;
  const ahead = hive.state().peers.find((p) => p.online && p.version && update.newer(p.version, app.getVersion()));
  if (!ahead) return;
  if (updateInfo?.state !== 'behind' && Date.now() - updateAt > 10 * 60 * 1000) await checkUpdate();
  if (updateInfo?.state !== 'behind' || update.blocked(updateInfo)) return;
  const quiet = hiveAway !== null || powerMonitor.getSystemIdleTime() >= 60;
  if (quiet && !chats.size && !phoneTurns.size) applyUpdate();
}

// every 10 minutes: time to look again, and (if you said so) to update while you're away
function watchUpdates() {
  const cfg = config.load();
  if (cfg.updatedFrom && !updateRolledBack) setTimeout(() => sendCommand('updated', { version: app.getVersion(), from: cfg.updatedFrom }), 8000);
  if (cfg.updatedFrom) updateConfig({ updatedFrom: null });
  const tick = async () => {
    const now = config.load();
    if (now.updateCheck === false || app.isPackaged) return;
    if (Date.now() - updateAt > UPDATE_EVERY) await checkUpdate();
    const away = ['idle', 'locked'].includes(powerMonitor.getSystemIdleState(15 * 60));
    if (now.updateAuto && away && updateInfo?.state === 'behind' && !update.blocked(updateInfo) && !updateLocked() && !chats.size && !phoneTurns.size) applyUpdate();
  };
  setTimeout(tick, 60000);
  setInterval(tick, 10 * 60 * 1000);
}

// what Mainframe shows of it
function updateState(cfg, t) {
  const info = updateInfo;
  const why = update.blocked(info);
  const note = app.isPackaged ? t.updatePackaged
    : updateBusy === 'checking' ? t.updateChecking
    : updateBusy === 'applying' ? t.updateWorking
    : updateError ? t.updateFailed(updateError)
    : !info ? ''
    : { notGit: t.updateNotGit, offline: t.updateOffline, current: t.updateCurrent, ahead: t.updateAhead }[info.state]
      || t.updateFound(info.version || '?', info.behind);
  return {
    version: app.getVersion(),
    check: cfg.updateCheck !== false,
    auto: Boolean(cfg.updateAuto),
    packaged: app.isPackaged,
    note,
    changes: ['behind', 'diverged'].includes(info?.state) ? info.changes.slice(0, 6).map((c) => c.title) : [],
    // her packages failed the last time: she went back to where she was (update-finish.js)
    why: updateRolledBack && info?.state === 'behind' ? t.updateFailed(t.updateRolledBack)
      : why === 'dirty' ? t.updateWhyDirty : why === 'branch' ? t.updateWhyBranch(info.branch) : why === 'diverged' ? t.updateWhyDiverged
      : info?.state === 'behind' && updateLocked() ? t.updateWhyDev : null,
    can: info?.state === 'behind' && !why && !updateLocked() && !updateBusy,
    remote: info?.remote ? info.remote.replace(/^https:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '') : null,
    at: updateAt ? t.updateChecked(phoneTime(updateAt, cfg)) : null,
  };
}

// --- Her swarm --------------------------------------------------------------------------------------
// One Capri on all your PCs (swarm.js): each one tells the others whether its screen is locked and
// how long since a key or the mouse; she's on the one you're at, put away on the others. A PC alone
// (no network, or the others gone) has her to itself, thinking through Ollama if it must.

const hiveName = (cfg = config.load()) => cfg.swarmName || (DEV && process.env.CAPRI_PROFILE ? `${os.hostname()} (${process.env.CAPRI_PROFILE})` : os.hostname());
const HIVE_PORT = (DEV && Number(process.env.CAPRI_SWARM_PORT)) || swarm.PORT;

// this PC now, for the others: locked, and seconds since a key or the mouse
function hiveHere() {
  const cfg = config.load();
  const phoneHere = cfg.telegram?.chat ? cfg.telegram.bot : null; // your phone paired here (for the others to send to)
  if (hiveFake) return { ...hiveFake, phone: phoneHere };
  return { locked: screenLocked || powerMonitor.getSystemIdleState(1) === 'locked', idle: powerMonitor.getSystemIdleTime(), phone: phoneHere };
}

// her own key, made the first time (sealed like the others)
function hiveIdentity() {
  const cfg = config.load();
  if (cfg.swarm?.id && cfg.swarm.key) return { ...cfg.swarm, key: setup.openKey(cfg.swarm.key) };
  const made = swarm.identity();
  updateConfig({ swarm: { id: made.id, pub: made.pub, key: setup.sealKey(made.key), peers: [] } });
  return made;
}

// Started, stopped or started again (`fresh`: a new name, or Tailscale's address changed)
async function syncHive(fresh = false) {
  const cfg = config.load();
  hiveTailscale = await swarm.tailscale().catch(() => null);
  const hosts = ['127.0.0.1', ...(hiveTailscale?.ip ? [hiveTailscale.ip] : [])];
  const want = Boolean(cfg.swarmOn) && !hiveIsland;
  if (hive && (!want || fresh || hive.hosts.join() !== hosts.join())) {
    hive.stop();
    hive = null;
  }
  if (want && !hive) {
    const id = hiveIdentity();
    const link = swarm.createSwarm({
      me: { id: id.id, pub: id.pub, key: id.key, name: hiveName(), version: app.getVersion() },
      peers: config.load().swarm?.peers || [],
      port: HIVE_PORT,
      hosts,
      here: hiveHere,
      onChange: (state) => hiveMoved(state),
      onPeers: (peers) => updateConfig({ swarm: { ...config.load().swarm, peers } }),
      // what an agent did on the PC you're not at: told here, with that PC's name
      onEvent: (peer, evt) => overlay?.webContents.send('claude:event', { ...evt, remote: true, pc: peer.name }),
      mind: mindOpen(id.id),
      onMind: (keys, peer) => mindApply(keys, peer),
      trust: hiveTrust,
      // a message for your phone from a PC without one: taken if this one holds it
      onPhone: (peer, note) => {
        if (phoneHolder() !== 'here') return false;
        phoneNote(note, peer);
        return true;
      },
      onJoined: (peer) => {
        hiveFound = hiveFound.filter((f) => f.id !== peer.id);
        sendCommand('swarmJoined', { pc: peer.name });
        mainframe?.refresh();
      },
    });
    link.hosts = hosts;
    hive = link;
    if (!(await link.start())) hiveError = 'port';
    else if (hiveError === 'port') hiveError = null;
  }
  if (!want) {
    hiveBack();
    if (!cfg.swarmOn) mindClose();
  }
  mainframe?.refresh();
}

// She went to the PC you're at, or came back here
function hiveMoved(state) {
  const online = state.peers.some((p) => p.online);
  if (!online && !hiveAlone) hiveAlone = { since: Date.now() };
  else if (online && hiveAlone?.since) hiveAlone = { from: hiveAlone.since, at: Date.now() };
  overlay?.webContents.send('capri:config', rendererConfig()); // whether reminders go off here
  if (!state.here && hiveAway === null) {
    const to = state.peers.find((p) => p.active)?.name || '';
    hiveAway = to;
    if (config.load().visible) sendCommand('swarmAway', { to });
  } else if (state.here && hiveAway !== null) {
    hiveBack();
  }
  mainframe?.refresh();
}

function hiveBack() {
  if (hiveAway === null) return;
  const from = hiveAway;
  hiveAway = null;
  if (config.load().visible) sendCommand('swarmBack', { from });
}

// An event of Claude Code or Codex on this PC. You're at another of your PCs: it goes there (only the
// agent she watches here; she's put away, and no phone message leaves from here), else it's hers here.
async function hiveEvent(evt) {
  if (hiveAway !== null && hive && !evt.demo) {
    const watched = activeAssistant().id;
    const source = /^(codex|agy):/.exec(String(evt.session_id || ''))?.[1] || 'claude';
    if (!config.load().claude || source !== watched) return;
    if (await hive.forward({ ...evt, agent: watched })) return;
  }
  const { remote, pc, ...here } = evt; // only her swarm says an event comes from another PC
  overlay?.webContents.send('claude:event', here); // here, or the other PC couldn't be reached
}

// --- Her shared mind ---------------------------------------------------------------------------------
// What one Capri knows on all your PCs (mind.js), while her swarm is on: your chats with her, "forget
// our conversations", your name, how you want her, what you asked her to remember, her reminders and
// how close she is to you. What changes here is written into it; what comes from another PC is put
// back here (her config, her chat's memory) and told to the overlay.

const MIND_KEYS = ['userName', 'persona', 'memories', 'reminders', 'bond'];
const MIND_CHAT = 60; // the messages kept, as her chat keeps them (chat.js KEEP)
const mindFile = () => path.join(app.getPath('userData'), 'mind.json');
const memoKey = (text) => `memo:${createHash('sha1').update(String(text)).digest('hex').slice(0, 16)}`;

function mindOpen(id) {
  if (mind) return mind;
  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(mindFile(), 'utf8'));
  } catch {
    // a first time: what's here is what she knows
  }
  mind = createMind({ me: id, state });
  mindCapture();
  return mind;
}

function mindClose() {
  if (!mind) return;
  clearTimeout(mindSaveTimer);
  mindWrite();
  mind = null;
}

function mindWrite() {
  try {
    fs.writeFileSync(mindFile(), JSON.stringify(mind.state()));
  } catch (err) {
    console.error('[capri] could not save her shared mind:', err.message);
  }
}

function mindSave() {
  clearTimeout(mindSaveTimer);
  mindSaveTimer = setTimeout(() => mind && mindWrite(), 1000);
}

// Her chat's messages, each with an id and a time (older ones, from before: made up once, in their
// order, from when they were saved)
function stampedHistory() {
  const history = Array.isArray(readMemory().history) ? readMemory().history : [];
  if (history.every((m) => m.id && m.at)) return history;
  let saved = Date.now();
  try {
    saved = fs.statSync(memoryFile()).mtimeMs;
  } catch {
    // never saved: now
  }
  const stamped = history.map((m, i) => (m.id && m.at ? m : {
    ...m,
    id: createHash('sha1').update(`${m.role}\n${m.content}`).digest('hex').slice(0, 16),
    at: Math.round(saved - (history.length - i) * 1000),
  }));
  saveMemory({ history: stamped });
  overlay?.webContents.send('chat:history', stamped);
  return stamped;
}

// how close she is to you, from two PCs: the closer, the longer known, the latest day (bond.js has the same)
function bondJoin(a, b) {
  if (!a || !b) return a || b || null;
  const later = (b.last || '') > (a.last || '') ? b : a;
  const ca = a.caps || {};
  const cb = b.caps || {};
  const caps = ca.date === cb.date
    ? Object.fromEntries([...new Set([...Object.keys(ca), ...Object.keys(cb)])].map((k) => [k, k === 'date' ? ca.date : Math.max(ca[k] || 0, cb[k] || 0)]))
    : ((ca.date || '') > (cb.date || '') ? ca : cb);
  return {
    ...a, ...b,
    xp: Math.max(a.xp || 0, b.xp || 0),
    first: [a.first, b.first].filter(Boolean).sort()[0],
    last: later.last,
    days: Math.max(a.days || 0, b.days || 0),
    streak: a.last === b.last ? Math.max(a.streak || 0, b.streak || 0) : later.streak,
    caps,
  };
}

// What's here, into her mind
function mindCapture() {
  if (!mind) return;
  const cfg = config.load();
  let wrote = false;
  const put = (key, value, opts) => { if (mind.write(key, value, opts)) wrote = true; };
  // her chat: each message, unless "forget" came after it, or it's older than the ones she keeps
  const cleared = Number(mind.get('forgot')) || 0;
  const kept = mind.list('chat:').map((e) => e.v?.at || 0).sort((a, b) => b - a);
  const floor = kept.length >= MIND_CHAT ? kept[MIND_CHAT - 1] : 0;
  for (const m of stampedHistory()) {
    if (m.at > cleared && m.at >= floor) put(`chat:${m.id}`, { role: m.role, content: String(m.content).slice(0, 6000), at: m.at });
  }
  // your name and how you want her: empty is a change only once one was set (on any PC)
  if (cfg.userName || mind.get('name') !== undefined) put('name', cfg.userName || '');
  if (cfg.persona || mind.get('persona') !== undefined) put('persona', cfg.persona || '');
  const memos = new Map((cfg.memories || []).map((text) => [memoKey(text), text]));
  for (const [key, text] of memos) put(key, text);
  for (const e of mind.list('memo:')) if (!memos.has(e.key)) put(e.key, null, { del: true });
  const reminders = new Map((cfg.reminders || []).filter((r) => r?.id).map((r) => [`rem:${r.id}`, r]));
  for (const [key, r] of reminders) put(key, r);
  for (const e of mind.list('rem:')) if (!reminders.has(e.key)) put(e.key, null, { del: true });
  if (cfg.bond) put('bond', bondJoin(mind.get('bond'), cfg.bond));
  mind.prune('chat:', MIND_CHAT, (e) => e.v?.at || 0); // the newest messages
  if (wrote) mindSave();
}

// What came from another PC (`keys` of her mind), put back here
function mindApply(keys, peer) {
  if (!mind) return;
  const cfg = config.load();
  const patch = {};
  if (keys.includes('name')) patch.userName = mind.get('name') || '';
  if (keys.includes('persona')) patch.persona = mind.get('persona') || '';
  if (keys.some((k) => k.startsWith('memo:'))) patch.memories = mind.list('memo:').sort((a, b) => a.at - b.at).map((e) => e.v);
  if (keys.some((k) => k.startsWith('rem:'))) patch.reminders = mind.list('rem:').map((e) => e.v).sort((a, b) => a.at - b.at);
  if (keys.includes('bond')) {
    const joined = bondJoin(cfg.bond, mind.get('bond'));
    if (JSON.stringify(joined) !== JSON.stringify(cfg.bond)) patch.bond = joined;
    mind.write('bond', joined); // what this PC adds to it goes back
  }
  if (keys.some((k) => k.startsWith('chat:') || k === 'forgot')) {
    const cleared = Number(mind.get('forgot')) || 0;
    const history = mind.list('chat:').filter((e) => (e.v?.at || 0) > cleared)
      .sort((a, b) => a.v.at - b.v.at || (a.key < b.key ? -1 : 1)).slice(-MIND_CHAT)
      .map((e) => ({ id: e.key.slice(5), role: e.v.role, content: e.v.content, at: e.v.at }));
    if (keys.includes('forgot')) llm.resetAgents(); // "forget" on another PC: the agents' conversations too
    saveMemory({ history });
    overlay?.webContents.send('chat:history', history);
  }
  if (Object.keys(patch).length) {
    mindApplying = true;
    try {
      updateConfig(patch);
    } finally {
      mindApplying = false;
    }
    if (patch.bond) sendCommand('bondSync', { bond: patch.bond });
  }
  mindSave();
  // back from being an island a while (still marked alone, or just back): she says she's caught up
  // (once), where you are
  const alone = !hiveAlone ? 0 : hiveAlone.since ? Date.now() - hiveAlone.since
    : Date.now() - hiveAlone.at < 60000 ? hiveAlone.at - hiveAlone.from : 0;
  if (alone > 60000) {
    hiveAlone = null;
    if (hiveAway === null) sendCommand('hiveRejoined', { pc: peer.name, n: keys.length });
  }
}

function hiveInviteNew() {
  if (!hive) return;
  const address = hiveTailscale?.ip || (DEV ? '127.0.0.1' : null);
  if (!address) {
    hiveError = 'noTailscale';
    return;
  }
  hiveError = null;
  hiveInvite = hive.startPairing(address);
}

// A device at `address` on Tailscale is yours: signed in with the same account as this one (this
// device itself only in --dev, where two Capris share it)
async function hiveTrust(address) {
  const ts = await swarm.tailscale().catch(() => null);
  if (!ts?.ip || ts.user === null || ts.user === undefined) return false;
  if (address === ts.ip) return DEV;
  return ts.peers.some((p) => p.ip === address && p.user === ts.user);
}

// Capris on your other devices on Tailscale (online, same account), not in her swarm yet
async function hiveLook() {
  if (!hive) {
    hiveFound = [];
    return;
  }
  const ts = hiveTailscale?.ip ? await swarm.tailscale().catch(() => null) : null;
  const targets = (ts?.peers || []).filter((p) => p.online && p.ip && p.user === ts.user).map((p) => ({ host: p.ip, port: swarm.PORT }));
  // --dev: other Capris on this PC to look at, "address:port,..."
  if (DEV && process.env.CAPRI_SWARM_LOOK) {
    for (const spot of process.env.CAPRI_SWARM_LOOK.split(',')) {
      const [host, port] = spot.trim().split(/:(?=\d+$)/);
      if (host && Number(port)) targets.push({ host, port: Number(port) });
    }
  }
  hiveFound = await hive.look(targets).catch(() => []);
  mainframe?.refresh();
}

async function hiveJoinTailnet(spot) {
  const found = hiveFound.find((f) => `${f.host}:${f.port}` === spot);
  if (!hive || !found) return;
  hiveError = null;
  try {
    await hive.joinTailnet(found.host, found.port);
    hiveFound = hiveFound.filter((f) => f !== found);
  } catch (err) {
    hiveError = err.message;
  }
}

async function hiveJoin(text) {
  if (!hive) return;
  hiveError = null;
  try {
    await hive.join(text);
  } catch (err) {
    hiveError = err.message;
  }
}

async function debugHandler(route, body) {
  if (!DEV) throw new Error('debug routes need --dev');
  if (route === 'command') {
    sendCommand(body.name, body);
    return { ok: true };
  }
  if (route === 'reload') {
    overlay.webContents.reloadIgnoringCache();
    return { ok: true };
  }
  if (route === 'unhook') {
    // the pointer no longer passed on to her, as when Windows drops the mouse hook
    overlay.setIgnoreMouseEvents(true);
    return { ok: true };
  }
  if (route === 'testwin') {
    // plain windows to sit on, opened without stealing focus, by name (`id`, default "main");
    // each one opened goes in front of the others. { open: false } without an id closes them all.
    const id = body.id ?? 'main';
    if (!body.open && body.id === undefined) {
      for (const win of testWins.values()) win.destroy();
      testWins.clear();
      return { ok: true };
    }
    testWins.get(id)?.destroy();
    testWins.delete(id);
    if (body.open) {
      const b = overlay.getBounds();
      const win = new BrowserWindow({
        x: b.x + (body.x ?? 300), y: b.y + (body.y ?? 380), width: body.w ?? 720, height: body.h ?? 380,
        show: false, alwaysOnTop: true, title: `Capri test window ${id}`, backgroundColor: '#1b1726',
      });
      win.loadURL('data:text/html,<body style="background:%231b1726"></body>');
      win.showInactive();
      testWins.set(id, win);
    }
    return { ok: true };
  }
  if (route === 'movewin' && testWins.has(body.id ?? 'main')) {
    const win = testWins.get(body.id ?? 'main');
    const [x, y] = win.getPosition();
    win.setPosition(x + (body.dx || 0), y + (body.dy || 0));
    return { ok: true };
  }
  if (route === 'mouse') {
    // the pointer moving over the overlay (css px), and clicking if asked, without touching the real one
    const at = { x: Math.round(body.x), y: Math.round(body.y) };
    overlay.webContents.sendInputEvent({ type: 'mouseMove', ...at });
    if (body.click) {
      overlay.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...at });
      overlay.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...at });
    }
    return { ok: true };
  }
  if (route === 'menu') {
    // her menu as labels, and a click on one of them if asked ({ click: 'beam:cloud · ...' })
    const items = (menu) => menu.items.filter((i) => i.label).map((i) => (i.submenu ? { [i.label]: items(i.submenu) } : i.label));
    const find = (menu) => menu.items.reduce((hit, i) => hit || (i.label === body.click ? i : i.submenu && find(i.submenu)), null);
    if (body.click) find(trayMenu)?.click();
    return { ok: true, value: items(trayMenu) };
  }
  if (route === 'swarm') {
    // her swarm: this PC locked or idle as you say ({ locked, idle }, or { real: true }), and what it sees
    if (body.real) hiveFake = null;
    else if ('locked' in body || 'idle' in body) hiveFake = { locked: Boolean(body.locked), idle: Number(body.idle) || 0 };
    if (body.tick) await hive?.tick();
    // no network for this one (an island): her swarm stopped, her mind still kept; and back
    if (body.island === true) {
      hiveIsland = true;
      hiveAlone = { since: Date.now() };
      await syncHive();
    } else if (body.island === false) {
      hiveIsland = false;
      await syncHive();
    }
    return { ok: true, fake: hiveFake, state: hive?.state() || null, away: hiveAway };
  }
  if (route === 'eval') {
    // a look inside the overlay (app.js puts what's there on window.dev in --dev)
    return { ok: true, value: await overlay.webContents.executeJavaScript(String(body.js || 'null')) };
  }
  if (route === 'drag') {
    // a drag over the overlay with a stand-in pointer, the real one untouched: the button goes down
    // at the first point, follows the others (each `ms` after the one before), and comes up at the last
    const points = Array.isArray(body.points) ? body.points : [];
    if (!points.length) throw new Error('drag needs points');
    const at = (p) => ({ x: Math.round(p.x), y: Math.round(p.y) });
    overlay.webContents.sendInputEvent({ type: 'mouseMove', ...at(points[0]) });
    overlay.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...at(points[0]) });
    for (const p of points.slice(1)) {
      await new Promise((r) => setTimeout(r, p.ms ?? 16));
      overlay.webContents.sendInputEvent({ type: 'mouseMove', modifiers: ['leftButtonDown'], ...at(p) });
    }
    if (body.up !== false) overlay.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...at(points.at(-1)) });
    return { ok: true };
  }
  if (route === 'type') {
    // typing into the overlay (her chat), and Enter if asked
    if (body.text) await overlay.webContents.insertText(body.text);
    if (body.enter) {
      overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      overlay.webContents.sendInputEvent({ type: 'char', keyCode: 'Return' });
      overlay.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    }
    return { ok: true };
  }
  if (route === 'key') {
    // a key pressed in the overlay, with its modifiers ({ key: 'H', modifiers: ['control', 'alt'] }),
    // without the keyboard: nothing reaches any other window
    const modifiers = Array.isArray(body.modifiers) ? body.modifiers : [];
    overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: String(body.key), modifiers });
    overlay.webContents.sendInputEvent({ type: 'keyUp', keyCode: String(body.key), modifiers });
    return { ok: true };
  }
  if (route === 'menu') {
    // her tray menu, opened where the pointer is ({ close: true } closes it)
    if (body.close) trayMenu?.closePopup(overlay);
    else trayMenu?.popup({ window: overlay });
    return { ok: true };
  }
  if (route === 'mainframe') {
    // her settings window: opened, asked something as its page would ({ act, value }), captured ({ capture })
    const win = mainframe.open();
    // what its page does itself, run in it ({ js }: a click, as you'd make it), and what that gave
    if (body.js) {
      await new Promise((resolve) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', resolve) : resolve()));
      const value = await win.webContents.executeJavaScript(String(body.js)).catch((err) => `error: ${err.message}`);
      if (!body.capture) return { ok: true, value };
    }
    if (body.act) await mainframeAct(body.act, body.value);
    if (!body.js) mainframe.refresh(); // as its page draws what its click brings back
    if (!body.capture) return { ok: true, state: mainframeState() };
    await new Promise((resolve) => setTimeout(resolve, 800));
    // further down its page ({ scroll: px })
    if (Number.isFinite(body.scroll)) {
      await win.webContents.executeJavaScript(`document.getElementById('sections').scrollTop = ${body.scroll}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const image = await win.webContents.capturePage();
    const file = path.join(ROOT, 'captures', `${String(body.capture).replace(/[^\w-]/g, '')}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    return { ok: true, file };
  }
  if (route === 'capture') {
    const image = await overlay.webContents.capturePage();
    // installed, the app's own folder is read-only: its data folder instead
    const dir = path.join(app.isPackaged ? app.getPath('userData') : ROOT, 'captures');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${(body.name || 'frame').replace(/[^\w-]/g, '')}.png`);
    fs.writeFileSync(file, image.toPNG());
    return { ok: true, file };
  }
  throw new Error('unknown debug route');
}

// How her window is drawn, set before Electron starts (her menu › Display). On some PCs her see-through
// window shows up black (NVIDIA with FXAA, MFAA or HDR on, for one): drawing it through OpenGL, or
// without the graphics card, often fixes it.
function applyRender() {
  const { render } = config.load();
  if (render === 'gl') app.commandLine.appendSwitch('use-angle', 'gl');
  if (render === 'software') {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('enable-unsafe-swiftshader'); // her drawing still needs WebGL, done on the CPU
  }
  // --dev: what Chromium ended up drawing with
  if (DEV) app.whenReady().then(() => setTimeout(() => console.log('[capri] display:', render, JSON.stringify(app.getGPUFeatureStatus())), 4000));
}

function main() {
  // --dev: a second Capri on this PC, with its own settings (to try her swarm with)
  if (DEV && process.env.CAPRI_PROFILE) app.setPath('userData', `${app.getPath('userData')}-${process.env.CAPRI_PROFILE.replace(/\W/g, '')}`);
  applyRender();
  if (DEV && process.env.CAPRI_TELEGRAM_API) phone.useApi(process.env.CAPRI_TELEGRAM_API); // a Telegram of your own, to try her with
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => sendCommand('status'));
  if (process.platform === 'win32') app.setAppUserModelId('capri.desktop');
  process.on('unhandledRejection', (err) => logError(`[main] ${err?.stack || err}`));

  app.whenReady().then(() => {
    if (!['codex', 'claude'].includes(config.load().assistant)) config.save({ assistant: activeAssistant().id });
    serveProtocol();
    registerIpc();
    createOverlay();
    mainframe = createMainframe({ root: ROOT, display: targetDisplay, state: mainframeState, act: mainframeAct });
    createTray();
    windowWatch = startWindowWatch({
      overlay,
      onUpdate: (data) => {
        // a click on the taskbar brings it up over her: sitting on it, her legs would vanish behind it
        if (data.taskbar && !lastWindows?.taskbar && (config.load().rest === 'taskbar' || onTaskbar)) raiseOverlay();
        lastWindows = data;
        overlay?.webContents.send('windows:update', data);
      },
    });
    createBridge({
      port: PORT,
      // her own Claude Code or Codex chat's hooks would cover its answer with theirs
      onEvent: (evt) => !llm.isChatSession(evt.session_id) && hiveEvent(evt),
      onDebug: DEV ? debugHandler : null,
    });
    registerStowKey();
    llm.restoreAgents(readMemory());
    watchBrain();
    watchPhone();
    syncPhoneChat();
    syncHive();
    // Tailscale installed, signed in, or its address changed; your other PCs' Capris on it; a newer her on one of them
    setInterval(async () => {
      if (!config.load().swarmOn) return;
      await syncHive();
      await hiveLook();
      hiveUpgrade();
      syncPhoneChat(); // the PC that holds your phone may have changed
    }, 60000);
    watchUpdates();
    refreshModels(); // for her menu's model list
    setTimeout(() => launch.launchables().catch(() => {}), 20000); // what she can open, before you ask
    // a screen plugged in, unplugged, or rearranged: her window fitted again, and she learns of it
    const screensChanged = () => {
      fitOverlay();
      windowWatch?.refresh();
      rebuildTray();
      sendCommand('screens');
      overlay?.webContents.send('capri:config', rendererConfig()); // how many screens she has
    };
    screen.on('display-metrics-changed', screensChanged);
    screen.on('display-added', screensChanged);
    screen.on('display-removed', screensChanged);
    // after sleep or a locked screen, once Windows has settled
    powerMonitor.on('resume', () => setTimeout(rearmOverlay, 2000));
    powerMonitor.on('lock-screen', () => {
      screenLocked = true;
      hive?.tick(); // the others learn at once that you've left this one
    });
    powerMonitor.on('unlock-screen', () => {
      screenLocked = false;
      hive?.tick();
      setTimeout(rearmOverlay, 1000);
      phoneLock('phoneBotBack'); // you're back at the PC: her chat on Telegram locks
    });
  });

  app.on('will-quit', () => {
    llm.stopAgents();
    stopPairing();
    phoneListener?.abort();
    hive?.stop();
    globalShortcut.unregisterAll();
    windowWatch?.stop();
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}

main();
