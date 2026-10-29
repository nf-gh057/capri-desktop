// Her settings window, "Mainframe": her tray menu's choices on one page, drawn again from what
// main.js sends (main/main.js mainframeState) each time anything changes, here or elsewhere.

const host = window.mainframe;
const sections = document.getElementById('sections');
let state = null;

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

const section = (name, ...children) => el('section', { class: 'section' }, el('h2', { class: 'section__name' }, name), ...children);

function brain(s, t) {
  const b = s.brain;
  const provider = b.providers.find((p) => p.id === b.provider);
  const name = (provider?.label || b.provider).replace(/\s*\(.*\)$/, ''); // "Codex (ChatGPT plan…)" -> "Codex"
  return section(t.secBrain,
    el('p', { class: 'headline' }, b.model && b.model !== name ? `${name} · ${b.model}` : name),
    el('p', { class: `note ${b.error ? 'is-error' : ''}` }, b.error || b.where),
    row(null, select(b.providers, b.provider, 'provider', { label: t.chatModel })),
    row(null,
      select(b.models.length ? b.models : [{ id: '', label: '—' }], b.model, 'model',
        { disabled: !b.models.length, label: t.chatModel }),
      button(t.refresh, 'refresh')),
    b.signin && row(null, button(t.cloudSignin, 'cloudSignin', null, { class: 'grow' })),
    b.agent && [
      row(t.permissions, select(b.agent.modes, b.agent.mode, 'mode', { label: t.permissions })),
      b.agent.effort && row(t.effort, choice('trio grow', b.agent.efforts.map(({ id, label }) => [id, label]), b.agent.effort, 'effort')),
      row(null, button(b.agent.cwd, 'folder', null, { class: 'grow' })),
      check(t.agentPowers, b.agent.powers, 'agentPowers'),
    ],
    check(t.chatShowModel, b.showModel, 'chatShowModel'),
    check(t.chatShowNote, b.showNote, 'chatShowNote'),
    el('div', { class: 'split' }, button(t.aiSetup, 'aiSetup'), button(t.apiKey, 'apiKey')),
    row(null, button(t.forget, 'forget', null, { class: 'grow' })));
}

function capri(s, t) {
  const c = s.capri;
  return section(t.secCapri,
    el('p', { class: 'note' }, c.sync),
    el('div', { class: 'trio' },
      button(c.visible ? t.hide : t.show, 'visible'),
      button(t.teleport, 'teleport'),
      button(t.talk, 'talk')),
    row(t.size, choice('trio grow', [['small', t.small], ['medium', t.medium], ['large', t.large]], c.size, 'size')),
    check(t.wander, c.wander, 'wander'),
    check(t.possess, c.possess, 'possess'),
    check(t.jealous, c.jealous, 'jealous'),
    check(t.pcReact, c.pcReact, 'pcReact'),
    check(t.mute, c.muted, 'muted'),
    row(t.rest, select([{ id: 'corner', label: t.restCorner }, { id: 'taskbar', label: t.restTaskbar }], c.rest, 'rest', { label: t.rest })),
    row(t.screen, select(c.screens, c.screen, 'screen', { disabled: c.screens.length < 2, label: t.screen })),
    c.screens.length > 1 && check(t.follow, c.follow, 'follow'),
    row(null, button(t.lookNow, 'lookNow', null, { class: 'grow' })),
    check(t.lookAuto, c.lookAuto, 'lookAuto'),
    row(t.reminders, c.reminders.length ? null : el('span', { class: 'note grow' }, t.noReminders)),
    c.reminders.map((r) => row(null, el('span', { class: 'grow reminder' }, r.label),
      button('✕', 'cancelReminder', r.id, { title: t.cancelReminder }))),
    // what she remembers, and on which of your PCs it was said (her swarm): one by one, to forget
    row(t.memories, c.memories.length ? null : el('span', { class: 'note grow' }, t.noMemories)),
    c.memories.map((m) => row(null, el('span', { class: 'grow reminder' }, m.text, m.from && el('span', { class: 'note' }, ` · ${m.from}`)),
      button('✕', 'forgetMemory', m.id, { title: t.forgetMemory }))),
    row(t.stowKey, select([...c.stowKeys, { id: null, label: t.stowKeyOff }], c.stowKey, 'stowKey', { label: t.stowKey })),
    el('div', { class: 'split' }, button(t.stowKeyCustom, 'stowKeyCustom'), button(t.custom, 'custom')));
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
  return section(t.secPhone,
    el('p', { class: 'headline' }, `@${p.bot} → ${p.linked}`),
    elsewhere,
    el('p', { class: `note ${p.error ? 'is-error' : ''}` }, p.error || t.phonePrivacy),
    check(t.phoneOn, p.on, 'phoneOn'),
    row(t.phoneWhen, select([['5', t.phoneAway5], ['15', t.phoneAway15], ['0', t.phoneAlways]].map(([id, label]) => ({ id, label })),
      p.away, 'phoneAway', { label: t.phoneWhen })),
    row(t.phoneDetail, select([['line', t.phoneLine], ['quote', t.phoneQuote]].map(([id, label]) => ({ id, label })),
      p.detail, 'phoneDetail', { label: t.phoneDetail })),
    el('div', { class: 'split' }, button(t.phoneTest, 'phoneTest'), button(t.phoneForget, 'phoneForget')),
    phoneChat(p, t));
}

// Her chat on Telegram: the code from your authenticator app first (scanned here, checked once), then
// on or off, how long `/unlock` opens it for, and locked again from here
function phoneChat(p, t) {
  const head = el('h3', { class: 'subhead' }, t.phoneChatHead);
  if (p.draft) {
    return [head,
      el('p', { class: 'note' }, t.phoneTotpScan),
      el('img', { class: 'qr', src: p.draft.qr, alt: t.phoneTotpScan }),
      el('p', { class: 'note' }, `${t.phoneTotpKey} `, el('span', { class: 'code' }, p.draft.key)),
      p.draftError && el('p', { class: 'note is-error' }, p.draftError),
      field('phoneTotpCode', t.phoneTotpCode, t.phoneTotpCheck, 'phoneTotpCheck'),
      row(null, button(t.phoneTotpCancel, 'phoneTotpCancel', null, { class: 'grow' }))];
  }
  if (!p.totp) {
    return [head,
      el('p', { class: 'note' }, t.phoneChatHow),
      row(null, button(t.phoneTotpSet, 'phoneTotpSet', null, { class: 'grow' }))];
  }
  return [head,
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
  return section(t.secSwarm,
    el('p', { class: 'headline' }, `${w.name}${w.here ? ` · ${t.swarmHere}` : ''}`),
    tailscale,
    w.error && el('p', { class: 'note is-error' }, w.error),
    check(t.swarmOn, true, 'swarmOn'),
    field('swarmName', t.swarmName, t.phoneSave, 'swarmName'),
    el('h3', { class: 'subhead' }, t.swarmPcs),
    !w.peers.length && el('p', { class: 'note' }, t.swarmNone),
    w.peers.map((p) => row(null, el('span', { class: 'grow reminder' }, `${p.name} · ${p.status}`),
      button('✕', 'swarmRemove', p.id, { title: t.swarmRemove }))),
    check(t.swarmUpdate, w.update, 'swarmUpdate'),
    // your other devices with Capri on Tailscale: one click (Tailscale vouches that they're yours)
    el('h3', { class: 'subhead' }, t.swarmFound),
    w.found.length
      ? w.found.map((f) => row(null, el('span', { class: 'grow reminder' }, `${f.name}${f.version ? ` · v${f.version}` : ''}`),
        button(t.swarmJoin, 'swarmJoinTailnet', f.id)))
      : el('p', { class: 'note' }, t.swarmNoneFound),
    row(null, button(t.swarmLook, 'swarmLook', null, { class: 'grow' })),
    // or with a code (a device on another Tailscale account)
    el('h3', { class: 'subhead' }, t.swarmByCode),
    w.invite
      ? [el('p', { class: 'note' }, t.swarmInviteHow), el('p', { class: 'note' }, el('span', { class: 'code' }, w.invite)),
        row(null, button(t.phoneTotpCancel, 'swarmInviteCancel', null, { class: 'grow' }))]
      : row(null, button(t.swarmInvite, 'swarmInvite', null, { class: 'grow' })),
    field('swarmJoin', t.swarmJoinCode, t.swarmJoin, 'swarmJoin'));
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

function draw(next) {
  state = next;
  const t = state.t;
  document.documentElement.lang = state.lang;
  document.getElementById('version').textContent = `v${state.version}`;
  const top = sections.scrollTop; // drawn again in place, not back at the top
  const typed = [...sections.querySelectorAll('[data-keep]')].map((input) => [input.dataset.keep, input.value, input === document.activeElement]);
  sections.replaceChildren(brain(state, t), capri(state, t), watch(state, t), phone(state, t), swarm(state, t), updates(state, t), system(state, t));
  for (const [keep, value, focused] of typed) {
    const input = sections.querySelector(`[data-keep="${keep}"]`);
    if (!input) continue;
    input.value = value;
    if (focused) input.focus();
  }
  sections.scrollTop = top;
}

document.getElementById('minimize').addEventListener('click', () => host.minimize());
document.getElementById('close').addEventListener('click', () => host.close());
host.onState(draw);
host.state().then((s) => s && draw(s));
