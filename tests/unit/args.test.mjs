import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../../plugin/engine/bin/args.mjs';

test('--name value and --name=value give the same option', () => {
  const a = parseArgs(['audition', 'film', '--rate', '-20%', '--text', '句']);
  const b = parseArgs(['audition', 'film', '--rate=-20%', '--text=句']);
  for (const { opt } of [a, b]) {
    assert.equal(opt('rate'), '-20%');
    assert.equal(opt('text'), '句');
  }
  assert.deepEqual(a.pos, ['film']);
  assert.deepEqual(b.pos, ['film']);
  assert.equal(b.cmd, 'audition');
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
