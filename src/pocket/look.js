// Her own style, "Custom" (Mainframe › CYBERDECK): two colours picked, hers and yours, and everything else
// made from them, as Original has her red and your green and Night City her yellow and your cyan. The
// pages' CSS mixes the rest from --pick-her and --pick-you (html[data-theme='custom']); her chat's pictures,
// drawn as files for the other two, are drawn here in those colours. Mainframe and her page on your phone
// both load this file.
(() => {
  const HEX = /^#[0-9a-f]{6}$/i;
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  // a of the first colour, the rest the second's
  const mix = (a, b, k) => {
    const [x, y] = [rgb(a), rgb(b)];
    return `#${x.map((v, i) => Math.round(v * k + y[i] * (1 - k)).toString(16).padStart(2, '0')).join('')}`;
  };
  const url = (svg) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" ${svg}</svg>`)}`;
  const DOTS = 'M3 3h2v2H3zM8 3h2v2H8zM13 3h2v2h-2zM18 3h2v2h-2zM23 3h2v2h-2zM28 3h2v2h-2zM33 3h2v2h-2z';

  // the same shapes as face-capri.svg, face-you.svg, hud-frame.svg and send.svg
  const PICTURES = {
    'face-capri': (her) => url(`viewBox="0 0 40 40"><path d="M1 1H39V39H5L1 35Z" fill="${mix(her, '#000000', 0.6)}" fill-opacity=".7" stroke="${mix(her, '#000000', 0.88)}"/>`
      + `<path d="M14.5 9.5A12 12 0 0 0 14.5 30.5M25.5 9.5A12 12 0 0 1 25.5 30.5" fill="none" stroke="${her}" stroke-width="3" stroke-linecap="round"/>`
      + `<path d="${DOTS}" fill="${her}" fill-opacity=".35"/>`),
    'face-you': (her, you) => url(`viewBox="0 0 40 40"><path d="M1 1H39V39H5L1 35Z" fill="${mix(you, '#000000', 0.55)}" fill-opacity=".7" stroke="${you}"/>`
      + `<path d="M9.5 14.5A12 12 0 0 1 30.5 14.5M9.5 25.5A12 12 0 0 0 30.5 25.5" fill="none" stroke="${mix(you, '#ffffff', 0.6)}" stroke-width="3" stroke-linecap="round"/>`
      + `<path d="${DOTS}" fill="${you}" fill-opacity=".35"/>`),
    'hud-frame': (her) => url(`viewBox="0 0 40 40"><path d="M8.5 .5H31.5L39.5 8.5V31.5L31.5 39.5H8.5L.5 31.5V8.5Z" fill="${mix(her, '#0b0b0d', 0.05)}" fill-opacity=".88" stroke="${mix(her, '#000000', 0.88)}"/>`
      + `<path d="M4 6V34M36 6V34" stroke="${mix(her, '#000000', 0.88)}" stroke-opacity=".4"/>`),
    send: (her) => url(`viewBox="0 0 40 32"><path d="M1 1H39V25L33 31H1Z" fill="${mix(her, '#000000', 0.88)}" fill-opacity=".18" stroke="${her}" stroke-width="1.2"/>`
      + `<path d="M11 16L29 9L23 25L19.5 18.5Z M19.5 18.5L29 9" fill="none" stroke="${her}" stroke-width="1.6" stroke-linejoin="round"/>`),
  };

  globalThis.capriLook = {
    her: '#ff5fd2', // the colours Custom starts with (main/config.js customHer, customYou)
    you: '#7c9cff',
    // { theme, her, you }: the page in that style, its two colours set when it's Custom
    apply(look = {}) {
      const root = document.documentElement;
      root.dataset.theme = look.theme || 'nightcity';
      this.her = HEX.test(look.her || '') ? look.her : this.her;
      this.you = HEX.test(look.you || '') ? look.you : this.you;
      root.style.setProperty('--pick-her', this.her);
      root.style.setProperty('--pick-you', this.you);
      root.style.setProperty('--hud-frame', `url("${PICTURES['hud-frame'](this.her)}")`);
    },
    // one of her chat's pictures in Custom's colours (face-erebus keeps his own)
    picture(name) {
      return PICTURES[name]?.(this.her, this.you) || null;
    },
  };
})();
