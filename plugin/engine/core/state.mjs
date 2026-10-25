// 恢复在制项目：films/<片>/.wka/state.json 记录推进到第几道工序、每个审片节点的结论。
// 这个文件随片子一起进 git，换会话、隔几天再来，director 读它就能接着做。
import fs from 'node:fs';
import path from 'node:path';

/** 12 道工序（与 skills/director/SKILL.md 一致） */
export const PRODUCTION_STEPS = {
  1: '制作环境、工程初始化、恢复在制项目',
  2: '制作简报确认',
  3: '美术定调',
  4: '文学脚本撰写',
  5: '分镜脚本',
  6: 'VO 素材来源',
  7: '声轨制作',
  8: '风格帧与动态分镜',
  9: '镜头制作',
  10: '小样渲染与技术质检',
  11: '终版渲染与终混',
  12: '终检与交付',
};
/** 审片节点所在的工序 */
export const REVIEW_GATES = { 3: '①美术定调', 4: '②文学脚本', 5: '③分镜', 6: '④VO 素材来源', 7: '⑤声轨审听', 8: '⑥风格帧与动态分镜', 10: '⑦小样', 12: '⑧终审' };

const fileOf = (filmDir) => path.join(path.resolve(filmDir), '.wka', 'state.json');

export function readProgress(filmDir) {
  const f = fileOf(filmDir);
  if (!fs.existsSync(f)) return { step: 0, history: [] };
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

/** 记录推进到第 step 步；note 写这一步的结论（例如用户签批了哪套视觉方案、提了什么返修意见）。 */
export function recordProgress(filmDir, { step, note = '', sha = null }) {
  const st = readProgress(filmDir);
  const f = fileOf(filmDir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (step) st.step = Math.max(st.step || 0, Number(step));
  st.history.push({ step: step ? Number(step) : st.step, label: PRODUCTION_STEPS[step] || '', gate: REVIEW_GATES[step] || null, note, sha, at: new Date().toISOString() });
  st.updated = new Date().toISOString();
  fs.writeFileSync(f, JSON.stringify(st, null, 2) + '\n');
  return st;
}

/** 扫描项目里的所有片子，返回每支的进度。 */
export function listProductions(projectDir = '.') {
  const films = path.resolve(projectDir, 'films');
  if (!fs.existsSync(films)) return [];
  return fs
    .readdirSync(films, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(films, d.name, 'film.json')))
    .map((d) => {
      const dir = path.join(films, d.name);
      const film = JSON.parse(fs.readFileSync(path.join(dir, 'film.json'), 'utf8'));
      const st = readProgress(dir);
      const last = st.history[st.history.length - 1];
      const next = st.step >= 12 ? null : st.step + 1;
      return { name: d.name, dir, title: film.title, style: film.style, step: st.step, next, nextLabel: next ? PRODUCTION_STEPS[next] : '已完成', last, updated: st.updated };
    });
}
