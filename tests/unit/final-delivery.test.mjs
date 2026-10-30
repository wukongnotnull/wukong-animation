import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as delivery from '../../plugin/engine/core/delivery.mjs';

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'最终交付 [中] #% '));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'.wka'));fs.mkdirSync(path.join(dir,'shots'));
  fs.writeFileSync(path.join(dir,'shots/s01.js'),'function draw() {}');
  fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify({title:'film',style:'ink-wash',size:[160,90],fps:10,seed:1,shots:[{id:'s01',file:'shots/s01.js',duration:1}],export:{name:'影片',formats:['mp4','jianying']}}));
  fs.writeFileSync(path.join(dir,'.wka/decisions.json'),JSON.stringify({version:1,...Object.fromEntries(Object.entries({delivery:'video-and-draft',aspects:['16:9'],subtitles:{mode:'none',bilingual:false}}).map(([k,value])=>[k,{status:'confirmed',value,source:'用户明确确认'}]))}));
  return dir;
}

test('A1/A2 final contract ignores last command and review clutter; query is read-only',t=>{
  assert.equal(typeof delivery.finalDeliveryReport,'function','最终交付尚无独立入口');
  const dir=fixture(t);fs.mkdirSync(path.join(dir,'review'));
  for(let n=0;n<2044;n++)fs.writeFileSync(path.join(dir,'review',`抽帧-${n}.png`),'历史');
  fs.mkdirSync(path.join(dir,'.cache'));fs.writeFileSync(path.join(dir,'.cache/active-command.json'),JSON.stringify({argv:['final',dir,'--formats','jianying']}));
  const before=fs.readdirSync(dir,{recursive:true});
  const report=delivery.finalDeliveryReport(dir);
  assert.equal(report.version,2);assert.equal(report.ok,false);
  assert.deepEqual(report.items.map(i=>i.slot),['16:9/video/mp4/clean','16:9/draft/jianying']);
  assert.equal(report.audit.files.length,2044);
  assert.deepEqual(fs.readdirSync(dir,{recursive:true}),before);
  assert.equal(fs.existsSync(path.join(dir,'.wka/final-delivery.json')),false);
});
