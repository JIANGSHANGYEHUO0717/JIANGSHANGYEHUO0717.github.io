import { Vector2, Color, MathUtils } from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const ease = n => { const t = clamp(n); return t * t * (3 - 2 * t); };

// Wrist distance is normalized to shoulder width, independent of webcam mirroring.
// Invalid landmarks must not be interpreted as the viewer closing their arms.
export function readMirrorPose(points) {
  if (![11, 12, 15, 16].every(i => {
    const p = points?.[i];
    return p && Number.isFinite(p.x) && Number.isFinite(p.y)
      && Math.min(p.visibility ?? 1, p.presence ?? 1) >= .5
      && p.x > .015 && p.x < .985 && p.y > .015 && p.y < .985;
  })) return null;
  const width = Math.hypot(points[11].x - points[12].x, points[11].y - points[12].y);
  if (width < .055) return null;
  return ease((Math.abs(points[15].x - points[16].x) / width - .7) / 2.9);
}

export function createMirrorState() { return { amount: 0, target: 0, lost: 0, time: 0, demoTime: 0, modelWeight: 1, cameraWeight: 1, lightWeight: 1, sampleAngle: .18 }; }

// Move the source window around the body and aim it back through the body.
// The six display sectors stay fixed; anatomy is no longer tied to a radius.
export function mirrorFramingAt(time, aspect, out = {}) {
  const heading = time * .11;
  out.x = .5 - .13*Math.sin(heading)/Math.max(.4, aspect);
  out.y = .555 - .125*Math.cos(heading);
  // A folded sector spans 0..PI/6, so offset its middle ray by PI/12.
  out.angle = heading - Math.PI/12 + .075*Math.sin(time*.17);
  // The crown-to-root view needs a wider source window than the original crop.
  out.scale = .24*(.5-.5*Math.cos(heading));
  return out;
}

export function updateMirrorState(state, { dt, mode = "manual", amount = 0, points, active = true, closing = false, paused = false, reduced = false }) {
  const step = clamp(dt, 0, .05);
  if (closing || !active) state.target = 0;
  else if (mode === "camera") {
    const pose = readMirrorPose(points);
    if (pose === null) {
      state.lost += step;
      if (state.lost > 1.2) state.target = 0;
    } else { state.lost = 0; state.target = pose; }
  } else if (mode === "demo") {
    if (!paused) state.demoTime += step;
    const phase = state.demoTime % 22;
    state.target = ease((phase - 1) / 5) * (1 - ease((phase - 15) / 5));
  } else { state.lost = 0; state.target = clamp(amount); }
  const rate = closing ? 4.8 : state.lost > 1.2 ? 1.05 : 3.2;
  state.amount = MathUtils.damp(state.amount, state.target, rate, step);
  if (closing && state.amount < .002) state.amount = 0;
  if (active && !closing && !paused && !reduced) state.time += step;
  return state;
}

export function createMirrorPass() {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, uAmount: { value: 0 }, uAspect: { value: 1 },
      uPivot: { value: new Vector2(.5, .44) }, uScale: { value: .84 }, uAngle: { value: 0 },
    },
    vertexShader: "varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uAmount, uAspect, uScale, uAngle;
      uniform vec2 uPivot;
      varying vec2 vUv;
      const float PI = 3.14159265359;
      vec3 source(vec2 uv) {
        float inside = step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
        return texture2D(tDiffuse,clamp(uv,0.,1.)).rgb*inside;
      }
      void main() {
        vec2 p = (vUv-.5)*vec2(uAspect,1.)/min(uAspect,1.);
        float r = length(p);
        float theta = atan(p.y,p.x)-PI*.5;
        float sector = PI/3.;
        float folded = abs(mod(theta+sector*.5,sector)-sector*.5);
        float a = folded+uAngle;
        vec2 mirrored = uPivot+vec2(sin(a)/uAspect,cos(a))*r*uScale;
        float blend = smoothstep(.015,.97,uAmount);
        // Mix two bounded image samples, never jump the integer sector count.
        vec3 color = mix(source(vUv),source(mirrored),blend);
        gl_FragColor=vec4(color,1.);
      }
    `,
  });
}

export function createMirrorLighting(rig) {
  const frontTarget = rig.front.target, rimTarget = rig.rim.target;
  const warm = new Color(0xe6b78e), amberRim = new Color(0xffd09b);
  return (front, rim, low, amount, time) => {
    amount = MathUtils.clamp(amount, 0, 1);
    if (amount === 0) return;
    // Each frame starts from the selected observation rig. Retain the movement
    // rhythms as offsets around its positions, rather than restoring q5 colors.
    const drift = time * .18;
    const lightTime = time * .24, pulse = Math.sin(time * .46);
    front.position.x += amount * (Math.sin(lightTime)*.34 + Math.sin(drift)*1.5);
    front.position.y += amount * (Math.cos(lightTime*.83)*.2 + Math.sin(drift*.79)*.7);
    front.position.z += amount * Math.cos(lightTime)*.16;
    front.lookAt(frontTarget[0], frontTarget[1] + amount*.4, frontTarget[2]);
    rim.position.x += amount * (Math.sin(lightTime*.71+1.2)*.72 + Math.sin(drift*.69+.6)*1.6);
    rim.position.y += amount * Math.cos(lightTime*.58)*.18;
    rim.position.z += amount * (Math.cos(lightTime*.71+1.2)*.42 + Math.sin(drift*.83)*.9);
    rim.lookAt(rimTarget[0], rimTarget[1] + amount*.15, rimTarget[2]);
    low.position.x += amount * (Math.cos(lightTime*.62+2.1)*.25 + Math.sin(drift*.63)*.5);
    low.position.y += amount * Math.sin(lightTime*.76+.7)*.14;
    low.position.z += amount * Math.sin(lightTime*.62+2.1)*.22;
    front.color.lerp(warm, amount * (.2 + .6 * (.5 + .5 * Math.sin(drift * .62))));
    rim.color.lerp(amberRim, amount * (.3 + .4 * (.5 + .5 * Math.sin(drift * .77 + 1.4))));
    low.color.lerp(warm, amount * .32 * (.5 + .5 * Math.sin(drift * .59 + 2.1)));
    front.intensity *= (1 + amount*(.08/.75)*pulse) * (1 + amount*.26*Math.sin(drift*.91));
    rim.intensity *= (1 + amount*(.46/8.2)*pulse) * (1 + amount*.18*Math.sin(drift*.73+.5));
    low.intensity *= (1 + amount*(.06/.72)*pulse) * (1 + amount*.22*Math.sin(drift*.81+1.5));
  };
}
