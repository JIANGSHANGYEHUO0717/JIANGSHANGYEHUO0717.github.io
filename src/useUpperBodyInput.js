import { useCallback, useEffect, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { computeSignal, INITIAL_SIGNAL, makeDemoPose } from "./signal.js";
import { createHandGestureState, updateHandGesture, handGestureLabel } from "./handGesture.js";
import { createHandGestureClient } from "./handGestureClient.js";
import { createDualPinchState, updateDualPinchState } from "./c01DualPinch.js";
import { createC03RightHandRelease, updateC03RightHandRelease } from "./c03RightHandRelease.js";

function cameraFailure(error, stage) {
  if (stage === "model") return { title: "识别加载失败", hint: "请重试以重新准备识别" };
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return { title: "未获得摄像头权限", hint: "请在浏览器中允许访问，再重试" };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { title: "未找到摄像头", hint: "请连接摄像头后重试" };
    case "NotReadableError":
    case "TrackStartError":
      return { title: "摄像头无法使用", hint: "请检查是否被其他应用占用" };
    case "UnsupportedCamera":
      return { title: "无法访问摄像头", hint: "请使用本机预览或安全连接" };
    default:
      return { title: "摄像头连接中断", hint: "请检查设备连接后重试" };
  }
}

export function useUpperBodyInput({ poseOnly = false, inputKind = "default" } = {}) {
  const poseOnlyRef = useRef(poseOnly);
  poseOnlyRef.current = poseOnly;
  const inputKindRef = useRef(inputKind);
  inputKindRef.current = inputKind;
  const [mode, setMode] = useState("idle");
  const [status, setStatus] = useState("待机");
  const [detail, setDetail] = useState("等待观测者进入");
  const [signal, setSignal] = useState(INITIAL_SIGNAL);
  const [points, setPoints] = useState(null);
  const [calibration, setCalibration] = useState(0);
  const [fps, setFps] = useState(0);
  const [handModelStatus, setHandModelStatus] = useState("手势模型未加载");
  const [handDetail, setHandDetail] = useState("请将一只手掌朝向摄像头");
  const [cameraPhase, setCameraPhase] = useState("idle");
  const [permissionPhase,setPermissionPhase]=useState("idle");
  const [cameraError, setCameraError] = useState(null);
  const [handVisible, setHandVisible] = useState(false);
  const [dualPinch, setDualPinch] = useState(createDualPinchState);
  const [c03RightHand,setC03RightHand]=useState(createC03RightHandRelease);
  const videoRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const previousRef = useRef(null);
  const signalRef = useRef(INITIAL_SIGNAL);
  const inferenceRef = useRef(0);
  const lastRef = useRef(performance.now());
  const demoStartRef = useRef(0);
  const framesRef = useRef([]);
  const handClientRef = useRef(null);
  const handStateRef = useRef(createHandGestureState());
  const dualPinchRef = useRef(createDualPinchState());
  const c03RightHandRef=useRef(createC03RightHandRelease());
  const posePointsRef = useRef(null);
  const handResultAtRef = useRef(0);
  const sessionRef = useRef(0);
  const modeRef = useRef("idle");
  const manualGestureRef = useRef(null);
  const mountedRef = useRef(true);
  const cameraPhaseRef = useRef("idle");
  const cameraWasEnabledRef = useRef(false);
  const permissionPhaseRef=useRef("idle");
  const posePreparingRef = useRef(null);
  const cameraFailureRef = useRef(null);

  const changeCameraPhase = useCallback((phase) => {
    cameraPhaseRef.current = phase;
    setCameraPhase(phase);
  }, []);

  const requestCameraPermission=useCallback(async()=>{
    if(["requesting","granted","denied"].includes(permissionPhaseRef.current))return;
    permissionPhaseRef.current="requesting";setPermissionPhase("requesting");
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw Object.assign(new Error("Camera API unavailable"),{name:"UnsupportedCamera"});
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:1280},height:{ideal:720}},audio:false});
      stream.getTracks().forEach(track=>track.stop());
      if(!mountedRef.current)return;
      permissionPhaseRef.current="granted";setPermissionPhase("granted");
    }catch{
      if(!mountedRef.current)return;
      permissionPhaseRef.current="denied";setPermissionPhase("denied");
    }
  },[]);

  const prepareHandModel = useCallback(() => {
    if (!handClientRef.current) handClientRef.current = createHandGestureClient({
      onStatus: message => { if (mountedRef.current) setHandModelStatus(message); },
      onResult: data => {
        if (data.session !== sessionRef.current || modeRef.current !== "camera") return;
        handResultAtRef.current = performance.now();
        handStateRef.current = updateHandGesture(handStateRef.current, data.result, data.now);
        const pose=posePointsRef.current;
        c03RightHandRef.current=updateC03RightHandRelease(c03RightHandRef.current,data.result,pose,data.now);
        setC03RightHand(c03RightHandRef.current);
        const shoulderSpan=pose?.[11]&&pose?.[12]?Math.hypot(pose[11].x-pose[12].x,pose[11].y-pose[12].y):.2;
        dualPinchRef.current=updateDualPinchState(dualPinchRef.current,data.result,data.now,shoulderSpan);
        setDualPinch(dualPinchRef.current);
      },
      onError: error => {
        if (cameraPhaseRef.current === "ready") cameraFailureRef.current?.(error, "model");
      },
    });
    return handClientRef.current.prepare();
  }, []);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    previousRef.current = null;
    cameraFailureRef.current = null;
  }, []);

  const failCamera = useCallback((error, stage = "camera") => {
    if (!mountedRef.current) return;
    stop();
    if (stage === "model") {
      handClientRef.current?.close(); handClientRef.current = null;
      landmarkerRef.current?.close?.(); landmarkerRef.current = null;
    }
    changeCameraPhase("error");
    const failure = cameraFailure(error, stage);
    setCameraError(failure);
    setStatus("离线"); setDetail(failure.title);
    setPoints(null); setHandVisible(false); setCalibration(0); setFps(0);
    posePointsRef.current=null;dualPinchRef.current=createDualPinchState();setDualPinch(dualPinchRef.current);
    c03RightHandRef.current=createC03RightHandRelease();setC03RightHand(c03RightHandRef.current);
    // A disconnected device uses the existing gentle lost-hand recall.
    signalRef.current = { ...INITIAL_SIGNAL, handCommand: "lost" };
    setSignal(signalRef.current);
    setHandDetail("输入已断开，缓慢回凝");
  }, [stop, changeCameraPhase]);

  const preparePoseModel = useCallback(() => {
    if (landmarkerRef.current) return Promise.resolve(landmarkerRef.current);
    if (!posePreparingRef.current) {
      posePreparingRef.current = (async () => {
        const vision = await FilesetResolver.forVisionTasks("/wasm");
        const model = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: `${location.origin}/models/pose_landmarker_lite.task`, delegate: "CPU" },
          runningMode: "VIDEO", numPoses: 1,
          minPoseDetectionConfidence: .45, minPosePresenceConfidence: .45, minTrackingConfidence: .45,
        });
        if (!mountedRef.current) { model.close(); return null; }
        landmarkerRef.current = model;
        return model;
      })().finally(() => { posePreparingRef.current = null; });
    }
    return posePreparingRef.current;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false; stop();
      handClientRef.current?.close(); handClientRef.current = null;
      landmarkerRef.current?.close?.(); landmarkerRef.current = null;
    };
  }, [stop]);

  const update = useCallback((next, now) => {
    signalRef.current = next;
    setSignal(next);
    framesRef.current.push(now);
    framesRef.current = framesRef.current.filter((time) => time > now - 1000);
    setFps(framesRef.current.length);
  }, []);

  const run = useCallback((sessionMode) => {
    const session = sessionRef.current;
    let poseErrors = 0;
    const tick = (now) => {
      if (session !== sessionRef.current) return;
      if (now - inferenceRef.current < 52) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      inferenceRef.current = now;
      const dt = Math.min(100, now - lastRef.current || 52);
      lastRef.current = now;
      let nextPoints = null;
      let handCommand = "hold";
      if (sessionMode === "demo") nextPoints = makeDemoPose(now - demoStartRef.current);
      else if (videoRef.current?.readyState >= 2 && landmarkerRef.current) {
        try {
          nextPoints = landmarkerRef.current.detectForVideo(videoRef.current, now).landmarks?.[0] || null;
          poseErrors = 0;
        } catch (error) {
          nextPoints = null;
          if (++poseErrors >= 3) { cameraFailureRef.current?.(error, "model"); return; }
        }
        if (!poseOnlyRef.current && !document.hidden) handClientRef.current?.submit(videoRef.current, session, now);
      }
      if (sessionMode === "demo") {
        const cycle = ((now - demoStartRef.current) / 1000) % 46;
        handCommand = manualGestureRef.current ?? ((cycle >= 3 && cycle < 6) || (cycle >= 12 && cycle < 32) ? "open" : "fist");
        setHandDetail(handCommand === "open" ? "模拟张掌 · 持续展开" : handCommand === "fist" ? "模拟握拳 · 缓慢回凝" : "模拟手部丢失");
      } else {
        if (now - handResultAtRef.current > 500) handStateRef.current = updateHandGesture(handStateRef.current, null, now);
        if(now-handResultAtRef.current>500){c03RightHandRef.current=updateC03RightHandRelease(c03RightHandRef.current,null,posePointsRef.current,now);setC03RightHand(c03RightHandRef.current);}
        if (now-handResultAtRef.current>260&&dualPinchRef.current.stage!=="idle") {
          dualPinchRef.current=updateDualPinchState(dualPinchRef.current,null,now);
          setDualPinch(dualPinchRef.current);
        }
        handCommand = handStateRef.current.command;
        setHandDetail(inputKindRef.current==="c03"?c03RightHandRef.current.detail:handGestureLabel(handStateRef.current));
        setHandVisible(handStateRef.current.hand !== null && now - handStateRef.current.lastSeen < 500);
      }
      const withHand = next => ({ ...next, handCommand,
        handConfidence: sessionMode === "demo" ? 1 : handStateRef.current.confidence,
        escape: handCommand === "open" ? 1 : 0, escapeVelocity: 0 });
      if (nextPoints) {
        posePointsRef.current=nextPoints;
        setPoints(nextPoints);
        const next = computeSignal(nextPoints, previousRef.current, dt, signalRef.current);
        previousRef.current = nextPoints.map((point) => ({ ...point }));
        update(withHand(next), now);
        setCalibration((old) => {
          const visible = [11, 12, 13, 14].every((index) => (nextPoints[index]?.visibility ?? 1) > .5);
          const nextCalibration = visible ? Math.min(100, old + dt / 15) : Math.max(0, old - dt / 8);
          if (nextCalibration >= 100) { setStatus("响应中"); setDetail(inputKindRef.current==="c01" ? "双手捏合通道已连接" : poseOnlyRef.current ? "镜像共振通道已连接" : "流体重构通道已连接"); }
          return nextCalibration;
        });
      } else {
        posePointsRef.current=null;
        setPoints(null);
        update(withHand(computeSignal(null, null, dt, signalRef.current)), now);
        if (sessionMode === "camera") { setStatus("信号丢失"); setDetail("请让肩部与手臂回到画面"); }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    lastRef.current = performance.now();
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [update]);

  const reset = () => {
    signalRef.current = INITIAL_SIGNAL;
    setSignal(INITIAL_SIGNAL);
    setPoints(null);
    setCalibration(0);
    previousRef.current = null;
    inferenceRef.current = 0;
    handStateRef.current = createHandGestureState();
    dualPinchRef.current = createDualPinchState();
    c03RightHandRef.current=createC03RightHandRelease();
    posePointsRef.current = null;
    handResultAtRef.current = 0;
    framesRef.current = [];
    setFps(0);
    setHandVisible(false);
    setDualPinch(dualPinchRef.current);
    setC03RightHand(c03RightHandRef.current);
    setHandDetail("请将一只手掌朝向摄像头");
    setCameraError(null);
  };

  const startDemo = useCallback(() => {
    stop(); reset(); demoStartRef.current = performance.now();
    changeCameraPhase("idle");
    manualGestureRef.current = null; modeRef.current = "demo";
    if (!poseOnlyRef.current) prepareHandModel().catch(() => {});
    setMode("demo"); setStatus("校准中"); setDetail("正在生成模拟上半身信号"); run("demo");
  }, [run, stop, prepareHandModel, changeCameraPhase]);

  const simulateHand = useCallback(command => {
    if (modeRef.current !== "demo") startDemo();
    manualGestureRef.current = command;
  }, [startDemo]);

  const startCamera = useCallback(async () => {
    if (["requesting", "loading", "ready"].includes(cameraPhaseRef.current)) return;
    stop(); reset(); setMode("camera"); setStatus("等待授权"); setDetail("请在浏览器中允许访问摄像头");
    changeCameraPhase("requesting");
    modeRef.current = "camera";
    const session = sessionRef.current;
    let stage = "camera";
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("Camera API unavailable"), { name: "UnsupportedCamera" });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (session !== sessionRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      cameraWasEnabledRef.current = true;
      stream.getVideoTracks().forEach(track => track.addEventListener("ended", () => {
        if (session === sessionRef.current) failCamera(new Error("Camera disconnected"));
      }, { once: true }));
      if (!videoRef.current) throw new Error("Camera preview unavailable");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (session !== sessionRef.current) return;
      stage = "model";
      changeCameraPhase("loading");
      setStatus("加载中"); setDetail(inputKindRef.current==="c01" ? "正在准备本地身体与双手识别" : poseOnlyRef.current ? "正在准备本地身体识别" : "正在准备本地身体与手势识别");
      if (!poseOnlyRef.current) await prepareHandModel();
      if (session !== sessionRef.current) return;
      await preparePoseModel();
      if (session !== sessionRef.current) return;
      cameraFailureRef.current = failCamera;
      changeCameraPhase("ready");
      setStatus("校准中"); setDetail(inputKindRef.current==="c01" ? "请将肩部与双手置于画面内" : "请将肩部与双臂置于画面内"); run("camera");
    } catch (error) {
      if (session !== sessionRef.current) return;
      console.error(error);
      failCamera(error, stage);
    }
  }, [run, stop, prepareHandModel, preparePoseModel, changeCameraPhase, failCamera]);

  const resumeCamera = useCallback(async () => {
    // Only resume a camera the viewer enabled in this page session; a fresh
    // visit always starts with the visible consent button.
    if (!cameraWasEnabledRef.current || modeRef.current !== "idle") return;
    const session = sessionRef.current;
    try {
      if (navigator.permissions?.query) {
        const permission = await navigator.permissions.query({ name: "camera" });
        if (permission.state !== "granted") return;
      }
    } catch { /* Permission queries are not available in every browser. */ }
    if (session === sessionRef.current && modeRef.current === "idle") startCamera();
  }, [startCamera]);

  const returnToIdle = useCallback(() => {
    stop();
    modeRef.current = "idle";
    handStateRef.current = createHandGestureState();
    dualPinchRef.current = createDualPinchState();
    c03RightHandRef.current=createC03RightHandRelease();
    posePointsRef.current = null;
    signalRef.current = INITIAL_SIGNAL;
    setSignal(INITIAL_SIGNAL);
    setPoints(null);
    setCalibration(0);
    setFps(0);
    previousRef.current = null;
    inferenceRef.current = 0;
    setMode("idle");
    setStatus("待机");
    setDetail("等待观测者进入");
    changeCameraPhase("idle");
    setCameraError(null); setHandVisible(false);
    setDualPinch(dualPinchRef.current);
    setC03RightHand(c03RightHandRef.current);
    setHandDetail("请将一只手掌朝向摄像头");
  }, [stop, changeCameraPhase]);

  return { mode, status, detail, signal, points, dualPinch, c03RightHand, calibration, fps, videoRef, startDemo, startCamera, stop, returnToIdle,
    simulateHand, handDetail, handModelStatus, cameraPhase, cameraError, handVisible, resumeCamera, permissionPhase, requestCameraPermission };
}
