// 影片目录布局（工程 flow 7）：所有产物位置集中在这里，别处不要再手写 'review'、'.cache/operations.json' 之类的路径。
import fs from 'node:fs';
import path from 'node:path';

export const FINAL_DIR = '成片';
export const REVIEW_DIR = 'review';
export const MATERIAL_DIR = '资料';
export const SCRIPTS_DIR = 'scripts';

const REVIEW_SECTIONS = [
  ['QC', /^(QC报告|时间轴检查|主版不变报告|异常帧)/],
  ['台词', /^(台词定位|逐词时间表|词级同步)/],
  ['声轨', /^(声轨|音效电平审计|草稿声音差异)/],
  ['素材', /^素材/],
  ['交付', /^(交付清单|最终交付|delivery-manifest)/],
  ['小样', /^(小样|局部小样|局部原画质|动态分镜|接触表)/],
  ['静帧', /^静帧/],
];

export const REVIEW_SECTION_NAMES = REVIEW_SECTIONS.map(([name]) => name);

/** 报告文件名 → review/ 下的子目录名；没有对应类别的留在 review/ 根（返回 ''）。 */
export function reviewSection(name) {
  const base = path.basename(name);
  return REVIEW_SECTIONS.find(([, pattern]) => pattern.test(base))?.[0] || '';
}

/** review/<类别>/<文件名>；ensure 为 true 时创建父目录。 */
export function reviewFile(filmDir, name, { ensure = false } = {}) {
  const file = path.join(path.resolve(filmDir), REVIEW_DIR, reviewSection(name), name);
  if (ensure) fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

/** 成片/<文件名>；ensure 为 true 时创建目录。 */
export function finalFile(filmDir, name, { ensure = false } = {}) {
  const file = path.join(path.resolve(filmDir), FINAL_DIR, name);
  if (ensure) fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

/** .wka/ 下的状态与证据文件（可版本管理，不随缓存清理）。 */
export const wkaFile = (filmDir, name) => path.join(path.resolve(filmDir), '.wka', name);
export const operationsFile = filmDir => wkaFile(filmDir, 'operations.json');
export const voiceSourcesFile = filmDir => wkaFile(filmDir, 'voice-sources.json');
export const mainCheckFile = filmDir => wkaFile(filmDir, 'main-check.json');
export const approvedDir = filmDir => wkaFile(filmDir, 'approved');
export const reviewNotesFile = filmDir => wkaFile(filmDir, 'review-notes.json');
