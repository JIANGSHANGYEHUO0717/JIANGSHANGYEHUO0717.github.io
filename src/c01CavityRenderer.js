import {
  BackSide, FrontSide, MeshDepthMaterial, Object3D, RGBADepthPacking,
  Vector2, Vector3, WebGLRenderTarget,
} from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { CAVITY_SOURCE_COUNT, CAVITY_WAVE_DELAYS } from "./c01CavityState.js";

const MAX_DEPTH_SIZE = 960;
const SOURCE_ANCHORS = [
  [-.34,.62,.12], [.34,.60,.10], [-.48,.88,.06], [.46,.84,.05],
];
if (SOURCE_ANCHORS.length !== CAVITY_SOURCE_COUNT) throw new Error("C01 cavity source count mismatch");

function createInternalCore() {
  const core = new Object3D();
  core.position.set(...SOURCE_ANCHORS[0]);
  return core;
}

export function createCavityRenderer() {
  let frontDepth = null, backDepth = null;
  const size = new Vector2(), texel = new Vector2();
  const coreUv = new Vector2(.5, .44);
  const worldPoint = new Vector3();
  const frontMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: FrontSide });
  const backMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: BackSide });
  const core = createInternalCore();
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, tFrontDepth: { value: null }, tBackDepth: { value: null },
      uMix: { value: 0 }, uCharge: { value: 0 }, uRelease: { value: 0 }, uReleaseAge: { value: -1 }, uTime: { value: 0 },
      uAspect: { value: 1 }, uTexel: { value: texel }, uCoreUv: { value: coreUv },
      uNear: { value: .01 }, uFar: { value: 100 },
      uHasDepth: { value: 0 },
    },
    vertexShader: "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader: `
      uniform sampler2D tDiffuse,tFrontDepth,tBackDepth;
      uniform float uMix,uCharge,uRelease,uReleaseAge,uTime,uAspect,uNear,uFar,uHasDepth;
      uniform vec2 uTexel,uCoreUv;
      varying vec2 vUv;
      const float UnpackDownscale=255./256.;
      const vec4 UnpackFactors4=vec4(UnpackDownscale,UnpackDownscale/256.,UnpackDownscale/65536.,1./16777216.);
      float unpackDepth(vec4 value){return dot(value,UnpackFactors4);}
      float viewZ(float depth){return (uNear*uFar)/((uFar-uNear)*depth-uFar);}
      vec4 bounded(vec2 uv) {
        float inside=step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
        return texture2D(tDiffuse,clamp(uv,0.,1.))*inside;
      }
      void waterWave(float age,float amplitude,vec2 delta,inout vec2 displacement,inout float halo,inout float lightWave) {
        if(age<0. || age>3.08) return;
        float radius=.035+age*.54;
        float distanceToWave=length(delta)-radius;
        float fade=amplitude*smoothstep(0.,.10,age)*(1.-smoothstep(2.20,3.08,age));
        float band=(exp(-abs(distanceToWave)*22.)
          +.38*exp(-abs(distanceToWave+.065)*17.)
          +.16*exp(-abs(distanceToWave+.125)*13.))*fade;
        float wake=sin(distanceToWave*34.)*exp(-abs(distanceToWave)*11.5)*fade;
        vec2 direction=normalize(delta+vec2(.00001));
        displacement+=direction*wake*.0102;
        halo+=band;
        lightWave+=wake;
      }
      void waterWaveWithEdges(float age,float amplitude,inout vec2 displacement,inout float halo,inout float lightWave) {
        vec2 scale=vec2(uAspect,1.);
        waterWave(age,amplitude,(vUv-uCoreUv)*scale,displacement,halo,lightWave);
        float reflected=amplitude*.42;
        waterWave(age,reflected,(vUv-vec2(-uCoreUv.x,uCoreUv.y))*scale,displacement,halo,lightWave);
        waterWave(age,reflected,(vUv-vec2(2.-uCoreUv.x,uCoreUv.y))*scale,displacement,halo,lightWave);
        waterWave(age,reflected,(vUv-vec2(uCoreUv.x,-uCoreUv.y))*scale,displacement,halo,lightWave);
        waterWave(age,reflected,(vUv-vec2(uCoreUv.x,2.-uCoreUv.y))*scale,displacement,halo,lightWave);
      }
      void main() {
        vec2 displacement=vec2(0.);
        float waveHalo=0.,lightWave=0.;
        waterWaveWithEdges(uReleaseAge-${CAVITY_WAVE_DELAYS[0].toFixed(2)},1.,displacement,waveHalo,lightWave);
        waterWaveWithEdges(uReleaseAge-${CAVITY_WAVE_DELAYS[1].toFixed(2)},.72,displacement,waveHalo,lightWave);
        waterWaveWithEdges(uReleaseAge-${CAVITY_WAVE_DELAYS[2].toFixed(2)},.50,displacement,waveHalo,lightWave);
        vec2 sampleUv=vUv-vec2(displacement.x/max(uAspect,.001),displacement.y)*uRelease*uMix;
        vec4 live=bounded(sampleUv);
        float front=unpackDepth(texture2D(tFrontDepth,vUv));
        float back=unpackDepth(texture2D(tBackDepth,vUv));
        float valid=uHasDepth*step(.00001,front)*step(.00001,back)*step(front,back);
        float thickness=abs(viewZ(back)-viewZ(front));
        float thin=1.-smoothstep(.018,.29,thickness);
        thin=mix(0.,thin,valid);

        vec2 coreDelta=(vUv-uCoreUv)*vec2(uAspect,1.);
        float distanceFromCore=length(coreDelta);
        float radius=mix(.055,.94,smoothstep(0.,1.,uCharge));
        float spread=1.-smoothstep(radius-.12,radius+.10,distanceFromCore);
        float angle=atan(coreDelta.y,coreDelta.x);
        float broadRays=pow(.5+.5*sin(angle*13.+sin(angle*5.)*1.7+uTime*.08),1.55);
        float fineRays=pow(.5+.5*sin(angle*29.-sin(angle*7.)*1.2-uTime*.055),2.7);
        float rayField=(.18+.55*broadRays+.27*fineRays)*exp(-distanceFromCore*1.58);
        float sourceCore=exp(-distanceFromCore*distanceFromCore*620.);
        float innerHalo=exp(-distanceFromCore*distanceFromCore*55.);
        float frontGlow=exp(-pow((distanceFromCore-radius)/.105,2.));
        float spectral=.5+.5*sin(angle*11.+distanceFromCore*21.);
        vec3 rayTint=mix(vec3(1.,.70,.34),vec3(.62,.84,1.),spectral*.34);
        vec3 sourceTint=vec3(1.,.91,.69);
        vec3 color=live.rgb;
        float bodyLight=(sourceCore*.68+innerHalo*.31+rayField*.24+thin*(.10+.12*frontGlow))*spread;
        color+=(sourceTint*(sourceCore*.60+innerHalo*.18)+rayTint*bodyLight)*uCharge*uMix*live.a;
        vec3 auraTint=mix(sourceTint,rayTint,.46);
        float externalGlow=(innerHalo*.13+rayField*.028)*spread*(1.-smoothstep(.01,.30,live.a));
        color+=auraTint*externalGlow*uCharge*uMix;

        float waveStrength=uRelease*uMix;
        vec3 rippleTint=vec3(1.,.86,.70);
        float contact=.13+live.a*.28;
        color=color*(1.+lightWave*waveStrength*.12)+rippleTint*waveHalo*waveStrength*contact*.78;
        float alpha=max(live.a,waveHalo*waveStrength*.075);
        gl_FragColor=vec4(color,alpha);
      }
    `,
  });
  pass.enabled = false;
  const shaderCoreUv=pass.uniforms.uCoreUv.value;

  const ensureTargets = (width, height) => {
    if (!frontDepth) {
      frontDepth = new WebGLRenderTarget(width, height, { depthBuffer: true });
      backDepth = new WebGLRenderTarget(width, height, { depthBuffer: true });
      pass.uniforms.tFrontDepth.value = frontDepth.texture;
      pass.uniforms.tBackDepth.value = backDepth.texture;
    }
    if (frontDepth.width !== width || frontDepth.height !== height) {
      frontDepth.setSize(width, height); backDepth.setSize(width, height);
    }
  };

  return {
    pass,
    core,
    update(renderer, scene, camera, specimen, state) {
      pass.enabled = state.mix > .0005;
      pass.uniforms.uMix.value = state.mix;
      const releaseFlash = state.releaseAge < 0 ? 0 : Math.max(0, 1-state.releaseAge/.38)*state.releaseStrength;
      const sourceLevel = Math.max(state.charge, releaseFlash*.56);
      pass.uniforms.uCharge.value = sourceLevel;
      pass.uniforms.uRelease.value = state.release*state.mix;
      pass.uniforms.uReleaseAge.value = state.releaseAge;
      pass.uniforms.uTime.value = state.time;
      pass.uniforms.uAspect.value = camera.aspect;
      pass.uniforms.uNear.value = camera.near;
      pass.uniforms.uFar.value = camera.far;
      renderer.getDrawingBufferSize(size);
      pass.uniforms.uTexel.value.set(1/Math.max(1,size.x),1/Math.max(1,size.y));

      const anchor=SOURCE_ANCHORS[state.sourceIndex%CAVITY_SOURCE_COUNT]??SOURCE_ANCHORS[0];
      core.position.set(...anchor);
      core.visible = pass.enabled && sourceLevel > .004;
      specimen.updateMatrixWorld(true);
      core.getWorldPosition(worldPoint).project(camera);
      shaderCoreUv.set(worldPoint.x*.5+.5,worldPoint.y*.5+.5);

      const needsDepth = pass.enabled && sourceLevel > .004;
      if (!needsDepth) { pass.uniforms.uHasDepth.value = frontDepth ? 1 : 0; return; }
      const factor=Math.min(1,MAX_DEPTH_SIZE/Math.max(size.x,size.y));
      const width=Math.max(1,Math.round(size.x*factor)),height=Math.max(1,Math.round(size.y*factor));
      ensureTargets(width,height);
      const previousTarget=renderer.getRenderTarget();
      const previousOverride=scene.overrideMaterial;
      const desiredCoreVisibility=core.visible;
      try {
        core.visible=false;
        scene.overrideMaterial=frontMaterial;
        renderer.setRenderTarget(frontDepth);renderer.clear();renderer.render(scene,camera);
        scene.overrideMaterial=backMaterial;
        renderer.setRenderTarget(backDepth);renderer.clear();renderer.render(scene,camera);
        pass.uniforms.uHasDepth.value=1;
      } finally {
        scene.overrideMaterial=previousOverride;
        renderer.setRenderTarget(previousTarget);
        core.visible=desiredCoreVisibility;
      }
    },
    dispose() {
      frontDepth?.dispose();backDepth?.dispose();
      frontMaterial.dispose();backMaterial.dispose();pass.dispose();
    },
  };
}
