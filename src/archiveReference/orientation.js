import * as THREE from "three";

// C01's imported shape leans backwards: vector from its low root region
// (bottom 8% of source Y) to the twin-crown region (above 62% of source Y).
// Keep this anatomical axis explicit, rather than mistaking the widest box
// dimension for "up", or aligning the organism to the terrain's sloping normal.
export const C01_GROWTH_AXIS = Object.freeze([
  -.10892739611277041, .8060287728452981, -.581766654013097,
]);

export function archiveModelBounds(model) {
  // Rotating an old axis-aligned box introduces empty space beneath C01.
  // Use actual transformed vertices for that corrected asset only.
  return new THREE.Box3().setFromObject(model, model.name === "C01-upright");
}

export function orientArchiveModel(model, definition) {
  if (definition.id !== "C01") return model;
  const upright = new THREE.Group();
  upright.name = "C01-upright";
  upright.quaternion.setFromUnitVectors(
    new THREE.Vector3(...C01_GROWTH_AXIS), new THREE.Vector3(0,1,0),
  );
  // One correction before bounds, point sampling, hit targets and grounding.
  // Do not modify the shared GLB's nodes, materials or vertex buffers.
  upright.add(model.clone(true));
  upright.updateMatrixWorld(true);
  return upright;
}
