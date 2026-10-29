// =============================================================================
// SUPABASE (optional online leaderboard + per-seed race scoreboard)
// If the env vars are missing the game still works fully offline; online
// features simply hide themselves.
// =============================================================================
import { createClient } from '@supabase/supabase-js';

const env = import.meta.env || {};
const URL = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;

export const onlineEnabled = !!(URL && KEY);
const sb = onlineEnabled ? createClient(URL, KEY, { auth: { persistSession: false } }) : null;

/** Save a finished run. Fire-and-forget; never throws. */
export async function submitScore({ name, score, seed, mode }) {
  if (!sb || score < 10) return false;
  try {
    const { error } = await sb.from('scores').insert({
      name: (name || 'Player').slice(0, 14),
      score: Math.floor(score),
      seed: seed || null,
      mode,
    });
    return !error;
  } catch { return false; }
}

/** Top scores overall, or only for one seed code (a "seeded race" scoreboard). */
export async function topScores({ seed = null, limit = 10 } = {}) {
  if (!sb) return [];
  try {
    let q = sb.from('scores').select('name,score,seed,mode,created_at')
      .order('score', { ascending: false }).limit(limit);
    if (seed) q = q.eq('seed', seed);
    const { data, error } = await q;
    return error ? [] : data || [];
  } catch { return []; }
}
