export const C01_CAVITY_COOLDOWN_SECONDS = .6;
export const C03_CAPTURE_COOLDOWN_SECONDS = .7;

const C01_CAVITY_STAGES = new Set(["arming", "pulling", "released"]);
const C03_CAPTURE_STAGES = new Set(["arming", "armed", "opening", "released"]);

export function createC01InteractionArbitration() {
  return { owner: "mirror", cooldown: 0 };
}

export function updateC01InteractionArbitration(state, {
  dt = 0,
  pinchStage = "idle",
  cavityReleaseActive = false,
} = {}) {
  const cavityIntent = C01_CAVITY_STAGES.has(pinchStage);
  if (cavityIntent) {
    state.owner = "cavity";
    state.cooldown = C01_CAVITY_COOLDOWN_SECONDS;
  } else if (state.owner === "cavity") {
    if (cavityReleaseActive) state.cooldown = C01_CAVITY_COOLDOWN_SECONDS;
    else state.cooldown = Math.max(0, state.cooldown - Math.max(0, dt));
    if (state.cooldown === 0) state.owner = "mirror";
  }
  return {
    owner: state.owner,
    cavityActive: state.owner === "cavity",
    mirrorActive: state.owner === "mirror",
    cooldown: state.cooldown,
  };
}

export function createC03InteractionArbitration() {
  return { cooldown: 0, lastCaptureDemo: 0 };
}

export function updateC03InteractionArbitration(state, {
  dt = 0,
  rightHandStage = "idle",
  captureReleaseActive = false,
  captureDemo = 0,
} = {}) {
  const captureIntent = C03_CAPTURE_STAGES.has(rightHandStage);
  const demoIntent = captureDemo !== state.lastCaptureDemo;
  state.lastCaptureDemo = captureDemo;
  if (captureIntent || captureReleaseActive || demoIntent) state.cooldown = C03_CAPTURE_COOLDOWN_SECONDS;
  else state.cooldown = Math.max(0, state.cooldown - Math.max(0, dt));
  const captureActive = captureIntent || captureReleaseActive || demoIntent || state.cooldown > 0;
  return {
    captureActive,
    blockRightWrist: captureActive,
    cooldown: state.cooldown,
  };
}
