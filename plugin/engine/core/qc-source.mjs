import fs from 'node:fs';
import path from 'node:path';
import { digest, fileDigest } from './evidence.mjs';
import { ENGINE_ROOT } from './paths.mjs';

// Both the QC producer and the delivery reader observe these bytes independently.
// Relative identities keep the algorithm portable without caching an observation.
export function qcSource(cacheDir, { proxy = false } = {}) {
  const video = path.join(cacheDir, proxy ? 'video-proxy.mp4' : 'video.mp4');
  const timing = path.join(cacheDir, proxy ? 'timing-proxy.json' : 'timing.json');
  const algorithm = ['core/qc.mjs', 'core/qc-config.mjs', 'core/qc-source.mjs']
    .map(file => [file, fileDigest(path.join(ENGINE_ROOT, file))]);
  return digest({
    video: fs.existsSync(video) ? fileDigest(video) : null,
    timing: fs.existsSync(timing) ? fileDigest(timing) : null,
    algorithm,
  });
}
