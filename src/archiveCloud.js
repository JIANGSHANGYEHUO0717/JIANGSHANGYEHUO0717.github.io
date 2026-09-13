import * as THREE from "three";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import { archiveModelBounds } from "./archiveReference/orientation.js";

export const ARCHIVE_CLOUD_BUDGET = Object.freeze({ body: 8000, escape: 2400 });

// Hover only changes signal brightness. Density, erosion and escape never
// collapse into a solid surface, including the clicked archive state.
export function archiveCloudEmphasis(selected, dimmed = false, selectedEmphasis = 1.45) {
  return selected ? selectedEmphasis : dimmed ? 0.72 : 1;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Sample triangle area, not vertex order: dense mesh topology must not turn
// folds or the silhouette into rigid dotted outlines. Output is root-local,
// centered horizontally, base at y=0 and longest dimension at targetSize.
export function buildArchiveCloud(model, targetSize, seed = 4, budget = ARCHIVE_CLOUD_BUDGET) {
  model.updateMatrixWorld(true);
  const box = archiveModelBounds(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = targetSize / Math.max(size.x, size.y, size.z, 0.0001);
  const normalization = new THREE.Matrix4().makeScale(scale, scale, scale);
  normalization.setPosition(-center.x * scale, -box.min.y * scale, -center.z * scale);
  const random = seededRandom(seed);
  const samplers = [];
  let area = 0;
  model.traverse((object) => {
    if (!object.isMesh || !object.geometry.getAttribute("position")) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", object.geometry.getAttribute("position").clone());
    if (object.geometry.index) geometry.setIndex(object.geometry.index.clone());
    const normal = object.geometry.getAttribute("normal");
    if (normal) geometry.setAttribute("normal", normal.clone());
    else geometry.computeVertexNormals();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(normalization, object.matrixWorld));
    const sampler = new MeshSurfaceSampler({ geometry }).setRandomGenerator(random).build();
    const weight = sampler.distribution.at(-1) || 0;
    if (weight > 0) {
      area += weight;
      samplers.push({ sampler, geometry, end: area });
    } else geometry.dispose();
  });
  if (!samplers.length) throw new Error("Archive model has no sampleable surface");

  const count = budget.body + budget.escape;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);
  const escape = new Float32Array(count);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let index = 0; index < count; index += 1) {
    const selection = random() * area;
    const { sampler } = samplers.find(({ end }) => selection < end) || samplers.at(-1);
    sampler.sample(p, n);
    p.toArray(positions, index * 3);
    n.normalize().toArray(normals, index * 3);
    seeds.set([random(), random(), random()], index * 3);
    escape[index] = index >= budget.body ? 1 : 0;
  }
  samplers.forEach(({ geometry }) => geometry.dispose());
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSurfaceNormal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
  geometry.setAttribute("aEscape", new THREE.BufferAttribute(escape, 1));
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius += targetSize * 0.65;
  return geometry;
}

export function createArchiveCloudMaterial(tint, extent) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uEmphasis: { value: 1 },
      uExtent: { value: extent },
      uPixelRatio: { value: 1 },
      uTint: { value: new THREE.Color(tint).lerp(new THREE.Color(0xbacace), 0.24) },
    },
    vertexShader: `
      attribute vec3 aSurfaceNormal;
      attribute vec3 aSeed;
      attribute float aEscape;
      uniform float uTime;
      uniform float uExtent;
      uniform float uPixelRatio;
      varying float vAlpha;
      varying float vGrain;
      void main() {
        vec3 n = normalize(aSurfaceNormal + vec3(.00001));
        vec3 local = position / uExtent;
        vec3 outward = normalize(vec3(local.x, (local.y-.42)*.55, local.z) + vec3(.0001));
        vec3 mvNormal = normalize(normalMatrix * n);
        vec4 anchor = modelViewMatrix * vec4(position, 1.0);
        float facing = abs(dot(mvNormal, normalize(-anchor.xyz)));
        float edge = 1.0 - smoothstep(.14,.58,facing);
        float phase = aSeed.x * 6.2831853;
        float erosion = .5 + sin(local.x*19.0+local.y*12.0+uTime*.18)*.23
                         + sin(local.z*21.0-local.y*16.0-uTime*.13)*.22;
        float loosen = .012 + edge*.022 + smoothstep(.55,.84,erosion)*.018;
        vec3 jitter = vec3(sin(phase+uTime*.23),cos(aSeed.y*19.0+uTime*.18),sin(aSeed.z*23.0-uTime*.16));
        vec3 p = position + (jitter*.7 + n*(aSeed.y-.35)) * uExtent * loosen;
        float alpha = (.38 + aSeed.z*.62) * mix(.22,1.0,smoothstep(.06,.66,facing));
        alpha *= mix(.34,1.0,smoothstep(.20,.64,erosion));

        if (aEscape > .5) {
          // Asynchronous life cycles: fade at both ends before resetting to
          // the emitter. Slow shared drift, not a radial explosion or snow.
          float life = fract(aSeed.x + uTime*(.075+aSeed.y*.035));
          float departure = smoothstep(.04,.93,life);
          vec3 drift = normalize(outward*.60 + n*.25 + vec3(-.32,.44,.12));
          p += drift * uExtent * departure * (.14+aSeed.z*.29);
          p += vec3(sin(life*5.0+phase),cos(life*4.0+phase),sin(life*6.0+aSeed.y*11.0))
               * uExtent * departure * .045;
          alpha = smoothstep(0.0,.12,life)*(1.0-smoothstep(.28,1.0,life));
          alpha *= (.42+aSeed.z*.45) * (.55+edge*.45);
        }
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((26.0 / max(1.0,-mv.z)) * (.82+aSeed.y*.62), 1.1, 2.6) * uPixelRatio;
        vAlpha = alpha;
        vGrain = aSeed.z;
      }
    `,
    fragmentShader: `
      uniform vec3 uTint;
      uniform float uEmphasis;
      varying float vAlpha;
      varying float vGrain;
      void main() {
        float d = distance(gl_PointCoord,vec2(.5));
        if (d>.5) discard;
        float soft = 1.0-smoothstep(.12,.5,d);
        vec3 tint = mix(uTint,vec3(.76,.83,.84),vGrain*.27);
        gl_FragColor = vec4(tint,soft*vAlpha*uEmphasis);
        #include <colorspace_fragment>
      }
    `,
  });
}
