export const DUAL_PINCH_TIMING = Object.freeze({
  confirmMs: 200,
  lossHoldMs: 240,
  releaseWindowMs: 280,
  releaseDisplayMs: 420,
});

export const DUAL_PINCH_THRESHOLDS = Object.freeze({
  closeRatio: .34,
  openRatio: .52,
  startSeparation: .58,
  startCenterTolerance: .24,
  minReleaseCharge: .18,
  fullPullDistance: .92,
});

const clamp = (value,min=0,max=1) => Math.max(min,Math.min(max,value));
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const validPoint = point => Number.isFinite(point?.x)&&Number.isFinite(point?.y);
const smoothstep = (edge0,edge1,value) => {
  const t=clamp((value-edge0)/Math.max(1e-5,edge1-edge0));
  return t*t*(3-2*t);
};

export function createDualPinchState() {
  return {
    stage:"idle",charge:0,releaseStrength:0,releaseToken:0,
    candidateSince:0,startSeparation:0,firstOpenAt:0,releasedAt:0,lastSeen:0,
    handsVisible:false,separation:0,handPinches:{},
    detail:"请将双手拇指与食指分别捏合",
  };
}

function readHands(result,previousPinches) {
  return (result?.landmarks??[]).map((points,index)=>{
    if(![0,4,5,8,9,17].every(i=>validPoint(points?.[i])))return null;
    const label=result?.handedness?.[index]?.[0]?.categoryName??String(index);
    const scale=Math.max(distance(points[0],points[9]),distance(points[5],points[17])*.82,.018);
    const ratio=distance(points[4],points[8])/scale;
    const wasPinched=Boolean(previousPinches[label]);
    const pinched=ratio<=(wasPinched?DUAL_PINCH_THRESHOLDS.openRatio:DUAL_PINCH_THRESHOLDS.closeRatio);
    return {label,ratio,scale,pinched,center:{x:(points[4].x+points[8].x)/2,y:(points[4].y+points[8].y)/2}};
  }).filter(Boolean).sort((a,b)=>a.center.x-b.center.x).slice(0,2);
}

function idle(old,handPinches,handsVisible=false,detail="请将双手拇指与食指分别捏合") {
  return {...old,stage:"idle",charge:0,releaseStrength:0,candidateSince:0,startSeparation:0,
    firstOpenAt:0,releasedAt:0,handsVisible,separation:0,handPinches,detail};
}

export function updateDualPinchState(old,result,now,shoulderSpan=.2) {
  const hands=readHands(result,old.handPinches),handPinches={};
  for(const hand of hands)handPinches[hand.label]=hand.pinched;
  if(hands.length<2){
    if(["arming","pulling"].includes(old.stage)&&now-old.lastSeen<=DUAL_PINCH_TIMING.lossHoldMs){
      return {...old,handsVisible:false,handPinches:{...old.handPinches,...handPinches},detail:"手指短暂遮挡，保持当前状态"};
    }
    return idle(old,handPinches,false,"请让两只手完整进入画面");
  }

  const span=Math.max(.06,shoulderSpan),separation=distance(hands[0].center,hands[1].center)/span;
  const center={x:(hands[0].center.x+hands[1].center.x)/2,y:(hands[0].center.y+hands[1].center.y)/2};
  const centered=Math.abs(center.x-.5)<=DUAL_PINCH_THRESHOLDS.startCenterTolerance&&center.y>.16&&center.y<.84;
  const bothPinched=hands.every(hand=>hand.pinched);
  const openCount=hands.filter(hand=>!hand.pinched&&hand.ratio>=DUAL_PINCH_THRESHOLDS.openRatio).length;
  const common={handsVisible:true,separation,handPinches,lastSeen:now};

  if(old.stage==="released"){
    if(now-old.releasedAt<DUAL_PINCH_TIMING.releaseDisplayMs){
      return {...old,...common,detail:"释放完成，请重新捏合"};
    }
    return idle({...old,...common},handPinches,true,"请重新将双手捏合并靠近");
  }

  if(old.stage==="idle"){
    if(!bothPinched)return {...idle({...old,...common},handPinches,true),detail:"双手均捏合后，将两对指尖靠近"};
    if(!centered||separation>DUAL_PINCH_THRESHOLDS.startSeparation){
      return {...idle({...old,...common},handPinches,true),detail:"保持双手捏合，将两个捏合点靠近画面中央"};
    }
    return {...old,...common,stage:"arming",candidateSince:now,detail:"保持捏合，正在确认抓取"};
  }

  if(old.stage==="arming"){
    if(!bothPinched)return idle({...old,...common},handPinches,true,"捏合中断，请重新靠近");
    if(!centered||separation>DUAL_PINCH_THRESHOLDS.startSeparation+.16){
      return idle({...old,...common},handPinches,true,"请先在中央完成双手捏合");
    }
    if(now-old.candidateSince<DUAL_PINCH_TIMING.confirmMs){
      return {...old,...common,detail:"保持捏合，正在确认抓取"};
    }
    return {...old,...common,stage:"pulling",startSeparation:separation,charge:0,firstOpenAt:0,
      detail:"保持捏合，向两侧拉开蓄能"};
  }

  const pull=Math.max(0,separation-old.startSeparation);
  const charge=smoothstep(.015,DUAL_PINCH_THRESHOLDS.fullPullDistance,pull);
  if(bothPinched){
    return {...old,...common,stage:"pulling",charge,firstOpenAt:0,
      detail:charge>.92?"已接近满能量，同时松开双手释放":"保持捏合，继续向外拉开"};
  }

  if(openCount>0){
    const firstOpenAt=old.firstOpenAt||now,releaseCharge=Math.max(old.charge,charge);
    if(openCount===2&&now-firstOpenAt<=DUAL_PINCH_TIMING.releaseWindowMs){
      if(releaseCharge<DUAL_PINCH_THRESHOLDS.minReleaseCharge){
        return idle({...old,...common},handPinches,true,"拉伸距离不足，请重新捏合");
      }
      return {...old,...common,stage:"released",charge:0,releaseStrength:releaseCharge,
        releaseToken:old.releaseToken+1,firstOpenAt:0,releasedAt:now,detail:"释放完成，请重新捏合"};
    }
    if(now-firstOpenAt>DUAL_PINCH_TIMING.releaseWindowMs){
      return idle({...old,...common},handPinches,true,"两只手未同时松开，请重新捏合");
    }
    return {...old,...common,stage:"pulling",charge:releaseCharge,firstOpenAt,
      detail:"等待另一只手同时松开"};
  }

  return {...old,...common,stage:"pulling",charge,detail:"保持双手捏合，向两侧拉开"};
}
