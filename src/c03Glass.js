import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const MATERIAL_MASK_URL = "/assets/observation/category-3-material-mask.png?v=core-distance-v1";
let materialMaskPromise;

export function preloadC03MaterialMask() {
  if (!materialMaskPromise) {
    materialMaskPromise = new THREE.TextureLoader().loadAsync(MATERIAL_MASK_URL).then(texture => {
      texture.name = "C03 glass/core material mask";
      texture.colorSpace = THREE.NoColorSpace;
      texture.flipY = false;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      return texture;
    }).catch(error => {
      materialMaskPromise = undefined;
      throw error;
    });
  }
  return materialMaskPromise;
}

// The camera keeps the site's black background. This PMREM is only sampled by
// the physical material, which is the browser equivalent of a bright studio
// remaining visible to reflection rays while hidden from camera rays.
export function createC03StudioEnvironment(renderer) {
  const environmentScene = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(environmentScene, .025);
  pmrem.dispose();
  environmentScene.dispose();
  target.texture.name = "C03 unseen white-card studio";
  return {
    texture: target.texture,
    dispose() {
      target.dispose();
    },
  };
}

export function createC03TransmissionBackdrop(size = 384) {
  const data = new Uint8Array(size*size*4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x/(size-1), v = y/(size-1);
      // This surface is sampled through the glass and removed by the camera
      // matte. It preserves the white-studio transmission of the Blender file.
      const center = Math.exp(-((u-.51)**2/.23 + (v-.55)**2/.42));
      const lowerLift = Math.max(0, .62-v)*.12;
      const value = THREE.MathUtils.clamp(.58 + center*.29 + lowerLift, .56, .94);
      const index = (y*size+x)*4;
      data[index] = Math.round(value*246);
      data[index+1] = Math.round(Math.min(1, value*1.015)*250);
      data[index+2] = Math.round(Math.min(1, value*1.035)*255);
      data[index+3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = "C03 neutral transmission cyclorama";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createC03StudioGround() {
  const outline = new THREE.Shape();
  const segments = 144;
  for (let index = 0; index < segments; index += 1) {
    const angle = index / segments * Math.PI * 2;
    const radius = 1 + Math.sin(angle*3+.7)*.045 + Math.sin(angle*5-1.2)*.027 + Math.sin(angle*8+.3)*.012;
    const x = Math.cos(angle)*radius;
    const y = Math.sin(angle)*radius;
    if (index === 0) outline.moveTo(x, y); else outline.lineTo(x, y);
  }
  outline.closePath();
  const geometry = new THREE.ShapeGeometry(outline, segments);
  const matteMaterials = [];
  const uniforms = {
    uActivation: { value: 0 },
    uPulseRadius: { value: -1 },
    uPulseStrength: { value: 0 },
    uVisibility: { value: 1 },
    uTime: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    name: "C03 irregular luminous observation field",
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vFieldPosition;
      void main(){
        vFieldPosition=position.xy;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      }`,
    fragmentShader: `varying vec2 vFieldPosition;
      uniform float uActivation;
      uniform float uPulseRadius;
      uniform float uPulseStrength;
      uniform float uVisibility;
      uniform float uTime;
      void main(){
        vec2 p=vFieldPosition;
        float angle=atan(p.y,p.x);
        float boundary=1.0+sin(angle*3.0+.7)*.045+sin(angle*5.0-1.2)*.027+sin(angle*8.0+.3)*.012;
        float radius=length(p);
        float edge=1.0-smoothstep(boundary-.17,boundary,radius);
        float center=exp(-radius*radius*2.55);
        float living=sin(angle*4.0+uTime*.12+radius*9.0)*.5+.5;
        float pulse=exp(-pow((radius-uPulseRadius)*13.0,2.0))*uPulseStrength;
        vec3 milk=vec3(.91,.97,.985);
        vec3 ice=vec3(.42,.79,.86);
        vec3 color=mix(ice,milk,clamp(center*.88+uActivation*.17+pulse*.28,0.0,1.0));
        float alpha=edge*(.075+center*.22+uActivation*(.10+center*.13)+pulse*.27+living*.009);
        gl_FragColor=vec4(color,alpha*uVisibility);
      }`,
  });
  const ground = new THREE.Mesh(geometry, material);
  ground.name = "C03 irregular luminous plane";
  ground.rotation.x = -Math.PI/2;
  ground.scale.set(2.18, 1.32, 1);
  ground.position.set(0, -1.515, .34);
  ground.renderOrder = -1;
  return {
    object: ground,
    createMatte() {
      const matteMaterial = new THREE.ShaderMaterial({
        name: "C03 luminous field feathered matte",
        uniforms,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: `varying vec2 vFieldPosition;
          void main(){vFieldPosition=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `varying vec2 vFieldPosition;
          uniform float uActivation;
          uniform float uPulseRadius;
          uniform float uPulseStrength;
          uniform float uVisibility;
          void main(){
            vec2 p=vFieldPosition;
            float angle=atan(p.y,p.x);
            float boundary=1.0+sin(angle*3.0+.7)*.045+sin(angle*5.0-1.2)*.027+sin(angle*8.0+.3)*.012;
            float radius=length(p);
            float edge=1.0-smoothstep(boundary-.2,boundary,radius);
            float center=exp(-radius*radius*2.55);
            float pulse=exp(-pow((radius-uPulseRadius)*13.0,2.0))*uPulseStrength;
            float mask=edge*(.12+center*.78+uActivation*(.05+center*.06)+pulse*.22)*uVisibility;
            gl_FragColor=vec4(vec3(mask),1.0);
          }`,
      });
      matteMaterials.push(matteMaterial);
      const matte = new THREE.Mesh(geometry, matteMaterial);
      matte.name = "C03 luminous plane camera matte";
      matte.position.copy(ground.position);
      matte.rotation.copy(ground.rotation);
      matte.scale.copy(ground.scale);
      return matte;
    },
    update({ time, activation, pulseRadius, pulseStrength, visibility }) {
      uniforms.uTime.value = time;
      uniforms.uActivation.value = activation;
      uniforms.uPulseRadius.value = pulseRadius;
      uniforms.uPulseStrength.value = pulseStrength;
      uniforms.uVisibility.value = visibility;
    },
    dispose() {
      ground.geometry.dispose();
      material.dispose();
      matteMaterials.forEach(item => item.dispose());
    },
  };
}

function applyRegionMask(material, materialMask, keepGlass, activationUniforms, role) {
  const extendMaterial = material.onBeforeCompile;
  material.onBeforeCompile = shader => {
    extendMaterial?.(shader);
    shader.uniforms.uC03MaterialMask = { value: materialMask };
    Object.assign(shader.uniforms, activationUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vC03MaterialUv;\nvarying float vC03Height;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvC03MaterialUv=uv;\nvC03Height=clamp(position.y/3.02,0.0,1.0);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vC03MaterialUv;\nvarying float vC03Height;\nuniform sampler2D uC03MaterialMask;\nuniform float uC03Activation;\nuniform float uC03Release;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        float c03RegionMask=texture2D(uC03MaterialMask,vC03MaterialUv).r;
        if(${keepGlass ? "c03RegionMask<.46" : "c03RegionMask>=.46"}) discard;
      `)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        float c03Climb=smoothstep(vC03Height-.22,vC03Height+.08,uC03Activation);
        float c03Awake=c03Climb*uC03Activation;
        ${role === "core"
          ? "totalEmissiveRadiance += vec3(1.0,.94,.80)*(.002+c03Awake*.16+uC03Release*.08);"
          : "totalEmissiveRadiance += vec3(.46,.86,.94)*(.014+c03Awake*.10+uC03Release*.055);"}
      `);
  };
  material.customProgramCacheKey = () => `c03-${role}-activation-v2`;
  return material;
}

export function c03GlassMaterial(source, materialMask, activationUniforms) {
  const material = new THREE.MeshPhysicalMaterial({
    name: "C03 cyan bioglass shell",
    color: 0xf8feff,
    normalMap: source.normalMap ?? null,
    normalScale: new THREE.Vector2(.04, .04),
    metalness: 0,
    roughness: .03,
    transmission: .985,
    ior: 1.45,
    thickness: .075,
    attenuationColor: new THREE.Color(0xcff4f8),
    attenuationDistance: 5.2,
    clearcoat: .72,
    clearcoatRoughness: .045,
    sheen: .04,
    sheenColor: new THREE.Color(0xdff9ff),
    sheenRoughness: .24,
    envMapIntensity: 1.08,
    emissive: new THREE.Color(0x000000),
  });
  material.side = THREE.FrontSide;
  material.depthWrite = true;
  material.userData.c03Material = {
    glassIor: 1.45,
    glassRoughness: .078,
    transmission: 1,
    studioVisibleToCamera: false,
  };
  return applyRegionMask(material, materialMask, true, activationUniforms, "glass");
}

export function c03CoreMaterial(source, materialMask, activationUniforms) {
  const material = new THREE.MeshPhysicalMaterial({
    name: "C03 ivory dormant cores",
    color: 0xc8c5ba,
    map: source.map ?? null,
    normalMap: source.normalMap ?? null,
    normalScale: new THREE.Vector2(.11, .11),
    metalness: 0,
    roughness: .38,
    ior: 1.36,
    clearcoat: .12,
    clearcoatRoughness: .16,
    sheen: .08,
    sheenColor: new THREE.Color(0xfff3d8),
    sheenRoughness: .45,
    envMapIntensity: .55,
    emissive: new THREE.Color(0x000000),
  });
  material.side = THREE.FrontSide;
  material.depthWrite = true;
  material.userData.c03Material = { coreRoughness: .34, transmission: 0 };
  return applyRegionMask(material, materialMask, false, activationUniforms, "core");
}
