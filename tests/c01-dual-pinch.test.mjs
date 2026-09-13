import test from "node:test";
import assert from "node:assert/strict";
import { createDualPinchState, updateDualPinchState } from "../src/c01DualPinch.js";

const hand=(x,pinched)=>{
  const points=Array.from({length:21},()=>({x,y:.5,z:0}));
  points[0]={x,y:.58};points[9]={x,y:.5};points[5]={x:x-.05,y:.52};points[17]={x:x+.05,y:.52};
  const gap=pinched ? .012 : .066;
  points[4]={x:x-gap/2,y:.46};points[8]={x:x+gap/2,y:.46};
  return points;
};
const frame=(leftX,rightX,leftPinched=true,rightPinched=true)=>({
  landmarks:[hand(leftX,leftPinched),hand(rightX,rightPinched)],
  handedness:[[{categoryName:"Left"}],[{categoryName:"Right"}]],gestures:[[],[]],
});

test("two central pinches arm, pulling maps to charge, and synchronized opening releases",()=>{
  let state=createDualPinchState();
  state=updateDualPinchState(state,frame(.47,.53),0,.2);assert.equal(state.stage,"arming");
  state=updateDualPinchState(state,frame(.47,.53),220,.2);assert.equal(state.stage,"pulling");
  state=updateDualPinchState(state,frame(.34,.66),340,.2);assert.ok(state.charge>.9);
  state=updateDualPinchState(state,frame(.34,.66,false,true),430,.2);
  assert.equal(state.stage,"pulling");assert.match(state.detail,/另一只手/);
  state=updateDualPinchState(state,frame(.34,.66,false,false),590,.2);
  assert.equal(state.stage,"released");assert.equal(state.releaseToken,1);assert.ok(state.releaseStrength>.9);
});

test("opening before a meaningful pull cancels without a release token",()=>{
  let state=createDualPinchState();
  state=updateDualPinchState(state,frame(.47,.53),0,.2);
  state=updateDualPinchState(state,frame(.47,.53),220,.2);
  state=updateDualPinchState(state,frame(.45,.55),320,.2);
  state=updateDualPinchState(state,frame(.45,.55,false,false),410,.2);
  assert.equal(state.stage,"idle");assert.equal(state.releaseToken,0);assert.match(state.detail,/距离不足/);
});

test("brief occlusion holds the pull but a longer loss cancels it",()=>{
  let state=createDualPinchState();
  state=updateDualPinchState(state,frame(.47,.53),0,.2);
  state=updateDualPinchState(state,frame(.47,.53),220,.2);
  state=updateDualPinchState(state,frame(.38,.62),320,.2);
  const oneHand={landmarks:[hand(.38,true)],handedness:[[{categoryName:"Left"}]],gestures:[[]]};
  state=updateDualPinchState(state,oneHand,430,.2);assert.equal(state.stage,"pulling");assert.equal(state.handsVisible,false);
  state=updateDualPinchState(state,oneHand,700,.2);assert.equal(state.stage,"idle");assert.equal(state.releaseToken,0);
});
