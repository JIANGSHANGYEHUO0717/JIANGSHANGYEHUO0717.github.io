import { C04_DISSOLVE } from "./c04Dissolve.js";

const clamp = x => Math.max(0, Math.min(1, x));
export const HAND_ESCAPE_TIMING = Object.freeze({ pointCloud: 7, escape: 7, recall: 6, restore: 5 });
export const createHandEscapeState = () => ({ cloud: 0, escape: 0, recalling: false, stage: "原型" });

// Two overlapping fronts: each region becomes fine points before it detaches.
// The recognizer carries its last confirmed command through uncertainty.
// Surface restoration waits for the actual particles to land.
export function advanceHandEscape(old, command, rawDt, activeParticles = 0, pendingReturnPhase = null) {
  const dt = Math.min(.05, Math.max(0, rawDt));
  let { cloud, escape } = old;
  let recalling = old.recalling;
  if (command === "open") {
    recalling = false;
    cloud = clamp(cloud + dt / HAND_ESCAPE_TIMING.pointCloud);
    if (cloud > C04_DISSOLVE.frontLag) escape = clamp(escape + dt / HAND_ESCAPE_TIMING.escape);
  } else if (command === "fist" || command === "lost") {
    recalling = true;
    const speed = command === "lost" ? .65 : 1;
    escape = clamp(escape - dt * speed / HAND_ESCAPE_TIMING.recall);
    // Rebuild from the base upward as particles actually arrive. Never reveal
    // a solid region whose particles are still away, nor wait for the crown
    // before restoring an already gathered base.
    const pendingFloor = activeParticles > 0
      ? pendingReturnPhase === null ? cloud : clamp(pendingReturnPhase + C04_DISSOLVE.pointEnd)
      : 0;
    cloud = Math.min(cloud, Math.max(pendingFloor, escape, cloud - dt * speed / HAND_ESCAPE_TIMING.restore));
  } else {
    // No confirmed hand yet: leave the initial specimen unchanged.
    recalling = false;
  }
  const stage = escape > 0 || activeParticles > 0
    ? (recalling ? "由下至上回凝" : cloud < 1 ? "点云化 · 局部逃逸" : "颗粒逃逸")
    : cloud > 0 ? (recalling ? "点云回凝" : "阶段一 · 点云化") : "原型";
  return { cloud, escape, recalling, stage };
}
