// 方案阶段的素材清单：导入并扫描片目录里用户带来的素材，记录来源与规格，给视频抽几帧，写进 review/素材/素材清单.md。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertActiveProduction } from './state.mjs';
import { ensureDir } from './paths.mjs';
import { hashFile } from './file-hash.mjs';
import { atomicJson, readJson } from './evidence.mjs';
import { reviewFile, MATERIAL_DIR } from './layout.mjs';

const KINDS = {
  video: ['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi'],
  audio: ['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg'],
  image: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.heic'],
  document: ['.md', '.txt', '.pdf', '.docx', '.doc', '.srt'],
};
/** 输入素材的三个固定位置：图片视频、录音、文字资料（含智能体附属文档）。 */
export const MATERIAL_ROOTS = { video: 'media', image: 'media', audio: 'audio/voice', document: MATERIAL_DIR };
const SCAN_ROOTS = [...new Set(Object.values(MATERIAL_ROOTS))];
export const LARGE_FILE_BYTES = 20 * 1024 * 1024;
const ORIGIN_FILE = '.wka/materials-origin.json';
const KIND_LABELS = { video: '视频', audio: '音频', image: '图片', document: '文档' };

const kindOf = file => Object.keys(KINDS).find(kind => KINDS[kind].includes(path.extname(file).toLowerCase())) || null;

function probe(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (result.status !== 0) return {};
  try {
    const data = JSON.parse(result.stdout);
    const video = (data.streams || []).find(stream => stream.codec_type === 'video');
    const duration = Number(data.format?.duration);
    return { width: video?.width, height: video?.height, duration: Number.isFinite(duration) ? duration : undefined };
  } catch { return {}; }
}

function extractFrames(file, duration, count, directory, stem) {
  const frames = [];
  for (let index = 1; index <= count; index++) {
    const at = duration ? duration * (index - 0.5) / count : 0;
    const out = path.join(directory, `${stem}-${index}.jpg`);
    const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(at.toFixed(3)), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', out]);
    if (result.status === 0 && fs.existsSync(out) && fs.statSync(out).size) frames.push(out);
  }
  return frames;
}

function collect(root) {
  const files = [];
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && kindOf(entry.name)) files.push(file);
    }
  };
  for (const rel of SCAN_ROOTS) walk(path.join(root, rel));
  return files;
}

function sourceFilesOf(input) {
  const stat = fs.statSync(input);
  if (stat.isFile()) return [input];
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) out.push(file);
    }
  };
  walk(input);
  return out;
}

function freeName(directory, name) {
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  let candidate = name, index = 2;
  while (fs.existsSync(path.join(directory, candidate))) candidate = `${stem}-${index++}${ext}`;
  return candidate;
}

/** 把用户给的文件（或目录）按类型复制进 media/、audio/voice/、资料/；内容相同的跳过，重名加序号，来源写进 .wka/materials-origin.json。 */
function importMaterials(root, inputs, log) {
  const record = readJson(path.join(root, ORIGIN_FILE), { version: 1, files: {} });
  const known = new Map();
  for (const file of collect(root)) known.set(hashFile(file), path.relative(root, file));
  const added = [], skipped = [];
  for (const input of inputs) {
    const source = path.resolve(input);
    if (!fs.existsSync(source)) throw new Error(`素材来源不存在：${input}`);
    for (const file of sourceFilesOf(source)) {
      const kind = kindOf(file);
      if (!kind) { skipped.push({ source: file, reason: '不是支持的素材类型' }); continue; }
      const sha256 = hashFile(file);
      if (known.has(sha256)) { skipped.push({ source: file, reason: `内容相同，已有 ${known.get(sha256)}` }); continue; }
      const directory = ensureDir(path.join(root, MATERIAL_ROOTS[kind]));
      const name = freeName(directory, path.basename(file));
      fs.copyFileSync(file, path.join(directory, name));
      const rel = path.posix.join(MATERIAL_ROOTS[kind], name);
      record.files[rel] = { source: file, sha256, bytes: fs.statSync(file).size, addedAt: new Date().toISOString() };
      known.set(sha256, rel);
      added.push({ source: file, rel });
    }
  }
  atomicJson(path.join(root, ORIGIN_FILE), record);
  for (const item of added) log(`  + ${item.rel}  ← ${item.source}`);
  for (const item of skipped) log(`  · 跳过 ${item.source}（${item.reason}）`);
  return { added, skipped };
}

/** 影片目录往上找到 .git 为止，看 .gitattributes 里有没有 Git LFS 规则。 */
export function hasLfsRules(filmDir) {
  let dir = path.resolve(filmDir);
  for (;;) {
    const file = path.join(dir, '.gitattributes');
    if (fs.existsSync(file) && /filter=lfs/.test(fs.readFileSync(file, 'utf8'))) return true;
    if (fs.existsSync(path.join(dir, '.git')) || path.dirname(dir) === dir) return false;
    dir = path.dirname(dir);
  }
}

const size = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function inventoryMaterials(filmDir, { frames = 3, add = [], log = () => {} } = {}) {
  assertActiveProduction(filmDir);
  const root = path.resolve(filmDir);
  const imported = add.length ? importMaterials(root, add, log) : { added: [], skipped: [] };
  const origins = readJson(path.join(root, ORIGIN_FILE), { files: {} }).files || {};
  const report = reviewFile(root, '素材清单.md', { ensure: true });
  const directory = path.join(path.dirname(report), '素材抽帧');
  fs.rmSync(directory, { recursive: true, force: true });
  const lfs = hasLfsRules(root);
  const items = [], warnings = [];
  for (const file of collect(root)) {
    const kind = kindOf(file);
    const rel = path.relative(root, file).split(path.sep).join('/');
    const bytes = fs.statSync(file).size;
    const origin = origins[rel] && origins[rel].bytes === bytes ? origins[rel].source : null;
    const item = { file, rel, kind, bytes, origin, ...(kind === 'document' ? {} : probe(file)), frames: [] };
    if (bytes > LARGE_FILE_BYTES && !lfs) warnings.push(`${rel} 有 ${size(bytes)}，超过 20 MB 而项目没有 Git LFS 规则：提交前先 git lfs track，或确认不进版本库`);
    if (kind === 'video' && frames > 0) {
      ensureDir(directory);
      item.frames = extractFrames(file, item.duration, frames, directory, `${items.length + 1}-${path.basename(file, path.extname(file)).replace(/[^\p{L}\p{N}_-]+/gu, '_')}`);
    }
    items.push(item);
  }
  const lines = ['# 素材清单', '', `共 ${items.length} 项。图片和视频放 \`media/\`，录音放 \`audio/voice/\`，文字资料放 \`资料/\`。`, ''];
  if (!items.length) lines.push('没有找到素材：用 `wka materials <片目录> --add <文件或目录>` 导入录音、录屏、参考图和原稿，或直接放进上面三个目录后重新运行 `wka materials <片目录>`。');
  else {
    lines.push('| # | 文件 | 类型 | 规格 | 大小 | 来源 | 抽帧 |', '|---|---|---|---|---|---|---|');
    items.forEach((item, index) => {
      const spec = [item.width && item.height ? `${item.width}×${item.height}` : '', item.duration ? `${item.duration.toFixed(1)} 秒` : ''].filter(Boolean).join(' · ') || '—';
      const shots = item.frames.map((frame, order) => `[${order + 1}](素材抽帧/${path.basename(frame)})`).join(' ') || '—';
      lines.push(`| ${index + 1} | \`${item.rel}\` | ${KIND_LABELS[item.kind]} | ${spec} | ${size(item.bytes)} | ${item.origin ? `\`${item.origin}\`` : '—'} | ${shots} |`);
    });
    lines.push('', '视频抽帧取自等分段的中点，用于确认内容是否可用、画面是否清晰、有没有水印或敏感信息；抽帧不代替完整观看。');
  }
  if (warnings.length) lines.push('', '## 体积提醒', '', ...warnings.map(text => `- ${text}`));
  fs.writeFileSync(report, lines.join('\n') + '\n');
  return { file: report, items, warnings, ...imported };
}
