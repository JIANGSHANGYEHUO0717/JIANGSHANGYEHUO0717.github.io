// At most one transferable video frame in flight. Recognition never blocks
// the render thread and never uploads the image to a remote service.
export function createHandGestureClient({ onResult, onStatus, onError }) {
  let worker, preparing, busy = false, ready = false, closed = false, lastFrame = 0, timer;
  let rejectInit;
  const fail = error => {
    console.error("Hand gesture worker failed", error);
    clearTimeout(timer); busy = false; ready = false;
    worker?.terminate(); worker = null; preparing = null;
    rejectInit?.(error); rejectInit = null;
    if (!closed) { onStatus("手势模型加载失败，可重试"); onError?.(error); }
  };
  const prepare = () => {
    if (preparing) return preparing;
    onStatus("手势模型加载中");
    preparing = new Promise((resolve, reject) => {
      rejectInit = reject;
      worker = new Worker(new URL("./handGesture.worker.js", import.meta.url));
      timer = setTimeout(() => fail(new Error("手势模型初始化超时")), 45000);
      worker.onerror = event => fail(new Error(event.message || "手势识别线程失败"));
      worker.onmessage = ({ data }) => {
        if (closed) return;
        if (data.type === "ready") {
          clearTimeout(timer); ready = true; rejectInit = null;
          onStatus("手势模型已就绪"); resolve();
        } else if (data.type === "result") {
          busy = false; onResult(data);
        } else if (data.type === "error") fail(new Error(data.message));
      };
      worker.postMessage({ type: "init", origin: location.origin });
    });
    return preparing;
  };
  const submit = async (video, session, now) => {
    if (closed || !ready || busy || now - lastFrame < 90 || video.readyState < 2) return;
    busy = true; lastFrame = now;
    try {
      const bitmap = await createImageBitmap(video, { resizeWidth: 640,
        resizeHeight: Math.max(1, Math.round(640 * video.videoHeight / video.videoWidth)), resizeQuality: "low" });
      if (closed || !ready || !worker) { bitmap.close(); busy = false; return; }
      worker.postMessage({ type: "frame", bitmap, session, now }, [bitmap]);
    } catch { busy = false; }
  };
  return { prepare, submit, close() {
    closed = true; clearTimeout(timer); worker?.terminate();
    rejectInit?.(new Error("手势识别已停止")); rejectInit = null;
  } };
}
