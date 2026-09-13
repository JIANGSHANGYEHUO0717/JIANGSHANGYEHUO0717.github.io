import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const glbPath = path.join(projectRoot, "public", "assets", "observation", "category-5.glb");
const outputRoot = path.resolve(projectRoot, "..", "outputs", "c05-foundation-study", "model-analysis");
fs.mkdirSync(outputRoot, { recursive: true });

const buffer = fs.readFileSync(glbPath);
if (buffer.toString("utf8", 0, 4) !== "glTF") throw new Error("Not a binary glTF file");
let offset = 12;
let json = null;
let binary = null;
while (offset < buffer.length) {
  const length = buffer.readUInt32LE(offset);
  const type = buffer.readUInt32LE(offset + 4);
  const chunk = buffer.subarray(offset + 8, offset + 8 + length);
  if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8").replace(/\0+$/g, ""));
  if (type === 0x004e4942) binary = chunk;
  offset += 8 + length;
}
if (!json || !binary) throw new Error("Missing JSON or BIN chunk");

const exportedImages = [];
for (const [index, image] of (json.images ?? []).entries()) {
  if (image.bufferView == null) continue;
  const view = json.bufferViews[image.bufferView];
  const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const extension = image.mimeType === "image/png" ? "png" : image.mimeType === "image/jpeg" ? "jpg" : "bin";
  const safeName = String(image.name || `image-${index}`).replace(/[^a-z0-9._-]+/gi, "-");
  const fileName = `${String(index).padStart(2, "0")}-${safeName}.${extension}`;
  fs.writeFileSync(path.join(outputRoot, fileName), bytes);
  exportedImages.push({ index, name: image.name ?? null, mimeType: image.mimeType ?? null, fileName, bytes: bytes.length });
}

const accessorSummary = (json.accessors ?? []).map((accessor, index) => ({
  index,
  type: accessor.type,
  componentType: accessor.componentType,
  count: accessor.count,
  min: accessor.min,
  max: accessor.max,
}));

const report = {
  asset: json.asset,
  scene: json.scene,
  scenes: json.scenes,
  nodes: json.nodes,
  meshes: json.meshes,
  materials: json.materials,
  textures: json.textures,
  samplers: json.samplers,
  images: exportedImages,
  accessors: accessorSummary,
  bufferViews: json.bufferViews,
};
fs.writeFileSync(path.join(outputRoot, "analysis.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outputRoot, images: exportedImages, materials: json.materials, meshes: json.meshes }, null, 2));
