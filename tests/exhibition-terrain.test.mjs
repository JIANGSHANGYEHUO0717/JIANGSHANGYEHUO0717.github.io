import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dramaticLighting } from '../src/exhibition/lighting.js';
import { SETTINGS, hash, heightAt, edgeAt, buildHeightField, sampleHeight, generateTerrain, generateDepth, advanceAngle } from '../src/exhibition/terrain.js';

test('height and sampling are deterministic, finite and non-flat', () => {
  const field = buildHeightField(49);
  assert.deepEqual(field.values, buildHeightField(49).values);
  assert.ok(Math.max(...field.values)-Math.min(...field.values)>1);
  for(let row=0;row<48;row++) for(let col=0;col<48;col++) {
    const x=(col/48-.5)*field.width, z=(row/48-.5)*field.depth;
    assert.ok(Math.abs(sampleHeight(field,x,z)-field.values[row*49+col])<1e-5);
    assert.ok(Number.isFinite(heightAt(x,z)));
  }
});

test('terrain fades to black without a rectangular perimeter', () => {
  assert.equal(edgeAt(0,0),1);
  assert.equal(edgeAt(SETTINGS.radiusX*1.1,0),0);
  assert.equal(edgeAt(0,SETTINGS.radiusZ*1.1),0);
  assert.ok(edgeAt(SETTINGS.radiusX*.85,0)>0 && edgeAt(SETTINGS.radiusX*.85,0)<1);
});

test('selected option 2 keeps the center open and five unequal peripheral mounds', () => {
  assert.ok(heightAt(0,0)<.15);
  assert.ok(heightAt(-6.1,-4.2)>1.6);
  assert.ok(heightAt(7,-3.8)>.85);
  assert.ok(heightAt(9,-2)>.55);
  assert.ok(heightAt(-8.5,3.4)>.40);
  assert.ok(heightAt(5.2,5.3)>.65);
  assert.ok(heightAt(-6.1,-4.2)>heightAt(5.2,5.3)*1.7);
  assert.ok(heightAt(0,2)<.15);
});

test('point attributes are finite, bounded and sit above the depth surface', () => {
  const field=buildHeightField(49), points=generateTerrain(field,80,70);
  const n=points.opacity.length;
  assert.ok(n>1000 && n<80*70);
  assert.equal(points.positions.length,n*3);
  assert.equal(points.colors.length,n*3);
  assert.equal(points.dramaticColors.length,n*3);
  assert.equal(points.dramaticOpacity.length,n);
  assert.equal(points.grains.length,n);
  for(let i=0;i<n;i++) {
    const [x,y,z]=points.positions.slice(i*3,i*3+3);
    assert.ok(Math.abs(y-sampleHeight(field,x,z)-.008)<1e-5);
    assert.ok(points.opacity[i]>=0 && points.opacity[i]<=1);
    assert.ok(points.dramaticOpacity[i]>=0 && points.dramaticOpacity[i]<=1);
  }
  for(const a of Object.values(points)) for(const v of a) assert.ok(Number.isFinite(v));
  for(const v of points.colors) assert.ok(v>=0 && v<=1);
  for(const v of points.dramaticColors) assert.ok(v>=0 && v<=1);
  assert.deepEqual(points,generateTerrain(field,80,70));
});

test('lighting change preserves the approved full geometry and original appearance buffers', () => {
  const field=buildHeightField(), points=generateTerrain(field);
  const digest=values=>createHash('sha256').update(new Uint8Array(values.buffer,values.byteOffset,values.byteLength)).digest('hex');
  // Baselines captured before the lighting-only iteration, 2026-08-30.
  assert.equal(points.opacity.length,111636);
  assert.equal(digest(field.values),'031edfc43702d094b70ce3f7d6799b0e367f2d2ccc89f4dc6a15229b6934a0ed');
  assert.equal(digest(points.positions),'d1faa26aef40fdae135f7f4354c5cd18a27886b2c7e2e55a302fb82e8abc8db6');
  assert.equal(digest(points.colors),'70aebe4279559c2de4784e7a4c808f86682c615b57c13d06de65ea2073be550d');
  assert.equal(digest(points.opacity),'1a2f578ca93b46b737be1f24bd6ae2f3e895e73adedb2203e518315212cbf47a');
  assert.notEqual(digest(points.dramaticOpacity),digest(points.opacity));
});

test('low side light produces real height-based shadows with a readable fill', () => {
  const clear=dramaticLighting(()=>0,0,0,0,0,1,0);
  const blocked=dramaticLighting((x,z)=>x<-.5 && z<-.3 ? 2 : 0,0,0,0,0,1,0);
  assert.equal(clear.visibility,1);
  assert.equal(blocked.visibility,0);
  assert.ok(blocked.intensity>0);
  assert.ok(clear.intensity>blocked.intensity*3);
  assert.ok(clear.warmth>blocked.warmth);
  for(const light of [clear,blocked]) for(const v of Object.values(light)) assert.ok(v>=0 && v<=1);
});

test('occlusion triangles are valid and face upward', () => {
  const field=buildHeightField(49), depth=generateDepth(field);
  assert.equal(depth.indices.length%3,0);
  for(let i=0;i<depth.indices.length;i+=3) {
    const [a,b,c]=depth.indices.slice(i,i+3);
    for(const v of [a,b,c]) assert.ok(v>=0 && v<49*49);
    const p=depth.positions;
    const upward=(p[b*3+2]-p[a*3+2])*(p[c*3]-p[a*3])-(p[b*3]-p[a*3])*(p[c*3+2]-p[a*3+2]);
    assert.ok(upward>0);
  }
});

test('clockwise rotation completes in 180 seconds; resumed tabs cannot jump', () => {
  let angle=0;
  for(let i=0;i<180*60;i++) angle=advanceAngle(angle,1/60);
  assert.ok(Math.abs(angle+Math.PI*2)<1e-9);
  assert.ok(advanceAngle(0,1/60)<0);
  assert.equal(advanceAngle(0,-1),0);
  assert.equal(advanceAngle(0,100),advanceAngle(0,.05));
  assert.equal(hash(4,8),hash(4,8));
});
