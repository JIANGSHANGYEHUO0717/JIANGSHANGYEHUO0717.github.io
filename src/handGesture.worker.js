// This installed MediaPipe runtime exposes ModuleFactory through classic
// importScripts. ES-module workers isolate it and fail during WASM startup.
importScripts("/wasm/vision_bundle.js");
const { FilesetResolver, GestureRecognizer } = self.Vision;

let recognizer;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const vision = await FilesetResolver.forVisionTasks(`${data.origin}/wasm`);
      recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${data.origin}/models/gesture_recognizer.task`, delegate: "CPU" },
        runningMode: "VIDEO", numHands: 2,
        minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5,
      });
      // Exercise the complete inference path without opening a camera.
      recognizer.recognizeForVideo(new OffscreenCanvas(32, 32), 1);
      self.postMessage({ type: "ready" });
    } else if (data.type === "frame") {
      try {
        const result = recognizer.recognizeForVideo(data.bitmap, data.now);
        self.postMessage({ type: "result", session: data.session, now: data.now,
          result: { gestures: result.gestures, landmarks: result.landmarks, handedness: result.handedness } });
      } finally { data.bitmap.close(); }
    }
  } catch (error) {
    self.postMessage({ type: "error", session: data.session, message: String(error?.message ?? error) });
  }
};
