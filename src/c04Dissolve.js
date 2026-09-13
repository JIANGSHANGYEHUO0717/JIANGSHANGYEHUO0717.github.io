// The same local front drives surface replacement, fine points and emission.
// A converted upper region can detach while lower regions remain physical.
export const C04_DISSOLVE = Object.freeze({
  pointStart: .015, pointEnd: .085, detachStart: .04, detachEnd: .22, frontLag: .12,
});

export function emissionPhaseWindow(cloud, escape) {
  return {
    min: escape - C04_DISSOLVE.detachEnd,
    max: Math.min(cloud - C04_DISSOLVE.pointEnd, escape - C04_DISSOLVE.detachStart),
  };
}

// Broad variations break up a horizontal cut without creating lit fragments.
export function c04PhaseDetail(x, y, z) {
  return .030 * Math.sin(x * 17 + z * 13) + .020 * Math.sin(y * 21 - x * 9 + z * 19);
}

export const C04_DISSOLVE_GLSL = `
  float c04PhaseDetail(vec3 p) {
    return .030*sin(p.x*17.0+p.z*13.0)+.020*sin(p.y*21.0-p.x*9.0+p.z*19.0);
  }
  float c04Converted(float phase, float cloud) {
    return smoothstep(phase+${C04_DISSOLVE.pointStart},phase+${C04_DISSOLVE.pointEnd},cloud);
  }
  float c04Detached(float phase, float cloud, float escape) {
    return c04Converted(phase,cloud)*smoothstep(phase+${C04_DISSOLVE.detachStart},phase+${C04_DISSOLVE.detachEnd},escape);
  }
`;
