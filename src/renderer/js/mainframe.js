// Her settings window, "Mainframe": her tray menu's choices on tabs, like her game's menus, drawn
// again from what main.js sends (main/main.js mainframeState) each time anything changes, here or
// elsewhere. Each tab has a name from her world and a plain one under it; what it's for shows on a
// hover, and on all of them at once with "?" (bottom right) or F1.

const host = window.mainframe;
const sections = document.getElementById('sections');
const TABS = [
  ['core', 'NEURAL CORE'], ['gateway', 'BLACKWALL GATEWAY'], ['engrams', 'ENGRAMS'], ['cyberware', 'CYBERWARE'],
  ['netwatch', 'NETWATCH'], ['holo', 'HOLO'], ['subnet', 'SUBNET'], ['ripperdoc', 'RIPPERDOC'], ['cyberdeck', 'CYBERDECK'],
];
let state = null;
let tab = remembered() || 'core';
let help = false;

// the tab you were on, the next time it opens (this window's own storage; none, and it's the first)
function remembered() {
  try {
    const id = localStorage.getItem('mainframe.tab');
    return TABS.some(([t]) => t === id) ? id : null;
  } catch {
    return null;
  }
}

// an element, with its properties (on* are listeners) and children (text or elements)
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

async function act(name, value) {
  const next = await host.act(name, value);
  if (next) draw(next);
}

const button = (label, name, value, extra = {}) => el('button', {
  type: 'button', class: `button ${extra.class || ''}`, title: extra.title || label, disabled: extra.disabled,
  onclick: () => act(name, value),
}, label);

// several buttons, the one picked lit up
const choice = (cls, items, picked, name) => el('div', { class: cls },
  items.map(([value, label]) => button(label, name, value, { class: value === picked ? 'is-on' : '' })));

const select = (items, picked, name, extra = {}) => el('select', {
  class: `select ${extra.class || 'grow'}`, disabled: extra.disabled, 'aria-label': extra.label,
  onchange: (e) => act(name, e.target.value === '' ? null : e.target.value),
}, items.map(({ id, label }) => el('option', { value: id ?? '', selected: id === picked }, label)));

const check = (label, checked, name) => el('label', { class: 'check' },
  el('input', { type: 'checkbox', checked, onchange: (e) => act(name, e.target.checked) }),
  el('span'),
  label);

// a text box and its button: what's typed goes to `name`, and the box empties. `keep` names it, so
// what you're typing stays when the page is drawn again.
function field(keep, placeholder, label, name, type = 'text') {
  const input = el('input', {
    type, class: 'input grow', placeholder, 'aria-label': placeholder, autocomplete: 'off', spellcheck: false, 'data-keep': keep,
  });
  const go = () => {
    const value = input.value.trim();
    if (!value) return;
    input.value = '';
    act(name, value);
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  return el('div', { class: 'row' }, input, el('button', { type: 'button', class: 'button', onclick: go }, label));
}

const row = (label, ...children) => el('div', { class: 'row' }, label ? el('span', { class: 'row__label' }, label) : null, ...children);

// one card of a tab: its name in red, like the boxes of her game's menus
const section = (name, ...children) => el('section', { class: 'card' }, el('h2', { class: 'card__name' }, name), ...children);

// who answers her chat: "Codex · gpt-5.5", for her brain and the top of the window
function brainName(b) {
  const provider = b.providers.find((p) => p.id === b.provider);
  const name = (provider?.label || b.provider).replace(/\s*\(.*\)$/, ''); // "Codex (ChatGPT plan…)" -> "Codex"
  return b.model && b.model !== name ? `${name} · ${b.model}` : name;
}

function brain(s, t) {
  const b = s.brain;
  return section(t.secBrain,
    el('p', { class: 'headline' }, brainName(b)),
    el('p', { class: `note ${b.error ? 'is-error' : ''}` }, b.error || b.where),
    row(null, select(b.providers, b.provider, 'provider', { label: t.chatModel })),
    row(null,
      select(b.models.length ? b.models : [{ id: '', label: '—' }], b.model, 'model',
        { disabled: !b.models.length, label: t.chatModel }),
      button(t.refresh, 'refresh')),
    b.signin && row(null, button(t.cloudSignin, 'cloudSignin', null, { class: 'grow' })),
    check(t.chatShowModel, b.showModel, 'chatShowModel'),
    check(t.chatShowNote, b.showNote, 'chatShowNote'),
    el('div', { class: 'split' }, button(t.aiSetup, 'aiSetup'), button(t.apiKey, 'apiKey')));
}

// Claude Code or Codex in her chat: where it works, what it may do, and her own powers with it
function gateway(s, t) {
  const a = s.brain.agent;
  if (!a) return section(t.secAgent, el('p', { class: 'note' }, t.gatewayNone));
  return section(t.secAgent,
    el('p', { class: 'headline' }, brainName(s.brain)),
    row(t.permissions, select(a.modes, a.mode, 'mode', { label: t.permissions })),
    a.effort && row(t.effort, choice('trio grow', a.efforts.map(({ id, label }) => [id, label]), a.effort, 'effort')),
    row(null, button(a.cwd, 'folder', null, { class: 'grow' })),
    check(t.agentPowers, a.powers, 'agentPowers'));
}

// who she is, what she remembers and the reminders she keeps
function engrams(s, t) {
  const c = s.capri;
  return [
    section(t.secBond,
      el('p', { class: 'headline' }, s.stats.stage),
      el('p', { class: 'note' }, c.sync),
      el('div', { class: 'meter' }, el('span', { style: `width: ${s.stats.percent}%` })),
      el('p', { class: 'note' }, s.stats.together)),
    section(t.secPersona,
      row(null, button(t.custom, 'custom', null, { class: 'grow' })),
      row(null, button(t.forget, 'forget', null, { class: 'grow' }))),
    section(t.reminders,
      !c.reminders.length && el('p', { class: 'note' }, t.noReminders),
      c.reminders.map((r) => row(null, el('span', { class: 'grow reminder' }, r.label),
        button('✕', 'cancelReminder', r.id, { title: t.cancelReminder })))),
    // what she remembers, and on which of your PCs it was said (her swarm): one by one, to forget
    section(t.memories,
      !c.memories.length && el('p', { class: 'note' }, t.noMemories),
      c.memories.map((m) => row(null, el('span', { class: 'grow reminder' }, m.text, m.from && el('span', { class: 'note' }, ` · ${m.from}`)),
        button('✕', 'forgetMemory', m.id, { title: t.forgetMemory })))),
  ];
}

// her body on your screen, and how she acts
function cyberware(s, t) {
  const c = s.capri;
  return [
    section(t.secPresence,
      el('div', { class: 'trio' },
        button(c.visible ? t.hide : t.show, 'visible'),
        button(t.teleport, 'teleport'),
        button(t.talk, 'talk')),
      row(t.size, choice('trio grow', [['small', t.small], ['medium', t.medium], ['large', t.large]], c.size, 'size')),
      row(t.rest, select([{ id: 'corner', label: t.restCorner }, { id: 'taskbar', label: t.restTaskbar }], c.rest, 'rest', { label: t.rest })),
      row(t.screen, select(c.screens, c.screen, 'screen', { disabled: c.screens.length < 2, label: t.screen })),
      c.screens.length > 1 && check(t.follow, c.follow, 'follow'),
      row(t.stowKey, select([...c.stowKeys, { id: null, label: t.stowKeyOff }], c.stowKey, 'stowKey', { label: t.stowKey })),
      row(null, button(t.stowKeyCustom, 'stowKeyCustom', null, { class: 'grow' }))),
    section(t.secBehaviour,
      check(t.wander, c.wander, 'wander'),
      check(t.possess, c.possess, 'possess'),
      check(t.jealous, c.jealous, 'jealous'),
      check(t.pcReact, c.pcReact, 'pcReact'),
      check(t.mute, c.muted, 'muted'),
      check(t.lookAuto, c.lookAuto, 'lookAuto'),
      row(null, button(t.lookNow, 'lookNow', null, { class: 'grow' }))),
  ];
}

function watch(s, t) {
  const w = s.watch;
  return section(t.secWatch,
    row(null, select([...w.assistants, { id: 'none', label: t.watchNone }], w.id, 'watch', { label: t.watch })),
    w.hooks !== null && (w.hooks
      ? [el('p', { class: 'note' }, t.hooksOn), row(null, button(t.hooksRemove, 'hooks', 'uninstall', { class: 'grow' }))]
      : row(null, button(t.hooksOff, 'hooks', 'install', { class: 'grow is-on' }))));
}

// Her bot on Telegram: made at @BotFather, its token pasted here, paired with a code from your phone
function phone(s, t) {
  const p = s.phone;
  const error = p.error && el('p', { class: 'note is-error' }, p.error);
  const elsewhere = p.elsewhere && el('p', { class: 'note' }, p.elsewhere); // held by another of your PCs (her swarm)
  if (!p.bot) {
    return section(t.secPhone,
      elsewhere,
      el('p', { class: 'note' }, t.phoneHow),
      error,
      row(null, button(t.phoneBotFather, 'phoneBotFather', null, { class: 'grow' })),
      field('phoneToken', t.phoneToken, t.phoneSave, 'phoneToken', 'password'),
      el('p', { class: 'note' }, t.phonePrivacy));
  }
  if (!p.linked) {
    return section(t.secPhone,
      el('p', { class: 'headline' }, `@${p.bot}`),
      error,
      p.pairing ? [
        el('p', { class: 'note' }, t.phonePairHow),
        row(null, button(t.phoneOpenChat, 'phoneOpenChat', null, { class: 'grow is-on' })),
        el('p', { class: 'note' }, `${t.phonePairCode} `, el('span', { class: 'code' }, `/start ${p.pairing}`)),
        el('p', { class: 'note' }, t.phonePairWait),
      ] : row(null, button(t.phonePairAgain, 'phonePair', null, { class: 'grow is-on' })),
      row(null, button(t.phoneForget, 'phoneForget', null, { class: 'grow' })));
  }
  return [
    section(t.secPhone,
      el('p', { class: 'headline' }, `@${p.bot} → ${p.linked}`),
      elsewhere,
      el('p', { class: `note ${p.error ? 'is-error' : ''}` }, p.error || t.phonePrivacy),
      check(t.phoneOn, p.on, 'phoneOn'),
      row(t.phoneWhen, select([['5', t.phoneAway5], ['15', t.phoneAway15], ['0', t.phoneAlways]].map(([id, label]) => ({ id, label })),
        p.away, 'phoneAway', { label: t.phoneWhen })),
      row(t.phoneDetail, select([['line', t.phoneLine], ['quote', t.phoneQuote]].map(([id, label]) => ({ id, label })),
        p.detail, 'phoneDetail', { label: t.phoneDetail })),
      el('div', { class: 'split' }, button(t.phoneTest, 'phoneTest'), button(t.phoneForget, 'phoneForget'))),
    section(t.phoneChatHead, phoneChat(p, t)),
  ];
}

// Her chat on Telegram: the code from your authenticator app first (scanned here, checked once), then
// on or off, how long `/unlock` opens it for, and locked again from here
function phoneChat(p, t) {
  if (p.draft) {
    return [
      el('p', { class: 'note' }, t.phoneTotpScan),
      el('img', { class: 'qr', src: p.draft.qr, alt: t.phoneTotpScan }),
      el('p', { class: 'note' }, `${t.phoneTotpKey} `, el('span', { class: 'code' }, p.draft.key)),
      p.draftError && el('p', { class: 'note is-error' }, p.draftError),
      field('phoneTotpCode', t.phoneTotpCode, t.phoneTotpCheck, 'phoneTotpCheck'),
      row(null, button(t.phoneTotpCancel, 'phoneTotpCancel', null, { class: 'grow' }))];
  }
  if (!p.totp) {
    return [
      el('p', { class: 'note' }, t.phoneChatHow),
      row(null, button(t.phoneTotpSet, 'phoneTotpSet', null, { class: 'grow' }))];
  }
  return [
    el('p', { class: `note ${p.lockout ? 'is-error' : ''}` }, p.lockout || t.phoneChatHow),
    check(t.phoneChat, p.chat, 'phoneChat'),
    ...(p.chat ? [
      row(t.phoneUnlockFor, choice('trio grow', ['1', '4', '8'].map((h) => [h, `${h} h`]), p.hours, 'phoneHours')),
      p.open
        ? row(null, el('span', { class: 'note grow' }, p.open), button(t.phoneLockNow, 'phoneLock'))
        : el('p', { class: 'note' }, t.phoneLocked),
    ] : []),
    row(null, button(t.phoneTotpRemove, 'phoneTotpRemove', null, { class: 'grow' }))];
}

// Her updates: her version, what's new on GitHub, and updating (on a click, or while you're away)
function updates(s, t) {
  const u = s.update;
  return section(t.secUpdate,
    el('p', { class: 'headline' }, `v${u.version}`),
    u.remote && el('p', { class: 'note reminder' }, u.remote),
    u.note && el('p', { class: 'note' }, u.note),
    u.changes.map((title) => el('p', { class: 'note reminder' }, `• ${title}`)),
    u.why && el('p', { class: 'note is-error' }, u.why),
    u.can && row(null, button(t.updateApply, 'updateApply', null, { class: 'grow is-on' })),
    !u.packaged && [
      row(null, u.at && el('span', { class: 'note grow' }, u.at), button(t.updateCheckNow, 'updateCheckNow')),
      check(t.updateCheck, u.check, 'updateCheck'),
      u.check && check(t.updateAuto, u.auto, 'updateAuto'),
    ]);
}

// Her swarm: this PC, Tailscale, your other PCs with where she is, and adding or joining one
function swarm(s, t) {
  const w = s.swarm;
  const tailscale = w.tailscale
    ? el('p', { class: 'note' }, `Tailscale: `, el('span', { class: 'code' }, w.tailscale))
    : [
      el('p', { class: 'note is-error' }, w.tailscaleState === 'missing' ? t.swarmNoTailscale : t.swarmTailscaleOff),
      el('div', { class: 'split' }, button(t.swarmGetTailscale, 'tailscaleGet'), button(t.swarmCheck, 'tailscaleCheck')),
    ];
  if (!w.on) {
    return section(t.secSwarm,
      el('p', { class: 'note' }, t.swarmHow),
      tailscale,
      check(t.swarmOn, false, 'swarmOn'));
  }
  return [
    section(t.secSwarm,
      el('p', { class: 'headline' }, `${w.name}${w.here ? ` · ${t.swarmHere}` : ''}`),
      tailscale,
      w.error && el('p', { class: 'note is-error' }, w.error),
      check(t.swarmOn, true, 'swarmOn'),
      field('swarmName', t.swarmName, t.phoneSave, 'swarmName')),
    section(t.swarmPcs,
      !w.peers.length && el('p', { class: 'note' }, t.swarmNone),
      w.peers.map((p) => row(null, el('span', { class: 'grow reminder' }, `${p.name} · ${p.status}`),
        button('✕', 'swarmRemove', p.id, { title: t.swarmRemove }))),
      check(t.swarmUpdate, w.update, 'swarmUpdate')),
    // your other devices with Capri on Tailscale: one click (Tailscale vouches that they're yours)
    section(t.swarmFound,
      w.found.length
        ? w.found.map((f) => row(null, el('span', { class: 'grow reminder' }, `${f.name}${f.version ? ` · v${f.version}` : ''}`),
          button(t.swarmJoin, 'swarmJoinTailnet', f.id)))
        : el('p', { class: 'note' }, t.swarmNoneFound),
      row(null, button(t.swarmLook, 'swarmLook', null, { class: 'grow' }))),
    // or with a code (a device on another Tailscale account)
    section(t.swarmByCode,
      w.invite
        ? [el('p', { class: 'note' }, t.swarmInviteHow), el('p', { class: 'note' }, el('span', { class: 'code' }, w.invite)),
          row(null, button(t.phoneTotpCancel, 'swarmInviteCancel', null, { class: 'grow' }))]
        : row(null, button(t.swarmInvite, 'swarmInvite', null, { class: 'grow' })),
      field('swarmJoin', t.swarmJoinCode, t.swarmJoin, 'swarmJoin')),
  ];
}

function system(s, t) {
  const y = s.system;
  return section(t.secSystem,
    row(t.lang, select(y.langs, y.lang, 'lang', { label: t.lang })),
    row(t.motion, select([['auto', t.motionAuto], ['full', t.motionFull], ['reduced', t.motionReduced]].map(([id, label]) => ({ id, label })),
      y.motion, 'motion', { label: t.motion })),
    row(t.display, select([['auto', t.displayAuto], ['gl', t.displayGl], ['software', t.displaySoftware]].map(([id, label]) => ({ id, label })),
      y.render, 'render', { label: t.display })),
    row(t.menuMode, choice('split grow', [['full', t.menuFull], ['compact', t.menuCompact]], y.menu, 'menu')),
    check(t.startup, y.startup, 'startup'),
    el('div', { class: 'footer' }, button(t.help, 'help'), button(t.quit, 'quit', null, { class: 'is-danger' })));
}

const PAGES = {
  core: brain, gateway, engrams, cyberware, netwatch: watch, holo: phone, subnet: swarm, ripperdoc: updates, cyberdeck: system,
};

// her level, her sync and your days together, like a game's level and street cred
function stats(s, t) {
  const stat = (value, label) => el('div', { class: 'stat' }, el('span', { class: 'stat__value' }, value), el('span', { class: 'stat__label' }, label));
  return [
    el('div', { class: 'stat', title: s.stats.stage }, el('span', { class: 'stat__ring' }, String(s.stats.level)), el('span', { class: 'stat__label' }, t.statLevel)),
    stat(`${s.stats.percent}%`, t.statSync),
    stat(String(s.stats.days), t.statDays),
  ];
}

// the tabs, down the left like her game's contacts: a name from her world, a plain one under it
function tabs(s) {
  return TABS.map(([id, name]) => {
    const [plain, tip] = s.tabs[id];
    return el('button', {
      type: 'button', class: `tab ${id === tab ? 'is-on' : ''}`, 'data-tab': id, 'data-tip': tip,
      onclick: () => show(id),
    }, el('span', { class: 'tab__name' }, name), el('span', { class: 'tab__plain' }, plain), el('span', { class: 'tab__tip' }, tip));
  });
}

function show(id) {
  if (id === tab) return;
  tab = id;
  try {
    localStorage.setItem('mainframe.tab', id);
  } catch { /* remembered for this time only */ }
  sections.scrollTop = 0;
  draw(state);
}

function draw(next) {
  state = next;
  const t = state.t;
  document.documentElement.lang = state.lang;
  document.body.classList.toggle('is-help', help);
  document.getElementById('stats').replaceChildren(...stats(state, t));
  document.getElementById('build').replaceChildren(
    el('span', { class: 'build__brain' }, brainName(state.brain)), el('span', { class: 'build__version' }, `v${state.version}`));
  document.getElementById('tabs').replaceChildren(...tabs(state));
  const [plain, tip] = state.tabs[tab];
  document.getElementById('head').replaceChildren(
    el('h2', { class: 'pane__name' }, TABS.find(([id]) => id === tab)[1]),
    el('p', { class: 'pane__plain' }, plain),
    el('p', { class: 'pane__tip' }, tip));
  document.getElementById('helpLabel').textContent = t.helpTips;
  const top = sections.scrollTop; // drawn again in place, not back at the top
  const typed = [...sections.querySelectorAll('[data-keep]')].map((input) => [input.dataset.keep, input.value, input === document.activeElement]);
  sections.replaceChildren(...[PAGES[tab](state, t)].flat());
  for (const [keep, value, focused] of typed) {
    const input = sections.querySelector(`[data-keep="${keep}"]`);
    if (!input) continue;
    input.value = value;
    if (focused) input.focus();
  }
  sections.scrollTop = top;
}

// what a tab is for: by the pointer, while it's on it
const tip = document.getElementById('tip');
let tipFor = null;
document.addEventListener('mouseover', (e) => {
  const target = e.target.closest('[data-tip]');
  if (target === tipFor) return;
  tipFor = target;
  if (!target || help) {
    tip.hidden = true;
    return;
  }
  tip.textContent = target.dataset.tip;
  tip.hidden = false;
  const box = target.getBoundingClientRect();
  tip.style.left = `${Math.round(box.right + 10)}px`;
  tip.style.top = `${Math.round(Math.max(8, Math.min(box.top, innerHeight - tip.offsetHeight - 8)))}px`; // in the window
});

function toggleHelp() {
  help = !help;
  tip.hidden = true;
  if (state) draw(state);
}
document.getElementById('help').addEventListener('click', toggleHelp);
document.addEventListener('keydown', (e) => {
  if (e.key === 'F1') toggleHelp();
  else if (e.key === 'Escape' && help) toggleHelp();
});
host.onState(draw);
host.state().then((s) => s && draw(s));
