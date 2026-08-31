/**
 * The swarm's bind curve, extracted so `/docs` can hold a formed shape and `/landing`
 * can keep cycling — and so a test can drive the same numbers the canvas uses.
 *
 * `t` is the phase inside one period, 0…1. Landing forms, holds, then releases back to
 * orbit. Stay-formed forms once and stays at full bind; leftover particles keep orbiting
 * around the shape. That residual motion is not a second bind curve.
 */

export const SWARM_PERIOD = 4500;
export const SWARM_FORM_AT = 0.32;
export const SWARM_HOLD_UNTIL = 0.74;
export const SWARM_RELEASE_UNTIL = 0.94;
export const SWARM_HOLD_AT_MS = SWARM_PERIOD * 0.5;

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

/** How tightly seated particles sit on their targets at phase `t`. */
export function swarmBind(t: number, stayFormed = false): number {
  let raw: number;
  if (stayFormed) {
    raw = t < SWARM_FORM_AT ? t / SWARM_FORM_AT : 1;
  } else if (t < SWARM_FORM_AT) {
    raw = t / SWARM_FORM_AT;
  } else if (t < SWARM_HOLD_UNTIL) {
    raw = 1;
  } else if (t < SWARM_RELEASE_UNTIL) {
    raw = 1 - (t - SWARM_HOLD_UNTIL) / (SWARM_RELEASE_UNTIL - SWARM_HOLD_UNTIL);
  } else {
    raw = 0;
  }
  return smoothstep(raw);
}

/**
 * The animation clock. Stay-formed freezes at the hold so the cycle never reaches
 * release. Landing still pauses once for `intro` milliseconds, then continues.
 */
export function swarmClock(now: number, intro: number, stayFormed = false): number {
  if (stayFormed) {
    return now < SWARM_HOLD_AT_MS ? now : SWARM_HOLD_AT_MS;
  }
  if (now < SWARM_HOLD_AT_MS) return now;
  if (now < SWARM_HOLD_AT_MS + intro) return SWARM_HOLD_AT_MS;
  return now - intro;
}
