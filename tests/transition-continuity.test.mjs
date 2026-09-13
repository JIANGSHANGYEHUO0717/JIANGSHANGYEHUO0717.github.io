import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { ARCHIVE_FADE_SECONDS, captureEscapeParticles, seedMorphFromEscape, returnCloudColor } from "../src/transitionContinuity.js";

function fixture() {
  return {
    positions: new Float32Array([3, 2, -1, 8, 9, 10, -2, 4, 3]),
    velocities: new Float32Array([.1, .2, .3, 1, 1, 1, -.2, .4, .1]),
    lifeValues: new Float32Array([.9, 0, .4]),
    seeds: new Float32Array([.2, .3, .7]),
  };
}

test("exit snapshot keeps only live particles and owns its arrays", () => {
  const live = fixture();
  const snapshot = captureEscapeParticles(live);
  assert.deepEqual([...snapshot.positions], [3, 2, -1, -2, 4, 3]);
  assert.equal(snapshot.alphas.length, 2);
  live.positions.fill(0);
  live.velocities.fill(0);
  assert.equal(snapshot.positions[0], 3);
  assert.ok(snapshot.velocities[0] > 0);
});

test("return starts with exact live positions, velocities, alpha and grain seed", () => {
  const snapshot = captureEscapeParticles(fixture());
  const morph = seedMorphFromEscape(snapshot, 32000);
  assert.deepEqual(morph.positions.slice(0, 6), snapshot.positions);
  assert.deepEqual(morph.velocities.slice(0, 6), snapshot.velocities);
  assert.deepEqual(morph.seeds.slice(0, 2), snapshot.seeds);
  assert.deepEqual(morph.alphas.slice(0, 2), snapshot.alphas);
  assert.equal(morph.original.reduce((sum, x) => sum + x, 0), 2);
  for (let i = 2; i < morph.original.length; i++) {
    assert.equal(morph.original[i], 0);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(morph.positions[i * 3 + axis] - snapshot.positions[(i % 2) * 3 + axis]) <= .05501);
    }
  }
});

test("empty escape cannot silently fall back to an intact model", () => {
  assert.throws(() => seedMorphFromEscape({ alphas: [] }, 100), /逃逸颗粒/);
  const morphSource = readFileSync(new URL("../src/ArchiveMorphStage.jsx", import.meta.url), "utf8");
  assert.equal(morphSource.includes("sourcePool"), false);
  assert.equal(morphSource.includes("sourceDefinition"), false);
  assert.ok(morphSource.includes("seedMorphFromEscape(sourceSnapshot"));
});

test("only C01/C04 return-cloud chroma decreases 15%, preserving luminance", () => {
  const luminance = rgb => rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  for (const tint of [0xc56a32, 0x9ad9e5]) {
    const original = new THREE.Color(tint).toArray();
    for (const id of ["C01", "C04"]) {
      const result = returnCloudColor(original, id);
      assert.ok(Math.abs(luminance(result) - luminance(original)) < 1e-12);
      assert.ok(Math.abs((Math.max(...result) - Math.min(...result)) / (Math.max(...original) - Math.min(...original)) - .85) < 1e-12);
    }
    for (const id of ["C02", "C03", "C05"]) assert.deepEqual(returnCloudColor(original, id), original);
  }
});

test("inverse specimen normalization preserves archive cloud at every yaw", () => {
  const center = new THREE.Vector3(.2, -.5, .3);
  const entryScale = 3.4 / 3.02;
  const archiveBase = new THREE.Vector3(2.8, 1.2, 4.9);
  const p = new THREE.Vector3(.4, 2.7, -.15);
  const up = new THREE.Vector3(0, 1, 0);
  for (const yaw of [0, -.8, -Math.PI, -Math.PI * 1.5]) {
    const start = archiveBase.clone().sub(center.clone().multiplyScalar(entryScale).applyAxisAngle(up, yaw));
    const expected = p.clone().applyAxisAngle(up, yaw).add(archiveBase);
    const actual = p.clone().divideScalar(entryScale).add(center).multiplyScalar(entryScale).applyAxisAngle(up, yaw).add(start);
    assert.ok(actual.distanceTo(expected) < 1e-12);
  }
});

test("entry reuses the live diffuse cloud, and source fade is two seconds", () => {
  assert.equal(ARCHIVE_FADE_SECONDS, 2);
  const source = readFileSync(new URL("../src/SpecimenStage.jsx", import.meta.url), "utf8");
  assert.ok(source.includes("liveCloud.geometry.clone(), liveCloud.material.clone()"));
  assert.ok(source.includes("entryCloudTime = liveCloud.material.uniforms.uTime.value"));
  assert.ok(source.includes("uOpacity.value = entering ? 0 :"));
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /archive-entry-source[^\n]*transition: opacity 2s ease-out/);
});
