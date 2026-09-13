import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createHandGestureState, updateHandGesture, handGestureLabel } from "../src/handGesture.js";
import { createHandEscapeState, advanceHandEscape } from "../src/c04HandState.js";
import { createEscapeSystem } from "../src/c04Escape.js";
import { computeSignal, INITIAL_SIGNAL, makeDemoPose } from "../src/signal.js";
import { emissionPhaseWindow } from "../src/c04Dissolve.js";

function detection(name, hand = "Right", score = .96, x = .5) {
  return { gestures: [[{ categoryName: name, score }]], handedness: [[{ categoryName: hand }]],
    landmarks: [Array.from({ length: 21 }, (_, i) => ({ x, y: .6 - i * .009, z: 0 }))] };
}
function runState(state, command, seconds, particles = 0, fps = 60) {
  for (let i = 0; i < Math.round(seconds * fps); i++) state = advanceHandEscape(state, command, 1 / fps, particles);
  return state;
}
function fixture() {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(.8, 12, 8));
  mesh.geometry.computeBoundingBox(); mesh.updateMatrixWorld(true);
  const count = mesh.geometry.attributes.position.count;
  return { mesh, indices: Array.from({ length: count }, (_, i) => i), phases: Array(count).fill(0) };
}

test("recognition requires a stable gesture; ambiguity and second hands cannot trigger a reversal", () => {
  let hand = createHandGestureState();
  hand = updateHandGesture(hand, detection("Open_Palm"), 0);
  assert.equal(hand.command, "hold");
  hand = updateHandGesture(hand, detection("Open_Palm"), 200);
  assert.equal(hand.command, "open");
  hand = updateHandGesture(hand, detection("Closed_Fist", "Left", .99, .1), 300);
  assert.equal(hand.command, "open");
  assert.equal(hand.hand, "Right");
  hand = updateHandGesture(hand, detection("Closed_Fist", "Right", .3), 400);
  assert.equal(hand.command, "open");
  hand = updateHandGesture(hand, detection("Open_Palm"), 500);
  hand = updateHandGesture(hand, detection("Open_Palm"), 700);
  assert.equal(hand.command, "open");
  hand = updateHandGesture(hand, detection("Closed_Fist"), 800);
  assert.equal(hand.command, "open");
  hand = updateHandGesture(hand, detection("Closed_Fist"), 1000);
  assert.equal(hand.command, "fist");
  hand = updateHandGesture(hand, null, 1400);
  assert.equal(hand.command, "fist");
  hand = updateHandGesture(hand, null, 2600);
  assert.equal(hand.command, "lost");
});

test("pending recognition continues the last response in both phases until the opposite gesture is confirmed", () => {
  for (const before of [{ cloud: .6, escape: 0 }, { cloud: 1, escape: .6 }]) {
    let hand = updateHandGesture(createHandGestureState(), detection("Closed_Fist"), 0);
    hand = updateHandGesture(hand, detection("Closed_Fist"), 200);
    hand = updateHandGesture(hand, detection("None"), 300);
    assert.match(handGestureLabel(hand), /识别中.*握拳/);
    let response = advanceHandEscape({ ...createHandEscapeState(), ...before }, hand.command, .05);
    const amount = before.escape > 0 ? "escape" : "cloud";
    assert.ok(response[amount] < before[amount], "recall continues during unknown finger poses");
    hand = updateHandGesture(hand, detection("Open_Palm"), 400);
    assert.equal(hand.command, "fist", "candidate alone must not reverse the response");
    hand = updateHandGesture(hand, detection("Open_Palm"), 600);
    assert.equal(hand.command, "open");
    hand = updateHandGesture(hand, detection("None"), 700);
    assert.match(handGestureLabel(hand), /识别中.*张掌/);
    const opening = advanceHandEscape(response, hand.command, .05);
    assert.ok(opening[amount] > response[amount], "opening continues during unknown finger poses");
    hand = updateHandGesture(hand, null, 900);
    assert.equal(hand.command, "open", "brief tracking gaps keep the last response too");
    hand = updateHandGesture(hand, detection("Closed_Fist"), 1000);
    assert.equal(hand.command, "open");
    hand = updateHandGesture(hand, detection("Closed_Fist"), 1200);
    assert.equal(hand.command, "fist");
  }
});

test("arms alone cannot cause escape; the existing single-arm membrane response still works", () => {
  let signal = INITIAL_SIGNAL, previous = null;
  for (let i = 0; i < 60; i++) {
    const pose = makeDemoPose(11000 + i);
    signal = computeSignal(pose, previous, 52, signal); previous = pose;
  }
  assert.ok(signal.armSpread > .8);
  assert.equal(signal.escape, 0);
  for (let i = 0; i < 60; i++) {
    const pose = makeDemoPose(4000 + i);
    signal = computeSignal(pose, previous, 52, signal); previous = pose;
  }
  assert.ok(signal.circularSpeed > .8);
});

test("the first local point conversion stays slow and reverses smoothly before detachment", () => {
  let state = runState(createHandEscapeState(), "open", .6);
  assert.ok(state.cloud > .08 && state.cloud < .09);
  assert.equal(state.escape, 0);
  const before = state.cloud;
  state = advanceHandEscape(state, "fist", 1 / 60);
  assert.ok(state.cloud < before && before - state.cloud < .005);
  state = runState(state, "fist", 5);
  assert.equal(state.cloud, 0);
  assert.equal(state.stage, "原型");
});

test("detachment overlaps conversion instead of waiting for the whole specimen, and never auto-restores", () => {
  let state = runState(createHandEscapeState(), "open", 2);
  assert.ok(state.cloud < .3 && state.cloud > .25);
  assert.ok(state.escape > .1 && state.escape < state.cloud);
  state = runState(state, "open", 10);
  assert.equal(state.cloud, 1); assert.equal(state.escape, 1);
  state = runState(state, "open", 90, 500);
  assert.equal(state.cloud, 1); assert.equal(state.escape, 1);
  assert.equal(state.recalling, false);
  const paused = runState(state, "hold", 1, 500);
  assert.equal(paused.escape, 1);
  state = runState(state, "fist", 6.2, 500);
  assert.equal(state.escape, 0);
  assert.equal(state.cloud, 1, "must wait for actual particles before revealing surfaces");
  state = runState(state, "fist", 5.1, 0);
  assert.equal(state.cloud, 0);
});

test("reopening during recall reverses from the current position without resetting phase", () => {
  let state = runState(createHandEscapeState(), "open", 16);
  state = runState(state, "fist", 2, 300);
  const previous = state.escape;
  state = advanceHandEscape(state, "open", 1 / 60, 300);
  assert.ok(state.escape > previous && state.escape - previous < .003);
  assert.equal(state.cloud, 1); assert.equal(state.recalling, false);
  const low = runState(createHandEscapeState(), "open", 12, 0, 20);
  const high = runState(createHandEscapeState(), "open", 12, 0, 120);
  assert.ok(Math.abs(low.escape - high.escape) < .01);
});

test("the same escaped particles persist and physically return to rotated source vertices", () => {
  const source = fixture(), system = createEscapeSystem(384);
  let state = createHandEscapeState(), time = 0;
  const step = command => {
    time += 1 / 60;
    state = advanceHandEscape(state, command, 1 / 60, system.activeCount, system.pendingReturnPhase);
    system.update(1 / 60, time, state.escape, 0, [source], state.escape, state);
  };
  for (let i = 0; i < .6 * 60; i++) step("open");
  assert.equal(system.activeCount, 0);
  for (let i = 0; i < 1.4 * 60; i++) step("open");
  assert.ok(system.activeCount > 0, "upper particles escape while most of the body is still solid");
  assert.ok(state.cloud < .3);
  for (let i = 0; i < 10 * 60; i++) step("open");
  const count = system.activeCount, seeds = [...system.snapshot().seeds];
  assert.ok(count > 0);
  for (let i = 0; i < 60 * 60; i++) step("open");
  assert.equal(system.activeCount, count);
  assert.deepEqual([...system.snapshot().seeds], seeds);
  assert.equal(state.cloud, 1);
  source.mesh.position.set(.25, -.1, .2); source.mesh.rotation.y = .9;
  source.mesh.updateMatrixWorld(true);
  step("fist");
  for (let i = 0; i < 6 * 60 && system.recallingCount === 0; i++) step("fist");
  const initialDistance = system.recallDistance;
  assert.ok(initialDistance > 0);
  for (let i = 0; i < 3 * 60; i++) step("fist");
  assert.ok(system.recallDistance < initialDistance * .2);
  if (system.activeCount > 0) assert.ok(state.cloud >= .085 - 1e-6, "the returning region stays point-like until arrival");
  for (let i = 0; i < 12 * 60; i++) step("fist");
  assert.equal(system.activeCount, 0);
  assert.equal(state.cloud, 0);
  assert.ok(system.points.geometry.attributes.position.array.every(Number.isFinite));
  system.dispose(); source.mesh.geometry.dispose(); source.mesh.material.dispose();
});

test("recall reaches the base, torso and crown in order while untouched particles keep circulating", () => {
  const phases = [.70, .35, 0];
  const sources = phases.map((phase, index) => {
    const source = fixture(); source.phases.fill(phase);
    source.mesh.scale.setScalar(.25);
    source.mesh.position.y = index - 1;
    source.mesh.updateMatrixWorld(true);
    return source;
  });
  const systems = phases.map(() => createEscapeSystem(192));
  let state = createHandEscapeState(), time = 0;
  const step = command => {
    time += 1 / 60;
    state = advanceHandEscape(state, command, 1 / 60,
      systems.reduce((sum, system) => sum + system.activeCount, 0),
      Math.max(...systems.map(system => system.pendingReturnPhase)));
    systems.forEach((system, index) => system.update(1 / 60, time, state.escape, 0, [sources[index]], state.escape, state));
  };
  for (let i = 0; i < 10 * 60; i++) step("open");
  assert.ok(systems.every(system => system.activeCount > 0));
  const crownBefore = [...systems[2].snapshot().positions];
  for (let i = 0; i < 60; i++) step("fist");
  assert.ok(systems[0].recallingCount > 0);
  assert.equal(systems[1].recallingCount, 0);
  assert.equal(systems[2].recallingCount, 0);
  assert.notDeepEqual([...systems[2].snapshot().positions], crownBefore, "the crown keeps flowing instead of freezing");
  for (let i = 0; i < 2 * 60; i++) step("fist");
  assert.ok(systems[1].recallingCount > 0);
  assert.equal(systems[2].recallingCount, 0);
  for (let i = 0; i < 3 * 60; i++) step("fist");
  assert.equal(systems[0].activeCount, 0, "base particles have already landed");
  assert.ok(systems[2].recallingCount > 0, "the crown returns later");
  assert.ok(state.cloud < .7, "gathered lower regions can restore before the crown arrives");
  for (let i = 0; i < 12 * 60; i++) step("fist");
  assert.ok(systems.every(system => system.activeCount === 0));
  assert.equal(state.cloud, 0);
  systems.forEach(system => system.dispose());
  sources.forEach(source => { source.mesh.geometry.dispose(); source.mesh.material.dispose(); });
});

test("emission advances through converted regions only, never solid lower regions or an already empty crown", () => {
  for (const [cloud, escape] of [[.28, .16], [.55, .43], [.82, .70]]) {
    const window = emissionPhaseWindow(cloud, escape);
    assert.ok(window.max + .085 <= cloud + 1e-10, "only fully converted points may detach");
    assert.ok(window.min < window.max);
    const check = (phase, shouldEmit) => {
      const source = fixture(), system = createEscapeSystem(96);
      source.phases.fill(phase);
      const control = { cloud, escape, recalling: false };
      for (let i = 0; i < 60; i++) system.update(1 / 60, i / 60, escape, 0, [source], escape, control);
      assert.equal(system.activeCount > 0, shouldEmit);
      system.dispose(); source.mesh.geometry.dispose(); source.mesh.material.dispose();
    };
    check((Math.max(0, window.min) + window.max) / 2, true);
    check(window.max + .1, false);
    if (window.min > .01) check(window.min - .01, false);
  }
});
