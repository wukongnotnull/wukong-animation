// AI 配音（TTS）：按顺序尝试已安装的引擎，全部不可用时返回 null（片子照样能出，只是没有 AI 人声）。
// 生成后用 ffprobe 量出每句真实时长 —— director 用它回填分镜时长（"先定声音，再定画面"）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { probeDuration } from '../core/ffmpeg.mjs';

const has = (cmd, args = ['--help']) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;

/**
 * edge-tts 的命令行参数。rate / pitch 写成 --rate=-30% 的等号形式：
 * 分开写时，负号开头的值会被当成参数名。
 */
export function edgeTtsArgs(text, voice, out, { rate, pitch } = {}) {
  return [
    '--text', text,
    '--voice', voice || 'zh-CN-YunxiNeural',
    ...(rate ? [`--rate=${rate}`] : []),
    ...(pitch ? [`--pitch=${pitch}`] : []),
    '--write-media', out,
  ];
}

/** 已知引擎：检测命令 + 合成命令。prosody 表示支持 rate / pitch。新增引擎在这里加一项。 */
export const ENGINES = [
  {
    name: 'kokoro',
    available: () => has('python3', ['-c', 'import kokoro']),
    synth: (text, voice, out) =>
      spawnSync('python3', ['-m', 'kokoro', '--text', text, '--voice', voice || 'zf_xiaoxiao', '--output-file', out], { stdio: 'ignore' }).status === 0,
  },
  {
    name: 'edge-tts',
    prosody: true,
    available: () => has('edge-tts', ['--version']),
    synth: (text, voice, out, prosody) => spawnSync('edge-tts', edgeTtsArgs(text, voice, out, prosody), { stdio: 'ignore' }).status === 0,
  },
];

export function detectTtsEngine() {
  return ENGINES.filter((e) => e.available()).map((e) => e.name);
}

/**
 * 同一引擎 + 音色 + 文本（+ 语速、音高）→ 同一个文件名。都没改的句子直接复用，不重新合成。
 * 不写 rate / pitch 的句子哈希和以前一样，升级后已有的配音缓存继续有效。
 */
export function voFileName(engine, voice, text, { rate, pitch } = {}) {
  const prosody = rate || pitch ? `\0${rate || ''}\0${pitch || ''}` : '';
  const h = crypto.createHash('sha256').update(`${engine}\0${voice || ''}\0${text}${prosody}`).digest('hex').slice(0, 12);
  return `vo-${h}.${engine === 'edge-tts' ? 'mp3' : 'wav'}`;
}

/**
 * 合成 AI 配音，按句缓存。
 * 联网引擎（edge-tts）每次合成的时长会有细微出入；不缓存的话声音同步点会跟着变，
 * 进而让所有镜头的缓存失效。所以只有文本或音色改了的句子才重新合成。
 * @param {{text:string, at:number, voice?:string, rate?:string, pitch?:string}[]} lines
 * @param {string} outDir
 * @returns {null | {engine:string, items:{file:string, at:number, duration:number, text:string}[]}}
 */
export function synthesizeVoiceOver(lines, outDir, { log = console.log, engines = ENGINES } = {}) {
  if (!lines?.length) return null;
  const engine = engines.find((e) => e.available());
  if (!engine) {
    log('  ! 没有可用的 TTS 引擎（kokoro / edge-tts），本次跳过 AI 配音');
    return null;
  }
  fs.mkdirSync(outDir, { recursive: true });
  if (!engine.prosody && lines.some((l) => l.rate || l.pitch)) log(`  ! ${engine.name} 不支持 rate / pitch，已忽略`);
  let reused = 0;
  const items = lines.map((l) => {
    const prosody = engine.prosody ? { rate: l.rate, pitch: l.pitch } : {};
    const file = path.join(outDir, voFileName(engine.name, l.voice, l.text, prosody));
    const cached = fs.existsSync(file) ? probeDuration(file) : 0;
    if (cached) {
      reused++;
      return { file, at: l.at, duration: cached, text: l.text };
    }
    const tmp = file + '.part' + path.extname(file);
    fs.rmSync(tmp, { force: true });
    if (!engine.synth(l.text, l.voice, tmp, prosody) || !fs.existsSync(tmp)) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`TTS 失败：${l.text}`);
    }
    fs.renameSync(tmp, file);
    return { file, at: l.at, duration: probeDuration(file), text: l.text };
  });
  // 清掉已经不再使用的旧句子
  const keep = new Set(items.map((it) => path.basename(it.file)));
  for (const f of fs.readdirSync(outDir)) if (f.startsWith('vo-') && !keep.has(f)) fs.rmSync(path.join(outDir, f), { force: true });
  log(`  ✓ AI 配音 ${items.length} 条（${engine.name}${reused ? `，复用 ${reused} 条` : ''}）`);
  return { engine: engine.name, items };
}
