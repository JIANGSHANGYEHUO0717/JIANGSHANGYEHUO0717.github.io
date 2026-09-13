import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { ARCHIVE_CLOUD_BUDGET, archiveCloudEmphasis, buildArchiveCloud, createArchiveCloudMaterial } from "../src/archiveCloud.js";

function fixture() {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2,4,1), new THREE.MeshBasicMaterial());
  mesh.position.set(8,3,-4);
  group.add(mesh);
  return { group, mesh };
}

test("cloud respects the fixed body/escape budget and normalized model bounds", () => {
  const { group } = fixture();
  const geometry = buildArchiveCloud(group, 3.4);
  const count = ARCHIVE_CLOUD_BUDGET.body + ARCHIVE_CLOUD_BUDGET.escape;
  assert.equal(geometry.getAttribute("position").count, count);
  assert.equal(geometry.getAttribute("aEscape").array.reduce((a,b) => a+b,0), ARCHIVE_CLOUD_BUDGET.escape);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  assert.ok(Math.abs(box.min.x + .85) < .00001);
  assert.ok(Math.abs(box.max.y - 3.4) < .00001);
  assert.ok(Math.abs(box.min.y) < .00001);
  assert.ok(Math.abs(box.max.z - .425) < .00001);
  const normal = geometry.getAttribute("aSurfaceNormal");
  for (let index = 0; index < count; index++) {
    assert.ok(Math.abs(Math.hypot(normal.getX(index),normal.getY(index),normal.getZ(index))-1) < .00001);
  }
  geometry.dispose();
});

test("surface sampling is repeatable and does not mutate cached geometry or transforms", () => {
  const { group, mesh } = fixture();
  const positions = Array.from(mesh.geometry.getAttribute("position").array);
  const first = buildArchiveCloud(group, 3, 73, {body:80,escape:20});
  const second = buildArchiveCloud(group, 3, 73, {body:80,escape:20});
  assert.deepEqual(first.getAttribute("position").array, second.getAttribute("position").array);
  assert.deepEqual(Array.from(mesh.geometry.getAttribute("position").array), positions);
  assert.deepEqual(mesh.position.toArray(), [8,3,-4]);
  assert.equal(mesh.visible,true);
  first.dispose(); second.dispose();
});

test("invisible source mesh remains an exact clickable target", () => {
  const { group, mesh } = fixture();
  mesh.visible = false;
  group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(8,3,10),new THREE.Vector3(0,0,-1));
  assert.equal(ray.intersectObjects([mesh],false)[0]?.object,mesh);
});

test("hover never changes cloud density or creates a solid/outline layer", () => {
  assert.equal(archiveCloudEmphasis(false),1);
  assert.equal(archiveCloudEmphasis(true),1.45);
  assert.equal(archiveCloudEmphasis(true,false,2.2),2.2);
  assert.equal(archiveCloudEmphasis(true,true),archiveCloudEmphasis(true));
  const material = createArchiveCloudMaterial(0x9ad9e5,3.4);
  assert.equal(material.depthWrite,false);
  assert.equal(material.blending,THREE.AdditiveBlending);
  assert.equal(material.vertexShader.includes("uEmphasis"),false);
  assert.equal(material.fragmentShader.includes("uEmphasis"),true);
  material.dispose();
});
