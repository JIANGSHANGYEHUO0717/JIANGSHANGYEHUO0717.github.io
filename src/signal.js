export const INITIAL_SIGNAL = {
  motion: 0,
  symmetry: 1,
  direction: 0,
  directionLabel: "静止",
  directionVector: { x: 0, y: 0 },
  occlusion: 0,
  hold: 0,
  circularSpeed: 0,
  circularDirection: 1,
  circularEvidence: 0,
  armSpread: 0,
  escapeVelocity: 0,
  escape: 0,
  handCommand: "fist",
  handConfidence: 0,
};

const KEY_POINTS = [11, 12, 13, 14, 15, 16];
const PAIRS = [[11, 12], [13, 14], [15, 16]];
const WEIGHTS = { 11: .08, 12: .08, 13: .16, 14: .16, 15: .26, 16: .26 };
export const UPPER_CONNECTIONS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];
export const UPPER_POINTS = KEY_POINTS;

export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const mix = (a, b, amount) => a + (b - a) * amount;
const smoothstep = (start, end, value) => {
  const t = clamp((value - start) / Math.max(.0001, end - start));
  return t * t * (3 - 2 * t);
};

function directionName(x, y) {
  if (Math.hypot(x, y) < .003) return "静止";
  const names = ["东", "东北", "北", "西北", "西", "西南", "南", "东南"];
  const angle = (Math.atan2(-y, x) + Math.PI * 2) % (Math.PI * 2);
  return names[Math.round(angle / (Math.PI / 4)) % 8];
}

export function computeSignal(points, previous, dt, old) {
  if (!points?.length) {
    return {
      ...old,
      motion: mix(old.motion, 0, .14),
      occlusion: mix(old.occlusion, 1, .26),
      hold: 0,
      circularSpeed: mix(old.circularSpeed, 0, .045),
      circularEvidence: mix(old.circularEvidence ?? 0, 0, .07),
      armSpread: mix(old.armSpread, 0, .05),
      escapeVelocity: 0,
      escape: 0,
    };
  }
  const shoulderSpan = Math.max(.08, Math.hypot(points[11].x - points[12].x, points[11].y - points[12].y));
  let displacement = 0;
  let count = 0;
  let vx = 0;
  let vy = 0;
  if (previous?.length) {
    KEY_POINTS.forEach((index) => {
      const current = points[index];
      const before = previous[index];
      if ((current.visibility ?? 1) > .3 && (before.visibility ?? 1) > .3) {
        displacement += Math.hypot(current.x - before.x, current.y - before.y) / shoulderSpan;
        count += 1;
      }
    });
    [15, 16].forEach((index) => {
      vx += points[index].x - previous[index].x;
      vy += points[index].y - previous[index].y;
    });
  }
  const rawMotion = clamp((displacement / Math.max(1, count)) * (52 / Math.max(16, dt)) * 2.55);
  const motion = mix(old.motion, rawMotion, .27);
  const centerX = (points[11].x + points[12].x) / 2;
  let symmetryError = 0;
  PAIRS.forEach(([left, right]) => {
    const mirroredX = centerX * 2 - points[left].x;
    symmetryError += (Math.abs(mirroredX - points[right].x) + Math.abs(points[left].y - points[right].y) * .65) / shoulderSpan;
  });
  const symmetry = mix(old.symmetry, clamp(1 - symmetryError / PAIRS.length * 1.5), .18);
  const rawOcclusion = KEY_POINTS.reduce((sum, index) => {
    const point = points[index];
    if (!point) return sum + WEIGHTS[index];
    const confidence = Math.min(point.visibility ?? 1, point.presence ?? 1);
    const confidenceLoss = clamp((.72 - confidence) / .42);
    const edgeDistance = Math.min(point.x, 1 - point.x, point.y, 1 - point.y);
    const edgeLoss = clamp((.035 - edgeDistance) / .035);
    return sum + Math.max(confidenceLoss, edgeLoss) * WEIGHTS[index];
  }, 0);
  const occlusion = mix(old.occlusion, rawOcclusion, .32);
  const direction = mix(old.direction, clamp(Math.hypot(vx, vy) * 35), .24);
  const hold = motion < .052 && occlusion < .22 ? Math.min(9.9, old.hold + dt / 1000) : Math.max(0, old.hold - dt / 330);
  const leftScreenWrist = Math.min(points[15].x, points[16].x);
  const rightScreenWrist = Math.max(points[15].x, points[16].x);
  const leftExtent = (centerX - leftScreenWrist) / shoulderSpan;
  const rightExtent = (rightScreenWrist - centerX) / shoulderSpan;
  const rawArmSpread = Math.min(smoothstep(.72, 2.25, leftExtent), smoothstep(.72, 2.25, rightExtent));
  const armSpread = mix(old.armSpread, rawArmSpread, .2);

  const shoulderY = (points[11].y + points[12].y) / 2;
  const leftLift = smoothstep(.18, 1.35, (shoulderY - points[15].y) / shoulderSpan);
  const rightLift = smoothstep(.18, 1.35, (shoulderY - points[16].y) / shoulderSpan);
  const secondaryLift = Math.min(leftLift, rightLift);
  const singleArmGate = (1 - smoothstep(.18, .62, secondaryLift)) * (1 - smoothstep(.2, .72, rawArmSpread));
  const raisedArmStrength = Math.max(leftLift, rightLift) * singleArmGate;
  const circularEvidence = mix(old.circularEvidence ?? 0, raisedArmStrength, raisedArmStrength > (old.circularEvidence ?? 0) ? .3 : .085);
  const circularSpeed = mix(old.circularSpeed, raisedArmStrength, raisedArmStrength > old.circularSpeed ? .3 : .075);
  const raisedDirection = leftLift > rightLift ? -1 : 1;
  const circularDirection = raisedArmStrength > .04
    ? mix(old.circularDirection, raisedDirection, .42)
    : old.circularDirection;
  return {
    motion,
    symmetry,
    direction,
    directionLabel: directionName(vx, vy),
    directionVector: { x: mix(old.directionVector.x, vx * 28, .25), y: mix(old.directionVector.y, vy * 28, .25) },
    occlusion,
    hold,
    circularSpeed,
    circularDirection,
    circularEvidence,
    armSpread,
    // Wrist separation remains diagnostic only; fingers now control escape.
    escapeVelocity: 0,
    escape: 0,
  };
}

export function makeDemoPose(now) {
  const t = now / 1000;
  const cycle = t % 18;
  const pose = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1, presence: 1 }));
  const set = (i, x, y, visibility = 1) => { pose[i] = { x, y, z: 0, visibility, presence: visibility }; };
  set(11, .43, .36); set(12, .57, .36);
  if (cycle > 2 && cycle < 6.8) {
    const lift = smoothstep(2, 3.1, cycle) * (1 - smoothstep(6.0, 6.8, cycle));
    set(13, .41, .5); set(15, .45, .57);
    set(14, .59 + lift * .035, .5 - lift * .18);
    set(16, .56 + lift * .035, .57 - lift * .47);
  } else if (cycle > 8.2 && cycle < 15.6) {
    const spread = smoothstep(8.2, 9.9, cycle) * (1 - smoothstep(14.7, 15.6, cycle));
    set(13, .41 - spread * .11, .49);
    set(14, .59 + spread * .11, .49);
    set(15, .45 - spread * .31, .54 - spread * .04);
    set(16, .55 + spread * .31, .54 - spread * .04);
  } else {
    set(13, .41, .5); set(14, .59, .5);
    set(15, .45, .57); set(16, .55, .57);
  }
  return pose;
}
