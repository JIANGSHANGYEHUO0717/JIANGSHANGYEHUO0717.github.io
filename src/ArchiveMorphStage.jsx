import { useEffect, useRef } from "react";
import * as THREE from "three";
import { ARCHIVE_ORGANISMS, preloadArchiveModels } from "./archiveAssets.js";
import { ARCHIVE_CAMERA, archiveFov, archivePlacement } from "./archiveReference/adapter.js";
import { archiveModelBounds } from "./archiveReference/orientation.js";
import { returnCloudColor, seedMorphFromEscape } from "./transitionContinuity.js";

const POINTS_PER_ORGANISM = 6400;
const TRANSITION_SECONDS = 5.2;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
let cachedMorphGeometryPromise = null;

function collectModelPoints(model, targetSize, maximum = 11000) {
  model.updateMatrixWorld(true);
  const box = archiveModelBounds(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = targetSize / Math.max(size.x, size.y, size.z, 0.0001);
  const meshes = [];
  let total = 0;
  model.traverse((object) => {
    if (!object.isMesh) return;
    const positions = object.geometry.getAttribute("position");
    if (!positions) return;
    meshes.push({ object, positions });
    total += positions.count;
  });
  const stride = Math.max(1, Math.ceil(total / maximum));
  const points = [];
  const point = new THREE.Vector3();
  let cursor = 0;
  meshes.forEach(({ object, positions }) => {
    for (let index = 0; index < positions.count; index += 1) {
      if (cursor % stride === 0) {
        point.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld);
        points.push(new THREE.Vector3(
          (point.x - center.x) * scale,
          (point.y - box.min.y) * scale,
          (point.z - center.z) * scale,
        ));
      }
      cursor += 1;
    }
  });
  return points;
}

function placePoint(point, definition) {
  return point.clone()
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(definition.rotation))
    .add(new THREE.Vector3(...definition.position));
}

function buildMorphGeometry(models) {
  const targetPools = models.map((model, index) => collectModelPoints(model, ARCHIVE_ORGANISMS[index].targetSize));
  const count = POINTS_PER_ORGANISM * ARCHIVE_ORGANISMS.length;
  const targets = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);

  ARCHIVE_ORGANISMS.forEach((definition, organismIndex) => {
    const terrainDefinition = { ...definition, position: archivePlacement(definition, 0, models[organismIndex]).position };
    const targetPool = targetPools[organismIndex];
    const tint = returnCloudColor(new THREE.Color(definition.tint).toArray(), definition.id);
    for (let index = 0; index < POINTS_PER_ORGANISM; index += 1) {
      const seed = (index * 0.61803398875 + organismIndex * 0.173) % 1;
      const targetIndex = (index * 11 + organismIndex * 53) % targetPool.length;
      const target = placePoint(targetPool[targetIndex], terrainDefinition);
      target.x += Math.sin(index * 2.17) * 0.012;
      target.y += Math.cos(index * 1.73) * 0.012;
      target.z += Math.sin(index * 1.29) * 0.012;
      // Interleave destinations so the existing escape grains head to all
      // five organisms; extra grains are not the sole source for C02–C05.
      const slot = index * ARCHIVE_ORGANISMS.length + organismIndex;
      target.toArray(targets, slot * 3);
      colors.set(tint, slot * 3);
      seeds[slot] = seed;
    }
  });

  const geometry = new THREE.BufferGeometry();
  // Only targets are cached. Starts are the live dispersed particles from the
  // current observation, with its actual pose and viewing angle.
  geometry.setAttribute("aTarget", new THREE.Float32BufferAttribute(targets, 3));
  geometry.setAttribute("aTint", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
  return geometry;
}

export function preloadArchiveMorph() {
  if (!cachedMorphGeometryPromise) {
    cachedMorphGeometryPromise = preloadArchiveModels().then((models) => buildMorphGeometry(models));
  }
  return cachedMorphGeometryPromise;
}

function createMorphMaterial({ size, opacity, smoke = false }) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uOpacity: { value: opacity },
      uSize: { value: size },
      uArchiveAngle: { value: 0 },
      uHandoff: { value: 0 },
      uSourceDpr: { value: 1 },
    },
    vertexShader: `
      uniform float uTime; uniform float uProgress; uniform float uSize; uniform float uArchiveAngle; uniform float uSourceDpr;
      attribute vec3 aTarget; attribute vec3 aTint; attribute float aSeed;
      attribute vec3 aVelocity; attribute float aSourceAlpha; attribute float aSourceSeed; attribute float aOriginal;
      varying vec3 vColor; varying float vAlpha;
      void main(){
        // Finish the spatial migration early enough to leave a readable
        // point-cloud-only hold before the softly escaping archive field fades in.
        float travel=smoothstep(.03,.62,uProgress);
        float arc=sin(travel*3.14159265);
        float c=cos(uArchiveAngle), s=sin(uArchiveAngle);
        vec3 target=vec3(c*aTarget.x+s*aTarget.z,aTarget.y,-s*aTarget.x+c*aTarget.z);
        vec3 delta=target-position;
        vec3 side=normalize(cross(normalize(delta+vec3(.0001)),vec3(0.0,1.0,.17))+.0001);
        vec3 curl=side*sin(uTime*(.42+aSeed*.28)+aSeed*19.0)*arc*(.28+aSeed*.58);
        curl.y+=cos(uTime*.31+aSeed*23.0)*arc*(.14+aSeed*.32);
        // Continue the escape's momentum before bending toward the five
        // destinations. There is no intact-C04 source shape in this shader.
        vec3 drift=aVelocity*(1.0-exp(-uTime*1.4))/1.4;
        vec3 p=mix(position+drift,target,travel)+curl;
        vec4 mv=modelViewMatrix*vec4(p,1.0);
        gl_Position=projectionMatrix*mv;
        float sourceSize=.044*(390.0/-mv.z)*(.55+aSourceSeed*.95)/uSourceDpr;
        gl_PointSize=mix(sourceSize,uSize*(420.0/-mv.z)*(.58+aSeed*.9),travel);
        vec3 sourceColor=mix(vec3(.28,.58,.62),vec3(.78,.91,.88),aSourceSeed);
        vColor=mix(sourceColor,aTint,smoothstep(.28,.78,travel));
        float birth=mix(smoothstep(.35,1.8,uTime),1.0,aOriginal);
        vAlpha=mix(aSourceAlpha*.8,(.62+aSeed*.38),travel)*birth;
        vAlpha*=1.0-smoothstep(.76,1.0,uProgress);
      }
    `,
    fragmentShader: `
      uniform float uOpacity; uniform float uHandoff; varying vec3 vColor; varying float vAlpha;
      void main(){
        float d=distance(gl_PointCoord,vec2(.5));
        if(d>.5) discard;
        float soft=smoothstep(.5,.045,d);
        gl_FragColor=vec4(vColor,soft*vAlpha*uOpacity*uHandoff);
      }
    `,
  });
}

export function ArchiveMorphStage({ onReady, onComplete, archiveAngle = 0, sourceSnapshot }) {
  const hostRef = useRef(null);
  const onReadyRef = useRef(onReady);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    const host = hostRef.current;
    const scene = new THREE.Scene();
    const sourceView = sourceSnapshot.camera;
    const camera = new THREE.PerspectiveCamera(sourceView.fov, 1, 0.01, 100);
    camera.position.set(...sourceView.position);
    camera.up.set(...sourceView.up);
    camera.lookAt(...sourceView.target);
    const sourceCamera = camera.position.clone();
    const sourceTarget = new THREE.Vector3(...sourceView.target);
    const archiveCamera = new THREE.Vector3(...ARCHIVE_CAMERA.position);
    const archiveTarget = new THREE.Vector3(...ARCHIVE_CAMERA.target);
    const target = new THREE.Vector3();
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(1, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    host.appendChild(renderer.domElement);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let disposed = false;
    let raf = 0;
    let geometry = null;
    let grainMaterial = null;
    let startedAt = 0;
    let completed = false;
    let performanceFrames = 0;
    let performanceWindowStart = 0;
    let performanceSamples = 0;

    preloadArchiveMorph().then((cachedGeometry) => {
      if (disposed) return;
      geometry = cachedGeometry.clone();
      const starts = seedMorphFromEscape(sourceSnapshot, POINTS_PER_ORGANISM * ARCHIVE_ORGANISMS.length);
      geometry.setAttribute("position", new THREE.BufferAttribute(starts.positions, 3));
      geometry.setAttribute("aVelocity", new THREE.BufferAttribute(starts.velocities, 3));
      geometry.setAttribute("aSourceAlpha", new THREE.BufferAttribute(starts.alphas, 1));
      geometry.setAttribute("aSourceSeed", new THREE.BufferAttribute(starts.seeds, 1));
      geometry.setAttribute("aOriginal", new THREE.BufferAttribute(starts.original, 1));
      host.dataset.sourcePoints = String(sourceSnapshot.alphas.length);
      grainMaterial = createMorphMaterial({ size: 0.052, opacity: 0.96 });
      grainMaterial.uniforms.uArchiveAngle.value = archiveAngle;
      grainMaterial.uniforms.uSourceDpr.value = sourceSnapshot.pixelRatio ?? 1;
      const grains = new THREE.Points(geometry, grainMaterial);
      grains.frustumCulled = false;
      grains.renderOrder = 2;
      scene.add(grains);
      startedAt = performance.now();
      performanceWindowStart = startedAt;
      onReadyRef.current?.();

      const animate = (now) => {
        if (disposed) return;
        const elapsed = (now - startedAt) / 1000;
        const progress = clamp(elapsed / TRANSITION_SECONDS);
        grainMaterial.uniforms.uTime.value = elapsed;
        grainMaterial.uniforms.uProgress.value = progress;
        grainMaterial.uniforms.uHandoff.value = THREE.MathUtils.smoothstep(elapsed, 0, .95);
        host.dataset.progress = progress.toFixed(4);
        // The last frame shares exactly the archive's camera and saved angle.
        const focus = THREE.MathUtils.smoothstep(progress, .03, .62);
        camera.position.lerpVectors(sourceCamera, archiveCamera, focus);
        target.lerpVectors(sourceTarget, archiveTarget, focus);
        camera.lookAt(target);
        camera.fov = THREE.MathUtils.lerp(sourceView.fov, archiveFov(camera.aspect), focus);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        performanceFrames += 1;
        if (now - performanceWindowStart >= 1000) {
          const fps = Math.round(performanceFrames * 1000 / (now - performanceWindowStart));
          window.__PROJECT4_DIAGNOSTICS__ = {
            ...(window.__PROJECT4_DIAGNOSTICS__ || {}),
            morphFps: fps,
            morphPoints: POINTS_PER_ORGANISM * ARCHIVE_ORGANISMS.length,
          };
          performanceSamples += 1;
          if (performanceSamples === 3 && new URLSearchParams(window.location.search).get("debug") === "1") {
            console.info(`[P2 PERF] morph ${fps} fps · ${POINTS_PER_ORGANISM * ARCHIVE_ORGANISMS.length} points · single pass`);
          }
          performanceFrames = 0;
          performanceWindowStart = now;
        }
        if (progress >= 1 && !completed) {
          completed = true;
          requestAnimationFrame(() => onCompleteRef.current?.());
          return;
        }
        raf = requestAnimationFrame(animate);
      };
      raf = requestAnimationFrame(animate);
    }).catch((error) => {
      console.error("Archive morph models failed to load", error);
      if (!disposed) onCompleteRef.current?.();
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      geometry?.dispose();
      grainMaterial?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="archive-morph-stage" aria-hidden="true" />;
}
