// 音色试听（第 6 道）：同一句文案用几个音色各合成一遍，交给用户挑。
// 输出 review/试听-<n>-<音色短名>.m4a；不写 film.json，不进声轨缓存。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ENGINES } from './tts.mjs';

export const DEFAULT_AUDITION_VOICES = ['zh-CN-YunyangNeural', 'zh-CN-YunjianNeural', 'zh-CN-XiaoxiaoNeural'];
const MAX_VOICES = 4;
const AUDITION_FILE = /^试听-.*\.m4a$/;

// edge-tts 中文音色的中文名
const CHINESE_NAMES = {
  云扬: 'zh-CN-YunyangNeural',
  云健: 'zh-CN-YunjianNeural',
  云希: 'zh-CN-YunxiNeural',
  云夏: 'zh-CN-YunxiaNeural',
  晓晓: 'zh-CN-XiaoxiaoNeural',
  晓伊: 'zh-CN-XiaoyiNeural',
  晓北: 'zh-CN-liaoning-XiaobeiNeural',
  晓妮: 'zh-CN-shaanxi-XiaoniNeural',
};
const FULL_NAME = /^[a-z]{2,3}-[A-Z]{2}-.+Neural$/;
const SHORT_NAME = /^[A-Za-z][A-Za-z-]*$/;

/** 音色全名、中文名（云扬）或简称（Yunyang）→ 全名。 */
export function resolveVoice(name) {
  if (FULL_NAME.test(name)) return name;
  if (CHINESE_NAMES[name]) return CHINESE_NAMES[name];
  if (SHORT_NAME.test(name)) return `zh-CN-${name}Neural`;
  throw new Error(`不认识的音色「${name}」。可以写全名（zh-CN-YunyangNeural）、简称（Yunyang）或中文名：${Object.keys(CHINESE_NAMES).join('、')}`);
}

/** zh-CN-YunyangNeural → Yunyang；zh-CN-liaoning-XiaobeiNeural → liaoning-Xiaobei */
export const voiceShortName = (voice) => voice.replace(/^zh-CN-/, '').replace(/Neural$/, '');

/**
 * @param {{text:string, voices?:string[], rate?:string, pitch?:string, outDir:string, engines?:object[], log?:Function}} o
 * @returns {{file:string, voice:string}[]} file 是绝对路径
 */
export function auditionVoices({ text, voices = DEFAULT_AUDITION_VOICES, rate, pitch, outDir, engines = ENGINES, log = console.log }) {
  if (!text) throw new Error('没有试听文本：film.json 里还没有人声条目时，用 --text 指定一句');
  if (!voices.length) throw new Error('至少一个音色（--voices a,b,c）');
  if (voices.length > MAX_VOICES) throw new Error(`一次最多 ${MAX_VOICES} 个音色，收到 ${voices.length} 个`);
  const fullNames = voices.map(resolveVoice);
  const engine = engines.find((e) => e.name === 'edge-tts' && e.available());
  if (!engine) throw new Error('试听需要 edge-tts（pip install edge-tts）；也可以改用自供录音');

  outDir = path.resolve(outDir);
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (AUDITION_FILE.test(f)) fs.rmSync(path.join(outDir, f), { force: true });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-audition-'));
  try {
    return fullNames.map((voice, i) => {
      const raw = path.join(tmp, `${i + 1}.mp3`);
      if (!engine.synth(text, voice, raw, { rate, pitch }) || !fs.existsSync(raw)) throw new Error(`试听合成失败：${voice}`);
      const file = path.join(outDir, `试听-${i + 1}-${voiceShortName(voice)}.m4a`);
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-c:a', 'aac', '-b:a', '192k', file], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`试听转码失败（${voice}）：${(r.stderr || r.error?.message || '').slice(-400)}`);
      log(`${file}  ${voice}`);
      return { file, voice };
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
