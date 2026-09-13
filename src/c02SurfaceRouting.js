import * as THREE from "three";

const META_URL = "/assets/observation/c02-routing/surface-routing.json";
const DATA_URL = "/assets/observation/c02-routing/surface-routing.bin";
const TEXTURE_WIDTH = 2048;
const clamp01 = value => THREE.MathUtils.clamp(value, 0, 1);
const smooth = (value, from, to) => THREE.MathUtils.smoothstep(value, from, to);
export const C02_ROUTING_IDLE_AGE = 21;

let routingPromise = null;

function typedView(buffer, spec) {
  if (spec.type === "float32") return new Float32Array(buffer, spec.offset, spec.length);
  if (spec.type === "uint8") return new Uint8Array(buffer, spec.offset, spec.length);
  throw new Error(`Unsupported C02 routing array type: ${spec.type}`);
}

export function preloadC02SurfaceRouting() {
  if (routingPromise) return routingPromise;
  routingPromise = Promise.all([
    fetch(META_URL).then(response => {
      if (!response.ok) throw new Error(`C02 routing metadata unavailable (${response.status})`);
      return response.json();
    }),
    fetch(DATA_URL).then(response => {
      if (!response.ok) throw new Error(`C02 routing field unavailable (${response.status})`);
      return response.arrayBuffer();
    }),
  ]).then(([metadata, buffer]) => {
    const arrays = Object.fromEntries(Object.entries(metadata.arrays)
      .map(([name, spec]) => [name, typedView(buffer, spec)]));
    if (arrays.position.length !== metadata.pointCount * 3
      || arrays.distance.length !== metadata.pointCount * metadata.nodeCount) {
      throw new Error("C02 routing field has inconsistent dimensions");
    }
    return { metadata, arrays };
  });
  return routingPromise;
}

function normalizePoint(point, bounds, modelOffset) {
  const minimum = new THREE.Vector3(...bounds.min);
  const maximum = new THREE.Vector3(...bounds.max);
  const size = maximum.clone().sub(minimum);
  const center = minimum.clone().add(maximum).multiplyScalar(.5);
  const scale = 3.02 / Math.max(size.x, size.y, size.z, .0001);
  return point.set(
    (point.x - center.x) * scale,
    (point.y - minimum.y) * scale,
    (point.z - center.z) * scale,
  ).add(modelOffset);
}

function normalizedPositions(source, metadata, modelOffset) {
  const output = new Float32Array(source.length);
  const point = new THREE.Vector3();
  for (let index = 0; index < source.length; index += 3) {
    point.set(source[index], source[index + 1], source[index + 2]);
    normalizePoint(point, metadata.bounds, modelOffset);
    output[index] = point.x;
    output[index + 1] = point.y;
    output[index + 2] = point.z;
  }
  return output;
}

function makeDistanceTexture(values) {
  const height = Math.ceil(values.length / TEXTURE_WIDTH);
  const data = new Float32Array(TEXTURE_WIDTH * height);
  data.set(values);
  const texture = new THREE.DataTexture(data, TEXTURE_WIDTH, height, THREE.RedFormat, THREE.FloatType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, width: TEXTURE_WIDTH, height };
}

function baseMaterial(pixelRatio) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uOpacity: { value: 1 },
    },
    vertexShader: `
      attribute vec4 aMask;
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      varying float vSeed;
      varying vec3 vColor;
      void main(){
        vec4 mv=modelViewMatrix*vec4(position,1.0);
        vec3 viewNormal=normalize(normalMatrix*normal);
        float facing=.22+.78*abs(dot(viewNormal,normalize(-mv.xyz)));
        float tissue=clamp(.42+aMask.r*.28+aMask.a*.24+aMask.g*.12,0.0,1.0);
        float quiet=.84+.16*sin(aSeed*83.0+uTime*.23);
        vAlpha=(.055+tissue*.145)*facing*quiet;
        vSeed=aSeed;
        vec3 blue=vec3(.085,.175,.215);
        vec3 pearl=vec3(.40,.50,.515);
        vColor=mix(blue,pearl,.22+aMask.r*.18+aMask.a*.20+facing*.22);
        gl_PointSize=(.85+aSeed*1.0+aMask.a*.38)*uPixelRatio*clamp(6.0/max(.01,-mv.z),.62,1.48);
        gl_Position=projectionMatrix*mv;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying float vAlpha;
      varying float vSeed;
      varying vec3 vColor;
      void main(){
        vec2 p=gl_PointCoord-.5;
        float d=dot(p,p)*4.0;
        if(d>1.0)discard;
        float grain=.70+.30*fract(vSeed*91.73);
        float edge=1.0-smoothstep(.18,1.0,d);
        gl_FragColor=vec4(vColor,vAlpha*edge*grain*uOpacity);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
}

function routeMaterial({ pixelRatio, distanceTexture, textureSize, pointCount, detached = false }) {
  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: pixelRatio },
    uDistanceTexture: { value: distanceTexture },
    uDistanceTextureSize: { value: new THREE.Vector2(...textureSize) },
    uPointCount: { value: pointCount },
    uSource: { value: 0 },
    uTargets: { value: new THREE.Vector3(1, 2, 3) },
    uTotals: { value: new THREE.Vector3(1, 1, 1) },
    uOldSource: { value: 0 },
    uOldTargets: { value: new THREE.Vector3(1, 2, 3) },
    uOldTotals: { value: new THREE.Vector3(1, 1, 1) },
    uTargetPositions: { value: Array.from({ length: 3 }, () => new THREE.Vector3()) },
    uOldTargetPositions: { value: Array.from({ length: 3 }, () => new THREE.Vector3()) },
    uProgress: { value: 0 },
    uEnergy: { value: 0 },
    uOldFade: { value: 0 },
    uDetached: { value: detached ? 1 : 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      attribute vec4 aMask;
      attribute float aSeed;
      attribute float aPointIndex;
      uniform sampler2D uDistanceTexture;
      uniform vec2 uDistanceTextureSize;
      uniform float uPointCount;
      uniform float uSource;
      uniform vec3 uTargets;
      uniform vec3 uTotals;
      uniform float uOldSource;
      uniform vec3 uOldTargets;
      uniform vec3 uOldTotals;
      uniform vec3 uTargetPositions[3];
      uniform vec3 uOldTargetPositions[3];
      uniform float uProgress;
      uniform float uEnergy;
      uniform float uOldFade;
      uniform float uDetached;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      varying float vHeat;
      varying float vSeed;
      varying vec2 vDirection;

      float field(float node){
        float linear=node*uPointCount+aPointIndex;
        vec2 cell=vec2(mod(linear,uDistanceTextureSize.x),floor(linear/uDistanceTextureSize.x));
        return texture2D(uDistanceTexture,(cell+.5)/uDistanceTextureSize).r;
      }
      vec3 branch(float source,float target,float total,float progress){
        float ds=field(source);
        float dt=field(target);
        float error=abs(ds+dt-total);
        float width=.055+total*.0125;
        float corridor=1.0-smoothstep(width,width*2.15,error);
        float along=clamp(ds/max(total,.001),0.0,1.0);
        float front=1.0-smoothstep(progress-.025,progress+.055,along);
        float broken=.38+.62*smoothstep(.22,.88,fract(aSeed*37.13+floor(along*19.0)*.173));
        float packetA=pow(.5+.5*cos((along*5.2-uTime*.34)*6.2831853),13.0);
        float packetB=pow(.5+.5*cos((along*8.7-uTime*.51+1.7)*6.2831853),18.0)*.48;
        return vec3(corridor*front*broken,corridor*front*clamp(packetA+packetB,0.0,1.0),along);
      }
      void main(){
        vec3 b0=branch(uSource,uTargets.x,uTotals.x,uProgress);
        vec3 b1=branch(uSource,uTargets.y,uTotals.y,uProgress);
        vec3 b2=branch(uSource,uTargets.z,uTotals.z,uProgress);
        float live=max(b0.x,max(b1.x,b2.x));
        float livePulse=max(b0.y,max(b1.y,b2.y));
        vec3 targetPosition=uTargetPositions[0];
        float selected=b0.x;
        if(b1.x>selected){selected=b1.x;targetPosition=uTargetPositions[1];}
        if(b2.x>selected){targetPosition=uTargetPositions[2];}
        vec3 o0=branch(uOldSource,uOldTargets.x,uOldTotals.x,1.0);
        vec3 o1=branch(uOldSource,uOldTargets.y,uOldTotals.y,1.0);
        vec3 o2=branch(uOldSource,uOldTargets.z,uOldTotals.z,1.0);
        float old=max(o0.x,max(o1.x,o2.x))*uOldFade;
        float oldPulse=max(o0.y,max(o1.y,o2.y))*uOldFade;
        if(old>live){
          targetPosition=uOldTargetPositions[0];
          selected=o0.x;
          if(o1.x>selected){selected=o1.x;targetPosition=uOldTargetPositions[1];}
          if(o2.x>selected){targetPosition=uOldTargetPositions[2];}
        }
        float route=max(live,old*.74);
        float tissue=.46+aMask.a*.34+aMask.r*.14+aMask.g*.10;
        float movingPulse=max(livePulse,oldPulse*.72);
        float junction=smoothstep(.48,.84,aMask.g)*pow(.5+.5*sin(uTime*2.85+floor(position.y*.085)*.78),12.0)*route;
        vec3 surfaceNormal=normalize(normal);
        vec3 flowTangent=targetPosition-position;
        flowTangent-=surfaceNormal*dot(flowTangent,surfaceNormal);
        flowTangent=normalize(flowTangent+vec3(.0001,0.0,0.0));
        float detachedGate=step(.972,fract(aSeed*311.7));
        float drift=fract(uTime*.075+aSeed*3.7);
        vec3 renderPosition=position;
        renderPosition+=surfaceNormal*(.018+drift*.105)*uDetached*detachedGate;
        renderPosition+=flowTangent*(fract(aSeed*73.1)-.5)*.035*uDetached*detachedGate;
        vec4 mv=modelViewMatrix*vec4(renderPosition,1.0);
        vec3 viewNormal=normalize(normalMatrix*normal);
        float facing=.36+.64*abs(dot(viewNormal,normalize(-mv.xyz)));
        vAlpha=(route*(.13+movingPulse*1.18)+junction*.82)*uEnergy*tissue*facing*.69;
        vAlpha*=mix(1.0,detachedGate*(1.0-drift)*(.18+movingPulse*.82),uDetached);
        vHeat=clamp(movingPulse+junction*.65+live*.16+old*.08,0.0,1.0);
        vSeed=aSeed;
        vec3 viewFlow=(modelViewMatrix*vec4(flowTangent,0.0)).xyz;
        vDirection=normalize(viewFlow.xy+vec2(.0001,0.0));
        float mainSize=2.15+aSeed*1.65+movingPulse*1.35;
        float moteSize=1.15+aSeed*1.05+movingPulse*.65;
        gl_PointSize=mix(mainSize,moteSize,uDetached)*uPixelRatio*clamp(6.0/max(.01,-mv.z),.64,1.52);
        gl_Position=projectionMatrix*mv;
      }
    `,
    fragmentShader: `
      uniform float uDetached;
      varying float vAlpha;
      varying float vHeat;
      varying float vSeed;
      varying vec2 vDirection;
      void main(){
        if(vAlpha<.008||fract(vSeed*83.17)>.66)discard;
        vec2 p=gl_PointCoord-.5;
        vec2 direction=normalize(vDirection+vec2(.0001,0.0));
        vec2 side=vec2(-direction.y,direction.x);
        float along=dot(p,direction);
        float across=dot(p,side);
        float streak=along*along*2.1+across*across*13.5;
        float mote=dot(p,p)*4.0;
        float d=mix(streak,mote,uDetached);
        if(d>1.0)discard;
        float edge=1.0-smoothstep(.14,1.0,d);
        float pores=.76+.24*fract(vSeed*117.31);
        vec3 coral=vec3(.84,.105,.075);
        vec3 pearl=vec3(1.0,.54,.38);
        vec3 color=mix(coral,pearl,clamp(vHeat*.62+pores*.16,0.0,1.0));
        color=mix(color,vec3(1.0,.66,.51),uDetached*.34);
        gl_FragColor=vec4(color*(.73+vHeat*.27),vAlpha*edge*mix(.76,.58,uDetached));
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
  return material;
}

function routeConfiguration(nodeCenters, variant = 0) {
  const source = nodeCenters.map((point, index) => ({ point, index }))
    .sort((a, b) => a.point.y - b.point.y)[1]?.index ?? 0;
  const candidates = nodeCenters.map((point, index) => ({ point, index }))
    .filter(entry => entry.index !== source);
  const upper = [...candidates].sort((a, b) => b.point.y - a.point.y);
  const left = [...candidates].sort((a, b) => a.point.x - b.point.x);
  const right = [...candidates].sort((a, b) => b.point.x - a.point.x);
  const pools = variant === 0
    ? [upper[0], upper[1], left[1]]
    : [upper[2], left[0], right[0]];
  const targets = [];
  for (const entry of [...pools, ...upper, ...left, ...right]) {
    if (entry && !targets.includes(entry.index)) targets.push(entry.index);
    if (targets.length === 3) break;
  }
  return { source, targets };
}

function setVector3(vector, values) {
  vector.set(values[0], values[1], values[2]);
}

export function c02RoutingDemoProfile(age) {
  if (age < 3.0) return { energy: .06, progress: 0, oldFade: 0, route: 0, phase: "dormant" };
  if (age < 6.0) return { energy: smooth(age, 3.0, 4.0), progress: smooth(age, 3.0, 6.0), oldFade: 0, route: 0, phase: "routing" };
  if (age < 9.0) return { energy: 1, progress: 1, oldFade: 0, route: 0, phase: "pulsing" };
  if (age < 14.0) return { energy: 1, progress: THREE.MathUtils.lerp(.42,1,smooth(age, 9.0, 14.0)), oldFade: 1-smooth(age, 9.0, 13.5), route: 1, phase: "rerouting" };
  if (age < 18.0) return { energy: 1, progress: 1, oldFade: 0, route: 1, phase: "pulsing" };
  if (age < 21.0) return { energy: 1-smooth(age, 18.0, 21.0), progress: 1, oldFade: 0, route: 1, phase: "cooling" };
  return { energy: 0, progress: 0, oldFade: 0, route: 1, phase: "dormant" };
}

function pickWrist(control) {
  return [control?.points?.[15], control?.points?.[16]]
    .filter(point => point && (point.visibility ?? 1) > .42)
    .sort((a, b) => (b.visibility ?? 1) - (a.visibility ?? 1))[0] ?? null;
}

export function createC02SurfaceRouting({ data, modelOffset = new THREE.Vector3(), pixelRatio = 1, reducedMotion = false } = {}) {
  if (!data) throw new Error("C02 surface routing data is required");
  const { metadata, arrays } = data;
  const positions = normalizedPositions(arrays.position, metadata, modelOffset);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(arrays.normal), 3));
  geometry.setAttribute("aMask", new THREE.BufferAttribute(new Uint8Array(arrays.mask), 4, true));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(arrays.seed), 1));
  geometry.setAttribute("aPointIndex", new THREE.BufferAttribute(Float32Array.from({ length: metadata.pointCount }, (_, index) => index), 1));
  geometry.computeBoundingSphere();

  const nodeCenters = metadata.nodeCenters.map(values => normalizePoint(new THREE.Vector3(...values), metadata.bounds, modelOffset));
  const distance = makeDistanceTexture(arrays.distance);
  const quietMaterial = baseMaterial(pixelRatio);
  const activeMaterial = routeMaterial({
    pixelRatio,
    distanceTexture: distance.texture,
    textureSize: [distance.width, distance.height],
    pointCount: metadata.pointCount,
  });
  const moteMaterial = routeMaterial({
    pixelRatio,
    distanceTexture: distance.texture,
    textureSize: [distance.width, distance.height],
    pointCount: metadata.pointCount,
    detached: true,
  });
  for (const [name, uniform] of Object.entries(activeMaterial.uniforms)) {
    if (name !== "uDetached") moteMaterial.uniforms[name] = uniform;
  }
  const group = new THREE.Group();
  group.name = "C02_Intrinsic_Surface_Routing";
  const quietPoints = new THREE.Points(geometry, quietMaterial);
  const activePoints = new THREE.Points(geometry, activeMaterial);
  const detachedPoints = new THREE.Points(geometry, moteMaterial);
  for (const points of [quietPoints, activePoints, detachedPoints]) {
    points.frustumCulled = false;
    group.add(points);
  }
  quietPoints.renderOrder = 3;
  activePoints.renderOrder = 5;
  detachedPoints.renderOrder = 6;

  const configs = [routeConfiguration(nodeCenters, 0), routeConfiguration(nodeCenters, 1)];
  const state = {
    // Start after the preview timeline. A demo begins only when its counter
    // changes; otherwise the observation opens in the same quiet base state
    // as the other organisms.
    energy: 0, progress: 0, oldFade: 0, phase: "dormant", demoSeen: 0, demoAge: C02_ROUTING_IDLE_AGE,
    route: -1, source: configs[0].source, targets: configs[0].targets,
    wrist: new THREE.Vector2(.5, .5), wristSeen: false, cameraOpen: false, routeCooldown: 0,
  };
  const uniforms = activeMaterial.uniforms;
  const applyRoute = (configuration, preserveOld = true) => {
    if (preserveOld && state.route >= 0) {
      uniforms.uOldSource.value = uniforms.uSource.value;
      uniforms.uOldTargets.value.copy(uniforms.uTargets.value);
      uniforms.uOldTotals.value.copy(uniforms.uTotals.value);
      uniforms.uOldTargetPositions.value.forEach((point, index) => point.copy(uniforms.uTargetPositions.value[index]));
      state.oldFade = 1;
    }
    state.source = configuration.source;
    state.targets = [...configuration.targets];
    uniforms.uSource.value = configuration.source;
    setVector3(uniforms.uTargets.value, configuration.targets);
    setVector3(uniforms.uTotals.value, configuration.targets.map(target => metadata.nodeMatrix[configuration.source][target]));
    configuration.targets.forEach((target, index) => uniforms.uTargetPositions.value[index].copy(nodeCenters[target]));
  };
  applyRoute(configs[0], false);
  uniforms.uOldSource.value = uniforms.uSource.value;
  uniforms.uOldTargets.value.copy(uniforms.uTargets.value);
  uniforms.uOldTotals.value.copy(uniforms.uTotals.value);
  uniforms.uOldTargetPositions.value.forEach((point, index) => point.copy(uniforms.uTargetPositions.value[index]));
  state.route = 0;

  const projectNodes = (camera) => nodeCenters.map(point => group.localToWorld(point.clone()).project(camera));
  const cameraConfiguration = (wrist, velocity, camera) => {
    const projected = projectNodes(camera);
    const source = projected.reduce((best, point, index) => {
      const distance = Math.hypot(point.x - (wrist.x * 2 - 1), point.y - (1 - wrist.y * 2));
      return distance < best.distance ? { index, distance } : best;
    }, { index: 0, distance: Infinity }).index;
    const direction = velocity.lengthSq() > .0004 ? velocity.clone().normalize() : new THREE.Vector2(.15, -1).normalize();
    const origin = projected[source];
    const targets = projected.map((point, index) => ({
      index,
      score: index === source ? -Infinity : (point.x-origin.x)*direction.x-(point.y-origin.y)*direction.y + Math.hypot(point.x-origin.x,point.y-origin.y)*.22,
    })).sort((a,b)=>b.score-a.score).slice(0,3).map(entry=>entry.index);
    return { source, targets };
  };

  const update = ({ dt, time, control, camera, active = true }) => {
    if (control?.demo !== state.demoSeen) {
      state.demoSeen = control.demo;
      state.demoAge = 0;
      state.route = 0;
      applyRoute(configs[0], false);
    }
    state.demoAge += dt;
    state.routeCooldown = Math.max(0, state.routeCooldown-dt);
    let target = c02RoutingDemoProfile(state.demoAge);
    let targetOldFade = target.oldFade;
    if (target.route !== state.route) {
      applyRoute(configs[target.route], true);
      state.route = target.route;
    }

    const wrist = pickWrist(control);
    const open = active && control?.mode === "camera" && wrist
      && control.handCommand === "open" && (control.handConfidence ?? 0) > .42;
    // A manual preview always owns its full timeline, even when the camera is
    // already connected. Live hand control takes over after the preview cools.
    if (control?.mode === "camera" && state.demoAge >= 21) {
      if (open) {
        const current = new THREE.Vector2(wrist.x, wrist.y);
        const velocity = state.wristSeen ? current.clone().sub(state.wrist) : new THREE.Vector2();
        state.wrist.lerp(current, 1-Math.exp(-dt*9));
        state.wristSeen = true;
        if ((!state.cameraOpen || velocity.length() > .035) && state.routeCooldown <= 0 && camera) {
          applyRoute(cameraConfiguration(current, velocity, camera), state.cameraOpen);
          state.routeCooldown = .55;
        }
        state.cameraOpen = true;
        target = { energy: 1, progress: 1, phase: "rerouting" };
        targetOldFade = Math.max(0, state.oldFade-dt*.82);
      } else {
        state.cameraOpen = false;
        state.wristSeen = false;
        target = { energy: 0, progress: 0, phase: state.energy > .08 ? "cooling" : "dormant" };
        targetOldFade = Math.max(0, state.oldFade-dt*.62);
      }
    }

    const visible = active ? 1 : 0;
    state.energy = THREE.MathUtils.damp(state.energy, target.energy*visible, target.energy > state.energy ? 2.3 : .72, dt);
    state.progress = THREE.MathUtils.damp(state.progress, target.progress*visible, target.progress > state.progress ? 1.8 : .8, dt);
    state.oldFade = THREE.MathUtils.damp(state.oldFade, targetOldFade*visible, 1.45, dt);
    state.phase = active ? target.phase : "dormant";
    uniforms.uTime.value = time;
    uniforms.uEnergy.value = state.energy;
    uniforms.uProgress.value = reducedMotion ? (state.energy > .05 ? 1 : 0) : state.progress;
    uniforms.uOldFade.value = reducedMotion ? 0 : state.oldFade;
    quietMaterial.uniforms.uTime.value = time;
    const interactionVisibility = visible * smooth(state.energy, .004, .10);
    quietMaterial.uniforms.uOpacity.value = interactionVisibility;
    group.visible = interactionVisibility > .001;
    return state;
  };

  const dispose = () => {
    geometry.dispose();
    quietMaterial.dispose();
    activeMaterial.dispose();
    moteMaterial.dispose();
    distance.texture.dispose();
  };
  return { group, state, update, dispose, metadata };
}
