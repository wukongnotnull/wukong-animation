// 渲染规模与代价估算：镜数、帧数、最长单镜，以及按上次实测速度外推的用时。
import path from 'node:path';
import { loadFilm } from './film-context.mjs';
import { buildFrameTimeline } from './timing.mjs';
import { outputSize } from './render-profile.mjs';
import { atomicJson, readJson } from './evidence.mjs';

const speedFile = filmDir => path.join(path.resolve(filmDir), '.cache/render-speed.json');
const round3 = value => Math.round(value * 1000) / 1000;

/** 记录一次真实渲染的速度（毫秒 / 百万像素·帧），供 estimateFilm 外推。 */
export function recordRenderSpeed(filmDir, { proxy, pipeline, width, height, frames, ms }) {
  if (!(frames > 0) || !(ms > 0)) return;
  const data = readJson(speedFile(filmDir)) || { version: 1, speeds: {} };
  data.speeds[proxy ? 'proxy' : 'full'] = { pipeline, msPerMegapixelFrame: ms / (frames * width * height / 1e6), frames, measuredAt: new Date().toISOString() };
  atomicJson(speedFile(filmDir), data);
}

export function estimateFilm(filmDir, { aspect = null, maxShot = null, pipeline = null } = {}) {
  const ctx = loadFilm(filmDir, { requireShots: false, aspect });
  const shots = ctx.film.shots;
  const engine = pipeline || ctx.pipeline.name;
  const saved = readJson(speedFile(filmDir))?.speeds || {};
  const plan = proxy => {
    const size = outputSize(ctx.film, proxy);
    const frames = buildFrameTimeline(shots, size.fps).totalFrames;
    return { ...size, frames };
  };
  const result = { title: ctx.film.title, pipeline: engine, shots: shots.length, seconds: round3(shots.reduce((sum, shot) => sum + shot.duration, 0)), proxy: plan(true), full: plan(false) };
  const longest = shots.reduce((best, shot) => (!best || shot.duration > best.duration ? shot : best), null);
  result.longest = longest ? { id: longest.id, duration: longest.duration } : null;
  result.over = maxShot ? shots.filter(shot => shot.duration > maxShot).map(shot => ({ id: shot.id, duration: shot.duration })) : [];
  result.maxShot = maxShot;
  const eta = mode => {
    const speed = saved[mode];
    const target = result[mode];
    return speed?.pipeline === engine ? target.frames * target.W * target.H / 1e6 * speed.msPerMegapixelFrame : null;
  };
  result.eta = { proxy: eta('proxy'), full: eta('full') };
  return result;
}

const duration = ms => ms < 90000 ? `${Math.max(1, Math.round(ms / 1000))} 秒` : `${Math.round(ms / 60000)} 分钟`;

export function formatEstimate(result) {
  const lines = [
    `《${result.title}》渲染规模：${result.shots} 镜 · 总长 ${result.seconds} 秒${result.longest ? ` · 最长单镜 ${result.longest.id} ${result.longest.duration} 秒` : ''}`,
    `  小样 ${result.proxy.W}×${result.proxy.H}@${result.proxy.fps}fps：${result.proxy.frames} 帧${result.eta.proxy ? `，全量渲染约 ${duration(result.eta.proxy)}` : ''}`,
    `  成片 ${result.full.W}×${result.full.H}@${result.full.fps}fps：${result.full.frames} 帧${result.eta.full ? `，全量渲染约 ${duration(result.eta.full)}` : ''}`,
  ];
  if (result.eta.proxy === null && result.eta.full === null) lines.push('  尚无渲染实测：先用 wka render <片目录> --proxy --only <一两个镜头> 渲一次，再运行本命令得到用时估计（复杂镜头会比示范慢，以实测为准）');
  else lines.push('  用时按上次同管线的实测速度外推，仅供参考；复杂镜头会更慢');
  if (result.maxShot) lines.push(result.over.length ? `  超过单镜上限 ${result.maxShot} 秒的镜头共 ${result.over.length} 个：${result.over.slice(0, 10).map(shot => `${shot.id}（${shot.duration} 秒）`).join('、')}${result.over.length > 10 ? ' 等' : ''}` : `  所有镜头都在单镜上限 ${result.maxShot} 秒内`);
  return lines.join('\n');
}
