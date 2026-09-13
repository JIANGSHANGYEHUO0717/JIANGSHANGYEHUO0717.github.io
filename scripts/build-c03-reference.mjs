import { readFileSync, writeFileSync } from 'node:fs';
const data = JSON.parse(readFileSync('outputs/c03-blender-studio/blender-scene.json', 'utf8'));
const model = data.objects.find(o => o.type === 'MESH' && o.name.includes('主体'));
const ground = data.objects.find(o => o.type === 'MESH' && o.name.includes('地面'));
const material = data.materials[model.materials[0]];
const glass = material.find(n => n.label === '青蓝透明玻璃外壳');
const core = material.find(n => n.label === '白色内部枝状体');
const volume = material.find(n => n.type === 'ShaderNodeVolumeAbsorption');
const normal = material.find(n => n.type === 'ShaderNodeNormalMap');
const ramp = material.find(n => n.label === '边缘青蓝强化');
const coreMix = material.find(n => n.type === 'ShaderNodeMixRGB');
const layerWeight = material.find(n => n.type === 'ShaderNodeLayerWeight');
const groundMaterial = data.materials[ground.materials[0]].find(n => n.type === 'ShaderNodeBsdfPrincipled');
const parameters = n => Object.fromEntries(['Roughness', 'IOR', 'Transmission Weight', 'Coat Weight', 'Coat Roughness', 'Base Color'].map(k => [k,n.inputs[k]]));
const reference = {
  source: '类别三_玻璃材质_Codex.blend',
  model, ground, camera: data.objects.find(o => o.type === 'CAMERA'),
  lights: data.objects.filter(o => o.type === 'LIGHT'),
  worldStrength: data.world.find(n => n.type === 'ShaderNodeBackground').inputs.Strength,
  glass: parameters(glass), core: parameters(core), groundMaterial: parameters(groundMaterial),
  tintRamp: ramp.ramp, absorption: volume.inputs.Color.slice(0,3), density: volume.inputs.Density,
  tintBlend: layerWeight.inputs.Blend, tintInterpolation: ramp.interpolation,
  coreTint: coreMix.inputs.Color2.slice(0,3).map(v => 1-coreMix.inputs.Fac+coreMix.inputs.Fac*v),
  compositeBackground: data.compositor.find(n => n.type === 'CompositorNodeRGB').color.slice(0,3),
  normalStrength: normal.inputs.Strength, view: data.view, render: data.render,
};
writeFileSync('src/c03BlenderReference.json', JSON.stringify(reference,null,2)+'\n');
console.log(JSON.stringify({world:reference.worldStrength,ground:reference.groundMaterial,camera:reference.camera,render:reference.render}));
