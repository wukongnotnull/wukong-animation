// 静态找出镜头用到了哪些声音同步点（cue），让镜头缓存只随这些 cue 失效。
// 只认字面量写法 s.cueIn('名') / s.cueOut("名")；
// 一旦出现动态参数（s.cueIn(name)）或直接读 cues 对象，就无法静态确定，返回 null 表示"全部 cue 都算"。
import fs from 'node:fs';

const CALL = /\bcue(?:In|Out)\s*\(\s*([^)]*?)\s*\)/g;
const LITERAL = /^(['"`])([^'"`\\$]*)\1$/;
const RAW_ACCESS = /\bcues\b/;

/**
 * @param {string[]} sources 源码字符串
 * @returns {Set<string>|null} 用到的 cue 名；null = 无法静态确定
 */
export function usedCueNames(sources) {
  const names = new Set();
  for (const src of sources) {
    if (RAW_ACCESS.test(src)) return null;
    for (const m of src.matchAll(CALL)) {
      const lit = m[1].match(LITERAL);
      if (!lit) return null;
      names.add(lit[2]);
    }
  }
  return names;
}

/** 从 cues 里挑出镜头用到的那部分（键排好序，保证哈希稳定）。 */
export function pickCues(cues = {}, files) {
  const names = usedCueNames(files.filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')));
  const keys = names ? [...names] : Object.keys(cues);
  return Object.fromEntries(keys.sort().map((k) => [k, cues[k] ?? null]));
}
