import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { ARCHIVE_ORGANISMS } from "../src/archiveAssets.js";
import { buildArchiveCloud, createArchiveCloudMaterial } from "../src/archiveCloud.js";
import { archivePlacement } from "../src/archiveReference/adapter.js";
import { buildReturnData, createArchiveReturn, createReturnMaterial, returnMotionAt, RETURN_PARTICLE_COUNT, RETURN_DURATION } from "../src/archiveReturn.js";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
function fixture() {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial()));
  root.updateMatrixWorld(true);
  return root;
}

test("return owns the same 52,000 identities from dissolution to the native archive", () => {
  const models = Array.from({ length: 5 }, fixture);
  const data = buildReturnData(models, fixture());
  assert.equal(data.reduce((sum, d) => sum + d.geometry.getAttribute("position").count, 0), RETURN_PARTICLE_COUNT);
  for (let i = 0; i < 5; i++) {
    const target = buildArchiveCloud(models[i], ARCHIVE_ORGANISMS[i].targetSize, 73 + i * 101);
    for (const name of ["position", "aSurfaceNormal", "aSeed", "aEscape"]) {
      assert.deepEqual(data[i].geometry.getAttribute(name).array, target.getAttribute(name).array);
    }
    assert.equal(data[i].geometry.getAttribute("aSource").count, target.getAttribute("position").count);
    assert.ok(data[i].geometry.getAttribute("aSourcePhase").array.every(x => x >= 0 && x <= .76));
    target.dispose();
  }
  for (const angle of [0, -.5, -Math.PI / 2, -Math.PI, -Math.PI * 1.5]) {
    const field = createArchiveReturn(data, angle, 1);
    field.scene.updateMatrixWorld(true);
    const clouds = field.scene.children[0].children;
    for (let i = 0; i < 5; i++) {
      const expected = archivePlacement(ARCHIVE_ORGANISMS[i], angle, models[i]);
      assert.ok(clouds[i].getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(...expected.position)) < 1e-10);
    }
    const geometries = clouds.map(p => p.geometry);
    for (const seconds of [0, .5, 1.5, 2.5, 4, 6, RETURN_DURATION, 12]) {
      field.update(seconds, 80 + seconds);
      clouds.forEach((cloud, i) => {
        assert.equal(cloud.geometry, geometries[i]);
        assert.equal(cloud.geometry.getAttribute("position").count, 10400);
        assert.equal(cloud.material.uniforms.uTime.value, 80 + seconds);
        assert.equal(cloud.material.uniforms.uEmphasis.value, 1);
      });
    }
    field.dispose();
  }
  data.forEach(d => d.geometry.dispose());
});

test("return overlaps dissolution and target travel, with smooth monotonic endpoints", () => {
  let previous = returnMotionAt(0);
  for (let t = .01; t < 10; t += .01) {
    const current = returnMotionAt(t);
    for (const key of ["dissolve", "contour", "travel", "camera", "settle"]) {
      assert.ok(current[key] >= previous[key]);
      assert.ok(current[key] - previous[key] < .02);
      assert.ok(current[key] >= 0 && current[key] <= 1);
    }
    previous = current;
  }
  assert.ok(returnMotionAt(1.5).travel > 0);
  assert.ok(returnMotionAt(1.5).contour < 1);
  for (const key of ["dissolve", "contour", "travel", "camera", "settle"]) assert.equal(previous[key], 1);
});

test("source normalization respects specimen rotation instead of resetting to a default camera/model", () => {
  const base = new THREE.Vector3(.13, -1.46, -.05);
  const p = new THREE.Vector3(.2, 2.8, -.3);
  for (const yaw of [0, .7, 2, 4]) {
    const parent = new THREE.Matrix4().compose(new THREE.Vector3(.1, 0, -.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(.3, yaw, 0)), new THREE.Vector3(1, 1, 1));
    const sourceMatrix = parent.clone().multiply(new THREE.Matrix4().makeTranslation(...base.toArray()));
    assert.ok(p.clone().applyMatrix4(sourceMatrix).distanceTo(p.clone().add(base).applyMatrix4(parent)) < 1e-12);
  }
});

test("return point style derives from archive shader and has no source lifespan/opacity handoff", () => {
  const definition = ARCHIVE_ORGANISMS[3];
  const material = createReturnMaterial(definition, new THREE.Matrix4(), 1);
  const original = createArchiveCloudMaterial(definition.tint, definition.targetSize);
  assert.ok(material.vertexShader.includes("vec3 targetWorld = (modelMatrix * vec4(p,1.0)).xyz"));
  assert.ok(material.vertexShader.includes("mix(sourceWorld+drift,targetWorld,travel)"));
  assert.ok(material.vertexShader.includes("alpha = mix(sourceAlpha,alpha,smoothstep(.40,1.0,travel))"));
  assert.deepEqual(material.uniforms.uNativeTint.value, original.uniforms.uTint.value);
  assert.equal(material.blending, original.blending);
  assert.equal(material.depthWrite, original.depthWrite);
  assert.equal(material.vertexShader.includes("uHandoff"), false);
  assert.equal(material.vertexShader.includes("sourceSnapshot"), false);
  material.dispose(); original.dispose();
});

test("entry/observation keep the finish pass and exit never mounts the old morph canvas", () => {
  const specimen = read("../src/SpecimenStage.jsx");
  const app = read("../src/App.jsx");
  const archive = read("../src/ArchiveFieldStage.jsx");
  const css = read("../src/styles.css");
  assert.ok(specimen.includes("composer.addPass(specimenFinishPass)"));
  assert.equal(specimen.includes("specimenFinishPass.enabled ="), false);
  assert.equal(specimen.includes("entryAlphaPass"), false);
  assert.equal(app.includes("ArchiveMorphStage"), false);
  assert.equal(app.includes("morphSourceVisible"), false);
  assert.equal(css.includes("specimen-afterglow"), false);
  assert.ok(archive.includes("cloudTime = session.current.cloudTime"));
  assert.ok(specimen.includes("archiveSession.current.revealReturnClouds()"));
  assert.ok(specimen.includes("if (!entering && !returning && !document.hidden) escapeSystem.update"));
});
