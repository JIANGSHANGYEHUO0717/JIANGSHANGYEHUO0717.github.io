import test from "node:test";
import assert from "node:assert/strict";
import { Object3D, PerspectiveCamera, Scene } from "three";
import { CAVITY_EDGE_REFLECTIONS, CAVITY_RELEASE_DURATION, CAVITY_SOURCE_COUNT, CAVITY_WAVE_DELAYS, createCavityState, releaseCavity, updateCavityState } from "../src/c01CavityState.js";
import { createCavityRenderer } from "../src/c01CavityRenderer.js";
import { CAVITY_AUDIO_ASSETS, cavityAudioMapping } from "../src/c01CavityAudio.js";

const advance=(state,seconds,options={},hz=60)=>{
  for(let i=0;i<Math.round(seconds*hz);i++) updateCavityState(state,{dt:1/hz,active:true,...options});
  return state;
};
test("automatic study charges once, releases and loops consistently across frame rates",()=>{
  for(const hz of [30,60,120]) {
    const state=createCavityState();advance(state,4.6,{mode:"demo"},hz);
    assert.ok(state.charge>.88);assert.equal(state.releaseAge,-1);
    advance(state,.35,{mode:"demo"},hz);
    assert.ok(state.release>0);assert.ok(state.charge<.6);assert.equal(state.demoFired,true);
    advance(state,4,{mode:"demo"},hz);assert.equal(state.demoFired,false);
  }
});

test("manual release consumes the stored charge and cannot double-trigger",()=>{
  const state=createCavityState();advance(state,2,{mode:"manual",charge:.8});
  assert.ok(state.charge>.79);assert.equal(releaseCavity(state),true);
  assert.equal(releaseCavity(state),false);assert.equal(state.charge,0);
  advance(state,.2,{mode:"manual",charge:0});assert.ok(state.release>.5);
});

test("dual pinch pulling charges and a synchronized release token fires once",()=>{
  const state=createCavityState();
  const pulling={stage:"pulling",charge:.72,releaseStrength:0,releaseToken:0,handsVisible:true};
  advance(state,.8,{mode:"camera",pinch:pulling});
  assert.ok(state.targetCharge>.7);assert.ok(state.charge>.55);assert.equal(state.audioGate,true);
  const released={stage:"released",charge:0,releaseStrength:.72,releaseToken:1,handsVisible:true};
  advance(state,1/60,{mode:"camera",pinch:released});
  assert.ok(state.releaseAge>=0);assert.equal(state.audioGate,true);assert.equal(state.pinchReleaseToken,1);
  const firstAge=state.releaseAge;advance(state,.2,{mode:"camera",pinch:released});
  assert.ok(state.releaseAge>firstAge);assert.equal(state.pinchReleaseToken,1);
});

test("camera idle, arming and cancelled pinches keep interactive audio gated off",()=>{
  const state=createCavityState();
  for(const stage of ["idle","arming"]){
    advance(state,.3,{mode:"camera",pinch:{stage,charge:0,releaseToken:0,handsVisible:stage==="arming"}});
    assert.equal(state.audioGate,false);assert.equal(state.releaseAge,-1);assert.equal(state.targetCharge,0);
  }
  advance(state,.5,{mode:"camera",pinch:{stage:"pulling",charge:.55,releaseToken:0,handsVisible:true}});
  assert.equal(state.audioGate,true);assert.ok(state.charge>.3);
  advance(state,.4,{mode:"camera",pinch:{stage:"idle",charge:0,releaseToken:0,handsVisible:true}});
  assert.equal(state.audioGate,false);assert.equal(state.releaseAge,-1);assert.equal(state.targetCharge,0);
});

test("pause freezes the interaction while exit closes and resets it",()=>{
  const state=createCavityState();advance(state,2,{mode:"manual",charge:.8});
  const frozen=structuredClone(state);advance(state,2,{mode:"demo",paused:true});assert.deepEqual(state,frozen);
  for(let i=0;i<180;i++) updateCavityState(state,{dt:1/60,active:false,paused:true});
  assert.equal(state.mix,0);assert.equal(state.charge,0);assert.equal(state.release,0);assert.equal(state.time,0);
});

test("release uses three staggered single-color water waves instead of historical frames",()=>{
  assert.deepEqual(CAVITY_WAVE_DELAYS,[0,.18,.36]);
  assert.equal(CAVITY_EDGE_REFLECTIONS,4);assert.ok(CAVITY_RELEASE_DURATION>=3);
  const state=createCavityState();state.mix=1;state.charge=.9;
  assert.equal(releaseCavity(state),true);
  advance(state,.4,{mode:"manual",charge:0});
  assert.ok(state.releaseAge>.36);assert.ok(state.release>0);
});

test("a charging cycle chooses one different safe source and keeps it through release",()=>{
  const state=createCavityState(),originalRandom=Math.random;Math.random=()=>.999;
  try {
    advance(state,.2,{mode:"manual",charge:.8});
    assert.equal(state.sourceIndex,CAVITY_SOURCE_COUNT-1);assert.equal(state.sourceLocked,true);
    const chosen=state.sourceIndex;advance(state,1,{mode:"manual",charge:.8});assert.equal(state.sourceIndex,chosen);
    releaseCavity(state);advance(state,1,{mode:"manual",charge:0});assert.equal(state.sourceIndex,chosen);
  } finally {Math.random=originalRandom;}
});

test("renderer measures depth during charge and releases screen-space water waves without history renders",()=>{
  const cavity=createCavityRenderer(),object=new Object3D(),scene=new Scene(),draws=[];
  scene.add(object);object.add(cavity.core);
  const camera=new PerspectiveCamera(40,16/9,.01,100);camera.position.z=5;camera.updateMatrixWorld();camera.updateProjectionMatrix();
  let target=null;
  const renderer={getDrawingBufferSize:v=>v.set(2560,1440),getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},clear:()=>{},render:s=>draws.push({side:s.overrideMaterial.side,width:target.width,height:target.height})};
  const state={mix:1,charge:.7,release:0,releaseAge:-1,releaseStrength:0,time:2,sourceIndex:0};
  cavity.update(renderer,scene,camera,object,state);
  assert.equal(draws.length,2);assert.ok(draws.every(draw=>draw.width===960&&draw.height===540));
  assert.notEqual(draws[0].side,draws[1].side);assert.equal(scene.overrideMaterial,null);assert.equal(target,null);
  assert.equal(cavity.core.visible,true);assert.equal(cavity.pass.uniforms.uHasDepth.value,1);
  assert.ok(cavity.pass.uniforms.uCoreUv.value.x<.5);assert.ok(cavity.pass.uniforms.uCoreUv.value.y>.5);
  draws.length=0;state.charge=0;state.release=.8;state.releaseAge=.7;state.releaseStrength=.7;
  cavity.update(renderer,scene,camera,object,state);
  assert.equal(draws.length,0);assert.equal(cavity.pass.uniforms.uReleaseAge.value,.7);assert.equal(cavity.core.visible,false);
  assert.match(cavity.pass.material.fragmentShader,/waterWaveWithEdges/);
  cavity.dispose();
});

test("depth measurement restores scene, target and core after a render failure",()=>{
  const cavity=createCavityRenderer(),object=new Object3D(),scene=new Scene(),previous={name:"live"};
  scene.add(object);object.add(cavity.core);scene.overrideMaterial={name:"previous"};
  const camera=new PerspectiveCamera(40,1,.01,100);camera.position.z=5;camera.updateMatrixWorld();camera.updateProjectionMatrix();
  let target=previous,draws=0;
  const renderer={getDrawingBufferSize:v=>v.set(800,800),getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},clear:()=>{},render:()=>{if(++draws===2)throw new Error("test failure");}};
  assert.throws(()=>cavity.update(renderer,scene,camera,object,{mix:1,charge:.8,release:0,releaseAge:-1,releaseStrength:0,time:1,sourceIndex:0}));
  assert.deepEqual(scene.overrideMaterial,{name:"previous"});assert.equal(target,previous);assert.equal(cavity.core.visible,true);
  cavity.dispose();
});

test("audio contains only the four stages explicitly requested by the user",()=>{
  assert.deepEqual(Object.keys(CAVITY_AUDIO_ASSETS),[
    "spaceBed","chargeRise","releaseHit","releaseTail"
  ]);
  assert.ok(Object.values(CAVITY_AUDIO_ASSETS).every(path=>path.startsWith("audio/c01-experimental/")&&path.endsWith(".ogg")));
});

test("audio mapping follows charge, movement, source position and wave expansion without adding voices",()=>{
  const quiet=cavityAudioMapping({charge:.1,release:0,releaseAge:-1,releaseStrength:0,time:1,drive:0},{x:.25},.05);
  const active=cavityAudioMapping({charge:.9,release:0,releaseAge:-1,releaseStrength:0,time:1,drive:.7},{x:.25},.9);
  assert.ok(active.chargeGain>quiet.chargeGain);assert.ok(active.chargeRate>quiet.chargeRate);
  assert.ok(active.chargeCutoff>quiet.chargeCutoff);assert.ok(active.bedCutoff>quiet.bedCutoff);
  const near=cavityAudioMapping({charge:0,release:.8,releaseAge:.1,releaseStrength:.8,time:2,drive:0},{x:.2},0);
  const far=cavityAudioMapping({charge:0,release:.2,releaseAge:2.8,releaseStrength:.8,time:4.7,drive:0},{x:.2},0);
  assert.ok(near.tailGain>far.tailGain);assert.ok(Math.abs(near.tailPan)>Math.abs(far.tailPan));
  assert.ok(near.tailCutoff>far.tailCutoff);assert.equal(Object.keys(CAVITY_AUDIO_ASSETS).length,4);
  const gated=cavityAudioMapping({charge:1,release:0,releaseAge:-1,releaseStrength:0,time:0,drive:1,audioGate:false},{x:.2},1);
  assert.equal(gated.chargeGain,.018);assert.equal(gated.bedCutoff,1150);assert.equal(gated.bedGain,.4);
});
