export function C01MirrorControls({ value, onChange, input, disabled }) {
  const camera = input.mode === "camera";
  const manual = amount => {
    if (input.mode !== "idle") input.returnToIdle();
    onChange({ ...value, mode: "manual", amount });
  };
  return <fieldset className="mirror-controls" disabled={disabled} aria-label="镜像试映控制">
    <legend>镜像展开 <span>{camera ? "身体驱动" : value.mode === "demo" ? "自动试映" : "手动试映"}</span></legend>
    <label className="mirror-range">收拢
      <input type="range" min="0" max="100" step="1" value={Math.round(value.amount*100)}
        aria-label="镜像展开程度" onInput={event => manual(Number(event.currentTarget.value)/100)} onChange={event => manual(Number(event.target.value)/100)} />
      展开
    </label>
    <div className="mirror-actions">
      <button type="button" aria-pressed={!camera && value.mode === "demo"} onClick={() => {
        input.returnToIdle(); onChange({ ...value, mode: value.mode === "demo" ? "manual" : "demo", paused: false });
      }}>{!camera && value.mode === "demo" ? "结束试映" : "自动试映"}</button>
      <button type="button" aria-pressed={value.paused} onClick={() => onChange({ ...value, paused: !value.paused })}>{value.paused ? "继续动效" : "暂停动效"}</button>
      <button type="button" onClick={() => manual(1)}>展开</button>
      <button type="button" onClick={() => manual(0)}>收拢</button>
    </div>
    <details><summary>动效图层</summary>
      <div className="mirror-layers">{[["modelMotion", "模型运动"], ["cameraMotion", "取景变化"], ["lightMotion", "灯光变化"]].map(([key, label]) =>
        <label key={key}><input type="checkbox" checked={value[key]} onChange={event => onChange({ ...value, [key]: event.target.checked })} />{label}</label>
      )}</div>
    </details>
  </fieldset>;
}
