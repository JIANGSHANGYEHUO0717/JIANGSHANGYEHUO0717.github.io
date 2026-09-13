// Sculpted, unequal ridge shoulders read from the approved terrain study.
// x, z, longitudinal radius, cross radius, angle, height, flank asymmetry.
// These are heightfield features, never visible curves or contour primitives.
const SHOULDERS = [
  [-5.2,-5.3,2.1,.9,-.35,1.10,.18],
  [-1.8,-6.15,1.5,.70,.28,1.12,-.23],
  [1.7,-5.6,2.3,.78,-.41,.96,.16],
  [4.9,-4.4,1.9,.91,.51,.85,-.18],
  [-5.1,-3.0,2.0,.72,-.30,.81,.22],
  [-3.1,-3.6,1.4,.56,.57,.81,-.18],
  [.3,-3.7,1.8,.58,-.24,.69,.20],
  [3.3,-3.0,1.9,.78,.52,.98,-.20],
  [5.0,-1.5,1.55,.67,-.53,.63,.26],
  [-5.5,-.4,1.9,.86,.43,.71,-.19],
  [-2.5,-.7,2.55,1.18,-.39,1.22,.21],
  [.2,-.1,1.15,.41,.77,.64,-.27],
  [2.6,.8,1.9,.88,-.27,.88,.22],
  [4.7,2.4,1.15,.74,.49,.70,-.20],
  [-5.0,2.8,1.75,.92,-.28,.77,.18],
  [-2.6,2.7,1.05,.54,.81,.66,-.20],
  [-.25,2.4,2.25,1.12,-.67,1.03,.26],
  [1.5,4.7,1.15,.7,.36,.63,-.17],
].map(([x,z,rx,rz,angle,height,skew])=>({x,z,rx,rz,c:Math.cos(angle),s:Math.sin(angle),height,skew}));

const fade=t=>t*t*t*(t*(t*6-15)+10);
const mix=(a,b,t)=>a+(b-a)*t;
function gradient(x,z,dx,dz,seed) {
  let h=Math.imul(x,374761393)^Math.imul(z,668265263)^seed;
  h=Math.imul(h^(h>>>13),1274126177);
  switch((h^(h>>>16))&7) {
    case 0:return dx; case 1:return -dx; case 2:return dz; case 3:return -dz;
    case 4:return (dx+dz)*.7071; case 5:return (dx-dz)*.7071;
    case 6:return (-dx+dz)*.7071; default:return (-dx-dz)*.7071;
  }
}
export function geologyNoise(x,z,seed=830) {
  const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;
  return mix(mix(gradient(ix,iz,fx,fz,seed),gradient(ix+1,iz,fx-1,fz,seed),fade(fx)),
    mix(gradient(ix,iz+1,fx,fz-1,seed),gradient(ix+1,iz+1,fx-1,fz-1,seed),fade(fx)),fade(fz))*1.65;
}

// A round crown with continuously changing slope, not an absolute-value ridge
// with a narrow turn at its top. Unequal radii/skew still keep each heap distinct.
export function soilMoundProfile(u,v) {
  return Math.exp(-.85*u*u-.72*v*v);
}

export function geologyMacroHeight(x,z,seed=830) {
  // Weak low-frequency displacement makes shoulders irregular without curling
  // the terrain into closed, equal-width brain folds.
  const wx=x+geologyNoise(x*.36+2,z*.36-3,seed+401)*.30;
  const wz=z+geologyNoise(x*.33-4,z*.33+1,seed+409)*.30;
  let volume=0;
  for(const p of SHOULDERS) {
    const dx=wx-p.x,dz=wz-p.z;
    const u=(dx*p.c+dz*p.s)/(p.rx*1.15);
    const across=-dx*p.s+dz*p.c;
    const v=across/(p.rz*1.25*(1+p.skew*Math.tanh(across*2)));
    if(Math.abs(u)>3.5 || Math.abs(v)>3.5)continue;
    const height=p.height*soilMoundProfile(u,v);
    volume+=height*height;
  }
  // Lower, broader heaps: preserve their arrangement without a steep skyline.
  return Math.sqrt(volume)*.72-.18;
}

export function geologyHeight(x,z,seed=830) {
  // Soil grain stays surface-scale instead
  // of introducing a second landscape of short ridges, pits and bright folds.
  const soil=geologyNoise(x*2.05-z*.72,z*2.05+x*.72,seed+431)*.010
    +geologyNoise(x*4.6+z*1.17,z*4.6-x*1.17,seed+433)*.004
    +geologyNoise(x*9.1,z*9.1,seed+439)*.0015;
  return geologyMacroHeight(x,z,seed)+soil;
}
