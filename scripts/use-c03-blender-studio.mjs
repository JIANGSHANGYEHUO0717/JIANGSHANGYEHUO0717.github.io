import { readFileSync, writeFileSync } from 'node:fs';
const path='src/OrganismStage.jsx';
let code=readFileSync(path,'utf8').replaceAll('\r\n','\n');
function replace(a,b) { if(!code.includes(a)) throw new Error('Missing source: '+a.slice(0,100)); code=code.replace(a,b); }
function between(a,b,replacement) { const start=code.indexOf(a),end=code.indexOf(b,start); if(start<0 || end<0) throw new Error('Missing block '+a); code=code.slice(0,start)+replacement+code.slice(end); }
replace('import { ShaderPass }', 'import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";\nimport { ShaderPass }');
replace('import { c03CoreMaterial, c03GlassMaterial, createC03StudioEnvironment, createC03StudioGround, createC03TransmissionBackdrop, preloadC03MaterialMask } from "./c03Glass.js";', 'import { preloadC03MaterialMask } from "./c03Glass.js";\nimport { createC03BlenderStudio, c03BlenderGlassMaterial, c03BlenderCoreMaterial } from "./c03BlenderStudio.js";');
between('    const c03Studio =', '    const mirror =', `    const c03Studio = isC03 ? createC03BlenderStudio(renderer, scene) : null;
    const observationPosition = c03Studio?.cameraPosition ?? OBSERVATION_POSITION;
    const observationTarget = c03Studio?.cameraTarget ?? OBSERVATION_TARGET;
    const currentObservationFov = aspect => c03Studio
      ? THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(c03Studio.fov/2))*Math.max(1,.92/aspect)))
      : observationFov(aspect);
    if (c03Studio) {
      camera.position.copy(observationPosition);
      controls.target.copy(observationTarget);
      controls.minDistance = 4.2;
      controls.maxDistance = 10.5;
      controls.update();
      host.dataset.c03Environment = "blender-white-world-four-area-lights";
      host.dataset.c03Background = "visible-white-studio";
      host.dataset.c03Output = "AgX-and-sRGB";
    }
`);
between('    const c03MatteTarget =', '    const composer =', '');
replace('    if (c03MattePass) composer.addPass(c03MattePass);\n','');
replace('    composer.addPass(bloom); composer.addPass(finish);', `    const c03Output = isC03 ? new OutputPass() : null;
    const c03Fade = isC03 ? new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uOpacity: { value: 1 } },
      vertexShader: "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: "uniform sampler2D tDiffuse; uniform float uOpacity; varying vec2 vUv; void main(){vec4 c=texture2D(tDiffuse,vUv);gl_FragColor=vec4(c.rgb,c.a*uOpacity);}",
    }) : null;
    if (isC03) { composer.addPass(c03Output); composer.addPass(c03Fade); }
    else { composer.addPass(bloom); composer.addPass(finish); }`);
between('    const c03Top =', '    const lightingStudy =', '    if (isC03) for (const light of [ambient,key,front,rim,side,low]) light.visible = false;\n');
between('    let c03MatteSignature =', '    const returnCamera =', '');
replace('      if (c03MatteModel) c03MatteModel.position.copy(base);\n','');
replace('c03CoreMaterial(source, c03Mask, c03ActivationUniforms)', 'c03BlenderCoreMaterial(source, c03Mask)');
replace('c03GlassMaterial(source, c03Mask, c03ActivationUniforms)', 'c03BlenderGlassMaterial(source, c03Mask)');
replace('c03-ivory-core-coverage-v2','c03-blender-core-coverage-v1');
replace('c03-bioglass-shell-coverage-v2','c03-blender-glass-coverage-v1');
replace('          c03MatteModel.add(new THREE.Mesh(geometry, c03MatteMaterial));\n','');
replace('      c03MatteSignature = null;\n','');
replace('      c03MatteTarget?.setSize(Math.max(1, Math.round(rect.width*.86)), Math.max(1, Math.round(rect.height*.86)));\n','');
// All camera movement, reset and entry/exit endpoints use the same C03 camera.
const restStart=code.indexOf('    const geometries =');
code=code.slice(0,restStart)+code.slice(restStart).replaceAll('OBSERVATION_POSITION','observationPosition').replaceAll('OBSERVATION_TARGET','observationTarget').replaceAll('observationFov(camera.aspect)','currentObservationFov(camera.aspect)');
between('      if (isC03) {\n        const control', '        front.position.set(3.6+', '      if (!isC03) {\n');
between('      if (c03MatteTarget && c03MatteScene) {', '      if (returning && returningMotion.contour', `      if (c03Fade) {
        c03Fade.uniforms.uOpacity.value = entering ? entry.focus : returning ? 1-THREE.MathUtils.smoothstep(uniforms.uDissolve.value,.08,.84) : 1;
      }
`);
replace('c03MattePass?.dispose(); c03MatteMaterial?.dispose(); c03MatteTarget?.dispose(); c03Ground?.dispose(); c03Backdrop?.dispose(); c03Studio?.dispose();', 'c03Output?.dispose(); c03Fade?.dispose(); c03Studio?.dispose();');
replace('"luminous-dormancy-field"', '"blender-white-studio-comparison"');
writeFileSync(path,code);
console.log('C03 studio integrated; other species keep their existing output pipeline.');
