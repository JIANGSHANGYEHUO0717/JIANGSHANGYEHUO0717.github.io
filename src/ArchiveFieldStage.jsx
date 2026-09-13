import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ARCHIVE_ORGANISMS, preloadArchiveModels } from "./archiveAssets.js";
import { archiveCloudEmphasis, buildArchiveCloud, createArchiveCloudMaterial } from "./archiveCloud.js";
import { createArchiveTerrain, ARCHIVE_CAMERA, archiveFov, archivePlacement, advanceAngle } from "./archiveReference/adapter.js";
import { archiveModelBounds } from "./archiveReference/orientation.js";

export { ARCHIVE_ORGANISMS } from "./archiveAssets.js";

const mix = (a, b, amount) => a + (b - a) * amount;


export function ArchiveFieldStage({ resetKey = 0, onInteractionChange, onReadyChange, terrainOnly = false, sessionRef, frozen = false, hideOrganisms = false, lang = "en" }) {
  const hostRef = useRef(null);
  const runtimeRef = useRef(null);
  const fallbackSession = useRef(null);
  const session = sessionRef ?? fallbackSession;
  if (!session.current) session.current = {
    angle: 0,
    paused: terrainOnly || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;
  const hideOrganismsRef = useRef(hideOrganisms);
  hideOrganismsRef.current = hideOrganisms;
  const [paused, setPaused] = useState(session.current.paused);
  const [ready, setReady] = useState(false);
  const debug = new URLSearchParams(window.location.search).get("debug") === "1";
  const setRotation = (pause, angle) => {
    session.current.paused = pause;
    if (angle !== undefined) session.current.angle = angle;
    setPaused(pause);
  };

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.clickedId = null;
    runtime.candidateId = null;
    runtime.lastPhase = "default";
    onInteractionChange?.({ phase: "default", id: null });
  }, [resetKey, onInteractionChange]);

  useEffect(() => {
    const host = hostRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const camera = new THREE.PerspectiveCamera(ARCHIVE_CAMERA.fov, 1, .1, 100);
    camera.position.set(...ARCHIVE_CAMERA.position);
    camera.lookAt(...ARCHIVE_CAMERA.target);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    host.appendChild(renderer.domElement);

    const terrain = createArchiveTerrain(renderer.getPixelRatio());
    const exhibition = new THREE.Group();
    exhibition.rotation.y = session.current.angle;
    exhibition.add(terrain.group);
    scene.add(exhibition);
    host.dataset.points = String(terrain.pointGeometry.getAttribute("position").count);

    const organisms = [];
    let pointerDirty = true;
    const disposableGeometries = [terrain.pointGeometry, terrain.depthGeometry];
    const disposableMaterials = [terrain.pointMaterial, terrain.depthMaterial];
    let disposed = false;
    session.current.entryClouds = {};

    if (terrainOnly) { onReadyChange?.(true); setReady(true); }
    else preloadArchiveModels().then((cachedModels) => Promise.all(ARCHIVE_ORGANISMS.map((definition, definitionIndex) => new Promise((resolve) => {
      queueMicrotask(() => {
        if (disposed) return resolve();
        const root = new THREE.Group();
        root.visible = !hideOrganismsRef.current;
        const model = cachedModels[definitionIndex].clone(true);
        const box = archiveModelBounds(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const scale = definition.targetSize / Math.max(size.x, size.y, size.z, 0.0001);
        const normalization = new THREE.Group();
        normalization.scale.setScalar(scale);
        normalization.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
        normalization.add(model);
        root.position.set(...archivePlacement(definition, 0, cachedModels[definitionIndex]).position);
        root.rotation.y = THREE.MathUtils.degToRad(definition.rotation);
        root.add(normalization);
        exhibition.add(root);

        const meshes = [];
        model.traverse((object) => {
          if (!object.isMesh) return;
          // Invisible source meshes are hit targets only. Three's raycaster
          // still tests them; no solid or edge material can reappear on hover.
          object.visible = false;
          meshes.push(object);
        });
        const geometry = buildArchiveCloud(cachedModels[definitionIndex], definition.targetSize, 73 + definitionIndex * 101);
        const material = createArchiveCloudMaterial(definition.tint, definition.targetSize);
        material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
        const points = new THREE.Points(geometry, material);
        root.add(points);
        disposableGeometries.push(geometry);
        disposableMaterials.push(material);
        organisms.push({ ...definition, root, model, meshes, cloudMaterial: material });
        {
          session.current.entryClouds[definition.id] = {
            id: definition.id,
            geometry, material,
            release: () => {
              root.visible = false;
              // Clear the selected cloud from the source canvas in the same
              // frame that the destination presents the identical cloud.
              renderer.render(scene, camera);
            },
          };
          if (definition.id === "C04") session.current.entryCloud = session.current.entryClouds.C04;
        }
        resolve();
      });
    })))).then(() => {
      pointerDirty = true;
      if (!disposed) {
        session.current.revealReturnClouds = () => {
          organisms.forEach(({ root, cloudMaterial }) => {
            root.visible = true;
            cloudMaterial.uniforms.uTime.value = session.current.cloudTime ?? 0;
            cloudMaterial.uniforms.uEmphasis.value = 1;
          });
          renderer.render(scene, camera);
        };
        onReadyChange?.(true); setReady(true);
      }
    }).catch((error) => {
      console.error("Archive models failed to load", error);
      if (!disposed) onReadyChange?.(false);
    });

    const pointer = new THREE.Vector2(3, 3);
    const raycaster = new THREE.Raycaster();
    let clickedId = null;
    let candidateId = null;
    let lastPhase = "default";
    let lastPointerPosition = null;

    const emit = (phase, id, pointerPosition = null) => {
      const pointerMoved=pointerPosition&&(!lastPointerPosition||Math.hypot(pointerPosition.x-lastPointerPosition.x,pointerPosition.y-lastPointerPosition.y)>.012);
      if (phase === lastPhase && id === candidateId && !pointerMoved) return;
      lastPhase = phase;
      candidateId = id;
      lastPointerPosition=pointerPosition;
      onInteractionChange?.({ phase, id, pointer:pointerPosition });
    };

    const updatePointer = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      pointerDirty = true;
    };

    const onPointerMove = (event) => {
      if (clickedId) return;
      updatePointer(event);
    };
    const onPointerLeave = () => {
      if (clickedId) return;
      pointer.set(3, 3);
      pointerDirty = false;
      emit("default", null);
    };
    const onClick = (event) => {
      if (frozenRef.current || clickedId) return;
      // Resolve the actual click/touch location, not a stale hover candidate.
      updatePointer(event);
      exhibition.rotation.y = session.current.angle;
      scene.updateMatrixWorld(true);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(organisms.flatMap((organism) => organism.meshes), false);
      const chosen = hits.length ? organisms.find((organism) => organism.meshes.includes(hits[0].object))?.id : null;
      if (!chosen) return;
      clickedId = chosen;
      runtimeRef.current.clickedId = clickedId;
      emit("clicked", clickedId,{x:(pointer.x+1)/2,y:(1-pointer.y)/2});
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      clickedId = null;
      pointer.set(3, 3);
      runtimeRef.current.clickedId = null;
      emit("default", null);
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("click", onClick);
    window.addEventListener("keydown", onKeyDown);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.fov = archiveFov(camera.aspect);
      camera.updateProjectionMatrix();
      pointerDirty = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const projected = new THREE.Vector3();
    const clock = new THREE.Clock();
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = motionPreference.matches;
    let cloudTime = session.current.cloudTime ?? 0;
    let lastElapsed = 0;
    const updateMotionPreference = (event) => {
      reducedMotion = event.matches;
      if (reducedMotion) { session.current.paused = true; setPaused(true); }
    };
    motionPreference.addEventListener("change", updateMotionPreference);
    let performanceFrames = 0;
    let performanceWindowStart = performance.now();
    let performanceSamples = 0;
    const debugEnabled = new URLSearchParams(window.location.search).get("debug") === "1";
    const steadyFrames = [];
    let previousFrameTime = performance.now();
    let raf = 0;
    let lastHitTest = 0;
    const onVisibility = () => { lastElapsed = clock.getElapsedTime(); };
    document.addEventListener("visibilitychange", onVisibility);
    runtimeRef.current = {
      get clickedId() { return clickedId; },
      set clickedId(value) {
        clickedId = value;
        if (!value) organisms.forEach(organism => { organism.root.visible = !hideOrganismsRef.current; });
        pointerDirty = true;
      },
      get candidateId() { return candidateId; },
      set candidateId(value) { candidateId = value; },
      get lastPhase() { return lastPhase; },
      set lastPhase(value) { lastPhase = value; },
    };

    const animate = () => {
      const elapsed = clock.getElapsedTime();
      const dt = Math.min(.1, Math.max(0, elapsed - lastElapsed));
      lastElapsed = elapsed;
      if (document.hidden) { raf = requestAnimationFrame(animate); return; }
      if (hideOrganismsRef.current) cloudTime = session.current.cloudTime ?? cloudTime;
      else {
        if (!reducedMotion) cloudTime += dt;
        session.current.cloudTime = cloudTime;
      }
      const rotating = !session.current.paused && !frozenRef.current && !clickedId;
      if (rotating) session.current.angle = advanceAngle(session.current.angle, dt);
      if (exhibition.rotation.y !== session.current.angle) pointerDirty = true;
      exhibition.rotation.y = session.current.angle;
      scene.updateMatrixWorld(true);
      host.dataset.angle = session.current.angle.toFixed(6);
      host.dataset.rotation = rotating ? "clockwise" : "paused";
      host.dataset.models = String(organisms.length);
      host.dataset.ready = String(terrainOnly || organisms.length === 5);
      host.dataset.cloudsHidden = String(hideOrganismsRef.current);
      let nearest = null;
      let nearestDistance = Infinity;
      let directHit = null;
      // Rotation moves the targets under a still cursor. Throttle hover tests,
      // but always resolve actual clicks immediately against world transforms.
      if (!clickedId && !frozenRef.current && organisms.length && pointerDirty && Math.abs(pointer.x) <= 1 && elapsed - lastHitTest >= .034) {
        lastHitTest = elapsed;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(organisms.flatMap((organism) => organism.meshes), false);
        if (hits.length) {
          directHit = organisms.find((organism) => organism.meshes.includes(hits[0].object))?.id || null;
        }
        organisms.forEach((organism) => {
          projected.set(0, 1.2, 0);
          organism.root.localToWorld(projected).project(camera);
          const distance = Math.hypot(projected.x - pointer.x, projected.y - pointer.y * 0.92);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = organism.id;
          }
        });
        const nextId = directHit || (nearestDistance < 0.22 ? nearest : null);
        const nextPhase = directHit || nearestDistance < 0.1 ? "locked" : nextId ? "approach" : "default";
        emit(nextPhase, nextId,{x:(pointer.x+1)/2,y:(1-pointer.y)/2});
        pointerDirty = false;
      }

      const activeId = clickedId || candidateId;
      organisms.forEach((organism) => {
        const selected = organism.id === activeId;
        const emphasis = archiveCloudEmphasis(selected, Boolean(clickedId) && !selected);
        const uniforms = organism.cloudMaterial.uniforms;
        uniforms.uTime.value = cloudTime;
        uniforms.uEmphasis.value = mix(uniforms.uEmphasis.value, emphasis, 1 - Math.exp(-dt * 4));
      });


      renderer.render(scene, camera);
      performanceFrames += 1;
      const performanceNow = performance.now();
      if (debugEnabled && (organisms.length === 5 || terrainOnly) && performanceSamples >= 4 && performanceSamples < 14 && steadyFrames.length < 3000) {
        steadyFrames.push(performanceNow - previousFrameTime);
      }
      previousFrameTime = performanceNow;
      if (performanceNow - performanceWindowStart >= 1000) {
        window.__PROJECT4_DIAGNOSTICS__ = {
          ...(window.__PROJECT4_DIAGNOSTICS__ || {}),
          archiveFps: Math.round(performanceFrames * 1000 / (performanceNow - performanceWindowStart)),
          archiveModels: organisms.length,
          archiveRenderer: renderer.info.render,
        };
        performanceSamples += 1;
        if (performanceSamples === 4 && debugEnabled) {
          console.info(`[P2 PERF] archive ${window.__PROJECT4_DIAGNOSTICS__.archiveFps} fps · ${organisms.length} clouds · ${terrain.pointGeometry.getAttribute("position").count} terrain points · ${renderer.info.render.lines} line segments · ${renderer.info.render.triangles} depth triangles · ${renderer.info.render.calls} draws`);
        }
        if (performanceSamples === 14 && debugEnabled && steadyFrames.length) {
          const duration = steadyFrames.reduce((sum, frame) => sum + frame, 0);
          const ordered = [...steadyFrames].sort((a,b) => a-b);
          const p95 = ordered[Math.min(ordered.length-1, Math.floor(ordered.length*.95))];
          console.info(`[P2 TERRAIN CHECK] ${(duration/1000).toFixed(1)}s sample · ${(1000*steadyFrames.length/duration).toFixed(1)} fps mean · ${p95.toFixed(1)}ms p95 frame · ${renderer.domElement.clientWidth}×${renderer.domElement.clientHeight} CSS · DPR ${renderer.getPixelRatio()}`);
        }
        performanceFrames = 0;
        performanceWindowStart = performanceNow;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
      motionPreference.removeEventListener("change", updateMotionPreference);
      document.removeEventListener("visibilitychange", onVisibility);
      disposableGeometries.forEach((geometry) => geometry.dispose());
      disposableMaterials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      session.current.entryCloud = null;
      session.current.entryClouds = null;
      session.current.revealReturnClouds = null;
      runtimeRef.current = null;
    };
  }, [onInteractionChange, onReadyChange, terrainOnly, session]);

  return <>
    <div className="archive-webgl" ref={hostRef} aria-label={terrainOnly ? "纯地形视觉校对" : "五体档案场交互区域"} />
    {!terrainOnly && <nav className="archive-rotation" aria-label="档案场旋转控制">
      <button disabled={!ready || frozen} onClick={() => setRotation(!paused)}>{lang==="en"?(paused?"START ROTATION":"PAUSE ROTATION"):(paused?"开始旋转":"暂停旋转")}</button>
      <button disabled={!ready || frozen} onClick={() => setRotation(true, 0)}>{lang==="en"?"REFERENCE VIEW":"参考视角"}</button>
    </nav>}
    {debug && <div className="archive-angle-check" role="group" aria-label="旋转角度检查">
      {[0, 90, 180, 270].map(degrees => <button key={degrees} disabled={!ready || frozen} onClick={() => setRotation(true, -degrees * Math.PI / 180)}>{degrees}°</button>)}
    </div>}
  </>;
}
