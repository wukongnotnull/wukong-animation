// 恢复在制项目：films/<片>/.wka/state.json 记录推进到第几道工序、每个审片节点的结论。
// 这个文件随片子一起进 git，换会话、隔几天再来，director 读它就能接着做。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicJson } from './evidence.mjs';

/** 唯一在用的九道工序；旧项目只读，不保留旧制作流程。 */
export const PRODUCTION_STEPS = {
  1: '制作准备', 2: '确定方案', 3: '编写剧本', 4: '制作人声', 5: '规划镜头',
  6: '制作小样', 7: '制作成片', 8: '调整画幅', 9: '导出剪映草稿',
};
export const LAST_STEP = 9;
export const REVIEW_GATES = { 2: '①方案简报', 3: '②剧本', 4: '③人声', 5: '④分镜稿', 6: '⑤小样', 7: '⑥成片', 8: '⑦调整画幅', 9: '⑧剪映草稿' };
export const FLOW = 8;
export const PRODUCTION_ROLES = { voice: 4, storyboard: 5, proxy: 6, final: 7, variant: 8, draft: 9 };
export const PRODUCTION_DELIVERABLES = { 1: '环境检查结果', 2: '方案简报', 3: '剧本', 4: '人声录音与台词定位', 5: '分镜稿', 6: '小样视频', 7: '成片视频', 8: '画幅成片', 9: '剪映草稿' };
export const hasNoVoice = film => film.audio?.voice_source === 'none' && !(film.audio?.voices || []).length;
const HISTORY_FILES = ['brief.md', 'film.json', '.wka/workbench.json', '.wka/final-delivery.json', '.wka/pending-approval.json', '.wka/decisions.json', '.wka/operations.json', '.cache/operations.json'];
const fileOf = dir => path.join(path.resolve(dir), '.wka', 'state.json');

function flowError(code, flow, stateFile = null) {
  const instruction = code === 'WKA_FLOW_TOO_NEW' ? '请升级到支持此流程的插件，再继续制作。'
    : code === 'WKA_LEGACY_READONLY' ? '旧项目仅保留为历史档案。续作请另建新项目并复用素材，不迁移或继承旧签批。'
    : code === 'WKA_PRODUCTION_NOT_INITIALIZED' ? '请先通过 wka brief 或 wka init 创建新项目。'
    : '请核实进度文件并从可靠备份恢复；不会自动修复或覆盖。';
  return Object.assign(new Error(`${code}：${instruction}${stateFile ? `（${stateFile}）` : ''}`),
    { code, flow, supportedFlow: FLOW, stateFile, readonly: true, instruction });
}
function assertFlow(st, file = null) {
  if (!st || typeof st !== 'object' || Array.isArray(st)) throw flowError('WKA_FLOW_INVALID', null, file);
  const flow = Object.hasOwn(st, 'flow') ? st.flow : 1;
  if (!Number.isSafeInteger(flow) || flow < 1) throw flowError('WKA_FLOW_INVALID', flow, file);
  if (flow > FLOW) throw flowError('WKA_FLOW_TOO_NEW', flow, file);
  if (flow === FLOW && (!Number.isInteger(st.step) || st.step < 0 || st.step > LAST_STEP || !Array.isArray(st.history) ||
      st.history.some(h => !h || !Number.isInteger(h.step) || h.step < 0 || h.step > LAST_STEP))) throw flowError('WKA_FLOW_INVALID', flow, file);
  return flow;
}
/** 纯读取；缺失标记必须结合现有制作历史判断，不能直接当新项目。 */
export function assertCompatibleProgress(filmDir) {
  const file = fileOf(filmDir); let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  let st; try { st = JSON.parse(raw); } catch { throw flowError('WKA_FLOW_INVALID', null, file); }
  assertFlow(st, file); return st;
}
export function inspectProduction(filmDir) {
  const st = assertCompatibleProgress(filmDir);
  if (st) return { mode: st.flow === FLOW ? 'active' : 'archive', flow: st.flow ?? 1, readonly: st.flow !== FLOW, state: st };
  const history = HISTORY_FILES.filter(f => fs.existsSync(path.join(filmDir, f)));
  for (const relative of history.filter(f => f.endsWith('.json'))) {
    const file = path.join(filmDir, relative);
    try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid'); }
    catch (e) { if (e.code) throw e; throw flowError('WKA_FLOW_INVALID', null, file); }
  }
  return { mode: history.length ? 'archive' : 'new', flow: history.length ? 5 : FLOW, readonly: !!history.length, state: null, historyFiles: history };
}
export function assertActiveProduction(filmDir) {
  const result = inspectProduction(filmDir);
  if (result.mode !== 'active') throw flowError(result.readonly ? 'WKA_LEGACY_READONLY' : 'WKA_PRODUCTION_NOT_INITIALIZED', result.flow, fileOf(filmDir));
  return result.state;
}
export function initializeProduction(filmDir) {
  const result = inspectProduction(filmDir);
  if (result.readonly) throw flowError('WKA_LEGACY_READONLY', result.flow, fileOf(filmDir));
  if (result.state) return result.state;
  const state = { flow: FLOW, step: 0, history: [] };
  fs.mkdirSync(path.dirname(fileOf(filmDir)), { recursive: true }); atomicJson(fileOf(filmDir), state); return state;
}
export function flowDiagnostic(filmDir) {
  try { inspectProduction(filmDir); return null; } catch (e) {
    if (!['WKA_FLOW_TOO_NEW', 'WKA_FLOW_INVALID'].includes(e.code)) throw e;
    return { compatible: false, code: e.code, flow: e.flow, supportedFlow: e.supportedFlow,
      stateFile: e.stateFile, readonly: true, error: e.message, instruction: e.instruction };
  }
}
export function assertProjectCompatible(projectDir) {
  const films = path.resolve(projectDir, 'films');
  if (fs.existsSync(films)) for (const e of fs.readdirSync(films, { withFileTypes: true })) if (e.isDirectory()) inspectProduction(path.join(films, e.name));
}
/** 保留只读调用契约；旧格式不再换算或写回。 */
export function migrateProgress(st) { const flow = assertFlow(st); return { state: st, migrated: false, readonly: flow !== FLOW }; }
export function readProgress(filmDir) {
  const result = inspectProduction(filmDir);
  return result.state || { flow: result.flow, step: 0, history: [] };
}
function writeState(filmDir, st) { assertActiveProduction(filmDir); assertFlow(st, fileOf(filmDir)); atomicJson(fileOf(filmDir), st); }
function checkedStep(step, fallback) {
  const value = step == null ? fallback : Number(step);
  if (!Number.isInteger(value) || value < 0 || value > LAST_STEP) throw new Error(`工序取 1–${LAST_STEP}`);
  return value;
}
export function recordProgress(filmDir, { step, note = '', sha = null }) {
  const st = assertActiveProduction(filmDir), number = checkedStep(step, st.step), updated = new Date().toISOString();
  const next = { ...st, step: Math.max(st.step, number), updated,
    history: [...st.history, { step: number, label: PRODUCTION_STEPS[number] || '', gate: REVIEW_GATES[number] || null, note, sha, at: updated }] };
  writeState(filmDir, next); return next;
}
export function recordApproval(filmDir, { main = null, variant = null, shots = null }) {
  const st = assertActiveProduction(filmDir), approved = st.approved || {};
  const next = main ? { ...approved, main, mainId: crypto.randomUUID() }
    : { ...approved, variants: { ...(approved.variants || {}), [variant]: { shots, main: approved.main || null } } };
  const out = { ...st, approved: next, updated: new Date().toISOString() }; writeState(filmDir, out); return out;
}
export function nextProductionStep(filmDir, step) {
  const filmFile = path.join(path.resolve(filmDir), 'film.json');
  const film = fs.existsSync(filmFile) ? JSON.parse(fs.readFileSync(filmFile, 'utf8')) : {};
  const decisions = fs.existsSync(path.join(filmDir, '.wka/decisions.json')) ? JSON.parse(fs.readFileSync(path.join(filmDir, '.wka/decisions.json'), 'utf8')) : {};
  const excluded = new Set();
  if (hasNoVoice(film)) excluded.add(PRODUCTION_ROLES.voice);
  if (!Object.keys(film.variants || {}).length) excluded.add(PRODUCTION_ROLES.variant);
  if (decisions.delivery?.status === 'confirmed' && decisions.delivery.value === 'video') excluded.add(PRODUCTION_ROLES.draft);
  let next = Number(step) + 1;
  while (excluded.has(next)) next += 1;
  return next > LAST_STEP ? null : next;
}
export function commitSignoff(filmDir, { id, step, note, signature, main = null, variants = null, voice = null, decision = 'approved', reviewSha = null, advanced = undefined }) {
  const st = assertActiveProduction(filmDir), number = checkedStep(step, st.step), old = st.history.find(h => h.approvalId === id);
  if (old) {
    if (old.signature !== signature || old.step !== number || old.note !== note) throw new Error('同一批准对应的输入或结论发生变化，不一致，需核实当前审阅');
    return st;
  }
  let approved = st.approved || {};
  if (voice && decision === 'approved') approved = { ...approved, voice: { ...voice, approvalId: id } };
  if (main) approved = { ...approved, main, mainId: crypto.randomUUID() };
  if (variants) approved = { ...approved, variants: { ...approved.variants, ...Object.fromEntries(Object.entries(variants).map(([aspect, shots]) => [aspect, { shots, main: approved.main || null }])) } };
  const now = new Date().toISOString(), destination = decision === 'approved' ? Math.max(st.step, advanced === undefined ? number : (advanced ?? st.step)) : st.step;
  const next = { ...st, step: destination, approved, updated: now,
    history: [...st.history, { step: number, label: PRODUCTION_STEPS[number] || '', gate: REVIEW_GATES[number] || null, note, decision, reviewSha, sha: reviewSha, at: now, approvalId: id, signature }] };
  writeState(filmDir, next); return next;
}

const sameHashes = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);

/** 副版签批之后主版又在第 7 道签批过、且主版镜头哈希变了：副版过期，要重做第 8 道。没签批过的副版不算过期。 */
export function variantStale(st, aspect) {
  const v = st.approved?.variants?.[aspect];
  return !!v && !sameHashes(v.main, st.approved.main);
}

export const staleVariants = (st) => Object.keys(st.approved?.variants || {}).filter((a) => variantStale(st, a));

/** 同时列出新项目与历史档案；读取绝不迁移历史。 */
export function listProductions(projectDir = '.') {
  const films = path.resolve(projectDir, 'films');
  if (!fs.existsSync(films)) return [];
  return fs.readdirSync(films, { withFileTypes: true }).filter(d => d.isDirectory())
    .filter(d => ['.wka/state.json', ...HISTORY_FILES].some(f => fs.existsSync(path.join(films, d.name, f))))
    .map(d => {
      const dir = path.join(films, d.name), diagnostic = flowDiagnostic(dir);
      if (diagnostic) return { name: d.name, dir, title: d.name, style: '未读取', ...diagnostic };
      const identity = inspectProduction(dir), st = readProgress(dir), file = path.join(dir, 'film.json');
      const film = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { title: d.name, style: '未定' };
      const next = identity.readonly || st.step >= LAST_STEP ? null : st.step + 1;
      return { name: d.name, dir, title: film.title || d.name, style: film.style || '未定', flow: identity.flow,
        readonly: identity.readonly, flowLabel: identity.readonly ? '历史项目（只读）' : '九道制作流程',
        step: st.step, next, nextLabel: identity.readonly ? '历史留档，续作请新建项目' : next ? PRODUCTION_STEPS[next] : '已完成',
        last: st.history?.at(-1), updated: st.updated, migrated: false, staleVariants: identity.readonly ? [] : staleVariants(st) };
    });
}
