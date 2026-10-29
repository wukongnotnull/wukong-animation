import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as review from '../../plugin/engine/core/review-evidence.mjs';
import { fileDigest } from '../../plugin/engine/core/evidence.mjs';

test('实际审听范围、来源失效；QC人工接受不改变原测量和硬门槛',t=>{
  assert.equal(typeof review.audioReview,'function');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-review-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const mix=path.join(dir,'mix.wav');fs.writeFileSync(mix,'fixed-source');
  const hash=fileDigest(mix),notes={version:1,audio:{sha256:hash,sections:[{id:'a',label:'开场',range:[0,10]},{id:'b',label:'变化',range:[10,20]},{id:'c',label:'收束',range:[20,30]}],checks:[]}};
  let result=review.audioReview({mix,duration:30,notes});assert.ok(result.windows.some(w=>w.range[0]===0&&w.range[1]===15));assert.equal(result.status,'not-listened');
  notes.audio.checks=[{section:'opening',range:[0,15],reviewer:'制作者',reviewedAt:'2026-10-29T10:00:00Z',verdict:'accepted',note:'已听，鼓点随人声进入后减少',evidence:'实际播放声轨0至15秒'}];
  result=review.audioReview({mix,duration:30,notes});assert.equal(result.windows.find(w=>w.id==='opening').status,'accepted');
  fs.writeFileSync(mix,'changed');result=review.audioReview({mix,duration:30,notes});assert.equal(result.status,'stale');
  const issues=[{kind:'闪烁',shot:'s01',t0:1,t1:2,msg:'diff 40'}, {kind:'时间轴',shot:'s01',t0:0,t1:0,msg:'wrong frames'}];
  const first=review.qcReview(issues,{source:'video-a',cfg:{fps:10},notes:{}});
  const accepts=first.issues.map(i=>({finding:i.id,disposition:'accepted',range:[i.t0,i.t1],reviewer:'制作者',reviewedAt:'2026-10-29T10:00:00Z',reason:'核对抽帧为转场设计',evidence:'实际打开本段前后帧'}));
  const after=review.qcReview(issues,{source:'video-a',cfg:{fps:10},notes:{qc:accepts}});
  assert.equal(after.machineOk,false);assert.equal(after.accepted.length,1);assert.equal(after.unresolved.length,1);assert.equal(after.issues[0].msg,'diff 40');
  accepts[1].disposition='needs-fix';
  const fix=review.qcReview(issues,{source:'video-a',cfg:{fps:10},notes:{qc:accepts}});
  assert.equal(fix.needsFix.length,1,'硬错误可标记需修复，但不能接受为通过');assert.equal(fix.machineOk,false);
  const stale=review.qcReview(issues,{source:'video-b',cfg:{fps:10},notes:{qc:accepts}});assert.equal(stale.accepted.length,0);assert.equal(stale.staleNotes.length,2);
});
