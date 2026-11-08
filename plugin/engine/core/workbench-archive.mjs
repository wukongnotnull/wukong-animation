// Historical projects are files and recorded evidence, never an active production.
import fs from 'node:fs';
import path from 'node:path';
import { digest, fileDigest } from './evidence.mjs';
import { scopedPath, workbenchKind } from './workbench-catalog.mjs';

export function archiveWorkbench(dir, data, identity) {
  const artifacts = data.artifacts.map(a => ({ ...a, versions: [...a.versions] }));
  const known = new Set(artifacts.map(a => path.resolve(dir, a.relativePath || a.path)));
  const walk = relative => {
    for (const ent of fs.readdirSync(scopedPath(dir, relative), { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.isSymbolicLink()) continue;
      const rel = path.join(relative, ent.name), file = scopedPath(dir, rel);
      if (ent.isDirectory()) { walk(rel); continue; }
      if (!ent.isFile() || known.has(file)) continue;
      const sha256 = fileDigest(file), size = fs.statSync(file).size;
      const id = digest('archive:' + rel).slice(0, 24);
      artifacts.push({ id, path: file, relativePath: rel.split(path.sep).join('/'), label: path.basename(file), kind: workbenchKind(file), step: 0,
        required: false, versions: [{ id: 'file-' + sha256, number: 1, provenance: 'archive-file',
          context: { step: 0, shots: [] }, snapshot: { kind: 'file', digest: sha256, entries: [{ path: path.basename(file), sha256, size }] } }] });
    }
  };
  walk('');
  const items = artifacts.map(a => ({ ...a, current: a.versions.at(-1) || null, availability: 'historical', category: 'history',
    freshness: 'historical', checked: false, revision: digest(a), notes: data.notes.filter(n => n.artifactId === a.id) }));
  const history = identity.state?.history || [];
  const numbers = [...new Set([...items.map(a => a.step), ...history.map(h => h.step), ...data.decisions.map(d => d.step)])].filter(Number.isInteger).sort((a, b) => a - b);
  if (!numbers.length) numbers.push(0);
  return { version: 1, ok: true, readonly: true, flow: identity.flow, flowLabel: '历史档案（只读）', dir, title: path.basename(dir),
    stages: numbers.map(step => ({ step, label: history.filter(h => h.step === step).at(-1)?.label || (step ? `原工序 ${step}` : '历史文件'),
      gate: null, status: 'archived', blocks: [], items: items.filter(a => a.step === step), decisions: [...history.filter(h => h.step === step && h.note && !data.decisions.some(d => d.step === step && d.note === h.note && d.at === h.at)).map(h => ({ ...h, decision: 'archived', source: '历史进度记录' })), ...data.decisions.filter(d => d.step === step)] })),
    shots: [], duration: 0, warnings: ['旧项目只读留档；继续制作请新建项目并复用素材，原签批不继承。'], notes: data.notes, history: items };
}

export function archiveFile(dir, view, artifactId, versionId) {
  const artifact = view.stages.flatMap(s => s.items).find(a => a.id === artifactId);
  const version = artifact?.versions.find(v => v.id === versionId);
  if (version?.provenance !== 'archive-file') return null;
  const file = scopedPath(dir, artifact.relativePath), selected = version.snapshot.entries[0];
  if (!fs.existsSync(file) || fileDigest(file) !== selected.sha256) throw new Error('历史原文件已变化，请重新打开核实');
  return { file, name: selected.path, size: selected.size, kind: artifact.kind };
}
