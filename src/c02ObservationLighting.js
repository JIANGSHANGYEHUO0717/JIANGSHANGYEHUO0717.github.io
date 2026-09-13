import { Color, MathUtils, Vector3 } from "three";

const area = (color, intensity, position, width, height, target = [0, .2, 0]) => ({
  color, intensity, position, width, height, target,
});

export const C02_LIGHTING_RIGS = Object.freeze({
  membrane: {
    label: "薄膜逆光",
    background: "black",
    nodeGlow: .065,
    ambient: { color: 0xe8eef0, intensity: .018 },
    key: area(0xf8fbff, 5.15, [-3.45, 3.25, 4.65], 5.4, 5.8, [0, .28, 0]),
    front: area(0xfff1e4, 1.24, [3.65, .35, 4.3], 4.3, 5.0, [0, -.10, 0]),
    rim: area(0xdff5ff, 7.4, [2.65, 3.85, -4.15], 3.4, 5.6, [.28, .48, 0]),
    side: { color: 0xffc7b2, intensity: .38, position: [-4.65, 1.45, -2.9] },
    low: { color: 0xffa278, intensity: .26, position: [-1.05, -2.3, 2.0] },
  },
});

function hydrateRig(rig) {
  return Object.fromEntries(Object.entries(rig).map(([key, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [key, value];
    return [key, {
      ...value,
      color: value.color === undefined ? undefined : new Color(value.color),
      position: value.position ? new Vector3(...value.position) : null,
      target: value.target ? new Vector3(...value.target) : null,
    }];
  }));
}

export function createC02ObservationLighting(lights) {
  const rigs = Object.fromEntries(Object.entries(C02_LIGHTING_RIGS).map(([id, rig]) => [id, hydrateRig(rig)]));
  const weights = Object.fromEntries(Object.keys(rigs).map(id => [id, id === "membrane" ? 1 : 0]));
  const original = Object.fromEntries(Object.entries(lights).map(([key, light]) => [key, {
    color: light.color.clone(), intensity: light.intensity, position: light.position.clone(),
    width: light.width, height: light.height, quaternion: light.quaternion.clone(),
  }]));
  const color = new Color();
  const position = new Vector3();
  const target = new Vector3();

  return {
    update(id, strength, dt, time) {
      const selected = rigs[id] ? id : "membrane";
      for (const key of Object.keys(weights)) {
        weights[key] = MathUtils.damp(weights[key], key === selected ? 1 : 0, 4.2, dt);
      }
      const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
      let nodeGlow = 0;

      for (const [lightKey, light] of Object.entries(lights)) {
        const base = original[lightKey];
        const baseWeight = 1 - strength;
        color.copy(base.color).multiplyScalar(baseWeight);
        position.copy(base.position).multiplyScalar(baseWeight);
        let intensity = base.intensity * baseWeight;
        let width = (base.width ?? 0) * baseWeight;
        let height = (base.height ?? 0) * baseWeight;
        target.set(0, lightKey === "front" ? -.2 : lightKey === "rim" ? .35 : .15).multiplyScalar(baseWeight);

        for (const [rigId, rig] of Object.entries(rigs)) {
          const w = weights[rigId] / total * strength;
          const preset = rig[lightKey];
          if (!preset || !w) continue;
          color.r += preset.color.r * w;
          color.g += preset.color.g * w;
          color.b += preset.color.b * w;
          position.addScaledVector(preset.position ?? base.position, w);
          intensity += preset.intensity * w;
          width += (preset.width ?? 0) * w;
          height += (preset.height ?? 0) * w;
          if (preset.target) target.addScaledVector(preset.target, w);
        }

        light.color.copy(color);
        light.position.copy(position);
        light.intensity = intensity;
        if (light.isRectAreaLight) {
          light.width = width;
          light.height = height;
          light.lookAt(target);
        }
      }

      for (const [rigId, rig] of Object.entries(rigs)) nodeGlow += rig.nodeGlow * weights[rigId] / total;
      return { label: rigs[selected].label, nodeGlow };
    },
  };
}
