import * as THREE from "three";

const direction=new THREE.Vector3();
const smooth=(a,b,x)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};

export function createC03OpticalPaths(coreCenters=[]){
  const group=new THREE.Group();group.name="C03 continuous spherical search lights";
  const center=coreCenters.length?coreCenters.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(1/coreCenters.length):new THREE.Vector3(0,1.55,0);
  center.y=Math.max(center.y,1.35);
  const roles=[
    {name:"主观察光",color:0xeff8f7,intensity:21.5,exit:2.35,radius:4.35,angle:.255,speed:.275,phase:.20,elevation:-.10,vertical:.42,wobble:.22,anchor:3,aim:.44,fade:.66},
    {name:"冰青擦边光",color:0x9cdee8,intensity:12.4,exit:1.18,radius:4.65,angle:.175,speed:-.215,phase:2.35,elevation:.28,vertical:.58,wobble:.31,anchor:5,aim:.62,fade:.53},
    {name:"水蓝探测光",color:0x6cbad4,intensity:9.2,exit:1.75,radius:3.95,angle:.125,speed:.355,phase:4.45,elevation:-.02,vertical:.35,wobble:.40,anchor:2,aim:.76,fade:.78},
  ];
  const rigs=roles.map(role=>{
    const target=new THREE.Object3D(),afterTarget=new THREE.Object3D(),cyanTarget=new THREE.Object3D(),violetTarget=new THREE.Object3D();group.add(target,afterTarget,cyanTarget,violetTarget);
    const light=new THREE.SpotLight(role.color,0,9,role.angle,.94,1.2);light.name=`C03 ${role.name}`;light.layers.enable(1);light.layers.enable(2);light.target=target;group.add(light);
    const exitLight=new THREE.PointLight(role.color,0,1.7,2);exitLight.name=`C03 ${role.name} refracted fill`;exitLight.layers.enable(1);exitLight.layers.enable(2);group.add(exitLight);
    const afterLight=new THREE.SpotLight(role.color,0,9,role.angle*1.12,.97,1.2);afterLight.name=`C03 ${role.name} refracted afterimage`;afterLight.layers.enable(1);afterLight.layers.enable(2);afterLight.target=afterTarget;group.add(afterLight);
    const cyanLight=new THREE.SpotLight(0x71e5f2,0,9,role.angle*.92,.96,1.2);cyanLight.name=`C03 ${role.name} cyan dispersion`;cyanLight.layers.enable(1);cyanLight.layers.enable(2);cyanLight.target=cyanTarget;group.add(cyanLight);
    const violetLight=new THREE.SpotLight(0xd8c7ff,0,9,role.angle*.88,.96,1.2);violetLight.name=`C03 ${role.name} violet dispersion`;violetLight.layers.enable(1);violetLight.layers.enable(2);violetLight.target=violetTarget;group.add(violetLight);
    return {role,light,exitLight,target,afterLight,afterTarget,cyanLight,cyanTarget,violetLight,violetTarget,position:new THREE.Vector3(),aim:new THREE.Vector3(),afterPosition:new THREE.Vector3(),afterAim:new THREE.Vector3(),afterEnergy:0};
  });
  const causticGeometry=new THREE.PlaneGeometry(5.35,4.55,1,1);
  const causticMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,
    uniforms:{uTime:{value:0},uOpacity:{value:0}},
    vertexShader:"varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader:`varying vec2 vUv;uniform float uTime;uniform float uOpacity;
      void main(){vec2 p=(vUv-.5)*2.;float vignette=1.-smoothstep(.18,1.03,length(p*vec2(.82,1.08)));
        vec2 q=p+vec2(sin(p.y*5.7+uTime*.31),cos(p.x*4.8-uTime*.27))*.065;
        float a=abs(sin(q.x*10.5+sin(q.y*6.2+uTime*.42))+sin(q.y*8.3-cos(q.x*5.1-uTime*.34)));
        float b=abs(sin(q.x*6.4-q.y*9.1-uTime*.29)+sin(q.y*11.2+uTime*.37));
        float caustic=pow(max(0.,1.-a*.56),5.)*.72+pow(max(0.,1.-b*.61),6.)*.42;
        vec3 color=mix(vec3(.20,.66,.78),vec3(.76,.96,1.),clamp(caustic,0.,1.));
        gl_FragColor=vec4(color,caustic*vignette*uOpacity);}`});
  const causticPlane=new THREE.Mesh(causticGeometry,causticMaterial);causticPlane.name="C03 soft caustic projection";
  causticPlane.position.set(center.x,center.y-.05,center.z-1.28);causticPlane.renderOrder=-1;group.add(causticPlane);
  const state={amount:0,mode:"寻光黑场",motionTime:0,sequenceTime:0,releaseDim:0,observationEnvelope:0};

  function update({dt,active,control=null}){
    state.amount=THREE.MathUtils.damp(state.amount,active?1:0,active?2.25:4.5,dt);group.visible=state.amount>.002;
    const armed=Boolean(control?.captureArmed),releaseAccent=THREE.MathUtils.clamp(control?.captureReleaseAccent??0,0,1);
    const userSpeed=THREE.MathUtils.clamp(control?.opticsSpeed??.70,.2,2);
    const range=THREE.MathUtils.clamp(control?.opticsRadius??1.25,.5,2);
    const speedScale=(.65+userSpeed*1.2)*(armed ? .58 : 1);
    state.motionTime+=dt*speedScale;
    state.sequenceTime+=dt;
    state.releaseDim=THREE.MathUtils.damp(state.releaseDim,releaseAccent,releaseAccent>.01?12:3.8,dt);
    const cycle=state.sequenceTime%13.2;
    state.observationEnvelope=smooth(.75,2.35,cycle)*(1-smooth(8.65,10.45,cycle));
    const dim=(1-state.releaseDim*.34)*state.observationEnvelope;
    const afterimage=control?.opticsAfterimage!==false,dispersion=control?.opticsDispersion!==false;
    const shutter=control?.opticsShutter!==false;
    rigs.forEach((rig,index)=>{
      const role=rig.role,theta=state.motionTime*role.speed+role.phase;
      const azimuth=theta+Math.sin(state.motionTime*.071+role.phase)*role.wobble;
      const elevation=THREE.MathUtils.clamp(role.elevation+Math.sin(theta*.73+role.phase*.41)*role.vertical+Math.sin(state.motionTime*.053+index)*.08,-1.02,1.02);
      rig.position.set(center.x+Math.cos(elevation)*Math.cos(azimuth)*role.radius,center.y+Math.sin(elevation)*role.radius,center.z+Math.cos(elevation)*Math.sin(azimuth)*role.radius);
      const anchor=coreCenters[role.anchor]??center;
      rig.aim.copy(center).lerp(anchor,role.aim);
      rig.aim.x+=Math.sin(state.motionTime*(.105+index*.017)+role.phase)*.07;
      rig.aim.y+=Math.cos(state.motionTime*(.087+index*.014)+role.phase)*.055;
      rig.light.position.copy(rig.position);rig.target.position.copy(rig.aim);
      const shutterGate=shutter?smooth(.72+index*.31,1.36+index*.31,cycle)*(1-smooth(8.55+(2-index)*.27,9.43+(2-index)*.27,cycle)):1;
      const sliceWidth=shutter?THREE.MathUtils.lerp(.58,1,smooth(1.6,3.05,cycle)):1;
      const rigDim=dim*shutterGate;
      rig.light.angle=role.angle*(.70+range*.50)*sliceWidth;
      const handoff=.17+.83*smooth(.08,.92,.5+.5*Math.sin(state.motionTime*role.fade+role.phase));
      rig.light.intensity=role.intensity*state.amount*handoff*rigDim;
      direction.subVectors(rig.aim,rig.position).normalize();
      rig.exitLight.position.copy(rig.aim).addScaledVector(direction,.28);
      rig.exitLight.intensity=role.exit*state.amount*handoff*rigDim;
      if(rig.afterPosition.lengthSq()===0){rig.afterPosition.copy(rig.position);rig.afterAim.copy(rig.aim);}
      rig.afterPosition.lerp(rig.position,1-Math.exp(-dt*1.45));rig.afterAim.lerp(rig.aim,1-Math.exp(-dt*1.7));
      rig.afterEnergy=THREE.MathUtils.damp(rig.afterEnergy,handoff,handoff>rig.afterEnergy?5.5:1.35,dt);
      rig.afterLight.position.copy(rig.afterPosition);rig.afterTarget.position.copy(rig.afterAim);
      rig.afterLight.angle=role.angle*(.82+range*.55);
      rig.afterLight.intensity=afterimage?role.intensity*.24*state.amount*rig.afterEnergy*rigDim:0;
      rig.cyanLight.position.copy(rig.position);rig.violetLight.position.copy(rig.position);
      rig.cyanTarget.position.copy(rig.aim);rig.violetTarget.position.copy(rig.aim);
      rig.cyanTarget.position.x+=.026;rig.cyanTarget.position.y-=.012;
      rig.violetTarget.position.x-=.022;rig.violetTarget.position.y+=.014;
      rig.cyanLight.angle=role.angle*(.66+range*.38);rig.violetLight.angle=role.angle*(.64+range*.36);
      const chromaEnergy=dispersion?role.intensity*.105*state.amount*handoff*rigDim:0;
      rig.cyanLight.intensity=chromaEnergy;rig.violetLight.intensity=chromaEnergy*.72;
    });
    causticMaterial.uniforms.uTime.value=state.motionTime;
    causticMaterial.uniforms.uOpacity.value=control?.opticsCaustics===false?0:state.amount*state.observationEnvelope*(.045+releaseAccent*.035);
    const phase=cycle<.75||cycle>=10.45?"寻光黑场":cycle<2.35?"寻光渐显":cycle<8.65?"持续寻光": "寻光渐隐";
    state.mode=releaseAccent>.05?`${phase} · 核心传递`:armed?`${phase} · 右拳蓄势`:phase;
    return state;
  }

  function dispose(){rigs.forEach(rig=>{rig.light.dispose();rig.exitLight.dispose();rig.afterLight.dispose();rig.cyanLight.dispose();rig.violetLight.dispose();});causticGeometry.dispose();causticMaterial.dispose();}
  return {group,state,update,dispose};
}
