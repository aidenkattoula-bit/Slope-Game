// =============================================================================
// LOCAL STORAGE - high score, top-10 local leaderboard, name, mute flag.
// Everything is wrapped in try/catch (private mode / blocked storage).
// =============================================================================
const K = {
  best: 'neonslope.best',
  board: 'neonslope.board',
  name: 'neonslope.name',
  muted: 'neonslope.muted',
  players: 'neonslope.players',
};

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export const getBest = (tier = 'normal') => Number(read(`${K.best}.${tier}`, 0)) || 0;
export const setBest = (n, tier = 'normal') => write(`${K.best}.${tier}`, n);

export const getTier = () => String(read('neonslope.tier', 'normal'));
export const setTier = (t) => write('neonslope.tier', t);

export const getName = () => String(read(K.name, '') || '');
export const setName = (n) => write(K.name, n);

export const getMuted = () => !!read(K.muted, false);
export const setMuted = (m) => write(K.muted, !!m);

export const getPlayers = () => {
  const p = read(K.players, null);
  return Array.isArray(p) ? p : [];
};
export const setPlayers = (p) => write(K.players, p);

export const getBoard = () => {
  const b = read(K.board, []);
  return Array.isArray(b) ? b : [];
};

/** Insert a score, keep the top 10. Returns the 1-based rank, or 0 if it missed. */
export function addScore({ name, score, seed, mode, tier = 'normal' }) {
  const board = getBoard();
  const entry = { name: (name || 'Player').slice(0, 14), score, seed, mode, tier, at: Date.now() };
  board.push(entry);
  board.sort((a, b) => b.score - a.score || a.at - b.at);
  const top = board.slice(0, 10);
  write(K.board, top);
  const idx = top.indexOf(entry);
  return idx === -1 ? 0 : idx + 1;
}
