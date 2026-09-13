import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const CORE_COUNT = 8;
const tmpWorld = new THREE.Vector3();
const tmpNdc = new THREE.Vector3();
let shellPromise;

export function preloadC03DispersalShells(){
  shellPromise ??= new GLTFLoader().loadAsync("/assets/observation/category-3-dispersal-shells.glb?v=glass-shell-v3");
  return shellPromise;
}

function maskPixels(texture) {
  const image = texture.image;
  if (!image?.width) return null;
  const canvas = document.createElement("canvas");
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  return { data: context.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
}

function deriveCenters(geometry, texture) {
  const pixels = maskPixels(texture), uv = geometry.getAttribute("uv"), position = geometry.getAttribute("position");
  if (!pixels || !uv || !position) return [];
  const samples = [];
  const stride = Math.max(1, Math.floor(position.count / 18000));
  for (let i=0;i<position.count;i+=stride) {
    const x=Math.min(pixels.width-1,Math.max(0,Math.round(uv.getX(i)*(pixels.width-1))));
    const y=Math.min(pixels.height-1,Math.max(0,Math.round((1-uv.getY(i))*(pixels.height-1))));
    if (pixels.data[(y*pixels.width+x)*4] < 117) samples.push(new THREE.Vector3().fromBufferAttribute(position,i));
  }
  if (!samples.length) return [];
  const centers=[samples[Math.floor(samples.length*.43)].clone()];
  while (centers.length<CORE_COUNT) {
    let best=samples[0], bestDistance=-1;
    for (const point of samples) {
      const distance=Math.min(...centers.map(center=>center.distanceToSquared(point)));
      if(distance>bestDistance){bestDistance=distance;best=point;}
    }
    centers.push(best.clone());
  }
  for(let pass=0;pass<12;pass++){
    const sums=centers.map(()=>new THREE.Vector3()), counts=centers.map(()=>0);
    for(const point of samples){let nearest=0,d=Infinity;centers.forEach((center,index)=>{const next=center.distanceToSquared(point);if(next<d){d=next;nearest=index;}});sums[nearest].add(point);counts[nearest]++;}
    centers.forEach((center,index)=>{if(counts[index]>8)center.copy(sums[index]).multiplyScalar(1/counts[index]);});
  }
  return centers.sort((a,b)=>b.y-a.y);
}

function ease(t){return t*t*(3-2*t);}

export function createC03Dispersal(geometry, mask, shellScene=null, normalize=null) {
  const centers=deriveCenters(geometry,mask);
  const group=new THREE.Group(); group.name="C03 dispersal overlays";
  const trailPositions=new Float32Array(32*3),trailGeometry=new THREE.BufferGeometry();
  trailGeometry.setAttribute("position",new THREE.BufferAttribute(trailPositions,3));trailGeometry.setDrawRange(0,0);
  const trailMaterial=new THREE.LineBasicMaterial({color:0xa9edf4,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
  const trail=new THREE.Line(trailGeometry,trailMaterial);trail.frustumCulled=false;group.add(trail);
  const shardMaterial=new THREE.MeshPhysicalMaterial({color:0xa4edf3,emissive:0x1b505b,emissiveIntensity:.72,transmission:.58,ior:1.45,thickness:.16,attenuationColor:new THREE.Color(0x55cfe8),attenuationDistance:1.2,transparent:true,opacity:0,roughness:.12,metalness:0,clearcoat:.7,clearcoatRoughness:.16,side:THREE.DoubleSide,depthWrite:false});
  // The exported shell mesh has already been filtered by the glass/core mask.
  // Applying the source UV mask again after rebuilding the sliced meshes can
  // discard valid fragments, so the flying shells use the prefiltered geometry.
  const seedMaterial=new THREE.MeshBasicMaterial({color:0xffe4aa,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
  const shards=[], seeds=[];
  const shardGeometry=new THREE.CircleGeometry(.12,5);
  const seedGeometry=new THREE.SphereGeometry(.029,7,5); seedGeometry.scale(.58,2.15,.58);
  centers.forEach((center,index)=>{
    const localShards=[], localSeeds=[];
    if(!shellScene) for(let j=0;j<7;j++){
      const angle=j/7*Math.PI*2+(index*.73); const mesh=new THREE.Mesh(shardGeometry,shardMaterial.clone());
      const radial=new THREE.Vector3(Math.cos(angle),Math.sin(angle)*.72,Math.sin(angle)*.4).normalize();
      mesh.position.copy(center).addScaledVector(radial,.13); mesh.rotation.set(angle*.37,angle*.61,angle); mesh.scale.set(.65+((j*17)%5)*.09,1.05,.7);
      mesh.userData={origin:mesh.position.clone(),radial,spin:new THREE.Vector3(.7+j*.07,.5+j*.11,.8-j*.05),delay:j*.055}; group.add(mesh); localShards.push(mesh);
    }
    for(let j=0;j<22;j++){
      const seed=new THREE.Mesh(seedGeometry,seedMaterial.clone());
      const a=j*2.39996+index*.9, r=.03+.11*((j*29)%17)/17;
      seed.position.copy(center).add(new THREE.Vector3(Math.cos(a)*r,Math.sin(a)*r*.72,Math.sin(a*.7)*r*.55));
      seed.userData={origin:seed.position.clone(),phase:j*.91+index*1.7,speed:.82+((j*19)%13)/13*.72,spread:new THREE.Vector3(Math.cos(a),-.62+((j*13)%17)/8,Math.sin(a)*.88).normalize()};
      group.add(seed); localSeeds.push(seed);
    }
    shards.push(localShards); seeds.push(localSeeds);
  });
  if(shellScene){
    shellScene.updateMatrixWorld(true);
    shellScene.traverse(source=>{
      if(!source.isMesh)return;const match=source.name.match(/Core_(\d+)_Shard_(\d+)/i);if(!match)return;
      const ci=Number(match[1]),si=Number(match[2]);if(!centers[ci]||!shards[ci])return;
      const shellGeometry=source.geometry.clone();const matrix=normalize?new THREE.Matrix4().multiplyMatrices(normalize,source.matrixWorld):source.matrixWorld;
      shellGeometry.applyMatrix4(matrix);shellGeometry.translate(-centers[ci].x,-centers[ci].y,-centers[ci].z);
      const mesh=new THREE.Mesh(shellGeometry,shardMaterial.clone());mesh.position.copy(centers[ci]);mesh.renderOrder=6;mesh.material.depthTest=false;
      const fragmentCenter=new THREE.Box3().setFromBufferAttribute(shellGeometry.getAttribute("position")).getCenter(new THREE.Vector3());
      const radial=fragmentCenter.lengthSq()>.0001?fragmentCenter.normalize():new THREE.Vector3(Math.cos(si/8*Math.PI*2),Math.sin(si/8*Math.PI*2),.25).normalize();
      mesh.userData={origin:mesh.position.clone(),radial,spin:new THREE.Vector3(.38+si*.045,.27+si*.06,.48-si*.025),delay:si*.065,formal:true};group.add(mesh);shards[ci].push(mesh);
    });
  }
  // Start with the large, readable fruiting chamber and ignore the low root
  // cluster which is not a dispersal core.
  const demoOrder=[3,5,2,1,0,4,6];
  const state={centers,amounts:centers.map(()=>0),phases:centers.map(()=>"idle"),ages:centers.map(()=>0),directions:centers.map(()=>new THREE.Vector2(1,0)),cooldown:0,lastWrists:null,lastDemo:0,demoCursor:0,wave:0,windPath:[]};
  function trigger(index,direction=new THREE.Vector2(1,0)){
    if(index<0||state.phases[index]!=="idle")return false;
    state.phases[index]="cracking";state.ages[index]=0;state.directions[index].copy(direction).normalize();state.wave=1;return true;
  }
  function nearestToScreen(x,y,camera,root){
    let winner=-1,best=.12*.12;
    centers.forEach((center,index)=>{if(state.phases[index]!=="idle")return;tmpWorld.copy(center);root.localToWorld(tmpWorld);tmpNdc.copy(tmpWorld).project(camera);const d=(tmpNdc.x-(x*2-1))**2+(tmpNdc.y-(1-y*2))**2;if(d<best){best=d;winner=index;}});
    return winner;
  }
  function update({dt,time,points,camera,root,active=true,demo=0,blockedWrists=[]}){
    state.wave=THREE.MathUtils.damp(state.wave,0,1.25,dt);
    state.cooldown=Math.max(0,state.cooldown-dt);
    if(active&&demo!==state.lastDemo){state.lastDemo=demo;const available=demoOrder.find(index=>state.phases[index]==="idle");if(trigger(available??-1,new THREE.Vector2(.8,-.25)))state.demoCursor=(state.demoCursor+1)%demoOrder.length;}
    const wristEntries=points&&[15,16].map(index=>({index,point:points[index]})).filter(({point})=>(point?.visibility??0)>.45);
    const blocked=new Set(blockedWrists),wrists=wristEntries?.filter(({index})=>!blocked.has(index));
    if(active&&wrists?.length){
      const cameraDirection=new THREE.Vector3();camera.getWorldDirection(cameraDirection);const planePoint=root.localToWorld(new THREE.Vector3(0,.35,0));const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(cameraDirection,planePoint);const raycaster=new THREE.Raycaster();
      const w=state.lastWrists?wrists.reduce((best,next)=>{const previous=state.lastWrists[next.index];const movement=previous?Math.hypot(next.point.x-previous.x,next.point.y-previous.y):0;return movement>best.movement?{entry:next,movement}:best;},{entry:wrists[0],movement:-1}).entry.point:wrists[0].point;
      raycaster.setFromCamera(new THREE.Vector2((1-w.x)*2-1,1-w.y*2),camera);const world=new THREE.Vector3();if(raycaster.ray.intersectPlane(plane,world)){const local=root.worldToLocal(world);const last=state.windPath.at(-1);if(!last||last.point.distanceTo(local)>.035)state.windPath.push({point:local,age:0});}
    }
    state.windPath.forEach(item=>item.age+=dt);state.windPath=state.windPath.filter(item=>item.age<.62).slice(-32);
    state.windPath.forEach((item,index)=>{trailPositions[index*3]=item.point.x;trailPositions[index*3+1]=item.point.y;trailPositions[index*3+2]=item.point.z;});
    trailGeometry.setDrawRange(0,state.windPath.length);trailGeometry.attributes.position.needsUpdate=true;trailMaterial.opacity=state.windPath.length>1?.16*(1-state.windPath[0].age/.62):0;
    if(active&&wrists?.length&&state.lastWrists&&state.cooldown<=0){
      wrists.forEach(({index,point:w})=>{const old=state.lastWrists[index];if(!old)return;const dx=w.x-old.x,dy=w.y-old.y,speed=Math.hypot(dx,dy)/Math.max(dt,.016);if(speed>1.05){const hit=nearestToScreen(1-(w.x+old.x)/2,(w.y+old.y)/2,camera,root);if(trigger(hit,new THREE.Vector2(-dx,-dy)))state.cooldown=.42;}});
    }
    state.lastWrists=wristEntries?.length?Object.fromEntries(wristEntries.map(({index,point})=>[index,{x:point.x,y:point.y}])):null;
    centers.forEach((center,index)=>{
      if(state.phases[index]==="idle"){state.amounts[index]=Math.max(0,state.amounts[index]-dt*1.5);return;}
      state.ages[index]+=dt;const age=state.ages[index];
      if(age<.72){state.phases[index]="cracking";state.amounts[index]=ease(age/.72)*.48;}
      else if(age<1.55){state.phases[index]="opening";state.amounts[index]=.48+ease((age-.72)/.83)*.52;}
      else if(age<7.4){state.phases[index]="released";state.amounts[index]=1;}
      else if(age<9.2){state.phases[index]="regrowing";state.amounts[index]=1-ease((age-7.4)/1.8);}
      else {state.phases[index]="idle";state.ages[index]=0;state.amounts[index]=0;}
      const opening=ease(Math.max(0,Math.min(1,(age-.45)/1.1))), fading=1-ease(Math.max(0,Math.min(1,(age-6.8)/1.5)));
      const release=Math.max(0,age-1.18), direction=state.directions[index];
      shards[index].forEach((mesh,j)=>{const localOpening=ease(Math.max(0,Math.min(1,(age-.32-(mesh.userData.delay??j*.055))/.86)));const freeDrift=Math.max(0,age-1.18);mesh.visible=localOpening>0&&fading>0;mesh.material.opacity=localOpening*fading*(mesh.userData.formal?.92:.27);mesh.position.copy(mesh.userData.origin).addScaledVector(mesh.userData.radial,localOpening*(mesh.userData.formal?.58:.22+j*.018)+freeDrift*(mesh.userData.formal?.21:0));if(mesh.userData.formal){mesh.position.x+=direction.x*freeDrift*.13;mesh.position.y+=direction.y*freeDrift*.09+freeDrift*(.025+((j*7)%5)*.009);mesh.position.z+=Math.sin(time*.64+j)*freeDrift*.035;}mesh.rotation.x+=mesh.userData.spin.x*dt*localOpening;mesh.rotation.y+=mesh.userData.spin.y*dt*localOpening;mesh.rotation.z+=mesh.userData.spin.z*dt*localOpening*.55;});
      seeds[index].forEach((seed,j)=>{const appear=ease(Math.max(0,Math.min(1,(age-1.02-j*.009)/.34)));seed.visible=appear>0&&fading>0;seed.material.opacity=appear*fading*(.58+.34*Math.sin(time*1.7+seed.userData.phase)**2);const burst=1-Math.exp(-release*2.7);const drift=Math.max(0,release-.45);seed.position.copy(seed.userData.origin).addScaledVector(seed.userData.spread,burst*(.42+.24*seed.userData.speed)+drift*(.12+.035*(j%7)));seed.position.x+=direction.x*(burst*.54+drift*.25)*seed.userData.speed;seed.position.y+=direction.y*burst*.28+drift*drift*.035+Math.sin(time*.8+seed.userData.phase)*(.055+drift*.012);seed.position.z+=seed.userData.spread.z*burst*.32+Math.sin(time*.54+seed.userData.phase)*drift*.07;seed.scale.setScalar(1+burst*.38);seed.rotation.z=time*.46+seed.userData.phase;});
    });
    return state;
  }
  function dispose(){trailGeometry.dispose();trailMaterial.dispose();shardGeometry.dispose();seedGeometry.dispose();shards.flat().forEach(x=>{x.geometry!==shardGeometry&&x.geometry.dispose();x.material.dispose();});seeds.flat().forEach(x=>x.material.dispose());}
  return {group,state,trigger,update,dispose};
}
