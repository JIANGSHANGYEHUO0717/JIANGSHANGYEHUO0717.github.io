// Names follow the project's final-output specification. The four new
// observation entries do not inherit C04's gesture/escape implementation.
export const ORGANISM_CATALOG = Object.freeze([
  { id: "C01", category: "类别一", name: "镜像共振", mechanism: "万花筒镜像与腔体回声" },
  { id: "C02", category: "类别二", name: "多向连接", mechanism: "信号分流与局部改道" },
  { id: "C03", category: "类别三", name: "休眠触发", mechanism: "静止蓄能与集中释放" },
  { id: "C04", category: "类别四", name: "流体重构", mechanism: "局部逃逸与分批回凝" },
  { id: "C05", category: "类别五", name: "复合异质性", mechanism: "层级异步显现与稳定共存" },
]);

export const organismById = id => ORGANISM_CATALOG.find(item => item.id === id);
export const organismFromView = view => organismById(String(view ?? "").toUpperCase());
