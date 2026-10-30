import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = new URL('../../tools/test-jianying.mjs', import.meta.url).href;
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-required-tests-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const execute = source => {
    const wrapper = path.join(dir, 'runner.mjs'); fs.writeFileSync(wrapper, source);
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, [wrapper], { encoding: 'utf8', env });
  };
  return { dir, execute };
}

const cases = {
  pass: "import {test} from 'node:test'; test('real pass',()=>{});",
  fail: "import {test} from 'node:test'; test('real failure',()=>{throw Error('fixture failure')});",
  skip: "import {test} from 'node:test'; test('unavailable',{skip:'dependency missing'},()=>{});",
  todo: "import {test} from 'node:test'; test.todo('unfinished');",
  cancelled: "import {test} from 'node:test'; test('unfinished async',()=>new Promise(()=>{}));",
  empty: '',
  emptySuite: "import {describe} from 'node:test'; describe('empty suite',()=>{});",
  importFailure: "throw Error('broken import');",
  earlyExit: 'process.exit(7);',
  missing: null,
};
for (const [kind, source] of Object.entries(cases)) test(`required runner rejects ${kind} unless real tests pass`, t => {
  const { dir, execute } = fixture(t), file = path.join(dir, 'case.test.mjs');
  if (source !== null) fs.writeFileSync(file, source);
  const r = execute(`import {runRequiredTests} from ${JSON.stringify(runner)};
try { const report=await runRequiredTests([${JSON.stringify(file)}],{log:()=>{},timeout:1000});console.log(JSON.stringify(report));process.exitCode=report.ok?0:1; }
catch(e){console.error(e.message);process.exitCode=1;}`);
  assert.equal(r.status, kind === 'pass' ? 0 : 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND|does not provide an export/);
  if (kind !== 'missing') {
    const report = JSON.parse(r.stdout);
    assert.equal(report.ok, kind === 'pass');
    if (['pass', 'skip', 'todo', 'cancelled'].includes(kind)) assert.equal(report[kind === 'pass' ? 'passed' : kind === 'skip' ? 'skipped' : kind], 1);
    if (['empty', 'emptySuite'].includes(kind)) assert.equal(report.files[0].tests, 0);
  }
});

test('each required file must execute tests, even when another file passes', t => {
  const { dir, execute } = fixture(t), files = ['pass', 'empty'].map(name => path.join(dir, name + '.test.mjs'));
  files.forEach((f, i) => fs.writeFileSync(f, i ? '' : cases.pass));
  const r = execute(`import {runRequiredTests} from ${JSON.stringify(runner)};const report=await runRequiredTests(${JSON.stringify(files)},{log:()=>{}});console.log(JSON.stringify(report));process.exitCode=report.ok?0:1;`);
  assert.equal(r.status, 1, r.stdout + r.stderr); assert.equal(JSON.parse(r.stdout).files[1].tests, 0);
});

test('preflight rejects missing tools, unsupported Python, wrong package, and broken browser', t => {
  const { execute } = fixture(t);
  const r = execute(`import assert from 'node:assert/strict';import {preflight} from ${JSON.stringify(runner)};
const good=JSON.stringify({python:[3,11,0],pyJianYingDraft:'0.3.1'});
for(const bad of ['missing','python','package','browser']) {
  const run=(cmd)=>({status:bad==='missing'?1:0,stdout:cmd==='python3'?(bad==='python'?JSON.stringify({python:[3,7],pyJianYingDraft:'0.3.1'}):bad==='package'?JSON.stringify({python:[3,11],pyJianYingDraft:'0.3.0'}):good):'version',stderr:'unavailable'});
  await assert.rejects(preflight({run,browserCheck:async()=>{if(bad==='browser')throw Error('browser unavailable');}}));
}
await preflight({run:cmd=>({status:0,stdout:cmd==='python3'?good:'version'}),browserCheck:async()=>{}});`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('CLI fails in an isolated environment with no dependency executables', t => {
  const { dir } = fixture(t), env = { ...process.env, PATH: dir }; delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [fileURLToPath(runner)], { encoding: 'utf8', env });
  assert.equal(r.status, 1); assert.match(r.stderr, /预检失败.*(python3|ffmpeg)/s);
  assert.doesNotMatch(r.stdout, /PASS|"ok":true/);
});
