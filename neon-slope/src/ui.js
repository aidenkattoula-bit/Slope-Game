// =============================================================================
// UI - thin helpers around the DOM screens defined in index.html.
// Text from other players (online names) is always inserted with textContent,
// never innerHTML, so it can't inject markup.
// =============================================================================
export const $ = (id) => document.getElementById(id);

const PANELS = ['menu', 'turn', 'gameover', 'pause', 'results'];

export class UI {
  constructor() {
    this.overlay = $('overlay');
    this.hud = $('hud');
    this.scoreEl = $('hudScore');
    this.bestEl = $('hudBest');
    this.badge = $('hudBadge');
    this._shown = -1;
  }

  /** Show one panel (or none while playing). */
  show(name) {
    for (const p of PANELS) $(p).classList.toggle('hidden', p !== name);
    this.overlay.classList.toggle('clear', !name);
  }

  setHud(on) { this.hud.classList.toggle('hidden', !on); }

  setScore(n, pulse = false) {
    if (n !== this._shown) {
      this._shown = n;
      this.scoreEl.textContent = n.toLocaleString();
    }
    if (pulse) {
      this.scoreEl.classList.remove('pulse');
      void this.scoreEl.offsetWidth; // restart animation
      this.scoreEl.classList.add('pulse');
    }
  }

  setBest(n) { this.bestEl.textContent = `BEST ${n.toLocaleString()}`; }

  /** lines: array of [label, value] pairs shown top-left. */
  setBadge(lines) {
    this.badge.replaceChildren();
    for (const [label, value] of lines) {
      const d = document.createElement('div');
      d.append(label ? `${label} ` : '');
      if (value) { const b = document.createElement('b'); b.textContent = value; d.append(b); }
      this.badge.append(d);
    }
  }

  flashBest() {
    const f = $('flash');
    f.classList.add('hidden');
    void f.offsetWidth;
    f.classList.remove('hidden');
    clearTimeout(this._ft);
    this._ft = setTimeout(() => f.classList.add('hidden'), 1700);
  }

  setMuteIcons(muted) {
    $('btnMute').textContent = muted ? '🔇' : '🔊';
    $('pMute').textContent = muted ? '🔇 Sound off' : '🔊 Sound on';
  }

  /**
   * Render a ranked list into `el`.
   * rows: [{name, score, seed?}]; opts: {title, highlight(row, i)->bool, showSeed, empty}
   */
  renderRows(el, rows, opts = {}) {
    el.replaceChildren();
    if (opts.title) {
      const t = document.createElement('div');
      t.className = 'kicker';
      t.textContent = opts.title;
      el.append(t);
    }
    if (!rows.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = opts.empty || 'No scores yet - go set one!';
      el.append(e);
      return;
    }
    rows.forEach((row, i) => {
      const r = document.createElement('div');
      r.className = 'r' + (opts.highlight && opts.highlight(row, i) ? ' me' : '');
      const n = document.createElement('span'); n.className = 'n'; n.textContent = `${i + 1}`;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = row.name;
      r.append(n, nm);
      if (opts.showSeed && row.seed) {
        const sd = document.createElement('span'); sd.className = 'sd'; sd.textContent = row.seed;
        r.append(sd);
      }
      const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = row.score.toLocaleString();
      r.append(sc);
      el.append(r);
    });
  }
}

/** Copy text; falls back for older browsers. Returns true on success. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

/** Brief text change on a button as feedback. */
export function flashLabel(btn, text, ms = 1400) {
  const old = btn.dataset.label || btn.textContent;
  btn.dataset.label = old;
  btn.textContent = text;
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.textContent = old; }, ms);
}
