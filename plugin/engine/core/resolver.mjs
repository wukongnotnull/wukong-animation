// 解析 style.json：校验引擎版本 → 选出管线 → 展开工具包依赖并拓扑排序。
import { ENGINE_VERSION } from './paths.mjs';
import { satisfies } from './semver.mjs';

export function resolveStyle(style, registry) {
  const errors = [];

  if (!satisfies(ENGINE_VERSION, style.engine)) {
    errors.push(`风格 ${style.id} 需要引擎 ${style.engine}，当前是 ${ENGINE_VERSION}`);
  }

  const pipeline = registry.pipelines.get(style.pipeline);
  if (!pipeline) errors.push(`风格 ${style.id} 需要管线 "${style.pipeline}"，但它没有注册`);
  else if (pipeline.status === 'planned') errors.push(`管线 "${style.pipeline}" 还在规划中（status: planned），暂不可用`);

  // 深度优先展开 kit 依赖，得到"依赖在前"的注入顺序
  const ordered = [];
  const state = new Map(); // name -> 'visiting' | 'done'
  const visit = (name, range, from) => {
    const kit = registry.kits.get(name);
    if (!kit) {
      errors.push(`${from} 需要工具包 "${name}"，但它没有注册`);
      return;
    }
    if (kit.status === 'planned') {
      errors.push(`工具包 "${name}" 还在规划中（status: planned），暂不可用`);
      return;
    }
    if (range && !satisfies(kit.version, range)) {
      errors.push(`${from} 需要 ${name}@${range}，已注册的是 ${kit.version}`);
    }
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') {
      errors.push(`工具包依赖出现循环：${from} → ${name}`);
      return;
    }
    state.set(name, 'visiting');
    for (const [dep, depRange] of Object.entries(kit.kits || {})) visit(dep, depRange, `kit ${name}`);
    state.set(name, 'done');
    ordered.push(kit);
  };
  for (const [name, range] of Object.entries(style.kits || {})) visit(name, range, `风格 ${style.id}`);

  return { pipeline, kits: ordered, errors };
}
