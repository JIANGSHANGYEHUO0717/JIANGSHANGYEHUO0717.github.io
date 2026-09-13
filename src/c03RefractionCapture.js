import * as THREE from "three";

const smooth=(a,b,x)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};

function propagationPath(centers,source,count=5){
  const remaining=centers.map((_,index)=>index).filter(index=>index!==source),path=[source];
  while(remaining.length&&path.length<count){
    const last=centers[path[path.length-1]];
    remaining.sort((a,b)=>last.distanceToSquared(centers[a])-last.distanceToSquared(centers[b]));
    path.push(remaining.shift());
  }
  return path;
}

export function createC03RefractionCapture(coreCenters=[]){
  const group=new THREE.Group();group.name="C03 right-hand refraction release";
  const centers=coreCenters.length?coreCenters.slice(0,Math.min(7,coreCenters.length)).map(point=>point.clone()):[new THREE.Vector3(0,1.45,0)];
  const propagationLights=Array.from({length:5},(_,index)=>{
    const light=new THREE.PointLight(index===0?0xfbffff:index<3?0xb9eff2:0x86d1df,0,1.02,2);
    light.name=`C03 refraction propagation ${index+1}`;light.layers.enable(1);light.layers.enable(2);group.add(light);return light;
  });
  const relayLights=Array.from({length:4},(_,index)=>{
    const light=new THREE.PointLight(index<2?0xeaffff:0x86d9e7,0,.56,2);
    light.name=`C03 branch relay ${index+1}`;light.layers.enable(1);light.layers.enable(2);group.add(light);return light;
  });
  const state={amount:0,releaseToken:0,lastDemo:0,releaseAge:99,lastSource:-1,path:propagationPath(centers,0),captured:0,armed:false,releaseAccent:0,mode:"等待右手握拳"};

  function release(){
    let source=state.lastSource;
    if(centers.length>1)while(source===state.lastSource)source=Math.floor(Math.random()*centers.length);else source=0;
    state.lastSource=source;state.path=propagationPath(centers,source);state.releaseAge=0;state.captured+=1;
  }

  function update({dt,active,control=null}){
    state.amount=THREE.MathUtils.damp(state.amount,active?1:0,active?3.1:5.2,dt);group.visible=state.amount>.002;
    const rightToken=control?.rightHand?.releaseToken??0,demo=control?.captureDemo??0;
    const rightReleased=rightToken!==state.releaseToken,demoReleased=demo!==state.lastDemo;
    state.releaseToken=rightToken;state.lastDemo=demo;
    if((rightReleased||demoReleased)&&state.releaseAge>.72)release();
    state.releaseAge+=dt;
    state.armed=control?.rightHand?.stage==="armed"||control?.rightHand?.stage==="opening";
    state.releaseAccent=state.releaseAge<.68?1-smooth(.38,.68,state.releaseAge):0;
    propagationLights.forEach((light,index)=>{
      const center=centers[state.path[index]??state.path[state.path.length-1]];light.position.copy(center);
      const age=state.releaseAge-index*.095;
      const pulse=age>0?smooth(0,.042,age)*(1-smooth(.12,.30,age)):0;
      light.intensity=state.amount*pulse*(index===0?6.8:5.35-index*.16);
    });
    const relayEnabled=control?.opticsPathRelay!==false;
    relayLights.forEach((light,index)=>{
      const from=centers[state.path[index]??0],to=centers[state.path[index+1]??state.path[index]??0];
      const localAge=state.releaseAge-index*.095-.018,travel=THREE.MathUtils.clamp(localAge/.11,0,1);
      light.position.copy(from).lerp(to,smooth(0,1,travel));
      const pulse=localAge>0?smooth(0,.025,localAge)*(1-smooth(.075,.15,localAge)):0;
      light.intensity=relayEnabled?state.amount*pulse*(4.15-index*.18):0;
    });
    if(state.releaseAge<.68)state.mode="核心折光正在传递";
    else if(state.armed)state.mode="右拳已蓄势";
    else state.mode="等待右手握拳";
    return state;
  }

  function dispose(){propagationLights.forEach(light=>light.dispose());relayLights.forEach(light=>light.dispose());}
  return {group,state,update,dispose};
}
