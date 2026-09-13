import * as THREE from "three";

let materialMapsPromise = null;

export function preloadC05MaterialMaps() {
  if (materialMapsPromise) return materialMapsPromise;
  const loader = new THREE.TextureLoader();
  materialMapsPromise = Promise.all([
    loader.loadAsync("/assets/observation/category-5-basecolor.jpg"),
    loader.loadAsync("/assets/observation/category-5-normal.jpg"),
    loader.loadAsync("/assets/observation/category-5-surface.png"),
    loader.loadAsync("/assets/observation/category-5-material-mask.png"),
  ]).then(([baseColor, normal, surface, mask]) => {
    baseColor.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [normal, surface, mask]) texture.colorSpace = THREE.NoColorSpace;
    for (const texture of [baseColor, normal, surface, mask]) {
      texture.flipY = false;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.needsUpdate = true;
    }
    return { baseColor, normal, surface, mask };
  });
  return materialMapsPromise;
}

export function createC05FoundationUniforms() {
  return {
    uC05Time: { value: 0 },
    uC05Motion: { value: 1 },
    uC05WarmGlow: { value: 1 },
    uC05TomographyMix: { value: 0 },
    uC05TomographyCenter: { value: .5 },
    uC05TomographyThickness: { value: .18 },
    uC05TomographyDwell: { value: 0 },
    uC05TomographyTrail: { value: 0 },
  };
}

export function c05HeterogeneousMaterial(source, coverageUniforms, c05Uniforms, maps, applyCoverage) {
  const material = new THREE.MeshPhysicalMaterial({
    name: `${source.name || "C05"}-heterogeneous-foundation`,
    color: 0xffffff,
    map: maps.baseColor,
    normalMap: maps.normal,
    roughnessMap: maps.surface,
    roughness: .88,
    metalness: 0,
    clearcoat: 0,
    sheen: .16,
    sheenColor: new THREE.Color(0xb9c4b6),
    sheenRoughness: .86,
    specularIntensity: .26,
    side: THREE.DoubleSide,
  });
  material.normalScale.set(.28, .28);
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, c05Uniforms);
    shader.uniforms.uC05MaterialMask = { value: maps.mask };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
      uniform sampler2D uC05MaterialMask;
      uniform float uC05Time;
      uniform float uC05Motion;
    `);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform sampler2D uC05MaterialMask;
        uniform float uC05Time;
        uniform float uC05WarmGlow;
        uniform float uC05TomographyMix;
        uniform float uC05TomographyCenter;
        uniform float uC05TomographyThickness;
        uniform float uC05TomographyDwell;
        uniform float uC05TomographyTrail;
      `)
      .replace("#include <map_fragment>", `#include <map_fragment>
        vec4 c05MaskSample=texture2D(uC05MaterialMask,vMapUv);
        float c05Substrate=c05MaskSample.r;
        float c05Bone=c05MaskSample.g;
        float c05Velvet=c05MaskSample.b;
        float c05Warm=c05MaskSample.a;
        vec3 c05SubstrateTint=vec3(.31,.34,.29);
        vec3 c05BoneTint=vec3(.88,.85,.74);
        vec3 c05VelvetTint=vec3(.31,.40,.37);
        vec3 c05WarmTint=vec3(.70,.28,.12);
        vec3 c05TissueTint=c05SubstrateTint*c05Substrate+c05BoneTint*c05Bone+c05VelvetTint*c05Velvet+c05WarmTint*c05Warm;
        float c05Weight=max(.001,c05Substrate+c05Bone+c05Velvet+c05Warm);
        c05TissueTint/=c05Weight;
        diffuseColor.rgb=mix(diffuseColor.rgb,c05TissueTint,.12+c05Bone*.10+c05Velvet*.08+c05Warm*.16);
      `)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor=clamp(roughnessFactor+c05Velvet*.13+c05Substrate*.06-c05Bone*.10-c05Warm*.06,.48,.98);
      `)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        float c05BoneBreath=.5+.5*sin(uC05Time*.43+vObservationPosition.y*1.27);
        float c05ColonyBreath=.56+.28*sin(uC05Time*1.17+vObservationPosition.x*8.1)+.16*sin(uC05Time*1.91+vObservationPosition.z*9.7);
        totalEmissiveRadiance+=vec3(.90,.82,.65)*c05Bone*(.010+c05BoneBreath*.012);
        totalEmissiveRadiance+=vec3(1.0,.35,.10)*c05Warm*(.018+c05ColonyBreath*.036)*uC05WarmGlow;
        float c05SliceY=clamp(vObservationPosition.y/3.02,0.0,1.0);
        float c05SliceDistance=abs(c05SliceY-uC05TomographyCenter);
        float c05Slice=smoothstep(uC05TomographyThickness,uC05TomographyThickness*.18,c05SliceDistance)*uC05TomographyMix;
        float c05Residual=smoothstep(uC05TomographyThickness*2.25,uC05TomographyThickness*.55,c05SliceDistance)*uC05TomographyTrail;
        float c05FlowA=.5+.5*sin(vObservationPosition.x*13.0+vObservationPosition.z*9.0+sin(vObservationPosition.y*7.0+uC05Time*.92)*2.1);
        float c05FlowB=.5+.5*sin(vObservationPosition.x*5.7-vObservationPosition.z*16.0+vObservationPosition.y*8.2-uC05Time*1.17);
        float c05FlowC=.5+.5*sin(length(vObservationPosition.xz)*18.0-vObservationPosition.y*5.0+uC05Time*.63);
        float c05Organic=c05FlowA*.46+c05FlowB*.31+c05FlowC*.23+observationGrain(floor(vObservationPosition*72.0))*.10;
        float c05Vein=smoothstep(.62,.91,c05Organic);
        vec3 c05RevealColor=mix(diffuseColor.rgb,vec3(1.0,.94,.83),.31+c05Bone*.24);
        totalEmissiveRadiance+=c05RevealColor*(c05Slice*(.12+c05Vein*(.48+uC05TomographyDwell*.36))+c05Residual*c05Vein*.085);
      `);
    shader.fragmentShader=shader.fragmentShader.replace("#include <dithering_fragment>",`#include <dithering_fragment>
      float c05FinalY=clamp(vObservationPosition.y/3.02,0.0,1.0);
      float c05FinalSlice=smoothstep(uC05TomographyThickness*1.75,uC05TomographyThickness*.28,abs(c05FinalY-uC05TomographyCenter));
      gl_FragColor.rgb*=1.0-uC05TomographyMix*.56*(1.0-c05FinalSlice);
    `);
  };
  material.userData.c05Uniforms = c05Uniforms;
  return applyCoverage(material, coverageUniforms, "c05-foundation-heterogeneous-v1");
}

export function createC05GreenhouseLighting({ scene, ambient, key, front, rim, side, low }) {
  const target = new THREE.Vector3(0, .12, 0);
  const setArea = (light, color, intensity, width, height, position) => {
    light.color.set(color);
    light.intensity = intensity;
    light.width = width;
    light.height = height;
    light.position.set(...position);
    light.lookAt(target);
  };
  ambient.color.set(0xd9d7c8);
  ambient.groundColor.set(0x050605);
  ambient.intensity = .13;
  setArea(key, 0xfff0d3, 7.55, 5.6, 6.6, [-3.75, 3.55, 4.25]);
  setArea(front, 0xf1eee2, 1.62, 4.2, 5.0, [3.0, .35, 4.75]);
  setArea(rim, 0x87d8e3, 9.15, 4.1, 5.7, [2.8, 4.2, -3.7]);
  side.color.set(0xdef4ef);
  side.intensity = 1.18;
  side.position.set(-4.5, 1.25, -3.55);
  low.color.set(0xe26b28);
  low.intensity = .92;
  low.distance = 6.6;
  low.decay = 2;
  low.position.set(.25, -1.7, 1.8);

  // Small, soft internal fills reveal selected cavities without reading as visible bulbs.
  const cavityUpper = new THREE.PointLight(0xfff1d6, .34, 2.5, 2);
  const cavityLower = new THREE.PointLight(0xf7efe1, .26, 2.2, 2);
  cavityUpper.position.set(.18, .72, .18);
  cavityLower.position.set(-.28, -.62, .12);
  scene.add(cavityUpper, cavityLower);

  return {
    label: "冷暖雕塑",
    update(strength, dt, time) {
      const pulse = .5 + .5 * Math.sin(time * .23);
      key.intensity = THREE.MathUtils.damp(key.intensity, (7.25 + pulse * .58) * strength, 3.4, dt);
      front.intensity = THREE.MathUtils.damp(front.intensity, (1.48 + pulse * .24) * strength, 3.1, dt);
      rim.intensity = THREE.MathUtils.damp(rim.intensity, (8.7 + (1 - pulse) * .9) * strength, 3.2, dt);
      side.intensity = THREE.MathUtils.damp(side.intensity, 1.18 * strength, 3.2, dt);
      low.intensity = THREE.MathUtils.damp(low.intensity, (.82 + pulse * .22) * strength, 2.6, dt);
      ambient.intensity = THREE.MathUtils.damp(ambient.intensity, .13 * strength, 3.2, dt);
      cavityUpper.intensity = THREE.MathUtils.damp(cavityUpper.intensity, (.27 + pulse * .12) * strength, 2.8, dt);
      cavityLower.intensity = THREE.MathUtils.damp(cavityLower.intensity, (.20 + (1-pulse) * .1) * strength, 2.8, dt);
      const orbit = time * .055;
      key.position.x = -3.8 + Math.sin(orbit) * .18;
      rim.position.x = 2.65 + Math.sin(orbit * .83 + 1.4) * .22;
      key.lookAt(target);
      rim.lookAt(target);
      return { pulse };
    },
  };
}
