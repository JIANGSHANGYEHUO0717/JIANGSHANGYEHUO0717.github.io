export const ENTRY_SECONDS = 4.2;

const smooth = (start, end, value) => {
  const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

// Independent of frame rate; completion never depends on a CSS animation event.
export function entryMotionAt(elapsed, reducedMotion = false) {
  const duration = reducedMotion ? 0.85 : ENTRY_SECONDS;
  const progress = Math.min(1, Math.max(0, elapsed / duration));
  return {
    progress,
    focus: reducedMotion ? 1 : smooth(0.08, 0.76, progress),
    surface: smooth(0.42, 0.96, progress),
    points: 1 - smooth(0.68, 1, progress),
    complete: progress >= 1,
  };
}
