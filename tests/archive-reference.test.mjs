import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { ARCHIVE_ORGANISMS } from "../src/archiveAssets.js";
import { sampleHeight, edgeAt, advanceAngle } from "../src/archiveReference/terrain.js";
import { ARCHIVE_CAMERA, ARCHIVE_GROUND_BRIGHTNESS, archiveFov, archivePlacement, terrainField, createArchiveTerrain } from "../src/archiveReference/adapter.js";
import { readGlbGeometry } from "../scripts/inspect-archive-contact.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
test("imported shape and light sources match the confirmed snapshot apart from rotation direction", () => {
  const actualLighting = readFileSync(new URL("../src/archiveReference/lighting.js", import.meta.url));
  const expectedLighting = readFileSync(new URL("../../outputs/point-cloud-terrain-20260830-confirmed/src/exhibition/lighting.js", import.meta.url));
  assert.equal(digest(actualLighting), digest(expectedLighting));

  const actualTerrain = readFileSync(new URL("../src/archiveReference/terrain.js", import.meta.url), "utf8")
    .replace("speed = Math.PI * 2 / SETTINGS.secondsPerTurn", "speed = -Math.PI * 2 / SETTINGS.secondsPerTurn");
  const expectedTerrain = readFileSync(new URL("../../outputs/point-cloud-terrain-20260830-confirmed/src/exhibition/terrain.js", import.meta.url), "utf8");
  assert.equal(digest(actualTerrain), digest(expectedTerrain));
});

test("render adapter preserves 111636 original points; only terrain luminance is lowered", () => {
  const terrain = createArchiveTerrain(1.5);
  const position = terrain.pointGeometry.getAttribute("position");
  assert.equal(position.count,111636);
  assert.equal(digest(new Uint8Array(position.array.buffer)), "d1faa26aef40fdae135f7f4354c5cd18a27886b2c7e2e55a302fb82e8abc8db6");
  assert.equal(terrain.pointMaterial.uniforms.uLighting.value,1);
  assert.equal(terrain.pointMaterial.uniforms.uGroundBrightness.value,ARCHIVE_GROUND_BRIGHTNESS);
  assert.equal(ARCHIVE_GROUND_BRIGHTNESS,.34);
  assert.equal(terrain.pointMaterial.uniforms.uOpacity.value,1.18);
  assert.equal(terrain.group.children.length,2);
  assert.equal(terrain.depthMaterial.depthWrite,true);
  assert.equal(terrain.pointMaterial.depthWrite,false);
  for (const object of terrain.group.children) { object.geometry.dispose(); object.material.dispose(); }
});

test("five q1 anchors remain inside the land and lift to its unmodified height", () => {
  for (const definition of ARCHIVE_ORGANISMS) {
    const [x,y,z] = archivePlacement(definition).position;
    assert.ok(edgeAt(x,z) > .98);
    assert.ok(Math.abs(y - sampleHeight(terrainField(),x,z) - .012) < 1e-8);
    for (const other of ARCHIVE_ORGANISMS) {
      if (other === definition) continue;
      assert.ok(Math.hypot(x-other.position[0],z-other.position[2]) > 5);
    }
  }
});

test("entry and exit use the same rigid world placement at every rotation angle", () => {
  for (const degrees of [0,30,90,180,270,359,720]) {
    const angle = -degrees*Math.PI/180;
    const exhibition = new THREE.Group();
    exhibition.rotation.y = angle;
    for (const definition of ARCHIVE_ORGANISMS) {
      const local = archivePlacement(definition);
      const root = new THREE.Group();
      root.position.set(...local.position);
      root.rotation.y = local.yaw;
      exhibition.add(root);
      exhibition.updateMatrixWorld(true);
      const world = archivePlacement(definition,angle);
      const probe = new THREE.Vector3(.2,1.7,-.3);
      const actual = root.localToWorld(probe.clone());
      const expected = probe.clone().applyAxisAngle(new THREE.Vector3(0,1,0),world.yaw).add(new THREE.Vector3(...world.position));
      assert.ok(actual.distanceTo(expected)<1e-8);
      assert.ok(Math.abs(world.yaw)<=Math.PI);
    }
  }
});

test("source camera frames all organism anchor centers through a full turn", () => {
  for (const aspect of [16/9,4/3,1]) {
    const camera = new THREE.PerspectiveCamera(archiveFov(aspect),aspect,.1,100);
    camera.position.set(...ARCHIVE_CAMERA.position);
    camera.lookAt(...ARCHIVE_CAMERA.target);
    camera.updateMatrixWorld();
    for(let degrees=0;degrees<360;degrees+=5) {
      for(const definition of ARCHIVE_ORGANISMS) {
        const p = new THREE.Vector3(...archivePlacement(definition,-degrees*Math.PI/180).position);
        p.y += definition.targetSize*.5;
        p.project(camera);
        assert.ok(Math.abs(p.x)<.95 && Math.abs(p.y)<.92);
      }
    }
  }
});

test("copied rotation is clockwise, 180 seconds per turn, and clamps interrupted frames", () => {
  let angle=0;
  for(let frame=0;frame<180*60;frame++) angle=advanceAngle(angle,1/60);
  assert.ok(Math.abs(angle-Math.PI*2)<1e-9);
  assert.equal(advanceAngle(-2,0),-2);
  assert.equal(advanceAngle(-2,30),advanceAngle(-2,.05));
});

test("historical raw C01 fixture reproduces and corrects the original offset-root gap", () => {
  const definition = ARCHIVE_ORGANISMS[0];
  const model = readGlbGeometry(new URL("../public"+definition.url,import.meta.url));
  const centerHeight = archivePlacement(definition).position[1];
  const groundedHeight = archivePlacement(definition,0,model).position[1];
  // Measured nearest bottom-surface contact is 1.0319846 before the shallow embed.
  assert.ok(centerHeight-groundedHeight > .65 && centerHeight-groundedHeight < .8);
  assert.ok(Math.abs(groundedHeight-(1.0319846225507887-.0895)) < 1e-6);
  for(const angle of [0,-Math.PI/2,-Math.PI,-Math.PI*1.5]) {
    const placement=archivePlacement(definition,angle,model);
    assert.equal(placement.position[1],groundedHeight);
    const actualContact=new THREE.Vector3(.5196230051323525,.02756381129470083,.9168632793738352);
    actualContact.add(new THREE.Vector3(...archivePlacement(definition,0,model).position));
    const groundPoint=new THREE.Vector3(actualContact.x,1.0595484338454895,actualContact.z);
    actualContact.applyAxisAngle(new THREE.Vector3(0,1,0),angle);
    groundPoint.applyAxisAngle(new THREE.Vector3(0,1,0),angle);
    assert.ok(Math.abs(actualContact.y-groundPoint.y+.0895)<1e-6);
  }
  model.traverse(object => { if(object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
});
