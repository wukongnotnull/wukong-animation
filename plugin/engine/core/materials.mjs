// 方案阶段的素材清单：扫描片目录里用户带来的素材，记录规格，给视频抽几帧，写进 review/素材清单.md。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertActiveProduction } from './state.mjs';
import { ensureDir } from './paths.mjs';

const KINDS = {
  video: ['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi'],
  audio: ['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg'],
  image: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.heic'],
  document: ['.md', '.txt', '.pdf', '.docx', '.doc', '.srt'],
};
const SKIP_DIRS = new Set(['.git', '.cache', '.wka', 'review', 'stills', 'generated', 'node_modules', 'shots', 'scripts', 'audio-build']);
const SKIP_FILES = new Set(['brief.md', 'story.md', 'storyboard.md', 'film.json']);
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
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(file); }
      else if (entry.isFile() && !(dir === root && SKIP_FILES.has(entry.name)) && kindOf(entry.name)) files.push(file);
    }
  };
  walk(root);
  return files;
}

const size = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function inventoryMaterials(filmDir, { frames = 3 } = {}) {
  assertActiveProduction(filmDir);
  const root = path.resolve(filmDir);
  const directory = path.join(root, 'review/素材抽帧');
  fs.rmSync(directory, { recursive: true, force: true });
  const items = [];
  for (const file of collect(root)) {
    const kind = kindOf(file);
    const rel = path.relative(root, file);
    const item = { file, rel, kind, bytes: fs.statSync(file).size, ...(kind === 'document' ? {} : probe(file)), frames: [] };
    if (kind === 'video' && frames > 0) {
      ensureDir(directory);
      item.frames = extractFrames(file, item.duration, frames, directory, `${items.length + 1}-${path.basename(file, path.extname(file)).replace(/[^\p{L}\p{N}_-]+/gu, '_')}`);
    }
    items.push(item);
  }
  const lines = ['# 素材清单', '', `共 ${items.length} 项。`, ''];
  if (!items.length) lines.push('没有找到素材：把录音、录屏、参考图、原稿放进片目录（例如 `素材/`）后重新运行 `wka materials <片目录>`。');
  else {
    lines.push('| # | 文件 | 类型 | 规格 | 大小 | 抽帧 |', '|---|---|---|---|---|---|');
    items.forEach((item, index) => {
      const spec = [item.width && item.height ? `${item.width}×${item.height}` : '', item.duration ? `${item.duration.toFixed(1)} 秒` : ''].filter(Boolean).join(' · ') || '—';
      const shots = item.frames.map((frame, order) => `[${order + 1}](素材抽帧/${path.basename(frame)})`).join(' ') || '—';
      lines.push(`| ${index + 1} | \`${item.rel}\` | ${KIND_LABELS[item.kind]} | ${spec} | ${size(item.bytes)} | ${shots} |`);
    });
    lines.push('', '视频抽帧取自等分段的中点，用于确认内容是否可用、画面是否清晰、有没有水印或敏感信息；抽帧不代替完整观看。');
  }
  const report = path.join(ensureDir(path.join(root, 'review')), '素材清单.md');
  fs.writeFileSync(report, lines.join('\n') + '\n');
  return { file: report, items };
}
