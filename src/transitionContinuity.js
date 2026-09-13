// Transport live particles between renderers; never reconstruct an intact C04
// as the source of the return journey.
export const ARCHIVE_FADE_SECONDS = 2;

export function captureEscapeParticles({ positions, velocities, lifeValues, seeds }) {
  const visible = [];
  for (let i = 0; i < lifeValues.length; i += 1) {
    if (lifeValues[i] > .002) visible.push(i);
  }
  const result = {
    positions: new Float32Array(visible.length * 3),
    velocities: new Float32Array(visible.length * 3),
    alphas: new Float32Array(visible.length),
    seeds: new Float32Array(visible.length),
  };
  visible.forEach((source, i) => {
    result.positions.set(positions.subarray(source * 3, source * 3 + 3), i * 3);
    result.velocities.set(velocities.subarray(source * 3, source * 3 + 3), i * 3);
    result.alphas[i] = lifeValues[source];
    result.seeds[i] = seeds[source];
  });
  return result;
}

export function seedMorphFromEscape(snapshot, count) {
  const sourceCount = snapshot?.alphas?.length ?? 0;
  if (!sourceCount) throw new Error("缺少可接续的逃逸颗粒");
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const alphas = new Float32Array(count);
  const seeds = new Float32Array(count);
  const original = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    // Existing particles appear exactly once. Added density is born invisibly
    // inside the dispersed volume, not sampled from the original model.
    const source = i % sourceCount;
    const isOriginal = i < sourceCount;
    for (let axis = 0; axis < 3; axis += 1) {
      const offset = isOriginal ? 0 : Math.sin(i * 2.399 + axis * 2.17) * .055;
      positions[i * 3 + axis] = snapshot.positions[source * 3 + axis] + offset;
      velocities[i * 3 + axis] = snapshot.velocities[source * 3 + axis];
    }
    alphas[i] = snapshot.alphas[source];
    seeds[i] = isOriginal ? snapshot.seeds[source] : (i * .61803398875) % 1;
    original[i] = isOriginal ? 1 : 0;
  }
  return { positions, velocities, alphas, seeds, original };
}

export function returnCloudColor(rgb, id) {
  if (id !== "C01" && id !== "C04") return [...rgb];
  // Reduce chroma by 15%, preserving linear luminance (not exposure).
  const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  return rgb.map(channel => luminance + (channel - luminance) * .85);
}
