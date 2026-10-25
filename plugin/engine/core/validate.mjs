// 零依赖的 JSON Schema 子集校验器，覆盖 schemas/ 里用到的关键字：
// type, required, properties, additionalProperties, enum, pattern, items, minItems, minimum, maximum
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE_ROOT } from './paths.mjs';

const cache = new Map();

export function loadSchema(name) {
  if (!cache.has(name)) {
    const file = path.join(ENGINE_ROOT, 'schemas', `${name}.schema.json`);
    cache.set(name, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  return cache.get(name);
}

function typeOf(x) {
  if (Array.isArray(x)) return 'array';
  if (x === null) return 'null';
  if (Number.isInteger(x)) return 'integer';
  return typeof x;
}

function check(schema, value, at, errors) {
  if (schema.type) {
    const t = typeOf(value);
    const ok = schema.type === t || (schema.type === 'number' && t === 'integer');
    if (!ok) {
      errors.push(`${at}: 应为 ${schema.type}，实际是 ${t}`);
      return;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at}: 取值 ${JSON.stringify(value)} 不在 ${JSON.stringify(schema.enum)} 中`);
  }
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${at}: "${value}" 不符合格式 ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: 小于 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: 大于 ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: 至少 ${schema.minItems} 项`);
    if (schema.items) value.forEach((v, i) => check(schema.items, v, `${at}[${i}]`, errors));
  }
  if (typeOf(value) === 'object') {
    for (const k of schema.required || []) if (!(k in value)) errors.push(`${at}: 缺少字段 "${k}"`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) check(props[k], v, `${at}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${at}: 未知字段 "${k}"`);
      else if (typeof schema.additionalProperties === 'object') check(schema.additionalProperties, v, `${at}.${k}`, errors);
    }
  }
}

/** 返回错误信息数组；空数组表示通过。 */
export function validate(schemaName, value, label = '$') {
  const errors = [];
  check(loadSchema(schemaName), value, label, errors);
  return errors;
}
