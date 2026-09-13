// Authored static geology. No image/video input, temporal noise, lines or trails.
import { dramaticLighting } from './lighting.js';
export const SETTINGS = Object.freeze({
  seed: 83026, radiusX: 11.6, radiusZ: 10.2,
  fieldSize: 513, pointColumns: 600, pointRows: 500,
  pointSize: 2.25, pointOpacity: 1.18, secondsPerTurn: 180,
});

export const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
export const mix = (a, b, t) => a + (b - a) * t;
export function smooth(a, b, n) {
  const t = clamp((n - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export function hash(x, z, seed = SETTINGS.seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
function gradient(x, z, dx, dz, seed) {
  const h = Math.floor(hash(x, z, seed) * 8);
  return [dx, -dx, dz, -dz, (dx + dz) * .7071, (dx - dz) * .7071,
    (-dx + dz) * .7071, (-dx - dz) * .7071][h];
}
export function noise(x, z, seed = SETTINGS.seed) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  return mix(mix(gradient(ix, iz, fx, fz, seed), gradient(ix + 1, iz, fx - 1, fz, seed), fade(fx)),
    mix(gradient(ix, iz + 1, fx, fz - 1, seed), gradient(ix + 1, iz + 1, fx - 1, fz - 1, seed), fade(fx)), fade(fz)) * 1.65;
}

// Selected visual: outputs/terrain-concepts-20260830-round-mounds/option-2.png.
// Five principal mounds and two very low swells; the center stays open.
// [centerX, centerZ, height, radiusX, radiusZ, rotationRadians]
const MOUNDS = [
  [-6.1,-4.2,2.08,3.8,2.7,.10],
  [7.0,-3.8,1.25,1.85,1.9,-.30],
  [9.0,-2.0,.95,1.60,1.45,.45],
  [-8.5,3.40,.75,2.0,1.85,-.25],
  [5.2,5.3,1.0,3.7,2.2,.10],
  [-4.65,5.7,.45,1.20,.95,.30],
  [-3.0,5.4,.43,1.35,1.05,-.35],
].map(([x,z,height,rx,rz,angle]) => ({x,z,height,rx,rz,c:Math.cos(angle),s:Math.sin(angle)}));

export function heightAt(x, z) {
  const wx = x + noise(x * .28 + 4, z * .28 - 2, 1451) * .18;
  const wz = z + noise(x * .31 - 3, z * .31 + 5, 1459) * .18;
  let sum = 0;
  for (const mound of MOUNDS) {
    const px=wx-mound.x, pz=wz-mound.z;
    const u=(px*mound.c+pz*mound.s)/mound.rx;
    const v=(-px*mound.s+pz*mound.c)/mound.rz;
    const height=mound.height*Math.exp(-1.4*(u*u+v*v));
    // Smooth overlap gives rounded saddles instead of sharp intersection seams.
    sum += height*height*height;
  }
  const macro = Math.cbrt(sum) + noise(wx*.24,wz*.24,1471)*.05;
  const roughness = noise(wx*.80,wz*.80,1481)*.07
    + noise(wx*2.2,wz*2.2,1487)*.032
    + noise(wx*5.3,wz*5.3,1493)*.010;
  return macro + roughness - .20;
}

export function edgeAt(x, z) {
  const radius = Math.hypot(x / SETTINGS.radiusX, z / SETTINGS.radiusZ);
  const irregularity = noise(x * .37, z * .37, 1801) * .045 + noise(x * .92, z * .92, 1811) * .015;
  return 1 - smooth(.70, 1.0, radius + irregularity);
}

export function buildHeightField(size = SETTINGS.fieldSize) {
  const width = SETTINGS.radiusX * 2.14, depth = SETTINGS.radiusZ * 2.14;
  const values = new Float32Array(size * size);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      values[row * size + col] = heightAt((col / (size - 1) - .5) * width, (row / (size - 1) - .5) * depth);
    }
  }
  return { values, size, width, depth };
}

// Same triangles as the occluder, not a different analytic/filtered surface.
export function sampleHeight(field, x, z) {
  const gx = clamp((x / field.width + .5) * (field.size - 1), 0, field.size - 1.00001);
  const gz = clamp((z / field.depth + .5) * (field.size - 1), 0, field.size - 1.00001);
  const col = Math.floor(gx), row = Math.floor(gz), u = gx - col, v = gz - row;
  const i = row * field.size + col, a = field.values[i], b = field.values[i + 1];
  const c = field.values[i + field.size], d = field.values[i + field.size + 1];
  return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
}

const srgb = n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
export function generateTerrain(field, columns = SETTINGS.pointColumns, rows = SETTINGS.pointRows) {
  const positions = [], colors = [], opacity = [], grains = [];
  const dramaticColors = [], dramaticOpacity = [];
  const sample = (x,z) => sampleHeight(field,x,z);
  const dx = field.width / (columns - 1), dz = field.depth / (rows - 1);
  const light = [-.30, .65, -.70], normalSpan = .11;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const random = hash(col, row, 2011), grain = hash(col, row, 2027);
      const bx = (col / (columns - 1) - .5) * field.width;
      const bz = (row / (rows - 1) - .5) * field.depth;
      const x = bx + (hash(col, row, 2029) - .5) * dx * .9;
      const z = bz + (hash(col, row, 2039) - .5) * dz * .9;
      const edge = edgeAt(x, z);
      if (edge <= 0 || random > edge ** .5) continue;
      const y = sampleHeight(field, x, z);
      const l = sampleHeight(field, x - normalSpan, z), r = sampleHeight(field, x + normalSpan, z);
      const b = sampleHeight(field, x, z - normalSpan), f = sampleHeight(field, x, z + normalSpan);
      const nx = -(r - l) / (normalSpan * 2), nz = -(f - b) / (normalSpan * 2);
      const nl = Math.hypot(nx, 1, nz);
      const facing = clamp((nx * light[0] + light[1] + nz * light[2]) / nl);
      const convexity = y - (l + r + b + f) * .25;
      const broadCurvature = y - (sampleHeight(field,x-.48,z)+sampleHeight(field,x+.48,z)+sampleHeight(field,x,z-.48)+sampleHeight(field,x,z+.48))*.25;
      const softCrown = smooth(-.025,.08,broadCurvature);
      const detail = smooth(.003,.022,convexity);
      const altitude = smooth(-.14,.75,y);
      const shade = (.20 + .48 * smooth(.05, .72, facing) + .18 * softCrown + .05 * detail) * (.52+.48*altitude);
      if (hash(col, row, 2053) > .48 + .50 * clamp(shade)) continue;
      const mineral = noise(x * .32, z * .32, 2063);
      const cyanPatch = Math.exp(-(((x+4.65)/1.2)**2+((z-5.7)/.8)**2));
      const cool = clamp(smooth(.0, .6, noise(x * .22 + 6, z * .22 - 3, 2069))*.18 + cyanPatch*.95);
      const rr = mix(.66 + mineral * .055, .53, cool);
      const gg = mix(.63 + mineral * .04, .63, cool);
      const bb = mix(.53 - mineral * .03, .66, cool);
      positions.push(x, y + .008, z);
      const crownTint = softCrown*(.45-cyanPatch*.25);
      colors.push(srgb(mix(rr,.83,crownTint)), srgb(mix(gg,.83,crownTint)), srgb(mix(bb,.77,crownTint)));
      opacity.push(clamp(shade * (.62 + grain * .5)) * edge ** .55);
      grains.push(grain);
      // The accepted point selection, geometry and original shading above stay
      // byte-for-byte unchanged. The second look is a separate attribute set.
      const lighting=dramaticLighting(sample,x,y,z,nx/nl,1/nl,nz/nl);
      const colorStart=colors.length-3;
      dramaticColors.push(
        colors[colorStart]*mix(.77,1.14,lighting.warmth),
        colors[colorStart+1]*mix(.89,1.05,lighting.warmth),
        colors[colorStart+2]*mix(1.02,.92,lighting.warmth),
      );
      dramaticOpacity.push(clamp(lighting.intensity*(.62+grain*.5))*edge**.55);
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), opacity: new Float32Array(opacity), grains: new Float32Array(grains), dramaticColors:new Float32Array(dramaticColors), dramaticOpacity:new Float32Array(dramaticOpacity) };
}

export function generateDepth(field) {
  const positions = new Float32Array(field.size * field.size * 3), indices = [];
  for (let row = 0; row < field.size; row++) {
    for (let col = 0; col < field.size; col++) {
      const i = row * field.size + col;
      const x = (col / (field.size - 1) - .5) * field.width;
      const z = (row / (field.size - 1) - .5) * field.depth;
      positions.set([x, field.values[i] - .004, z], i * 3);
      if (col < field.size - 1 && row < field.size - 1 && edgeAt(x, z) > .001) {
        indices.push(i, i + field.size, i + 1, i + 1, i + field.size, i + field.size + 1);
      }
    }
  }
  return { positions, indices: new Uint32Array(indices) };
}

export function advanceAngle(angle, dt, speed = -Math.PI * 2 / SETTINGS.secondsPerTurn) {
  return angle + Math.max(0, Math.min(.05, dt)) * speed;
}
