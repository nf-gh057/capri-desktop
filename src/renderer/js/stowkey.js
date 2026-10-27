// Her shortcut, picked by pressing it (her menu › Shortcut to put her away › Another one…): the keys
// you press show up in her panel, and she keeps them when you save, if Windows lets her have them.
// Her own isn't listened for meanwhile, so pressing it there just shows it.

import { fmt, keyLabel } from './util.js';

const NAMED = {
  Space: 'Space', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  Pause: 'Pause', ScrollLock: 'Scrolllock', Backquote: '`', Minus: '-', Equal: '=',
};

// The key itself, by where it is on the keyboard (so the layout doesn't matter): "H", "7", "F12"…
function keyName(code) {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return NAMED[code] || null;
}

// A key press as Electron writes it ("Control+Alt+H"), or null: a modifier alone, or a key that
// would be taken from everything you type (a letter alone, or with just Shift).
export function accelerator(e) {
  const key = keyName(e.code);
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const fkey = /^F\d+$/.test(key);
  if (!fkey && mods.filter((m) => m !== 'Shift').length === 0) return null;
  return [...mods, key].join('+');
}

// Ctrl+Alt with a letter is AltGr with it, and these ones type something with AltGr on the keyboards
// of her languages (Polish ą ć ę ł ń ó ś ź ż €, € and @ elsewhere): taken, that letter can't be typed
const altGr = (acc) => /^Control\+Alt\+[ACELMNOQSUWXZ]$/.test(acc);

export class StowKey {
  constructor({ guide, panel, host, brain }) {
    this.guide = guide;
    this.panel = panel;
    this.host = host;
    this.brain = brain;
  }

  get t() {
    return this.brain.t.stowKey;
  }

  open() {
    return this.guide.scene(() => this.record());
  }

  async record() {
    const { t, host, panel } = this;
    let picked = null;
    let quote = fmt(t.how, { key: this.brain.stowKey ? keyLabel(this.brain.stowKey) : t.none });
    const show = (acc) => `${fmt(t.picked, { key: keyLabel(acc) })}${altGr(acc) ? `\n${t.altgr}` : ''}`;
    const onKey = (e) => {
      const acc = accelerator(e);
      if (!acc) return;
      e.preventDefault();
      e.stopPropagation();
      picked = acc;
      quote = show(acc);
      panel.setQuote(quote);
    };
    host.pauseStowKey(true);
    host.focusOverlay(true); // the keyboard, to press them
    window.addEventListener('keydown', onKey, true);
    try {
      for (;;) {
        const id = await this.guide.ask({
          face: 'look', line: t.line, quote,
          actions: [{ id: 'save', label: t.save, primary: true }, { id: 'cancel', label: t.cancel }],
        });
        if (id !== 'save') return;
        if (!picked) continue;
        const res = await host.setStowKey(picked);
        if (res.ok) {
          this.brain.stowKey = picked;
          await this.guide.ask({ kind: 'done', face: 'laugh', line: fmt(t.saved, { key: keyLabel(picked) }), actions: this.guide.ok() });
          return;
        }
        quote = fmt(t.taken, { key: keyLabel(picked) });
        picked = null;
      }
    } finally {
      window.removeEventListener('keydown', onKey, true);
      host.focusOverlay(false);
      host.pauseStowKey(false);
    }
  }
}
