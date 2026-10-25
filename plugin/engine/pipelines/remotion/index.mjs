// remotion 管线（planned）：接口已占位，实现前 resolver 会拒绝使用它（status: planned）。
// 实现时只需填好下面三个函数，并把 pipeline.json 的 status 改为 experimental / stable。
export async function check() {
  return { ok: false, missing: ['remotion 管线尚未实现'], hint: '' };
}
export async function renderShots(job, todo, { onDone } = {}) {
  throw new Error('remotion 管线尚未实现');
}
export async function renderStills(job, points, outDir) {
  throw new Error('remotion 管线尚未实现');
}
