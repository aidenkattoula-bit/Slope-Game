# Neon Slope

Endless 3D ball-rolling game (Three.js + Vite) with Supabase for online scores.
Modes: Solo, Seeded Race (share a code), Pass & Play (2–6 players), local + online leaderboards.

## Deploy: step by step

### 1. Supabase (database)
1. Open your project at https://supabase.com/dashboard → **SQL Editor → New query**.
2. Paste all of `supabase/schema.sql` and click **Run**. (It drops and recreates the `scores` table, so it's safe to re-run.)
3. Go to **Project Settings → API** and copy:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon / public** key (never the `service_role` key)

### 2. Run locally (needs Node 18+)
```bash
npm install
cp .env.example .env.local     # paste the URL + anon key
npm run dev                    # http://localhost:5173
```
Without the env vars the game still works; online features just hide.

### 3. Push to GitHub
```bash
git init && git add . && git commit -m "Neon Slope"
git branch -M main
git remote add origin https://github.com/YOUR-USER/neon-slope.git
git push -u origin main
```

### 4. Vercel
1. https://vercel.com/new → import the repo. Framework preset: **Vite** (auto-detected; build `npm run build`, output `dist`).
2. Before deploying, open **Environment Variables** and add (all environments):
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
3. Click **Deploy**. If you add or change variables later, **Redeploy** (Vite bakes them in at build time).

CLI alternative: `npm i -g vercel && vercel --prod`, then `vercel env add VITE_SUPABASE_URL` and `vercel env add VITE_SUPABASE_ANON_KEY`, and redeploy.

### 5. Test
- Play a run; the score should appear in Supabase → Table Editor → `scores`, and in the Leaderboard tab → Online.
- Seeded Race: enter a code (e.g. `FUN42`) or press 🎲, then **Copy invite link**. Friends opening `https://your-app.vercel.app/?seed=FUN42` land on the same track.

## Notes
- Row Level Security lets anyone read and insert scores but never update or delete. Scores are client-submitted, so a determined cheater can post fake ones; for a casual game that's fine.
- `npm run test:bot` (Node) runs an autopilot over many seeds to check determinism and that every course is beatable.

## Code map
| File | Role |
|---|---|
| `src/rng.js` | Seeded RNG, seed codes |
| `src/track.js` | Procedural track generator (curves, gaps, ramps, drops, obstacles) |
| `src/physics.js` | Ball physics, collisions, autopilot |
| `src/trackview.js` | Meshes per chunk; disposes old ones |
| `src/scene.js`, `src/theme.js` | Renderer, camera, ball, trail, bloom, colour themes |
| `src/audio.js` | Web Audio sounds |
| `src/ui.js`, `src/style.css`, `index.html` | UI |
| `src/storage.js`, `src/net.js` | localStorage, Supabase |
| `src/main.js` | Game state machine |
