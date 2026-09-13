import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { clamp, INITIAL_SIGNAL } from "./signal.js";
import { ARCHIVE_ORGANISMS } from "./archiveAssets.js";
import { preloadSpecimenModel } from "./specimenAssets.js";
import { entryMotionAt } from "./entryMotion.js";
import { ARCHIVE_CAMERA, archiveFov, archivePlacement } from "./archiveReference/adapter.js";
import { createEscapeSystem } from "./c04Escape.js";
import { createHandEscapeState, advanceHandEscape } from "./c04HandState.js";
import { C04_DISSOLVE_GLSL, c04PhaseDetail } from "./c04Dissolve.js";
import { createArchiveReturn, preloadArchiveReturn, returnMotionAt, RETURN_PARTICLE_COUNT } from "./archiveReturn.js";

const BLENDER_CAMERA_FOV = THREE.MathUtils.radToDeg(0.6939551846210171);
const INITIAL_CAMERA_POSITION = new THREE.Vector3(-1.136, -0.92, 5.674);
const INITIAL_CAMERA_TARGET = new THREE.Vector3(0, -0.13, 0);

function smoothstep(start, end, value) {
  const amount = clamp((value - start) / Math.max(0.0001, end - start));
  return amount * amount * (3 - 2 * amount);
}

function sampledPointGeometry(geometry, bounds, maximum = 21000) {
  const source = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const stride = Math.max(1, Math.ceil(source.count / maximum));
  const values = [];
  const normalValues = [];
  const regionValues = [];
  const phaseValues = [];
  const seedValues = [];
  const height = Math.max(0.0001, bounds.max.y - bounds.min.y);
  const width = Math.max(0.0001, bounds.max.x - bounds.min.x);
  const centerX = bounds.min.x + width * 0.39;
  const centerY = bounds.min.y + height * 0.73;
  for (let index = 0; index < source.count; index += stride) {
    const x = source.getX(index);
    const y = source.getY(index);
    const z = source.getZ(index);
    const normalizedY = (y - bounds.min.y) / height;
    const upperRegion = smoothstep(0.46, 0.64, normalizedY);
    const radius = Math.hypot((x - centerX) / width, (y - centerY) / height);
    const outerBand = smoothstep(0.15, 0.25, radius) * (1 - smoothstep(0.6, 0.76, radius)) * upperRegion;
    const detail = c04PhaseDetail((x - bounds.min.x) / width, normalizedY, (z - bounds.min.z) / height);
    const disassemblyPhase = clamp(0.06 + (1 - normalizedY) * 0.68 - outerBand * 0.15 + detail, 0, 0.78);
    values.push(x, y, z);
    normalValues.push(normals?.getX(index) ?? 0, normals?.getY(index) ?? 1, normals?.getZ(index) ?? 0);
    regionValues.push(upperRegion);
    phaseValues.push(disassemblyPhase);
    seedValues.push(Math.random());
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
  result.setAttribute("normal", new THREE.Float32BufferAttribute(normalValues, 3));
  result.setAttribute("aRegion", new THREE.Float32BufferAttribute(regionValues, 1));
  result.setAttribute("aPhase", new THREE.Float32BufferAttribute(phaseValues, 1));
  result.setAttribute("aSeed", new THREE.Float32BufferAttribute(seedValues, 1));
  return result;
}

function createResponsePoints(bounds) {
  const width = Math.max(0.0001, bounds.max.x - bounds.min.x);
  const height = Math.max(0.0001, bounds.max.y - bounds.min.y);
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uRingPhase: { value: 0 },
      uRingSpeed: { value: 0 },
      uEscape: { value: 0 },
      uContourFade: { value: 0 },
      uEntry: { value: 1 },
      uOpacity: { value: 0.05 },
      uSize: { value: 0.043 },
      uRingCenter: { value: new THREE.Vector2(bounds.min.x + width * 0.39, bounds.min.y + height * 0.73) },
      uRange: { value: new THREE.Vector2(width, height) },
    },
    vertexShader: `
      uniform float uTime; uniform float uRingPhase; uniform float uRingSpeed; uniform float uEscape; uniform float uContourFade; uniform float uSize; uniform float uEntry;
      uniform vec2 uRingCenter; uniform vec2 uRange;
      attribute float aRegion; attribute float aPhase; attribute float aSeed;
      varying float vAlpha; varying float vSeed; varying float vConverted;
      ${C04_DISSOLVE_GLSL}
      void main(){
        vec3 p=position;
        vec2 ringCoord=vec2((position.x-uRingCenter.x)/uRange.x,(position.y-uRingCenter.y)/uRange.y);
        float radius=max(length(ringCoord),.001);
        vec2 tangent=normalize(vec2(-ringCoord.y/uRange.x,ringCoord.x/uRange.y));
        float outerBand=smoothstep(.15,.25,radius)*(1.0-smoothstep(.60,.76,radius))*aRegion;
        float innerFollow=(1.0-smoothstep(.12,.25,radius))*aRegion*.14;
        float traveling=sin(radius*38.0-uRingPhase*5.0+aSeed*6.28318);
        float flowMask=outerBand+innerFollow;
        float effectiveFlow=clamp(uRingSpeed+uEscape*.52,0.0,1.0);
        p.xy+=tangent*traveling*flowMask*effectiveFlow*.0125;
        p+=normal*sin(radius*31.0-uRingPhase*4.1+aSeed*3.0)*flowMask*effectiveFlow*.0050;
        float gathering=sin(clamp(uEntry,0.0,1.0)*3.14159265)*(1.0-smoothstep(.45,.75,uEntry));
        p+=normal*gathering*(.008+aSeed*.023);
        vec4 mv=modelViewMatrix*vec4(p,1.0);
        gl_Position=projectionMatrix*mv;
        float converted=c04Converted(aPhase,uEscape);
        float detached=c04Detached(aPhase,uEscape,uContourFade);
        gl_PointSize=uSize*(370.0/-mv.z)*(.55+aSeed*.85+converted*.35);
        float idleAlpha=aRegion*(.025+effectiveFlow*.055)*(.04+uRingSpeed*.1);
        // Use the final fine-point style as soon as this local surface changes.
        // Only coverage changes with the front; no whole-body color/size swap.
        vAlpha=mix(idleAlpha,.72+uRingSpeed*.1,converted)*(1.0-detached);
        vAlpha=max(vAlpha,(1.0-smoothstep(.68,1.0,uEntry))*(.6+aSeed*.4));
        vSeed=aSeed;
        vConverted=converted;
      }
    `,
    fragmentShader: `
      uniform float uOpacity; varying float vAlpha; varying float vSeed; varying float vConverted;
      void main(){
        float d=distance(gl_PointCoord,vec2(.5)); if(d>.5) discard;
        vec3 originalTint=mix(vec3(.36,.62,.65),vec3(.72,.89,.88),vSeed);
        vec3 smokeTint=mix(vec3(.09,.40,.55),vec3(.32,.72,.80),vSeed);
        vec3 tint=mix(originalTint,smokeTint,step(.001,vConverted));
        gl_FragColor=vec4(tint,smoothstep(.5,.04,d)*uOpacity*vAlpha);
      }
    `,
  });
}

function responsiveMaterial(source, shaderRefs, bounds) {
  const width = Math.max(0.0001, bounds.max.x - bounds.min.x);
  const height = Math.max(0.0001, bounds.max.y - bounds.min.y);
  const material = new THREE.MeshPhysicalMaterial({
    name: `${source.name || "category-4"}-membrane`,
    color: source.color?.clone() ?? new THREE.Color(0xffffff),
    map: source.map ?? null,
    normalMap: source.normalMap ?? null,
    normalScale: source.normalScale?.clone() ?? new THREE.Vector2(1, 1),
    roughnessMap: source.roughnessMap ?? null,
    metalnessMap: source.metalnessMap ?? null,
    alphaMap: source.alphaMap ?? null,
    aoMap: source.aoMap ?? null,
    aoMapIntensity: source.aoMapIntensity ?? 1,
    side: THREE.FrontSide,
    transparent: source.transparent ?? false,
    opacity: source.opacity ?? 1,
    alphaTest: source.alphaTest ?? 0,
    metalness: 0,
    roughness: Math.max(source.roughness ?? 0.7, 0.8),
    clearcoat: 0.015,
    clearcoatRoughness: 0.94,
    sheen: 0.035,
    sheenColor: new THREE.Color(0xbfd9d8),
    sheenRoughness: 0.95,
    transmission: 0,
    thickness: 0,
    attenuationColor: new THREE.Color(0x6ba7ae),
    attenuationDistance: 3.2,
    ior: 1.34,
    specularIntensity: 0.38,
    specularColor: new THREE.Color(0xc7d8d7),
    envMapIntensity: 0,
    emissive: new THREE.Color(0x07171a),
    emissiveIntensity: 0.025,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uRingPhase = { value: 0 };
    shader.uniforms.uRingSpeed = { value: 0 };
    shader.uniforms.uEscape = { value: 0 };
    shader.uniforms.uHandCloud = { value: 0 };
    shader.uniforms.uHandResponse = { value: 1 };
    shader.uniforms.uContourFade = { value: 0 };
    shader.uniforms.uEntrySurface = { value: 1 };
    shader.uniforms.uYMin = { value: bounds.min.y };
    shader.uniforms.uYMax = { value: bounds.max.y };
    shader.uniforms.uRingCenter = { value: new THREE.Vector2(bounds.min.x + width * 0.39, bounds.min.y + height * 0.73) };
    shader.uniforms.uRange = { value: new THREE.Vector2(width, height) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uRingPhase; uniform float uRingSpeed; uniform float uEscape; uniform vec2 uRingCenter; uniform vec2 uRange; varying float vOuterMembrane; varying float vDisassemblyPhase; varying float vHandPhase; varying vec3 vLocalPosition;\n" + C04_DISSOLVE_GLSL)
      .replace("#include <begin_vertex>", `
        vec3 transformed=vec3(position);
        float normalizedY=(position.y-${bounds.min.y.toFixed(7)})/${height.toFixed(7)};
        vec2 ringCoord=vec2((position.x-uRingCenter.x)/uRange.x,(position.y-uRingCenter.y)/uRange.y);
        float radius=max(length(ringCoord),.001);
        vec2 tangent=normalize(vec2(-ringCoord.y/uRange.x,ringCoord.x/uRange.y));
        float upperRegion=smoothstep(.46,.64,normalizedY);
        float outerBand=smoothstep(.15,.25,radius)*(1.0-smoothstep(.60,.76,radius))*upperRegion;
        float innerFollow=(1.0-smoothstep(.12,.25,radius))*upperRegion*.14;
        float traveling=sin(radius*37.0-uRingPhase*5.0+position.z*20.0);
        float flowMask=outerBand+innerFollow;
        float torsoRegion=smoothstep(.15,.28,normalizedY)*(1.0-smoothstep(.52,.67,normalizedY));
        float effectiveFlow=clamp(uRingSpeed+uEscape*.52,0.0,1.0);
        transformed.xy+=tangent*traveling*flowMask*effectiveFlow*.0125;
        transformed+=normal*sin(radius*31.0-uRingPhase*4.1+position.z*17.0)*flowMask*effectiveFlow*.0050;
        float membraneBreath=sin(uTime*.42+radius*5.0+position.z*2.0)*outerBand*.0096;
        float torsoBreath=sin(uTime*.27+position.y*2.4)*torsoRegion*.0020;
        transformed+=normal*(membraneBreath+torsoBreath);
        vOuterMembrane=outerBand;
        vDisassemblyPhase=clamp(.06+(1.0-normalizedY)*.68-outerBand*.15,0.0,.78);
        vec3 phasePosition=vec3((position.x-(${bounds.min.x.toFixed(7)}))/${width.toFixed(7)},normalizedY,(position.z-(${bounds.min.z.toFixed(7)}))/${height.toFixed(7)});
        vHandPhase=clamp(.06+(1.0-normalizedY)*.68-outerBand*.15+c04PhaseDetail(phasePosition),0.0,.78);
        vLocalPosition=position;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uRingPhase; uniform float uRingSpeed; uniform float uEscape; uniform float uHandCloud; uniform float uHandResponse; uniform float uContourFade; uniform float uEntrySurface; uniform float uYMin; uniform float uYMax; varying float vOuterMembrane; varying float vDisassemblyPhase; varying float vHandPhase; varying vec3 vLocalPosition; float p203Hash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}\n" + C04_DISSOLVE_GLSL)
      .replace("#include <clipping_planes_fragment>", `
        #include <clipping_planes_fragment>
        float entryGrain=p203Hash(floor(vLocalPosition*680.0));
        float entryPatch=.5+sin(vLocalPosition.y*55.0+vLocalPosition.x*19.0)*.17+sin(vLocalPosition.z*61.0-vLocalPosition.y*31.0)*.16;
        float entryThreshold=.025+vOuterMembrane*.30+entryPatch*.40+entryGrain*.22;
        if(uEntrySurface<entryThreshold) discard;
      `)
      .replace("#include <dithering_fragment>", `
        float fineNoise=p203Hash(floor(vLocalPosition*260.0));
        float directionalNoise=sin(vLocalPosition.x*121.0+vLocalPosition.z*73.0)*.045+sin(vLocalPosition.y*149.0-vLocalPosition.z*89.0)*.04;
        float escapeNoise=.44+fineNoise*.52+directionalNoise;
        float disassembly=smoothstep(vDisassemblyPhase,vDisassemblyPhase+.18,uEscape);
        float dissolveThreshold=mix(disassembly*.88,1.04,uContourFade);
        dissolveThreshold=max(dissolveThreshold,smoothstep(.86,1.0,uHandCloud)*1.06);
        float converted=c04Converted(vHandPhase,uHandCloud);
        if(uHandResponse>.5) {
          // Remove each converted surface completely. Do not retain the
          // reflective hash-cut fragments that looked like a second cloud.
          if(converted>=.999) discard;
        } else if(escapeNoise<dissolveThreshold) discard;
        float viewFacing=clamp(abs(dot(normalize(normal),normalize(vViewPosition))),0.0,1.0);
        float membraneFresnel=pow(1.0-viewFacing,2.65);
        float thinGlow=vOuterMembrane*(membraneFresnel*.76+pow(viewFacing,3.0)*.14);
        gl_FragColor.rgb+=vec3(.42,.49,.48)*membraneFresnel*.18;
        gl_FragColor.rgb+=vec3(.62,.72,.70)*thinGlow*.72;
        float dissolveEdge=(1.0-smoothstep(0.0,.035,abs(escapeNoise-dissolveThreshold)))*step(.03,dissolveThreshold);
        if(uHandResponse>.5) gl_FragColor.rgb*=1.0-converted;
        else gl_FragColor.rgb+=vec3(.33,.68,.70)*dissolveEdge*.72;
        #include <dithering_fragment>
      `);
    shaderRefs.push(shader);
  };
  material.customProgramCacheKey = () => "category4-local-fine-cloud-v4";
  return material;
}

export function SpecimenStage({ signal, exitRequested = false, onExitComplete, onExitError, onArchiveReveal, archiveReady = false, onModelState, entryRequested = false, archiveAngle = 0, archiveSession, onEntryReady, onEntryComplete, onEntryError }) {
  const hostRef = useRef(null);
  const signalRef = useRef(signal);
  const exitRequestedRef = useRef(exitRequested);
  const onExitCompleteRef = useRef(onExitComplete);
  const returnCallbacksRef = useRef({ onArchiveReveal, archiveReady, onExitError });
  const entryRequestedRef = useRef(entryRequested);
  const entryCallbacksRef = useRef({ onEntryReady, onEntryComplete, onEntryError });
  const [modelState, setModelState] = useState("正在读取标本模型");

  useEffect(() => { signalRef.current = signal; }, [signal]);
  useEffect(() => { exitRequestedRef.current = exitRequested; }, [exitRequested]);
  useEffect(() => { onExitCompleteRef.current = onExitComplete; }, [onExitComplete]);
  useEffect(() => { returnCallbacksRef.current = { onArchiveReveal, archiveReady, onExitError }; }, [onArchiveReveal, archiveReady, onExitError]);
  useEffect(() => { entryRequestedRef.current = entryRequested; }, [entryRequested]);
  useEffect(() => { entryCallbacksRef.current = { onEntryReady, onEntryComplete, onEntryError }; }, [onEntryReady, onEntryComplete, onEntryError]);
  useEffect(() => { onModelState?.(modelState); }, [modelState, onModelState]);

  useEffect(() => {
    const host = hostRef.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(BLENDER_CAMERA_FOV, 1, 0.01, 100);
    camera.position.copy(INITIAL_CAMERA_POSITION);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(1.7, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    host.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.56, 0.68, 0.79);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    // Bloom's composite writes opaque alpha even over empty black pixels.
    // Keep the same finishing/composite pass throughout entry and observation.
    // Disabling it changed the output path (and brightness) on the settled frame.
    // Transparent black also permits the terrain to appear behind return points.
    const specimenFinishPass = new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: "varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: "uniform sampler2D tDiffuse; varying vec2 vUv; void main(){vec3 c=texture2D(tDiffuse,vUv).rgb; gl_FragColor=vec4(c,clamp(max(c.r,max(c.g,c.b))*24.0,0.0,1.0));}",
    });
    composer.addPass(specimenFinishPass);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.enablePan = false;
    controls.enableRotate = false;
    controls.minDistance = 4.4;
    controls.maxDistance = 8.8;
    controls.target.copy(INITIAL_CAMERA_TARGET);

    const specimen = new THREE.Group();
    scene.add(specimen);
    const entryDefinition = ARCHIVE_ORGANISMS.find(({ id }) => id === "C04");
    const entryPlacement = archivePlacement(entryDefinition, archiveAngle);
    const entryStartPosition = new THREE.Vector3();
    const archiveCameraPosition = new THREE.Vector3(...ARCHIVE_CAMERA.position);
    const archiveCameraTarget = new THREE.Vector3(...ARCHIVE_CAMERA.target);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let entryScale = 1;
    let entryStartedAt = null;
    let entryReadyNotified = false;
    let entryCompleteNotified = !entryRequestedRef.current;
    let modelLoaded = false;
    // Render the archive's actual cloud after the physical-model composer:
    // same samples, seeds, erosion phase, color and point-size law; no Bloom.
    const entryCloudScene = new THREE.Scene();
    const entryCloudParent = new THREE.Group();
    entryCloudScene.add(entryCloudParent);
    let entryCloud = null;
    let entryCloudTime = 0;
    let entryCloudEmphasis = 1;
    const escapeSystem = createEscapeSystem();
    scene.add(escapeSystem.smoke, escapeSystem.trails, escapeSystem.points);
    const escapeSources = [];
    let targetPitch = 0;
    let targetYaw = 0;

    const resetCamera = () => {
      if (entryRequestedRef.current) return;
      camera.position.copy(INITIAL_CAMERA_POSITION);
      camera.up.set(0, 1, 0);
      controls.target.copy(INITIAL_CAMERA_TARGET);
      targetPitch = 0;
      targetYaw = 0;
      controls.update();
    };
    renderer.domElement.addEventListener("dblclick", resetCamera);
    resetCamera();

    RectAreaLightUniformsLib.init();
    scene.add(new THREE.HemisphereLight(0x718184, 0x000000, 0.075));

    const softKey = new THREE.RectAreaLight(0xe7ece7, 3.5, 4.8, 5.8);
    softKey.position.set(-3.3, 3.6, 4.5);
    softKey.lookAt(0, 0.15, 0);
    scene.add(softKey);

    const frontFill = new THREE.RectAreaLight(0x93bbc1, 0.75, 3.4, 4.6);
    frontFill.position.set(3.6, 0.15, 4.8);
    frontFill.lookAt(0, -0.2, 0);
    scene.add(frontFill);

    const crownRim = new THREE.RectAreaLight(0xf2f3ed, 8.2, 5.8, 4.3);
    crownRim.position.set(0.9, 4.8, -3.6);
    crownRim.lookAt(0, 0.35, 0);
    scene.add(crownRim);

    const sideRim = new THREE.DirectionalLight(0xc7dedd, 1.65);
    sideRim.position.set(-4.8, 1.7, -3.5);
    scene.add(sideRim);

    const lowerFill = new THREE.PointLight(0x3e929e, 0.72, 9.5, 2);
    lowerFill.position.set(-1.7, -2.2, 2.4);
    scene.add(lowerFill);

    let dragging = false;
    let pointerX = 0;
    let pointerY = 0;
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "grab";
    const onPointerDown = (event) => {
      if (event.button !== 0 || entryRequestedRef.current || exitRequestedRef.current) return;
      dragging = true;
      pointerX = event.clientX;
      pointerY = event.clientY;
      renderer.domElement.style.cursor = "grabbing";
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event) => {
      if (!dragging) return;
      const deltaX = event.clientX - pointerX;
      const deltaY = event.clientY - pointerY;
      pointerX = event.clientX;
      pointerY = event.clientY;
      targetYaw += deltaX * 0.006;
      targetPitch = THREE.MathUtils.clamp(targetPitch + deltaY * 0.0045, -0.48, 0.48);
    };
    const stopDragging = (event) => {
      dragging = false;
      renderer.domElement.style.cursor = "grab";
      if (event.pointerId !== undefined && renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", stopDragging);
    renderer.domElement.addEventListener("pointercancel", stopDragging);
    const shaderRefs = [];
    const pointMaterials = [];
    const geometries = [];
    const materials = [];
    let disposed = false;
    const sourceBase = new THREE.Vector3();
    let returnField = null;
    let returnLoadFailed = false;
    let returnStarted = false;
    let returnRevealNotified = false;
    let archiveReadyElapsed = 0;
    let returnCloudTime = archiveSession?.current.cloudTime ?? 0;
    const returnCameraPosition = new THREE.Vector3();
    const returnCameraTarget = new THREE.Vector3();
    const returnCameraUp = new THREE.Vector3();
    let returnCameraFov = BLENDER_CAMERA_FOV;
    preloadArchiveReturn().then(data => {
      if (disposed) return;
      returnField = createArchiveReturn(data, archiveAngle, Math.min(1.5, window.devicePixelRatio || 1));
      // Warm the small point shader before the user leaves observation.
      renderer.compile(returnField.scene, camera);
    }).catch(error => {
      if (!disposed) { returnLoadFailed = true; console.error("Return cloud unavailable", error); }
    });

    preloadSpecimenModel().then((cachedModel) => {
      if (disposed) return;
      const model = cachedModel.clone(true);
      model.traverse((object) => {
        if (!object.isMesh) return;
        if (!object.geometry.getAttribute("normal")) object.geometry.computeVertexNormals();
        object.geometry.computeBoundingBox();
        const bounds = object.geometry.boundingBox;
        if (!bounds) return;
        object.material = responsiveMaterial(object.material, shaderRefs, bounds);
        const compileMaterial = object.material.onBeforeCompile;
        object.material.onBeforeCompile = (shader, currentRenderer) => {
          compileMaterial(shader, currentRenderer);
          shader.uniforms.uEntrySurface.value = entryRequestedRef.current ? 0 : 1;
        };
        materials.push(object.material);
        const geometry = sampledPointGeometry(object.geometry, bounds);
        const material = createResponsePoints(bounds);
        material.uniforms.uEntry.value = entryRequestedRef.current ? 0 : 1;
        const points = new THREE.Points(geometry, material);
        points.renderOrder = 4;
        object.add(points);
        geometries.push(geometry);
        pointMaterials.push(material);
        materials.push(material);

        const sourcePositions = object.geometry.getAttribute("position");
        const height = Math.max(0.0001, bounds.max.y - bounds.min.y);
        const width = Math.max(0.0001, bounds.max.x - bounds.min.x);
        const centerX = bounds.min.x + width * 0.39;
        const centerY = bounds.min.y + height * 0.73;
        const candidates = [];
        for (let index = 0; index < sourcePositions.count; index += 2) {
          const x = sourcePositions.getX(index);
          const y = sourcePositions.getY(index);
          const z = sourcePositions.getZ(index);
          const normalizedY = (y - bounds.min.y) / height;
          const ringX = (x - centerX) / width;
          const ringY = (y - centerY) / height;
          const radius = Math.hypot(ringX, ringY);
          const upperRegion = smoothstep(0.46, 0.64, normalizedY);
          const outerBand = smoothstep(0.15, 0.25, radius) * (1 - smoothstep(0.6, 0.76, radius)) * upperRegion;
          const detail = c04PhaseDetail((x - bounds.min.x) / width, normalizedY, (z - bounds.min.z) / height);
          const phase = clamp(0.06 + (1 - normalizedY) * 0.68 - outerBand * 0.15 + detail, 0, 0.78);
          candidates.push({ index, phase });
        }
        candidates.sort((a, b) => a.phase - b.phase);
        escapeSources.push({
          mesh: object,
          indices: candidates.map((candidate) => candidate.index),
          phases: candidates.map((candidate) => candidate.phase),
        });
      });
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      const scale = 3.02 / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(scale);
      model.rotation.set(0, 0, 0);
      specimen.add(model);
      // Normalize the entry endpoint around the actual final model transform.
      // Keep the approved observation camera/model untouched at focus=1.
      const finalBox = new THREE.Box3().setFromObject(model);
      const finalSize = finalBox.getSize(new THREE.Vector3());
      const finalCenter = finalBox.getCenter(new THREE.Vector3());
      sourceBase.set(finalCenter.x, finalBox.min.y, finalCenter.z);
      entryScale = entryDefinition.targetSize / Math.max(finalSize.x, finalSize.y, finalSize.z, 0.0001);
      const rotatedBase = new THREE.Vector3(finalCenter.x, finalBox.min.y, finalCenter.z)
        .multiplyScalar(entryScale)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), entryPlacement.yaw);
      entryStartPosition.set(...entryPlacement.position).sub(rotatedBase);
      if (entryRequestedRef.current) {
        const liveCloud = archiveSession?.current.entryCloud;
        if (!liveCloud) throw new Error("档案场点云尚未就绪");
        entryCloud = new THREE.Points(liveCloud.geometry.clone(), liveCloud.material.clone());
        entryCloud.frustumCulled = false;
        entryCloud.scale.setScalar(1 / entryScale);
        entryCloud.position.set(finalCenter.x, finalBox.min.y, finalCenter.z);
        entryCloud.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
        entryCloudTime = liveCloud.material.uniforms.uTime.value;
        entryCloudEmphasis = liveCloud.material.uniforms.uEmphasis.value;
        entryCloudParent.add(entryCloud);
      }
      modelLoaded = true;
      setModelState("标本模型已连接");
    }).catch((error) => {
      if (disposed) return;
      console.error("Category 4 model failed to load", error);
      setModelState("标本模型读取失败");
      if (entryRequestedRef.current) entryCallbacksRef.current.onEntryError?.();
    });

    const resize = () => {
      const rect = host.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      composer.setSize(Math.max(1, rect.width), Math.max(1, rect.height));
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const clock = new THREE.Clock();
    let performanceFrames = 0;
    let performanceWindowStart = performance.now();
    let performanceSamples = 0;
    let raf = 0;
    let smoothedRingSpeed = 0;
    let smoothedEscape = 0;
    let contourFade = 0;
    let handEscape = createHandEscapeState();
    let ringPhase = 0;
    let exitElapsed = 0;
    let exitCompleteNotified = false;
    const animate = () => {
      if (disposed || exitCompleteNotified) return;
      const dt = Math.min(0.05, clock.getDelta());
      const elapsed = clock.elapsedTime;
      const entering = entryRequestedRef.current && !entryCompleteNotified;
      if (exitRequestedRef.current && returnLoadFailed) {
        returnCallbacksRef.current.onExitError?.("返回点云读取失败，已保留观测画面。请刷新后重试。");
      }
      const returning = exitRequestedRef.current && Boolean(returnField) && modelLoaded;
      const current = entering ? INITIAL_SIGNAL : signalRef.current;
      controls.enabled = !entering && !exitRequestedRef.current;
      let entry = entryMotionAt(100);
      if (entering && modelLoaded) {
        if (entryStartedAt === null) {
          const liveCloud = archiveSession?.current.entryCloud;
          if (liveCloud) {
            entryCloudTime = liveCloud.material.uniforms.uTime.value;
            entryCloudEmphasis = liveCloud.material.uniforms.uEmphasis.value;
          }
        } else if (!reducedMotion) entryCloudTime += dt;
        entry = entryMotionAt(entryStartedAt === null ? 0 : (performance.now() - entryStartedAt) / 1000, reducedMotion);
        camera.position.lerpVectors(archiveCameraPosition, INITIAL_CAMERA_POSITION, entry.focus);
        controls.target.lerpVectors(archiveCameraTarget, INITIAL_CAMERA_TARGET, entry.focus);
        camera.fov = THREE.MathUtils.lerp(archiveFov(camera.aspect), BLENDER_CAMERA_FOV, entry.focus);
        camera.updateProjectionMatrix();
        specimen.position.copy(entryStartPosition).multiplyScalar(1 - entry.focus);
        specimen.scale.setScalar(THREE.MathUtils.lerp(entryScale, 1, entry.focus));
        specimen.rotation.set(0, entryPlacement.yaw * (1 - entry.focus), 0);
      }
      if (returning && !returnStarted) {
        returnStarted = true;
        dragging = false;
        specimen.updateMatrixWorld(true);
        returnField.sourceMatrix.copy(specimen.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(...sourceBase.toArray()));
        returnCameraPosition.copy(camera.position);
        returnCameraTarget.copy(controls.target);
        returnCameraUp.copy(camera.up);
        returnCameraFov = camera.fov;
        returnCloudTime = archiveSession?.current.cloudTime ?? 0;
      }
      if (returning) {
        exitElapsed += dt;
        if (!reducedMotion) returnCloudTime += dt;
        if (archiveSession) archiveSession.current.cloudTime = returnCloudTime;
      }
      const returnMotion = returnMotionAt(exitElapsed);
      const exitEscape = returning ? returnMotion.dissolve : 0;
      const requestedRingSpeed = clamp(current.circularSpeed ?? 0);
      if (!entering && !returning && !document.hidden) {
        handEscape = advanceHandEscape(handEscape, current.handCommand ?? "fist", dt, escapeSystem.activeCount, escapeSystem.pendingReturnPhase);
      }
      const requestedEscape = Math.max(handEscape.cloud, exitEscape);
      smoothedRingSpeed += (requestedRingSpeed - smoothedRingSpeed) * (1 - Math.pow(0.00035, dt));
      if (returning) smoothedEscape += (requestedEscape - smoothedEscape) * (1 - Math.pow(requestedEscape > smoothedEscape ? 0.00008 : 0.045, dt));
      else smoothedEscape = handEscape.cloud;
      const ringDirection = Math.abs(current.circularDirection ?? 1) < 0.05 ? 1 : Math.sign(current.circularDirection ?? 1);
      const escapeFlow = smoothedEscape * 0.4;
      ringPhase += ringDirection * (smoothedRingSpeed + escapeFlow) * dt * 2.35;
      contourFade = returning ? Math.max(handEscape.escape, returnMotion.contour) : handEscape.escape;
      shaderRefs.forEach((shader) => {
        shader.uniforms.uTime.value = elapsed;
        shader.uniforms.uRingPhase.value = ringPhase;
        shader.uniforms.uRingSpeed.value = smoothedRingSpeed;
        shader.uniforms.uEscape.value = smoothedEscape;
        shader.uniforms.uHandCloud.value = handEscape.cloud;
        shader.uniforms.uHandResponse.value = returning ? 0 : 1;
        shader.uniforms.uContourFade.value = contourFade;
        shader.uniforms.uEntrySurface.value = entry.surface;
      });
      pointMaterials.forEach((material) => {
        material.uniforms.uTime.value = elapsed;
        material.uniforms.uRingPhase.value = ringPhase;
        material.uniforms.uRingSpeed.value = smoothedRingSpeed;
        material.uniforms.uEscape.value = smoothedEscape;
        material.uniforms.uContourFade.value = contourFade;
        material.uniforms.uEntry.value = entry.progress;
        // The separate archive cloud carries the entire entry; don't replace
        // it with the denser surface-bound response cloud before observation.
        material.uniforms.uOpacity.value = entering ? 0 : returning ? 0 : 1;
      });
      const idlePulse = 0.5 + 0.5 * Math.sin(elapsed * 0.46);
      frontFill.intensity = 0.67 + idlePulse * 0.16;
      crownRim.intensity = 7.75 + idlePulse * 0.92;
      lowerFill.intensity = 0.66 + idlePulse * 0.12;
      const lightOrbit = elapsed * 0.24;
      frontFill.position.set(
        3.6 + Math.sin(lightOrbit) * 0.34,
        0.15 + Math.cos(lightOrbit * 0.83) * 0.2,
        4.8 + Math.cos(lightOrbit) * 0.16,
      );
      frontFill.lookAt(0, -0.2, 0);
      crownRim.position.set(
        0.9 + Math.sin(lightOrbit * 0.71 + 1.2) * 0.72,
        4.8 + Math.cos(lightOrbit * 0.58) * 0.18,
        -3.6 + Math.cos(lightOrbit * 0.71 + 1.2) * 0.42,
      );
      crownRim.lookAt(0, 0.35, 0);
      lowerFill.position.set(
        -1.7 + Math.cos(lightOrbit * 0.62 + 2.1) * 0.25,
        -2.2 + Math.sin(lightOrbit * 0.76 + 0.7) * 0.14,
        2.4 + Math.sin(lightOrbit * 0.62 + 2.1) * 0.22,
      );
      if (!entering && !exitRequestedRef.current) {
        specimen.rotation.x += (targetPitch - specimen.rotation.x) * 0.105;
        specimen.rotation.y += (targetYaw - specimen.rotation.y) * 0.105;
      }
      specimen.updateMatrixWorld(true);
      // Body-input smoke is independent of exit's approved trail-free,
      // persistent archive particles on this same canvas from start to finish.
      escapeSystem.smoke.visible = escapeSystem.trails.visible = escapeSystem.points.visible = !returning;
      if (!entering && !returning && !document.hidden) escapeSystem.update(dt, elapsed, handEscape.escape, 0, escapeSources, handEscape.escape, handEscape);
      host.dataset.escapeParticles = String(escapeSystem.activeCount);
      host.dataset.escapeAmount = smoothedEscape.toFixed(3);
      host.dataset.contourFade = contourFade.toFixed(3);
      host.dataset.handStage = handEscape.stage;
      host.dataset.handCommand = current.handCommand ?? "fist";
      host.dataset.recallDistance = escapeSystem.recallDistance.toFixed(4);
      host.dataset.recallingParticles = String(escapeSystem.recallingCount);
      host.dataset.circulatingParticles = String(escapeSystem.activeCount - escapeSystem.recallingCount);
      if (returning) {
        camera.position.lerpVectors(returnCameraPosition, archiveCameraPosition, returnMotion.camera);
        controls.target.lerpVectors(returnCameraTarget, archiveCameraTarget, returnMotion.camera);
        camera.up.copy(returnCameraUp).lerp(new THREE.Vector3(0, 1, 0), returnMotion.camera).normalize();
        camera.fov = THREE.MathUtils.lerp(returnCameraFov, archiveFov(camera.aspect), returnMotion.camera);
        camera.updateProjectionMatrix();
      }
      if (entering || returning) camera.lookAt(controls.target);
      else controls.update();
      if (returning && returnMotion.contour >= 1) renderer.clear();
      else composer.render();
      if (returning) {
        returnField.update(exitElapsed, returnCloudTime);
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(returnField.scene, camera);
        renderer.autoClear = true;
        host.dataset.returnElapsed = exitElapsed.toFixed(3);
        host.dataset.returnParticles = String(RETURN_PARTICLE_COUNT);
        host.dataset.returnTravel = returnMotion.travel.toFixed(4);
        if (returnMotion.terrain && !returnRevealNotified) {
          returnRevealNotified = true;
          returnCallbacksRef.current.onArchiveReveal?.();
        }
        if (returnCallbacksRef.current.archiveReady) archiveReadyElapsed += dt;
      }
      if (entering && entryCloud) {
        entryCloudParent.position.copy(specimen.position);
        entryCloudParent.quaternion.copy(specimen.quaternion);
        entryCloudParent.scale.copy(specimen.scale);
        entryCloud.material.uniforms.uTime.value = entryCloudTime;
        entryCloud.material.uniforms.uEmphasis.value = entryCloudEmphasis * entry.points;
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(entryCloudScene, camera);
        renderer.autoClear = true;
      }
      host.dataset.entryProgress = entry.progress.toFixed(4);
      if (entering && modelLoaded && !entryReadyNotified) {
        entryReadyNotified = true;
        // Shader compilation must not consume the approach's first seconds.
        entryStartedAt = performance.now();
        archiveSession?.current.entryCloud?.release();
        entryCallbacksRef.current.onEntryReady?.();
      }
      if (entering && entry.complete && modelLoaded && !entryCompleteNotified) {
        entryCompleteNotified = true;
        entryCallbacksRef.current.onEntryComplete?.();
      }
      if (returning && !exitCompleteNotified && returnMotion.complete && archiveReadyElapsed >= 1.85 && archiveSession?.current.revealReturnClouds) {
        // Native archive renders the identical samples at the identical clock
        // before this canvas unmounts. No fade-out, new seed or second C04 cloud.
        archiveSession.current.revealReturnClouds();
        exitCompleteNotified = true;
        onExitCompleteRef.current?.();
      }
      performanceFrames += 1;
      const performanceNow = performance.now();
      if (performanceNow - performanceWindowStart >= 1000) {
        window.__PROJECT4_DIAGNOSTICS__ = {
          ...(window.__PROJECT4_DIAGNOSTICS__ || {}),
          specimenFps: Math.round(performanceFrames * 1000 / (performanceNow - performanceWindowStart)),
          specimenRenderer: renderer.info.render,
        };
        performanceSamples += 1;
        if (performanceSamples === 4 && new URLSearchParams(window.location.search).get("debug") === "1") {
          console.info(`[P2 PERF] specimen ${window.__PROJECT4_DIAGNOSTICS__.specimenFps} fps · ${renderer.info.render.triangles} triangles · ${renderer.info.render.points} points`);
        }
        performanceFrames = 0;
        performanceWindowStart = performanceNow;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.domElement.removeEventListener("dblclick", resetCamera);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", stopDragging);
      renderer.domElement.removeEventListener("pointercancel", stopDragging);
      controls.dispose();
      scene.remove(escapeSystem.smoke, escapeSystem.trails, escapeSystem.points);
      escapeSystem.dispose();
      entryCloud?.geometry.dispose();
      entryCloud?.material.dispose();
      returnField?.dispose();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      composer.dispose();
      specimenFinishPass.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="specimen-stage" aria-label="类别四三维标本">
      <div ref={hostRef} className="specimen-webgl" />
    </div>
  );
}
