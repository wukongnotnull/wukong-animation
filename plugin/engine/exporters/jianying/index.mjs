// jianying 导出器：按时间线生成剪映专业版草稿，直接写进剪映草稿目录（不写片目录）。
// 草稿由 write_draft.py 借 pyJianYingDraft 写出；这里负责前置检查、换算计划和日志。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDraftPlan } from './plan.mjs';
import { freeDraftName, jianyingRunning } from './guards.mjs';
import { detectSoundRanges } from './silence.mjs';
import { probeDuration } from '../../core/ffmpeg.mjs';
import crypto from 'node:crypto';
import { atomicJson, readJson, digest, fileDigest, treeEvidence } from '../../core/evidence.mjs';

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

export async function encodeOutput({ out, proxy, timeline, force=false }) {
  if (proxy) throw new Error('剪映草稿用于后期接着剪，不能用预览（--proxy）素材导出，请去掉 --proxy');
  if (!timeline) throw new Error('jianying 导出器需要时间线，请用 wka final 导出');
  const root = draftsRoot();
  // 每段用户录音完整保留，不按台词重复混入；其余音轨只放有声音的片段
  const tracks = timeline.tracks.map((t) => (t.role === 'voice' ? t : { ...t, ranges: detectSoundRanges(t.file, probeDuration(t.file)) }));
  const base = buildDraftPlan({ ...timeline, tracks });
  const signature=digest({root,base,files:[...timeline.shots,...tracks].map(t=>[t.file,fileDigest(t.file)]),writer:treeEvidence(HERE)});
  const receiptFile=path.join(path.dirname(out),'.wka/export-receipts',signature+'.json');
  const previous=readJson(receiptFile);
  if(!force&&previous&&fs.existsSync(previous.path)) {
    const marker=readJson(path.join(previous.path,'.wka-complete.json'));
    const entries=treeEvidence(previous.path,rel=>rel==='.wka-complete.json');
    if(marker?.operation===previous.operation&&marker.signature===signature&&digest(marker.entries)===digest(entries)){
      atomicJson(receiptFile,{...previous,status:'completed',outputs:entries});
      console.log(`  · 草稿完成回执核实，复用：${previous.path}`);return previous.path;
    }
    if(marker||previous.status==='completed') throw new Error(`user-modified：用户可能已修改草稿或素材缺失，保留原目录，请明确另导新版时使用 --force：${previous.path}`);
    const owner=readJson(path.join(previous.path,'.wka-owner.json'));
    if(owner?.operation===previous.operation) fs.rmSync(previous.path,{recursive:true,force:true});
    else throw new Error(`needs-review：无法核实本次草稿是否完整，不自动重导或清理：${previous.path}`);
  }
  if (jianyingRunning()) {
    throw new Error('剪映正在运行。剪映退出时会把内存里的旧草稿写回草稿目录，覆盖这次导出的内容。\n  请先完全退出剪映（⌘Q），再重新运行 wka final <片目录> --formats jianying');
  }
  checkPython();
  // 同名草稿已存在时换个新名字，旧草稿和用户在剪映里的改动都不动
  const operation=crypto.randomUUID();
  const plan = { ...base, name: freeDraftName(root, base.name),wka_operation:operation,wka_signature:signature };
  const draftDir = path.join(root, plan.name);
  atomicJson(receiptFile,{version:1,operation,signature,path:draftDir,status:'prepared'});
  if (plan.name !== base.name) console.log(`  · 剪映里已有草稿「${base.name}」，这次导出为「${plan.name}」，旧草稿没动`);

  const planFile = path.join(path.dirname(out), '.cache', 'work', 'jianying-plan.json');
  fs.mkdirSync(path.dirname(planFile), { recursive: true });
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
  const r = spawnSync('python3', [path.join(HERE, 'write_draft.py'), planFile, root], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`写剪映草稿失败：\n${(r.stderr || r.error?.message || '').trim()}`);
  const marker=readJson(path.join(draftDir,'.wka-complete.json'));
  if(marker?.operation!==operation || digest(marker.entries)!==digest(treeEvidence(draftDir,rel=>rel==='.wka-complete.json'))) throw new Error(`草稿完成回执无效：${draftDir}`);
  atomicJson(receiptFile,{version:1,operation,signature,path:draftDir,status:'completed',outputs:marker.entries});

  console.log('  · 草稿未做整体响度标准化，请按声音差异报告在剪映里核对');
  console.log('  · 剪映里看不到新草稿时，重启剪映');
  return draftDir;
}
