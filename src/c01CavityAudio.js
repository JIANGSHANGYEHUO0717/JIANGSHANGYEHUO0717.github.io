const AUDIO_ROOT = "audio/c01-experimental/";
export const CAVITY_AUDIO_ASSETS = Object.freeze({
  spaceBed: `${AUDIO_ROOT}space-bed.ogg`,
  chargeRise: `${AUDIO_ROOT}charge-rise.ogg`,
  releaseHit: `${AUDIO_ROOT}release-hit.ogg`,
  releaseTail: `${AUDIO_ROOT}release-tail.ogg`,
});

const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const smooth = value => {const t=clamp(value,0,1);return t*t*(3-2*t);};

export function cavityAudioMapping(state,coreUv,motion=0) {
  const interactive=state.audioGate===false?0:1;
  const charge=clamp(state.charge??0,0,1)*interactive,release=clamp(state.release??0,0,1)*interactive;
  const strength=clamp(state.releaseStrength??0,0,1)*interactive,motionLevel=clamp(motion,0,1)*interactive;
  const wave=state.releaseAge<0?0:clamp(state.releaseAge/3.2,0,1),waveEase=smooth(wave);
  const sourcePan=clamp((coreUv.x-.5)*.9,-.38,.38),drive=clamp(state.drive??0,-1,1)*interactive;
  return {
    bedGain:clamp(.40+motionLevel*.055-release*.08,.30,.48),
    bedPan:clamp(Math.sin((state.time??0)*.17)*.10+drive*.045,-.16,.16),
    bedCutoff:1150+motionLevel*850+charge*420,
    chargeGain:.018+Math.pow(charge,1.18)*.68,
    chargeRate:.94+charge*.11+motionLevel*.012,
    chargePan:clamp(sourcePan*.55+drive*.035,-.32,.32),
    chargeCutoff:1250+charge*2100+motionLevel*350,
    hitGain:.48*strength,
    hitPan:sourcePan*.28,
    hitCutoff:2400+strength*700,
    tailGain:strength*(.14+.62*(1-waveEase)),
    tailPan:sourcePan*.18*(1-waveEase),
    tailCutoff:3000-waveEase*1450,
    waveProgress:wave,
  };
}

export function createCavityAudio() {
  let context=null,master=null,loading=null,enabled=false,status="off",paused=false;
  let spaceBed=null,chargeRise=null,releaseHit=null,releaseTail=null,chargeCyclePlayed=false;
  let lastReleaseAge=-1,lastActive=false,lastSource=-1,lastTime=0,lastDrive=0,motion=0;
  const buffers=new Map(),voices=new Set();

  const audioUrl = path => new URL(path,document.baseURI).href;
  const ensureContext = () => {
    if (!context) {
      const AudioContextClass=window.AudioContext||window.webkitAudioContext;
      if (!AudioContextClass) {status="unavailable";return null;}
      context=new AudioContextClass();
      master=context.createGain();master.gain.value=.88;master.connect(context.destination);
    }
    return context;
  };
  const load = () => {
    if (loading||!context) return loading;
    status="loading";
    loading=Promise.all(Object.entries(CAVITY_AUDIO_ASSETS).map(async([key,path])=>{
      const response=await fetch(audioUrl(path));
      if(!response.ok) throw new Error(`C01 audio unavailable: ${path}`);
      buffers.set(key,await context.decodeAudioData(await response.arrayBuffer()));
    })).then(()=>{status=enabled?"ready":"off";}).catch(error=>{status="error";console.error(error);});
    return loading;
  };
  const play = (name,{gain=.3,pan=0,rate=1,loop=false,when=0,offset=0,cutoff=20000}={}) => {
    if(!enabled||!context||context.state==="closed") return null;
    const buffer=buffers.get(name);if(!buffer)return null;
    const source=context.createBufferSource(),gainNode=context.createGain(),filter=context.createBiquadFilter();
    const panner=context.createStereoPanner();
    source.buffer=buffer;source.playbackRate.value=rate;source.loop=loop;
    filter.type="lowpass";filter.frequency.value=cutoff;filter.Q.value=.45;
    gainNode.gain.value=gain;panner.pan.value=clamp(pan,-1,1);
    source.connect(filter);filter.connect(panner);panner.connect(gainNode);gainNode.connect(master);
    const voice={source,gain:gainNode,panner,filter,loop,ended:false};voices.add(voice);
    source.onended=()=>{voice.ended=true;voices.delete(voice);};
    source.start(Math.max(context.currentTime,when),Math.min(offset,Math.max(0,buffer.duration-.01)));
    return voice;
  };
  const stopVoice = (voice,fade=.12) => {
    if(!voice||!context)return;
    const now=context.currentTime,param=voice.gain.gain;
    param.cancelScheduledValues(now);param.setValueAtTime(param.value,now);param.linearRampToValueAtTime(0,now+fade);
    try{voice.source.stop(now+fade+.02);}catch{}
  };
  const stopAll = (fade=.12) => {
    for(const voice of [...voices]) stopVoice(voice,fade);
    spaceBed=null;chargeRise=null;releaseHit=null;releaseTail=null;chargeCyclePlayed=false;
    lastTime=0;lastDrive=0;motion=0;
  };
  const measureMotion = state => {
    if(state.time<=lastTime){lastTime=state.time;lastDrive=state.drive;motion=0;return motion;}
    const dt=clamp(state.time-lastTime,1/240,.12);
    const raw=clamp(Math.abs(state.drive-lastDrive)/(dt*2.2),0,1);
    const response=1-Math.exp(-dt*(raw>motion?8:2.4));
    motion+=(raw-motion)*response;lastTime=state.time;lastDrive=state.drive;
    return motion;
  };
  const keepSpaceAlive = mapping => {
    const now=context.currentTime;
    if(!spaceBed||spaceBed.ended) spaceBed=play("spaceBed",{gain:.001,pan:mapping.bedPan,loop:true,offset:Math.random()*5.4,rate:.995,cutoff:mapping.bedCutoff});
    if(spaceBed){
      spaceBed.gain.gain.setTargetAtTime(mapping.bedGain,now,.48);
      spaceBed.panner.pan.setTargetAtTime(mapping.bedPan,now,.55);
      spaceBed.filter.frequency.setTargetAtTime(mapping.bedCutoff,now,.28);
    }
  };
  const startCharge = mapping => {
    const now=context.currentTime;
    if(!chargeCyclePlayed){chargeRise=play("chargeRise",{gain:.012,pan:mapping.chargePan,rate:mapping.chargeRate,cutoff:mapping.chargeCutoff});chargeCyclePlayed=true;}
    if(chargeRise&&!chargeRise.ended){
      chargeRise.panner.pan.setTargetAtTime(mapping.chargePan,now,.28);
      chargeRise.gain.gain.setTargetAtTime(mapping.chargeGain,now,.22);
      chargeRise.source.playbackRate.setTargetAtTime(mapping.chargeRate,now,.32);
      chargeRise.filter.frequency.setTargetAtTime(mapping.chargeCutoff,now,.24);
    }
  };
  const release = mapping => {
    stopVoice(chargeRise,.32);chargeRise=null;chargeCyclePlayed=false;
    releaseHit=play("releaseHit",{gain:mapping.hitGain,pan:mapping.hitPan,rate:.985,cutoff:mapping.hitCutoff});
    releaseTail=play("releaseTail",{gain:mapping.tailGain,pan:mapping.tailPan,rate:.995,cutoff:mapping.tailCutoff});
  };
  const updateRelease = mapping => {
    if(!releaseTail||releaseTail.ended)return;
    const now=context.currentTime;
    releaseTail.gain.gain.setTargetAtTime(mapping.tailGain,now,.26);
    releaseTail.panner.pan.setTargetAtTime(mapping.tailPan,now,.42);
    releaseTail.filter.frequency.setTargetAtTime(mapping.tailCutoff,now,.38);
  };

  return {
    setEnabled(value) {
      enabled=Boolean(value);
      if(!enabled){status="off";stopAll(.16);return;}
      const live=ensureContext();if(!live)return;
      live.resume();load();
    },
    update(state,coreUv,_aspect,active,shouldPause=false) {
      if(context&&shouldPause!==paused){paused=shouldPause;shouldPause?context.suspend():context.resume();}
      if(!enabled||!context||status!=="ready"){lastReleaseAge=state.releaseAge;lastActive=active;lastSource=state.sourceIndex;return;}
      if(!active){if(lastActive)stopAll(.18);lastReleaseAge=state.releaseAge;lastActive=false;lastSource=state.sourceIndex;return;}
      const mapping=cavityAudioMapping(state,coreUv,measureMotion(state));
      keepSpaceAlive(mapping);
      if(state.sourceIndex!==lastSource&&state.charge>.02){stopVoice(chargeRise,.12);chargeRise=null;chargeCyclePlayed=false;}
      if(state.audioGate&&state.releaseAge<0&&state.charge>.01)startCharge(mapping);
      else if(state.releaseAge<0){stopVoice(chargeRise,.2);chargeRise=null;chargeCyclePlayed=false;}
      if(state.audioGate&&lastReleaseAge<0&&state.releaseAge>=0)release(mapping);
      if(state.releaseAge>=0)updateRelease(mapping);
      if(lastReleaseAge>=0&&state.releaseAge<0){stopVoice(releaseTail,.65);releaseTail=null;releaseHit=null;}
      lastReleaseAge=state.releaseAge;lastActive=true;lastSource=state.sourceIndex;
    },
    get status(){return status;},
    get enabled(){return enabled;},
    dispose(){stopAll(0);context?.close();context=null;status="off";},
  };
}
