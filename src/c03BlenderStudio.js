import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import reference from './c03BlenderReference.json';

const EXTENT = 3.02;
const sourceSize = Math.max(...reference.model.dimensions);
const scale = EXTENT / sourceSize;
const center = reference.model.bounds_min.map((v,i) => (v+reference.model.bounds_max[i])/2);
const axisRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), -Math.PI/2);
const fromBlender = p => new THREE.Vector3((p[0]-center[0])*scale, (p[2]-center[2])*scale, -(p[1]-center[1])*scale);
const rotationFromBlender = q => axisRotation.clone().multiply(new THREE.Quaternion(q[1],q[2],q[3],q[0]));
const linearColor = values => new THREE.Color().setRGB(...values.slice(0,3));

export const C03_LIGHTING_PRESETS = {
  abyss: { label:'深海发光切片', background:[0,0,0], floor:[0,0,0], floorOpacity:0, light:[.32,.86,1], rim:[.02,.45,1], colors:[[.32,.86,1],[.14,.68,1],[.02,.45,1],[.78,.96,1]], underColor:[.14,.74,1], energy:.82, environment:.48, shadow:.045, under:7.2, field:.70 },
};

export function createC03BlenderStudio(renderer, scene) {
  RectAreaLightUniformsLib.init();
  const world = new THREE.Scene();
  world.background = new THREE.Color(1,1,1);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(world, 0);
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = reference.worldStrength;
  // Reflection/transmission rays see the source World. The camera-only white
  // field is applied separately, like the source transparent film + Alpha Over.
  // Keep the white world exclusively as an image-based lighting source.  The
  // camera sees black from the first frame, so there is no studio fade-in.
  scene.background = new THREE.Color(0x000000);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = Math.pow(2,reference.view.exposure);

  const rig = new THREE.Group();
  rig.name = 'C03 Blender four-light white studio';
  scene.add(rig);
  const studioLights = reference.lights.map(data => {
    // WebGL area lights are rectangles: use a square with the source disk's
    // area. A Lambertian emitter's radiance is power/(area*pi). This preserves
    // source ratios; Three's photometric and Cycles' radiometric units differ.
    const width = data.size*scale*Math.sqrt(Math.PI)/2;
    const intensity = data.power/(Math.PI*(data.size/2)**2)/Math.PI;
    const light = new THREE.RectAreaLight(linearColor(data.color),intensity,width,width);
    light.name = data.name;
    light.position.copy(fromBlender(data.position));
    light.quaternion.copy(rotationFromBlender(data.quaternion));
    rig.add(light);
    light.layers.enable(1);
    light.userData.baseIntensity = intensity;
    return light;
  });

  const floorMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Blender white photographic floor',
    color: linearColor(reference.groundMaterial['Base Color']),
    roughness: reference.groundMaterial.Roughness,
    clearcoat: reference.groundMaterial['Coat Weight'],
    clearcoatRoughness: reference.groundMaterial['Coat Roughness'],
    transparent:true,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(reference.ground.dimensions[0]*scale,reference.ground.dimensions[1]*scale),floorMaterial);
  floor.position.copy(fromBlender(reference.ground.position));
  floor.rotation.x = -Math.PI/2;
  floor.name = 'C03 visible white studio floor';
  floor.visible = false;
  rig.add(floor);

  const underLight=new THREE.RectAreaLight(0xdffbff,0,2.4,1.65);
  underLight.position.copy(floor.position).add(new THREE.Vector3(0,.025,.18));
  underLight.lookAt(0,1,0); underLight.layers.enable(1); underLight.name='C03 upward luminous field'; rig.add(underLight);
  const coreKey=new THREE.RectAreaLight(0xfff2dc,28,3.6,3.2);
  coreKey.position.set(-1.8,2.25,3.4); coreKey.lookAt(0,.15,0); coreKey.layers.set(2); coreKey.name='C03 core-only warm key'; rig.add(coreKey);
  const coreFill=new THREE.RectAreaLight(0xfffcf4,12,2.8,3.4);
  coreFill.position.set(2.2,.45,3.25); coreFill.lookAt(0,.05,0); coreFill.layers.set(2); coreFill.name='C03 core-only neutral fill'; rig.add(coreFill);
  const fieldMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{uStrength:{value:0}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`varying vec2 vUv;uniform float uStrength;void main(){vec2 p=(vUv-.5)*vec2(1.,1.7);float a=atan(p.y,p.x);float edge=.48+.025*sin(a*5.)+.014*sin(a*9.+1.2);float glow=(1.-smoothstep(edge*.48,edge,length(p)))*(.32+.68*exp(-dot(p,p)*7.));gl_FragColor=vec4(.58,.90,1.,glow*uStrength);}`});
  const luminousField=new THREE.Mesh(new THREE.PlaneGeometry(2.8,1.55),fieldMaterial);
  luminousField.position.copy(floor.position).add(new THREE.Vector3(0,.018,.20)); luminousField.rotation.x=-Math.PI/2; luminousField.name='C03 irregular luminous field'; rig.add(luminousField);
  // Retain the authored real-time light field and its animation state, but do
  // not composite the irregular lower patch into the observation image.
  luminousField.visible=false;

  const contactShadowMaterial = new THREE.ShaderMaterial({
    name: 'C03 soft photographic contact shadow',
    transparent: true,
    depthWrite: false,
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    uniforms:{uStrength:{value:.105}},
    fragmentShader: `varying vec2 vUv;uniform float uStrength;void main(){
      vec2 p=(vUv-.5)*vec2(1.0,3.25);
      float core=1.0-smoothstep(.08,.52,length(p));
      float broken=.88+.12*cos((vUv.x-.5)*18.0);
      gl_FragColor=vec4(vec3(.20,.32,.35),core*broken*uStrength);
    }`,
  });
  const contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.55,.72),contactShadowMaterial);
  contactShadow.position.copy(floor.position);
  contactShadow.position.y += .008;
  contactShadow.rotation.x = -Math.PI/2;
  contactShadow.renderOrder = 2;
  contactShadow.name = 'C03 grounded soft shadow';
  rig.add(contactShadow);

  const cameraPosition = fromBlender(reference.camera.position);
  const distance = (center[1]-reference.camera.position[1])/reference.camera.direction[1];
  const cameraTarget = fromBlender(reference.camera.position.map((v,i) => v+reference.camera.direction[i]*distance));
  const fov = THREE.MathUtils.radToDeg(reference.camera.angle_x);
  const compositeBackground=linearColor(reference.compositeBackground);
  const targetBackground=new THREE.Color(), targetFloor=new THREE.Color(), targetLight=new THREE.Color(), targetRim=new THREE.Color();
  const targetStudioColors=studioLights.map(()=>new THREE.Color()), targetUnderColor=new THREE.Color(), targetCoreKey=new THREE.Color();
  const saturationHsl={h:0,s:0,l:0};
  const saturatedColor=(target,values,factor=1)=>{
    target.setRGB(...values).getHSL(saturationHsl);
    target.setHSL(saturationHsl.h,THREE.MathUtils.clamp(saturationHsl.s*factor,0,1),saturationHsl.l);
    return target;
  };
  return {
    cameraPosition, cameraTarget, fov, compositeBackground,
    updateLighting(preset='abyss',dt=.016,tuning=null,opticsMix=0,opticsBlackout=false) {
      const data=C03_LIGHTING_PRESETS[preset] ?? C03_LIGHTING_PRESETS.abyss;
      const tune=preset==='abyss' ? (tuning ?? {}) : {};
      const response=1-Math.exp(-4.5*dt);
      targetBackground.setRGB(...data.background); targetFloor.setRGB(...data.floor);
      targetLight.setRGB(...data.light); targetRim.setRGB(...data.rim);
      compositeBackground.lerp(targetBackground,response);
      scene.background.lerp(targetBackground,response);
      floorMaterial.color.lerp(targetFloor,response);
      floorMaterial.opacity=THREE.MathUtils.lerp(floorMaterial.opacity,data.floorOpacity,response);
      const opticsEnvironment=opticsBlackout ? 0 : .012;
      const environmentTarget=THREE.MathUtils.lerp(data.environment*(tune.environment ?? 1),opticsEnvironment,opticsMix);
      scene.environmentIntensity=THREE.MathUtils.lerp(scene.environmentIntensity,environmentTarget,response);
      studioLights.forEach((light,index)=>{
        const saturation=[tune.main,tune.fill,tune.rim,1][index] ?? 1;
        const desired=data.colors ? saturatedColor(targetStudioColors[index],data.colors[index],saturation) : index===2 ? targetRim : targetLight;
        light.color.lerp(desired,response);
        const directional=index===2 ? 1.22 : index===3 ? .84 : 1;
        light.intensity=THREE.MathUtils.lerp(light.intensity,light.userData.baseIntensity*data.energy*directional*(1-opticsMix),response);
      });
      contactShadowMaterial.uniforms.uStrength.value=THREE.MathUtils.lerp(contactShadowMaterial.uniforms.uStrength.value,data.shadow,response);
      underLight.intensity=THREE.MathUtils.lerp(underLight.intensity,data.under*(1-opticsMix),response);
      saturatedColor(targetUnderColor,data.underColor ?? data.rim,tune.under ?? 1); underLight.color.lerp(targetUnderColor,response);
      saturatedColor(targetCoreKey,[1,.90,.76],tune.coreWarm ?? 1); coreKey.color.lerp(targetCoreKey,response);
      coreKey.intensity=THREE.MathUtils.lerp(coreKey.intensity,28*(1-opticsMix),response);
      coreFill.intensity=THREE.MathUtils.lerp(coreFill.intensity,12*(1-opticsMix),response);
      fieldMaterial.uniforms.uStrength.value=THREE.MathUtils.lerp(fieldMaterial.uniforms.uStrength.value,data.field*(tune.field ?? 1)*(1-opticsMix),response);
      return data;
    },
    dispose() {
      environment.dispose(); floor.geometry.dispose(); floorMaterial.dispose();
      contactShadow.geometry.dispose(); contactShadowMaterial.dispose(); scene.remove(rig);
      underLight.dispose(); luminousField.geometry.dispose(); fieldMaterial.dispose();
      coreKey.dispose(); coreFill.dispose();
    },
  };
}

function separateMaterial(material, mask, glass, layered = null) {
  const coreUniforms = glass ? null : { warmth:{value:1}, glow:{value:1}, opticsNeutral:{value:0} };
  const glassUniforms = glass ? { ambientDetail:{value:1} } : null;
  if (coreUniforms) material.userData.c03CoreUniforms=coreUniforms;
  if (glassUniforms) material.userData.c03GlassUniforms=glassUniforms;
  material.onBeforeCompile = shader => {
    shader.uniforms.uC03RegionMask = {value:mask};
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vC03RegionUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvC03RegionUv=uv;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vC03RegionUv;\nuniform sampler2D uC03RegionMask;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nfloat region=texture2D(uC03RegionMask,vC03RegionUv).r;\nif('+(glass ? 'region<.46' : 'region>=.46')+') discard;');
    if (!glass) {
      Object.assign(shader.uniforms,coreUniforms);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
uniform float warmth;
uniform float glow;
uniform float opticsNeutral;`)
        .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
float c03CoreDepth=texture2D(uC03RegionMask,vC03RegionUv).g;
float c03CoreCenter=smoothstep(.07,.88,c03CoreDepth);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.94,.96,.955),opticsNeutral*.88);
float c03CoreWarmMix=c03CoreCenter*clamp(warmth,0.0,2.0)*.28;
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(1.0,.66,.24),c03CoreWarmMix);
float c03Mature=0.0;
for(int c03i=0;c03i<8;c03i++){
  float c03Rise=sin(3.1415926*clamp(uC03DispersalAmount[c03i]/.72,0.0,1.0));
  c03Mature=max(c03Mature,c03Rise*(1.0-smoothstep(.10,.38,distance(vObservationPosition,uC03DispersalCenters[c03i]))));
}
totalEmissiveRadiance+=vec3(1.0,.62,.27)*c03CoreCenter*glow*.052+vec3(1.0,.55,.16)*c03Mature*.22;`);
    }
    if (glass) {
      Object.assign(shader.uniforms,glassUniforms);
      shader.uniforms.uC03FaceColor = {value:linearColor(reference.tintRamp[1].color)};
      shader.uniforms.uC03EdgeColor = {value:linearColor(reference.tintRamp[0].color)};
      shader.uniforms.uC03FacingPower = {value:reference.tintBlend < .5 ? 2*reference.tintBlend : .5/(1-reference.tintBlend)};
      shader.uniforms.uC03RearDepth = {value:layered.texture};
      shader.uniforms.uC03Resolution = {value:layered.resolution};
      shader.uniforms.uC03CameraNear = {value:.01};
      shader.uniforms.uC03CameraFar = {value:100};
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 uC03FaceColor;
uniform vec3 uC03EdgeColor;
uniform float uC03FacingPower;
uniform sampler2D uC03RearDepth;
uniform vec2 uC03Resolution;
uniform float uC03CameraNear;
uniform float uC03CameraFar;
uniform float ambientDetail;
float c03ViewDistance(float depth) {
  float z = depth * 2.0 - 1.0;
  return (2.0*uC03CameraNear*uC03CameraFar)/(uC03CameraFar+uC03CameraNear-z*(uC03CameraFar-uC03CameraNear));
}`)
        // Blender 4.4 Layer Weight Facing is 1 - |N.V|^(2*Blend).
        // Use the unperturbed surface normal, as that node has no Normal input.
        .replace('#include <normal_fragment_maps>', `
float c03Facing=1.0-pow(clamp(abs(dot(normal,normalize(vViewPosition))),0.0,1.0),uC03FacingPower);
float c03Rear=unpackRGBAToDepth(texture2D(uC03RearDepth,gl_FragCoord.xy/max(uC03Resolution,vec2(1.0))));
float c03Front=c03ViewDistance(gl_FragCoord.z);
float c03RearDistance=c03ViewDistance(c03Rear);
float c03RayScale=length(vViewPosition)/max(abs(vViewPosition.z),.001);
float c03OpticalThickness=clamp((c03RearDistance-c03Front)*c03RayScale,.018,.38);
float c03HasRear=step(gl_FragCoord.z+.000002,c03Rear);
c03OpticalThickness=mix(.035,c03OpticalThickness,c03HasRear);
float c03ThicknessWeight=smoothstep(.035,.34,c03OpticalThickness);
vec3 c03AngularTint=mix(uC03EdgeColor,uC03FaceColor,clamp((c03Facing-.05)/.83,0.0,1.0));
vec3 c03ThinGlass=vec3(.68,.93,1.0);
diffuseColor.rgb=mix(c03ThinGlass,c03AngularTint,.30+.14*c03ThicknessWeight);
#include <normal_fragment_maps>`)
        .replace('material.thickness = thickness;', 'material.thickness = c03OpticalThickness;')
        // The analytic area lights make the floor much brighter in Three's
        // screen transmission buffer than in the Cycles path result. Compress
        // only that transmitted radiance; the visible floor remains untouched.
        .replace('#include <transmission_fragment>', '#include <transmission_fragment>\ntotalDiffuse=min(totalDiffuse,vec3(1.35));')
        .replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;', `vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
float c03Rim=pow(1.0-clamp(abs(dot(normal,normalize(vViewPosition))),0.0,1.0),2.4);
float c03InnerReflection=c03Rim*(.07+.16*c03ThicknessWeight)*ambientDetail;
outgoingLight+=vec3(.12,.56,.92)*c03InnerReflection;
float c03InternalDensity=(.18+.82*c03Rim)*(.28+.72*c03ThicknessWeight);
outgoingLight=mix(outgoingLight,outgoingLight*vec3(.52,.86,.98),.12*c03InternalDensity*ambientDetail);
outgoingLight*=mix(vec3(1.0),vec3(.34,.68,.86),.12*c03ThicknessWeight*ambientDetail);
float c03NormalDetail=clamp((1.0-dot(normal,nonPerturbedNormal))*26.0,0.0,1.0);
float c03BrightLine=smoothstep(.035,.18,c03NormalDetail)*(1.0-smoothstep(.38,.76,c03NormalDetail));
float c03DarkLine=smoothstep(.40,.88,c03NormalDetail);
outgoingLight+=vec3(1.08,1.05,1.0)*c03BrightLine*(.22+.12*c03Rim)*ambientDetail;
outgoingLight*=mix(vec3(1.0),vec3(.55,.86,1.0),c03DarkLine*.04*ambientDetail);`);
    }
  };
  return material;
}

export function c03BlenderGlassMaterial(source, mask, layered) {
  const data = reference.glass;
  return separateMaterial(new THREE.MeshPhysicalMaterial({
    name: 'C03 Blender cyan transmitting shell',
    color: 0xffffff,
    metalness: 0,
    roughness: data.Roughness,
    transmission: data['Transmission Weight'],
    ior: data.IOR,
    thickness: .035,
    attenuationColor: new THREE.Color(.60,.91,1),
    attenuationDistance: 1.52,
    clearcoat: data['Coat Weight'],
    clearcoatRoughness: data['Coat Roughness'],
    normalMap: source.normalMap ?? null,
    normalScale: new THREE.Vector2(reference.normalStrength,reference.normalStrength),
    side: THREE.DoubleSide,
  }),mask,true,layered);
}

export function c03BlenderCoreMaterial(source, mask) {
  const data = reference.core;
  return separateMaterial(new THREE.MeshPhysicalMaterial({
    name: 'C03 Blender ivory internal tissue',
    color: linearColor(reference.coreTint),
    map: source.map ?? null,
    roughness: data.Roughness,
    ior: data.IOR,
    metalness: 0,
    emissive: new THREE.Color(0xffedcf),
    emissiveIntensity: .028,
    clearcoat: data['Coat Weight'],
    clearcoatRoughness: data['Coat Roughness'],
    normalMap: source.normalMap ?? null,
    normalScale: new THREE.Vector2(reference.normalStrength,reference.normalStrength),
    side: THREE.FrontSide,
  }),mask,false);
}
