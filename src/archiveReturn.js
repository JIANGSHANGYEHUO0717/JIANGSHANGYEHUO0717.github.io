import * as THREE from "three";
import { ARCHIVE_ORGANISMS, preloadArchiveModels } from "./archiveAssets.js";
import { preloadSpecimenModel } from "./specimenAssets.js";
import { preloadObservationModel } from "./observationAssets.js";
import { ARCHIVE_CLOUD_BUDGET, buildArchiveCloud, createArchiveCloudMaterial } from "./archiveCloud.js";
import { archivePlacement } from "./archiveReference/adapter.js";
import { returnCloudColor } from "./transitionContinuity.js";

export const RETURN_DURATION = 7.4;
export const RETURN_TERRAIN_AT = 5.45;
export const RETURN_PARTICLE_COUNT = (ARCHIVE_CLOUD_BUDGET.body + ARCHIVE_CLOUD_BUDGET.escape) * 5;
const smooth = (a, b, t) => THREE.MathUtils.smoothstep(t, a, b);

export function returnMotionAt(seconds) {
  return {
    dissolve: smooth(.06, 1.85, seconds),
    contour: smooth(.7, 2.15, seconds),
    // Dispersion and attraction overlap: there is no empty intermediate state.
    travel: smooth(1.15, 6.55, seconds),
    camera: smooth(.7, 6.25, seconds),
    settle: smooth(5.65, 6.9, seconds),
    terrain: seconds >= RETURN_TERRAIN_AT,
    complete: seconds >= RETURN_DURATION,
  };
}

const dataPromises = new Map();
export function preloadArchiveReturn(sourceId = "C04") {
  if (!ARCHIVE_ORGANISMS.some(item => item.id === sourceId)) return Promise.reject(new Error("未知生命体"));
  if (!dataPromises.has(sourceId)) {
    const promise = preloadArchiveModels().then(async models => {
      const specimen = sourceId === "C04" ? await preloadSpecimenModel()
        : await preloadObservationModel(sourceId);
      return buildReturnData(models, specimen);
    }).catch(error => { dataPromises.delete(sourceId); throw error; });
    dataPromises.set(sourceId, promise);
  }
  return dataPromises.get(sourceId);
}

// Cached CPU samples are immutable; each renderer owns only its GPU clones.
export function buildReturnData(models, specimen) {
  const source = buildArchiveCloud(specimen, 3.02, 419, { body: RETURN_PARTICLE_COUNT, escape: 0 });
  const count = RETURN_PARTICLE_COUNT / 5;
  const positions = source.getAttribute("position").array;
  const normals = source.getAttribute("aSurfaceNormal").array;
  const data = models.map((model, index) => {
    const definition = ARCHIVE_ORGANISMS[index];
    const geometry = buildArchiveCloud(model, definition.targetSize, 73 + index * 101);
    const start = index * count;
    geometry.setAttribute("aSource", new THREE.BufferAttribute(positions.slice(start * 3, (start + count) * 3), 3));
    geometry.setAttribute("aSourceNormal", new THREE.BufferAttribute(normals.slice(start * 3, (start + count) * 3), 3));
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const height = positions[(start + i) * 3 + 1] / 3.02;
      phases[i] = THREE.MathUtils.clamp(.025 + (1 - height) * .68, 0, .76);
    }
    geometry.setAttribute("aSourcePhase", new THREE.BufferAttribute(phases, 1));
    return { definition, geometry, placement: archivePlacement(definition, 0, model) };
  });
  source.dispose();
  return data;
}

export function createReturnMaterial(definition, sourceMatrix, pixelRatio, sourceColor = 0x9ad9e5) {
  // Reuse the archive's full vertex/fragment program. At travel=1 this is
  // literally the same sample, clock, point size, color and alpha as the archive.
  const material = createArchiveCloudMaterial(definition.tint, definition.targetSize);
  const nativeTint = material.uniforms.uTint.value.clone();
  const muted = returnCloudColor(nativeTint.toArray(), definition.id);
  const sourceTint = new THREE.Color(sourceColor).lerp(new THREE.Color(0xbacace), .24);
  Object.assign(material.uniforms, {
    uSourceMatrix: { value: sourceMatrix }, uReturnTime: { value: 0 },
    uTravel: { value: 0 }, uDissolve: { value: 0 }, uSettle: { value: 0 },
    uSourceTint: { value: sourceTint }, uNativeTint: { value: nativeTint },
    uMutedTint: { value: new THREE.Color().fromArray(muted) },
  });
  material.uniforms.uPixelRatio.value = pixelRatio;
  material.vertexShader = `
    attribute vec3 aSource;
    attribute vec3 aSourceNormal;
    attribute float aSourcePhase;
    uniform mat4 uSourceMatrix;
    uniform float uReturnTime;
    uniform float uTravel;
    uniform float uDissolve;
    uniform float uSettle;
    varying float vTravel;
    varying float vSettle;
  ` + material.vertexShader.replace("vec4 mv = modelViewMatrix * vec4(p,1.0);", `
    vec3 targetWorld = (modelMatrix * vec4(p,1.0)).xyz;
    vec3 sourceWorld = (uSourceMatrix * vec4(aSource,1.0)).xyz;
    vec3 sourceNormal = normalize(mat3(uSourceMatrix) * aSourceNormal);
    vec3 localSource = aSource / 3.02;
    vec3 outwardSource = normalize(vec3(localSource.x,(localSource.y-.42)*.55,localSource.z)+vec3(.0001));
    vec3 outwardWorld = normalize(mat3(uSourceMatrix) * outwardSource);
    vec3 driftDirection = normalize(outwardWorld*.60 + sourceNormal*.25 + vec3(-.32,.44,.12));
    float age = max(0.0,uReturnTime-aSourcePhase*1.25);
    float driftDistance = (1.0-exp(-age*.85)) * (.60+aSeed.z*.90);
    vec3 drift = driftDirection * driftDistance;
    drift += vec3(sin(age*1.3+phase),cos(age+phase),sin(age*1.5+aSeed.y*11.0)) * driftDistance*.13;
    float travel = uTravel;
    // Every point is born on its dissolving piece of membrane/torso, then
    // retains identity throughout the world-space drift and target attraction.
    vec3 world = mix(sourceWorld+drift,targetWorld,travel);
    vec4 sourceView = viewMatrix * vec4(sourceWorld,1.0);
    vec3 sourceViewNormal = normalize(mat3(viewMatrix) * sourceNormal);
    float sourceFacing = abs(dot(sourceViewNormal,normalize(-sourceView.xyz)));
    float reveal = smoothstep(aSourcePhase,aSourcePhase+.17,uDissolve);
    float sourceAlpha = (.18+aSeed.z*.30) * mix(.32,1.0,smoothstep(.06,.66,sourceFacing));
    sourceAlpha *= reveal;
    alpha = mix(sourceAlpha,alpha,smoothstep(.40,1.0,travel));
    vec4 mv = viewMatrix * vec4(world,1.0);
    vTravel = travel;
    vSettle = uSettle;
  `).replace("vAlpha = alpha;", `
    gl_PointSize = mix(min(gl_PointSize,1.75*uPixelRatio),gl_PointSize,uTravel);
    vAlpha = alpha;
  `);
  material.fragmentShader = `
    uniform vec3 uSourceTint;
    uniform vec3 uNativeTint;
    uniform vec3 uMutedTint;
    varying float vTravel;
    varying float vSettle;
  ` + material.fragmentShader.replace("vec3 tint = mix(uTint,vec3(.76,.83,.84),vGrain*.27);", `
    vec3 destinationTint = mix(uMutedTint,uNativeTint,vSettle);
    vec3 tint = mix(mix(uSourceTint,destinationTint,vTravel),vec3(.76,.83,.84),vGrain*.27);
  `);
  return material;
}

export function createArchiveReturn(data, angle, pixelRatio, sourceColor = 0x9ad9e5) {
  const scene = new THREE.Scene();
  const sourceMatrix = new THREE.Matrix4();
  const group = new THREE.Group();
  group.rotation.y = angle;
  scene.add(group);
  const points = data.map(({ definition, geometry, placement }) => {
    const cloud = new THREE.Points(geometry.clone(), createReturnMaterial(definition, sourceMatrix, pixelRatio, sourceColor));
    cloud.position.set(...placement.position);
    cloud.rotation.y = placement.yaw;
    cloud.frustumCulled = false;
    group.add(cloud);
    return cloud;
  });
  return {
    scene, sourceMatrix,
    update(seconds, cloudTime) {
      const motion = returnMotionAt(seconds);
      points.forEach(({ material }) => {
        const u = material.uniforms;
        u.uReturnTime.value = seconds;
        u.uTravel.value = motion.travel;
        u.uDissolve.value = motion.dissolve;
        u.uSettle.value = motion.settle;
        u.uTime.value = cloudTime;
      });
      return motion;
    },
    dispose() { points.forEach(p => { p.geometry.dispose(); p.material.dispose(); }); },
  };
}
