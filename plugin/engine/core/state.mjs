// 恢复在制项目：films/<片>/.wka/state.json 记录推进到第几道工序、每个审片节点的结论。
// 这个文件随片子一起进 git，换会话、隔几天再来，director 读它就能接着做。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicJson } from './evidence.mjs';

/** 15 道工序（与 skills/director/SKILL.md 一致） */
export const PRODUCTION_STEPS = {
  1: '制作环境、工程初始化、恢复在制项目',
  2: '制作简报确认',
  3: '美术定调',
  4: '剧本撰写',
  5: '分镜脚本',
  6: '人声素材来源',
  7: '声轨制作',
  8: '风格帧与动态分镜',
  9: '镜头制作',
  10: '字幕制作',
  11: '小样渲染与技术质检',
  12: '终版渲染与终混',
  13: '终检与交付',
  14: '改版',
  15: '剪映草稿交付',
};
/** 最后一道工序；签批到这里即全部完成 */
export const LAST_STEP = Math.max(...Object.keys(PRODUCTION_STEPS).map(Number));
/** 审片节点所在的工序 */
export const REVIEW_GATES = { 2: '①制作简报', 3: '②美术定调', 4: '③剧本', 5: '④分镜', 6: '⑤人声素材来源', 7: '⑥声轨审听', 8: '⑦风格帧与动态分镜', 10: '⑧字幕', 11: '⑨小样', 13: '⑩终审', 14: '⑪改版审片', 15: '⑫剪映草稿' };

/**
 * 进度文件的流程版本：1 = v0.4.0 及以前（没有字幕工序），2 = 第 11 道起为字幕制作，
 * 3 = 第 2 道起为审片节点「①制作简报」，4 = 第 14 道为改版、剪映草稿挪到第 15 道，
 * 5 = 字幕制作挪到第 10 道、小样挪到第 11 道
 */
const FLOW = 5;
/** flow 1 里第 11 道起的工序，在 flow 2 里都往后挪一位 */
const FLOW1_SHIFT_FROM = 11;
/** flow 3 及以前第 14 道起的工序（剪映草稿），在 flow 4 里往后挪一位 */
const FLOW3_SHIFT_FROM = 14;
/** flow 4 及以前的小样、字幕两道，在 flow 5 里互换 */
const FLOW4_SWAP = { 10: 11, 11: 10 };

const fileOf = (filmDir) => path.join(path.resolve(filmDir), '.wka', 'state.json');

function flowError(code, flow, stateFile = null) {
  const instruction = code === 'WKA_FLOW_TOO_NEW'
    ? '请升级到支持此流程的插件，再继续制作。'
    : '请核实进度文件并从可靠备份恢复；不会自动修复或覆盖。';
  return Object.assign(new Error(`${code}：工程流程 ${JSON.stringify(flow)}，当前支持 ${FLOW}${stateFile ? `；${stateFile}` : ''}。${instruction}`),
    { code, flow, supportedFlow: FLOW, stateFile, readonly: true, instruction });
}

function assertFlow(st, stateFile = null) {
  if (!st || typeof st !== 'object' || Array.isArray(st)) throw flowError('WKA_FLOW_INVALID', null, stateFile);
  const flow = Object.hasOwn(st, 'flow') ? st.flow : 1;
  if (!Number.isSafeInteger(flow) || flow < 1) throw flowError('WKA_FLOW_INVALID', flow, stateFile);
  if (flow > FLOW) throw flowError('WKA_FLOW_TOO_NEW', flow, stateFile);
  return flow;
}

/** 无副作用预检：缺文件是新片，缺 flow 是历史 1；其他读取失败不会当作新片。 */
export function assertCompatibleProgress(filmDir) {
  const file = fileOf(filmDir);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  let st;
  try { st = JSON.parse(raw); } catch { throw flowError('WKA_FLOW_INVALID', null, file); }
  assertFlow(st, file);
  return st;
}

/** 只将版本错误转成诊断；权限等 I/O 故障仍向上传递。 */
export function flowDiagnostic(filmDir) {
  try { assertCompatibleProgress(filmDir); return null; } catch (e) {
    if (!['WKA_FLOW_TOO_NEW', 'WKA_FLOW_INVALID'].includes(e.code)) throw e;
    return { compatible: false, code: e.code, flow: e.flow, supportedFlow: e.supportedFlow,
      stateFile: e.stateFile, readonly: true, error: e.message, instruction: e.instruction };
  }
}

export function assertProjectCompatible(projectDir) {
  const films = path.resolve(projectDir, 'films');
  if (!fs.existsSync(films)) return;
  for (const entry of fs.readdirSync(films, { withFileTypes: true })) {
    if (entry.isDirectory()) assertCompatibleProgress(path.join(films, entry.name));
  }
}

/**
 * 把旧流程的工序编号、节点标签换成新的。纯函数，不改入参。
 * @returns {{state: object, migrated: boolean}}
 */
export function migrateProgress(st) {
  const flow = assertFlow(st);
  if (st.flow === FLOW) return { state: st, migrated: false };
  // 按 flow 逐段平移编号：flow 1 → 2 第 11 道起 +1；flow 2 → 3 只换节点标签；flow 3 → 4 第 14 道起 +1；flow 4 → 5 第 10、11 道互换
  const shift = (step) => {
    const s2 = flow < 2 && step >= FLOW1_SHIFT_FROM ? step + 1 : step;
    return flow < 4 && s2 >= FLOW3_SHIFT_FROM ? s2 + 1 : s2;
  };
  const swap = (step) => (flow < 5 && FLOW4_SWAP[step]) || step;
  const history = (st.history || []).map((h) => {
    const step = swap(shift(h.step));
    return { ...h, step, label: PRODUCTION_STEPS[step] || '', gate: REVIEW_GATES[step] || null };
  });
  // 旧流程停在小样（第 10 道）的片子还没做字幕：退回第 9 道，下一步是新的第 10 道字幕
  const reached = shift(st.step || 0);
  const step = flow < 5 && reached === 10 ? 9 : reached;
  return { state: { ...st, flow: FLOW, step, history }, migrated: true };
}

function writeState(filmDir, st) {
  assertCompatibleProgress(filmDir);
  const f = fileOf(filmDir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  atomicJson(f,st);
}

/** 读进度；旧流程的进度会换算成新编号并写回，导演直接读文件时看到的也是新编号。 */
function loadProgress(filmDir) {
  const st = assertCompatibleProgress(filmDir);
  if (st === null) return { state: { flow: FLOW, step: 0, history: [] }, migrated: false };
  const r = migrateProgress(st);
  if (r.migrated) writeState(filmDir, r.state);
  return r;
}

export function readProgress(filmDir) {
  return loadProgress(filmDir).state;
}

/** 记录推进到第 step 步；note 写这一步的结论（例如用户签批了哪套视觉方案、提了什么返修意见）。 */
export function recordProgress(filmDir, { step, note = '', sha = null }) {
  const st = { ...readProgress(filmDir) };
  if (step) st.step = Math.max(st.step || 0, Number(step));
  st.history = [...st.history, { step: step ? Number(step) : st.step, label: PRODUCTION_STEPS[step] || '', gate: REVIEW_GATES[step] || null, note, sha, at: new Date().toISOString() }];
  st.updated = new Date().toISOString();
  writeState(filmDir, st);
  return st;
}

/**
 * 记录签批时的镜头哈希（进 git，换机器也能判断哪些镜头动过）：
 * - { main }：第 13 道终审，主版每镜的哈希 → approved.main
 * - { variant, shots }：第 14 道改版审片，副版每镜的哈希，连同当时的 approved.main → approved.variants[画幅]
 */
export function recordApproval(filmDir, { main = null, variant = null, shots = null }) {
  const st = readProgress(filmDir);
  const approved = st.approved || {};
  const next = main
    ? { ...approved, main, mainId: crypto.randomUUID() }
    : { ...approved, variants: { ...(approved.variants || {}), [variant]: { shots, main: approved.main || null } } };
  const out = { ...st, approved: next, updated: new Date().toISOString() };
  writeState(filmDir, out);
  return out;
}

/** 一个用户批准的工序历史和定稿身份一次写入；重试同一 id 不新增批准。 */
export function commitSignoff(filmDir,{id,step,note,signature,main=null,variants=null}) {
  const st=readProgress(filmDir),old=st.history.find(h=>h.approvalId===id);
  if(old){
    if(old.signature!==signature||old.step!==(step||st.step)||old.note!==note) throw new Error('同一批准对应的输入或结论发生变化，不一致，需核实当前审阅');
    return st;
  }
  let approved=st.approved||{};
  if(main) approved={...approved,main,mainId:crypto.randomUUID()};
  if(variants) approved={...approved,variants:{...approved.variants,...Object.fromEntries(Object.entries(variants).map(([aspect,shots])=>[aspect,{shots,main:approved.main||null}]))}};
  const now=new Date().toISOString(),next={...st,step:Math.max(st.step||0,step||0),approved,updated:now,history:[...st.history,{step:step||st.step,label:PRODUCTION_STEPS[step]||'',gate:REVIEW_GATES[step]||null,note,sha:null,at:now,approvalId:id,signature}]};
  writeState(filmDir,next);return next;
}

const sameHashes = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);

/** 副版签批之后主版又在第 13 道签批过、且主版镜头哈希变了：副版过期，要重做第 14 道。没签批过的副版不算过期。 */
export function variantStale(st, aspect) {
  const v = st.approved?.variants?.[aspect];
  return !!v && !sameHashes(v.main, st.approved.main);
}

export const staleVariants = (st) => Object.keys(st.approved?.variants || {}).filter((a) => variantStale(st, a));

/** 扫描项目里的所有片子，返回每支的进度；migrated 表示这次读取时换算过旧编号。
 *  只有 brief.md 的占位片（第 2 道建、第 3 道才 wka init）也列出，标题取目录名，风格「未定」。 */
export function listProductions(projectDir = '.') {
  const films = path.resolve(projectDir, 'films');
  if (!fs.existsSync(films)) return [];
  return fs
    .readdirSync(films, { withFileTypes: true })
    .filter((d) => d.isDirectory() && ['film.json', 'brief.md'].some((f) => fs.existsSync(path.join(films, d.name, f))))
    .map((d) => {
      const dir = path.join(films, d.name);
      const diagnostic = flowDiagnostic(dir);
      if (diagnostic) return { name: d.name, dir, title: d.name, style: '未读取', ...diagnostic };
      const filmFile = path.join(dir, 'film.json');
      const film = fs.existsSync(filmFile) ? JSON.parse(fs.readFileSync(filmFile, 'utf8')) : { title: d.name, style: '未定' };
      const { state: st, migrated } = loadProgress(dir);
      const last = st.history[st.history.length - 1];
      const next = st.step >= LAST_STEP ? null : st.step + 1;
      return { name: d.name, dir, title: film.title, style: film.style, step: st.step, next, nextLabel: next ? PRODUCTION_STEPS[next] : '已完成', last, updated: st.updated, migrated, staleVariants: staleVariants(st) };
    });
}
