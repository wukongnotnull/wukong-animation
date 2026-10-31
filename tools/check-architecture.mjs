#!/usr/bin/env node
// Development-only module graph. Never imports or executes the scanned engine.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'acorn';

const ENGINE = fileURLToPath(new URL('../plugin/engine/', import.meta.url));
const parseModule = source => parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
const shape = node => JSON.stringify(node, (key, value) => ['start', 'end', 'loc', 'raw'].includes(key) ? undefined : value);
const expressionShape = source => shape(parseModule(`import(${source})`).body[0].expression.source);
const EXTENSIONS = [
  { file: 'core/registry.mjs', function: 'loadModule', purpose: 'registered pipeline/exporter slot', expression: 'pathToFileURL(item.entryPath).href' },
  { file: 'audio/soundtrack.mjs', function: 'mixSoundtrackFresh', purpose: 'user soundtrack build script', expression: 'pathToFileURL(path.join(ctx.filmDir, audio.build)).href + `?v=${Date.now()}`' },
].map(entry => ({ ...entry, shape: expressionShape(entry.expression) }));
const INPUTS = new Set(['core/film-context.mjs', 'core/delivery-inputs.mjs', 'core/qc-config.mjs', 'core/command-args.mjs', 'core/qc-source.mjs']);
const ORCHESTRATORS = new Set(['core/job.mjs', 'core/qc.mjs', 'core/delivery.mjs', 'core/final-delivery.mjs']);
const cliModule = file => file.startsWith('bin/') || file.startsWith('cli/');
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');
const member = node => node?.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === 'process'
  ? node.computed ? node.property.value : node.property.name : null;

/** Explicit files support isolated fixtures; the default scans Git-tracked engine modules. */
export function checkArchitecture({ root = ENGINE, files } = {}) {
  root = path.resolve(root);
  const errors = [], graph = {}, dynamicImports = [], seenExtensions = new Set();
  if (files === undefined) {
    try { files = execFileSync('git', ['ls-files', '-z', '--', '*.mjs'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean); }
    catch (error) { return { ok: false, errors: [`cannot list tracked modules: ${error.message}`], graph, dynamicImports }; }
  }
  const names = [...new Set(files.map(file => relative(root, path.resolve(root, file))))].sort();
  if (!names.length) errors.push('empty module scan');
  const included = new Set(names);
  for (const name of names) {
    graph[name] = [];
    if (name.startsWith('../') || !name.endsWith('.mjs')) { errors.push(`invalid module path: ${name}`); continue; }
    const file = path.join(root, name);
    let ast;
    try {
      if (!fs.lstatSync(file).isFile()) throw new Error('module must be a regular file');
      ast = parseModule(fs.readFileSync(file, 'utf8'));
    } catch (error) { errors.push(`${name}: parse error: ${error.message}`); continue; }

    const localEdge = (specifier, node) => {
      if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('file:')) return;
      let target;
      try { target = fileURLToPath(new URL(specifier, pathToFileURL(file))); }
      catch (error) { errors.push(`${name}:${node.loc.start.line}: invalid local target: ${error.message}`); return; }
      const next = relative(root, target);
      if (next.startsWith('../') || path.isAbsolute(next)) { errors.push(`${name}: local target outside engine: ${specifier}`); return; }
      if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) { errors.push(`${name}: missing local target: ${specifier}`); return; }
      if (!target.endsWith('.mjs')) return;
      if (!included.has(next)) { errors.push(`${name}: local target outside module scan: ${next}`); return; }
      graph[name].push(next);
      if (name.startsWith('core/') && cliModule(next)) errors.push(`core must not depend on CLI: ${name} -> ${next}`);
    };
    const visit = (node, depth = 0, functionName = null) => {
      if (!node || typeof node !== 'object' || !node.type) return;
      if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
        depth++; functionName = node.id?.name || null;
      }
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) localEdge(node.source.value, node);
      if (node.type === 'ImportExpression') {
        if (node.source.type === 'Literal' && typeof node.source.value === 'string') localEdge(node.source.value, node);
        else {
          const allowed = EXTENSIONS.find(entry => entry.file === name && entry.function === functionName && entry.shape === shape(node.source));
          const key = allowed && `${name}:${allowed.function}`;
          if (!allowed || seenExtensions.has(key)) errors.push(`${name}:${node.loc.start.line}: unregistered dynamic import`);
          else { seenExtensions.add(key); dynamicImports.push({ file: name, function: functionName, purpose: allowed.purpose }); }
        }
      }
      if (name.startsWith('cli/')) {
        if (node.type === 'CallExpression' && member(node.callee) === 'exit') errors.push(`${name}:${node.loc.start.line}: process.exit bypasses command cleanup`);
        if (node.type === 'AssignmentExpression' && ['exitCode', 'argv'].includes(member(node.left))) errors.push(`${name}:${node.loc.start.line}: process.${member(node.left)} belongs to bin only`);
        const callee = node.callee?.name || node.callee?.property?.name;
        if (depth === 0 && (node.type === 'AwaitExpression' || (node.type === 'CallExpression' && ['runCli', 'main', 'execute'].includes(callee)))) errors.push(`${name}:${node.loc.start.line}: import-time command execution`);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) for (const child of value) visit(child, depth, functionName);
        else if (value && typeof value === 'object') visit(value, depth, functionName);
      }
    };
    visit(ast);
    graph[name] = [...new Set(graph[name])].sort();
  }

  const visiting = new Set(), visited = new Set();
  const walk = (name, trail) => {
    if (visiting.has(name)) { errors.push(`cycle: ${[...trail.slice(trail.indexOf(name)), name].join(' -> ')}`); return; }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const next of graph[name] || []) walk(next, [...trail, name]);
    visiting.delete(name); visited.add(name);
  };
  for (const name of names) walk(name, []);
  for (const input of INPUTS) {
    if (!included.has(input)) continue;
    const seen = new Set();
    const upward = (name, trail) => {
      if (ORCHESTRATORS.has(name) || cliModule(name)) { errors.push(`input depends on orchestration: ${[...trail, name].join(' -> ')}`); return; }
      if (seen.has(name)) return;
      seen.add(name);
      for (const next of graph[name] || []) upward(next, [...trail, name]);
    };
    upward(input, []);
  }
  return { ok: !errors.length, errors, graph, dynamicImports };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkArchitecture();
  if (!result.ok) { console.error(result.errors.join('\n')); process.exitCode = 1; }
  else console.log(`✓ architecture: ${Object.keys(result.graph).length} modules, no cycles; ${result.dynamicImports.length} registered dynamic extension points`);
}
