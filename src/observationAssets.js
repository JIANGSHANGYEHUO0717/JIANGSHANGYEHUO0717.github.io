import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { orientArchiveModel } from "./archiveReference/orientation.js";

export const OBSERVATION_ASSETS = Object.freeze({
  C01: "/assets/observation/category-1.glb",
  C02: "/assets/observation/category-2.glb",
  C03: "/assets/observation/category-3.glb",
  C05: "/assets/observation/category-5.glb",
});

const models = new Map();

// Load only the selected close-up. Archive points and hit targets keep their
// separate lightweight cache; C04 retains its approved specimen asset path.
export function preloadObservationModel(id) {
  const url = OBSERVATION_ASSETS[id];
  if (!url) return Promise.reject(new Error(`未知近景模型：${id}`));
  if (!models.has(id)) {
    const promise = new Promise((resolve, reject) => {
      new GLTFLoader().load(url, gltf => resolve(orientArchiveModel(gltf.scene, { id })), undefined, reject);
    }).catch(error => { models.delete(id); throw error; });
    models.set(id, promise);
  }
  return models.get(id);
}
