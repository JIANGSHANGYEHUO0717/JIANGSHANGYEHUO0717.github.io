const CONFIDENCE=.62,FIST_CONFIRM_MS=230,OPEN_CONFIRM_MS=110,OPEN_WINDOW_MS=620,LOST_MS=520,DISPLAY_MS=520;

export function createC03RightHandRelease(){
  return {stage:"idle",candidate:"unknown",candidateSince:0,lastSeen:0,lastFistAt:0,releasedAt:0,releaseToken:0,confidence:0,detail:"右手握拳后快速张开"};
}

function recognizedHands(result){
  return (result?.landmarks??[]).map((points,index)=>({
    wrist:points?.[0],category:result?.gestures?.[index]?.[0],label:result?.handedness?.[index]?.[0]?.categoryName??String(index),
  })).filter(hand=>Number.isFinite(hand.wrist?.x)&&Number.isFinite(hand.wrist?.y));
}

export function updateC03RightHandRelease(old,result,pose,now){
  const poseRight=pose?.[16];
  let hands=recognizedHands(result),match=null;
  if(Number.isFinite(poseRight?.x)&&Number.isFinite(poseRight?.y)){
    match=hands.sort((a,b)=>Math.hypot(a.wrist.x-poseRight.x,a.wrist.y-poseRight.y)-Math.hypot(b.wrist.x-poseRight.x,b.wrist.y-poseRight.y))[0]??null;
    if(match&&Math.hypot(match.wrist.x-poseRight.x,match.wrist.y-poseRight.y)>.24)match=null;
  }else match=hands.find(hand=>hand.label==="Left")??hands[0]??null;
  if(!match){
    if(now-old.lastSeen>LOST_MS)return {...createC03RightHandRelease(),releaseToken:old.releaseToken,detail:"请让右手完整进入画面"};
    return old;
  }
  const category=match.category;
  const gesture=category?.score>=CONFIDENCE?({Closed_Fist:"fist",Open_Palm:"open"}[category.categoryName]??"unknown"):"unknown";
  const candidateSince=gesture===old.candidate?old.candidateSince:now;
  const common={candidate:gesture,candidateSince,lastSeen:now,confidence:category?.score??0};
  if(old.stage==="released"){
    if(now-old.releasedAt<DISPLAY_MS)return {...old,...common,detail:"折光已释放，请重新握拳"};
    if(gesture==="fist")return {...old,...common,stage:"arming",candidateSince:now,detail:"保持右拳，正在重新蓄势"};
    return {...old,...common,stage:"spent",detail:"请重新握拳以准备下一次释放"};
  }
  if(old.stage==="spent"){
    if(gesture==="fist")return {...old,...common,stage:"arming",candidateSince:now,detail:"保持右拳，正在重新蓄势"};
    return {...old,...common,detail:"请重新握拳以准备下一次释放"};
  }
  if(old.stage==="idle"){
    if(gesture==="fist")return {...old,...common,stage:"arming",candidateSince:now,detail:"保持右拳，正在确认蓄势"};
    return {...old,...common,detail:"右手握拳后快速张开"};
  }
  if(old.stage==="arming"){
    if(gesture!=="fist")return {...old,...common,stage:"idle",detail:"请重新稳定握拳"};
    if(now-candidateSince>=FIST_CONFIRM_MS)return {...old,...common,stage:"armed",lastFistAt:now,detail:"右拳已蓄势，快速张开释放"};
    return {...old,...common,detail:"保持右拳，正在确认蓄势"};
  }
  if(old.stage==="armed"){
    if(gesture==="fist")return {...old,...common,lastFistAt:now,detail:"右拳已蓄势，快速张开释放"};
    if(gesture==="open")return {...old,...common,stage:"opening",candidateSince:now,detail:"检测到张掌，正在释放"};
    return {...old,...common,detail:"保持右拳，或快速张开释放"};
  }
  if(old.stage==="opening"){
    if(gesture==="fist")return {...old,...common,stage:"armed",lastFistAt:now,detail:"右拳已蓄势，快速张开释放"};
    if(gesture!=="open"||now-old.lastFistAt>OPEN_WINDOW_MS)return {...old,...common,stage:"idle",detail:"张掌过慢，请重新握拳"};
    if(now-candidateSince>=OPEN_CONFIRM_MS)return {...old,...common,stage:"released",releasedAt:now,releaseToken:old.releaseToken+1,detail:"折光已释放，请重新握拳"};
    return {...old,...common,detail:"检测到张掌，正在释放"};
  }
  return {...old,...common};
}
