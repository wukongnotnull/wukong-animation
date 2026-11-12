import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ops from '../../plugin/engine/core/operations.mjs';

test('阶段完整才复用，缺失/替换补做，失败不沿用；中断保留准确阶段',async t=>{
  assert.equal(typeof ops.runStage,'function');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-ops-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  initializeProduction(dir);
  const out=path.join(dir,'声音 文件.wav');let calls=0;
  const options={stage:'encode:mp4',aspect:'16:9',signature:'a',log:()=>{},run:async()=>{calls++;fs.writeFileSync(out,'media');return {outputs:[out],value:out};}};
  assert.equal(await ops.runStage(dir,options),out);
  assert.equal(await ops.runStage(dir,options),out);assert.equal(calls,1);
  fs.writeFileSync(out,'changed');await ops.runStage(dir,options);assert.equal(calls,2);
  fs.rmSync(out);await ops.runStage(dir,options);assert.equal(calls,3);
  await assert.rejects(ops.runStage(dir,{...options,signature:'b',run:async()=>{throw Error('encoding failed');}}),/encoding failed/);
  const status=ops.recoveryStatus(dir);assert.equal(status.stages[0].status,'failed');
  await ops.runStage(dir,options);assert.equal(calls,4);
  const unlock=ops.lockProduction(dir);
  assert.throws(()=>ops.lockProduction(dir),/正在|忙/);unlock();ops.lockProduction(dir)();
});

test('写入锁：活着的持有者最多等待指定时间，超时报错并说明持有者；释放后等待方取得锁',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-lock-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  initializeProduction(dir);
  const release=ops.lockProduction(dir);
  const begin=Date.now();
  assert.throws(()=>ops.lockProduction(dir,{waitMs:400}),new RegExp(`pid ${process.pid}.*已等待`));
  assert.ok(Date.now()-begin>=350);
  release();
  const { spawn }=await import('node:child_process');
  const opsUrl=new URL('../../plugin/engine/core/operations.mjs',import.meta.url).href;
  const child=spawn(process.execPath,['--input-type=module','-e',`import {lockProduction} from ${JSON.stringify(opsUrl)};const r=lockProduction(${JSON.stringify(dir)});console.log('held');setTimeout(()=>{r();},700);`],{stdio:['ignore','pipe','inherit']});
  await new Promise(resolve=>child.stdout.once('data',resolve));
  const waited=Date.now();
  const unlock=ops.lockProduction(dir,{waitMs:5000});
  assert.ok(Date.now()-waited>=300);unlock();
  await new Promise(resolve=>child.on('exit',resolve));
});
