// __NAME__ 管线。所有管线实现同样的三个函数，引擎通过 registry 自动发现。
//
// job 字段：W, H, fps, seed, proxy, style, kits, shots, styleScripts, filmScripts,
//           fonts {css, stacks}, timeline, workDir, runtimeDir, log(msg)
// todo[i]：{ shot: {id, file, path, duration, start, frames, nativeFrames, startFrame}, hash, out }  —— 把该镜头渲染成 H.264 写到 out

/** 检查依赖。返回 { ok, missing: string[], hint } */
export async function check() {
  return { ok: true, missing: [], hint: '' };
}

/** 渲染若干镜头；每完成一个调用 onDone(item) 以写入缓存。 */
export async function renderShots(job, todo, { onDone } = {}) {
  for (const item of todo) {
    // TODO: 按 item.shot.frames / job.fps 渲染 item.shot → item.out；禁止逐镜独立舍入时长
    onDone?.(item);
  }
}

/** 渲染静帧。points: [{shot, t}]；返回 PNG 文件路径数组。 */
export async function renderStills(job, points, outDir) {
  return [];
}
