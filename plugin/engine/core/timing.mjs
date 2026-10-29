// 累计切点量化：每镜帧数取相邻切点之差，禁止独立舍入后再求和。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
export const TIMING_VERSION = 1;

export function buildFrameTimeline(shots, fps) {
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) throw new Error(`帧率必须是 1–120 的整数：${fps}`);
  let time = 0, boundary = 0;
  const timeline = shots.map((s) => {
    const start = time;
    time += s.duration;
    const end = Math.round(time * fps);
    const frames = end - boundary;
    if (frames <= 0) throw new Error(`镜头 ${s.id} 时长 ${s.duration}s 在 ${fps}fps 下不足一帧；请调整镜长或使用足够高的帧率`);
    const shot = { id: s.id, plannedStart: start, plannedDuration: s.duration, startFrame: boundary, endFrame: end, frames };
    boundary = end;
    return shot;
  });
  return { version: TIMING_VERSION, fps, totalFrames: boundary, duration: boundary / fps, shots: timeline };
}

const ratio = (s) => {
  const [n, d = 1] = String(s).split('/').map(Number);
  return n / d;
};

/** 解码帧时间，不依赖含音频填充的容器时长。 */
export function inspectVideo(file, { fps, frames }) {
  const errors = [];
  const result = { file, ok: false, frames: null, fps: null, errors };
  try {
    const p = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_streams', '-show_entries',
      'stream=r_frame_rate,avg_frame_rate,time_base,duration:frame=best_effort_timestamp_time', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (p.status !== 0 || p.error || p.stderr.trim()) throw new Error(p.error?.message || p.stderr || 'ffprobe 失败');
    const data = JSON.parse(p.stdout), stream = data.streams?.[0];
    if (!stream || !data.frames?.length) throw new Error('读不到视频轨或完整帧数');
    result.frames = data.frames.length;
    result.fps = ratio(stream.r_frame_rate);
    result.duration = Number(stream.duration);
    const tick = ratio(stream.time_base);
    if (!Number.isFinite(tick) || tick <= 0) throw new Error('无效媒体 time_base');
    const tolerance = tick + 1e-6;
    if (result.frames !== frames) errors.push(`实测 ${result.frames} 帧，期望 ${frames} 帧`);
    if (!Number.isFinite(result.fps) || !Number.isFinite(ratio(stream.avg_frame_rate)) || Math.abs(result.fps - fps) > 1e-6 || Math.abs(ratio(stream.avg_frame_rate) - fps) > 1e-6) errors.push(`实测帧率 ${stream.r_frame_rate}/${stream.avg_frame_rate}，期望 ${fps}fps`);
    const bad = data.frames.findIndex((f, i) => !Number.isFinite(Number(f.best_effort_timestamp_time)) || Math.abs(Number(f.best_effort_timestamp_time) - i / fps) > tolerance);
    if (bad >= 0) errors.push(`第 ${bad} 帧时间戳不连续：${data.frames[bad].best_effort_timestamp_time}，期望 ${(bad / fps).toFixed(6)}s（容差 ${tick}s）`);
    if (!Number.isFinite(result.duration) || Math.abs(result.duration - frames / fps) > tolerance) errors.push(`视频轨时长 ${stream.duration}s，期望 ${frames / fps}s`);
  } catch (e) { errors.push(`无法验证 ${path.basename(file)}：${e.message}`); }
  result.ok = errors.length === 0;
  return result;
}

export function assertVideo(file, expected) {
  const result = inspectVideo(file, expected);
  if (!result.ok) throw new Error(`时间轴检查失败 ${path.basename(file)}：${result.errors.join('；')}`);
  return result;
}

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fileSha = (file) => sha(fs.readFileSync(file));
const fpsOf = (ctx, proxy) => proxy ? Math.max(1, Math.round(ctx.film.fps / 2)) : ctx.film.fps;
const manifestFile = (ctx, proxy) => path.join(ctx.variant.cacheDir, proxy ? 'timing-proxy.json' : 'timing.json');
const signature = (ctx, timeline, proxy) => sha(JSON.stringify({ version: TIMING_VERSION, fps: timeline.fps, aspect: ctx.variant.aspect, proxy, shots: ctx.film.shots.map(s => [s.id, s.duration]) }));
const reportBase = (ctx, proxy, purpose = '') => `时间轴检查${purpose ? '-' + purpose : ''}${ctx.variant.suffix ? '-' + ctx.variant.suffix : ''}${proxy ? '-proxy' : ''}`;

function atomicJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
}

function writeReport(ctx, report, { proxy = false, purpose = '', log = () => {} } = {}) {
  report.ok = report.errors.length === 0;
  const base = path.join(ctx.filmDir, 'review', reportBase(ctx, proxy, purpose));
  atomicJson(base + '.json', report);
  const rows = (report.shots || []).map(s => `| ${s.id} | ${s.plannedStart.toFixed(6)} | ${s.startFrame}–${s.endFrame} | ${s.actualStartFrame ?? '—'}–${s.actualEndFrame ?? '—'} | ${s.actualEndFrame == null ? '—' : s.actualEndFrame - s.endFrame} |`);
  fs.writeFileSync(base + '.md', [
    `# 视频时间轴检查 · ${report.aspect} · ${report.purpose}`, '',
    report.ok ? '✓ 视频时间轴检查通过（不代表旁白语义或词级同步通过）' : '✗ 视频时间轴未通过/未验证', '',
    `输出 ${report.fps}fps；期望 ${report.totalFrames} 帧；实测 ${report.video?.frames ?? '未读取'} 帧。`, '',
    '| 镜头 | 原计划起点(s) | 期望帧区间 | 实测帧区间 | 切点偏差(帧) |', '| --- | --- | --- | --- | --- |', ...rows, '',
    ...report.errors.map(e => `- ${e}`),
    ...(report.outputs || []).map(o => `- ${o.ok ? '✓' : '✗'} 输出 ${o.file}：${o.frames ?? '未知'} 帧${o.errors.length ? '；' + o.errors.join('；') : ''}`), '',
  ].join('\n'));
  log(`  ${report.ok ? '✓ 视频时间轴检查通过' : '! 视频时间轴检查失败'}：${base}.md`);
  return report;
}

export function timingFailure(ctx, error, { proxy = false, log = () => {} } = {}) {
  fs.rmSync(manifestFile(ctx, proxy), { force: true });
  const timeline = buildFrameTimeline(ctx.shots, fpsOf(ctx, proxy));
  return writeReport(ctx, { ...timeline, aspect: ctx.variant.aspect, purpose: proxy ? '小样' : '高清', errors: [error.message], outputs: [] }, { proxy, log });
}

/** 每段实测后累加，正负偏差互相抵消也不能绕过检查。 */
function measure(ctx, timeline, segments, video) {
  const errors = [];
  let actual = 0;
  const shots = timeline.shots.map((s, i) => {
    const result = inspectVideo(segments[i], { fps: timeline.fps, frames: s.frames });
    const row = { ...s, file: segments[i], actualStartFrame: actual, actualEndFrame: actual + (result.frames || 0) };
    actual = row.actualEndFrame;
    errors.push(...result.errors.map(e => `${s.id}：${e}`));
    if (actual !== s.endFrame) errors.push(`${s.id} 切点实测 ${actual} 帧，期望 ${s.endFrame} 帧`);
    return row;
  });
  const result = inspectVideo(video, { fps: timeline.fps, frames: timeline.totalFrames });
  errors.push(...result.errors.map(e => `拼接视频：${e}`));
  return { ...timeline, aspect: ctx.variant.aspect, shots, video: result, errors, outputs: [] };
}

/** 只有媒体验证成功才建立来源记录。 */
export function recordTiming(ctx, video, segments, { proxy = false, log = () => {} } = {}) {
  const timeline = buildFrameTimeline(ctx.shots, fpsOf(ctx, proxy));
  const report = measure(ctx, timeline, segments, video);
  report.purpose = proxy ? '小样' : '高清';
  report.signature = signature(ctx, timeline, proxy);
  if (!report.errors.length) {
    const sources = segments.map(file => ({ file: path.relative(ctx.filmDir, file), sha256: fileSha(file) }));
    atomicJson(manifestFile(ctx, proxy), { signature: report.signature, timeline, sources, video: { file: path.relative(ctx.filmDir, video), sha256: fileSha(video) } });
  }
  if (report.errors.length) fs.rmSync(manifestFile(ctx, proxy), { force: true });
  writeReport(ctx, report, { proxy, log });
  if (!report.ok) throw new Error('视频时间轴检查失败：' + report.errors.join('；') + '；请重渲相关镜头');
  return report;
}

/** QC/预览入口：来源签名匹配之后仍重新探测，绝不把旧报告当通过证据。 */
export function checkTiming(ctx, { proxy = false, log = () => {} } = {}) {
  let report = { fps: fpsOf(ctx, proxy), totalFrames: null, shots: [], aspect: ctx.variant.aspect, purpose: proxy ? '小样' : '高清', errors: [], outputs: [] };
  try {
    const timeline = buildFrameTimeline(ctx.shots, report.fps);
    report = { ...report, ...timeline };
    const file = manifestFile(ctx, proxy);
    if (!fs.existsSync(file)) throw new Error('缺少时间轴来源记录，需重新运行 wka render' + (proxy ? ' --proxy' : ''));
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const sig = signature(ctx, timeline, proxy);
    if (m.signature !== sig) throw new Error('时间轴来源记录已过期，需重新渲染');
    if (m.sources.length !== timeline.shots.length) throw new Error('片段来源数量不符');
    const segments = m.sources.map(s => {
      const file = path.resolve(ctx.filmDir, s.file);
      if (fileSha(file) !== s.sha256) throw new Error(`片段 ${s.file} 已变化，需重渲相关镜头`);
      return file;
    });
    const video = path.resolve(ctx.filmDir, m.video.file);
    if (fileSha(video) !== m.video.sha256) throw new Error('拼接视频已变化，需重新渲染/拼接');
    const previous = path.join(ctx.filmDir, 'review', reportBase(ctx, proxy) + '.json');
    const old = fs.existsSync(previous) ? JSON.parse(fs.readFileSync(previous, 'utf8')) : null;
    report = { ...measure(ctx, timeline, segments, video), purpose: report.purpose, signature: sig, outputs: old?.signature === sig ? (old.outputs || []).map(o => inspectVideo(o.file, { fps: timeline.fps, frames: timeline.totalFrames })) : [] };
  } catch (e) { report.errors.push(e.message); }
  report.errors.push(...report.outputs.filter(o => !o.ok).flatMap(o => o.errors.map(e => `输出 ${o.file}：${e}`)));
  return writeReport(ctx, report, { proxy, log });
}

export function requireTiming(ctx, options) {
  const report = checkTiming(ctx, options);
  if (!report.ok) throw new Error(`视频时间轴未验证：${report.errors.join('；')}`);
  return report;
}

export function checkOutputTiming(ctx, file, { proxy = false, log = () => {} } = {}) {
  const report = requireTiming(ctx, { proxy });
  const result = inspectVideo(file, { fps: report.fps, frames: report.totalFrames });
  report.outputs = [...report.outputs.filter(o => o.file !== file), result];
  report.errors.push(...result.errors.map(e => `输出 ${file}：${e}；请检查声轨是否过短`));
  writeReport(ctx, report, { proxy, log });
  if (!result.ok) throw new Error(`输出时间轴检查失败：${result.errors.join('；')}；请检查声轨是否过短`);
  return result;
}

export function checkAnimaticTiming(ctx, file, timeline, log) {
  const video = inspectVideo(file, { fps: timeline.fps, frames: timeline.totalFrames });
  const report = writeReport(ctx, { ...timeline, aspect: ctx.variant.aspect, purpose: '动态分镜', video, errors: video.errors, outputs: [] }, { purpose: 'animatic', log });
  if (!report.ok) throw new Error('动态分镜时间轴检查失败');
}
