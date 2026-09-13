import test from "node:test";
import assert from "node:assert/strict";
import {
  createC01InteractionArbitration,
  createC03InteractionArbitration,
  updateC01InteractionArbitration,
  updateC03InteractionArbitration,
} from "../src/interactionArbitration.js";

test("C01 pinch owns the interaction until release visuals and cooldown finish", () => {
  const state=createC01InteractionArbitration();
  assert.equal(updateC01InteractionArbitration(state,{dt:.016,pinchStage:"idle"}).owner,"mirror");
  assert.equal(updateC01InteractionArbitration(state,{dt:.016,pinchStage:"arming"}).owner,"cavity");
  for(let i=0;i<10;i++)updateC01InteractionArbitration(state,{dt:.1,pinchStage:"idle",cavityReleaseActive:true});
  assert.equal(state.owner,"cavity");
  updateC01InteractionArbitration(state,{dt:.59,pinchStage:"idle"});
  assert.equal(state.owner,"cavity");
  updateC01InteractionArbitration(state,{dt:.02,pinchStage:"idle"});
  assert.equal(state.owner,"mirror");
});

test("C03 blocks only the right-wrist dispersal channel during capture and cooldown", () => {
  const state=createC03InteractionArbitration();
  let result=updateC03InteractionArbitration(state,{dt:.016,rightHandStage:"armed"});
  assert.equal(result.captureActive,true);
  assert.equal(result.blockRightWrist,true);
  result=updateC03InteractionArbitration(state,{dt:.69,rightHandStage:"spent"});
  assert.equal(result.blockRightWrist,true);
  result=updateC03InteractionArbitration(state,{dt:.02,rightHandStage:"spent"});
  assert.equal(result.captureActive,false);
  assert.equal(result.blockRightWrist,false);
});

test("C03 capture release keeps ownership even after the hand state leaves release", () => {
  const state=createC03InteractionArbitration();
  const result=updateC03InteractionArbitration(state,{dt:.3,rightHandStage:"spent",captureReleaseActive:true});
  assert.equal(result.captureActive,true);
  assert.equal(result.cooldown,.7);
});

test("C03 capture demo receives the same temporary ownership as a real release", () => {
  const state=createC03InteractionArbitration();
  updateC03InteractionArbitration(state,{captureDemo:0});
  const result=updateC03InteractionArbitration(state,{dt:.016,captureDemo:1});
  assert.equal(result.captureActive,true);
  assert.equal(result.blockRightWrist,true);
});
