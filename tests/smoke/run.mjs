#!/usr/bin/env node
// 冒烟测试：每个风格的示范片，用固定种子在 3 个时间点渲染预览静帧，
//   1) 同一帧渲染两次必须一致（确定性）：允许个别像素的抗锯齿抖动（CI 上的 Chromium 偶尔会有），
//      但不允许任何像素明显变化，也不允许平均差超过 DET_MEAN_MAX
//   2) 与基准图比对：平均像素差 ≤ MEAN_MAX，且明显变化的像素占比 ≤ CHANGED_MAX
//      （水墨这类大面积留白的画面，局部改坏了平均差也很小，所以要看占比）
// 基准图按平台分目录（baseline/<darwin|linux>/）：fallback 字体与光栅化在不同系统上不一样。
// 用法：node tests/smoke/run.mjs [--update] [风格id…]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WK = path.join(ROOT, 'plugin/engine/bin/wka.mjs');
const BASE = path.join(ROOT, 'tests/smoke/baseline', process.platform);
const update = process.argv.includes('--update');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const MEAN_MAX = 2.0; // 0–255 的平均绝对差
const PIXEL_TOL = 24; // 灰度差超过它才算"变了"
const CHANGED_MAX = 0.003; // 变了的像素最多 0.3%（题字挪 40px 约 1.2%）
const DET_MEAN_MAX = 0.05; // 两次渲染的平均差上限；实测 CI 抖动 < 0.001，真不确定（元素挪位、随机数）远大于它
const IS_CI = !!process.env.CI;
process.env.WKA_NO_FONT_DOWNLOAD = '1'; // 统一用 fallback 字体，基准图跨机器可比

function raw(png) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', png, '-vf', 'scale=320:-2', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 });
  return r.stdout;
}
function compare(a, b) {
  if (a.length !== b.length) return { mean: Infinity, changed: 1 };
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    s += d;
    if (d > PIXEL_TOL) n++;
  }
  return { mean: s / a.length, changed: n / a.length };
}
function stills(film, points) {
  fs.rmSync(path.join(film, 'stills'), { recursive: true, force: true });
  const r = spawnSync(process.execPath, [WK, 'still', film, '--proxy', '--at', points.map((p) => `${p.shot}:${p.t}`).join(',')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return points.map((p) => path.join(film, 'stills', `${p.shot}-${p.t.toFixed(2)}s.png`));
}

let fail = 0;
let tested = 0;
const skills = path.join(ROOT, 'plugin/skills');
for (const id of fs.readdirSync(skills)) {
  if (only.length && !only.includes(id)) continue;
  const ex = path.join(skills, id, 'examples');
  if (!fs.existsSync(path.join(skills, id, 'style.json')) || !fs.existsSync(ex)) continue;
  for (const name of fs.readdirSync(ex).filter((d) => fs.existsSync(path.join(ex, d, 'film.json')))) {
    tested++;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-smoke-'));
    const film = path.join(tmp, name);
    fs.cpSync(path.join(ex, name), film, { recursive: true });
    const fj = JSON.parse(fs.readFileSync(path.join(film, 'film.json'), 'utf8'));
    const pick = [fj.shots[0], fj.shots[Math.floor(fj.shots.length / 2)], fj.shots[fj.shots.length - 1]];
    const points = pick.map((s) => ({ shot: s.id, t: +(s.duration * 0.7).toFixed(2) }));
    const first = stills(film, points).map(raw);
    const second = stills(film, points).map(raw);
    const label = `${id}/${name}`;
    first.forEach((a, i) => {
      const { mean, changed } = compare(a, second[i]);
      if (mean > DET_MEAN_MAX || changed > 0) {
        console.log(`  ✗ ${label} ${points[i].shot}@${points[i].t}s 两次渲染不一致（平均差 ${mean.toFixed(4)} · 变化像素 ${(changed * 100).toFixed(3)}%）`);
        fail++;
      }
    });
    const dir = path.join(BASE, id, name);
    fs.mkdirSync(dir, { recursive: true });
    first.forEach((a, i) => {
      const f = path.join(dir, `${points[i].shot}.gray`);
      if (!update && !fs.existsSync(f) && IS_CI) {
        // CI 上缺基准图不能"顺手写一份就算通过"，那样比对永远不会失败
        console.log(`  ✗ ${label} ${points[i].shot} 缺少 ${process.platform} 基准图：${path.relative(ROOT, f)}（手动运行 smoke workflow 并勾选 update，下载 artifact 后提交）`);
        fail++;
        return;
      }
      if (update || !fs.existsSync(f)) {
        fs.writeFileSync(f, a);
        console.log(`  · ${label} ${points[i].shot} 已写入基准（${process.platform}）`);
        return;
      }
      const { mean, changed } = compare(a, fs.readFileSync(f));
      const ok = mean <= MEAN_MAX && changed <= CHANGED_MAX;
      if (!ok) fail++;
      const detail = `平均差 ${mean.toFixed(2)} · 变化像素 ${(changed * 100).toFixed(2)}%`;
      const limit = `（上限 ${MEAN_MAX} · ${(CHANGED_MAX * 100).toFixed(1)}%）`;
      console.log(`  ${ok ? '✓' : '✗'} ${label} ${points[i].shot}@${points[i].t}s ${detail}${ok ? '' : ' ' + limit}`);
    });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
if (!tested) {
  console.log('✗ 没有找到任何示范片（plugin/skills/<风格>/examples/<片名>/film.json），冒烟测试什么都没测');
  fail++;
}
console.log(fail ? `\n✗ ${fail} 项失败` : `\n✓ 冒烟测试通过（${tested} 支示范片）`);
process.exit(fail ? 1 : 0);
