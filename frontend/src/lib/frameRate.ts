/** Frame rates the director can pick in the HUD; the scene draws no faster than this. */
export const FPS_OPTIONS = [15, 30, 60] as const;
export type Fps = (typeof FPS_OPTIONS)[number];
export const DEFAULT_FPS: Fps = 30;

/** How early a frame may come (the browser's own frames never land exactly on the interval). */
const SLACK_MS = 3;

export function parseFps(value: string | null | undefined): Fps {
  const n = Number(value);
  return (FPS_OPTIONS as readonly number[]).includes(n) ? (n as Fps) : DEFAULT_FPS;
}

/**
 * Called on every browser animation frame: the time of the frame to draw now, or null to skip it.
 * Keeps the rhythm (`last + interval`) so the average rate is the chosen one on any display refresh rate;
 * after a long gap (a hidden tab) it starts again from now. A hidden page never draws.
 */
export function nextFrame(now: number, last: number, fps: number, hidden: boolean): number | null {
  if (hidden) return null;
  const interval = 1000 / fps;
  if (now - last < interval - SLACK_MS) return null;
  return now - last > 2 * interval ? now : last + interval;
}
