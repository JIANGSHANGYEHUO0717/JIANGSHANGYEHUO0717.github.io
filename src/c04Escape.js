import * as THREE from "three";
import { captureEscapeParticles } from "./transitionContinuity.js";
import { emissionPhaseWindow, C04_DISSOLVE } from "./c04Dissolve.js";

export const C04_SMOKE = Object.freeze({
  capacity: 9600, emission: 1750, lifeMin: 7.5, lifeRange: 4,
  historyStep: .065, historyLength: 8, historyTaps: [2, 4, 7],
  smokeOpacity: .29, grainOpacity: .94, drag: .58,
});
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Analytic curl of a smooth vector potential, shared by neighboring particles.
// Seeds affect birth/life only; adding a seed to the force breaks smoke sheets.
export function smokeCurl(x, y, z, time, out = new THREE.Vector3()) {
  const ax = x * 1.1 + time * .14, ay = y * .9 + time * .12, az = z * .95 - time * .10;
  out.set(
    .8 * Math.sin(ax) * Math.cos(y * .8) - .95 * Math.cos(az) * Math.sin(x * .85),
    1.2 * Math.sin(ay) * Math.cos(z * 1.2) - 1.1 * Math.cos(ax) * Math.sin(y * .8),
    .85 * Math.sin(az) * Math.cos(x * .85) - .9 * Math.cos(ay) * Math.sin(z * 1.2),
  );
  return out;
}

export function smokeLife(age, lifetime) {
  const progress = clamp(age / lifetime);
  // Hold a readable colored body; thinning is reserved for releasing the pose.
  return smooth(0, .22, age) * (1 - smooth(.62, 1, progress));
}

// Neighboring samples share a cellular stream field, rather than the upward
// jet between two side-by-side opposing vortices. Its alternating cells carry
// different model regions left/right and up/down within the observation volume.
export function smokeAdvection(x, y, z, time, out = new THREE.Vector3()) {
  smokeCurl(x * .9, y * .9, z * .9, time, out).multiplyScalar(.12);
  const sx = x * 1.18 + .30 * Math.sin(time * .16) + z * .14;
  const sy = (y - .05) * 1.52 + .28 * Math.sin(time * .13 + 1.1);
  out.x += .57 * 1.52 * Math.sin(sx) * Math.cos(sy);
  out.y -= .57 * 1.18 * Math.cos(sx) * Math.sin(sy);
  // A weaker tilted stream opens the middle of the cells without independent
  // random noise that would turn coherent wisps into snow.
  out.x += .15 * Math.cos(y * .8 + z * .4 + time * .12);
  out.z += .14 * Math.sin(y * 1.1 - x * .8 + time * .16) - z * .10;
  out.x -= Math.sign(x) * Math.max(0, Math.abs(x) - 2.5) * 1.15;
  out.y -= Math.sign(y + .05) * Math.max(0, Math.abs(y + .05) - 1.65) * 1.65;
  out.z -= Math.sign(z) * Math.max(0, Math.abs(z) - 1.05) * 1.1;
  return out;
}

export function smokeEmission(energy, contourFade) {
  if (energy < .055) return 0;
  return (60 + Math.pow(clamp(energy), 1.25) * C04_SMOKE.emission)
    * (1 - smooth(.48, 1, contourFade));
}

const smokeVertex = `
  uniform float uSize;
  attribute float aLife; attribute float aAge; attribute float aSeed;
  attribute vec3 aVelocity;
  varying float vLife; varying float vAge; varying float vSeed;
  varying float vAngle; varying float vStretch;
  void main(){
    vec4 mv=modelViewMatrix*vec4(position,1.0);
    vec3 velocity=mat3(modelViewMatrix)*aVelocity;
    gl_Position=projectionMatrix*mv;
    float expansion=mix(.62,1.85,smoothstep(0.0,1.0,aAge));
    gl_PointSize=clamp(uSize*(390.0/max(.5,-mv.z))*(.75+aSeed*.55)*expansion,1.0,72.0);
    if(aLife<.001) gl_PointSize=1.0;
    vLife=aLife; vAge=aAge; vSeed=aSeed;
    vAngle=atan(velocity.y,velocity.x);
    vStretch=1.45+min(1.1,length(velocity.xy)*2.0)+aAge*.55;
  }
`;
const smokeFragment = `
  uniform float uOpacity;
  varying float vLife; varying float vAge; varying float vSeed;
  varying float vAngle; varying float vStretch;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){
    vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
  }
  void main(){
    if(vLife<=.001)discard;
    vec2 p=gl_PointCoord-.5;
    float c=cos(vAngle),s=sin(vAngle);
    p=mat2(c,-s,s,c)*p;
    p.y*=vStretch;
    float d=length(p);
    if(d>.5)discard;
    float edge=1.0-smoothstep(.04,.5,d);
    float mist=noise(p*6.0+vec2(vSeed*17.0,vAge*1.3));
    mist=mix(mist,noise(p*13.0+vSeed*31.0),.25);
    float feather=pow(edge,1.8)*mix(.28,1.0,mist);
    // Blue/teal material color, not white fog. Dark folds and cyan ridges
    // remain colored without increasing the specimen's exposure or Bloom.
    vec3 tint=mix(vec3(.035,.38,.54),vec3(.13,.79,.88),mist*.7+vSeed*.23);
    gl_FragColor=vec4(tint,feather*vLife*uOpacity);
  }
`;

function particleGeometry(count) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, size] of [["position", 3], ["aVelocity", 3], ["aLife", 1], ["aAge", 1], ["aSeed", 1]]) {
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count * size), size).setUsage(THREE.DynamicDrawUsage));
  }
  return geometry;
}

export function createEscapeSystem(maximum = C04_SMOKE.capacity) {
  const geometry = particleGeometry(maximum);
  const positions = geometry.attributes.position.array;
  const velocities = geometry.attributes.aVelocity.array;
  const lifeValues = geometry.attributes.aLife.array;
  const progressValues = geometry.attributes.aAge.array;
  const seeds = geometry.attributes.aSeed.array;
  const ages = new Float32Array(maximum), lifetimes = new Float32Array(maximum);
  const active = new Uint8Array(maximum);
  const anchors = new Float32Array(maximum * 3);
  const anchorPhases = new Float32Array(maximum);
  const recallAges = new Float32Array(maximum);
  const anchorSources = new Array(maximum);
  const histories = new Float32Array(maximum * C04_SMOKE.historyLength * 3);
  const trailGeometry = particleGeometry(Math.ceil(maximum / 3) * C04_SMOKE.historyTaps.length);
  const smokeMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    uniforms: { uSize: { value: .39 }, uOpacity: { value: C04_SMOKE.smokeOpacity } },
    vertexShader: smokeVertex, fragmentShader: smokeFragment,
  });
  const trailMaterial = smokeMaterial.clone();
  trailMaterial.uniforms.uSize.value = .46;
  trailMaterial.uniforms.uOpacity.value = .095;
  const grainMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uSize: { value: .029 }, uOpacity: { value: C04_SMOKE.grainOpacity } },
    vertexShader: `
      uniform float uSize; attribute float aLife; attribute float aAge; attribute float aSeed;
      varying float vLife; varying float vAge; varying float vSeed;
      void main(){
        vec4 mv=modelViewMatrix*vec4(position,1.0);
        gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp(uSize*390.0/max(.5,-mv.z)*(.65+aSeed*.85),.8,3.8);
        vLife=aLife; vAge=aAge; vSeed=aSeed;
      }`,
    fragmentShader: `
      uniform float uOpacity; varying float vLife; varying float vAge; varying float vSeed;
      void main(){
        float d=distance(gl_PointCoord,vec2(.5));if(d>.5||vLife<.001)discard;
        vec3 tint=mix(vec3(.035,.52,.76),vec3(.22,.86,.94),vSeed);
        float sparkle=mix(.30,1.0,smoothstep(.35,.92,vSeed));
        gl_FragColor=vec4(tint,(1.0-smoothstep(.03,.5,d))*vLife*uOpacity*sparkle);
      }`,
  });
  const smoke = new THREE.Points(geometry, smokeMaterial);
  const points = new THREE.Points(geometry, grainMaterial);
  // Temporal history remains in world space, not a feedback image of the UI.
  const trails = new THREE.Points(trailGeometry, trailMaterial);
  for (const [object, order] of [[trails, 5], [smoke, 6], [points, 7]]) {
    object.frustumCulled = false; object.renderOrder = order;
  }
  let randomState = 4042026;
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
  let cursor = 0, spawnCarry = 0, historyCarry = 0, activeCount = 0;
  let recallDistance = 0, recallingCount = 0, pendingReturnPhase = -1;
  const local = new THREE.Vector3(), world = new THREE.Vector3(), normal = new THREE.Vector3();
  const curl = new THREE.Vector3(), fine = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  const spawn = (sources, energy, boost, elapsed, control) => {
    if (!sources.length) return;
    const source = sources[Math.floor(random() * sources.length)];
    let low = 0, high = source.phases.length;
    const phaseWindow = control ? emissionPhaseWindow(control.cloud, control.escape) : null;
    const limit = phaseWindow ? phaseWindow.max : clamp(energy * 1.03 + .025);
    while (low < high) {
      const mid = (low + high) >> 1;
      if (source.phases[mid] <= limit) low = mid + 1; else high = mid;
    }
    let first = 0;
    if (phaseWindow) {
      let end = low;
      while (first < end) {
        const mid = (first + end) >> 1;
        if (source.phases[mid] < phaseWindow.min) first = mid + 1; else end = mid;
      }
    }
    if (first >= low) return;
    let slot = -1;
    for (let i = 0; i < maximum; i++) {
      const next = cursor; cursor = (cursor + 1) % maximum;
      if (!active[next]) { slot = next; break; }
    }
    if (slot < 0) return;
    const sourcePositions = source.mesh.geometry.attributes.position;
    const sourceNormals = source.mesh.geometry.attributes.normal;
    const bounds = source.mesh.geometry.boundingBox;
    const size = bounds.max.y - bounds.min.y;
    // Select close-to-isocontour bands ON the actual model. Shared field then
    // advects these thin sheets; no screen-edge or generic ribbon emitter.
    let vertex, candidate;
    for (let attempt = 0; attempt < 7; attempt++) {
      candidate = first + Math.floor(random() * (low - first));
      vertex = source.indices[candidate];
      local.fromBufferAttribute(sourcePositions, vertex);
      const ny = (local.y - bounds.min.y) / Math.max(.0001, size);
      const nx = (local.x - bounds.min.x) / Math.max(.0001, bounds.max.x - bounds.min.x);
      const band = .5 + .5 * Math.sin(ny * 21 + nx * 8 + Math.sin(nx * 11) * .65 - elapsed * .35);
      if (band > .77 || random() < .10) break;
    }
    world.copy(local).applyMatrix4(source.mesh.matrixWorld);
    normal.fromBufferAttribute(sourceNormals, vertex);
    normalMatrix.getNormalMatrix(source.mesh.matrixWorld);
    normal.applyMatrix3(normalMatrix).normalize();
    const base = slot * 3, r = random();
    local.toArray(anchors, base);
    anchorPhases[slot] = source.phases[candidate];
    recallAges[slot] = 0;
    anchorSources[slot] = source.mesh;
    world.toArray(positions, base);
    smokeAdvection(world.x, world.y, world.z, elapsed, curl);
    const launch = .48 + energy * .22 + boost * .16;
    velocities[base] = normal.x * .10 + curl.x * launch;
    velocities[base + 1] = normal.y * .10 + curl.y * launch;
    velocities[base + 2] = normal.z * .10 + curl.z * launch;
    ages[slot] = 0; lifetimes[slot] = C04_SMOKE.lifeMin + random() * C04_SMOKE.lifeRange;
    seeds[slot] = r; active[slot] = 1;
    for (let h = 0; h < C04_SMOKE.historyLength; h++) world.toArray(histories, (slot * C04_SMOKE.historyLength + h) * 3);
  };

  const update = (rawDt, elapsed, intensity, velocityBoost, sources, contourFade = 0, control = null) => {
    const dt = Math.min(.05, Math.max(0, rawDt));
    const amount = clamp(intensity);
    const recalling = Boolean(control?.recalling);
    const canEmit = !control || (!recalling && control.cloud > C04_DISSOLVE.pointEnd && control.escape > C04_DISSOLVE.detachStart);
    spawnCarry = canEmit ? spawnCarry + dt * smokeEmission(amount, contourFade) : 0;
    const spawnCount = Math.min(100, Math.floor(spawnCarry));
    spawnCarry -= spawnCount;
    for (let i = 0; i < spawnCount; i++) spawn(sources, amount, velocityBoost, elapsed, control);
    historyCarry += dt;
    const sampleHistory = historyCarry >= C04_SMOKE.historyStep;
    if (sampleHistory) historyCarry %= C04_SMOKE.historyStep;
    activeCount = 0;
    recallDistance = 0; recallingCount = 0; pendingReturnPhase = -1;
    const damping = Math.exp(-C04_SMOKE.drag * dt);
    const sustain = control ? 1 : smooth(.06, .45, amount);
    for (let i = 0; i < maximum; i++) {
      const base = i * 3;
      if (active[i]) {
        // Sustained open palm keeps the SAME detached samples circulating. No
        // respawning on an invisible model, no disappearing while still held.
        const residence = smooth(.25, .52, ages[i] / lifetimes[i]);
        if (!recalling) ages[i] += dt * (1 - sustain * residence) * (1 + (1 - sustain) * .7);
        if (ages[i] >= lifetimes[i]) active[i] = 0;
      }
      if (!active[i]) { lifeValues[i] = 0; }
      else {
        const x = positions[base], y = positions[base + 1], z = positions[base + 2];
        // High phases belong to the base. The retreating escape front reaches
        // them first; untouched upper particles keep their original flow.
        const returningParticle = recalling && anchorSources[i]
          && control.escape <= anchorPhases[i] + C04_DISSOLVE.detachEnd;
        recallAges[i] = returningParticle ? recallAges[i] + dt : 0;
        if (returningParticle) {
          // Integrate a critically damped spring toward this particle's own
          // source vertex in the CURRENT specimen transform (including drag).
          world.fromArray(anchors, base).applyMatrix4(anchorSources[i].matrixWorld);
          const omega = Math.min(3.8, 1.25 + recallAges[i] * .48);
          const decay = Math.exp(-omega * dt);
          for (let axis = 0; axis < 3; axis++) {
            const target = world.getComponent(axis);
            const delta = positions[base + axis] - target;
            const velocity = velocities[base + axis];
            const motion = (velocity + omega * delta) * dt;
            positions[base + axis] = target + (delta + motion) * decay;
            velocities[base + axis] = (velocity - omega * motion) * decay;
          }
          const distance = world.distanceTo(local.fromArray(positions, base));
          recallDistance = Math.max(recallDistance, distance);
          // Retirement happens on arrival, never by an arbitrary lifespan.
          if (distance < .012 && Math.hypot(...velocities.subarray(base, base + 3)) < .08) active[i] = 0;
        } else {
          smokeAdvection(x, y, z, elapsed, curl);
          smokeCurl(x * 2.25 + 2, y * 2.25 - 1, z * 2.25, elapsed * .7, fine);
          velocities[base] += (curl.x + fine.x * .04) * dt;
          velocities[base + 1] += (curl.y + fine.y * .04) * dt;
          velocities[base + 2] += (curl.z + fine.z * .035) * dt;
          for (let axis = 0; axis < 3; axis++) {
            velocities[base + axis] *= damping;
            positions[base + axis] += velocities[base + axis] * dt;
          }
        }
        progressValues[i] = clamp(ages[i] / lifetimes[i]);
        lifeValues[i] = active[i] ? smokeLife(ages[i], lifetimes[i]) : 0;
        if (active[i]) {
          activeCount++;
          if (returningParticle) recallingCount++;
          pendingReturnPhase = Math.max(pendingReturnPhase, anchorPhases[i]);
        }
        if (sampleHistory) {
          const offset = i * C04_SMOKE.historyLength * 3;
          histories.copyWithin(offset + 3, offset, offset + (C04_SMOKE.historyLength - 1) * 3);
          histories.set(positions.subarray(base, base + 3), offset);
        }
      }
      if (i % 3 === 0) {
        C04_SMOKE.historyTaps.forEach((tap, tapIndex) => {
          const target = (i / 3) * C04_SMOKE.historyTaps.length + tapIndex;
          const history = (i * C04_SMOKE.historyLength + tap) * 3;
          const attrs = trailGeometry.attributes;
          attrs.position.array.set(histories.subarray(history, history + 3), target * 3);
          attrs.aVelocity.array.set(velocities.subarray(base, base + 3), target * 3);
          attrs.aLife.array[target] = lifeValues[i] * [ .65, .38, .18 ][tapIndex];
          attrs.aAge.array[target] = progressValues[i];
          attrs.aSeed.array[target] = seeds[i];
        });
      }
    }
    for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
    for (const attribute of Object.values(trailGeometry.attributes)) attribute.needsUpdate = true;
  };

  return {
    points, smoke, trails, update,
    get activeCount() { return activeCount; },
    get recallDistance() { return recallDistance; },
    get recallingCount() { return recallingCount; },
    get pendingReturnPhase() { return pendingReturnPhase; },
    snapshot: () => captureEscapeParticles({ positions, velocities, lifeValues, seeds }),
    dispose() { geometry.dispose(); trailGeometry.dispose(); grainMaterial.dispose(); smokeMaterial.dispose(); trailMaterial.dispose(); },
  };
}
