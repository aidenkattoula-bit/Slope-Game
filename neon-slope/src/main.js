// =============================================================================
// NEON SLOPE - game controller
// Wires together: scene (rendering), track generator, physics sim, audio, UI,
// local storage and the optional Supabase backend. Owns the state machine:
//   menu -> (turn) -> playing -> crashing -> gameover -> (turn | results) -> menu
//                        \-> paused
// =============================================================================
import { GameScene } from './scene.js';
import { TrackGenerator } from './track.js';
import { Sim, botSteer } from './physics.js';
import { AudioSys } from './audio.js';
import { UI, $, copyText, flashLabel } from './ui.js';
import { randomSeed, normalizeSeed } from './rng.js';
import { V_MAX, TIERS } from './config.js';
import {
  getBest, setBest, getTier, setTier, getName, setName, getMuted, setMuted,
  getPlayers, setPlayers, getBoard, addScore,
} from './storage.js';
import { onlineEnabled, submitScore, topScores } from './net.js';

const ui = new UI();
const audio = new AudioSys(getMuted());
const view = new GameScene($('gl'));

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
const G = {
  state: 'menu',      // menu | turn | playing | crashing | paused | gameover | results
  mode: 'solo',       // solo | seeded | pass
  tier: TIERS[getTier()] ? getTier() : 'normal',   // normal | advanced | extreme | godly
  tab: 'solo',        // selected menu tab
  seed: randomSeed(),
  gen: null,
  sim: null,
  prevBest: 0,
  flashed: false,
  lastScoreInt: -1,
  lockUntil: 0,       // ignore "primary" taps briefly after a crash
  // pass & play
  players: [],
  idx: 0,
  scores: [],
  passCount: 2,
};
const A = { gen: null, sim: null, dead: 0, themeT: 0 };   // attract-mode demo
const input = { left: false, right: false, touch: 0 };
const pointers = new Map();

// ---------------------------------------------------------------------------
// ATTRACT MODE - an autopilot plays behind the menus
// ---------------------------------------------------------------------------
function startAttract() {
  A.gen = new TrackGenerator(randomSeed());
  A.sim = new Sim(A.gen);
  A.dead = 0;
  view.track.setTrack(A.gen);
  view.track.update(A.sim.ball.z, 999);
  view.resetBall(A.sim.ball);
  view.setScore(0);
}

function attractStep(dt) {
  const sim = A.sim;
  sim.update(dt, sim.alive ? botSteer(sim) : 0);
  sim.events.length = 0;
  view.track.update(sim.ball.z);
  view.updateBall(sim.ball, dt, sim.alive);
  view.updateCamera(sim.ball, dt, sim.alive ? sim.speed : 0, sim.crash !== 'fall');
  view.updateDust(sim.ball);
  if ((A.themeT += dt) > 0.5) { A.themeT = 0; view.setScore(sim.score); }
  if (!sim.alive && (A.dead += dt) > 1.6) startAttract();
}

// ---------------------------------------------------------------------------
// RUN LIFECYCLE
// ---------------------------------------------------------------------------
function currentName() {
  if (G.mode === 'pass') return G.players[G.idx].name;
  return getName() || 'Player';
}

function beginRun() {
  audio.start();
  G.gen = new TrackGenerator(G.seed, TIERS[G.tier].mult);  // same seed + tier -> same course
  G.sim = new Sim(G.gen, TIERS[G.tier]);
  view.track.setTrack(G.gen);
  view.track.update(G.sim.ball.z, 999);
  view.resetBall(G.sim.ball);
  view.setScore(0);

  G.prevBest = getBest(G.tier);
  G.flashed = false;
  G.lastScoreInt = -1;
  G.state = 'playing';

  ui.show(null);
  ui.setHud(true);
  ui.setScore(0);
  ui.setBest(G.prevBest);
  const tl = TIERS[G.tier].label.toUpperCase();
  if (G.mode === 'seeded') ui.setBadge([['RACE', G.seed], ['SPEED', tl]]);
  else if (G.mode === 'pass') {
    ui.setBadge([['', currentName()], [`PLAYER ${G.idx + 1}/${G.players.length}`, ''], ['TRACK', G.seed], ['SPEED', tl]]);
  } else ui.setBadge([['TRACK', G.seed], ['SPEED', tl]]);
}

function runStep(dt) {
  const sim = G.sim;
  const playing = G.state === 'playing';
  const steer = playing ? Math.max(-1, Math.min(1, (input.right ? 1 : 0) - (input.left ? 1 : 0) + input.touch)) : 0;
  sim.update(dt, steer);

  for (const ev of sim.events) {
    if (ev.type === 'blip') { audio.blip(); ui.setScore(Math.floor(sim.score), true); }
    else if (ev.type === 'points') ui.pop(`+${ev.pts}`, ev.kind);
    else if (ev.type === 'land') { audio.land(ev.impact); if (ev.impact > 14) view.shake(0.18); }
  }
  sim.events.length = 0;

  view.track.update(sim.ball.z);
  view.updateBall(sim.ball, dt, sim.alive);
  view.updateCamera(sim.ball, dt, sim.alive ? sim.speed / sim.mult : 0, sim.crash !== 'fall');
  view.updateDust(sim.ball);

  if (playing) {
    const s = Math.floor(sim.score);
    if (s !== G.lastScoreInt) {
      G.lastScoreInt = s;
      ui.setScore(s);
      if ((s & 7) === 0) view.setScore(sim.score);
      if (s > G.prevBest) {
        ui.setBest(s);
        if (!G.flashed && G.prevBest > 0) { G.flashed = true; ui.flashBest(); audio.blip(); }
      }
    }
    audio.setSpeed(sim.speed / (V_MAX * sim.mult), !sim.ball.grounded);
  }

  if (playing && !sim.alive) {
    G.state = 'crashing';
    audio.stop();
    audio.crash();
    view.shake(sim.crash === 'fall' ? 0.6 : 1.4);
  }
  if (G.state === 'crashing' && sim.crashT > (sim.crash === 'fall' ? 1.0 : 1.15)) endRun();
}

function endRun() {
  const sim = G.sim;
  const score = Math.floor(sim.score);
  const isBest = score > G.prevBest;
  if (isBest) setBest(score, G.tier);
  const best = Math.max(score, G.prevBest);
  const name = currentName();
  const entry = { name, score, seed: G.seed, mode: G.mode, tier: G.tier };

  const rank = addScore(entry);
  if (G.mode === 'pass') G.scores.push({ name, score });

  G.state = 'gameover';
  G.lockUntil = performance.now() + 650;
  ui.setHud(false);
  $('goScore').textContent = score.toLocaleString();
  $('goBest').textContent = best.toLocaleString();
  $('goNewBest').classList.toggle('hidden', !isBest);

  // contextual info line + primary button label
  let info = `${TIERS[G.tier].label} speed` + (rank ? ` · #${rank} on this device's top 10` : '');
  const board = $('goBoard');
  board.replaceChildren();
  $('goShare').classList.add('hidden');
  if (G.mode === 'solo') {
    $('goGo').textContent = 'Press SPACE to retry';
  } else if (G.mode === 'seeded') {
    info = `Race code ${G.seed} · ${TIERS[G.tier].label} — send it to friends`;
    $('goGo').textContent = 'Press SPACE to retry';
    $('goShare').classList.remove('hidden');
    showSeedBoard(entry);
  } else {
    const last = G.idx >= G.players.length - 1;
    info = `${name}'s run · ${TIERS[G.tier].label}`;
    $('goGo').textContent = last ? 'Press SPACE for results' : `Next: ${G.players[G.idx + 1].name} — press SPACE`;
  }
  $('goInfo').textContent = info;
  ui.show('gameover');

  if (onlineEnabled) submitScore(entry).then(() => { if (G.mode === 'seeded') showSeedBoard(entry); });
}

/** Scoreboard for one race code: local entries first, online when available. */
async function showSeedBoard(entry) {
  const board = $('goBoard');
  const mine = (r) => r.name === entry.name && r.score === entry.score;
  const local = getBoard().filter((r) => r.seed === entry.seed && (r.tier || 'normal') === entry.tier).slice(0, 5);
  ui.renderRows(board, local, { title: `CODE ${entry.seed} — THIS DEVICE`, highlight: mine });
  if (!onlineEnabled) return;
  const rows = await topScores({ seed: entry.seed, limit: 5 });
  if (rows.length && G.state === 'gameover' && G.seed === entry.seed) {
    ui.renderRows(board, rows, { title: `CODE ${entry.seed} — EVERYONE`, highlight: mine });
  }
}

// ---------------------------------------------------------------------------
// FLOW
// ---------------------------------------------------------------------------
function toMenu() {
  audio.stop();
  G.state = 'menu';
  ui.setHud(false);
  ui.show('menu');
  startAttract();
  refreshBoard();
}

function startFromMenu() {
  audio.init();
  if (G.tab === 'pass') return startPass(false);
  G.mode = G.tab === 'seeded' ? 'seeded' : 'solo';
  setName(readName());
  if (G.mode === 'seeded') {
    G.seed = normalizeSeed($('seedInput').value) || randomSeed();
    $('seedInput').value = G.seed;
  } else {
    G.seed = randomSeed();
  }
  beginRun();
}

function readName() { return $('nameInput').value.trim().slice(0, 14); }

function startPass(rematchNewTrack) {
  audio.init();
  G.mode = 'pass';
  const names = readPassNames();
  setPlayers(names);
  G.players = names.map((name) => ({ name }));
  if (rematchNewTrack) {
    G.seed = randomSeed();
    $('passSeed').value = G.seed;
  } else if (!G.rematch) {
    G.seed = normalizeSeed($('passSeed').value) || randomSeed();
    $('passSeed').value = G.seed;
  }
  G.rematch = false;
  G.idx = 0;
  G.scores = [];
  showTurn();
}

function showTurn() {
  G.state = 'turn';
  const p = G.players[G.idx];
  $('turnCount').textContent = `PLAYER ${G.idx + 1} / ${G.players.length}`;
  $('turnName').textContent = p.name;
  $('turnSeed').textContent = G.seed;
  G.lockUntil = performance.now() + 300;
  ui.show('turn');
}

function showResults() {
  G.state = 'results';
  const rows = [...G.scores].sort((a, b) => b.score - a.score);
  const top = rows[0].score;
  const winners = rows.filter((r) => r.score === top);
  $('resBanner').textContent = winners.length > 1
    ? `🤝 TIE — ${winners.map((w) => w.name).join(' & ')}`
    : `🏆 ${winners[0].name} WINS!`;
  ui.renderRows($('resList'), rows, { highlight: (r) => r.score === top });
  $('resSeed').textContent = G.seed;
  G.lockUntil = performance.now() + 500;
  ui.show('results');
}

function afterGameOver() {
  if (G.mode === 'pass') {
    G.idx++;
    if (G.idx < G.players.length) showTurn(); else showResults();
  } else {
    if (G.mode === 'solo') G.seed = randomSeed();   // seeded keeps the same code
    beginRun();
  }
}

function togglePause() {
  if (G.state === 'playing') {
    G.state = 'paused';
    audio.stop();
    ui.show('pause');
  } else if (G.state === 'paused') {
    resume();
  }
}
function resume() {
  G.state = 'playing';
  audio.start();
  ui.show(null);
}

/** Space / Enter / tap on a big panel. */
function primaryAction() {
  audio.init();
  if (performance.now() < G.lockUntil) return;
  switch (G.state) {
    case 'menu': startFromMenu(); break;
    case 'turn': beginRun(); break;
    case 'gameover': afterGameOver(); break;
    case 'results': G.rematch = true; startPass(false); break;
    case 'paused': resume(); break;
    default: break;
  }
}

function toggleMute() {
  audio.init();
  audio.setMuted(!audio.muted);
  setMuted(audio.muted);
  ui.setMuteIcons(audio.muted);
}

// ---------------------------------------------------------------------------
// MENU WIRING
// ---------------------------------------------------------------------------
function setTab(tab) {
  G.tab = tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  for (const t of ['solo', 'seeded', 'pass', 'board']) $('pane-' + t).classList.toggle('hidden', t !== tab);
  $('nameRow').classList.toggle('hidden', tab === 'pass' || tab === 'board');
  if (tab === 'board') refreshBoard();
}

let boardKind = 'local';
async function refreshBoard() {
  const el = $('boardList');
  if (boardKind === 'local') {
    ui.renderRows(el, getBoard(), { showSeed: true, highlight: () => false });
    return;
  }
  el.textContent = 'Loading…';
  const rows = await topScores({ limit: 10 });
  if (boardKind === 'online') {
    ui.renderRows(el, rows, { showSeed: true, empty: 'No online scores yet — be the first!' });
  }
}

function renderPassInputs() {
  const wrap = $('pnames');
  const saved = getPlayers();
  const old = [...wrap.querySelectorAll('input')].map((i) => i.value);
  wrap.replaceChildren();
  for (let i = 0; i < G.passCount; i++) {
    const row = document.createElement('div');
    row.className = 'pname';
    const n = document.createElement('span'); n.textContent = `${i + 1}`;
    const inp = document.createElement('input');
    inp.maxLength = 14; inp.placeholder = `Player ${i + 1}`; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.value = old[i] ?? saved[i] ?? '';
    row.append(n, inp);
    wrap.append(row);
  }
  document.querySelectorAll('#pcount button').forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === G.passCount));
}

function readPassNames() {
  return [...$('pnames').querySelectorAll('input')].map((inp, i) => inp.value.trim().slice(0, 14) || `Player ${i + 1}`);
}

function inviteLink(seed) {
  return `${location.origin}${location.pathname}?seed=${encodeURIComponent(seed)}&tier=${G.tier}`;
}

async function shareSeed(seed, btn) {
  const url = inviteLink(seed);
  if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
    try { await navigator.share({ title: 'Neon Slope race', text: `Race me on code ${seed}!`, url }); return; } catch { /* fall through */ }
  }
  const ok = await copyText(url);
  flashLabel(btn, ok ? '✓ Link copied' : url, ok ? 1400 : 4000);
}

function setTierButtons() {
  document.querySelectorAll('#tierSeg button').forEach((b) => b.classList.toggle('on', b.dataset.tier === G.tier));
}

function wireMenu() {
  document.querySelectorAll('#tierSeg button').forEach((b) => b.addEventListener('click', () => {
    G.tier = b.dataset.tier;
    setTier(G.tier);
    setTierButtons();
  }));
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // players 2..6
  const seg = $('pcount');
  for (let n = 2; n <= 6; n++) {
    const b = document.createElement('button');
    b.textContent = n; b.dataset.n = n;
    b.addEventListener('click', () => { G.passCount = n; renderPassInputs(); });
    seg.append(b);
  }
  renderPassInputs();

  $('seedDice').onclick = () => { $('seedInput').value = randomSeed(); };
  $('passDice').onclick = () => { $('passSeed').value = randomSeed(); };
  $('seedCopy').onclick = () => {
    const s = normalizeSeed($('seedInput').value) || randomSeed();
    $('seedInput').value = s;
    shareSeed(s, $('seedCopy'));
  };
  $('goShare').onclick = () => shareSeed(G.seed, $('goShare'));
  for (const id of ['seedInput', 'passSeed']) {
    $(id).addEventListener('input', (e) => { e.target.value = normalizeSeed(e.target.value); });
  }

  document.querySelectorAll('#boardSeg button').forEach((b) => b.addEventListener('click', () => {
    boardKind = b.dataset.b;
    document.querySelectorAll('#boardSeg button').forEach((x) => x.classList.toggle('on', x === b));
    refreshBoard();
  }));
  if (!onlineEnabled) $('boardOnlineBtn').classList.add('hidden');

  $('cta').onclick = primaryAction;
  $('turnGo').onclick = primaryAction;
  $('goGo').onclick = primaryAction;
  $('resSame').onclick = primaryAction;
  $('resNew').onclick = () => { if (performance.now() > G.lockUntil) startPass(true); };
  for (const id of ['turnMenu', 'goMenu', 'resMenu', 'pMenu']) $(id).onclick = toMenu;
  $('pResume').onclick = resume;
  $('pMute').onclick = toggleMute;
  $('btnMute').onclick = toggleMute;
  $('btnPause').onclick = togglePause;

  // tapping empty areas of a big panel (or the dimmed backdrop) = primary action
  $('overlay').addEventListener('click', (e) => {
    if (e.target.closest('button, input, label, .tabs, .seg, .board, .field')) return;
    if (e.target === $('overlay') || e.target.closest('[data-tap]')) primaryAction();
  });
  // drop focus after a button click so Space never "double fires" it
  document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); });

  $('nameInput').value = getName();
  ui.setMuteIcons(audio.muted);

  // invite links: ?seed=FUN42 opens the Seeded Race tab with the code filled in
  const q = new URLSearchParams(location.search);
  const qs = normalizeSeed(q.get('seed'));
  if (TIERS[q.get('tier')]) { G.tier = q.get('tier'); setTier(G.tier); }
  setTierButtons();
  $('seedInput').value = qs || randomSeed();
  $('passSeed').value = randomSeed();
  if (qs) setTab('seeded'); else setTab('solo');
}

// ---------------------------------------------------------------------------
// INPUT
// ---------------------------------------------------------------------------
const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');

addEventListener('keydown', (e) => {
  if (isTyping(e.target)) {
    if (e.key === 'Enter' && (G.state === 'menu')) { e.preventDefault(); e.target.blur(); primaryAction(); }
    return;
  }
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': input.left = true; e.preventDefault(); break;
    case 'ArrowRight': case 'KeyD': input.right = true; e.preventDefault(); break;
    case 'Space': case 'Enter':
      if (e.target.closest && e.target.closest('button')) return; // let the focused button click itself
      e.preventDefault();
      if (!e.repeat) primaryAction();
      break;
    case 'KeyP': case 'Escape': if (!e.repeat) togglePause(); break;
    case 'KeyM': if (!e.repeat) toggleMute(); break;
    default: break;
  }
});
addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false;
});

// touch / mouse: hold the left or right half of the screen
function updateTouch() {
  let l = false, r = false;
  for (const x of pointers.values()) { if (x < innerWidth / 2) l = true; else r = true; }
  input.touch = (r ? 1 : 0) - (l ? 1 : 0);
}
const gl = $('gl');
gl.addEventListener('pointerdown', (e) => {
  audio.init();
  pointers.set(e.pointerId, e.clientX);
  updateTouch();
  try { gl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
});
gl.addEventListener('pointermove', (e) => { if (pointers.has(e.pointerId)) { pointers.set(e.pointerId, e.clientX); updateTouch(); } });
for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  gl.addEventListener(t, (e) => { pointers.delete(e.pointerId); updateTouch(); });
}
gl.addEventListener('contextmenu', (e) => e.preventDefault());

// auto-pause when the tab loses focus
const autoPause = () => { if (G.state === 'playing') togglePause(); input.left = input.right = false; pointers.clear(); updateTouch(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
addEventListener('blur', autoPause);

// ---------------------------------------------------------------------------
// MAIN LOOP
// ---------------------------------------------------------------------------
function tick(dt, frameMs) {
  switch (G.state) {
    case 'playing': case 'crashing': case 'gameover': runStep(dt); break;
    case 'paused': break;
    default: attractStep(dt);
  }
  view.render(frameMs);
}

let last = performance.now();
function frame(now) {
  const raw = now - last;
  last = now;
  tick(Math.min(raw / 1000, 0.05), raw);
  requestAnimationFrame(frame);
}

wireMenu();
startAttract();
ui.show('menu');
requestAnimationFrame(frame);

// handy for debugging in the console
window.__slope = { G, view, tick };
