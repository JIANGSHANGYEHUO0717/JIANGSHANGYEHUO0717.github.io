import test from "node:test";
import assert from "node:assert/strict";
import { createMirrorState, updateMirrorState, readMirrorPose } from "../src/c01Mirror.js";

const pose = spread => {
  const p = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 1, presence: 1 }));
  p[11].x=.4; p[12].x=.6; p[15].x=.5-spread/2; p[16].x=.5+spread/2;
  return p;
};
const advance = (state, seconds, args={}, hz=60) => {
  for(let i=0;i<Math.round(seconds*hz);i++) updateMirrorState(state,{dt:1/hz,...args});
};
test("wrist opening is scale and mirror invariant; crossed/closed wrists stay closed",()=>{
  assert.equal(readMirrorPose(pose(.12)),0);
  assert.equal(readMirrorPose(pose(.76)),1);
  const mid=pose(.4), reflected=mid.map(p=>({...p,x:1-p.x}));
  const scaled=mid.map(p=>({...p,x:.5+(p.x-.5)*.7}));
  assert.ok(Math.abs(readMirrorPose(mid)-readMirrorPose(reflected))<1e-10);
  assert.ok(Math.abs(readMirrorPose(mid)-readMirrorPose(scaled))<1e-10);
  [mid[15],mid[16]]=[mid[16],mid[15]];
  assert.ok(Math.abs(readMirrorPose(mid)-readMirrorPose(reflected))<1e-10);
});
test("unreliable, missing or clipped landmarks are unknown, never a close gesture",()=>{
  assert.equal(readMirrorPose(null),null);
  const p=pose(.76);p[15].visibility=.2;assert.equal(readMirrorPose(p),null);
  p[15].visibility=1;p[16].x=.995;assert.equal(readMirrorPose(p),null);
  p[16].x=NaN;assert.equal(readMirrorPose(p),null);
});
test("brief tracking loss holds target then safely closes over time",()=>{
  const s=createMirrorState();advance(s,3,{mode:"camera",points:pose(.76)});
  advance(s,.8,{mode:"camera",points:null});assert.ok(s.amount>.99);
  advance(s,2,{mode:"camera",points:null});assert.ok(s.amount>.1&&s.amount<.4);
  advance(s,6,{mode:"camera",points:null});assert.ok(s.amount<.005);
});
test("response is consistent across frame rates",()=>{
  const a=createMirrorState(),b=createMirrorState();
  advance(a,1,{amount:1},30);advance(b,1,{amount:1},120);
  assert.ok(Math.abs(a.amount-b.amount)<1e-10);
});
test("exit overrides all inputs and reaches an exact zero before archive handoff",()=>{
  const s=createMirrorState();advance(s,3,{amount:1});
  updateMirrorState(s,{dt:.016,closing:true,amount:1});assert.ok(s.amount>.8);
  advance(s,2,{closing:true,mode:"camera",points:pose(.76)});assert.equal(s.amount,0);
});
test("pause and reduced motion stop ambient clocks, manual opening stays usable",()=>{
  const s=createMirrorState();advance(s,2,{paused:true,amount:1});
  assert.equal(s.time,0);assert.ok(s.amount>.99);
  advance(s,2,{reduced:true,amount:0});assert.equal(s.time,0);
  advance(s,1,{mode:"demo",paused:true});assert.equal(s.demoTime,0);
});
