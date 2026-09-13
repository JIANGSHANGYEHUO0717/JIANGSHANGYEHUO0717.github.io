import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { ARCHIVE_ORGANISMS, preloadArchiveModels } from "./archiveAssets.js";
import { preloadObservationModel } from "./observationAssets.js";
import { archiveModelBounds } from "./archiveReference/orientation.js";
import { ARCHIVE_CAMERA, archiveFov, archivePlacement } from "./archiveReference/adapter.js";
import { createArchiveReturn, preloadArchiveReturn, returnMotionAt, RETURN_PARTICLE_COUNT } from "./archiveReturn.js";
import { entryMotionAt } from "./entryMotion.js";
import { createMirrorPass, createMirrorState, updateMirrorState, createMirrorLighting, mirrorFramingAt } from "./c01Mirror.js";
import { createC01ObservationLighting, C01_LIGHTING_RIGS } from "./c01ObservationLighting.js";
import { createC02ObservationLighting } from "./c02ObservationLighting.js";
import { createC02SurfaceRouting, preloadC02SurfaceRouting } from "./c02SurfaceRouting.js";
import { createCavityState, updateCavityState } from "./c01CavityState.js";
import { createCavityRenderer } from "./c01CavityRenderer.js";
import { createCavityAudio } from "./c01CavityAudio.js";
import { preloadC03MaterialMask } from "./c03Glass.js";
import { createC03BlenderStudio, c03BlenderGlassMaterial, c03BlenderCoreMaterial } from "./c03BlenderStudio.js";
import { createC03ThicknessCapture } from "./c03LayeredGlass.js";
import { createC03Dispersal, preloadC03DispersalShells } from "./c03Dispersal.js";
import { createC03OpticalPaths } from "./c03OpticalPaths.js";
import { createC03RefractionCapture } from "./c03RefractionCapture.js";
import { createC01InteractionArbitration, createC03InteractionArbitration, updateC01InteractionArbitration, updateC03InteractionArbitration } from "./interactionArbitration.js";
import { preloadC05MaterialMaps, createC05FoundationUniforms, c05HeterogeneousMaterial, createC05GreenhouseLighting } from "./c05Foundation.js";
import { createC05TomographyState, updateC05Tomography } from "./c05Tomography.js";

const EXTENT = 3.02;
const FOV = 40;
const OBSERVATION_POSITION = new THREE.Vector3(-1.1, -.4, 5.8);
const OBSERVATION_TARGET = new THREE.Vector3(0, 0, 0);
const observationFov = aspect => THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV/2))*Math.max(1, .95/aspect)));

// Keep the imported material, textures and silhouette. Only the common
// entry/return coverage is added here; species responses belong in separate work.
function applyObservationCoverage(material, uniforms, cacheKey = "organism-observation-coverage-v1") {
  const extendMaterial = material.onBeforeCompile;
  const c03LifeRole=cacheKey.includes("c03-blender-core")?"core":cacheKey.includes("c03-layered-glass")?"glass":null;
  const c05LifeRole=cacheKey.includes("c05-foundation");
  const c03LifeMotion=c03LifeRole==="core"?`
    float c03LifeY=clamp(position.y/3.02,0.0,1.0);
    float c03CoreBreath=sin(uC03LifeTime*.72+position.x*1.8+position.z*1.4)*.0055*uC03CoreMotion;
    transformed+=normal*c03CoreBreath;
    transformed.x+=sin(uC03LifeTime*.39+position.y*1.7)*c03LifeY*.0035*uC03CoreMotion;
  `:c03LifeRole==="glass"?`
    float c03LifeY=clamp(position.y/3.02,0.0,1.0);
    float c03Tip=smoothstep(.54,.94,c03LifeY)*smoothstep(.22,.82,length(position.xz));
    transformed.x+=sin(uC03LifeTime*.34+position.y*1.5+position.z*.8)*c03Tip*.0105*uC03TipMotion;
    transformed.z+=cos(uC03LifeTime*.29+position.y*1.25-position.x*.7)*c03Tip*.0075*uC03TipMotion;
    transformed+=normal*sin(uC03LifeTime*.46+position.y*2.1)*c03Tip*.0035*uC03TipMotion;
  `:c05LifeRole?`
    vec4 c05Tissue=texture2D(uC05MaterialMask,uv);
    float c05BaseWave=sin(uC05Time*.19+position.y*1.15+position.z*.54)*.0048*c05Tissue.r;
    float c05BoneWave=sin(uC05Time*.48+position.x*2.7-position.y*.8)*.0032*c05Tissue.g;
    float c05VelvetWave=sin(uC05Time*.12+position.y*.72+position.x*.65)*.0038*c05Tissue.b;
    float c05ColonyWave=sin(uC05Time*.83+position.x*5.4+position.z*4.1)*.0018*c05Tissue.a;
    float c05LifeWave=(c05BaseWave+c05BoneWave+c05VelvetWave+c05ColonyWave)*uC05Motion;
    transformed+=normal*c05LifeWave;
    transformed.x+=sin(uC05Time*.14+position.y*.86)*c05Tissue.r*.0028*uC05Motion;
    transformed.z+=cos(uC05Time*.31+position.x*1.7)*c05Tissue.g*.0018*uC05Motion;
  `:"";
  material.onBeforeCompile = shader => {
    extendMaterial?.(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vObservationPosition;\nuniform float uC03LifeTime;\nuniform float uC03CoreMotion;\nuniform float uC03TipMotion;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${c03LifeMotion}\nvObservationPosition = transformed;`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
      varying vec3 vObservationPosition;
      uniform float uEntrySurface;
      uniform float uDissolve;
      uniform float uC02NodeGlow;
      uniform vec3 uC03DispersalCenters[8];
      uniform float uC03DispersalAmount[8];
      float observationGrain(vec3 p) { return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453); }
    `).replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
      float grain = observationGrain(floor(vObservationPosition*260.0));
      for(int c03i=0;c03i<8;c03i++){
        float c03Open=smoothstep(.18,.92,uC03DispersalAmount[c03i]);
        float c03Distance=distance(vObservationPosition,uC03DispersalCenters[c03i]);
        float c03Radius[8]=float[8](.23,.25,.29,.38,.24,.31,.26,0.0);
        if(c03Distance<c03Open*c03Radius[c03i] && grain<smoothstep(.1,1.,uC03DispersalAmount[c03i])) discard;
      }
      float entryPattern = .5 + sin(vObservationPosition.y*19.0+vObservationPosition.x*13.0)*.19
        + sin(vObservationPosition.z*23.0-vObservationPosition.y*11.0)*.16;
      if(uEntrySurface < .02+entryPattern*.57+grain*.27) discard;
      float phase = clamp(.025+(1.0-vObservationPosition.y/3.02)*.68,0.0,.76);
      float departing = smoothstep(phase,phase+.17,uDissolve);
      if(grain < departing) discard;
    `);
  };
  material.customProgramCacheKey = () => cacheKey;
  return material;
}

function observationMaterial(source, uniforms) {
  return applyObservationCoverage(source.clone(), uniforms);
}

let c02MaterialMapsPromise = null;
function preloadC02MaterialMaps() {
  if (c02MaterialMapsPromise) return c02MaterialMapsPromise;
  const loader = new THREE.TextureLoader();
  c02MaterialMapsPromise = Promise.all([
    loader.loadAsync("/assets/observation/category-2-pearl-basecolor.png"),
    loader.loadAsync("/assets/observation/category-2-material-mask.png"),
  ]).then(([baseColor, mask]) => {
    baseColor.colorSpace = THREE.SRGBColorSpace;
    mask.colorSpace = THREE.NoColorSpace;
    for (const texture of [baseColor, mask]) {
      texture.flipY = false;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.needsUpdate = true;
    }
    return { baseColor, mask };
  });
  return c02MaterialMapsPromise;
}

function c02BiofilmMaterial(source, uniforms, c02Uniforms, maps) {
  const material = new THREE.MeshPhysicalMaterial({
    name: `${source.name || "C02"}-biofilm`,
    color: 0xffffff,
    map: maps.baseColor,
    normalMap: source.normalMap ?? null,
    metalness: 0,
    roughness: .82,
    transmission: 0,
    ior: 1.33,
    specularIntensity: .025,
    clearcoat: 0,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  if (material.normalMap) material.normalScale.set(.16, .16);
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, c02Uniforms);
    shader.uniforms.uC02MaterialMask = { value: maps.mask };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform sampler2D uC02MaterialMask;
        uniform float uC02Transparency;
        uniform float uC02Backscatter;
        uniform float uC02FlowEnergy;
        uniform float uC02FlowProgress;
        uniform float uC02FlowTime;
        uniform float uC02FlowBias;
      `)
      .replace("#include <map_fragment>", `#include <map_fragment>
        vec4 c02MaskSample=texture2D(uC02MaterialMask,vMapUv);
        float c02TransmissionMask=c02MaskSample.r;
        float c02NodeMask=c02MaskSample.g;
        float c02RootMask=c02MaskSample.b;
        diffuseColor.a*=1.0-c02TransmissionMask*uC02Transparency;
        float c02StillVisibility=.048+c02NodeMask*.018+c02RootMask*.028;
        // The confirmed biofilm is the base observation state. It yields to
        // the dark point-field treatment only while routing is actually live.
        float c02InteractionMix=smoothstep(.015,.18,uC02FlowEnergy);
        float c02Visibility=mix(1.0,c02StillVisibility,c02InteractionMix);
        diffuseColor.rgb*=mix(1.0,mix(.075,.82,c02StillVisibility),c02InteractionMix);
        diffuseColor.a*=c02Visibility;
      `)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
      float c02Warm=max(diffuseColor.r-max(diffuseColor.g,diffuseColor.b)*.96,0.0);
      float c02Pink=max(c02NodeMask,smoothstep(.025,.20,c02Warm)*smoothstep(.10,.38,diffuseColor.r));
      totalEmissiveRadiance+=vec3(1.0,.46,.40)*c02Pink*uC02NodeGlow*.018;
      float c02ViewFacing=abs(dot(normalize(normal),normalize(vViewPosition)));
      vec3 c02N=normalize(normal);
      float c02KeyFacing=clamp(dot(c02N,normalize(vec3(-.48,.56,.68)))*.5+.5,0.0,1.0);
      float c02RearFacing=clamp(dot(c02N,normalize(vec3(.28,.32,-.90)))*.5+.5,0.0,1.0);
      float c02Webbing=smoothstep(.84,.94,c02TransmissionMask)*(1.0-c02NodeMask)*(1.0-c02RootMask);
      float c02SoftBack=(.045+c02KeyFacing*.22+c02RearFacing*.10+pow(1.0-c02ViewFacing,1.7)*.12)*c02TransmissionMask*uC02Backscatter*(1.0-c02Webbing*.82);
      totalEmissiveRadiance+=diffuseColor.rgb*c02SoftBack*c02Visibility;
      float c02Outer=smoothstep(.34,.86,length(vObservationPosition.xz));
      float c02StructuralRim=pow(1.0-c02ViewFacing,2.35)*c02Outer*(1.0-c02Webbing)*(1.0-c02RootMask);
      totalEmissiveRadiance+=vec3(.78,.91,.96)*c02StructuralRim*.16*c02Visibility;
    `);
  };
  material.userData.c02Uniforms = c02Uniforms;
  return applyObservationCoverage(material, uniforms, "c02-pearl-coral-node-tissue-040-066-v1");
}

export function OrganismStage({ organism, entryRequested = false, exitRequested = false,
  mirrorControl = null, mirrorPoints = null, c02Control = null, c03Points = null, c03Control = null, c05Control = null, lightingPreset = "amber", c02LightingPreset = "membrane", c03LightingPreset = "abyss", c03LightTuning = null, interaction = "mirror", cavityControl = null,
  archiveAngle = 0, archiveSession, archiveReady = false, onModelState,
  onEntryReady, onEntryComplete, onEntryError, onArchiveReveal, onExitComplete, onExitError }) {
  const hostRef = useRef(null);
  const stateRef = useRef(null);
  stateRef.current = { entryRequested, exitRequested, archiveReady, onModelState, mirrorControl, mirrorPoints, c02Control, c03Points, c03Control, c05Control, lightingPreset, c02LightingPreset, c03LightingPreset, c03LightTuning, interaction, cavityControl,
    onEntryReady, onEntryComplete, onEntryError, onArchiveReveal, onExitComplete, onExitError };

  useEffect(() => {
    const host = hostRef.current;
    const definition = ARCHIVE_ORGANISMS.find(item => item.id === organism.id);
    const index = ARCHIVE_ORGANISMS.indexOf(definition);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true,
      premultipliedAlpha: organism.id !== "C03", powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(1.7, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const specimen = new THREE.Group();
    scene.add(specimen);
    const camera = new THREE.PerspectiveCamera(FOV, 1, .01, 100);
    camera.position.copy(OBSERVATION_POSITION);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(OBSERVATION_TARGET);
    controls.enableDamping = true;
    controls.dampingFactor = .055;
    controls.enablePan = false;
    controls.enableRotate = false;
    controls.minDistance = 4.4;
    controls.maxDistance = 8.8;
    controls.update();

    const isMirror = organism.id === "C01";
    const isC02 = organism.id === "C02";
    const isC03 = organism.id === "C03";
    const isC05 = organism.id === "C05";
    const c03Studio = isC03 ? createC03BlenderStudio(renderer, scene) : null;
    const observationPosition = c03Studio?.cameraPosition ?? OBSERVATION_POSITION;
    const observationTarget = c03Studio?.cameraTarget ?? OBSERVATION_TARGET;
    const currentObservationFov = aspect => c03Studio
      ? THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(c03Studio.fov/2))*Math.max(1,.92/aspect)))
      : observationFov(aspect);
    if (c03Studio) {
      camera.layers.enable(1);
      camera.layers.enable(2);
      camera.position.copy(observationPosition);
      controls.target.copy(observationTarget);
      controls.minDistance = 4.2;
      controls.maxDistance = 10.5;
      controls.update();
      host.dataset.c03Environment = "blender-white-world-four-area-lights";
      host.dataset.c03Background = "camera-black-environment-lit";
      host.dataset.c03Output = "AgX-and-sRGB";
    }
    const mirror = isMirror ? createMirrorState() : null;
    const mirrorPass = isMirror ? createMirrorPass() : null;
    const mirrorLighting = isMirror ? createMirrorLighting(C01_LIGHTING_RIGS.amber) : null;
    const cavity = isMirror ? createCavityState() : null;
    const cavityRenderer = isMirror ? createCavityRenderer() : null;
    const cavityAudio = isMirror ? createCavityAudio() : null;
    if (cavityRenderer) specimen.add(cavityRenderer.core);
    const onCavityAudioToggle=event=>cavityAudio?.setEnabled(Boolean(event.detail?.enabled));
    window.addEventListener("c01-cavity-audio-toggle",onCavityAudioToggle);
    const mirrorFraming = {};
    const sourceCamera = isMirror ? camera.clone() : camera;
    const sourceTarget = new THREE.Vector3();
    const uniforms = { uEntrySurface: { value: entryRequested ? 0 : 1 }, uDissolve: { value: 0 },
      uC03LifeTime:{value:0},uC03CoreMotion:{value:1.2},uC03TipMotion:{value:3},
      uC03DispersalCenters:{value:Array.from({length:8},()=>new THREE.Vector3(99,99,99))},
      uC03DispersalAmount:{value:Array.from({length:8},()=>0)} };
    const c02Uniforms = {
      uC02NodeGlow: { value: .56 },
      // Blender's 0.40 Transparent-BSDF mix cannot be copied 1:1 to a
      // single alpha-blended WebGL surface over black. Compress the alpha
      // loss while keeping the approved source parameter in the asset notes.
      uC02Transparency: { value: .24 },
      uC02Backscatter: { value: .66 },
      uC02FlowEnergy: { value: 0 },
      uC02FlowProgress: { value: 0 },
      uC02FlowTime: { value: 0 },
      uC02FlowBias: { value: 0 },
    };
    const c05Uniforms = createC05FoundationUniforms();
    const c05Tomography = isC05 ? createC05TomographyState() : null;
    const composer = new EffectComposer(renderer);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), isC03 ? .12 : isC02 ? .28 : isC05 ? .22 : .56, isC02 ? .74 : isC05 ? .58 : .68, isC03 ? .88 : isC02 ? .91 : isC05 ? .93 : .79);
    const finish = new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: "varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: "uniform sampler2D tDiffuse; varying vec2 vUv; void main(){vec3 c=texture2D(tDiffuse,vUv).rgb; gl_FragColor=vec4(c,clamp(max(c.r,max(c.g,c.b))*24.0,0.0,1.0));}",
    });
    composer.addPass(new RenderPass(scene, sourceCamera));
    if (cavityRenderer) composer.addPass(cavityRenderer.pass);
    if (mirrorPass) { mirrorPass.enabled = false; composer.addPass(mirrorPass); }
    const c03Output = isC03 ? new OutputPass() : null;
    // Two swapping passes keep the scene render in this same target each frame.
    // Its depth separates camera background without another model/matte render.
    if (isC03) composer.readBuffer.depthTexture = new THREE.DepthTexture(1,1);
    const c03Fade = isC03 ? new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uOpacity: { value: 1 }, uDepth: {value:null}, uBackdrop: {value:c03Studio.compositeBackground}, uTexel:{value:new THREE.Vector2(1,1)}, uGlowStrength:{value:.32} },
      vertexShader: "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: `uniform sampler2D tDiffuse;uniform sampler2D uDepth;uniform vec3 uBackdrop;uniform float uOpacity;uniform vec2 uTexel;uniform float uGlowStrength;varying vec2 vUv;
        float warmMask(vec3 c){float warmth=max(c.r-c.b*.985,0.0);float lum=dot(c,vec3(.2126,.7152,.0722));return smoothstep(.018,.13,warmth)*smoothstep(.46,1.02,lum);}
        void main(){vec4 c=texture2D(tDiffuse,vUv);vec3 result=c.rgb;vec3 halo=vec3(0.0);float total=0.0;
          for(int y=-2;y<=2;y++){for(int x=-2;x<=2;x++){float ax=abs(float(x));float ay=abs(float(y));float wx=ax<.5?6.0:(ax<1.5?4.0:1.0);float wy=ay<.5?6.0:(ay<1.5?4.0:1.0);float weight=wx*wy;vec2 offset=vec2(float(x),float(y))*uTexel*3.8;vec3 sampleColor=texture2D(tDiffuse,vUv+offset).rgb;halo+=sampleColor*warmMask(sampleColor)*weight;total+=weight;}}
          result+=(halo/total)*vec3(1.0,.76,.48)*uGlowStrength;gl_FragColor=vec4(result,c.a*uOpacity);}`,
    }) : null;
    if (isC03) {
      // ShaderPass clones input uniforms; bind the live attachment, not its clone.
      c03Fade.uniforms.uDepth.value = composer.readBuffer.depthTexture;
      composer.addPass(c03Fade); composer.addPass(c03Output);
    }
    else { composer.addPass(bloom); composer.addPass(finish); }
    RectAreaLightUniformsLib.init();
    // Match the approved C04 rig without changing its renderer or materials.
    const ambient = new THREE.HemisphereLight(isC03 ? 0xffffff : 0x718184, isC03 ? 0xc8d4d6 : 0x000000, isC03 ? .07 : .075);
    scene.add(ambient);
    const addArea = (color, intensity, width, height, position, targetY) => {
      const light = new THREE.RectAreaLight(color, intensity, width, height);
      light.position.set(...position); light.lookAt(0, targetY, 0); scene.add(light); return light;
    };
    const key = addArea(isC03 ? 0xf4fbff : 0xe7ece7, isC03 ? 1.8 : 3.5, isC03 ? 5.7 : 4.8, isC03 ? 5.7 : 5.8, isC03 ? [-3.35, 3.75, 4.5] : [-3.3, 3.6, 4.5], .15);
    const front = addArea(isC03 ? 0xe6f8ff : 0x93bbc1, isC03 ? 1.1 : .75, isC03 ? 5.2 : 3.4, isC03 ? 5.2 : 4.6, isC03 ? [3.55, 1.55, 4.65] : [3.6, .15, 4.8], -.1);
    const rim = addArea(isC03 ? 0xa9efff : 0xf2f3ed, isC03 ? 2.55 : 8.2, isC03 ? 4.8 : 5.8, isC03 ? 4.8 : 4.3, isC03 ? [.4, 4.65, -3.7] : [.9, 4.8, -3.6], .35);
    const side = new THREE.DirectionalLight(isC03 ? 0xffffff : 0xc7dedd, isC03 ? 0 : 1.65);
    side.position.set(-4.8, 1.7, -3.5); scene.add(side);
    const low = new THREE.PointLight(isC03 ? 0xffffff : 0x3e929e, isC03 ? 0 : .72, 9.5, 2);
    low.position.set(-1.7, -2.2, 2.4); scene.add(low);
    if (isC03) for (const light of [ambient,key,front,rim,side,low]) light.visible = false;
    const lightingStudy = isMirror ? createC01ObservationLighting({ambient,key,front,rim,side,low}) : null;
    const c02Lighting = isC02 ? createC02ObservationLighting({ambient,key,front,rim,side,low}) : null;
    const c05Lighting = isC05 ? createC05GreenhouseLighting({scene,ambient,key,front,rim,side,low}) : null;

    const geometries = [], materials = [];
    const base = new THREE.Vector3();
    const entryPosition = new THREE.Vector3();
    const entryScale = definition.targetSize / EXTENT;
    const entryScene = new THREE.Scene(), entryParent = new THREE.Group();
    entryScene.add(entryParent);
    let entryCloud, entryPlacement, entryStart = null, entryDone = !entryRequested;
    let entryTime = 0, entryEmphasis = 1, loaded = false, modelFailed = false;
    let returnField = null, returnFailed = false, returnStarted = false, returnElapsed = 0;
    let c02Flow = null, c03GlassCapture = null, c03Dispersal = null, c03DispersalRoot = null, c03Optics = null, c03Capture = null;
    let c03OpticsMix = 0, c03AutoYaw=0;
    const c01Arbitration=createC01InteractionArbitration(),c03Arbitration=createC03InteractionArbitration();
    const c03CoreMaterials = [];
    const c03CoreTintHsl={h:0,s:0,l:0}, c03CoreEmissionHsl={h:0,s:0,l:0};
    const c03OpticsCoreColor=new THREE.Color(0xf4f5f2), c03OpticsCoreEmission=new THREE.Color(0xffffff);
    new THREE.Color().setRGB(.938,.8636,.721).getHSL(c03CoreTintHsl);
    new THREE.Color(0xffedcf).getHSL(c03CoreEmissionHsl);
    let revealed = false, readyElapsed = 0, complete = false;
    let returnTime = archiveSession.current.cloudTime ?? 0;
    const returnCamera = new THREE.Vector3(), returnTarget = new THREE.Vector3();
    let returnFov = FOV;
    const archiveCamera = new THREE.Vector3(...ARCHIVE_CAMERA.position);
    const archiveTarget = new THREE.Vector3(...ARCHIVE_CAMERA.target);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let disposed = false, raf;
    stateRef.current.onModelState?.("正在读取标本模型");

    preloadArchiveReturn(organism.id).then(data => {
      if (disposed) return;
      returnField = createArchiveReturn(data, archiveAngle, renderer.getPixelRatio(), definition.tint);
      renderer.compile(returnField.scene, camera);
    }).catch(error => { if (!disposed) { returnFailed = true; console.error("Return cloud unavailable", error); } });

    Promise.all([preloadArchiveModels(), preloadObservationModel(organism.id), isC02 ? preloadC02MaterialMaps() : Promise.resolve(null), isC02 ? preloadC02SurfaceRouting() : Promise.resolve(null), isC03 ? preloadC03MaterialMask() : Promise.resolve(null), isC03 ? preloadC03DispersalShells() : Promise.resolve(null), isC05 ? preloadC05MaterialMaps() : Promise.resolve(null)]).then(([models, cached, c02Maps, c02Routing, c03Mask, c03Shells, c05Maps]) => {
      if (disposed) return;
      cached.updateMatrixWorld(true);
      const bounds = archiveModelBounds(cached);
      const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
      const scale = EXTENT / Math.max(size.x, size.y, size.z, .0001);
      const normalize = new THREE.Matrix4().makeScale(scale, scale, scale);
      normalize.setPosition(-center.x*scale, -bounds.min.y*scale, -center.z*scale);
      base.set(0, -size.y*scale/2, 0);
      const model = new THREE.Group();
      if (isC03) c03GlassCapture = createC03ThicknessCapture(renderer,c03Mask);
      model.position.copy(base);
      cached.traverse(object => {
        if (!object.isMesh) return;
        const geometry = object.geometry.clone();
        geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(normalize, object.matrixWorld));
        if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
        geometries.push(geometry);
        const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
        if (isC03) {
          const source = sourceMaterials[0];
          const coreMaterial = applyObservationCoverage(c03BlenderCoreMaterial(source, c03Mask), uniforms, "c03-blender-core-coverage-v1");
          const glassMaterial = applyObservationCoverage(c03BlenderGlassMaterial(source, c03Mask, c03GlassCapture), uniforms, "c03-layered-glass-coverage-v1");
          materials.push(coreMaterial, glassMaterial);
          c03CoreMaterials.push(coreMaterial);
          const coreMesh = new THREE.Mesh(geometry, coreMaterial);
          const glassMesh = new THREE.Mesh(geometry, glassMaterial);
          coreMesh.layers.set(2);
          glassMesh.layers.set(1);
          glassMesh.renderOrder = 1;
          model.add(coreMesh, glassMesh);
          c03GlassCapture.register(glassMesh);
          if (!c03Dispersal) {
            c03Dispersal=createC03Dispersal(geometry,c03Mask,c03Shells?.scene,normalize); c03DispersalRoot=model; model.add(c03Dispersal.group);
            c03Optics=createC03OpticalPaths(c03Dispersal.state.centers);model.add(c03Optics.group);
            c03Capture=createC03RefractionCapture(c03Dispersal.state.centers);model.add(c03Capture.group);
            c03Dispersal.state.centers.forEach((center,index)=>uniforms.uC03DispersalCenters.value[index].copy(center));
          }
        } else {
          const localMaterials = sourceMaterials.map(source => isC02
            ? c02BiofilmMaterial(source, uniforms, c02Uniforms, c02Maps)
            : isC05
              ? c05HeterogeneousMaterial(source, uniforms, c05Uniforms, c05Maps, applyObservationCoverage)
              : observationMaterial(source, uniforms));
          materials.push(...localMaterials);
          model.add(new THREE.Mesh(geometry, Array.isArray(object.material) ? localMaterials : localMaterials[0]));
        }
      });
      specimen.add(model);
      if (isC02) {
        c02Flow = createC02SurfaceRouting({ data: c02Routing, modelOffset: base,
          pixelRatio: renderer.getPixelRatio(), reducedMotion });
        // Surface points are baked from the exact authored mesh and normalized
        // into this same grounded observation space.
        specimen.add(c02Flow.group);
      }
      // The same grounded archive placement and orientation are used by the
      // selected live cloud, the material reconstruction and the return target.
      // Ground the entry cloud using the archive's exact LOD footprint. The
      // close-up and return sources share the full-resolution normalization.
      entryPlacement = archivePlacement(definition, archiveAngle, models[index]);
      entryPosition.set(...entryPlacement.position).sub(base.clone().multiplyScalar(entryScale)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), entryPlacement.yaw));
      if (entryRequested) {
        const live = archiveSession.current.entryClouds?.[organism.id];
        if (!live) throw new Error("所选生命体点云尚未就绪");
        entryCloud = new THREE.Points(live.geometry.clone(), live.material.clone());
        entryCloud.frustumCulled = false;
        entryCloud.scale.setScalar(1 / entryScale);
        entryCloud.position.copy(base);
        entryCloud.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
        entryTime = live.material.uniforms.uTime.value;
        entryEmphasis = live.material.uniforms.uEmphasis.value;
        entryParent.add(entryCloud);
      }
      loaded = true;
      host.dataset.model = organism.id;
      host.dataset.modelQuality = "original";
      if (isC03) host.dataset.c03Material = "masked-glass-and-ivory-core";
      if (isC05) host.dataset.c05Material = "four-tissue-heterogeneous-foundation";
      host.dataset.modelTriangles = String(geometries.reduce((sum, geometry) => sum + (geometry.index?.count ?? geometry.getAttribute("position").count) / 3, 0));
      stateRef.current.onModelState?.("标本模型已连接");
    }).catch(error => {
      if (disposed) return;
      modelFailed = true;
      console.error("Organism model unavailable", error);
      stateRef.current.onModelState?.("标本模型读取失败");
      if (entryRequested) stateRef.current.onEntryError?.();
    });

    // Entry resolves to the shared neutral observation pose. C05 retains its
    // small authored presentation offset; C02 no longer turns again after it
    // has visibly settled at the end of the archive transition.
    const observationFrontYaw = isC05 ? -.16 : 0;
    let yaw = observationFrontYaw, pitch = 0, dragging = false, px = 0, py = 0;
    const locked = () => stateRef.current.entryRequested || stateRef.current.exitRequested;
    const reset = () => {
      if (locked()) return;
      yaw = observationFrontYaw; pitch = 0; camera.position.copy(observationPosition);
      controls.target.copy(observationTarget); controls.update();
    };
    const down = event => {
      if (event.button !== 0 || locked()) return;
      dragging = true; px = event.clientX; py = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const move = event => {
      if (!dragging || locked()) return;
      yaw += (event.clientX-px)*.006;
      pitch = THREE.MathUtils.clamp(pitch+(event.clientY-py)*.0045, -.48, .48);
      px = event.clientX; py = event.clientY;
    };
    const up = event => {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    };
    renderer.domElement.style.touchAction = "none";
    for (const [name, handler] of [["dblclick", reset], ["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", up]]) renderer.domElement.addEventListener(name, handler);
    const resize = () => {
      const rect = host.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      composer.setSize(Math.max(1, rect.width), Math.max(1, rect.height));
      if (c03Fade) c03Fade.uniforms.uTexel.value.set(1/Math.max(1,rect.width),1/Math.max(1,rect.height));
      camera.aspect = rect.width / Math.max(1, rect.height);
      if (!stateRef.current.entryRequested && !stateRef.current.exitRequested) camera.fov = currentObservationFov(camera.aspect);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    const clock = new THREE.Clock();
    const animate = () => {
      if (disposed || complete) return;
      const frameDelta = clock.getDelta(), dt = Math.min(.05, frameDelta), elapsed = clock.elapsedTime;
      const callbacks = stateRef.current;
      const c01Ownership=updateC01InteractionArbitration(c01Arbitration,{
        dt,pinchStage:callbacks.cavityControl?.pinch?.stage,
        cavityReleaseActive:Boolean(cavity&&cavity.releaseAge>=0),
      });
      const c03Ownership=updateC03InteractionArbitration(c03Arbitration,{
        dt,rightHandStage:callbacks.c03Control?.rightHand?.stage,
        captureReleaseActive:Boolean(c03Capture&&c03Capture.state.releaseAge<.72),
        captureDemo:callbacks.c03Control?.captureDemo??0,
      });
      const c03OpticalInteraction=c03Ownership.captureActive;
      c03OpticsMix=THREE.MathUtils.damp(c03OpticsMix,c03OpticalInteraction?1:0,2.4,dt);
      uniforms.uC03LifeTime.value=elapsed;
      uniforms.uC03CoreMotion.value=callbacks.c03Control?.coreMotion??1.2;
      uniforms.uC03TipMotion.value=callbacks.c03Control?.tipMotion??3;
      if (c03Studio) {
        const opticsBlackout=c03OpticalInteraction||Boolean(callbacks.c03Control?.opticsBlackout);
        const lighting=c03Studio.updateLighting(callbacks.c03LightingPreset,dt,callbacks.c03LightTuning,c03OpticsMix,opticsBlackout);
        const coreEmissive=callbacks.c03LightingPreset==='abyss' ? (callbacks.c03LightTuning?.coreEmissive ?? 1) : 1;
        const coreWarm=callbacks.c03LightingPreset==='abyss' ? (callbacks.c03LightTuning?.coreWarm ?? 1) : 1;
        c03CoreMaterials.forEach(material=>{
          material.color.setHSL(c03CoreTintHsl.h,THREE.MathUtils.clamp(c03CoreTintHsl.s*coreWarm,0,1),c03CoreTintHsl.l);
          material.emissive.setHSL(c03CoreEmissionHsl.h,THREE.MathUtils.clamp(c03CoreEmissionHsl.s*coreWarm,0,1),c03CoreEmissionHsl.l);
          material.color.lerp(c03OpticsCoreColor,c03OpticsMix);
          material.emissive.lerp(c03OpticsCoreEmission,c03OpticsMix);
          material.emissiveIntensity=.028*coreEmissive*(1-c03OpticsMix);
          if (material.userData.c03CoreUniforms) {
            material.userData.c03CoreUniforms.warmth.value=coreWarm*(1-c03OpticsMix);
            material.userData.c03CoreUniforms.glow.value=coreEmissive*(1-c03OpticsMix);
            material.userData.c03CoreUniforms.opticsNeutral.value=c03OpticsMix;
          }
        });
        materials.forEach(material=>{
          if(material.userData.c03GlassUniforms) material.userData.c03GlassUniforms.ambientDetail.value=opticsBlackout ? 1-c03OpticsMix : 1;
        });
        c03Fade.uniforms.uGlowStrength.value=(.06+.16*coreEmissive)*(1-c03OpticsMix);
        c03Fade.uniforms.uBackdrop.value.copy(c03Studio.compositeBackground);
        host.dataset.c03Lighting=callbacks.c03LightingPreset;
        host.dataset.c03LightingLabel=lighting.label;
      }
      const entering = callbacks.entryRequested && !entryDone;
      if (callbacks.exitRequested && modelFailed) { complete = true; callbacks.onExitComplete?.(); return; }
      if (callbacks.exitRequested && returnFailed) {
        callbacks.onExitError?.("返回点云读取失败，已保留观测画面。请刷新后重试。");
      }
      if (mirror) {
        updateMirrorState(mirror, { dt, ...(callbacks.mirrorControl ?? {}), points: callbacks.mirrorPoints,
          active: loaded && !entering && c01Ownership.mirrorActive && cavity.mix === 0,
          closing: callbacks.exitRequested || c01Ownership.cavityActive, reduced: reducedMotion });
        for (const [weight, key] of [["modelWeight", "modelMotion"], ["cameraWeight", "cameraMotion"], ["lightWeight", "lightMotion"]]) {
          mirror[weight] = THREE.MathUtils.damp(mirror[weight], callbacks.mirrorControl?.[key] === false ? 0 : 1, 4, dt);
        }
        updateCavityState(cavity,{dt:frameDelta,...(callbacks.cavityControl ?? {}),points:callbacks.mirrorPoints,
          active:loaded && !entering && !callbacks.exitRequested && c01Ownership.cavityActive && mirror.amount === 0,
          reduced:reducedMotion});
      }
      // Close the screen mirror before sampling the single body for archive return.
      const returning = callbacks.exitRequested && Boolean(returnField) && loaded && (!mirror || (mirror.amount === 0 && cavity.mix === 0));
      controls.enabled = !entering && !callbacks.exitRequested;
      let entry = entryMotionAt(100);
      if (entering && loaded) {
        const live = archiveSession.current.entryClouds?.[organism.id];
        if (entryStart === null && live) {
          entryTime = live.material.uniforms.uTime.value; entryEmphasis = live.material.uniforms.uEmphasis.value;
        } else if (!reducedMotion) entryTime += dt;
        entry = entryMotionAt(entryStart === null ? 0 : (performance.now()-entryStart)/1000, reducedMotion);
        camera.position.lerpVectors(archiveCamera, observationPosition, entry.focus);
        controls.target.lerpVectors(archiveTarget, observationTarget, entry.focus);
        camera.fov = THREE.MathUtils.lerp(archiveFov(camera.aspect), currentObservationFov(camera.aspect), entry.focus); camera.updateProjectionMatrix();
        specimen.position.copy(entryPosition).multiplyScalar(1-entry.focus);
        specimen.scale.setScalar(THREE.MathUtils.lerp(entryScale, 1, entry.focus));
        specimen.rotation.set(0, THREE.MathUtils.lerp(entryPlacement.yaw, observationFrontYaw, entry.focus), 0);
      }
      if (returning && !returnStarted) {
        returnStarted = true; dragging = false;
        specimen.updateMatrixWorld(true);
        returnField.sourceMatrix.copy(specimen.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(...base.toArray()));
        returnCamera.copy(camera.position); returnTarget.copy(controls.target); returnFov = camera.fov;
        returnTime = archiveSession.current.cloudTime ?? 0;
      }
      if (returning) {
        returnElapsed += dt; if (!reducedMotion) returnTime += dt;
        archiveSession.current.cloudTime = returnTime;
      }
      const returningMotion = returnMotionAt(returnElapsed);
      uniforms.uEntrySurface.value = entry.surface;
      uniforms.uDissolve.value = returning ? returningMotion.dissolve : 0;
      // C04's world-space light breathing; species retain their own geometry.
      lightingStudy?.reset();
      const lightElapsed = mirror ? mirror.time : elapsed;
      const idlePulse = .5 + .5*Math.sin(lightElapsed*.46);
      front.intensity = isC03 ? 1.02 + idlePulse*.12 : .67 + idlePulse*.16;
      rim.intensity = isC03 ? 2.42 + idlePulse*.22 : 7.75 + idlePulse*.92;
      low.intensity = isC03 ? 0 : .66 + idlePulse*.12;
      const lightTime = lightElapsed*.24;
      if (!isC03) {
        front.position.set(3.6+Math.sin(lightTime)*.34, .15+Math.cos(lightTime*.83)*.2, 4.8+Math.cos(lightTime)*.16);
        front.lookAt(0, -.2, 0);
        rim.position.set(.9+Math.sin(lightTime*.71+1.2)*.72, 4.8+Math.cos(lightTime*.58)*.18, -3.6+Math.cos(lightTime*.71+1.2)*.42);
        rim.lookAt(0, .35, 0);
        low.position.set(-1.7+Math.cos(lightTime*.62+2.1)*.25, -2.2+Math.sin(lightTime*.76+.7)*.14, 2.4+Math.sin(lightTime*.62+2.1)*.22);
      }
      if (lightingStudy) {
        // Use C01's approved observation rig from the first entry frame. Only
        // fade it once the actual archive-return dissolution begins.
        const studyStrength = 1 - uniforms.uDissolve.value;
        lightingStudy.update(callbacks.lightingPreset,studyStrength,dt);
        const lightAmount = mirror.amount*mirror.lightWeight*studyStrength;
        mirrorLighting(front, rim, low, lightAmount, mirror.time);
        host.dataset.lightingPreset = callbacks.lightingPreset;
        host.dataset.lightingStudyStrength = studyStrength.toFixed(3);
        host.dataset.lightingMotionAmount = lightAmount.toFixed(4);
      }
      if (c02Lighting) {
        // Carry the approved membrane rig through entry so the reconstructing
        // surface never flashes through the generic interaction lighting.
        const c02Strength = 1 - uniforms.uDissolve.value;
        const c02State = c02Lighting.update(callbacks.c02LightingPreset, c02Strength, dt, elapsed);
        c02Uniforms.uC02NodeGlow.value = c02State.nodeGlow * c02Strength;
        bloom.strength = .12;
        bloom.radius = .52;
        bloom.threshold = .96;
        host.dataset.c02Lighting = callbacks.c02LightingPreset;
        host.dataset.c02LightingLabel = c02State.label;
        host.dataset.c02Material = "pearl-coral-node-tissue-040-backscatter-066";
        host.dataset.c02Transparency = "0.40";
        host.dataset.c02WebAlphaLoss = "0.24";
        host.dataset.c02Backscatter = "0.66";
      }
      if (c05Lighting) {
        // Keep the confirmed foundation rig throughout entry. The same light
        // state now spans archive-cloud reconstruction and final observation.
        const c05Strength = 1 - uniforms.uDissolve.value;
        const tomography=updateC05Tomography(c05Tomography,{dt,time:elapsed,control:callbacks.c05Control,active:loaded&&!entering&&!callbacks.exitRequested});
        const c05State = c05Lighting.update(c05Strength*(1-tomography.mix*.58), dt, elapsed);
        c05Uniforms.uC05Time.value = elapsed;
        c05Uniforms.uC05Motion.value = reducedMotion ? .18 : 1;
        c05Uniforms.uC05WarmGlow.value = c05Strength;
        c05Uniforms.uC05TomographyMix.value=tomography.mix;
        c05Uniforms.uC05TomographyCenter.value=tomography.center;
        c05Uniforms.uC05TomographyThickness.value=tomography.thickness;
        c05Uniforms.uC05TomographyDwell.value=tomography.dwell;
        c05Uniforms.uC05TomographyTrail.value=tomography.trail;
        bloom.strength = .34;
        bloom.radius = .62;
        bloom.threshold = .88;
        host.dataset.c05Lighting = "dramatic-sculpture";
        host.dataset.c05LightingLabel = c05Lighting.label;
        host.dataset.c05TissueMotion = reducedMotion ? "reduced" : "asynchronous";
        host.dataset.c05Pulse = c05State.pulse.toFixed(3);
        host.dataset.c05Tomography=`${tomography.mode}:${tomography.center.toFixed(3)}:${tomography.thickness.toFixed(3)}`;
      }
      if (c02Flow) {
        const flow = c02Flow.update({ dt, time: elapsed, control: callbacks.c02Control,
          camera, active: loaded && !entering && !callbacks.exitRequested });
        host.dataset.c02Flow = flow.phase;
        host.dataset.c02FlowEnergy = flow.energy.toFixed(3);
        host.dataset.c02FlowProgress = flow.progress.toFixed(3);
        host.dataset.c02FlowDemoAge = flow.demoAge.toFixed(3);
        host.dataset.c02FlowSource = String(flow.source);
        host.dataset.c02FlowTargets = flow.targets.join(",");
        c02Uniforms.uC02FlowEnergy.value = flow.energy;
        c02Uniforms.uC02FlowProgress.value = flow.progress;
        c02Uniforms.uC02FlowTime.value = elapsed;
        c02Uniforms.uC02FlowBias.value = 0;
      }
      if (!entering && (!callbacks.exitRequested || (mirror && !returnStarted))) {
        const strength = mirror ? mirror.amount*mirror.modelWeight : 0, time = mirror?.time ?? 0;
        const response = mirror ? 1-Math.exp(-(cavity.mix>0 ? 10 : 3.6)*dt) : .105;
        const cavityDrive = cavity ? cavity.drive*cavity.mix : 0;
        const cavityPulse = cavity ? cavity.mix*(cavity.charge*.003*Math.sin(cavity.time*8.2)+cavity.release*.0045*Math.sin(cavity.time*14.5)) : 0;
        const cavityPaused = cavity?.mix === 1 && c01Ownership.cavityActive && callbacks.cavityControl?.paused && !callbacks.exitRequested;
        if (!cavityPaused) {
          specimen.rotation.x += (pitch + strength*.19*Math.sin(time*.24)-specimen.rotation.x)*response;
          specimen.rotation.y += (yaw+c03AutoYaw + strength*.62*Math.sin(time*.17) + cavityDrive*.08 + cavityPulse-specimen.rotation.y)*response;
          if (mirror) {
            specimen.rotation.z += (strength*.075*Math.sin(time*.21) + cavityDrive*.005-specimen.rotation.z)*response;
            specimen.position.x = 0;
            specimen.scale.setScalar(1 + cavityPulse);
          }
        }
      }
      if (c03Dispersal) {
        const dispersal=c03Dispersal.update({dt,time:elapsed,points:callbacks.c03Points,camera,root:c03DispersalRoot,
          active:loaded&&!entering&&!callbacks.exitRequested,demo:callbacks.c03Control?.demo??0,
          blockedWrists:c03Ownership.blockRightWrist?[16]:[]});
        dispersal.amounts.forEach((amount,index)=>uniforms.uC03DispersalAmount.value[index]=amount);
        host.dataset.c03Dispersal=dispersal.phases.join(",");
        host.dataset.c03CoreScreens=dispersal.centers.map(center=>{
          const projected=c03DispersalRoot.localToWorld(center.clone()).project(camera);
          return `${((projected.x+1)/2).toFixed(3)}:${((1-projected.y)/2).toFixed(3)}`;
        }).join(",");
        c03DispersalRoot.rotation.z=Math.sin(elapsed*4.2)*dispersal.wave*.014;
        c03DispersalRoot.rotation.x=Math.sin(elapsed*3.1+.7)*dispersal.wave*.008;
      }
      let c03CaptureState=null;
      if(c03Capture){c03CaptureState=c03Capture.update({dt,control:callbacks.c03Control,active:loaded&&!entering&&!callbacks.exitRequested&&c03Ownership.captureActive});host.dataset.c03Capture=`${c03CaptureState.mode}:${c03CaptureState.captured}`;}
      if(c03Optics){const optics=c03Optics.update({dt,control:{...(callbacks.c03Control??{}),captureArmed:c03CaptureState?.armed,captureReleaseAccent:c03CaptureState?.releaseAccent},active:loaded&&!entering&&!callbacks.exitRequested&&c03Ownership.captureActive});host.dataset.c03Optics=optics.mode;}
      if (returning) {
        camera.position.lerpVectors(returnCamera, archiveCamera, returningMotion.camera);
        controls.target.lerpVectors(returnTarget, archiveTarget, returningMotion.camera);
        camera.fov = THREE.MathUtils.lerp(returnFov, archiveFov(camera.aspect), returningMotion.camera);
        camera.updateProjectionMatrix();
      }
      if (entering || returning) camera.lookAt(controls.target); else controls.update();
      if (mirror) {
        sourceCamera.copy(camera);
        const amount = mirror.amount, time = mirror.time, framing = mirror.cameraWeight;
        sourceCamera.position.x += amount * framing * .3 * Math.sin(time*.13);
        sourceCamera.position.y += amount * framing * .18 * Math.sin(time*.19);
        sourceTarget.copy(controls.target);
        sourceTarget.y += amount * framing * .09 * Math.sin(time*.16);
        sourceCamera.lookAt(sourceTarget);
        sourceCamera.zoom = 1 + amount * framing * (.12 + .06*Math.sin(time*.22));
        sourceCamera.updateProjectionMatrix();
        mirrorPass.enabled = amount > .0001;
        mirrorPass.uniforms.uAmount.value = amount;
        mirrorPass.uniforms.uAspect.value = camera.aspect;
        mirrorFramingAt(time, camera.aspect, mirrorFraming);
        mirrorPass.uniforms.uScale.value = .87 + framing*(.10*Math.sin(time*.18)+mirrorFraming.scale) - amount*.08;
        // Blend unit directions, not a growing angle, when toggling framing off.
        const initialAngle = .18;
        const desiredAngle = Math.atan2(
          (1-framing)*Math.sin(initialAngle)+framing*Math.sin(mirrorFraming.angle),
          (1-framing)*Math.cos(initialAngle)+framing*Math.cos(mirrorFraming.angle));
        const angleDelta = Math.atan2(Math.sin(desiredAngle-mirror.sampleAngle), Math.cos(desiredAngle-mirror.sampleAngle));
        mirror.sampleAngle += angleDelta*(1-Math.exp(-4*dt));
        mirrorPass.uniforms.uAngle.value = mirror.sampleAngle;
        mirrorPass.uniforms.uPivot.value.set(.5+framing*(mirrorFraming.x-.5), .43+framing*(mirrorFraming.y-.43));
        host.dataset.mirrorAmount = amount.toFixed(4);
        host.dataset.mirrorTime = time.toFixed(3);
        host.dataset.mirrorMode = callbacks.mirrorControl?.mode ?? "manual";
        host.dataset.mirrorTracking = mirror.lost > 1.2 ? "returning" : mirror.lost > 0 ? "holding" : "tracked";
        host.dataset.mirrorSectors = "6";
        host.dataset.sourceZoom = sourceCamera.zoom.toFixed(3);
        host.dataset.sourcePivot = `${mirrorPass.uniforms.uPivot.value.x.toFixed(3)},${mirrorPass.uniforms.uPivot.value.y.toFixed(3)}`;
      }
      if (cavityRenderer) {
        cavityRenderer.update(renderer,scene,sourceCamera,specimen,cavity);
        cavityAudio.update(cavity,cavityRenderer.pass.uniforms.uCoreUv.value,camera.aspect,
          c01Ownership.cavityActive && !entering && !callbacks.exitRequested,
          Boolean(callbacks.cavityControl?.paused));
        host.dataset.cavityMix=cavity.mix.toFixed(4);
        host.dataset.cavityCharge=cavity.charge.toFixed(4);
        host.dataset.cavityRelease=cavity.release.toFixed(4);
        host.dataset.cavityReleaseAge=cavity.releaseAge.toFixed(3);
        host.dataset.cavityTime=cavity.time.toFixed(3);
        host.dataset.cavityCore=cavityRenderer.core.visible ? "visible" : "occluded-or-idle";
        host.dataset.cavityCoreUv=`${cavityRenderer.pass.uniforms.uCoreUv.value.x.toFixed(3)},${cavityRenderer.pass.uniforms.uCoreUv.value.y.toFixed(3)}`;
        host.dataset.cavityTransmission="front-back-depth";
        host.dataset.cavityWaves="3";
        host.dataset.cavityReflections="4";
        host.dataset.cavitySource=String(cavity.sourceIndex);
        host.dataset.cavityTracking=cavity.tracking;
        host.dataset.cavityGesture=cavity.gestureStage;
        host.dataset.cavityAudioGate=String(cavity.audioGate);
        host.dataset.cavityAudio=cavityAudio.status;
      }
      if (c03Fade) {
        c03Fade.uniforms.uOpacity.value = entering ? entry.focus : returning ? 1-THREE.MathUtils.smoothstep(uniforms.uDissolve.value,.08,.84) : 1;
      }
      if (returning && returningMotion.contour >= 1) renderer.clear(); else {
        if (c03GlassCapture) {
          scene.updateMatrixWorld(true);
          c03GlassCapture.update(camera);
        }
        composer.render();
      }
      if (entering && entryCloud) {
        entryParent.position.copy(specimen.position); entryParent.quaternion.copy(specimen.quaternion); entryParent.scale.copy(specimen.scale);
        entryCloud.material.uniforms.uTime.value = entryTime;
        entryCloud.material.uniforms.uEmphasis.value = entryEmphasis*entry.points;
        renderer.autoClear = false; renderer.clearDepth(); renderer.render(entryScene, camera); renderer.autoClear = true;
      }
      if (returning) {
        returnField.update(returnElapsed, returnTime);
        renderer.autoClear = false; renderer.clearDepth(); renderer.render(returnField.scene, camera); renderer.autoClear = true;
        if (returningMotion.terrain && !revealed) { revealed = true; callbacks.onArchiveReveal?.(); }
        if (callbacks.archiveReady) readyElapsed += dt;
      }
      host.dataset.entryProgress = entry.progress.toFixed(4);
      host.dataset.returnElapsed = returnElapsed.toFixed(3);
      host.dataset.returnParticles = returning ? String(RETURN_PARTICLE_COUNT) : "0";
      host.dataset.response = isMirror ? `combined:${c01Ownership.owner}` : isC02 ? "intrinsic-surface-rerouting" : isC03 ? `combined:${c03Ownership.captureActive?"capture":"dispersal"}` : isC05 ? "living-tomography" : "observation-only";
      if (entering && loaded && entryStart === null) {
        entryStart = performance.now(); archiveSession.current.entryClouds?.[organism.id]?.release(); callbacks.onEntryReady?.();
      }
      if (entering && loaded && entry.complete && !entryDone) { entryDone = true; callbacks.onEntryComplete?.(); }
      if (returning && returningMotion.complete && readyElapsed >= 1.85 && archiveSession.current.revealReturnClouds) {
        archiveSession.current.revealReturnClouds(); complete = true; callbacks.onExitComplete?.(); return;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => {
      disposed = true; cancelAnimationFrame(raf); observer.disconnect();
      window.removeEventListener("c01-cavity-audio-toggle",onCavityAudioToggle);
      for (const [name, handler] of [["dblclick", reset], ["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", up]]) renderer.domElement.removeEventListener(name, handler);
      controls.dispose(); entryCloud?.geometry.dispose(); entryCloud?.material.dispose(); returnField?.dispose();
      geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
      cavityAudio?.dispose(); cavityRenderer?.dispose(); mirrorPass?.dispose(); c02Flow?.dispose(); c03Dispersal?.dispose(); c03Optics?.dispose(); c03Capture?.dispose(); c03GlassCapture?.dispose(); c03Output?.dispose(); c03Fade?.dispose(); c03Studio?.dispose(); bloom.dispose(); finish.dispose(); composer.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [organism.id]);

  return <div className="specimen-stage" aria-label={`${organism.category}三维标本`}>
    <div className="specimen-webgl" ref={hostRef} />
  </div>;
}
