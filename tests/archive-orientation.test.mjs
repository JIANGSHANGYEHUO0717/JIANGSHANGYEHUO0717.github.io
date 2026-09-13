import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ARCHIVE_ORGANISMS } from "../src/archiveAssets.js";
import { orientArchiveModel, archiveModelBounds, C01_GROWTH_AXIS } from "../src/archiveReference/orientation.js";
import { archivePlacement, terrainField } from "../src/archiveReference/adapter.js";
import { sampleHeight } from "../src/archiveReference/terrain.js";
import { buildArchiveCloud } from "../src/archiveCloud.js";
import { readGlbGeometry } from "../scripts/inspect-archive-contact.mjs";

const definition=ARCHIVE_ORGANISMS[0];
const source=readGlbGeometry(new URL("../public"+definition.url,import.meta.url));
const upright=orientArchiveModel(source,definition);

test("C01 anatomical growth axis becomes vertical, without mutating its imported geometry",()=>{
  const before=new THREE.Box3().setFromObject(source);
  const corrected=new THREE.Vector3(...C01_GROWTH_AXIS).applyQuaternion(upright.quaternion);
  assert.ok(corrected.distanceTo(new THREE.Vector3(0,1,0))<1e-10);
  assert.equal(source.parent,null);
  assert.ok(source.quaternion.equals(new THREE.Quaternion()));
  assert.deepEqual(new THREE.Box3().setFromObject(source),before);
  assert.notEqual(upright.children[0],source);
  assert.ok(upright.children[0].children[0].children[0].geometry===source.children[0].children[0].geometry);
});

test("the other four organisms keep their exact model transforms",()=>{
  for(const definition of ARCHIVE_ORGANISMS.slice(1)) {
    assert.equal(orientArchiveModel(source,definition),source);
  }
});

test("upright sampling is grounded after orientation and remains vertical through full-field rotation",()=>{
  const bounds=archiveModelBounds(upright);
  const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
  const scale=definition.targetSize/Math.max(size.x,size.y,size.z);
  const yaw=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),definition.rotation*Math.PI/180);
  let contactGap=Infinity;
  const placement=archivePlacement(definition,0,upright);
  upright.traverse(object=>{
    if(!object.isMesh)return;
    const vertices=object.geometry.getAttribute("position"),p=new THREE.Vector3();
    for(let i=0;i<vertices.count;i++) {
      p.fromBufferAttribute(vertices,i).applyMatrix4(object.matrixWorld);
      p.set((p.x-center.x)*scale,(p.y-bounds.min.y)*scale,(p.z-center.z)*scale);
      if(p.y>definition.targetSize*.08)continue;
      p.applyQuaternion(yaw).add(new THREE.Vector3(...placement.position));
      contactGap=Math.min(contactGap,p.y-sampleHeight(terrainField(),p.x,p.z));
    }
  });
  assert.ok(Math.abs(contactGap+.0895)<1e-8);
  for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]) {
    const axis=new THREE.Vector3(...C01_GROWTH_AXIS).applyQuaternion(upright.quaternion)
      .applyAxisAngle(new THREE.Vector3(0,1,0),angle+definition.rotation*Math.PI/180);
    assert.ok(axis.distanceTo(new THREE.Vector3(0,1,0))<1e-8);
    assert.equal(archivePlacement(definition,angle,upright).position[1],placement.position[1]);
  }
});

test("cloud sampling and invisible hit mesh use the same upright normalization",()=>{
  const geometry=buildArchiveCloud(upright,definition.targetSize,73);
  geometry.computeBoundingBox();
  const box=archiveModelBounds(upright),size=box.getSize(new THREE.Vector3());
  const height=size.y*definition.targetSize/Math.max(size.x,size.y,size.z);
  assert.ok(Math.abs(geometry.boundingBox.min.y)<.03);
  assert.ok(Math.abs(geometry.boundingBox.max.y-height)<.03);
  assert.ok(height>3.2);
  geometry.dispose();
});
