import * as THREE from "three";
import { ARCHIVE_ORGANISMS } from "./archiveAssets.js";
import { geologyHeight } from "./terrainGeology.js";

export const TERRAIN_SETTINGS = Object.freeze({
  seed: 830,
  radiusX: 10.8,
  radiusZ: 8.8,
  columns: 540,
  rows: 440,
  // Resolves the sharper approved ridges without pushing the occluder away.
  depthColumns: 480,
  depthRows: 394,
  pointLift: 0.016,
  depthBias: 0.008,
  pointCssSize: 1.8,
  opacity: 0.66,
});

export const TERRAIN_PADS = ARCHIVE_ORGANISMS.map(({ id, position, targetSize }) => ({
  id, x: position[0], z: position[2], height: position[1] - 0.035,
  innerRadius: targetSize * 0.28, outerRadius: targetSize * 0.55,
}));

const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, value) => {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Integer lattice hash + quintic interpolation: reproducible continuous noise,
// not time-dependent sine stripes or a video-derived height/displacement map.
function hash(x, z, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function terrainNoise(x, z, seed = TERRAIN_SETTINGS.seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  return lerp(lerp(hash(ix, iz, seed), hash(ix + 1, iz, seed), u),
    lerp(hash(ix, iz + 1, seed), hash(ix + 1, iz + 1, seed), u), v) * 2 - 1;
}

// Retain the old height as a boundary blend, not as a frozen flat outer shelf.
// The approved fading law in terrainEdge remains unchanged.
function legacyTerrainHeight(x, z, pads, seed) {
  const base = terrainNoise(x * .16, z * .16, seed) * .46
    + terrainNoise(x * .43, z * .43, seed + 13) * .15
    + terrainNoise(x * 1.15, z * 1.15, seed + 37) * .022 - .04;
  let totalWeight = 0, weightedHeight = 0;
  for (const pad of pads) {
    const weight = 1 - smooth(pad.innerRadius, pad.outerRadius, Math.hypot(x - pad.x, z - pad.z));
    totalWeight += weight;
    weightedHeight += pad.height * weight;
  }
  return totalWeight > 0 ? lerp(base, weightedHeight / totalWeight, clamp(totalWeight)) : base;
}

export function terrainInteriorWeight(x, z) {
  return 1 - smooth(.47, .68, Math.hypot(x / TERRAIN_SETTINGS.radiusX, z / TERRAIN_SETTINGS.radiusZ));
}

export function terrainShapeWeight(x, z) {
  return 1-smooth(.70,.98,Math.hypot(x/TERRAIN_SETTINGS.radiusX,z/TERRAIN_SETTINGS.radiusZ));
}

export function terrainFarFade(x,z,settings=TERRAIN_SETTINGS) {
  // The fixed archive camera sees negative Z as the distant edge. Start fading
  // before the rear heaps can form a skyline; noisy onset avoids a straight cut.
  const breakup=terrainNoise(x*.26,z*.23,settings.seed+467)*.40;
  return 1-smooth(3.0,8.0,-z+breakup);
}

export function terrainVisibility(x,z,settings=TERRAIN_SETTINGS) {
  return terrainEdge(x,z,settings)*terrainFarFade(x,z,settings);
}

export function terrainHeight(x, z, pads = TERRAIN_PADS, seed = TERRAIN_SETTINGS.seed) {
  const original = legacyTerrainHeight(x, z, pads, seed);
  const interior = terrainShapeWeight(x, z);
  if (interior === 0) return original;
  let hills=geologyHeight(x,z,seed);
  const far=terrainFarFade(x,z,{...TERRAIN_SETTINGS,seed});
  // Let the land itself settle into the dark, not occlude its fading points.
  hills=lerp(-.16,hills,.12+.88*far);
  let totalWeight=0, weightedHeight=0;
  for (const pad of pads) {
    const dx=x-pad.x, dz=z-pad.z;
    const angle=.5+pad.x*.07;
    const u=dx*Math.cos(angle)+dz*Math.sin(angle);
    const v=-dx*Math.sin(angle)+dz*Math.cos(angle);
    const radius=Math.hypot(u*.84,v*1.14);
    const irregularity=terrainNoise(x*.53,z*.53,seed+271)*.12*smooth(.35,1.5,radius);
    const weight=1-smooth(pad.innerRadius*.40,pad.innerRadius*.95,radius+irregularity);
    totalWeight+=weight;
    weightedHeight+=pad.height*weight;
  }
  if (totalWeight>0) hills=lerp(hills,weightedHeight/totalWeight,clamp(totalWeight));
  return lerp(original,hills,interior);
}

export function terrainReadability(height, localRelief, facing) {
  // Broad light-facing slopes carry the ground. Do not outline every small
  // lump with a bright local-convexity accent; grain is a surface detail only.
  const crest=smooth(-.012,.065,localRelief);
  const light=smooth(.35,.95,facing);
  const elevation=smooth(-.08,.75,height);
  const prominence=crest*.18+light*.56+elevation*.26;
  return {
    prominence,
    density:.45+.55*smooth(.12,.76,prominence),
    brightness:.24+.76*smooth(.12,.72,prominence),
  };
}

export function terrainEdge(x, z, settings = TERRAIN_SETTINGS) {
  const radial = Math.hypot(x / settings.radiusX, z / settings.radiusZ);
  const breakup = terrainNoise(x * .39, z * .39, settings.seed + 53) * .075
    + terrainNoise(x * .83, z * .83, settings.seed + 91) * .026;
  return 1 - smooth(.66, 1, radial + breakup);
}

const baseColor = new THREE.Color(0x7c888a);
const signalColors = [0x8d725d, 0x708077, 0x6b808a, 0x73939a, 0x86836a].map(hex => new THREE.Color(hex));

function legacyTerrainColor(x, z, seed, random) {
  const color = baseColor.clone();
  const mixed = new THREE.Color(0, 0, 0);
  let sum = 0;
  TERRAIN_PADS.forEach((pad, index) => {
    const distanceSquared = (x - pad.x) ** 2 + (z - pad.z) ** 2;
    const mask = smooth(.10, .66, terrainNoise(x * 1.36, z * 1.36, seed + index * 71));
    // Only scattered cells inside noisy influence patches receive color.
    const scattered = random > .72 ? 1 : .16;
    const weight = Math.exp(-distanceSquared / 6.8) * mask * scattered;
    mixed.r += signalColors[index].r * weight;
    mixed.g += signalColors[index].g * weight;
    mixed.b += signalColors[index].b * weight;
    sum += weight;
  });
  if (sum > 0) color.lerp(mixed.multiplyScalar(1 / sum), Math.min(.60, sum * .58));
  return color;
}

const hillSignalColors = [0xb18763, 0x719973, 0x728f9f, 0x689ca4, 0xa6a16e].map(hex=>new THREE.Color(hex));
const stoneColor=new THREE.Color(0xcccaba);
export function terrainColor(x, z, seed, random) {
  const original = legacyTerrainColor(x,z,seed,random);
  const interior = terrainInteriorWeight(x,z);
  if (interior === 0) return original;
  const color = baseColor.clone();
  const mixed = new THREE.Color(0,0,0);
  let total=0, coverage=0;
  TERRAIN_PADS.forEach((pad,index)=>{
    // Off-center, noise-broken mineral patches, not concentric color halos.
    const dx=x-pad.x+.65*Math.sin(index*2.3+.4);
    const dz=z-pad.z+.7*Math.cos(index*1.7+.8);
    const noise=(terrainNoise(x*.52+index*3,z*.52-index*2,seed+index*71)+1)*.5;
    const mask=smooth(.26,.66,noise);
    const influence=Math.exp(-(dx*dx+dz*dz)/13.2)*mask;
    // Favor the local mineral hue instead of averaging every nearby hue to gray.
    const weight=influence**3;
    coverage=Math.max(coverage,influence);
    mixed.r+=hillSignalColors[index].r*weight;
    mixed.g+=hillSignalColors[index].g*weight;
    mixed.b+=hillSignalColors[index].b*weight;
    total+=weight;
  });
  if (total>0) color.lerp(mixed.multiplyScalar(1/total),smooth(.04,.48,coverage)*(.87+random*.1));
  return original.lerp(color,interior);
}

// Arrays and colors are generated once. No time, hover or pointer input can
// warp this ground. The precomputed colors stay in the terrain's local space.
export function generateTerrainPoints(settings = TERRAIN_SETTINGS) {
  const { radiusX, radiusZ, columns, rows, seed, pointLift } = settings;
  const width = radiusX * 2.2, depth = radiusZ * 2.2;
  const stepX = width / (columns - 1), stepZ = depth / (rows - 1);
  const positions = [], colors = [], alphas = [], grains = [], exposures = [];
  const samplingStats={recess:{candidates:0,kept:0},crest:{candidates:0,kept:0}};
  const light = new THREE.Vector3(-.48, .72, .50).normalize();
  const normal = new THREE.Vector3();
  const epsilon = .16;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const random = hash(column, row, seed + 103);
      const bx=(column/(columns-1)-.5)*width, bz=(row/(rows-1)-.5)*depth;
      const jitterX=(hash(column,row,seed+109)*2-1)*stepX;
      const jitterZ=(hash(column,row,seed+127)*2-1)*stepZ;
      const originalX=bx+jitterX*.10, originalZ=bz+jitterZ*.10;
      const interior=terrainShapeWeight(originalX,originalZ);
      // Wider stratified jitter breaks rows; the same original shore acceptance
      // and smooth edge envelope are retained independently of the new relief.
      const x=lerp(originalX,bx+jitterX*.49+terrainNoise(bx*.8,bz*.8,seed+281)*.09,interior);
      const z=lerp(originalZ,bz+jitterZ*.49+terrainNoise(bx*.8,bz*.8,seed+293)*.09,interior);
      const edge = terrainVisibility(originalX, originalZ, settings);
      if (edge <= 0 || random > Math.pow(edge, .8)) continue;
      const y = terrainHeight(x, z, TERRAIN_PADS, seed);
      const dx = (terrainHeight(x + epsilon, z, TERRAIN_PADS, seed) - terrainHeight(x - epsilon, z, TERRAIN_PADS, seed)) / (epsilon * 2);
      const dz = (terrainHeight(x, z + epsilon, TERRAIN_PADS, seed) - terrainHeight(x, z - epsilon, TERRAIN_PADS, seed)) / (epsilon * 2);
      normal.set(-dx, 1, -dz).normalize();
      const originalSlope = .30 + .70 * smooth(.42, .90, normal.dot(light));
      let slope=originalSlope;
      if(interior>0) {
        const span=.22;
        const neighbors=(terrainHeight(x+span,z,TERRAIN_PADS,seed)+terrainHeight(x-span,z,TERRAIN_PADS,seed)
          +terrainHeight(x,z+span,TERRAIN_PADS,seed)+terrainHeight(x,z-span,TERRAIN_PADS,seed))*.25;
        const reading=terrainReadability(y,y-neighbors,normal.dot(light));
        const density=lerp(1,reading.density,interior);
        const retained=hash(column,row,seed+353)<density;
        const bucket=interior>.99 ? (reading.prominence<.35 ? samplingStats.recess
          : reading.prominence>.65 ? samplingStats.crest : null) : null;
        if(bucket) { bucket.candidates++; if(retained) bucket.kept++; }
        if(!retained) continue;
        slope=lerp(originalSlope,reading.brightness,interior);
      }
      const grain = hash(column, row, seed + 137);
      const color = terrainColor(x, z, seed, grain);
      // Brighter neutral stone glints, not an emissive ground or global exposure.
      color.lerp(stoneColor,interior*.30).multiplyScalar(1+interior*.65);
      positions.push(x, y + pointLift, z);
      colors.push(color.r, color.g, color.b);
      alphas.push(Math.pow(edge, .65) * slope * (.68 + grain * .32));
      grains.push(grain);
      exposures.push(interior);
    }
  }
  return {
    positions: new Float32Array(positions), colors: new Float32Array(colors),
    alphas: new Float32Array(alphas), grains: new Float32Array(grains),
    exposures: new Float32Array(exposures),
    spacing: Math.min(stepX, stepZ),
    samplingStats,
  };
}

export function generateTerrainDepth(settings = TERRAIN_SETTINGS) {
  const columns = settings.depthColumns, rows = settings.depthRows;
  const width = settings.radiusX * 2.2, depth = settings.radiusZ * 2.2;
  const positions = new Float32Array(columns * rows * 3);
  const indices = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = (column / (columns - 1) - .5) * width;
      const z = (row / (rows - 1) - .5) * depth;
      const index = row * columns + column;
      positions.set([x, terrainHeight(x, z, TERRAIN_PADS, settings.seed) - settings.depthBias, z], index * 3);
      if (row === rows - 1 || column === columns - 1) continue;
      if (terrainVisibility(x + width / columns / 2, z + depth / rows / 2, settings) < .01) continue;
      const a = index, b = a + 1, c = a + columns, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, indices };
}

// Cache immutable CPU data across archive remounts. GPU resources remain
// scene-owned, so leaving the archive can dispose them without harming cache.
let cachedTerrainData;
export function createArchiveTerrain() {
  cachedTerrainData ??= { points: generateTerrainPoints(), depth: generateTerrainDepth() };
  const data = cachedTerrainData.points;
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  pointGeometry.setAttribute("aColor", new THREE.BufferAttribute(data.colors, 3));
  pointGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(data.alphas, 1));
  pointGeometry.setAttribute("aGrain", new THREE.BufferAttribute(data.grains, 1));
  pointGeometry.setAttribute("aExposure", new THREE.BufferAttribute(data.exposures, 1));
  const pointMaterial = new THREE.ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.NormalBlending,
    uniforms: {
      uOpacity: { value: TERRAIN_SETTINGS.opacity },
      uPixelRatio: { value: 1 },
      uViewportHeight: { value: 900 },
      uPointCssSize: { value: TERRAIN_SETTINGS.pointCssSize },
      uSpacing: { value: data.spacing },
    },
    vertexShader: `
      attribute vec3 aColor; attribute float aAlpha; attribute float aGrain; attribute float aExposure;
      uniform float uPixelRatio; uniform float uViewportHeight;
      uniform float uPointCssSize; uniform float uSpacing;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_Position = projectionMatrix * mv;
        float distanceToCamera = max(1.0,-mv.z);
        float projectedSpacing = uSpacing * .5 * uViewportHeight * projectionMatrix[1][1] / distanceToCamera;
        float distantDensity = mix(mix(.28,.70,aExposure),1.0,smoothstep(.45,1.35,projectedSpacing));
        float cssSize = clamp(uPointCssSize * 14.0 / distanceToCamera, .75, 2.0);
        gl_PointSize = cssSize * (.9+aGrain*.16) * mix(1.0,1.13,aExposure) * uPixelRatio;
        vColor = aColor;
        vAlpha = aAlpha * distantDensity * mix(1.0,1.75,aExposure);
      }
    `,
    fragmentShader: `
      uniform float uOpacity; varying vec3 vColor; varying float vAlpha;
      void main() {
        float radius = distance(gl_PointCoord,vec2(.5));
        if (radius>.5) discard;
        float roundPoint = 1.0-smoothstep(.22,.5,radius);
        gl_FragColor = vec4(vColor, vAlpha * roundPoint * uOpacity);
        #include <colorspace_fragment>
      }
    `,
  });
  const depthGeometry = new THREE.BufferGeometry();
  depthGeometry.setAttribute("position", new THREE.BufferAttribute(cachedTerrainData.depth.positions, 3));
  depthGeometry.setIndex(cachedTerrainData.depth.indices);
  const depthMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000, colorWrite: false, depthTest: true, depthWrite: true,
    side: THREE.DoubleSide,
  });
  const depthMesh = new THREE.Mesh(depthGeometry, depthMaterial);
  depthMesh.renderOrder = -1;
  const points = new THREE.Points(pointGeometry, pointMaterial);
  const group = new THREE.Group();
  group.add(depthMesh, points);
  return { group, pointGeometry, pointMaterial, depthGeometry, depthMaterial };
}
