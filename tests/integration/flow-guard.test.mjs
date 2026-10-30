import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../../plugin/engine/bin/wka.mjs', import.meta.url));
function fixture(t, flow = 6) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-flow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'films/future'), file = path.join(dir, '.wka/state.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = JSON.stringify({ flow, step: 60, history: [{ step: 60, label: 'future', note: 'keep' }], approved: { mainId: 'keep' } }, null, 3);
  fs.writeFileSync(file, raw); fs.writeFileSync(path.join(dir, 'brief.md'), '# Future');
  const env = { ...process.env, WUKONG_ANIMATION_HOME: path.join(root, 'home'), WKA_JIANYING_DRAFTS: path.join(root, 'external-drafts') };
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env });
  return { root, dir, file, raw, run };
}

test('resume gives structured read-only flow diagnostics, never a rerun instruction', t => {
  const f = fixture(t), result = f.run(['resume', f.dir, '--json']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.code, 'WKA_FLOW_TOO_NEW'); assert.equal(status.flow, 6);
  assert.equal(status.supportedFlow, 5); assert.equal(status.stateFile, f.file); assert.equal(status.readonly, true);
  assert.match(status.instruction, /升级/); assert.equal('next' in status, false); assert.equal('stages' in status, false);
  assert.equal(fs.readFileSync(f.file, 'utf8'), f.raw);
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
