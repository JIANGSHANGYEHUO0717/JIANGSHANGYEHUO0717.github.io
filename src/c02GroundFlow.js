import * as THREE from "three";

const clamp01 = value => THREE.MathUtils.clamp(value, 0, 1);
const smooth = (value, from, to) => THREE.MathUtils.smoothstep(value, from, to);
const ROOT_CENTER = new THREE.Vector3(0, -1.43, .02);
const ROOT_PORTS = [
  [-.34, -1.49, .04], [-.28, -1.43, .22], [-.19, -1.40, -.23],
  [-.08, -1.38, .30], [.05, -1.41, -.29], [.18, -1.40, .24],
  [.31, -1.47, -.07], [.22, -1.34, -.24], [-.20, -1.32, .27],
].map(point => new THREE.Vector3(...point));

const ROUTE_TARGETS = [
  [-.21,-.525,.035], [.535,-.38,-.28], [-.755,-.215,.38], [-.26,-.13,.39],
  [.315,-.02,.105], [.725,.11,-.395], [-.13,.41,.085], [.31,.45,-.025],
  [.775,.75,-.13], [-.45,1.03,.33], [.375,1.31,-.015],
].map(point => new THREE.Vector3(...point));

function createRandom(initial = 0xc02b41) {
  let seed = initial >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function makeData() {
  return { positions: [], tangents: [], along: [], stages: [], domains: [], seeds: [], speeds: [], sizes: [], variations: [] };
}

function appendCurve(data, curve, options, random) {
  const {
    samples = 56, domain = 1, pathSeed = 0, speed = .14, amplitude = .04,
    reverse = false, stageStart = 0, stageSpan = 1,
  } = options;
  const axis = new THREE.Vector3(random() - .5, random() - .5, random() - .5).normalize();
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const second = new THREE.Vector3();
  const wavePhase = random() * Math.PI * 2;
  const waveCount = 1.4 + random() * 3.8;
  for (let index = 0; index < samples; index++) {
    const t = index / Math.max(1, samples - 1);
    curve.getPoint(t, point);
    curve.getTangent(t, tangent).normalize();
    side.crossVectors(tangent, axis);
    if (side.lengthSq() < .0001) side.crossVectors(tangent, new THREE.Vector3(0, 0, 1));
    side.normalize();
    second.crossVectors(tangent, side).normalize();
    const middle = Math.sin(Math.PI * t);
    const braid = Math.sin(t * Math.PI * 2 * waveCount + wavePhase) * amplitude * middle;
    const counter = Math.cos(t * Math.PI * 2 * (waveCount * .63 + .4) + wavePhase * .7) * amplitude * .56 * middle;
    point.addScaledVector(side, braid).addScaledVector(second, counter);
    data.positions.push(point.x, point.y, point.z);
    data.tangents.push(tangent.x, tangent.y, tangent.z);
    data.along.push(t);
    const heightStage = clamp01((point.y + 1.51) / 3.02);
    const pathStage = clamp01(stageStart + t * stageSpan);
    data.stages.push(domain < .5 ? 0 : THREE.MathUtils.lerp(heightStage, pathStage, .72));
    data.domains.push(domain);
    data.seeds.push(pathSeed);
    data.speeds.push(reverse ? -speed : speed);
    data.sizes.push(THREE.MathUtils.lerp(2.15, domain < .5 ? 4.8 : 5.4, random()));
    data.variations.push(.38 + random() * .62);
  }
}

function dataGeometry(data) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute("aTangent", new THREE.Float32BufferAttribute(data.tangents, 3));
  geometry.setAttribute("aAlong", new THREE.Float32BufferAttribute(data.along, 1));
  geometry.setAttribute("aStage", new THREE.Float32BufferAttribute(data.stages, 1));
  geometry.setAttribute("aDomain", new THREE.Float32BufferAttribute(data.domains, 1));
  geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(data.seeds, 1));
  geometry.setAttribute("aSpeed", new THREE.Float32BufferAttribute(data.speeds, 1));
  geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(data.sizes, 1));
  geometry.setAttribute("aVariation", new THREE.Float32BufferAttribute(data.variations, 1));
  return geometry;
}

function createInternalStreams(reducedMotion) {
  const random = createRandom(0xc02f71);
  const data = makeData();
  ROUTE_TARGETS.forEach((target, routeIndex) => {
    const strandCount = reducedMotion ? 4 : 9 + (routeIndex % 4);
    for (let strand = 0; strand < strandCount; strand++) {
      const port = ROOT_PORTS[(routeIndex * 3 + strand) % ROOT_PORTS.length].clone();
      port.x += (random() - .5) * .055;
      port.y += (random() - .5) * .035;
      port.z += (random() - .5) * .055;
      const controls = [port];
      const direction = (routeIndex + strand) % 2 ? 1 : -1;
      const startAngle = Math.atan2(port.z - ROOT_CENTER.z, port.x - ROOT_CENTER.x);
      const helixCount = target.y > .45 ? 5 : target.y > .02 ? 4 : 3;
      const helixTop = Math.min(target.y - .13, .42);
      for (let level = 0; level < helixCount; level++) {
        const ratio = (level + 1) / helixCount;
        const angle = startAngle + direction * (.72 + level * (1.02 + random() * .34)) + routeIndex * .14;
        const radius = THREE.MathUtils.lerp(.21, .29, ratio) + (random() - .5) * .045;
        const centerX = .035 * Math.sin(ratio * Math.PI * 1.7 + routeIndex * .41);
        const centerZ = .025 * Math.cos(ratio * Math.PI * 1.3 + routeIndex * .29);
        controls.push(new THREE.Vector3(
          centerX + Math.cos(angle) * radius,
          THREE.MathUtils.lerp(-1.29, helixTop, ratio),
          centerZ + Math.sin(angle) * radius * .9,
        ));
      }
      const last = controls.at(-1);
      const bridge = last.clone().lerp(target, .54);
      const tangent = target.clone().sub(last).normalize();
      const curl = new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(direction * (.10 + random() * .13));
      bridge.add(curl);
      bridge.y += (random() - .5) * .08;
      controls.push(bridge, target.clone());
      const curve = new THREE.CatmullRomCurve3(controls, false, "centripetal", .34);
      appendCurve(data, curve, {
        samples: reducedMotion ? 58 : 112,
        domain: 1,
        pathSeed: random(),
        speed: .09 + random() * .16,
        amplitude: .007 + random() * .026,
        stageStart: .07 + random() * .18 + routeIndex * .009,
        stageSpan: .57 + random() * .23,
        reverse: random() < .045 && routeIndex > 5,
      }, random);
    }
  });

  const membraneAnchors = [
    [-.42,-.38,.18],[-.22,-.18,.29],[.05,-.34,-.13],[.36,-.19,-.20],
    [-.39,.05,.23],[-.10,.11,-.20],[.29,.13,.14],[-.24,.42,.19],[.24,.46,-.09],
  ].map(point => new THREE.Vector3(...point));
  const crossCount = reducedMotion ? 7 : 24;
  for (let index = 0; index < crossCount; index++) {
    const start = membraneAnchors[index % membraneAnchors.length].clone();
    let end = membraneAnchors[(index * 4 + 3) % membraneAnchors.length].clone();
    if (start.distanceTo(end) < .28) end = membraneAnchors[(index + 5) % membraneAnchors.length].clone();
    const middleA = start.clone().lerp(end, .34);
    const middleB = start.clone().lerp(end, .68);
    const bend = index % 2 ? 1 : -1;
    middleA.x += bend * (.10 + random() * .14);
    middleA.z -= bend * (.12 + random() * .15);
    middleA.y += (random() - .5) * .12;
    middleB.x -= bend * (.12 + random() * .15);
    middleB.z += bend * (.09 + random() * .17);
    middleB.y += (random() - .5) * .12;
    const curve = new THREE.CatmullRomCurve3([start, middleA, middleB, end], false, "centripetal", .32);
    appendCurve(data, curve, {
      samples: reducedMotion ? 46 : 88,
      domain: 1,
      pathSeed: random(),
      speed: .08 + random() * .15,
      amplitude: .008 + random() * .026,
      stageStart: .42 + random() * .24,
      stageSpan: .24 + random() * .23,
      reverse: random() < .45,
    }, random);
  }
  return dataGeometry(data);
}

function createGroundStreams(reducedMotion) {
  const random = createRandom(0x02a711);
  const data = makeData();
  const pathCount = reducedMotion ? 30 : 78;
  for (let index = 0; index < pathCount; index++) {
    const angle = random() * Math.PI * 2;
    const radius = 1.35 + random() * 1.35;
    const start = new THREE.Vector3(
      Math.cos(angle) * radius * (1.0 + random() * .28),
      -1.60 - random() * .34,
      Math.sin(angle) * radius * .34,
    );
    const port = ROOT_PORTS[(index * 5 + Math.floor(random() * ROOT_PORTS.length)) % ROOT_PORTS.length].clone();
    const turn = (random() < .5 ? -1 : 1) * (.48 + random() * 1.08);
    const controls = [start];
    for (let step = 1; step <= 3; step++) {
      const ratio = step / 4;
      const localRadius = THREE.MathUtils.lerp(radius, .42 + random() * .18, ratio);
      const localAngle = angle + turn * ratio + Math.sin(ratio * Math.PI * 2 + index) * .22;
      controls.push(new THREE.Vector3(
        Math.cos(localAngle) * localRadius + (random() - .5) * .18,
        -1.58 + Math.sin(index * .73 + step * 1.61) * .16 - random() * .17,
        Math.sin(localAngle) * localRadius * .38 + (random() - .5) * .20,
      ));
    }
    controls.push(port);
    const curve = new THREE.CatmullRomCurve3(controls, false, "centripetal", .38);
    appendCurve(data, curve, {
      samples: reducedMotion ? 56 : 104,
      domain: 0,
      pathSeed: random(),
      speed: .055 + random() * .17,
      amplitude: .012 + random() * .048,
    }, random);
  }

  const eddyCount = reducedMotion ? 7 : 22;
  for (let index = 0; index < eddyCount; index++) {
    const side = index % 2 ? 1 : -1;
    const center = new THREE.Vector3(
      side * (.55 + random() * 1.35),
      -1.58 - random() * .29,
      (random() - .5) * .55,
    );
    const radiusX = .16 + random() * .34;
    const radiusZ = .08 + random() * .20;
    const controls = [];
    const count = 6 + Math.floor(random() * 3);
    for (let pointIndex = 0; pointIndex < count; pointIndex++) {
      const angle = pointIndex / count * Math.PI * 2;
      controls.push(new THREE.Vector3(
        center.x + Math.cos(angle) * radiusX * (.72 + random() * .52),
        center.y + Math.sin(angle * 2 + index) * (.055 + random() * .055),
        center.z + Math.sin(angle) * radiusZ * (.72 + random() * .52),
      ));
    }
    const curve = new THREE.CatmullRomCurve3(controls, true, "centripetal", .36);
    appendCurve(data, curve, {
      samples: reducedMotion ? 48 : 94,
      domain: 0,
      pathSeed: random(),
      speed: .07 + random() * .16,
      amplitude: .006 + random() * .022,
      reverse: random() < .5,
    }, random);
  }
  return dataGeometry(data);
}

function chooseGeometry(entries, total, value) {
  let target = value * total;
  for (const entry of entries) {
    target -= entry.count;
    if (target <= 0) return entry.geometry;
  }
  return entries.at(-1)?.geometry ?? null;
}

function createStructureGeometry(geometries, modelOffset, reducedMotion) {
  const random = createRandom(0xc02057);
  const entries = geometries.filter(geometry => geometry?.getAttribute("position"))
    .map(geometry => ({ geometry, count: geometry.getAttribute("position").count }));
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  const count = reducedMotion ? 4600 : 13800;
  const positions = new Float32Array(count * 3);
  const flowUvs = new Float32Array(count * 2);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count);
  const point = new THREE.Vector3();
  for (let index = 0; index < count; index++) {
    const geometry = chooseGeometry(entries, total, random());
    if (!geometry) continue;
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const vertex = Math.min(position.count - 1, Math.floor(random() * position.count));
    point.fromBufferAttribute(position, vertex).add(modelOffset);
    positions.set(point.toArray(), index * 3);
    if (uv) {
      flowUvs[index * 2] = uv.getX(vertex);
      flowUvs[index * 2 + 1] = uv.getY(vertex);
    }
    sizes[index] = 1.15 + random() * 1.65;
    seeds[index] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aFlowUv", new THREE.BufferAttribute(flowUvs, 2));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  return geometry;
}

function structureMaterial(pixelRatio, maskTexture) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uEnergy: { value: 0 }, uPixelRatio: { value: pixelRatio }, uMask: { value: maskTexture } },
    vertexShader: `
      attribute float aSize; attribute float aSeed; attribute vec2 aFlowUv;
      uniform float uTime; uniform float uEnergy; uniform float uPixelRatio;
      varying float vAlpha; varying vec2 vFlowUv;
      void main(){
        vec3 p=position;
        p+=normalize(p+vec3(.001))*sin(uTime*.31+aSeed*37.0)*.0025;
        vec4 mv=modelViewMatrix*vec4(p,1.0);
        gl_PointSize=aSize*uPixelRatio*clamp(5.6/max(.01,-mv.z),.55,1.55);
        gl_Position=projectionMatrix*mv;
        vAlpha=mix(.16,.075,uEnergy)*(.48+.52*sin(aSeed*71.0+uTime*.42)*.5+.26);
        vFlowUv=aFlowUv;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMask; varying float vAlpha; varying vec2 vFlowUv;
      void main(){
        vec2 p=gl_PointCoord-.5; float d=dot(p,p)*4.0;
        if(d>1.0) discard;
        vec4 mask=texture2D(uMask,vFlowUv);
        vec3 color=mix(vec3(.12,.25,.31),vec3(.25,.46,.55),.42+mask.r*.30);
        color=mix(color,vec3(.52,.22,.22),mask.g*.12);
        gl_FragColor=vec4(color,vAlpha*(1.0-smoothstep(.18,1.0,d)));
      }
    `,
    transparent: true, depthTest: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
}

function filamentMaterial(pixelRatio, opacity = 1, timeOffset = 0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uEnergy: { value: 0 }, uProgress: { value: 0 }, uBias: { value: 0 },
      uPixelRatio: { value: pixelRatio }, uOpacity: { value: opacity }, uTimeOffset: { value: timeOffset },
    },
    vertexShader: `
      attribute vec3 aTangent;
      attribute float aAlong; attribute float aStage; attribute float aDomain;
      attribute float aSeed; attribute float aSpeed; attribute float aSize; attribute float aVariation;
      uniform float uTime; uniform float uEnergy; uniform float uProgress; uniform float uBias;
      uniform float uPixelRatio; uniform float uOpacity; uniform float uTimeOffset;
      varying vec2 vDirection; varying float vAlpha; varying float vHead; varying float vDomain;
      void main(){
        float time=uTime+uTimeOffset;
        float packetPhase=fract(aAlong-time*aSpeed-aSeed);
        float packet=exp(-packetPhase*11.0)+.48*exp(-fract(packetPhase+.39)*18.0);
        float head=smoothstep(.34,1.05,packet);
        float arrival=aDomain<.5 ? 1.0 : smoothstep(aStage-.12-aVariation*.035,aStage+.035,uProgress);
        float activity=aDomain<.5 ? (.035+uEnergy*.965) : uEnergy*arrival;
        float directionWeight=clamp(.72+uBias*sign(position.x)*.24,.45,1.12);
        float baseThread=aDomain<.5?.092:.068;
        float packetStrength=aDomain<.5?mix(.72,1.22,aVariation):mix(.54,.98,aVariation);
        vAlpha=activity*(baseThread+packet*packetStrength)*directionWeight*uOpacity;
        vHead=head; vDomain=aDomain;
        vec4 mv=modelViewMatrix*vec4(position,1.0);
        vec3 viewT=(modelViewMatrix*vec4(aTangent,0.0)).xyz;
        vDirection=normalize(viewT.xy+vec2(.0001,0.0));
        gl_PointSize=aSize*uPixelRatio*clamp(5.6/max(.01,-mv.z),.55,1.55)*(1.0+head*.28);
        gl_Position=projectionMatrix*mv;
      }
    `,
    fragmentShader: `
      varying vec2 vDirection; varying float vAlpha; varying float vHead; varying float vDomain;
      void main(){
        vec2 p=gl_PointCoord-.5;
        vec2 direction=normalize(vDirection+vec2(.0001,0.0));
        vec2 side=vec2(-direction.y,direction.x);
        float along=dot(p,direction); float across=dot(p,side);
        float d=along*along*1.45+across*across*11.5;
        if(d>1.0) discard;
        float soft=exp(-d*3.6);
        vec3 groundCool=vec3(.16,.35,.43);
        vec3 coral=vec3(.94,.31,.29);
        vec3 hot=vec3(1.0,.73,.61);
        vec3 color=mix(coral,hot,vHead*.72);
        if(vDomain<.5) color=mix(groundCool,color,.38+vHead*.62);
        float alpha=vAlpha*soft;
        if(alpha<.002) discard;
        gl_FragColor=vec4(color*(1.02+vHead*.72),alpha);
      }
    `,
    transparent: true, depthTest: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
}

export function c02DemoProfile(age) {
  if (age < 0 || age > 14.4) return { energy: 0, progress: 0 };
  if (age < 2.1) return { energy: smooth(age, 0, 2.1) * .34, progress: smooth(age, .55, 2.1) * .025 };
  if (age < 4.1) return {
    energy: THREE.MathUtils.lerp(.34, .62, smooth(age, 2.1, 4.1)),
    progress: THREE.MathUtils.lerp(.025, .25, smooth(age, 2.1, 4.1)),
  };
  if (age < 8.6) return {
    energy: THREE.MathUtils.lerp(.62, 1, smooth(age, 4.1, 8.6)),
    progress: THREE.MathUtils.lerp(.25, 1, smooth(age, 4.1, 8.6)),
  };
  if (age < 10.2) return { energy: 1, progress: 1 };
  const fade = 1 - smooth(age, 10.2, 14.4);
  return { energy: fade, progress: THREE.MathUtils.lerp(.06, 1, fade) };
}

export function createC02GroundFlow({ geometries = [], modelOffset = new THREE.Vector3(), maskTexture = null, pixelRatio = 1, reducedMotion = false } = {}) {
  const group = new THREE.Group();
  group.name = "C02_Braided_Dark_Current";
  const structureGeometry = createStructureGeometry(geometries, modelOffset, reducedMotion);
  const internalGeometry = createInternalStreams(reducedMotion);
  const groundGeometry = createGroundStreams(reducedMotion);
  const structure = structureMaterial(pixelRatio, maskTexture);
  const materials = [
    structure,
    filamentMaterial(pixelRatio, 1, 0),
    filamentMaterial(pixelRatio, .28, -.085),
    filamentMaterial(pixelRatio, 1, 0),
    filamentMaterial(pixelRatio, .22, -.10),
  ];
  const addPoints = (geometry, material, order) => {
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = order;
    group.add(points);
  };
  addPoints(structureGeometry, materials[0], 1);
  addPoints(groundGeometry, materials[1], 3);
  addPoints(groundGeometry, materials[2], 2);
  addPoints(internalGeometry, materials[3], 6);
  addPoints(internalGeometry, materials[4], 5);

  const state = {
    energy: 0, progress: 0, bias: 0, hold: 0, armed: false, lost: 0,
    demoSeen: 0, demoAge: 99, phase: "idle",
  };
  const update = ({ dt, time, control, active = true }) => {
    if (control?.demo !== state.demoSeen) { state.demoSeen = control.demo; state.demoAge = 0; }
    if (state.demoAge < 14.5) state.demoAge += dt;
    const demo = c02DemoProfile(state.demoAge);
    let targetEnergy = active ? demo.energy : 0;
    let targetProgress = active ? demo.progress : 0;
    let targetBias = Math.sin(time * .19) * .31 + Math.sin(time * .073 + 1.7) * .14;

    if (active && control?.mode === "camera" && state.demoAge >= 14.4) {
      const wrist = [control.points?.[15], control.points?.[16]]
        .filter(point => point && (point.visibility ?? 1) > .42)
        .sort((a, b) => b.y - a.y)[0];
      const open = control.handCommand === "open" && (control.handConfidence ?? 0) > .42;
      if (wrist && open) {
        state.lost = 0;
        if (!state.armed && wrist.y > .56) state.hold += dt;
        else if (!state.armed) state.hold = Math.max(0, state.hold - dt * 1.7);
        if (state.hold > .28) state.armed = true;
        if (state.armed) {
          targetProgress = THREE.MathUtils.clamp((.78 - wrist.y) / .46, .025, 1);
          targetEnergy = .22 + targetProgress * .78;
          targetBias = THREE.MathUtils.clamp((.5 - wrist.x) * 2, -1, 1);
        } else {
          targetEnergy = smooth(state.hold, 0, .28) * .26;
          targetProgress = smooth(state.hold, 0, .28) * .02;
        }
      } else {
        state.lost += dt;
        targetEnergy = 0; targetProgress = 0;
        if (state.lost > .7) { state.armed = false; state.hold = 0; }
      }
    }

    state.energy = THREE.MathUtils.damp(state.energy, targetEnergy, targetEnergy > state.energy ? 2.0 : .62, dt);
    state.progress = THREE.MathUtils.damp(state.progress, targetProgress, targetProgress > state.progress ? 1.45 : .48, dt);
    state.bias = THREE.MathUtils.damp(state.bias, targetBias, 1.35, dt);
    if (state.energy < .015) state.phase = "idle";
    else if (state.progress < .045) state.phase = "crawling";
    else if (state.progress < .27) state.phase = "converging";
    else if (state.progress < .78) state.phase = "climbing";
    else state.phase = "branching";

    structure.uniforms.uTime.value = time;
    structure.uniforms.uEnergy.value = state.energy;
    materials.slice(1).forEach(material => {
      material.uniforms.uTime.value = time;
      material.uniforms.uEnergy.value = state.energy;
      material.uniforms.uProgress.value = state.progress;
      material.uniforms.uBias.value = state.bias;
    });
    group.visible = active;
    return state;
  };

  const dispose = () => {
    structureGeometry.dispose(); internalGeometry.dispose(); groundGeometry.dispose();
    materials.forEach(material => material.dispose());
  };
  return { group, state, update, dispose };
}
