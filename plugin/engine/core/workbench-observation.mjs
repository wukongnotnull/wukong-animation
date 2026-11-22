import fs from 'node:fs';
import path from 'node:path';
import { atomicJson, digest, fileDigest, readJson } from './evidence.mjs';
import { fileVersion } from './file-hash.mjs';

const cacheFile = root => path.join(root, '.cache/workbench-observation.json');
const absoluteEntry = entry => Array.isArray(entry) && typeof entry[0] === 'string' && path.isAbsolute(entry[0]);

function observedVersion(file) {
  try { return fileVersion(file); }
  catch (error) { if (error.code === 'ENOTDIR') return null; throw error; }
}

// This cache only speeds up automatic observation. Explicit checks start with fresh content reads.
export function loadWorkbenchObservation(root) {
  const file = cacheFile(root);
  try {
    if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) return null;
    const cache = readJson(file);
    if (cache?.version === 1 && Array.isArray(cache.files) && Array.isArray(cache.hashes) &&
        cache.files.every(entry => absoluteEntry(entry) && (entry[1] === null || typeof entry[1] === 'string')) &&
        cache.hashes.every(absoluteEntry)) return cache;
  } catch { /* A damaged or unreadable cache is an ordinary miss. */ }
  return null;
}

export function saveWorkbenchObservation(root, value) {
  const file = cacheFile(root);
  try {
    if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) atomicJson(file, { version: 1, ...value });
  }
  catch { /* The next automatic capture can rebuild the optional cache. */ }
}

export function observationRevision(files) {
  return digest(files.map(([file]) => [file, observedVersion(file)]));
}

export function observeWorkbenchFiles(previous) {
  const files = new Map(), hashes = new Map(), texts = new Map();
  const cached = new Map(previous?.hashes || []);
  const track = file => {
    if (!files.has(file)) files.set(file, observedVersion(file));
    return files.get(file);
  };
  const hash = file => {
    if (!hashes.has(file)) {
      const version = track(file), old = cached.get(file);
      const sha = version && old?.version === version && /^[0-9a-f]{64}$/.test(old.sha) ? old.sha : fileDigest(file);
      hashes.set(file, { version, sha });
    }
    return hashes.get(file).sha;
  };
  const text = file => {
    if (!texts.has(file)) texts.set(file, track(file) === null ? null : fs.readFileSync(file, 'utf8'));
    return texts.get(file);
  };
  return {
    track, hash, text,
    verify() {
      for (const [file, version] of files) {
        if (observedVersion(file) !== version) {
          const error = new Error(`工作台抓取期间来源发生变化，请重试：${file}`);
          error.code = 'WKA_WORKBENCH_SOURCE_CHANGED';
          throw error;
        }
      }
    },
    evidence() { return { files: [...files], hashes: [...hashes] }; },
  };
}
