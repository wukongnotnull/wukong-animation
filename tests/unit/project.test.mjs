import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertIgnoreBlock } from '../../plugin/engine/core/project.mjs';

const BEGIN = '# >>> wukong-animation >>>';
const END = '# <<< wukong-animation <<<';

test('a new .gitignore gets the block, which ignores the review folder', () => {
  const out = upsertIgnoreBlock('');
  assert.ok(out.startsWith(BEGIN));
  assert.match(out, /^films\/\*\/review\/$/m);
});

test('an outdated block is replaced and the lines around it are kept', () => {
  const old = `dist/\n\n${BEGIN}\nfilms/*/.cache/\n${END}\n\nmy-notes.txt\n`;
  const out = upsertIgnoreBlock(old);
  assert.ok(out.startsWith('dist/\n\n' + BEGIN));
  assert.ok(out.endsWith(`${END}\n\nmy-notes.txt\n`));
  assert.match(out, /^films\/\*\/review\/$/m);
  assert.equal(out.split(BEGIN).length, 2);
});

test('a current block is left as it is', () => {
  const once = upsertIgnoreBlock('dist/\n');
  assert.equal(upsertIgnoreBlock(once), once);
});

test('a block whose end marker was deleted is left alone, so lines after it are not lost', () => {
  const broken = `${BEGIN}\nfilms/*/.cache/\nmine\n`;
  assert.equal(upsertIgnoreBlock(broken), broken);
});

test('CRLF line endings after the block leave no stray carriage return', () => {
  const out = upsertIgnoreBlock(`${BEGIN}\r\nold\r\n${END}\r\nb\r\n`);
  assert.ok(out.endsWith(`${END}\nb\r\n`));
});
