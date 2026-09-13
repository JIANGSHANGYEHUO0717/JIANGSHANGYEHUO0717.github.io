// Read-only geometry/contact inspection. No material or asset writes.
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { ARCHIVE_ORGANISMS } from "../src/archiveAssets.js";
import { terrainField } from "../src/archiveReference/adapter.js";
import { sampleHeight } from "../src/archiveReference/terrain.js";
import { orientArchiveModel, archiveModelBounds } from "../src/archiveReference/orientation.js";

export function readGlbGeometry(file) {
  const bytes = readFileSync(file);
  let json, binary;
  for(let offset=12;offset<bytes.length;) {
    const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4);
    const data=bytes.subarray(offset+8,offset+8+length);
    if(type===0x4e4f534a) json=JSON.parse(data.toString("utf8"));
    if(type===0x004e4942) binary=data;
    offset+=8+length;
  }
  const root=new THREE.Group();
  function nodeAt(index) {
    const definition=json.nodes[index], node=new THREE.Group();
    if(definition.matrix) {
      node.matrix.fromArray(definition.matrix);
      node.matrix.decompose(node.position,node.quaternion,node.scale);
    } else {
      if(definition.translation) node.position.fromArray(definition.translation);
      if(definition.rotation) node.quaternion.fromArray(definition.rotation);
      if(definition.scale) node.scale.fromArray(definition.scale);
    }
    if(definition.mesh!==undefined) for(const primitive of json.meshes[definition.mesh].primitives) {
      const accessor=json.accessors[primitive.attributes.POSITION],view=json.bufferViews[accessor.bufferView];
      if(accessor.componentType!==5126 || accessor.sparse) throw new Error("Unsupported position accessor");
      const positions=new Float32Array(accessor.count*3);
      const start=(view.byteOffset||0)+(accessor.byteOffset||0),stride=view.byteStride||12;
      for(let p=0;p<accessor.count;p++) for(let axis=0;axis<3;axis++) positions[p*3+axis]=binary.readFloatLE(start+p*stride+axis*4);
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
      node.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()));
    }
    for(const child of definition.children||[]) node.add(nodeAt(child));
    return node;
  }
  for(const index of json.scenes[json.scene||0].nodes) root.add(nodeAt(index));
  root.updateMatrixWorld(true);
  return root;
}

if(process.argv[1]?.endsWith("inspect-archive-contact.mjs")) {
  const field=terrainField();
  for(const definition of ARCHIVE_ORGANISMS) {
    const model=orientArchiveModel(readGlbGeometry(new URL("../public"+definition.url,import.meta.url)),definition);
    const box=archiveModelBounds(model),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    const scale=definition.targetSize/Math.max(size.x,size.y,size.z);
    const p=new THREE.Vector3(),axis=new THREE.Vector3(0,1,0),bottom=[];
    const [x,,z]=definition.position, oldHeight=sampleHeight(field,x,z)+.012;
    model.traverse(object=>{
      if(!object.isMesh)return;
      const positions=object.geometry.getAttribute("position");
      for(let index=0;index<positions.count;index++) {
        p.fromBufferAttribute(positions,index).applyMatrix4(object.matrixWorld);
        p.set((p.x-center.x)*scale,(p.y-box.min.y)*scale,(p.z-center.z)*scale);
        if(p.y>definition.targetSize*.08)continue;
        p.applyAxisAngle(axis,definition.rotation*Math.PI/180);
        const ground=sampleHeight(field,x+p.x,z+p.z);
        bottom.push({local:p.toArray(),ground,required:ground-p.y,gap:oldHeight+p.y-ground});
      }
    });
    bottom.sort((a,b)=>b.required-a.required);
    console.log(JSON.stringify({id:definition.id,oldHeight,samples:bottom.length,touch:bottom[0],lower:bottom.at(-1)},null,2));
  }
}
