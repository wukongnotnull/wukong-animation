import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as delivery from '../../plugin/engine/core/delivery.mjs';
import { rememberArtifacts } from '../../plugin/engine/core/operations.mjs';

test('特殊路径链接可解析回真实文件，缺失/替换/改源不交作当前文件',t=>{
  assert.equal(typeof delivery.deliveryReport,'function');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'动画 (项目) #%-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify({title:'film',style:'ink-wash',size:[160,90],fps:10,seed:1,shots:[{id:'s01',file:'shots/s01.js',duration:1}]}));
  const file=path.join(dir,'对白 [中] #%.srt');fs.writeFileSync(file,'字幕');
  rememberArtifacts(dir,{stage:'review:subtitles',aspect:'16:9',signature:'sig',outputs:[file],value:file});
  let report=delivery.deliveryReport(dir,{host:'codex'});
  const item=report.items.find(i=>i.path===file);assert.equal(item.status,'current');
  const target=/<([^>]+)>/.exec(item.link)[1];assert.equal(fs.readFileSync(decodeURIComponent(target),'utf8'),'字幕');
  assert.equal(item.openStatus,'not-tested');
  fs.writeFileSync(path.join(dir,'.cache/active-command.json'),JSON.stringify({argv:['final',dir]}));
  const incomplete=delivery.deliveryReport(dir,{host:'codex'});
  assert.equal(incomplete.ok,false,'生成了其他文件不能掩盖 final 必需视频缺失');
  assert.ok(incomplete.errors.some(e=>e.includes('out.mp4')));
  fs.rmSync(path.join(dir,'.cache/active-command.json'));
  fs.writeFileSync(file,'用户手改');report=delivery.deliveryReport(dir,{host:'codex'});assert.equal(report.ok,false);assert.equal(report.links.length,0);
  fs.rmSync(file);report=delivery.deliveryReport(dir,{host:'codex'});assert.equal(report.items[0].status,'missing');
});

test('明确制作决定校验与实际配置冲突，不推断缺省选择',t=>{
  assert.equal(typeof delivery.readDecisions,'function');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-decisions-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'.wka'));
  assert.equal(delivery.readDecisions(dir).delivery.status,'unknown');
  const file=path.join(dir,'.wka/decisions.json');
  fs.writeFileSync(file,JSON.stringify({version:1,delivery:{status:'confirmed',value:'video-and-draft',source:'已批准简报四、交付'}}));
  assert.equal(delivery.readDecisions(dir).delivery.value,'video-and-draft');
  fs.writeFileSync(file,'{ invalid');assert.throws(()=>delivery.readDecisions(dir),/decisions.json/);
});

test('generic delivery returns a real path and explicit unverified preview without inventing a link',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka generic 中 #% '));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify({title:'film',style:'ink-wash',size:[160,90],fps:10,seed:1,shots:[{id:'s01',file:'shots/s01.js',duration:1}]}));
 const file=path.join(dir,'字幕 #%.srt');fs.writeFileSync(file,'字幕');
 rememberArtifacts(dir,{stage:'review:subtitles',aspect:'16:9',signature:'sig',outputs:[file],value:file});
 const report=delivery.deliveryReport(dir,{host:'generic'}),item=report.items.find(i=>i.path===file);
 assert.equal(item.previewStatus,'unverified');assert.equal(item.path,file);assert.equal(item.link,undefined);assert.deepEqual(report.links,[]);
 fs.unlinkSync(file);assert.equal(delivery.deliveryReport(dir,{host:'generic',required:[file]}).ok,false);
});
