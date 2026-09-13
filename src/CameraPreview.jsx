import { useState } from "react";

export function cameraBodyDetected(input) {
  const shouldersVisible = input.points && [11, 12].every((index) => {
    const point = input.points[index];
    return point && Math.min(point.visibility ?? 1, point.presence ?? 1) > 0.42;
  });
  const ready = input.mode === "camera" && input.cameraPhase === "ready";
  const wristsVisible = input.points && [15, 16].every(index => {
    const point = input.points[index];
    return point && Math.min(point.visibility ?? 1, point.presence ?? 1) > .5;
  });
  return Boolean(ready&&shouldersVisible&&wristsVisible);
}

export function CameraPreview({ input, lang="en" }) {
  const [ratio,setRatio]=useState(16/9);
  const recognized = cameraBodyDetected(input);
  const ready = input.mode === "camera" && input.cameraPhase === "ready";
  const busy = ["requesting", "loading"].includes(input.cameraPhase);
  const error = input.cameraError;
  const canStart = !busy && !ready;
  const english=lang==="en";
  const title = error ? (english?"CAMERA UNAVAILABLE":error.title) : input.cameraPhase === "requesting" ? (english?"ALLOW CAMERA ACCESS":"等待摄像头授权")
    : input.cameraPhase === "loading" ? (english?"PREPARING LOCAL INPUT":"正在准备本地识别")
    : ready&&!recognized ? (english?"STEP INTO VIEW":"请进入画面") : "";
  const hint = error ? (english?"CHECK BROWSER PERMISSION OR DEVICE":error.hint) : input.cameraPhase === "requesting" ? (english?"USE THE BROWSER PROMPT TO CONTINUE":"请在浏览器提示中允许访问")
    : input.cameraPhase === "loading" ? (english?"PROCESSING STAYS ON THIS DEVICE":"识别仅在本机运行") : "";

  return (
    <div className={`camera-preview ${recognized ? "recognized" : "unrecognized"}`} style={{aspectRatio:ratio}} data-camera-phase={input.cameraPhase} aria-label={english?"Local camera preview":"本机摄像头预览"}>
      <video ref={input.videoRef} playsInline muted aria-label={english?"Local camera feed":"本机摄像头画面"} onLoadedMetadata={event=>{
        const video=event.currentTarget;if(video.videoWidth&&video.videoHeight)setRatio(video.videoWidth/video.videoHeight);
      }} />
      <div className={`camera-preview-overlay${recognized ? " is-hidden" : ""}`}>
        <div className="camera-preview-status" role="status" aria-live="polite" aria-atomic="true">
          {title && <span className="camera-preview-title">{title}</span>}
          {hint && !canStart && <span className="camera-preview-hint">{hint}</span>}
        </div>
        {canStart&&error&&<button type="button" className="camera-preview-action" onClick={input.startCamera}>{english?"RETRY":"重试"}</button>}
      </div>
    </div>
  );
}
