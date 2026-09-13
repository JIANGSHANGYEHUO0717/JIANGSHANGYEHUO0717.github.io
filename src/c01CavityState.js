import { MathUtils } from "three";

export const CAVITY_WAVE_DELAYS = [0, .18, .36];
export const CAVITY_SOURCE_COUNT = 4;
export const CAVITY_EDGE_REFLECTIONS = 4;
export const CAVITY_RELEASE_DURATION = 3.2;
const clamp = value => MathUtils.clamp(value, 0, 1);

export function createCavityState() {
  return {
    mix: 0, time: 0, demoTime: 0, demoPhase: 0, demoFired: false,
    charge: 0, targetCharge: 0, release: 0, releaseAge: -1, releaseStrength: 0,
    drive: 0, targetDrive: 0, hand: null, lost: 0, lastMotion: -10,
    pulseToken: 0, tracking: "demo", sourceIndex: 0, sourceLocked: false,
    pinchReleaseToken: 0, gestureStage: "idle", audioGate: false,
  };
}

export function releaseCavity(state, strength = state.charge) {
  if (state.releaseAge >= 0 || strength < .12) return false;
  state.releaseAge = 0;
  state.releaseStrength = MathUtils.clamp(strength, .28, 1);
  state.release = 0;
  state.charge = 0;
  state.targetCharge = 0;
  return true;
}

function updateRelease(state, step) {
  if (state.releaseAge < 0) { state.release = 0; return; }
  state.releaseAge += step;
  const attack = MathUtils.smoothstep(state.releaseAge, 0, .13);
  const decay = 1 - MathUtils.smoothstep(state.releaseAge, .5, 3.02);
  state.release = state.releaseStrength * attack * decay;
  if (state.releaseAge >= CAVITY_RELEASE_DURATION) {
    state.releaseAge = -1; state.release = 0; state.releaseStrength = 0;
  }
}

export function updateCavityState(state, {
  dt, active = false, mode = "manual", charge = 0, pulse = 0,
  points, pinch, paused = false, reduced = false,
}) {
  const step = MathUtils.clamp(dt, 0, .25);
  state.mix = MathUtils.damp(state.mix, active ? 1 : 0, 7, step);
  if (active && state.mix > .998) state.mix = 1;
  if (!active && state.mix < .002) state.mix = 0;

  if (!active) {
    updateRelease(state, step);
    state.charge = MathUtils.damp(state.charge, 0, 7, step);
    state.hand = null; state.lost = 0;
    if (state.mix === 0) {
      state.time = 0; state.demoTime = 0; state.demoPhase = 0; state.demoFired = false;
      state.charge = 0; state.targetCharge = 0; state.release = 0;
      state.releaseAge = -1; state.releaseStrength = 0; state.drive = 0; state.targetDrive = 0;
      state.lastMotion = -10; state.tracking = "manual"; state.sourceIndex = 0; state.sourceLocked = false;
      state.pinchReleaseToken = 0; state.gestureStage = "idle"; state.audioGate = false;
    }
    return state;
  }
  if (paused) return state;

  state.time += step;
  updateRelease(state, step);
  if (pulse !== state.pulseToken) {
    state.pulseToken = pulse;
    if(releaseCavity(state, Math.max(state.charge, charge)))state.audioGate=true;
  }

  if (mode === "camera") {
    const gesture=pinch??{};
    state.gestureStage=gesture.stage??"idle";
    state.tracking=gesture.handsVisible?`pinch-${state.gestureStage}`:"waiting-for-two-hands";
    state.targetDrive=0;state.hand=null;
    state.lost=gesture.handsVisible?0:state.lost+step;
    if(Number.isFinite(gesture.releaseToken)&&gesture.releaseToken!==state.pinchReleaseToken){
      state.pinchReleaseToken=gesture.releaseToken;
      if(releaseCavity(state,Math.max(state.charge,gesture.releaseStrength??0)))state.audioGate=true;
    }
    if(state.releaseAge>=0){state.targetCharge=0;state.audioGate=true;}
    else if(gesture.stage==="pulling"){
      state.targetCharge=clamp(gesture.charge??0);state.audioGate=true;
    }else{state.targetCharge=0;state.audioGate=false;}
  } else if (mode === "demo") {
    if (!reduced) state.demoTime += step;
    const phase = state.demoTime % 8.4;
    if (phase < state.demoPhase) state.demoFired = false;
    state.demoPhase = phase;
    state.targetDrive = reduced ? 0 : Math.sin(state.demoTime * .72) * .68;
    if (phase < .7 || phase > 5.1) state.targetCharge = 0;
    else if (phase < 4.55) state.targetCharge = MathUtils.smoothstep(phase, .7, 4.55);
    else state.targetCharge = 1;
    if (!reduced && phase >= 4.72 && !state.demoFired) {
      state.charge = Math.max(state.charge, .98);
      releaseCavity(state, 1); state.demoFired = true;
    }
    state.tracking = "demo";state.gestureStage="demo";
    state.audioGate=state.releaseAge>=0||state.targetCharge>.01;
  } else {
    state.targetCharge = clamp(charge); state.targetDrive = 0; state.tracking = "manual";state.gestureStage="manual";
    state.audioGate=state.releaseAge>=0||state.targetCharge>.01;
  }

  const beginningCharge = state.releaseAge < 0 && state.targetCharge > .06 && !state.sourceLocked;
  if (beginningCharge) {
    const offset = 1 + Math.floor(Math.random()*(CAVITY_SOURCE_COUNT-1));
    state.sourceIndex = (state.sourceIndex+offset)%CAVITY_SOURCE_COUNT;
    state.sourceLocked = true;
  }
  if (state.releaseAge < 0 && state.targetCharge < .015 && state.charge < .015) state.sourceLocked = false;

  state.charge = MathUtils.damp(state.charge, state.releaseAge >= 0 ? 0 : state.targetCharge, 3.1, step);
  state.drive = MathUtils.damp(state.drive, state.targetDrive, state.lost > 1.2 ? 1.6 : 7, step);
  return state;
}
