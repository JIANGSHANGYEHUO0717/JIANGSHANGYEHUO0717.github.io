import * as THREE from "three";
import { archiveModelBounds } from "./orientation.js";

// A curved/offset root is not underneath the bounding-box center.
// Find contact against the actual lowest surface vertices, in terrain-local space.
export function footprintContactHeight(model, definition, sample) {
  model.updateMatrixWorld(true);
  const bounds = archiveModelBounds(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const scale = definition.targetSize / Math.max(size.x, size.y, size.z, .0001);
  const point = new THREE.Vector3(), axis = new THREE.Vector3(0,1,0);
  const yaw = THREE.MathUtils.degToRad(definition.rotation);
  const [x,,z] = definition.position;
  let height = -Infinity;
  model.traverse(object => {
    if (!object.isMesh) return;
    const positions = object.geometry.getAttribute("position");
    if (!positions) return;
    for (let index=0; index<positions.count; index++) {
      point.fromBufferAttribute(positions,index).applyMatrix4(object.matrixWorld);
      point.set((point.x-center.x)*scale,(point.y-bounds.min.y)*scale,(point.z-center.z)*scale);
      if (point.y > definition.targetSize*.08) continue;
      point.applyAxisAngle(axis,yaw);
      height = Math.max(height, sample(x+point.x,z+point.z)-point.y);
    }
  });
  if (!Number.isFinite(height)) return sample(x,z);
  // A shallow embed also absorbs the existing cloud's root jitter, without
  // moving the ground or adding an opaque contact disk.
  return height - Math.min(.10, definition.targetSize*.025);
}
