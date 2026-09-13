import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

let specimenPromise;
export function preloadSpecimenModel() {
  if (!specimenPromise) {
    specimenPromise = new Promise((resolve, reject) => {
      new GLTFLoader().load("/assets/category4.glb", (gltf) => resolve(gltf.scene), undefined, reject);
    }).catch((error) => {
      specimenPromise = undefined;
      throw error;
    });
  }
  return specimenPromise;
}
