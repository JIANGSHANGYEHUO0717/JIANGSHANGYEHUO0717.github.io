// One persistent controlling hand; a second hand cannot reverse its command.
export const HAND_TIMING = Object.freeze({ confirmMs: 180, lostMs: 1500, confidence: .62 });
export const createHandGestureState = () => ({
  hand: null, wrist: null, gesture: "unknown", candidate: "unknown",
  candidateSince: 0, lastSeen: null, confidence: 0, confirmed: false, command: "hold",
});
const lastGestureCommand = state => ["open", "fist"].includes(state.gesture) ? state.gesture : "hold";

export function updateHandGesture(old, result, now) {
  let state = { ...old };
  const hands = (result?.landmarks ?? []).map((points, index) => ({
    wrist: points[0], hand: result.handedness?.[index]?.[0]?.categoryName ?? String(index),
    category: result.gestures?.[index]?.[0],
    size: Math.hypot(points[9].x - points[0].x, points[9].y - points[0].y),
  })).filter(hand => Number.isFinite(hand.wrist?.x));
  let match = state.hand === null ? null : hands.filter(hand => hand.hand === state.hand)
    .sort((a, b) => Math.hypot(a.wrist.x - state.wrist.x, a.wrist.y - state.wrist.y)
      - Math.hypot(b.wrist.x - state.wrist.x, b.wrist.y - state.wrist.y))[0];
  if (match && Math.hypot(match.wrist.x - state.wrist.x, match.wrist.y - state.wrist.y) > .4) match = null;
  if (!match && state.hand !== null && now - state.lastSeen > HAND_TIMING.lostMs) {
    state = { ...state, hand: null, wrist: null, candidate: "unknown" };
  }
  if (state.hand === null) {
    match = hands.filter(hand => ["Open_Palm", "Closed_Fist"].includes(hand.category?.categoryName)
      && hand.category.score >= HAND_TIMING.confidence).sort((a, b) => b.size - a.size)[0];
  }
  if (!match) {
    return { ...state, candidate: "unknown", confidence: 0, confirmed: false,
      command: state.lastSeen !== null && now - state.lastSeen > HAND_TIMING.lostMs ? "lost" : lastGestureCommand(state) };
  }
  const category = match.category;
  const gesture = category?.score >= HAND_TIMING.confidence
    ? ({ Open_Palm: "open", Closed_Fist: "fist" }[category.categoryName] ?? "unknown") : "unknown";
  const candidateSince = gesture !== state.candidate ? now : state.candidateSince;
  const confirmed = gesture !== "unknown" && now - candidateSince >= HAND_TIMING.confirmMs;
  return { ...state, hand: match.hand, wrist: { x: match.wrist.x, y: match.wrist.y }, lastSeen: now,
    candidate: gesture, candidateSince, confidence: category?.score ?? 0, confirmed,
    // Recognition feedback may be pending; the response keeps the last
    // confirmed direction until a different gesture is confirmed.
    gesture: confirmed ? gesture : state.gesture, command: confirmed ? gesture : lastGestureCommand(state) };
}

export function handGestureLabel(state) {
  if (state.command === "lost") return "手部离开，缓慢回凝";
  if (!state.confirmed && state.command === "fist") return "识别中 · 延续握拳，保持／回凝";
  if (!state.confirmed && state.command === "open") return "识别中 · 延续张掌，持续展开";
  if (state.command === "open") return "张掌 · 持续展开";
  if (state.command === "fist") return "握拳 · 保持／回凝";
  if (state.hand !== null) return "手势确认中，等待首次确认";
  return "请将一只手掌朝向摄像头";
}
