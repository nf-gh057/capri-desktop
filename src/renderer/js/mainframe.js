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
      select(b.models.length ? b.models.map((m) => ({ id: m, label: m })) : [{ id: '', label: '—' }], b.model, 'model',
        { disabled: !b.models.length, label: t.chatModel }),
      button(t.refresh, 'refresh')),
    b.agent && [
      row(t.permissions, select(b.agent.modes, b.agent.mode, 'mode', { label: t.permissions })),
      row(null, button(b.agent.cwd, 'folder', null, { class: 'grow' })),
      check(t.agentPowers, b.agent.powers, 'agentPowers'),
    ],
    el('div', { class: 'split' }, button(t.aiSetup, 'aiSetup'), button(t.apiKey, 'apiKey')),
    row(null, button(t.forget, 'forget', null, { class: 'grow' })));
}

function capri(s, t) {
  const c = s.capri;
  return section(t.secCapri,
    el('div', { class: 'trio' },
      button(c.visible ? t.hide : t.show, 'visible'),
      button(t.teleport, 'teleport'),
      button(t.talk, 'talk')),
    row(t.size, choice('trio grow', [['small', t.small], ['medium', t.medium], ['large', t.large]], c.size, 'size')),
    check(t.wander, c.wander, 'wander'),
    check(t.possess, c.possess, 'possess'),
    check(t.mute, c.muted, 'muted'),
    row(t.rest, select([{ id: 'corner', label: t.restCorner }, { id: 'taskbar', label: t.restTaskbar }], c.rest, 'rest', { label: t.rest })),
    row(t.screen, select(c.screens, c.screen, 'screen', { disabled: c.screens.length < 2, label: t.screen })),
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
  sections.replaceChildren(brain(state, t), capri(state, t), watch(state, t), system(state, t));
  sections.scrollTop = top;
}

document.getElementById('minimize').addEventListener('click', () => host.minimize());
document.getElementById('close').addEventListener('click', () => host.close());
host.onState(draw);
host.state().then((s) => s && draw(s));
