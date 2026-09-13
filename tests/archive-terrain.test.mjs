import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { TERRAIN_SETTINGS, TERRAIN_PADS, terrainHeight, terrainEdge, terrainFarFade, terrainVisibility, terrainInteriorWeight, terrainReadability, generateTerrainPoints, generateTerrainDepth, createArchiveTerrain } from "../src/archiveTerrain.js";
import { geologyHeight, geologyMacroHeight, soilMoundProfile } from "../src/terrainGeology.js";

const data = generateTerrainPoints();

test("terrain uses a bounded, deterministic desktop point budget", () => {
  assert.ok(data.alphas.length >= 65000 && data.alphas.length <= 108478);
  const copy = generateTerrainPoints();
  for (const key of ["positions","colors","alphas","grains","exposures"]) assert.deepEqual(data[key],copy[key]);
  assert.ok(data.alphas.every(v => v >= 0 && v <= 1));
  assert.ok(data.colors.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
});

test("five landing pads are flat and overlap blending is order independent", () => {
  for (const pad of TERRAIN_PADS) {
    assert.ok(Math.abs(terrainHeight(pad.x,pad.z)-pad.height) < 1e-10);
    assert.ok(Math.abs(terrainHeight(pad.x+.2,pad.z-.2)-pad.height) < 1e-10);
  }
  const overlapping = [
    {x:0,z:0,height:0,innerRadius:1,outerRadius:3},
    {x:1,z:1,height:.2,innerRadius:1,outerRadius:3},
  ];
  assert.ok(Math.abs(terrainHeight(.2,.3,overlapping)-terrainHeight(.2,.3,[...overlapping].reverse())) < 1e-12);
});

test("interior points break straight rows while staying on a rugged low heightfield", () => {
  const {radiusX,radiusZ,columns,rows,pointLift} = TERRAIN_SETTINGS;
  const width=radiusX*2.2, depth=radiusZ*2.2;
  const dx=width/(columns-1), dz=depth/(rows-1);
  let interiorSamples=0, offGrid=0, maximumHeight=-Infinity;
  for (let i=0;i<data.positions.length;i+=3*137) {
    const [x,y,z]=data.positions.subarray(i,i+3);
    assert.ok(Math.abs(y-terrainHeight(x,z)-pointLift) < .000001);
    // Rear peaks now continue into the fade, but remain under half a specimen.
    assert.ok(y > -.7 && y < 1.55);
    maximumHeight=Math.max(maximumHeight,y);
    const gx=Math.round((x+width/2)/dx)*dx-width/2;
    const gz=Math.round((z+depth/2)/dz)*dz-depth/2;
    const deviation=Math.max(Math.abs((x-gx)/dx),Math.abs((z-gz)/dz));
    assert.ok(deviation <= .501);
    if (terrainInteriorWeight(x,z)>.99) {
      interiorSamples++;
      if (deviation>.25) offGrid++;
    }
  }
  assert.ok(maximumHeight>.65);
  assert.ok(offGrid/interiorSamples>.5);
});

test("soil stays shallow while the large landforms retain their relief", () => {
  let totalRoughness=0, count=0, minMacro=Infinity, maxMacro=-Infinity;
  for(let x=-4;x<=4;x+=.13) for(let z=-3;z<=3;z+=.13) {
    const macro=geologyMacroHeight(x,z);
    const roughness=Math.abs(geologyHeight(x,z)-macro);
    assert.ok(roughness<.02,"soil must not form separate small hills");
    totalRoughness+=roughness; count++;
    minMacro=Math.min(minMacro,macro); maxMacro=Math.max(maxMacro,macro);
  }
  assert.ok(totalRoughness/count>.001 && totalRoughness/count<.006);
  assert.ok(maxMacro-minMacro>.8,"the large landforms must not be flattened");
});

test("soil crowns are broad and rounded rather than sharp dune ridges", () => {
  assert.equal(soilMoundProfile(0,0),1);
  assert.ok(soilMoundProfile(0,.25)>.95,"crown must roll gently into its shoulder");
  for(const axis of [0,1]) {
    const sample=t=>axis===0 ? soilMoundProfile(t,0) : soilMoundProfile(0,t);
    const h=.001;
    assert.ok(Math.abs((sample(h)-sample(-h))/(2*h))<1e-10);
    assert.ok(Math.abs((sample(h)-2*sample(0)+sample(-h))/(h*h))<2);
    for(let t=.05;t<=2;t+=.05) assert.ok(sample(t)<sample(t-.05));
  }
});

test("convex highlights are brighter and sampled more densely than recesses", () => {
  const bright=terrainReadability(.45,.07,.8);
  const dark=terrainReadability(.05,-.05,.25);
  assert.ok(bright.brightness>dark.brightness*2);
  assert.ok(bright.density>dark.density*1.7);
  const {crest,recess}=data.samplingStats;
  assert.ok(crest.candidates>100 && recess.candidates>100);
  assert.ok(crest.kept/crest.candidates>(recess.kept/recess.candidates)*1.6);
});

test("approved irregular fade law is unchanged while the terrain can reshape", () => {
  // The user approved fading, not freezing the outer land into a flat shelf.
  // Lock the original continuous fade, independent of the sculpted heightfield.
  const edge=[];
  for(let i=0;i<=100;i++)for(let j=0;j<=100;j++)edge.push(terrainEdge((i/100-.5)*24,(j/100-.5)*20));
  assert.equal(createHash("sha256").update(new Uint8Array(new Float32Array(edge).buffer)).digest("hex"),
    "0d51bf7f0bf76477f2099237b5d2c0be585447f162f38c3ea542ea88d331fb0f");
  assert.equal(TERRAIN_SETTINGS.opacity,.66);
  assert.equal(TERRAIN_SETTINGS.pointCssSize,1.8);
});

test("rear land settles into a gradual fade without changing the side/front envelope", () => {
  for(const x of [-7,-3,0,3,7]) {
    assert.equal(terrainFarFade(x,0),1);
    assert.equal(terrainVisibility(x,0),terrainEdge(x,0));
    assert.equal(terrainVisibility(x,4),terrainEdge(x,4));
    const stages=[-2,-4,-5.5,-7,-8.5].map(z=>terrainFarFade(x,z));
    assert.equal(stages[0],1); assert.equal(stages.at(-1),0);
    for(let i=1;i<stages.length;i++) assert.ok(stages[i]<stages[i-1]);
  }
  for(let x=-5;x<=5;x+=.25) {
    assert.ok(terrainHeight(x,-6.3)<.38,"rear heaps must not cover the fade with a skyline");
  }
});

test("inland colors include distinct muted warm and green patches", () => {
  let warm=0,green=0;
  for(let i=0;i<data.alphas.length;i++) {
    const k=i*3;
    if(terrainInteriorWeight(data.positions[k],data.positions[k+2])<.99)continue;
    const [r,g,b]=data.colors.subarray(k,k+3);
    if(r>g*1.15)warm++;
    if(g>r*1.12 && g>b*1.01)green++;
  }
  assert.ok(warm>300,`warm points: ${warm}`);
  assert.ok(green>300,`green points: ${green}`);
});

test("island edge thins out rather than exposing the rectangular sample bounds", () => {
  const average = radius => {
    let sum=0;
    for(let i=0;i<64;i++) {
      const angle=i*Math.PI/32;
      sum+=terrainEdge(Math.cos(angle)*TERRAIN_SETTINGS.radiusX*radius,Math.sin(angle)*TERRAIN_SETTINGS.radiusZ*radius);
    }
    return sum/64;
  };
  assert.ok(average(.65)>.94);
  assert.ok(average(.9)<.4);
  assert.ok(average(1.1)<.001);
  for(let i=0;i<data.positions.length;i+=3*113) assert.ok(terrainEdge(data.positions[i],data.positions[i+2])>0);
});

test("depth grid tracks the same terrain without swallowing the visible points", () => {
  const depth=generateTerrainDepth();
  const {radiusX,radiusZ,depthColumns:columns,depthRows:rows} = TERRAIN_SETTINGS;
  const width=radiusX*2.2, length=radiusZ*2.2;
  const at=(column,row)=>depth.positions[(row*columns+column)*3+1];
  for(let i=0;i<data.positions.length;i+=3) {
    const [x,y,z]=data.positions.subarray(i,i+3);
    const col=(x/width+.5)*(columns-1), row=(z/length+.5)*(rows-1);
    const c=Math.floor(col),r=Math.floor(row),u=col-c,v=row-r;
    const interpolated=u+v<=1
      ? at(c,r)*(1-u-v)+at(c+1,r)*u+at(c,r+1)*v
      : at(c+1,r)*(1-v)+at(c,r+1)*(1-u)+at(c+1,r+1)*(u+v-1);
    assert.ok(y>interpolated,`depth collision at ${x},${z}`);
  }
});

test("terrain draws only points and an invisible depth mesh, with no animated flow", () => {
  const terrain=createArchiveTerrain();
  assert.deepEqual(terrain.group.children.map(c=>c.type),["Mesh","Points"]);
  assert.equal(terrain.depthMaterial.colorWrite,false);
  assert.equal(terrain.depthMaterial.depthWrite,true);
  assert.equal(terrain.pointMaterial.depthTest,true);
  assert.equal(terrain.pointMaterial.depthWrite,false);
  for (const removed of ["uTime","uFlow","uTarget"]) assert.equal(removed in terrain.pointMaterial.uniforms,false);
  terrain.pointGeometry.dispose(); terrain.depthGeometry.dispose();
  terrain.pointMaterial.dispose(); terrain.depthMaterial.dispose();
});
