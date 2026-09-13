import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { C04_SMOKE, smokeCurl, smokeLife, smokeEmission, smokeAdvection, createEscapeSystem } from "../src/c04Escape.js";

function sourceFixture() {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial());
  mesh.geometry.computeBoundingBox(); mesh.updateMatrixWorld(true);
  const count = mesh.geometry.attributes.position.count;
  return { mesh, indices: Array.from({ length: count }, (_, i) => i), phases: Array(count).fill(0) };
}
function simulate(system, source, seconds, energy, contour, start = 0) {
  for (let i = 0; i < seconds * 60; i++) system.update(1 / 60, start + i / 60, energy, 0, [source], contour);
}

test("smoke uses a smooth shared curl field, not a random force per particle", () => {
  const epsilon = .0001;
  for (const p of [[0,0,0],[1.2,.4,-.8],[-2,3,1]]) {
    const here = smokeCurl(...p, 4);
    const near = smokeCurl(p[0] + .001, p[1], p[2], 4);
    assert.ok(here.distanceTo(near) < .005);
    let divergence = 0;
    for (let axis = 0; axis < 3; axis++) {
      const plus = [...p], minus = [...p]; plus[axis] += epsilon; minus[axis] -= epsilon;
      divergence += (smokeCurl(...plus,4).getComponent(axis)-smokeCurl(...minus,4).getComponent(axis))/(2*epsilon);
    }
    assert.ok(Math.abs(divergence) < 1e-7);
  }
});

test("smoke holds color before a smooth final fade and stops model emission after dissolution", () => {
  assert.equal(smokeLife(0, 6), 0);
  assert.equal(smokeLife(6, 6), 0);
  assert.equal(smokeLife(2,6), smokeLife(3,6));
  assert.ok(smokeLife(3,6) > smokeLife(4,6));
  assert.ok(smokeLife(5.99,6) < .001);
  assert.equal(smokeEmission(1,1), 0);
  assert.equal(smokeEmission(0,0), 0);
  assert.ok(smokeEmission(1,.8) < smokeEmission(1,.4));
});

test("three world-space layers share live samples, history has no line segments", () => {
  const system = createEscapeSystem(384);
  assert.equal(system.smoke.geometry, system.points.geometry);
  assert.equal(system.smoke.material.blending, THREE.NormalBlending);
  assert.equal(system.points.material.blending, THREE.AdditiveBlending);
  assert.equal(system.trails.isPoints, true);
  assert.equal(system.trails.isLineSegments, undefined);
  const source = sourceFixture();
  simulate(system, source, 2, .8, .2);
  assert.ok(system.activeCount > 0 && system.activeCount <= 384);
  assert.ok(system.snapshot().positions.every(Number.isFinite));
  for (const name of ["position","aLife","aAge","aVelocity"]) assert.ok(system.trails.geometry.attributes[name].array.every(Number.isFinite));
  const initialCount = system.activeCount;
  simulate(system, source, 20, 1, 1, 2);
  assert.equal(system.activeCount, initialCount);
  assert.ok(system.points.geometry.attributes.aLife.array.some(x => x > .9));
  assert.ok(system.snapshot().positions.every(x => Number.isFinite(x) && Math.abs(x) < 6));
  simulate(system, source, 8, 0, 1, 22);
  assert.equal(system.activeCount, 0);
  assert.equal(system.snapshot().alphas.length, 0);
  assert.ok(system.trails.geometry.attributes.aLife.array.every(x => x === 0));
  system.dispose();
});

test("detached flow moves in multiple directions and gently returns from distant edges", () => {
  const samples = [];
  for (const x of [-2,-1,0,1,2]) for (const y of [-2,-1,0,1,2]) samples.push(smokeAdvection(x,y,0,2));
  assert.ok(samples.some(v => v.x > .3) && samples.some(v => v.x < -.3));
  assert.ok(samples.some(v => v.y > .3) && samples.some(v => v.y < -.3));
  assert.ok(smokeAdvection(6,0,0,2).x < 0);
  assert.ok(smokeAdvection(-6,0,0,2).x > 0);
  assert.ok(smokeAdvection(0,6,0,2).y < 0);
  assert.ok(smokeAdvection(0,-6,0,2).y > 0);
});

test("released smoke keeps drifting in world space when the specimen rotates", () => {
  const a = createEscapeSystem(256), b = createEscapeSystem(256);
  const sourceA = sourceFixture(), sourceB = sourceFixture();
  simulate(a,sourceA,1,.8,.2); simulate(b,sourceB,1,.8,.2);
  sourceB.mesh.rotation.y = Math.PI / 2;
  sourceB.mesh.updateMatrixWorld(true);
  simulate(a,sourceA,1,0,.2,1); simulate(b,sourceB,1,0,.2,1);
  assert.deepEqual(a.snapshot().positions, b.snapshot().positions);
  a.dispose(); b.dispose();
});

test("C4 smoke stays bounded and separate from approved archive/entry compositing", () => {
  assert.ok(C04_SMOKE.capacity < 12000);
  const shader = readFileSync(new URL("../src/c04Escape.js",import.meta.url),"utf8");
  assert.equal(shader.includes("new THREE.Mesh("),false);
  assert.equal(shader.includes("source.mesh.matrixWorld"),true);
  assert.equal(shader.includes("gl_FragColor=vec4(vec3(1.0)"),false);
  const specimen = readFileSync(new URL("../src/SpecimenStage.jsx",import.meta.url),"utf8");
  assert.ok(specimen.includes("composer.addPass(specimenFinishPass)"));
  assert.ok(specimen.includes("!entering && !returning && !document.hidden"));
});
