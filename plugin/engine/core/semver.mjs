// 极简 semver：只支持 wukong-animation 用到的写法 —— "1.2.3"、">=1.2.3"、"^1.2"、"~1.2.3"。
export function parse(v) {
  const m = String(v).trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`无法解析版本号: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** version 是否满足 range。 */
export function satisfies(version, range) {
  const v = parse(version);
  const r = String(range).trim();
  if (r.startsWith('>=')) return cmp(v, parse(r.slice(2))) >= 0;
  if (r.startsWith('^')) {
    const b = parse(r.slice(1));
    if (cmp(v, b) < 0) return false;
    // ^0.x 锁次版本，^1+ 锁主版本（与 npm 一致）
    return b[0] === 0 ? v[0] === 0 && v[1] === b[1] : v[0] === b[0];
  }
  if (r.startsWith('~')) {
    const b = parse(r.slice(1));
    return cmp(v, b) >= 0 && v[0] === b[0] && v[1] === b[1];
  }
  return cmp(v, parse(r)) === 0;
}
