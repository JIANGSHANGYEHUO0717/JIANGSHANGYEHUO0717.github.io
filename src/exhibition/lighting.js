// Lighting in terrain-local space: the rig rotates with the exhibit.
// Bake once on the CPU; comparison switches GPU attributes without rebuilding.
const clamp = value => Math.max(0,Math.min(1,value));
const smooth = (a,b,value) => {
  const t=clamp((value-a)/(b-a));
  return t*t*(3-2*t);
};
const horizontalLength=Math.hypot(.80,.55);
const keyLength=Math.hypot(.80,.23,.55);
const keyDirection=[-.80/keyLength,.23/keyLength,-.55/keyLength];
const fillDirection=[.57,.50,.65];

export function dramaticLighting(sample,x,y,z,nx,ny,nz) {
  // A low left/back key throws a broad, soft shadow from the existing hills.
  // Visibility comes from real terrain heights, not painted dark bands.
  let horizon=-Infinity;
  for(let step=1;step<=24;step++) {
    const distance=.22+step*.42;
    const px=x-.80/horizontalLength*distance;
    const pz=z-.55/horizontalLength*distance;
    horizon=Math.max(horizon,(sample(px,pz)-y-.035)/distance);
  }
  const slope=.23/horizontalLength;
  const visibility=1-smooth(slope-.035,slope+.070,horizon);
  const key=smooth(.0,.46,nx*keyDirection[0]+ny*keyDirection[1]+nz*keyDirection[2]);
  const fill=clamp(nx*fillDirection[0]+ny*fillDirection[1]+nz*fillDirection[2]);
  const litKey=key*visibility;
  return {
    intensity:clamp(.055+.88*litKey+.12*fill),
    warmth:clamp(litKey*1.3),
    visibility,
  };
}
