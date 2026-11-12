import os from 'node:os';

export const outputFps = (film, proxy = false) => proxy ? Math.min(15, film.fps) : film.fps;

/** Remotion 小样：原生帧率能被小样帧率整除时，按原生时间轴每 N 帧抽一帧；否则为 1（按输出帧率绘制）。 */
export function proxySampling(film, proxy, pipelineName) {
  const out = outputFps(film, proxy);
  return proxy && pipelineName === 'remotion' && out < film.fps && film.fps % out === 0 ? film.fps / out : 1;
}

/** 小样长边不超过960，不放大；偶数像素供H.264编码。 */
export function outputSize(film, proxy = false) {
  const [W, H] = film.size;
  const scale = proxy ? Math.min(1, 960 / Math.max(W, H)) : 1;
  return { W: Math.max(2, Math.round(W * scale / 2) * 2), H: Math.max(2, Math.round(H * scale / 2) * 2), fps: outputFps(film, proxy) };
}

export function renderWorkers(job, env = process.env) {
  if (env.WKA_WORKERS !== undefined) {
    const count = Number(env.WKA_WORKERS);
    if (!Number.isInteger(count) || count < 1) throw new Error('WKA_WORKERS 必须是正整数');
    return count;
  }
  return job.proxy || job.daily ? 1 : Math.min(2, os.cpus().length);
}
