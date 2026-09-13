import { useEffect, useRef, useState } from "react";

export function useImprintFlow(input) {
  const [state, setState] = useState("idle");
  const [countdown, setCountdown] = useState(3);
  const [hold, setHold] = useState(0);
  const [snapshot, setSnapshot] = useState(null);
  const runRef = useRef(0);
  const signalRef = useRef(input.signal);
  const holdRef = useRef(0);
  const lastRef = useRef(performance.now());
  const timersRef = useRef([]);
  const ready = input.mode === "demo" || (input.mode === "camera" && input.cameraPhase === "ready");

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);
  useEffect(() => { signalRef.current = input.signal; }, [input.signal]);

  const schedule = (callback, delay) => {
    const timer = setTimeout(callback, delay);
    timersRef.current.push(timer);
  };

  const prepare = () => {
    if (!ready || ["countdown", "holding", "capturing"].includes(state)) return;
    const run = runRef.current + 1;
    runRef.current = run;
    holdRef.current = 0;
    lastRef.current = performance.now();
    setHold(0);
    setCountdown(3);
    setState("countdown");
    schedule(() => { if (runRef.current === run) setCountdown(2); }, 1000);
    schedule(() => { if (runRef.current === run) setCountdown(1); }, 2000);
    schedule(() => {
      if (runRef.current !== run) return;
      setCountdown(0);
      setState("holding");
      lastRef.current = performance.now();
    }, 3000);
  };

  useEffect(() => {
    if (state !== "holding") return undefined;
    let raf = 0;
    const tick = (now) => {
      const dt = Math.min(120, now - lastRef.current);
      lastRef.current = now;
      const current = signalRef.current;
      const stable = current.motion < 0.065 && current.occlusion < 0.22;
      holdRef.current = stable ? Math.min(1.2, holdRef.current + dt / 1000) : 0;
      setHold(holdRef.current);
      if (holdRef.current >= 1.2) {
        setSnapshot({ ...current, directionVector: { ...current.directionVector }, capturedAt: Date.now() });
        setState("capturing");
        const run = runRef.current;
        schedule(() => { if (runRef.current === run) setState("complete"); }, 900);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state]);

  const label = state === "countdown"
    ? String(countdown)
    : state === "holding"
      ? "保持动作"
      : state === "capturing"
        ? "记录中"
        : state === "complete"
          ? "已记录"
          : "准备拓印";

  return { state, countdown, hold, snapshot, ready, label, prepare };
}
