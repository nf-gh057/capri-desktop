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

// Every window you'd see on the taskbar (an app's other windows too, not just its main one), with
// what names it and where it is: [{ id (its handle), process, label, title, min, rect: { x, y, w, h }
// (physical pixels) }]. Asked for only when you ask her to find one; the titles stay here and in her
// overlay, never kept. (Each one's process, as Get-Process names it.)
const LIST_WINDOWS = [
  'Add-Type -TypeDefinition \'',
  'using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;',
  'public static class CapriList {',
  '  delegate bool Each(IntPtr h, IntPtr l);',
  '  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }',
  '  [DllImport("user32.dll")] static extern bool EnumWindows(Each f, IntPtr l);',
  '  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);',
  '  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);',
  '  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);',
  '  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);',
  '  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);',
  '  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);',
  '  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);',
  '  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();',
  '  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);',
  '  public static List<string> All() {',
  '    SetProcessDPIAware();',
  '    var all = new List<string>();',
  '    EnumWindows((h, l) => {',
  // visible, not owned by another window (a dialog), not a tool window, not cloaked (another desktop)
  '      if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero || (GetWindowLong(h, -20) & 0x80) != 0) return true;',
  '      int cloaked;',
  '      if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;',
  '      int n = GetWindowTextLength(h);',
  '      if (n == 0) return true;',
  '      var cls = new StringBuilder(64); GetClassName(h, cls, 64);',
  '      if (cls.ToString() == "Progman" || cls.ToString() == "WorkerW") return true;',
  '      var title = new StringBuilder(n + 1); GetWindowText(h, title, n + 1);',
  '      uint pid; GetWindowThreadProcessId(h, out pid);',
  '      RECT r; GetWindowRect(h, out r);',
  '      all.Add(String.Join("|", h.ToInt64(), pid, IsIconic(h) ? 1 : 0, r.L, r.T, r.R - r.L, r.B - r.T, title.ToString()));',
  '      return true;',
  '    }, IntPtr.Zero);',
  '    return all;',
  '  }',
  '}',
  '\'; $p = @{}; Get-Process | ForEach-Object { $p[$_.Id] = $_ }; ',
  '[CapriList]::All() | ForEach-Object { $a = $_.Split([char]124, 8); $q = $p[[int]$a[1]]; ',
  '[pscustomobject]@{ id = [int64]$a[0]; pid = [int]$a[1]; min = $a[2] -eq [string]1; x = [int]$a[3]; y = [int]$a[4]; w = [int]$a[5]; h = [int]$a[6]; ',
  'process = $q.ProcessName; label = $q.Description; title = $a[7] } } | ConvertTo-Json -Compress',
].join('\n');

async function windows() {
  if (process.platform !== 'win32') return [];
  const out = await powershell(LIST_WINDOWS, 20000);
  return [].concat(out ? JSON.parse(out) : [])
    .filter((w) => w.pid !== process.pid && w.process && !['capri', 'electron'].includes(String(w.process).toLowerCase()))
    .map(({ id, process: name, label, title, min, x, y, w, h }) => ({
      id, process: name, label: label || '', title: title || '', min: Boolean(min), rect: { x, y, w, h },
    }));
}

// The windows of the same app as `win` (itself too): its process's, or a Store app's frames named alike
function appWindows(win, list) {
  const frame = (w) => /^applicationframehost$/i.test(w.process);
  return list.filter((w) => w.process.toLowerCase() === win.process.toLowerCase() && (!frame(win) || w.title === win.title));
}

// A window's title without its app's name at the end ("YouTube — Mozilla Firefox": "YouTube"), for a
// button to pick it by
function shortTitle(win) {
  const ends = [win.label, win.process, 'Mozilla Firefox', 'Google Chrome', 'Microsoft Edge'].filter(Boolean);
  let title = String(win.title || '');
  for (const end of ends) title = title.replace(new RegExp(`\\s+[—–-]\\s+${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), '');
  return title.trim() || win.title;
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

// The window `wanted` names, among `list` (windows()): { win, similar, named } with `similar` when it's
// only close to what you said (a typo, another name), for her to ask first, and `named` when you named
// its app (not something in its title: "youtube" is that one window); null when nothing is.
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
      else if (key.length >= 3 && names.some((n) => n.startsWith(key))) score = Math.max(score, 3.5);
      else if (key.length >= 3 && ` ${title} `.includes(` ${key} `)) score = Math.max(score, 3);
      // a letter or two off (more for a long name), or the start of it
      else if (key.length >= 4 && words.some((w) => distance(key, w) <= (key.length >= 7 ? 2 : 1) || (w.length >= 5 && key.startsWith(w)))) score = Math.max(score, 1);
    }
    if (score > (best?.score || 0)) best = { win, score };
  }
  return best && { win: best.win, similar: best.score < 3, named: best.score > 3 };
}

// Brought up in front of you (restored if it was minimized): { ok, rect } with where it is then
// (physical pixels: on which screen), or { ok: false }.
async function showWindow(id) {
  if (process.platform !== 'win32' || !Number.isSafeInteger(Number(id))) return { ok: false };
  const out = await powershell(
    'Add-Type -Namespace Capri -Name Win -MemberDefinition \''
    + '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr h, int c);'
    + '[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);'
    + '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);'
    + '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();'
    + '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, System.IntPtr p);'
    + '[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();'
    + '[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool on);'
    + '[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr after, int x, int y, int w, int h2, uint f);'
    + '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
    + '[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, int[] r);\'; '
    + `[void][Capri.Win]::SetProcessDPIAware(); $h = [System.IntPtr]::new([int64]${Number(id)}); `
    + 'if ([Capri.Win]::IsIconic($h)) { [void][Capri.Win]::ShowWindowAsync($h, 9); Start-Sleep -Milliseconds 250 }; '
    // Windows only lets the app you're using hand the front over: through its input (attached to it a
    // moment), and failing that, the window at least raised over the others (topmost, then not)
    + '$fg = [Capri.Win]::GetForegroundWindow(); $a = [Capri.Win]::GetCurrentThreadId(); '
    + '$b = [Capri.Win]::GetWindowThreadProcessId($fg, [System.IntPtr]::Zero); $on = $b -and $b -ne $a -and [Capri.Win]::AttachThreadInput($a, $b, $true); '
    + '[void][Capri.Win]::SetForegroundWindow($h); if ($on) { [void][Capri.Win]::AttachThreadInput($a, $b, $false) }; '
    + '$ok = [Capri.Win]::GetForegroundWindow() -eq $h; '
    + 'if (-not $ok) { $ok = [Capri.Win]::SetWindowPos($h, [System.IntPtr]::new(-1), 0, 0, 0, 0, 0x13) -and [Capri.Win]::SetWindowPos($h, [System.IntPtr]::new(-2), 0, 0, 0, 0, 0x13) }; '
    + '$r = New-Object int[] 4; [void][Capri.Win]::GetWindowRect($h, $r); '
    + '[pscustomobject]@{ ok = $ok; x = $r[0]; y = $r[1]; w = $r[2] - $r[0]; h = $r[3] - $r[1] } | ConvertTo-Json -Compress',
  ).catch(() => '');
  try {
    const { ok, x, y, w, h } = JSON.parse(out);
    return { ok: Boolean(ok), rect: w > 0 && h > 0 ? { x, y, w, h } : null };
  } catch {
    return { ok: false };
  }
}

// The apps' buttons on the taskbars (the main one, and each other screen's, through UI Automation):
// [{ name, count, x, y, w, h }], `name` as the button says it ("Firefox"), `count` its windows (0: only
// pinned), in physical pixels (main.js tells which screen from there).
async function taskbar() {
  if (process.platform !== 'win32') return [];
  const out = await powershell(
    'Add-Type -Namespace Capri -Name Dpi -MemberDefinition \'[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();\'; '
    + '[void][Capri.Dpi]::SetProcessDPIAware(); '
    + 'Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes; '
    + '$A = [System.Windows.Automation.AutomationElement]; '
    + '$bars = $A::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.OrCondition('
    + '(New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, \'Shell_TrayWnd\')), '
    + '(New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, \'Shell_SecondaryTrayWnd\'))))); '
    + '$bars | ForEach-Object { $_.FindAll([System.Windows.Automation.TreeScope]::Descendants, '
    + '(New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))) } | '
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

// The buttons of the app `wanted` names (or of the window found for it), on every taskbar it's on: its
// name, in her languages too. The best ones, in the taskbars' order.
function findButtons(wanted, buttons, win = null) {
  const keys = new Set([...variants(wanted), ...(win ? [fold(win.label), fold(win.process)] : [])].filter((k) => k.length >= 2));
  const scored = buttons.map((b) => {
    const name = fold(b.name);
    const known = ALIASES.find((group) => group.includes(name)) || [];
    let score = 0;
    for (const key of keys) {
      if (name === key || known.includes(key)) score = Math.max(score, 3);
      else if (key.length >= 4 && (name.split(' ').includes(key) || key.split(' ').includes(name))) score = Math.max(score, 2);
    }
    return { b, score };
  });
  const top = Math.max(0, ...scored.map((s) => s.score));
  return top ? scored.filter((s) => s.score === top).map((s) => s.b) : [];
}

const findButton = (wanted, buttons, win = null) => findButtons(wanted, buttons, win)[0] || null;

module.exports = {
  list, find, close, powershell, windows, appWindows, shortTitle, findWindow, showWindow, variants, fold, taskbar, button, findButton, findButtons,
};
