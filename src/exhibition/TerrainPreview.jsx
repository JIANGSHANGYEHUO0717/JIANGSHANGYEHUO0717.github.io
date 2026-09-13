import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { SETTINGS, advanceAngle, buildHeightField, generateTerrain, generateDepth } from "./terrain.js";

let cpuData;
function getTerrainData() {
  if (!cpuData) {
    const field = buildHeightField();
    cpuData = { field, points: generateTerrain(field), depth: generateDepth(field) };
  }
  return cpuData;
}

export default function TerrainPreview() {
  const hostRef = useRef(null);
  const runtimeRef = useRef(null);
  const query = new URLSearchParams(window.location.search);
  const clean = query.get("study") === "1";
  const debug = query.get("debug") === "1";
  const [paused, setPaused] = useState(() => clean || debug || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [angle, setAngle] = useState("0");
  const [lighting, setLighting] = useState(() => query.get('lighting')==='original' ? 'original' : 'dramatic');

  useEffect(() => { if (runtimeRef.current) runtimeRef.current.paused = paused; }, [paused]);
  useEffect(() => { runtimeRef.current?.setLighting(lighting); }, [lighting]);

  useEffect(() => {
    const host = hostRef.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      setError("当前浏览器无法显示三维地形，请使用支持 WebGL 2 的桌面浏览器。");
      return undefined;
    }
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 1);
    renderer.domElement.setAttribute("aria-label", "可旋转的真实三维点云地形");
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32.5, 1, .1, 100);
    camera.position.set(0, 11.4, 22.8);
    camera.lookAt(0, -.2, 0);
    const root = new THREE.Group();
    scene.add(root);
    const resources = [];
    let disposed = false;
    let raf = 0;
    let observer;
    let lastTime = 0;
    let measuredFrames = 0;
    let measuredAt = 0;
    let lastRender = 0;
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const runtime = { root, paused, render: () => {}, reset: () => {}, setLighting: () => {} };
    runtimeRef.current = runtime;

    // Defer expensive, one-time CPU generation so the loading status can paint.
    const start = window.setTimeout(() => {
      try {
        const data = getTerrainData();
        if (disposed) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(data.points.positions, 3));
        geometry.setAttribute("aColor", new THREE.BufferAttribute(data.points.colors, 3));
        geometry.setAttribute("aOpacity", new THREE.BufferAttribute(data.points.opacity, 1));
        geometry.setAttribute("aGrain", new THREE.BufferAttribute(data.points.grains, 1));
        geometry.setAttribute('aDramaticColor',new THREE.BufferAttribute(data.points.dramaticColors,3));
        geometry.setAttribute('aDramaticOpacity',new THREE.BufferAttribute(data.points.dramaticOpacity,1));
        geometry.computeBoundingSphere();
        const material = new THREE.ShaderMaterial({
          transparent: true, depthTest: true, depthWrite: false, blending: THREE.NormalBlending,
          uniforms: { uDpr: { value: renderer.getPixelRatio() }, uPointSize: { value: SETTINGS.pointSize }, uOpacity: { value: SETTINGS.pointOpacity }, uLighting:{value:lighting==='dramatic'?1:0} },
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
            uniform float uOpacity; varying vec3 vColor; varying float vOpacity;
            void main() {
              float radius = length(gl_PointCoord*2.0-1.0);
              float coverage = 1.0-smoothstep(.45,1.0,radius);
              if(coverage<=0.0) discard;
              gl_FragColor = vec4(vColor,min(1.0,vOpacity*uOpacity*coverage));
              #include <colorspace_fragment>
            }
          `,
        });
        const points = new THREE.Points(geometry, material);
        root.add(points);
        const depthGeometry = new THREE.BufferGeometry();
        depthGeometry.setAttribute("position", new THREE.BufferAttribute(data.depth.positions, 3));
        depthGeometry.setIndex(new THREE.BufferAttribute(data.depth.indices, 1));
        depthGeometry.computeBoundingSphere();
        const depthMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: true, depthWrite: true, side: THREE.FrontSide });
        const depthMesh = new THREE.Mesh(depthGeometry, depthMaterial);
        root.add(depthMesh);
        resources.push(geometry, material, depthGeometry, depthMaterial);
        host.dataset.points = String(data.points.opacity.length);
        host.dataset.models = "0";
        host.dataset.angle = "0.000000";
        host.dataset.ready = "true";

        const render = () => {
          if (disposed) return;
          renderer.render(scene, camera);
          host.dataset.angle = root.rotation.y.toFixed(6);
          host.dataset.calls = String(renderer.info.render.calls);
          host.dataset.lines = String(renderer.info.render.lines);
          host.dataset.triangles = String(renderer.info.render.triangles);
          host.dataset.rotation = runtime.paused ? "paused" : "clockwise";
          host.dataset.lighting = material.uniforms.uLighting.value ? 'dramatic' : 'original';
        };
        runtime.render = render;
        runtime.setLighting = value => { material.uniforms.uLighting.value=value==='dramatic'?1:0; render(); };
        const resize = () => {
          const rect = host.getBoundingClientRect();
          renderer.setSize(Math.max(1,rect.width), Math.max(1,rect.height), false);
          camera.aspect = rect.width/Math.max(1,rect.height);
          camera.fov = THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(32.5/2))*Math.max(1,(16/9)/camera.aspect)));
          camera.updateProjectionMatrix();
          render();
        };
        observer = new ResizeObserver(resize);
        observer.observe(host);
        resize();
        runtime.reset = () => { root.rotation.y = 0; render(); };
        const animate = now => {
          if (disposed) return;
          const dt = lastTime ? (now-lastTime)/1000 : 0;
          lastTime = now;
          if (!document.hidden && !runtime.paused) {
            root.rotation.y = advanceAngle(root.rotation.y, dt);
            // Slow-turning geometry does not need 144/240Hz redraws.
            if (now-lastRender >= 1000/60-.5) {
              render();
              lastRender = now;
              measuredFrames++;
            }
            if (!measuredAt) measuredAt = now;
            if (now-measuredAt >= 1000) {
              host.dataset.fps = (measuredFrames*1000/(now-measuredAt)).toFixed(1);
              measuredAt = now; measuredFrames = 0;
            }
          }
          raf = requestAnimationFrame(animate);
        };
        raf = requestAnimationFrame(animate);
        setReady(true);
      } catch (failure) {
        console.error("Terrain preview failed", failure);
        if (!disposed) setError("地形暂时未能完成加载，请刷新后重试。");
      }
    }, 60);
    const onVisibility = () => { lastTime = 0; if (!document.hidden) runtime.render(); };
    const onMotionChange = event => { if (event.matches) setPaused(true); };
    const onLost = event => { event.preventDefault(); setPaused(true); setError("三维显示已中断，请刷新页面重试。"); };
    document.addEventListener("visibilitychange", onVisibility);
    motionPreference.addEventListener("change", onMotionChange);
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    return () => {
      disposed = true;
      clearTimeout(start);
      cancelAnimationFrame(raf);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motionPreference.removeEventListener("change", onMotionChange);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      resources.forEach(resource => resource.dispose());
      renderer.dispose(); renderer.domElement.remove();
      runtimeRef.current = null;
    };
  }, []);

  const toggle = () => {
    setPaused(value => {
      if (runtimeRef.current) { runtimeRef.current.paused = !value; runtimeRef.current.render(); }
      return !value;
    });
  };
  const reset = () => { setPaused(true); setAngle("0"); if (runtimeRef.current) { runtimeRef.current.paused = true; runtimeRef.current.reset(); } };
  const changeAngle = value => {
    setAngle(value); setPaused(true);
    const runtime = runtimeRef.current;
    if (runtime) { runtime.paused = true; runtime.root.rotation.y = -Number(value)*Math.PI/180; runtime.render(); }
  };

  return <main className={`terrain-preview${clean ? " is-clean" : ""}`}>
    <div ref={hostRef} className="terrain-canvas" data-testid="terrain-canvas" aria-busy={!ready && !error} />
    {!clean && <header className="terrain-header"><h1>生态档案</h1><span>地形研究</span></header>}
    {!ready && !error && <p className="terrain-status" role="status">正在生成地形</p>}
    {error && <div className="terrain-status" role="alert"><p>{error}</p><button onClick={() => window.location.reload()}>重新加载</button></div>}
    {!clean && <footer className="terrain-footer">
      <p>纯点地貌<span>三维地形 / 180 秒一周</span></p>
      <nav aria-label="地形预览控制">
        <div className="terrain-lighting" role="group" aria-label="光照方案">
          <button disabled={!ready || Boolean(error)} aria-pressed={lighting==='original'} onClick={()=>setLighting('original')}>原光照</button>
          <button disabled={!ready || Boolean(error)} aria-pressed={lighting==='dramatic'} onClick={()=>setLighting('dramatic')}>戏剧光照</button>
        </div>
        <button disabled={!ready || Boolean(error)} onClick={toggle} aria-label={paused ? "开始顺时针旋转" : "暂停旋转"}>{paused ? "开始旋转" : "暂停旋转"}</button>
        <button disabled={!ready || Boolean(error)} onClick={reset}>参考视角</button>
      </nav>
    </footer>}
    {debug && <label className="terrain-debug">检查角度<select aria-label="检查旋转角度" value={angle} onChange={event => changeAngle(event.target.value)}><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>}
  </main>;
}
