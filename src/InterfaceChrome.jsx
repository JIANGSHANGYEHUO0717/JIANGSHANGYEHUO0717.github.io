import React from "react";
import { CameraPreview, cameraBodyDetected } from "./CameraPreview.jsx";

const COPY = {
  en: {
    subtitle: "A LIVING RECORD OF A CHANGING PLANET",
    observe: "CLICK TO OBSERVE",
    return: "RETURN TO ARCHIVE",
    enable: "ENABLE BODY INPUT",
    disable: "DISABLE BODY INPUT",
    detected: "BODY DETECTED",
    notDetected: "BODY NOT DETECTED",
    stepIn: "STEP INTO VIEW TO CONTINUE",
    preparing: "PREPARING BODY INPUT",
    unavailable: "BODY INPUT UNAVAILABLE",
  },
  ch: {
    subtitle: "A LIVING RECORD OF A CHANGING PLANET",
    observe: "点击进入观测",
    return: "返回生态档案",
    enable: "启用身体输入",
    disable: "关闭身体输入",
    detected: "已识别身体",
    notDetected: "未识别身体",
    stepIn: "请进入画面以继续",
    preparing: "正在准备身体输入",
    unavailable: "身体输入不可用",
  },
};

export const ORGANISM_INTERFACE_COPY = Object.freeze({
  C01: {
    en: { title: ["MIRROR", "RESONANCE"], description: ["A REFLECTIVE ORGANISM WHOSE", "SYMMETRY EXPANDS WITH THE BODY", "AND RELEASES ECHOES FROM WITHIN."] },
    ch: { title: ["镜像", "共振"], description: ["一种随身体展开对称结构，", "并从内部释放回声的反射性生命体。"] },
  },
  C02: {
    en: { title: ["MULTIDIRECTIONAL", "CONNECTION"], description: ["A MEMBRANOUS ORGANISM", "REDIRECTING SIGNALS ACROSS A", "LIVING NETWORK OF BRANCHES", "AND NODES."] },
    ch: { title: ["多向", "连接"], description: ["一种在活体枝干与节点网络之间", "重新引导信号的膜状生命体。"] },
  },
  C03: {
    en: { title: ["DORMANT", "TRIGGER"], description: ["A GLASS-LIKE ORGANISM STORING", "ENERGY IN DORMANT CORES BEFORE", "DISPERSAL AND REFRACTIVE", "RELEASE."] },
    ch: { title: ["休眠", "触发"], description: ["一种在休眠核心中储存能量，", "并通过播散与折光完成释放。"] },
  },
  C04: {
    en: { title: ["FLUID", "RECONFIGURATION"], description: ["A FLUID ORGANISM EXHIBITING", "ADAPTIVE RECONFIGURATION IN", "RESPONSE TO ENVIRONMENTAL", "VARIATION."] },
    ch: { title: ["流体", "重构"], description: ["一种会回应环境变化，", "并持续进行适应性重构的流体生命体。"] },
  },
  C05: {
    en: { title: ["COMPOSITE", "HETEROGENEITY"], description: ["A COMPOSITE ORGANISM WHOSE", "HIDDEN TISSUES EMERGE THROUGH", "LAYERS OF LIVING MATERIAL."] },
    ch: { title: ["复合", "异质性"], description: ["一种由多层活体材料构成，", "并在观测中显露隐藏组织。"] },
  },
});

export function InterfaceHeader({ lang, onLanguageChange, compact = false }) {
  const copy=COPY[lang];
  return <header className={`interface-header${compact?" is-compact":""}`}>
    <div className="archive-wordmark" aria-label={lang==="en"?"Ecological Archive":"生态档案"}>
      <div><strong>ECOLOGICAL</strong><span>ARCHIVE</span></div>
      <small>{copy.subtitle}</small>
    </div>
    <nav className="language-switch" aria-label="Language">
      <button type="button" aria-pressed={lang==="en"} onClick={()=>onLanguageChange("en")}>EN</button>
      <span aria-hidden="true">/</span>
      <button type="button" aria-pressed={lang==="ch"} onClick={()=>onLanguageChange("ch")}>CH</button>
    </nav>
  </header>;
}

export function ArchiveInterface({ archive, lang, onLanguageChange }) {
  const copy=COPY[lang],organism=archive.id?ORGANISM_INTERFACE_COPY[archive.id]?.[lang]:null;
  const pointer=archive.pointer??{x:.72,y:.58};
  const hintVisible=Boolean(organism)&&archive.phase==="locked";
  return <div className="interface-layer archive-interface">
    <InterfaceHeader lang={lang} onLanguageChange={onLanguageChange} />
    <div className={`archive-organism-hint${hintVisible?" is-visible":""}${pointer.x>.76?" align-left":""}`}
      style={{"--hint-x":`${Math.max(.08,Math.min(.92,pointer.x))*100}vw`,"--hint-y":`${Math.max(.14,Math.min(.84,pointer.y))*100}vh`}} aria-hidden={!hintVisible}>
      <span className="archive-hint-mark" aria-hidden="true"><i /></span>
      <span className="archive-hint-copy"><strong>{organism?.title.join(" ")}</strong><small>{copy.observe}</small></span>
    </div>
  </div>;
}

export function ObservationInterface({ organism, input, lang, onLanguageChange, onReturn, disabled = false }) {
  const [bodyInputEnabled,setBodyInputEnabled]=React.useState(false);
  const [bodyInputMounted,setBodyInputMounted]=React.useState(false);
  const [bodyInputExitStatus,setBodyInputExitStatus]=React.useState(null);
  const bodyInputExitTimer=React.useRef(null);
  const copy=COPY[lang],species=ORGANISM_INTERFACE_COPY[organism.id]?.[lang];
  const detected=cameraBodyDetected(input);
  const busy=["requesting","loading"].includes(input.cameraPhase);
  React.useEffect(()=>()=>clearTimeout(bodyInputExitTimer.current),[]);
  const enable=()=>{
    clearTimeout(bodyInputExitTimer.current);
    setBodyInputExitStatus(null);
    setBodyInputMounted(true);
    setBodyInputEnabled(true);
    input.startCamera();
  };
  const disable=()=>{
    clearTimeout(bodyInputExitTimer.current);
    setBodyInputExitStatus(status);
    input.returnToIdle();
    setBodyInputEnabled(false);
    bodyInputExitTimer.current=setTimeout(()=>{
      setBodyInputMounted(false);
      setBodyInputExitStatus(null);
    },320);
  };
  let status=copy.preparing;
  if(input.cameraPhase==="error")status=copy.unavailable;
  else if(input.cameraPhase==="ready"&&detected)status=copy.detected;
  else if(input.cameraPhase==="ready")status=copy.notDetected;
  return <div className="interface-layer observation-interface">
    <InterfaceHeader lang={lang} onLanguageChange={onLanguageChange} compact />
    <section className="organism-description" aria-label={species?.title.join(" ")}>
      <h1>{species?.title.map(line=><span key={line}>{line}</span>)}</h1>
      <i aria-hidden="true" />
      <p aria-label={species?.description.join(" ")}>{species?.description.map(line=><span className="description-line" key={line}>{line}</span>)}</p>
      <button type="button" className="return-to-archive" onClick={onReturn} disabled={disabled}>
        <span className="return-arrow" aria-hidden="true" />{copy.return}
      </button>
    </section>
    <aside className={`body-input-module${bodyInputEnabled?" is-enabled":bodyInputMounted?" is-exiting":" is-disabled"}`} aria-label={bodyInputEnabled?copy.disable:copy.enable}>
      {bodyInputMounted&&<div className="body-input-content" aria-hidden={!bodyInputEnabled}>
        <CameraPreview input={input} lang={lang} />
        <div className="body-input-status" aria-live={bodyInputEnabled?"polite":"off"}><strong>{bodyInputEnabled?status:bodyInputExitStatus??status}</strong></div>
      </div>}
      <button type="button" className="body-input-toggle" onClick={bodyInputEnabled?disable:enable} disabled={disabled||busy}>
        <span>{bodyInputEnabled?copy.disable:copy.enable}</span>
      </button>
    </aside>
  </div>;
}
