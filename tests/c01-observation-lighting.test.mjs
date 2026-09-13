import test from "node:test";
import assert from "node:assert/strict";
import { HemisphereLight, RectAreaLight, DirectionalLight, PointLight } from "three";
import { createC01ObservationLighting, C01_LIGHTING_RIGS } from "../src/c01ObservationLighting.js";
import { createMirrorLighting } from "../src/c01Mirror.js";

function fixture() {
  const lights={ambient:new HemisphereLight(0x718184,0,.075),key:new RectAreaLight(0xe7ece7,3.5,4.8,5.8),front:new RectAreaLight(0x93bbc1,.75,3.4,4.6),rim:new RectAreaLight(0xf2f3ed,8.2,5.8,4.3),side:new DirectionalLight(0xc7dedd,1.65),low:new PointLight(0x3e929e,.72,9.5,2)};
  lights.key.position.set(-3.3,3.6,4.5);lights.front.position.set(3.6,.15,4.8);lights.rim.position.set(.9,4.8,-3.6);
  return {lights,study:createC01ObservationLighting(lights)};
}
const snapshot = lights => Object.values(lights).map(l=>[...l.color.toArray(),l.intensity,...l.position.toArray(),...l.quaternion.toArray(),l.width,l.height]);

test("the first C01 entry frame already uses the approved observation rig",()=>{
  const {lights,study}=fixture(), original=snapshot(lights);
  study.reset();study.update("amber",1,0);
  assert.notDeepEqual(snapshot(lights),original);
  assert.equal(lights.key.intensity,C01_LIGHTING_RIGS.amber.key.intensity);
  assert.equal(lights.rim.intensity,C01_LIGHTING_RIGS.amber.rim.intensity);
});

test("archive transition can still bypass amber and restore the original light rig",()=>{
  const {lights,study}=fixture(), original=snapshot(lights);
  for(const id of ["amber"]) {
    for(let i=0;i<180;i++){study.reset();study.update(id,1,1/60);}
    assert.notDeepEqual(snapshot(lights),original);
    study.reset();study.update(id,0,1/60);
    assert.deepEqual(snapshot(lights),original);
  }
});

function amberFixture() {
  const {lights,study}=fixture();
  for(let i=0;i<360;i++){study.reset();study.update("amber",1,1/60);}
  const move=createMirrorLighting(C01_LIGHTING_RIGS.amber);
  const frame=(amount,time)=>{
    study.reset();study.update("amber",1,0);
    move(lights.front,lights.rim,lights.low,amount,time);
    return snapshot(lights);
  };
  return {lights,frame};
}

test("full mirror keeps the amber rig and warm rim while the lights move",()=>{
  const {lights,frame}=amberFixture();
  const base=frame(0,0);
  for(const time of [0,17,43,89,180]) {
    const active=frame(1,time);
    assert.notDeepEqual(active,base);
    // Ambient, key and disabled side light are still the chosen amber rig.
    for(const index of [0,1,4]) assert.deepEqual(active[index],base[index]);
    assert.equal(lights.rim.width,base[3][11]);
    assert.equal(lights.rim.height,base[3][12]);
    assert.ok(lights.rim.color.r > lights.rim.color.g && lights.rim.color.g > lights.rim.color.b);
    assert.ok(lights.rim.intensity>15 && lights.rim.intensity<26);
  }
});

test("pausing is stable without accumulated motion and disabling light motion restores exact amber",()=>{
  const {frame}=amberFixture();
  const base=frame(0,0), paused=frame(1,27);
  for(let i=0;i<120;i++) assert.deepEqual(frame(1,27),paused);
  assert.notDeepEqual(frame(1,45),paused);
  assert.deepEqual(frame(0,45),base);
  assert.deepEqual(frame(0,120),base);
  for(const amount of [1,.8,.5,.1,.001,0]) {
    for(const light of frame(amount,60)) {
      assert.ok(light.filter(x=>x!==undefined).every(Number.isFinite));
      assert.ok(light[3]>=0);
    }
  }
});
test("switching back to q5 converges without accumulating study colors",()=>{
  const {lights,study}=fixture(), original=snapshot(lights);
  for(let i=0;i<180;i++){study.reset();study.update("amber",1,1/60);}
  for(let i=0;i<240;i++){study.reset();study.update("q5",1,1/60);}
  assert.deepEqual(snapshot(lights),original);
});
test("all transitions retain finite colors, nonnegative power and usable emitters",()=>{
  const {lights,study}=fixture();
  for(const id of ["amber","q5"]) {
    for(let i=0;i<100;i++){
      study.reset();study.update(id,1,1/60);
      for(const light of Object.values(lights)) {
        assert.ok(Number.isFinite(light.intensity)&&light.intensity>=0);
        assert.ok([...light.color.toArray(),...light.position.toArray()].every(Number.isFinite));
        if(light.isRectAreaLight) assert.ok(light.width>0&&light.height>0);
      }
    }
  }
});
