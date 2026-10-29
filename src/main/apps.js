'use strict';

// Closing an app when you ask her to (chat.js), after you've confirmed with a click. The apps with
// a window, by name; closing one the way its own close button does (it can still ask you to save),
// and only if you ask again, forcing it. Windows only.

const { execFile } = require('node:child_process');

// never these: the desktop itself, Windows' own pieces, her (Capri), Claude (she watches it) and
// Ollama (she talks through it)
const KEEP = new Set([
  'explorer', 'applicationframehost', 'textinputhost', 'shellexperiencehost', 'startmenuexperiencehost',
  'searchhost', 'searchapp', 'lockapp', 'dwm', 'capri', 'electron', 'claude', 'codex', 'ollama', 'ollama app',
]);

function powershell(script, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`,
    ], { windowsHide: true, timeout }, (err, out) => (err ? reject(err) : resolve(out.trim())));
  });
}

// [{ name, process, ids }]: one per program with a window open ("AM Music", "Discord"...)
async function list() {
  if (process.platform !== 'win32') return [];
  const out = await powershell(
    'Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | '
    + 'ForEach-Object { [pscustomobject]@{ id = $_.Id; name = $_.ProcessName; label = $_.Description } } | '
    + 'ConvertTo-Json -Compress',
  );
  const rows = [].concat(out ? JSON.parse(out) : []);
  const apps = new Map();
  for (const { id, name, label } of rows) {
    if (id === process.pid || KEEP.has(name.toLowerCase())) continue;
    const app = apps.get(name) || { name, process: name, label: label || '', ids: [] };
    app.ids.push(id);
    apps.set(name, app);
  }
  return [...apps.values()];
}

const simple = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// The open app that `wanted` names, by its name or its description ("am music", "YouTube Music").
async function find(wanted) {
  const key = simple(wanted);
  if (key.length < 2) return null;
  const apps = await list();
  const score = (app) => {
    const names = [simple(app.name), simple(app.label)].filter(Boolean);
    if (names.includes(key)) return 3;
    if (names.some((n) => n.startsWith(key) || key.startsWith(n))) return 2;
    if (key.length >= 3 && names.some((n) => n.includes(key) || key.includes(n))) return 1;
    return 0;
  };
  const best = apps.map((app) => [score(app), app]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0])[0];
  return best ? best[1] : null;
}

// Closes it like its close button would; `force` ends it outright (unsaved work is lost).
// Resolves with what's left: { running } (true when it stayed open, or hid in the tray).
async function close(name, { force = false } = {}) {
  const app = (await list()).find((a) => a.process === name);
  if (!app) return { running: false };
  const ids = app.ids.join(',');
  const out = await powershell(force
    ? `Stop-Process -Id ${ids} -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 600; `
      + `@(Get-Process -Id ${ids} -ErrorAction SilentlyContinue).Count`
    : `foreach ($p in @(Get-Process -Id ${ids} -ErrorAction SilentlyContinue)) { [void]$p.CloseMainWindow() }; `
      + 'Start-Sleep -Milliseconds 2500; '
      + `@(Get-Process -Name '${name.replace(/'/g, "''")}' -ErrorAction SilentlyContinue).Count`);
  return { running: Number(out) > 0 };
}

// ---------- finding a window by its name (her chat: "where's Notepad?") ----------

// The windows open right now, with what names them: [{ id (its handle), process, label, title }].
// Asked for only when you ask her to find one; the titles stay here and in her overlay, never kept.
async function windows() {
  if (process.platform !== 'win32') return [];
  const out = await powershell(
    'Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | '
    + 'ForEach-Object { [pscustomobject]@{ pid = $_.Id; id = [int64]$_.MainWindowHandle; process = $_.ProcessName; label = $_.Description; title = $_.MainWindowTitle } } | '
    + 'ConvertTo-Json -Compress',
  );
  return [].concat(out ? JSON.parse(out) : [])
    .filter((w) => w.pid !== process.pid && !['capri', 'electron'].includes(String(w.process).toLowerCase()))
    .map(({ id, process: name, label, title }) => ({ id, process: name, label: label || '', title: title || '' }));
}

// The same app in her languages (and its program's name): "notatnik" finds Notepad, "bloc-notes" too
const ALIASES = [
  ['notepad', 'notatnik', 'bloc-notes', 'bloc notes', 'bloc de notas', 'bloco de notas', 'блокнот'],
  ['calculator', 'calc', 'calculatorapp', 'kalkulator', 'calculatrice', 'calculadora', 'калькулятор'],
  ['explorer', 'file explorer', 'eksplorator', 'eksplorator plikow', 'explorateur', 'explorateur de fichiers',
    'explorador de archivos', 'explorador de arquivos', 'explorador', 'проводник'],
  ['paint', 'mspaint'],
  ['taskmgr', 'task manager', 'menedzer zadan', 'gestionnaire des taches', 'administrador de tareas',
    'gerenciador de tarefas', 'диспетчер задач'],
  ['systemsettings', 'settings', 'ustawienia', 'parametres', 'configuracion', 'configuracoes', 'параметры', 'настройки'],
  ['windowsterminal', 'terminal', 'терминал'],
  ['cmd', 'command prompt', 'wiersz polecen', 'invite de commandes', 'simbolo del sistema', 'prompt de comando', 'командная строка'],
  ['msedge', 'edge'],
  ['photos', 'zdjecia', 'fotos', 'фотографии', 'фото'],
  ['winword', 'word'], ['excel'], ['powerpnt', 'powerpoint'], ['outlook', 'olk'],
  ['code', 'vs code', 'vscode', 'visual studio code'], ['obs64', 'obs'], ['ms-teams', 'teams'],
].map((names) => names.map((name) => fold(name)));
// a kind of app, in her languages, and the apps that are one: "przeglądarka" finds Chrome or Firefox
// (but "chrome" never finds Firefox)
const KINDS = [
  [['browser', 'przegladarka', 'navigateur', 'navegador', 'браузер'], ['chrome', 'msedge', 'firefox', 'opera', 'brave']],
].map(([words, apps]) => [words.map((word) => fold(word)), apps]);

// lowercase, no accents ("ł" too), only letters, digits and single spaces
function fold(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// what you said, and the same app in her other languages; said in Polish, without its ending too
// ("okno notatnika", "pokaż discorda", "gdzie moja przeglądarki" from "przeglądarka")
function variants(wanted) {
  const said = fold(wanted);
  const stem = said.length >= 6 ? said.replace(/(owi|em|ie|a|u|y|i)$/, '') : said;
  const keys = [...new Set([said, stem])];
  const named = [...keys, `${stem}a`];
  const group = named.flatMap((key) => ALIASES.find((names) => names.includes(key)) || []);
  const kind = named.flatMap((key) => KINDS.find(([words]) => words.includes(key))?.[1] || []);
  return [...new Set([...keys, ...group, ...kind])].filter((v) => v.length >= 2);
}

// how many letters apart two words are (one swapped pair counts once): "spotfy" is 1 from "spotify"
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// The window `wanted` names, among `list` (windows()): { win, similar } with `similar` when it's only
// close to what you said (a typo, another name), for her to ask first; null when nothing is.
function findWindow(wanted, list) {
  const keys = variants(wanted);
  if (!keys.length) return null;
  let best = null;
  for (const win of list) {
    // a Store app's window belongs to its frame's process: its title is its name
    const frame = /^applicationframehost$/i.test(win.process);
    const names = (frame ? [win.title] : [win.process, win.label]).map(fold).filter(Boolean);
    const title = fold(win.title);
    // close to what you said: an app's name (in any of her languages), never a word of what it shows (a
    // document called "Notatki" isn't Notepad)
    const known = names.flatMap((n) => ALIASES.find((group) => group.includes(n)) || []);
    const words = [...new Set([...names, ...known, ...names.flatMap((n) => n.split(' '))])].filter((w) => w.length >= 3);
    let score = 0;
    for (const key of keys) {
      if (names.includes(key)) score = Math.max(score, 4);
      else if (key.length >= 3 && (` ${title} `.includes(` ${key} `) || names.some((n) => n.startsWith(key)))) score = Math.max(score, 3);
      // a letter or two off (more for a long name), or the start of it
      else if (key.length >= 4 && words.some((w) => distance(key, w) <= (key.length >= 7 ? 2 : 1) || (w.length >= 5 && key.startsWith(w)))) score = Math.max(score, 1);
    }
    if (score > (best?.score || 0)) best = { win, score };
  }
  return best && { win: best.win, similar: best.score < 3 };
}

// Brought up in front of you (restored if it was minimized). Resolves true when it's there.
async function showWindow(id) {
  if (process.platform !== 'win32' || !Number.isSafeInteger(Number(id))) return false;
  const out = await powershell(
    'Add-Type -Namespace Capri -Name Win -MemberDefinition \''
    + '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr h, int c);'
    + '[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);'
    + '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);\'; '
    + `$h = [System.IntPtr]::new([int64]${Number(id)}); `
    + 'if ([Capri.Win]::IsIconic($h)) { [void][Capri.Win]::ShowWindowAsync($h, 9) }; [Capri.Win]::SetForegroundWindow($h)',
  ).catch(() => '');
  return /true/i.test(out);
}

// The apps' buttons on the taskbar (its main one, through UI Automation): [{ name, count, x, y, w, h }],
// `name` as the button says it ("Firefox"), `count` its windows (0: only pinned), in physical pixels.
async function taskbar() {
  if (process.platform !== 'win32') return [];
  const out = await powershell(
    'Add-Type -Namespace Capri -Name Dpi -MemberDefinition \'[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();\'; '
    + '[void][Capri.Dpi]::SetProcessDPIAware(); '
    + 'Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes; '
    + '$A = [System.Windows.Automation.AutomationElement]; '
    + '$bar = $A::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, '
    + '(New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, \'Shell_TrayWnd\'))); '
    + 'if (-not $bar) { return }; '
    + '$bar.FindAll([System.Windows.Automation.TreeScope]::Descendants, '
    + '(New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))) | '
    + 'Where-Object { $_.Current.AutomationId -like \'Appid:*\' } | ForEach-Object { $r = $_.Current.BoundingRectangle; '
    + '[pscustomobject]@{ name = $_.Current.Name; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height } } | '
    + 'ConvertTo-Json -Compress',
  );
  return [].concat(out ? JSON.parse(out) : []).map(button);
}

// "Firefox — uruchomione okna: 3 — przypięto", "Firefox - 3 running windows - pinned": its app and its windows
function button({ name, x, y, w, h }) {
  const [app, ...rest] = String(name || '').split(/\s+[—–-]\s+/);
  const count = Number(rest.join(' ').match(/\d+/)?.[0] || 0);
  return { name: app.trim(), count, x, y, w, h };
}

// The button of the app `wanted` names (or of the window found for it): its name, in her languages too
function findButton(wanted, buttons, win = null) {
  const keys = new Set([...variants(wanted), ...(win ? [fold(win.label), fold(win.process)] : [])].filter((k) => k.length >= 2));
  let best = null;
  for (const b of buttons) {
    const name = fold(b.name);
    const known = ALIASES.find((group) => group.includes(name)) || [];
    let score = 0;
    for (const key of keys) {
      if (name === key || known.includes(key)) score = Math.max(score, 3);
      else if (key.length >= 4 && (name.split(' ').includes(key) || key.split(' ').includes(name))) score = Math.max(score, 2);
    }
    if (score > (best?.score || 0)) best = { b, score };
  }
  return best?.b || null;
}

module.exports = { list, find, close, powershell, windows, findWindow, showWindow, variants, fold, taskbar, button, findButton };
