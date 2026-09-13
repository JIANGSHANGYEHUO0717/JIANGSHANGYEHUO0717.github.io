import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { orientArchiveModel } from "./archiveReference/orientation.js";

export const ARCHIVE_ORGANISMS = [
  { id: "C01", url: "/assets/archive/category-1.glb", position: [-5.8, 0, -3.4], rotation: 8, targetSize: 3.58, tint: 0xc56a32 },
  { id: "C02", url: "/assets/archive/category-2.glb", position: [.2, 0, -5.8], rotation: -4, targetSize: 3.48, tint: 0xa8b5c4 },
  { id: "C03", url: "/assets/archive/category-3.glb", position: [6.2, 0, -1.9], rotation: -10, targetSize: 3.42, tint: 0x6d9caf },
  { id: "C04", url: "/assets/archive/category-4.glb", position: [2.8, 0, 4.9], rotation: -3, targetSize: 3.4, tint: 0x9ad9e5 },
  { id: "C05", url: "/assets/archive/category-5.glb", position: [-4.6, 0, 3.7], rotation: 10, targetSize: 3.0, tint: 0x9b9277 },
];

let archiveModelsPromise = null;

function loadModel(loader, url) {
  return new Promise((resolve, reject) => loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject));
}

export function preloadArchiveModels() {
  if (!archiveModelsPromise) {
    const loader = new GLTFLoader();
    archiveModelsPromise = Promise.all(ARCHIVE_ORGANISMS.map(({ url }) => loadModel(loader, url)))
      .then(models => models.map((model,index) => orientArchiveModel(model,ARCHIVE_ORGANISMS[index])))
      .catch(error => { archiveModelsPromise = null; throw error; });
  }
  return archiveModelsPromise;
}
