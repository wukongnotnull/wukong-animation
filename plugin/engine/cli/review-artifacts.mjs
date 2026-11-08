import { loadFilm } from '../core/film-context.mjs';
import { rememberArtifacts } from '../core/operations.mjs';
import { digest, fileDigest } from '../core/evidence.mjs';

export function reviewArtifacts() {
  function registerReview(filmDir, stage, outputs, aspect = null, proxy = false) {
    const ctx = loadFilm(filmDir, { requireShots: false, aspect });
    rememberArtifacts(ctx.filmDir, { stage: 'review:' + stage, aspect: ctx.variant.aspect, proxy, outputs, value: outputs, signature: digest(outputs.map(file => fileDigest(file))) });
  }
  return { registerReview };
}
