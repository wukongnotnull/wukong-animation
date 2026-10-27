// 量化技术质检（QC）：逐帧量出留白、点缀色面积、相邻帧差异、空帧，对照 style.json 的 qc 阈值。
// 导演只需目视复核超标的帧（会拼成一张 qc-sheet.jpg）。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadFilm } from './job.mjs';
import { run, drawLabel } from './ffmpeg.mjs';
import { ensureDir } from './paths.mjs';
import { labelPngs } from './labels.mjs';
import { checkShotSizes, describeShotSizes } from './shot-sizes.mjs';

const QC_DEFAULTS = { whitespace_min: 0, paper_tol: 20, accent_tol: 60, accent_max: 1, diff_max: 30, cuts_max: 99, skip_start: 0.5 };

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function decode(video, w, h, fps, onFrame) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', video, '-vf', `fps=${fps},scale=${w}:${h}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const size = w * h * 3;
    let buf = Buffer.alloc(0);
    let i = 0;
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= size) {
        onFrame(buf.subarray(0, size), i++);
        buf = buf.subarray(size);
      }
    });
    p.on('close', (c) => (c === 0 ? resolve(i) : reject(new Error('ffmpeg 解码失败: ' + err.slice(-400)))));
  });
}

/**
 * @returns {Promise<{ok:boolean, shots:object[], issues:object[], contactSheet:string|null, report:string}>}
 */
/** 景别检查只报告，不算进 QC 通过与否（签批第 5 道时才拦）。 */
function shotSizeLine(shots) {
  const problems = checkShotSizes(shots);
  return problems.length ? `  景别 ✗ ${problems.join('；')}` : `  景别 ${describeShotSizes(shots)}，相邻都不同 ✓`;
}

export async function runQc(filmDir, { proxy = false, fps = 10, log = console.log } = {}) {
  const ctx = loadFilm(filmDir);
  const cfg = { ...QC_DEFAULTS, ...(ctx.style.qc || {}) };
  const video = path.join(ctx.filmDir, '.cache', proxy ? 'video-proxy.mp4' : 'video.mp4');
  if (!fs.existsSync(video)) throw new Error(`还没有渲染结果：${path.relative(ctx.filmDir, video)}。先运行 wka render${proxy ? ' --proxy' : ''}`);

  const [W0, H0] = ctx.film.size;
  const w = 240, h = Math.round((240 * H0) / W0 / 2) * 2;
  const paper = cfg.paper ? hex(cfg.paper) : null;
  const accent = cfg.accent ? hex(cfg.accent) : null;
  const boundaries = ctx.shots.slice(1).map((s) => s.start);
  const shotAt = (t) => [...ctx.shots].reverse().find((s) => t >= s.start - 1e-6) || ctx.shots[0];

  const frames = [];
  let prevLum = null;
  await decode(video, w, h, fps, (px, i) => {
    const t = i / fps;
    const n = w * h;
    const lum = new Float32Array(n);
    let white = 0, acc = 0, sum = 0, sum2 = 0, diff = 0;
    for (let k = 0, j = 0; k < n; k++, j += 3) {
      const r = px[j], g = px[j + 1], b = px[j + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      lum[k] = l;
      sum += l;
      sum2 += l * l;
      if (paper && Math.max(Math.abs(r - paper[0]), Math.abs(g - paper[1]), Math.abs(b - paper[2])) <= cfg.paper_tol) white++;
      if (accent && Math.hypot(r - accent[0], g - accent[1], b - accent[2]) <= cfg.accent_tol) acc++;
      if (prevLum) diff += Math.abs(l - prevLum[k]);
    }
    const mean = sum / n;
    frames.push({
      t: +t.toFixed(3),
      shot: shotAt(t).id,
      whitespace: paper ? white / n : null,
      accent: accent ? acc / n : null,
      diff: prevLum ? diff / n : 0,
      std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)),
    });
    prevLum = lum;
  });

  // —— 判定 ——
  const issues = [];
  const push = (kind, f, msg) => issues.push({ kind, t: f.t, shot: f.shot, msg });
  let cuts = 0;
  for (const f of frames) {
    if (f.t < cfg.skip_start) continue;
    if (f.whitespace !== null && f.whitespace < cfg.whitespace_min) push('留白不足', f, `${(f.whitespace * 100).toFixed(1)}% < ${(cfg.whitespace_min * 100).toFixed(1)}%`);
    if (f.accent !== null && f.accent > cfg.accent_max) push('点缀色超量', f, `${(f.accent * 100).toFixed(2)}% > ${(cfg.accent_max * 100).toFixed(2)}%`);
    if (f.std < 1.0) push('空帧', f, '画面几乎没有内容');
    if (f.diff > cfg.diff_max) {
      const atBoundary = boundaries.some((b) => Math.abs(b - f.t) <= 1.5 / fps);
      if (atBoundary) cuts++;
      else push('突变/闪烁', f, `相邻帧差 ${f.diff.toFixed(1)} > ${cfg.diff_max}`);
    }
  }
  if (cuts > cfg.cuts_max) issues.push({ kind: '硬切过多', t: null, shot: '*', msg: `${cuts} 次 > ${cfg.cuts_max}` });

  // 连续的同类问题合并成区间
  const merged = [];
  const order = (x) => `${x.kind}|${x.shot}`;
  issues.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : (a.t ?? 0) - (b.t ?? 0)));
  for (const it of issues) {
    const last = merged[merged.length - 1];
    if (last && last.kind === it.kind && last.shot === it.shot && it.t !== null && it.t - last.t1 <= 1.5 / fps) {
      last.t1 = it.t;
      last.n++;
    } else merged.push({ ...it, t0: it.t, t1: it.t, n: 1 });
  }
  merged.sort((a, b) => (a.t0 ?? 1e9) - (b.t0 ?? 1e9));

  // 每镜汇总
  const shots = ctx.shots.map((s) => {
    const fs_ = frames.filter((f) => f.shot === s.id && f.t >= cfg.skip_start);
    const pick = (k, fn) => (fs_.length && fs_[0][k] !== null ? fn(...fs_.map((f) => f[k])) : null);
    return { id: s.id, whitespaceMin: pick('whitespace', Math.min), accentMax: pick('accent', Math.max), diffMax: pick('diff', Math.max) };
  });

  // 超标帧接触表（最多 9 张）
  let contactSheet = null;
  const picks = merged.filter((m) => m.t0 !== null).slice(0, 9);
  if (picks.length) {
    const dir = ensureDir(path.join(ctx.filmDir, 'stills', 'qc'));
    const files = [];
    const texts = picks.map((m) => `${m.shot} ${m.t0}s ${m.kind}`);
    const labels = await labelPngs(texts, {
      size: 22, workDir: path.join(ctx.filmDir, '.cache', 'work'), log, what: '超标帧接触表', order: '顺序与下方问题列表中带时间点的条目一致',
    });
    for (const [i, m] of picks.entries()) {
      const f = path.join(dir, `qc-${i + 1}.jpg`);
      const look = labels
        ? ['-i', labels[i], '-filter_complex', '[0:v]scale=640:-2[s];[s][1:v]overlay=10:10']
        : ['-vf', `scale=640:-2${drawLabel(texts[i].replace(/:/g, '\\:'), { size: 22, box: 0.6 })}`];
      await run(['-ss', String(m.t0), '-i', video, ...look, '-frames:v', '1', '-q:v', '3', f]);
      files.push(f);
    }
    contactSheet = path.join(dir, 'qc-sheet.jpg');
    if (files.length === 1) fs.copyFileSync(files[0], contactSheet);
    else {
      const cols = Math.min(3, files.length);
      const th = Math.round((640 * H0) / W0 / 2) * 2;
      const layout = files.map((_, i) => `${(i % cols) * 640}_${Math.floor(i / cols) * th}`).join('|');
      await run([...files.flatMap((f) => ['-i', f]), '-filter_complex', `${files.map((_, i) => `[${i}:v]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=gray`, '-frames:v', '1', contactSheet]);
    }
  }

  const pct = (x) => (x === null ? '  -  ' : `${(x * 100).toFixed(1).padStart(5)}%`);
  const lines = [
    `QA《${ctx.film.title}》 ${frames.length} 帧采样 @${fps}fps · 阈值：留白≥${(cfg.whitespace_min * 100).toFixed(0)}% 点缀≤${(cfg.accent_max * 100).toFixed(1)}% 帧差≤${cfg.diff_max} 硬切≤${cfg.cuts_max}`,
    '  镜头   最少留白   最多点缀   最大帧差',
    ...shots.map((s) => `  ${s.id.padEnd(5)} ${pct(s.whitespaceMin)}    ${pct(s.accentMax)}    ${s.diffMax === null ? '-' : s.diffMax.toFixed(1).padStart(6)}`),
    `  镜头切换处硬切 ${cuts} 次`,
    shotSizeLine(ctx.film.shots),
  ];
  if (merged.length) {
    lines.push(`  ✗ ${merged.length} 项问题：`);
    for (const m of merged) lines.push(`    - [${m.kind}] ${m.shot}${m.t0 !== null ? ` ${m.t0}s${m.t1 !== m.t0 ? `–${m.t1}s` : ''}` : ''}  ${m.msg}${m.n > 1 ? `（${m.n} 帧）` : ''}`);
    if (contactSheet) lines.push(`  超标帧接触表：${path.relative(process.cwd(), contactSheet)}`);
  } else lines.push('  ✓ 全部通过');
  const report = lines.join('\n');
  fs.writeFileSync(path.join(ctx.filmDir, '.cache', 'qc.json'), JSON.stringify({ cfg, shots, issues: merged, cuts, frames }, null, 1));
  log(report);
  return { ok: merged.length === 0, shots, issues: merged, contactSheet, report };
}
