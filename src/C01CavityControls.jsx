export function C01CavityControls({value,onChange,input,disabled}) {
  const camera=input.mode === "camera", demo=!camera && value.mode === "demo";
  const sound=Boolean(value.sound);
  const setCharge=charge=>{
    if(input.mode!=="idle") input.returnToIdle();
    onChange({...value,mode:"manual",charge,paused:false});
  };
  const setSound=enabled=>{
    window.dispatchEvent(new CustomEvent("c01-cavity-audio-toggle",{detail:{enabled}}));
    onChange({...value,sound:enabled});
  };
  return <fieldset className="mirror-controls cavity-controls" disabled={disabled} aria-label="共振腔体与水波回声控制">
    <legend>共振腔体＋水波回声 <span>{camera ? "双手捏合" : demo ? "自动试映" : "手动蓄能"}</span></legend>
    <p className="echo-timing">{camera ? input.dualPinch?.detail : "随机内部光源 · 大范围水波触边后折返"}</p>
    <label className="mirror-range">静
      <input type="range" min="0" max="100" step="1" value={Math.round(value.charge*100)} aria-label="共振腔体蓄能"
        onInput={event=>setCharge(Number(event.currentTarget.value)/100)} onChange={event=>setCharge(Number(event.target.value)/100)} />满
    </label>
    <div className="mirror-actions">
      <button type="button" aria-pressed={demo} onClick={()=>{
        input.returnToIdle();onChange({...value,mode:demo ? "manual" : "demo",charge:0,paused:false});
      }}>{demo ? "结束试映" : "自动试映"}</button>
      <button type="button" onClick={()=>{
        input.returnToIdle();onChange({...value,mode:"manual",charge:0,paused:false,pulse:value.pulse+1});
      }}>释放回声</button>
      <button type="button" aria-pressed={value.paused} onClick={()=>onChange({...value,paused:!value.paused})}>{value.paused ? "继续" : "暂停"}</button>
    </div>
    <button type="button" className="cavity-sound-toggle" aria-pressed={sound} onClick={()=>setSound(!sound)}>
      {sound ? "声音：已开启" : "启用声音"}
    </button>
    <p className="echo-hint">手动试映可拖动蓄能再释放。声音随蓄能、内部光源与波纹扩散连续变化；视觉触边不另发声。<br/>摄像头：双手食指与拇指捏合并靠近，保持捏合向外拉开，同时松开释放；未识别完整过程时只有空间纹理。</p>
  </fieldset>;
}
