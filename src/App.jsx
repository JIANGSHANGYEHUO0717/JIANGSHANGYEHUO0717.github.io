import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArchiveFieldStage } from "./ArchiveFieldStage.jsx";
import { preloadArchiveModels } from "./archiveAssets.js";
import { preloadObservationModel } from "./observationAssets.js";
import { preloadSpecimenModel } from "./specimenAssets.js";
import { SpecimenStage } from "./SpecimenStage.jsx";
import { OrganismStage } from "./OrganismStage.jsx";
import { ArchiveInterface, ObservationInterface } from "./InterfaceChrome.jsx";
import { ORGANISM_CATALOG, organismById, organismFromView } from "./organismCatalog.js";
import { useUpperBodyInput } from "./useUpperBodyInput.js";
import { ARCHIVE_FADE_SECONDS } from "./transitionContinuity.js";

const C03_LIGHT_TUNING_DEFAULT={main:1,fill:1,rim:1,top:1,under:1,field:1,environment:.39,coreWarm:1,coreEmissive:1};
const C03_LIGHT_TUNING_LABELS={main:"冰青主柔光饱和度",fill:"水蓝补光饱和度",rim:"深水蓝轮廓光饱和度",under:"冰青底光饱和度"};

function initialScreen() {
  return organismFromView(new URLSearchParams(window.location.search).get("view"))?.id.toLowerCase() ?? "archive";
}

function DebugTools({ screen, setScreen, archive, resetArchive, input }) {
  return (
    <div className="debug-tools" aria-label="开发调试工具">
      <button onClick={() => setScreen(screen === "archive" ? "c04" : "archive")}>{screen === "archive" ? "打开 C04" : "打开档案场"}</button>
      {screen === "archive" ? (
        <><button onClick={resetArchive}>重置选择</button><span>{archive.phase}{archive.id ? ` / ${archive.id}` : ""}</span></>
      ) : screen === "c04" ? (
        <>
          <button onClick={input.startCamera} disabled={["requesting", "loading", "ready"].includes(input.cameraPhase)}>连接摄像头</button>
          <button onClick={input.startDemo}>演示信号</button>
          <button onClick={() => input.simulateHand("open")}>模拟张掌</button>
          <button onClick={() => input.simulateHand("fist")}>模拟握拳</button>
          <span>
            {input.status} · 流 {input.signal.circularSpeed.toFixed(2)}
            {input.signal.circularDirection < 0 ? " ↺" : " ↻"}
            {" · "}E {input.signal.escape.toFixed(2)}
          </span>
          <span>{input.handDetail} · {input.handModelStatus}</span>
        </>
      ) : <span>{screen === "c01" ? "镜像共振 · 万花筒 / 腔体回声" : "模型观测 · 专属身体响应待接入"}</span>}
    </div>
  );
}

function ArchiveScreen({ archive, sessionRef, onInteractionChange, resetKey, onReadyChange, lang, onLanguageChange, transitioning = false, transitionReady = false, entering = false, entryReady = false, entryError = "" }) {
  return (
    <section className={`archive-screen${transitioning ? " transition-underlay" : ""}${transitionReady ? " transition-ready" : ""}${entering ? " archive-entry-source" : ""}${entering && entryReady ? " entry-ready" : ""}`} inert={entering || transitioning ? true : undefined} aria-label="生态档案，五个生命信号">
      <img className={`archive-poster${archive.ready ? " is-ready" : ""}`} src="/archive-poster.png" alt="" aria-hidden="true" fetchPriority="high" />
      <ArchiveFieldStage sessionRef={sessionRef} frozen={entering || transitioning} hideOrganisms={transitioning} resetKey={resetKey} onInteractionChange={onInteractionChange} onReadyChange={onReadyChange} lang={lang} />
      <div className={`archive-live-interface${archive.ready ? " is-ready" : ""}`}>
        <ArchiveInterface archive={archive} lang={lang} onLanguageChange={onLanguageChange} />
      </div>
      {!archive.ready && <div className="archive-loading">{lang==="en"?"INITIALIZING ARCHIVE":"正在连接生态档案"}</div>}
      {entryError && <div className="archive-loading" role="alert">{lang==="en"?"SPECIMEN UNAVAILABLE — SELECT AGAIN":entryError}</div>}
      {ORGANISM_CATALOG.map(organism => <button key={organism.id} className="archive-keyboard-entry" disabled={!archive.ready || entering || transitioning} onClick={() => onInteractionChange({ phase: "clicked", id: organism.id })}>{lang==="en"?`OBSERVE ${organism.id}`:`进入${organism.category}观测`}</button>)}
    </section>
  );
}

function cloneSignal(signal) {
  return {
    ...signal,
    directionVector: { ...signal.directionVector },
  };
}

function ObservationScreen({ organism, input, archiveAngle, archiveSession, onExitStart, onExitComplete, onExitCancel, onArchiveReveal, archiveReady, lang, onLanguageChange, debug = false, returning = false, entering = false, onEntryReady, onEntryComplete, onEntryError }) {
  const [modelState, setModelState] = useState("正在读取标本模型");
  const [exitSignal, setExitSignal] = useState(null);
  const [exitError, setExitError] = useState("");
  const [mirrorControl, setMirrorControl] = useState({ mode: "manual", amount: 0, paused: false, modelMotion: true, cameraMotion: true, lightMotion: true });
  const [cavityControl,setCavityControl] = useState({mode:"demo",charge:0,pulse:0,paused:false,sound:false});
  const [c02Control,setC02Control] = useState({demo:0});
  const [c03Control,setC03Control] = useState({demo:0,captureDemo:0,opticsRadius:1.25,opticsSpeed:.70,coreMotion:1.2,tipMotion:3,
    opticsAfterimage:true,opticsDispersion:true,opticsPathRelay:true,opticsCaustics:true,opticsShutter:true});
  const [c05Control,setC05Control]=useState({demo:0});
  const c03Lighting="abyss";
  const [c03LightTuning,setC03LightTuning]=useState(C03_LIGHT_TUNING_DEFAULT);
  const exiting = Boolean(exitSignal);
  const fluid = organism.id === "C04";
  const mirror = organism.id === "C01";
  const network = organism.id === "C02";
  const glass = organism.id === "C03";
  const composite = organism.id === "C05";
  const Stage = fluid ? SpecimenStage : OrganismStage;
  const beginExit = () => {
    if (exiting) return;
    setExitSignal(cloneSignal(input.signal));
    onExitStart();
  };
  return (
    <section className={`observation-screen${network ? " c02-lighting-membrane" : ""}${glass ? ` c03-lighting-${c03Lighting}` : ""}${composite ? " c05-lighting-greenhouse" : ""}${exiting ? " is-exiting" : ""}${returning ? " is-returning" : ""}${entering ? " entry-destination" : ""}`} inert={entering || returning ? true : undefined} aria-busy={entering || returning} aria-label={`${organism.category}单体观测页`}>
      <Stage
        organism={organism}
        mirrorControl={mirror ? { ...mirrorControl, mode: input.mode === "camera" ? "camera" : mirrorControl.mode } : null}
        mirrorPoints={mirror ? input.points : null}
        c02Control={network ? {...c02Control,mode:input.mode,points:input.points,handCommand:input.signal.handCommand,handConfidence:input.signal.handConfidence} : null}
        c03Points={glass ? input.points : null}
        c03Control={glass ? {...c03Control,rightHand:input.c03RightHand} : null}
        c05Control={composite ? {...c05Control,mode:input.mode,points:input.points} : null}
        interaction="combined"
        c02LightingPreset={network ? "membrane" : undefined}
        c03LightingPreset={glass ? c03Lighting : undefined}
        c03LightTuning={glass ? c03LightTuning : undefined}
        cavityControl={mirror ? {...cavityControl,mode:input.mode === "camera" ? "camera" : cavityControl.mode,pinch:input.dualPinch} : null}
        signal={exitSignal ?? input.signal}
        exitRequested={exiting}
        onExitComplete={onExitComplete}
        onExitError={(message) => { setExitSignal(null); setExitError(message); onExitCancel(); }}
        onArchiveReveal={onArchiveReveal}
        archiveReady={archiveReady}
        onModelState={setModelState}
        entryRequested={entering}
        archiveAngle={archiveAngle}
        archiveSession={archiveSession}
        onEntryReady={onEntryReady}
        onEntryComplete={onEntryComplete}
        onEntryError={onEntryError}
      />
      <ObservationInterface organism={organism} input={input} lang={lang} onLanguageChange={onLanguageChange} onReturn={beginExit} disabled={entering||exiting} />
      {debug && network && <fieldset className="c02-interaction-controls" aria-label="C02表面改道" data-demo={c02Control.demo} disabled={entering || exiting || modelState !== "标本模型已连接"}>
        <legend>表面改道</legend>
        <button type="button" onClick={()=>setC02Control(current=>({...current,demo:current.demo+1}))}>模拟一次改道</button>
        <button type="button" onClick={input.startCamera} disabled={["requesting","loading","ready"].includes(input.cameraPhase)}>{input.cameraPhase==="ready"?"摄像头已连接":"连接摄像头"}</button>
        <p>张开一只手定位入口，移动方向会改变信号分流</p>
        <span className="visually-hidden" aria-live="polite">改道试映 {c02Control.demo}</span>
      </fieldset>}
      {debug && glass && <fieldset className="c03-interaction-options" aria-label="C03交互试映" disabled={entering || exiting || modelState !== "标本模型已连接"}>
        <legend>交互试映</legend>
        <button type="button" onClick={()=>setC03Control(current=>({...current,demo:current.demo+1}))}>模拟一次挥击</button>
        <button type="button" onClick={()=>setC03Control(current=>({...current,captureDemo:current.captureDemo+1}))}>模拟一次传递</button>
        <button type="button" onClick={input.startCamera} disabled={["requesting","loading","ready"].includes(input.cameraPhase)}>{input.cameraPhase==="ready"?"摄像头已连接":"连接摄像头"}</button>
      </fieldset>}
      {debug && glass && c03Lighting==="abyss" && <fieldset className="c03-light-tuning" aria-label="深海发光切片灯光调节" disabled={entering || exiting || modelState !== "标本模型已连接"}>
        <legend>有色灯饱和度 · 环境反射 39%</legend>
        {Object.entries(C03_LIGHT_TUNING_LABELS).map(([id,label])=><label key={id}>
          <span>{label}<output>{Math.round(c03LightTuning[id]*100)}%</output></span>
          <input type="range" min="0" max="200" step="1" value={Math.round(c03LightTuning[id]*100)}
            onInput={event=>{const value=Number(event.currentTarget.value)/100;setC03LightTuning(current=>({...current,[id]:value}));}}
            onChange={event=>{const value=Number(event.currentTarget.value)/100;setC03LightTuning(current=>({...current,[id]:value}));}} />
        </label>)}
        <label>
          <span>米白核心饱和度<output>{Math.round(c03LightTuning.coreWarm*100)}%</output></span>
          <input type="range" min="0" max="200" step="1" value={Math.round(c03LightTuning.coreWarm*100)}
            onInput={event=>{const value=Number(event.currentTarget.value)/100;setC03LightTuning(current=>({...current,coreWarm:value}));}}
            onChange={event=>{const value=Number(event.currentTarget.value)/100;setC03LightTuning(current=>({...current,coreWarm:value}));}} />
        </label>
        <label>
          <span>核心自发光强度<output>{Math.round(c03LightTuning.coreEmissive*100)}%</output></span>
          <input type="range" min="0" max="300" step="1" value={Math.round(c03LightTuning.coreEmissive*100)}
            onInput={event=>{const value=Number(event.currentTarget.value)/100;setC03LightTuning(current=>({...current,coreEmissive:value}));}}
            onChange={event=>{const value=Number(event.currentTarget.value)/100;setC03LightTuning(current=>({...current,coreEmissive:value}));}} />
        </label>
        <button type="button" onClick={()=>setC03LightTuning({...C03_LIGHT_TUNING_DEFAULT})}>恢复深海默认值</button>
      </fieldset>}
      {debug && composite && <fieldset className="c05-interaction-controls" aria-label="C05活体层析" disabled={entering || exiting || modelState !== "标本模型已连接"}>
        <legend>活体层析</legend>
        <button type="button" onClick={()=>setC05Control(current=>({...current,demo:current.demo+1}))}>模拟一次层析</button>
        <button type="button" onClick={input.startCamera} disabled={["requesting","loading","ready"].includes(input.cameraPhase)}>{input.cameraPhase==="ready"?"摄像头已连接":"连接摄像头"}</button>
        <p>双手上下移动观察层 · 双手间距控制层析厚度</p>
      </fieldset>}
      <span className="visually-hidden" aria-live="polite">{modelState}</span>
      {!fluid && modelState === "标本模型读取失败" && <div className="archive-loading" role="alert">{lang==="en"?"SPECIMEN UNAVAILABLE — RETURN TO ARCHIVE": "模型读取失败，请返回档案后重试"}</div>}
      {exitError && <div className="archive-loading" role="alert">{lang==="en"?"RETURN FIELD UNAVAILABLE — TRY AGAIN":exitError}</div>}
    </section>
  );
}

export function App() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const debug = query.get("debug") === "1";
  const terrainStudy = debug && query.get("terrain") === "1";
  const [screen, setScreenState] = useState(initialScreen);
  const [lang,setLang]=useState("en");
  const [selectedId, setSelectedId] = useState(() => organismFromView(query.get("view"))?.id ?? "C04");
  const input = useUpperBodyInput({ poseOnly: false, inputKind: selectedId === "C01" ? "c01" : selectedId === "C02" ? "c02" : selectedId === "C03" ? "c03" : "default" });
  const [archive, setArchive] = useState({ phase: "default", id: null, ready: false });
  const [resetKey, setResetKey] = useState(0);
  const [archiveTransitionMounted, setArchiveTransitionMounted] = useState(false);
  const [entryReady, setEntryReady] = useState(false);
  const [entrySourceVisible, setEntrySourceVisible] = useState(true);
  const [entryError, setEntryError] = useState("");
  const entryLockRef = useRef(false);
  // Retained across archive unmounts; no React update on each animation frame.
  const archiveSession = useRef({ angle: 0, paused: terrainStudy || window.matchMedia("(prefers-reduced-motion: reduce)").matches });

  useEffect(()=>{input.requestCameraPermission();},[input.requestCameraPermission]);

  useEffect(() => {
    if (terrainStudy) return;
    preloadArchiveModels().catch(() => {});
  }, [terrainStudy]);

  useEffect(() => {
    if (terrainStudy || !archive.ready) return undefined;
    const preload = () => {
      Promise.allSettled([
        ...["C01", "C02", "C03", "C05"].map(preloadObservationModel),
        preloadSpecimenModel(),
        input.preloadModels(),
      ]);
    };
    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(preload, { timeout: 1600 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timer = window.setTimeout(preload, 650);
    return () => window.clearTimeout(timer);
  }, [archive.ready, input.preloadModels, terrainStudy]);

  useEffect(() => {
    if (screen !== "entering" || !entryReady) return undefined;
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 250 : ARCHIVE_FADE_SECONDS * 1000;
    const timer = window.setTimeout(() => setEntrySourceVisible(false), delay);
    return () => window.clearTimeout(timer);
  }, [screen, entryReady]);

  const cancelEntry = useCallback((failed = false) => {
    entryLockRef.current = false;
    setEntryReady(false);
    setEntrySourceVisible(true);
    setArchive((current) => ({ ...current, phase: "default", id: null }));
    setResetKey((value) => value + 1);
    setEntryError(failed ? "标本读取失败，请再次选择生命体" : "");
    setScreenState("archive");
  }, []);

  useEffect(() => {
    if (screen !== "entering") return undefined;
    const onKey = (event) => { if (event.key === "Escape") cancelEntry(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, cancelEntry]);

  const setScreen = (next) => {
    const organism = organismFromView(next);
    if (organism) setSelectedId(organism.id);
    setScreenState(next);
    const params = new URLSearchParams(window.location.search);
    params.set("view", next);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    if (next === "archive") input.returnToIdle();
  };
  const onReadyChange = useCallback((ready) => setArchive((current) => ({ ...current, ready })), []);
  const onArchiveInteraction = useCallback((next) => {
    setArchive((current) => ({ ...current, ...next }));
    if (next.phase !== "clicked" || !organismById(next.id) || entryLockRef.current) return;
    entryLockRef.current = true;
    setSelectedId(next.id);
    archiveSession.current.entryCloud = archiveSession.current.entryClouds?.[next.id] ?? null;
    setEntryReady(false);
    setEntrySourceVisible(true);
    setEntryError("");
    setScreenState("entering");
  }, []);
  const finishEntry = () => {
    entryLockRef.current = false;
    setEntrySourceVisible(false);
    setScreen(selectedId.toLowerCase());
  };
  const resetArchive = () => {
    setResetKey((value) => value + 1);
    setArchive((current) => ({ ...current, phase: "default", id: null }));
  };
  const startArchiveReturn = () => {
    input.returnToIdle();
    setArchive({ phase: "default", id: null, ready: false });
    setArchiveTransitionMounted(false);
    setScreenState("returning");
  };
  const finishArchiveReturn = () => {
    setArchiveTransitionMounted(false);
    setScreen("archive");
  };

  if (terrainStudy) return <main className="project4-shell"><ArchiveFieldStage sessionRef={archiveSession} terrainOnly /></main>;

  return (
    <main className={`project4-shell screen-${screen}`}>
      {(organismFromView(screen) || screen === "entering" || screen === "returning") && (
        <ObservationScreen key={selectedId} organism={organismById(selectedId)} input={input} lang={lang} onLanguageChange={setLang} debug={debug} archiveAngle={archiveSession.current.angle} archiveSession={archiveSession} onExitStart={startArchiveReturn} onExitComplete={finishArchiveReturn} onExitCancel={() => setScreenState(selectedId.toLowerCase())} onArchiveReveal={() => setArchiveTransitionMounted(true)} archiveReady={archiveTransitionMounted && archive.ready} returning={screen === "returning"} entering={screen === "entering"} onEntryReady={() => setEntryReady(true)} onEntryComplete={finishEntry} onEntryError={() => cancelEntry(true)} />
      )}
      {(screen === "archive" || (screen === "entering" && entrySourceVisible) || (screen === "returning" && archiveTransitionMounted)) && (
        <ArchiveScreen
          archive={archive}
          sessionRef={archiveSession}
          onInteractionChange={onArchiveInteraction}
          resetKey={resetKey}
          onReadyChange={onReadyChange}
          lang={lang}
          onLanguageChange={setLang}
          transitioning={screen === "returning"}
          transitionReady={archive.ready}
          entering={screen === "entering"}
          entryReady={entryReady}
          entryError={entryError}
        />
      )}
      {debug && (screen === "archive" || organismFromView(screen)) && <DebugTools screen={screen} setScreen={setScreen} archive={archive} resetArchive={resetArchive} input={input} />}
    </main>
  );
}
