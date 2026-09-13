import { Color, Vector3, MathUtils } from "three";

// Area sources specify actual emitter sizes, not just point positions.
const area = (color, intensity, position, width, height, target = [0, .2, 0]) => ({color,intensity,position,width,height,target});
export const C01_LIGHTING_RIGS = {
  amber: {
    ambient: {color:0xaa967f,intensity:.045},
    key: area(0xffdcae,6.5,[-3.7,2.1,4.8],3.8,5.2),
    front: area(0xadc4dd,1.2,[3,-.4,3.8],3.4,4.4,[0,-.25,0]),
    rim: area(0xffdeb2,20,[2.2,3.1,-3.6],2.2,3.6,[0,.7,0]),
    side: {color:0xc7dedd,intensity:0,position:[-4.8,1.7,-3.5]},
    low: {color:0x809bb3,intensity:2,position:[0,-2.4,2.8]},
  },

};

export function createC01ObservationLighting(lights) {
  const originals = Object.fromEntries(Object.entries(lights).map(([key,light]) => [key,{
    color:light.color.clone(), intensity:light.intensity, position:light.position.clone(), quaternion:light.quaternion.clone(),
    width:light.width, height:light.height,
  }]));
  const presets = Object.fromEntries(Object.entries(C01_LIGHTING_RIGS).map(([id,rig])=>[id,
    Object.fromEntries(Object.entries(rig).map(([key,p])=>[key,{
      ...p,color:new Color(p.color),position:p.position ? new Vector3(...p.position) : null,target:p.target ? new Vector3(...p.target) : null,
    }]))]));
  // C01 has one approved observation rig. Seed it at full weight so the first
  // entry frame already uses the final look instead of briefly showing q5.
  const weights = {amber:1};
  const color = new Color(), position = new Vector3(), target = new Vector3();
  return {
    reset() {
      for (const [key,light] of Object.entries(lights)) {
        const b=originals[key];light.color.copy(b.color);light.intensity=b.intensity;
        light.position.copy(b.position);light.quaternion.copy(b.quaternion);
        if (b.width !== undefined) {light.width=b.width;light.height=b.height;}
      }
    },
    update(id, strength, dt) {
      for (const key of Object.keys(weights)) weights[key]=MathUtils.damp(weights[key],key===id ? 1 : 0,5,dt);
      // The selected rig covers observation and the full mirror interaction.
      // Strength fades only for archive transitions; motion is applied afterward.
      const sum=Object.values(weights).reduce((a,b)=>a+b,0)*strength;
      if (sum<.00001) return;
      for (const [key,light] of Object.entries(lights)) {
        color.copy(light.color).multiplyScalar(1-sum);
        position.copy(light.position).multiplyScalar(1-sum);
        let intensity=light.intensity*(1-sum), width=(light.width??0)*(1-sum),height=(light.height??0)*(1-sum);
        // Blend source properties from the live q5 rig; never feed last frame's study back into it.
        for (const [id,rig] of Object.entries(presets)) {
          const w=weights[id]*strength,p=rig[key];
          if (!w) continue;
          color.r+=p.color.r*w;color.g+=p.color.g*w;color.b+=p.color.b*w;
          if (p.position) position.addScaledVector(p.position,w); else position.addScaledVector(originals[key].position,w);
          intensity+=p.intensity*w;width+=(p.width??0)*w;height+=(p.height??0)*w;
        }
        light.color.copy(color);light.position.copy(position);light.intensity=intensity;
        if (light.isRectAreaLight) {
          light.width=width;light.height=height;
          target.set(0,key==="front" ? -.2 : key==="rim" ? .35 : .15,0).multiplyScalar(1-sum);
          for (const [id,rig] of Object.entries(presets)) if (weights[id]) target.addScaledVector(rig[key].target,weights[id]*strength);
          light.lookAt(target);
        }
      }
    },
  };
}
