// 主版不变证明：第 13 道签批时存主版每镜的定稿快照；做副版（第 14 道）时，
// 主版哈希变了的镜头重渲后与快照逐帧比 PSNR，写成「主版不变报告」交审片节点 ⑪。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from './ffmpeg.mjs';
import { ShotCache } from './cache.mjs';
import { ensureDir } from './paths.mjs';
import { loadFilm, render, shotHashes } from './job.mjs';
import { readProgress } from './state.mjs';

/** 逐帧画面差异的下限：每帧 PSNR 都高于它，就算画面没变 */
export const PSNR_PASS = 50;

const frameCount = (file) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`读不出帧数：${file}\n${r.stderr}`);
  return Number.parseInt(r.stdout, 10);
};

/** 两段视频逐帧 PSNR 的最小值（dB）；完全相同为 Infinity，帧数不同为 0（镜头长度变了，画面一定变了）。 */
export async function psnrMin(a, b) {
  if (frameCount(a) !== frameCount(b)) return 0;
  const stats = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wka-psnr-')), 'psnr.log');
  try {
    await run(['-i', a, '-i', b, '-lavfi', `psnr=stats_file=${stats.replace(/[\\:']/g, '\\$&')}`, '-f', 'null', '-']);
    const values = fs.readFileSync(stats, 'utf8').split('\n').flatMap((line) => {
      const m = /psnr_avg:(\S+)/.exec(line);
      return m ? [m[1] === 'inf' ? Infinity : Number(m[1])] : [];
    });
    if (!values.length) throw new Error(`PSNR 比对没有读到任何帧：${a} ↔ ${b}`);
    return Math.min(...values);
  } finally {
    fs.rmSync(path.dirname(stats), { recursive: true, force: true });
  }
}

const SNAPSHOT_DIR = (filmDir) => path.join(path.resolve(filmDir), '.cache', 'approved');

/**
 * 第 13 道签批时调用：主版每镜复制一份定稿快照到 .cache/approved/（不进 git），返回每镜哈希。
 * 还没按当前代码渲染过全分辨率的镜头没有快照，列在 missing 里。
 */
export function snapshotMain(filmDir, { log = console.log } = {}) {
  const hashes = shotHashes(filmDir);
  const cache = new ShotCache(path.resolve(filmDir));
  const dir = SNAPSHOT_DIR(filmDir);
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
  const missing = [];
  for (const [id, hash] of Object.entries(hashes)) {
    const hit = cache.lookup(id, hash);
    if (hit) fs.copyFileSync(hit, path.join(dir, `${id}.mp4`));
    else missing.push(id);
  }
  if (missing.length) log(`  ! ${missing.join('、')} 还没按当前代码渲染全分辨率，没存下定稿快照；做副版时这几镜要目视复核主版（先 wka final 再签批可避免）`);
  else log(`  ✓ 主版定稿快照 ${Object.keys(hashes).length} 镜 → .cache/approved/`);
  return { hashes, missing };
}

const RESULT = { same: '哈希相同', pass: '重渲比对通过', fail: '画面有变化', missing: '快照缺失，需目视复核' };
const fmt = (p) => (p === null ? '—' : p === Infinity ? 'inf' : `${p.toFixed(1)} dB`);

function reportText(aspect, rows) {
  const failed = rows.filter((r) => r.result === 'fail').map((r) => r.id);
  const missing = rows.filter((r) => r.result === 'missing').map((r) => r.id);
  const verdict = failed.length
    ? `✗ 主版有变化：${failed.join('、')}。先请用户在第 13 道重新审主版，再交副版。`
    : missing.length
      ? `! ${missing.join('、')} 的定稿快照缺失，没法逐帧比对，请目视复核这几镜的主版。`
      : '✓ 主版画面没有变化。';
  return [
    `# 主版不变报告 · ${aspect} 副版`,
    '',
    verdict,
    '',
    `主版镜头哈希与第 13 道签批时相同即不变；哈希变了的镜头重渲后与定稿快照逐帧比对，每帧 PSNR 高于 ${PSNR_PASS} dB 算不变。`,
    '',
    '| 镜头 | 结果 | 最低 PSNR |',
    '|---|---|---|',
    ...rows.map((r) => `| ${r.id} | ${RESULT[r.result]} | ${fmt(r.psnr)} |`),
    '',
  ].join('\n');
}

/**
 * 做副版前调用：比对主版与第 13 道签批时的定稿，写「主版不变报告」到 review/。
 * 主版还没签批过、或处理的就是主版时返回 null。比对不通过不中断，只在报告和日志里写明。
 */
export async function checkMainUnchanged(filmDir, { aspect, log = console.log } = {}) {
  const { variant } = loadFilm(filmDir, { aspect });
  if (variant.isMain) return null;
  const approved = readProgress(filmDir).approved?.main;
  if (!approved) {
    log('  ! 主版还没在第 13 道签批，跳过主版不变比对');
    return null;
  }
  const current = shotHashes(filmDir);
  const changed = Object.keys(current).filter((id) => current[id] !== approved[id]);
  const segments = changed.length ? (await render(filmDir, { log })).segments : [];
  const rows = [];
  for (const id of Object.keys(current)) {
    if (!changed.includes(id)) {
      rows.push({ id, result: 'same', psnr: null });
      continue;
    }
    const snap = path.join(SNAPSHOT_DIR(filmDir), `${id}.mp4`);
    if (!fs.existsSync(snap)) {
      rows.push({ id, result: 'missing', psnr: null });
      continue;
    }
    const psnr = await psnrMin(snap, segments.find((s) => s.id === id).file);
    rows.push({ id, result: psnr > PSNR_PASS ? 'pass' : 'fail', psnr });
  }
  const file = path.join(ensureDir(path.join(path.resolve(filmDir), 'review')), variant.review('主版不变报告.md'));
  fs.writeFileSync(file, reportText(variant.aspect, rows));
  const failed = rows.filter((r) => r.result !== 'same' && r.result !== 'pass');
  log(`${failed.length ? '  ! 主版不变比对有问题' : '  ✓ 主版画面没有变化'}：${file}`);
  return { ok: !failed.length, rows, file };
}
