import * as THREE from "three";

// Captures the first rear glass surface behind every visible front fragment.
// The resulting front/back distance drives one continuous glass law across the
// organism. There are no anatomical masks or hand-authored regional weights.
export function createC03ThicknessCapture(renderer, regionMask) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });
  target.texture.name = "C03 rear-surface depth";
  target.texture.generateMipmaps = false;

  const material = new THREE.ShaderMaterial({
    name: "C03 glass rear-surface depth capture",
    uniforms: { uRegionMask: { value: regionMask } },
    vertexShader: `
      varying vec2 vRegionUv;
      void main() {
        vRegionUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      #include <packing>
      uniform sampler2D uRegionMask;
      varying vec2 vRegionUv;
      void main() {
        if (texture2D(uRegionMask, vRegionUv).r < .46) discard;
        gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
      }
    `,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: true,
    blending: THREE.NoBlending,
    toneMapped: false,
  });

  const captureScene = new THREE.Scene();
  const links = [];
  const drawingSize = new THREE.Vector2();
  const oldClear = new THREE.Color();
  const lastCamera = new THREE.Matrix4();
  const lastProjection = new THREE.Matrix4();
  let lastWidth = 0, lastHeight = 0, initialized = false;

  const register = sourceMesh => {
    const captureMesh = new THREE.Mesh(sourceMesh.geometry, material);
    captureMesh.matrixAutoUpdate = false;
    captureMesh.frustumCulled = false;
    captureScene.add(captureMesh);
    links.push({ sourceMesh, captureMesh });
  };

  const update = camera => {
    renderer.getDrawingBufferSize(drawingSize);
    const width = Math.max(1, Math.round(drawingSize.x*.72));
    const height = Math.max(1, Math.round(drawingSize.y*.72));
    if (target.width !== width || target.height !== height) target.setSize(width, height);
    links.forEach(({ sourceMesh, captureMesh }) => captureMesh.matrix.copy(sourceMesh.matrixWorld));
    const changed = !initialized || width !== lastWidth || height !== lastHeight
      || !lastCamera.equals(camera.matrixWorld) || !lastProjection.equals(camera.projectionMatrix)
      || links.some(({sourceMesh,captureMesh}) => !captureMesh.userData.lastMatrix?.equals(sourceMesh.matrixWorld));
    if (!changed) return;
    initialized = true; lastWidth = width; lastHeight = height;
    lastCamera.copy(camera.matrixWorld); lastProjection.copy(camera.projectionMatrix);
    links.forEach(({sourceMesh,captureMesh}) => {
      captureMesh.userData.lastMatrix ??= new THREE.Matrix4();
      captureMesh.userData.lastMatrix.copy(sourceMesh.matrixWorld);
    });
    captureScene.updateMatrixWorld(true);

    const oldTarget = renderer.getRenderTarget();
    const oldAlpha = renderer.getClearAlpha();
    renderer.getClearColor(oldClear);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(captureScene, camera);
    renderer.setRenderTarget(oldTarget);
    renderer.setClearColor(oldClear, oldAlpha);
  };

  return {
    texture: target.texture,
    resolution: drawingSize,
    register,
    update,
    dispose() {
      target.dispose();
      material.dispose();
      captureScene.clear();
      links.length = 0;
    },
  };
}
