import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { C02_ROUTING_IDLE_AGE, c02RoutingDemoProfile } from "../src/c02SurfaceRouting.js";

const assetRoot = new URL("../public/assets/observation/c02-routing/", import.meta.url);

test("surface routing bake is finite and dimensionally consistent", async () => {
  const metadata = JSON.parse(await readFile(new URL("surface-routing.json", assetRoot), "utf8"));
  const binary = await readFile(new URL("surface-routing.bin", assetRoot));
  assert.equal(metadata.pointCount, 120_000);
  assert.equal(metadata.nodeCount, 12);
  assert.equal(metadata.nodeCenters.length, metadata.nodeCount);
  assert.equal(metadata.nodeMatrix.length, metadata.nodeCount);
  assert.ok(metadata.nodeMatrix.flat().every(Number.isFinite));
  assert.ok(metadata.nodeMatrix.every(row => row.length === metadata.nodeCount));
  assert.ok(metadata.nodeMatrix.every((row, index) => row[index] === 0));
  const expectedBytes = metadata.arrays.distance.offset + metadata.arrays.distance.length * 4;
  assert.equal(binary.byteLength, expectedBytes);
});

test("demo preserves the approved dormant-to-rerouting story", () => {
  assert.equal(c02RoutingDemoProfile(0).phase, "dormant");
  assert.equal(c02RoutingDemoProfile(5).phase, "routing");
  assert.equal(c02RoutingDemoProfile(7).phase, "pulsing");
  assert.equal(c02RoutingDemoProfile(12).phase, "rerouting");
  assert.equal(c02RoutingDemoProfile(16).phase, "pulsing");
  assert.equal(c02RoutingDemoProfile(22).phase, "dormant");
  assert.equal(c02RoutingDemoProfile(4).route, 0);
  assert.equal(c02RoutingDemoProfile(12).route, 1);
  assert.ok(c02RoutingDemoProfile(12).oldFade > 0);
});

test("C02 opens dormant and waits for an explicit demo or hand input", () => {
  assert.equal(C02_ROUTING_IDLE_AGE, 21);
  assert.deepEqual(c02RoutingDemoProfile(C02_ROUTING_IDLE_AGE), {
    energy: 0, progress: 0, oldFade: 0, route: 1, phase: "dormant",
  });
});

test("C02 base observation keeps interaction points hidden until energy rises", async () => {
  const source = await readFile(new URL("../src/c02SurfaceRouting.js", import.meta.url), "utf8");
  assert.match(source, /interactionVisibility = visible \* smooth\(state\.energy, \.004, \.10\)/);
  assert.match(source, /group\.visible = interactionVisibility > \.001/);
});
