import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ops from '../../plugin/engine/core/operations.mjs';

test('阶段完整才复用，缺失/替换补做，失败不沿用；中断保留准确阶段',async t=>{
  assert.equal(typeof ops.runStage,'function');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wka-ops-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
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
