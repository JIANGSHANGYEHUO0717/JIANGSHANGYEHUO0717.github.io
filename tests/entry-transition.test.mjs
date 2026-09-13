import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ENTRY_SECONDS, entryMotionAt } from "../src/entryMotion.js";

test("entry starts at the archive scale as points only", () => {
  assert.deepEqual(entryMotionAt(0), { progress: 0, focus: 0, surface: 0, points: 1, complete: false });
});

test("focus precedes material condensation and both settle at the final endpoint", () => {
  const focusStage = entryMotionAt(ENTRY_SECONDS * .4);
  assert.ok(focusStage.focus > .3);
  assert.equal(focusStage.surface, 0);
  const settled = entryMotionAt(ENTRY_SECONDS * .96);
  assert.equal(settled.focus, 1);
  assert.equal(settled.surface, 1);
  assert.equal(settled.complete, false);
  assert.deepEqual(entryMotionAt(ENTRY_SECONDS), { progress: 1, focus: 1, surface: 1, points: 0, complete: true });
});

test("entry progresses monotonically without frame-dependent integration", () => {
  let previous = entryMotionAt(0);
  for (let frame = 1; frame <= 600; frame += 1) {
    const next = entryMotionAt(frame / 120);
    for (const key of ["progress", "focus", "surface"]) assert.ok(next[key] >= previous[key]);
    assert.ok(next.points <= previous.points);
    previous = next;
  }
  assert.equal(entryMotionAt(100).complete, true);
  assert.equal(entryMotionAt(-1).progress, 0);
});

test("reduced-motion entry uses a short reveal without camera travel", () => {
  assert.equal(entryMotionAt(0, true).focus, 1);
  assert.equal(entryMotionAt(.4, true).focus, 1);
  assert.equal(entryMotionAt(.85, true).complete, true);
});

test("C05 reaches its authored observation yaw inside the shared entry motion", async () => {
  const source = await readFile(new URL("../src/OrganismStage.jsx", import.meta.url), "utf8");
  assert.match(source, /lerp\(entryPlacement\.yaw, observationFrontYaw, entry\.focus\)/);
  assert.match(source, /const c05Strength = 1 - uniforms\.uDissolve\.value/);
});

test("C03 keeps the lower light field runtime but hides its visible plane", async () => {
  const source = await readFile(new URL("../src/c03BlenderStudio.js", import.meta.url), "utf8");
  assert.match(source, /luminousField\.visible=false/);
  assert.match(source, /fieldMaterial\.uniforms\.uStrength\.value=THREE\.MathUtils\.lerp/);
});
