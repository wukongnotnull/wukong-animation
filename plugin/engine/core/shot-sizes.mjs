// 景别检查：分镜的景别要有变化，画面才有节奏。规则同 director/STORYBOARD.md：
// 每镜都写景别；4 镜及以上至少 3 种；相邻两镜不同。纯函数，不碰文件。

export const SHOT_SIZES = ['大远景', '远景', '全景', '中景', '近景', '特写', '大特写'];
const MIN_KINDS = 3;
const KINDS_FROM = 4; // 镜头数达到这个数才要求至少 MIN_KINDS 种

/** @returns {string[]} 问题列表，空数组表示通过 */
export function checkShotSizes(shots) {
  const missing = shots.filter((s) => !s.size).map((s) => `镜头 ${s.id} 没有写景别（film.json 的 shots[].size）`);
  if (missing.length) return missing;
  const problems = [];
  const kinds = [...new Set(shots.map((s) => s.size))];
  if (shots.length >= KINDS_FROM && kinds.length < MIN_KINDS) {
    problems.push(`${shots.length} 个镜头只用了 ${kinds.length} 种景别（${kinds.join('、')}），至少要 ${MIN_KINDS} 种`);
  }
  for (let i = 1; i < shots.length; i++) {
    if (shots[i].size === shots[i - 1].size) problems.push(`${shots[i - 1].id} 和 ${shots[i].id} 都是${shots[i].size}，相邻两镜景别要不同`);
  }
  return problems;
}

/** 一行摘要：「近景 → 远景 → 中景（3 种，相邻都不同）」 */
export function describeShotSizes(shots) {
  const kinds = new Set(shots.map((s) => s.size).filter(Boolean));
  return `${shots.map((s) => s.size || '?').join(' → ')}（${kinds.size} 种）`;
}
