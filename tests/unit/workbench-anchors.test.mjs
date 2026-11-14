import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';

const source = fs.readFileSync(new URL('../../plugin/engine/workbench/app.js', import.meta.url), 'utf8');
const nodes = [];
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type) nodes.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') walk(value);
  }
}
walk(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));

function imageHandler(eventName) {
  return nodes.find(n => n.type === 'CallExpression' && n.callee.object?.name === 'img'
    && n.callee.property?.name === 'addEventListener' && n.arguments[0]?.value === eventName)?.arguments[1];
}
const markTime = nodes.find(n => n.type === 'AssignmentExpression' && n.left.property?.name === 'onclick'
  && n.left.object?.callee?.name === '$' && n.left.object.arguments[0]?.value === 'mark-time')?.right;
const clip = nodes.find(n => n.type === 'CallExpression' && n.callee.name === 'button' && n.arguments[2]?.value === 'clip')?.arguments[1];

const cases = [
  { name: 'image click', handler: imageHandler('click'), event: { clientX: 60, clientY: 170 }, anchor: { type: 'image', x: 0.25, y: 0.75 }, focus: 1 },
  { name: 'image Enter', handler: imageHandler('keydown'), event: { key: 'Enter', preventDefault() {} }, anchor: { type: 'image', x: 0.5, y: 0.5 }, focus: 1 },
  { name: 'shot click', handler: clip, anchor: { type: 'time', start: 4, end: 7 }, focus: 0 },
  { name: 'mark current time', handler: markTime, anchor: { type: 'time', start: 5, end: 5 }, focus: 1 },
];
for (const scenario of cases) test(`${scenario.name} records an anchor without the removed panel switch`, () => {
  assert.ok(scenario.handler, '应能找到真实事件处理器');
  const anchors = [], effects = { captures: 0, focuses: 0 };
  const media = { currentTime: 5 };
  const context = {
    ui: { media, report: { readonly: false }, anchor: { type: 'general' } }, media,
    img: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 200 }) },
    shot: { start: 4, duration: 3 }, end: 7,
    setAnchor: anchor => anchors.push(JSON.parse(JSON.stringify(anchor))),
    captureDrafts: () => { effects.captures++; },
    $: () => ({ focus: () => { effects.focuses++; } }),
    item: () => ({}), version: () => ({}), playbackContext: () => null,
  };
  const handler = vm.runInNewContext('(' + source.slice(scenario.handler.start, scenario.handler.end) + ')', context);
  assert.doesNotThrow(() => handler(scenario.event));
  assert.deepEqual(anchors, [scenario.anchor]);
  assert.equal(effects.captures, 1);
  assert.equal(effects.focuses, scenario.focus);
  if (scenario.handler === clip) assert.equal(media.currentTime, 4);
});
