// jianying 导出器：按时间线生成剪映专业版草稿，直接写进剪映草稿目录（不写片目录）。
// 草稿由 write_draft.py 借 pyJianYingDraft 写出；这里负责前置检查、换算计划和日志。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDraftPlan } from './plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY_DEP = 'pyJianYingDraft==0.3.1';
const DEFAULT_ROOT = path.join(os.homedir(), 'Movies/JianyingPro/User Data/Projects/com.lveditor.draft');

function draftsRoot() {
  const root = process.env.WKA_JIANYING_DRAFTS || DEFAULT_ROOT;
  if (!fs.existsSync(root)) {
    throw new Error(`找不到剪映草稿目录：${root}\n  在剪映「全局设置 → 草稿位置」查看实际路径，再设置环境变量 WKA_JIANYING_DRAFTS`);
  }
  return root;
}

function checkPython() {
  const r = spawnSync('python3', ['-c', 'import pyJianYingDraft'], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`导出剪映草稿需要 python3 + pyJianYingDraft：pip install ${PY_DEP}`);
}

export async function encodeOutput({ out, proxy, timeline }) {
  if (proxy) throw new Error('剪映草稿用于后期接着剪，不能用预览（--proxy）素材导出，请去掉 --proxy');
  if (!timeline) throw new Error('jianying 导出器需要时间线，请用 wka final 导出');
  const root = draftsRoot();
  const plan = buildDraftPlan(timeline);
  const draftDir = path.join(root, plan.name);
  if (fs.existsSync(draftDir)) throw new Error(`剪映草稿「${plan.name}」已存在：${draftDir}\n  为免覆盖你在剪映里的改动，请先在剪映里删除或改名后再导出`);
  checkPython();

  const planFile = path.join(path.dirname(out), '.cache', 'work', 'jianying-plan.json');
  fs.mkdirSync(path.dirname(planFile), { recursive: true });
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
  const r = spawnSync('python3', [path.join(HERE, 'write_draft.py'), planFile, root], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`写剪映草稿失败：\n${(r.stderr || r.error?.message || '').trim()}`);

  const estimated = plan.subtitles.filter((s) => s.estimated).map((s) => `「${s.text}」`);
  if (estimated.length) console.log(`  ! 以下字幕没有人声音频，时长为估算值：${estimated.join('、')}`);
  console.log('  · 草稿未做响度标准化和结尾淡出，请在剪映里用「响度统一」和淡出处理');
  console.log('  · 剪映里看不到新草稿时，重启剪映');
  return draftDir;
}
