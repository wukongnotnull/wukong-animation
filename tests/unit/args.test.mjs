import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../../plugin/engine/bin/args.mjs';

test('--name value and --name=value give the same option', () => {
  const a = parseArgs(['align-voice', '--binary', '/local/识别', '--model', '/local/模型', 'film']);
  const b = parseArgs(['align-voice', '--binary=/local/识别', '--model=/local/模型', 'film']);
  for (const { opt } of [a, b]) {
    assert.equal(opt('binary'), '/local/识别');
    assert.equal(opt('model'), '/local/模型');
  }
  assert.deepEqual(a.pos, ['film']);
  assert.deepEqual(b.pos, ['film']);
  assert.equal(b.cmd, 'align-voice');
});

test('a --name=value option does not swallow the next positional argument', () => {
  const { pos, opt } = parseArgs(['still', '--at=s01:0.5', 'film']);
  assert.deepEqual(pos, ['film']);
  assert.equal(opt('at'), 's01:0.5');
});

test('flags, missing options and empty --name= values', () => {
  const { opt } = parseArgs(['render', 'film', '--proxy', '--formats=', '--step', '--force']);
  assert.equal(opt('proxy'), true);
  assert.equal(opt('formats'), true, 'empty value counts as no value');
  assert.equal(opt('step'), true, 'followed by another option');
  assert.equal(opt('missing', 'def'), 'def');
});

test('a value that contains = is kept whole', () => {
  assert.equal(parseArgs(['x', '--text=a=b']).opt('text'), 'a=b');
});
