import * as THREE from "three";
import { SETTINGS, buildHeightField, sampleHeight, generateTerrain, generateDepth } from "./terrain.js";
import { footprintContactHeight } from "./grounding.js";
export { advanceAngle } from "./terrain.js";

// Geometry and light generation are verbatim copies of the confirmed snapshot.
// This adapter only supplies the existing archive with GPU resources and placement.
export const ARCHIVE_CAMERA = Object.freeze({ position: [0, 11.4, 22.8], target: [0, -.2, 0], fov: 32.5 });
// q1 hierarchy: attenuate only the terrain's display luminance, not its geometry,
// density, mineral hue, local shadow pattern, edge fade or the organism material.
export const ARCHIVE_GROUND_BRIGHTNESS = .34;
export function archiveFov(aspect) {
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(32.5 / 2)) * Math.max(1, (16 / 9) / aspect)));
}
let field;
let cpuData;
export function terrainField() { return field ??= buildHeightField(); }
const groundingCache = new WeakMap();
export function archivePlacement(definition, angle = 0, model = null) {
  const [x, , z] = definition.position;
  let height = sampleHeight(terrainField(), x, z) + .012;
  if (definition.id === "C01" && model) {
    const key = JSON.stringify([definition.position,definition.rotation,definition.targetSize]);
    let cached = groundingCache.get(model);
    if (!cached || cached.key !== key) {
      cached = { key, height: footprintContactHeight(model,definition,(px,pz) => sampleHeight(terrainField(),px,pz)) };
      groundingCache.set(model,cached);
    }
    height = cached.height;
  }
  const position = new THREE.Vector3(x, height, z)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  const yaw = THREE.MathUtils.degToRad(definition.rotation) + angle;
  return { position: position.toArray(), yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)) };
}
export function createArchiveTerrain(dpr = 1, lighting = "dramatic") {
  if (!cpuData) {
    const field = terrainField();
    cpuData = { points: generateTerrain(field), depth: generateDepth(field) };
  }
  const data = cpuData;
  const group = new THREE.Group();
  const pointGeometry = new THREE.BufferGeometry();
  for (const [name, key, size] of [
    ["position","positions",3], ["aColor","colors",3], ["aOpacity","opacity",1],
    ["aGrain","grains",1], ["aDramaticColor","dramaticColors",3], ["aDramaticOpacity","dramaticOpacity",1]
  ]) pointGeometry.setAttribute(name, new THREE.BufferAttribute(data.points[key], size));
  pointGeometry.computeBoundingSphere();
  const pointMaterial = new THREE.ShaderMaterial({
          transparent: true, depthTest: true, depthWrite: false, blending: THREE.NormalBlending,
          uniforms: { uDpr: { value: dpr }, uPointSize: { value: SETTINGS.pointSize }, uOpacity: { value: SETTINGS.pointOpacity }, uLighting:{value:lighting==='dramatic'?1:0}, uGroundBrightness: {value: ARCHIVE_GROUND_BRIGHTNESS} },
          vertexShader: `
            attribute vec3 aColor; attribute float aOpacity; attribute float aGrain;
            attribute vec3 aDramaticColor; attribute float aDramaticOpacity;
            uniform float uLighting;
            uniform float uDpr; uniform float uPointSize;
            varying vec3 vColor; varying float vOpacity;
            void main() {
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              gl_Position = projectionMatrix * mv;
              float size = clamp(uPointSize * pow(23.0/max(1.0,-mv.z), .60), .9, 2.45);
              gl_PointSize = max(1.0, size*uDpr*(.86+aGrain*.27));
              vColor = mix(aColor,aDramaticColor,uLighting);
              vOpacity = mix(aOpacity,aDramaticOpacity,uLighting) * min(1.0,size*size*uDpr*uDpr);
            }
          `,
          fragmentShader: `
            uniform float uOpacity; uniform float uGroundBrightness; varying vec3 vColor; varying float vOpacity;
            void main() {
              float radius = length(gl_PointCoord*2.0-1.0);
              float coverage = 1.0-smoothstep(.45,1.0,radius);
              if(coverage<=0.0) discard;
              gl_FragColor = vec4(vColor,min(1.0,vOpacity*uOpacity*coverage));
              #include <colorspace_fragment>
              gl_FragColor.rgb *= uGroundBrightness;
            }
          `,
        });
  group.add(new THREE.Points(pointGeometry, pointMaterial));
  const depthGeometry = new THREE.BufferGeometry();
  depthGeometry.setAttribute("position", new THREE.BufferAttribute(data.depth.positions, 3));
  depthGeometry.setIndex(new THREE.BufferAttribute(data.depth.indices, 1));
  depthGeometry.computeBoundingSphere();
  const depthMaterial = new THREE.MeshBasicMaterial({color:0x000000,depthTest:true,depthWrite:true,side:THREE.FrontSide});
  group.add(new THREE.Mesh(depthGeometry, depthMaterial));
  return { group, pointGeometry, pointMaterial, depthGeometry, depthMaterial };
}
