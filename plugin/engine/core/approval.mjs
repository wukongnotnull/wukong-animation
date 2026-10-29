// 主版不变证明：第 13 道签批时存主版每镜的定稿快照；做副版（第 14 道）时，
// 主版哈希变了的镜头重渲后与快照逐帧比 PSNR，写成「主版不变报告」交审片节点 ⑪。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ShotCache } from './cache.mjs';
import { ensureDir } from './paths.mjs';
import { loadFilm, render, shotHashes, mainCheckConditions } from './job.mjs';
import { readProgress } from './state.mjs';
import { digest, fileEvidence, atomicJson, readJson } from './evidence.mjs';
import { fileURLToPath } from 'node:url';
import { buildFrameTimeline, inspectVideo } from './timing.mjs';

/** 逐帧画面差异的下限：每帧 PSNR 都高于它，就算画面没变 */
export const PSNR_PASS = 50;

const frameCount = (file) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`读不出帧数：${file}\n${r.stderr}`);
  return Number.parseInt(r.stdout, 10);
};

/** 两段视频逐帧 PSNR 的最小值（dB）；完全相同为 Infinity，帧数不同为 0（镜头长度变了，画面一定变了）。 */
export async function psnrMin(a, b) {
  if (frameCount(a) !== frameCount(b)) return 0;
  // 统计文件写在临时目录里、用相对路径：滤镜参数里不出现盘符冒号和反斜杠（Windows 路径），不用转义
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-psnr-'));
  try {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path.resolve(a), '-i', path.resolve(b), '-lavfi', 'psnr=stats_file=psnr.log', '-f', 'null', '-'], { cwd: work, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`PSNR 比对失败：${a} ↔ ${b}\n${String(r.stderr).slice(-800)}`);
    const values = fs.readFileSync(path.join(work, 'psnr.log'), 'utf8').split('\n').flatMap((line) => {
      const m = /psnr_avg:(\S+)/.exec(line);
      return m ? [m[1] === 'inf' ? Infinity : Number(m[1])] : [];
    });
    if (!values.length) throw new Error(`PSNR 比对没有读到任何帧：${a} ↔ ${b}`);
    return Math.min(...values);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const SNAPSHOT_DIR = (filmDir) => path.join(path.resolve(filmDir), '.cache', 'approved');

/**
 * 第 13 道签批时调用：主版每镜复制一份定稿快照到 .cache/approved/（不进 git），返回每镜哈希。
 * 还没按当前代码渲染过全分辨率的镜头没有快照，列在 missing 里。
 */
export function snapshotMain(filmDir, { log = console.log } = {}) {
  const hashes = shotHashes(filmDir);
  const cache = new ShotCache(path.resolve(filmDir));
  const dir = SNAPSHOT_DIR(filmDir);
  const next=dir+'.next',backup=dir+'.previous';
  if(!fs.existsSync(dir)&&fs.existsSync(backup)) fs.renameSync(backup,dir);
  fs.rmSync(next,{recursive:true,force:true});ensureDir(next);
  const missing = [];
  for (const [id, hash] of Object.entries(hashes)) {
    const hit = cache.lookup(id, hash);
    if (hit) fs.copyFileSync(hit, path.join(next, `${id}.mp4`));
    else missing.push(id);
  }
  if (missing.length) log(`  ! ${missing.join('、')} 还没按当前代码渲染全分辨率，没存下定稿快照；做副版时这几镜要目视复核主版（先 wka final 再签批可避免）`);
  else log(`  ✓ 主版定稿快照 ${Object.keys(hashes).length} 镜 → .cache/approved/`);
  if(!missing.length){
    fs.rmSync(backup,{recursive:true,force:true});
    if(fs.existsSync(dir)) fs.renameSync(dir,backup);
    try {fs.renameSync(next,dir);}catch(e){if(fs.existsSync(backup))fs.renameSync(backup,dir);throw e;}
    fs.rmSync(backup,{recursive:true,force:true});
  }else fs.rmSync(next,{recursive:true,force:true});
  return { hashes, missing };
}

const RESULT = { same: '哈希相同', pass: '重渲比对通过', fail: '画面有变化', missing: '快照缺失，需目视复核' };
const fmt = (p) => (p === null ? '—' : p === Infinity || p === 'inf' ? 'inf' : `${p.toFixed(1)} dB`);

function reportText(aspect, rows) {
  const failed = rows.filter((r) => r.result === 'fail').map((r) => r.id);
  const missing = rows.filter((r) => r.result === 'missing').map((r) => r.id);
  const verdict = failed.length
    ? `✗ 主版有变化：${failed.join('、')}。先请用户在第 13 道重新审主版，再交副版。`
    : missing.length
      ? `! ${missing.join('、')} 的定稿快照缺失，没法逐帧比对，请目视复核这几镜的主版。`
      : '✓ 主版画面没有变化。';
  return [
    `# 主版不变报告 · ${aspect} 副版`,
    '',
    verdict,
    '',
    `主版镜头哈希与第 13 道签批时相同即不变；哈希变了的镜头重渲后与定稿快照逐帧比对，每帧 PSNR 高于 ${PSNR_PASS} dB 算不变。`,
    '',
    '| 镜头 | 结果 | 最低 PSNR |',
    '|---|---|---|',
    ...rows.map((r) => `| ${r.id} | ${RESULT[r.result]} | ${fmt(r.psnr)} |`),
    '',
  ].join('\n');
}

/**
 * 做副版前调用：比对主版与第 13 道签批时的定稿，写「主版不变报告」到 review/。
 * 主版还没签批过、或处理的就是主版时返回 null。比对不通过不中断，只在报告和日志里写明。
 */
export async function checkMainUnchanged(filmDir, { aspect, log = console.log } = {}) {
  const { variant } = loadFilm(filmDir, { aspect });
  if (variant.isMain) return null;
  const callerLog=log,mainAspect=loadFilm(filmDir).variant.aspect;
  log=message=>callerLog(`[${mainAspect} 主版高清 · main-check；准备 ${variant.aspect} 副版] ${message}`);
  const progress=readProgress(filmDir),approved=progress.approved?.main;
  const pending=readJson(path.join(path.resolve(filmDir),'.wka/pending-approval.json'));
  if(pending&&pending.step===13&&pending.status!=='completed') throw new Error('主版批准仍待存档，请先恢复原 signoff 命令');
  if (!approved) { log('  ! 主版还没在第 13 道签批，跳过主版不变比对'); return null; }
  const ctx=loadFilm(filmDir),current=shotHashes(filmDir),native=buildFrameTimeline(ctx.shots,ctx.film.fps);
  const ids=[...new Set([...Object.keys(approved),...Object.keys(current)])];
  const cache=new ShotCache(ctx.filmDir),proofFile=path.join(ctx.filmDir,'.cache/main-check.json');
  const conditions=mainCheckConditions(filmDir);
  const probe=(id,file)=>{
    const shot=native.shots.find(s=>s.id===id);
    if(!shot || !fs.existsSync(file)) return null;
    const info=inspectVideo(file,{fps:ctx.film.fps,frames:shot.frames});
    const size=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0',file],{encoding:'utf8'});
    const dimensions=size.stdout.trim().split(',').map(Number);
    try { return {...fileEvidence(file),frames:info.frames,fps:info.fps,dimensions,valid:info.ok&&dimensions[0]===ctx.film.size[0]&&dimensions[1]===ctx.film.size[1]}; }
    catch(e) {return {file,valid:false,error:e.message};}
  };
  const collect=()=>ids.map(id=>({id,snapshot:probe(id,path.join(SNAPSHOT_DIR(filmDir),`${id}.mp4`)),segment:current[id]?probe(id,cache.lookup(id,current[id])||''):null}));
  let files=collect();
  const keyOf=()=>digest({version:1,validator:fileEvidence(fileURLToPath(import.meta.url)).sha256,threshold:PSNR_PASS,conditions,current,approved,identity:progress.approved.mainId||digest(approved),files});
  let key=keyOf();
  const previous=readJson(proofFile);
  const reusable=conditions&&previous?.version===1&&previous.key===key&&previous.ok===true&&files.every(f=>f.snapshot?.valid&&f.segment?.valid);
  const checkedAt=new Date().toISOString();
  let rows=[],timingChanged=false,verifiedAt=checkedAt,reused=false;
  if(reusable) { rows=previous.rows;verifiedAt=previous.verifiedAt;reused=true;log('  ✓ 主版验证命中：复用完整成功证明，跳过主版渲染/PSNR'); }
  else {
    // 进入新检查即清掉旧通过记录；失败/异常不能留作下一次成功依据。
    fs.rmSync(proofFile,{force:true});
    timingChanged=files.some(f=>f.snapshot&&!f.snapshot.valid);
    const structure=Object.keys(current).join('|')!==Object.keys(approved).join('|');
    const changed=ids.filter(id=>current[id]!==approved[id]);
    if(timingChanged) log('  ! 已签批主版帧长/帧率/尺寸变化，不自动重渲主版；原快照保留');
    if(changed.length&&!timingChanged&&!structure) {
      log('  · 主版重新比对：渲染变化输入，不代表重新签批');
      await render(filmDir,{log});
      // render 更新 manifest；同一实例不自动刷新，重新读取。
      cache.data=new ShotCache(ctx.filmDir).data;
      files=collect();key=keyOf();
    }
    for(const f of files) {
      if(structure) {rows.push({id:f.id,result:'fail',psnr:null,reason:'镜头集合或顺序变化'});continue;}
      if(!f.snapshot) {rows.push({id:f.id,result:'missing',psnr:null});continue;}
      if(!f.snapshot.valid||!f.segment?.valid) {rows.push({id:f.id,result:'fail',psnr:null,reason:'定稿或当前片段无效'});continue;}
      if(current[f.id]===approved[f.id]&&f.snapshot.sha256===f.segment.sha256) {rows.push({id:f.id,result:'same',psnr:null});continue;}
      try {
        const psnr=await psnrMin(f.snapshot.file,f.segment.file);
        rows.push({id:f.id,result:psnr>PSNR_PASS?'pass':'fail',psnr:psnr===Infinity?'inf':psnr});
      }catch(e){rows.push({id:f.id,result:'fail',psnr:null,reason:e.message});}
    }
  }
  const ok=rows.every(r=>r.result==='same'||r.result==='pass');
  const result={version:1,ok,key,reused,checkedAt,verifiedAt,timingChanged,rows};
  if(ok&&conditions&&!reused) atomicJson(proofFile,result);
  const file=path.join(ensureDir(path.join(ctx.filmDir,'review')),variant.review('主版不变报告.md'));
  atomicJson(file.replace(/\.md$/,'.json'),result);
  fs.writeFileSync(file,reportText(variant.aspect,rows)+`\n检查：${checkedAt}；原测量：${verifiedAt}；复用：${reused?'是':'否'}。范围：主版镜头画面，不含声音/字幕。\n`);
  log(`${ok?'  ✓ 主版画面没有变化':'  ! 主版不变比对有问题'}：${file}`);
  return {...result,file};
}
