// =============================================================================
// GAME CONSTANTS + DIFFICULTY CURVES
// Speed and difficulty are pure functions of *distance travelled*, never of
// wall-clock time. That keeps a seeded track identical and equally fair for
// every player on every device (and lets the generator size jumps correctly).
// =============================================================================

export const DZ = 2;               // distance between track "rows" (units)
export const ROWS_PER_CHUNK = 16;  // rows per mesh chunk
export const BALL_R = 0.6;
export const GRAVITY = 32;
export const SLOPE = 0.3;          // track descends 0.3 units per unit forward
export const RAMP_M = 0.45;        // ramp gradient relative to the base slope
export const TRACK_THICK = 1.4;
export const OBST_H = 1.5;         // obstacle height
export const START_D = 6;          // distance of the ball's start from row 0
export const EDGE_TOL = 0.15;      // ball may overhang the edge this much

export const V0 = 16;              // starting speed (units/s)
export const V_MAX = 46;
export const V_RAMP = 0.0065;      // speed gained per unit distance

export const speedAt = (d) => Math.min(V_MAX, V0 + V_RAMP * Math.max(0, d));
export const difficultyAt = (d) => Math.min(1, Math.max(0, d / 5000));
/** Score gained per unit of distance (faster = more points per unit). */
export const scorePerUnit = (v) => 0.35 + v / 110;
