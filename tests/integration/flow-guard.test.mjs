import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadFilm, writeReview } from '../../plugin/engine/core/job.mjs';
import { runStage, rememberArtifacts, lockProduction, recoveryStatus } from '../../plugin/engine/core/operations.mjs';
import { writeDelivery } from '../../plugin/engine/core/delivery.mjs';
import { writeFinalDelivery, recordFinalEvidence, recordFinalArtifact, commitFinalApproval } from '../../plugin/engine/core/final-delivery.mjs';
import { initProject, commitSnapshot } from '../../plugin/engine/core/project.mjs';

const cli = fileURLToPath(new URL('../../plugin/engine/bin/wka.mjs', import.meta.url));
function fixture(t, flow = 6) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-flow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'films/future'), file = path.join(dir, '.wka/state.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = JSON.stringify({ flow, step: 60, history: [{ step: 60, label: 'future', note: 'keep' }], approved: { mainId: 'keep' } }, null, 3);
  fs.writeFileSync(file, raw); fs.writeFileSync(path.join(dir, 'brief.md'), '# Future');
  const env = { ...process.env, WUKONG_ANIMATION_HOME: path.join(root, 'home'), WKA_JIANYING_DRAFTS: path.join(root, 'external-drafts') };
  const run = (args, preload = null) => spawnSync(process.execPath, [...(preload ? ['--import', preload] : []), cli, ...args], { encoding: 'utf8', env });
  return { root, dir, file, raw, run };
}

test('resume gives structured read-only flow diagnostics, never a rerun instruction', t => {
  const f = fixture(t), result = f.run(['resume', f.dir, '--json']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.code, 'WKA_FLOW_TOO_NEW'); assert.equal(status.flow, 6);
  assert.equal(status.supportedFlow, 5); assert.equal(status.stateFile, f.file); assert.equal(status.readonly, true);
  assert.match(status.instruction, /升级/); assert.equal('next' in status, false); assert.equal('stages' in status, false);
  const plain = f.run(['resume', f.dir]);
  assert.equal(plain.status, 1); assert.match(plain.stdout, /WKA_FLOW_TOO_NEW.*升级/);
  assert.doesNotMatch(plain.stdout, /按原命令重跑|补做/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), f.raw);
});

function snapshot(root) {
  return fs.readdirSync(root, { recursive: true }).sort().map(rel => {
    const file = path.join(root, rel), st = fs.lstatSync(file);
    return [rel, st.mode, st.isDirectory() ? 'directory' : fs.readFileSync(file).toString('base64')];
  });
}

for (const withArtifacts of [false, true]) test(`every production command rejects before side effects (existing artifacts: ${withArtifacts})`, t => {
  const f = fixture(t);
  if (withArtifacts) for (const rel of ['.cache/operations.json', '.cache/active-command.json', 'review/notes.md', '.wka/pending-approval.json']) {
    const file = path.join(f.dir, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'sentinel');
  }
  if (withArtifacts) {
    fs.mkdirSync(path.join(f.dir, 'shots'));
    fs.writeFileSync(path.join(f.dir, 'shots/s01.js'), 'wk.shot({render(){}});');
    fs.writeFileSync(path.join(f.dir, 'film.json'), JSON.stringify({ title: 'future', style: 'ink-wash', size: [160, 90], fps: 10, seed: 1, shots: [{ id: 's01', file: 'shots/s01.js', duration: 1 }] }));
  }
  fs.mkdirSync(path.join(f.root, 'external-drafts')); fs.writeFileSync(path.join(f.root, 'external-drafts/user.json'), 'user draft');
  // Any rendering, encoding, Git, or download subprocess is an immediate failure with a visible marker.
  const trap = path.join(f.root, 'trap.mjs');
  fs.writeFileSync(trap, `import cp from 'node:child_process'; import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) cp[key]=()=>{fs.writeFileSync(${JSON.stringify(path.join(f.root, 'spawned'))},key);throw Error('unexpected subprocess');};syncBuiltinESMExports();`);
  const commands = [
    ['signoff', f.dir, 'approved', '--step', '2'], ['qc', f.dir], ['still', f.dir], ['animatic', f.dir],
    ['render', f.dir, '--force'], ['preview', f.dir, '--force'], ['clean', f.dir, '--render-cache'],
    ['soundtrack', f.dir], ['subtitles', f.dir, '--force'], ['final', f.dir, '--force'], ['audition', f.dir], ['sfx', f.dir],
    ['delivery', f.dir], ['delivery', f.dir, '--final'], ['delivery', f.dir, '--final', '--record'],
    ['brief', 'future', '--dir', f.root], ['init', 'future', '--style', 'ink-wash', '--dir', f.root], ['init-project', f.root],
  ];
  const before = snapshot(f.root);
  for (const args of commands) {
    const result = f.run(args, trap);
    assert.equal(result.status, 1, args.join(' ') + '\n' + result.stdout + result.stderr);
    assert.match(result.stderr, /WKA_FLOW_TOO_NEW/, args.join(' '));
    assert.deepEqual(snapshot(f.root), before, args.join(' '));
  }
});

test('init-project and signoff preserve real Git HEAD, index blobs/modes, and uncommitted edits', t => {
  const f = fixture(t);
  const git = args => { const r = spawnSync('git', args, { cwd: f.root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git(['init']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
  git(['add', '.']); git(['commit', '-m', 'fixture']);
  fs.writeFileSync(path.join(f.dir, 'brief.md'), 'staged'); git(['add', '.']); fs.writeFileSync(path.join(f.dir, 'brief.md'), 'unstaged');
  const head = git(['rev-parse', 'HEAD']), index = git(['ls-files', '--stage']), before = snapshot(f.root);
  for (const args of [['init-project', f.root], ['signoff', f.dir, 'approved', '--step', '2', '--force']]) {
    const r = f.run(args); assert.equal(r.status, 1); assert.match(r.stderr, /WKA_FLOW_TOO_NEW/);
    assert.equal(git(['rev-parse', 'HEAD']), head); assert.equal(git(['ls-files', '--stage']), index);
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('shared loading, stage, report, and Git entry points enforce the same protection', async t => {
  const f = fixture(t), before = snapshot(f.root), error = { code: 'WKA_FLOW_TOO_NEW' };
  for (const run of [() => loadFilm(f.dir), () => lockProduction(f.dir), () => recoveryStatus(f.dir),
    () => rememberArtifacts(f.dir, {}), () => writeDelivery(f.dir), () => writeFinalDelivery(f.dir),
    () => recordFinalEvidence(f.dir), () => recordFinalArtifact(f.dir, {}), () => commitFinalApproval(f.dir, {}),
    () => initProject(f.root), () => commitSnapshot(f.dir, 'blocked')]) {
    assert.throws(run, error); assert.deepEqual(snapshot(f.root), before);
  }
  let ran = false;
  await assert.rejects(runStage(f.dir, { stage: 'fixture', run: async () => { ran = true; return { outputs: [], value: null }; } }), error);
  assert.equal(ran, false);
  await assert.rejects(writeReview(f.dir, 'blocked.mp4', []), error);
  assert.deepEqual(snapshot(f.root), before);
});

test('invalid state blocks writes while registry listing and help remain available', t => {
  const f = fixture(t, null), before = snapshot(f.root);
  const result = f.run(['signoff', f.dir, 'approved', '--force']);
  assert.equal(result.status, 1); assert.match(result.stderr, /WKA_FLOW_INVALID/);
  for (const args of [['list'], ['help']]) assert.equal(f.run(args).status, 0);
  assert.deepEqual(snapshot(f.root), before);
});

test('status continues compatible films and fails overall without interpreting future steps', t => {
  const f = fixture(t), current = path.join(f.root, 'films/current');
  fs.mkdirSync(path.join(current, '.wka'), { recursive: true });
  fs.writeFileSync(path.join(current, 'brief.md'), 'current');
  fs.writeFileSync(path.join(current, '.wka/state.json'), JSON.stringify({ flow: 5, step: 2, history: [] }));
  const result = f.run(['status', f.root]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /current/); assert.match(result.stdout, /美术定调/);
  assert.match(result.stdout, /future/); assert.match(result.stdout, /WKA_FLOW_TOO_NEW/);
  assert.doesNotMatch(result.stdout, /第 60 道/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), f.raw);
});
