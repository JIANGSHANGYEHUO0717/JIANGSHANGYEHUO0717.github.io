import * as THREE from "three";

const visible = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 1) > .45;

export function createC05TomographyState() {
  return { mix:0, center:.5, thickness:.18, dwell:0, trail:0, demoSeen:0, demoAge:99, mode:"idle", lastCenter:.5 };
}

export function updateC05Tomography(state,{dt,time,control,active=true}) {
  if((control?.demo??0)!==state.demoSeen){state.demoSeen=control.demo;state.demoAge=0;}
  state.demoAge+=dt;
  const demo=state.demoAge<10.5;
  const wrists=[control?.points?.[15],control?.points?.[16]];
  const hands=wrists.every(visible);
  let targetMix=0,targetCenter=state.center,targetThickness=state.thickness;
  if(active&&(demo||hands)){
    targetMix=1;
    if(demo){
      const p=THREE.MathUtils.clamp(state.demoAge/8.8,0,1);
      targetCenter=.12+p*.78+Math.sin(time*.72)*.025;
      targetThickness=.12+.09*(.5+.5*Math.sin(time*.47+1));
    }else{
      targetCenter=THREE.MathUtils.clamp(1-(wrists[0].y+wrists[1].y)*.5,.06,.94);
      targetThickness=THREE.MathUtils.clamp(.075+Math.abs(wrists[0].x-wrists[1].x)*.36,.09,.30);
    }
  }
  const speed=Math.abs(targetCenter-state.lastCenter)/Math.max(dt,.001);
  state.lastCenter=targetCenter;
  state.dwell=THREE.MathUtils.damp(state.dwell,targetMix&&speed<.12?1:0,2.2,dt);
  state.mix=THREE.MathUtils.damp(state.mix,targetMix,targetMix?4.2:1.35,dt);
  state.trail=THREE.MathUtils.damp(state.trail,Math.max(state.mix,state.dwell*.9),targetMix?3.2:.72,dt);
  state.center=THREE.MathUtils.damp(state.center,targetCenter,5,dt);
  state.thickness=THREE.MathUtils.damp(state.thickness,targetThickness,4,dt);
  state.mode=state.mix>.08?(demo?"demo":hands?"hands":"afterglow"):"idle";
  return state;
}
