// 人声签批只绑定录音和本地句段；全片位置由后续分镜负责。
import fs from 'node:fs';
import { digest, fileDigest } from './evidence.mjs';
import { assertActiveProduction, FLOW, hasNoVoice, PRODUCTION_ROLES } from './state.mjs';
import { scopedPath } from './workbench-catalog.mjs';
import { voiceAlignmentStatus, voiceSourceIdentity } from '../audio/voice-alignment.mjs';

function reviewEvidence(dir, alignment) {
  const story = scopedPath(dir, 'story.md');
  if (!fs.existsSync(story) || !fs.readFileSync(story, 'utf8').trim()) throw new Error('缺少已核对的剧本，请先完成编写剧本');
  return {
    flow: FLOW, story: fileDigest(story),
    voices: Object.entries(alignment.voices).sort(([a], [b]) => a.localeCompare(b)).map(([id, voice]) => ({
      id, source: voiceSourceIdentity(voice.source), status: voice.status,
      segments: (voice.segments || []).map(({ text, start, end }) => ({ text, start, end })),
    })),
  };
}

/** ready 可用于当前签批；approved 仅表示当前录音内容仍有有效批准。 */
export function voiceReviewStatus(dir, { requireApproval = false, checkTotal = false, requireApplied = false } = {}) {
  const progress = assertActiveProduction(dir);
  const issues = [];
  let signature = null, approved = false;
  try {
    const film = JSON.parse(fs.readFileSync(scopedPath(dir, 'film.json'), 'utf8'));
    if (hasNoVoice(film)) return { applicable: false, ready: true, signature: null, issues: [], approved: false };
    if (film.audio?.voice_source === 'none') throw new Error('无人声配置与录音列表冲突，请先核对方案');
    if (!(film.audio?.voices || []).length) throw new Error('制作人声需要用户录音；明确无人声后才可跳过');
    const alignment = voiceAlignmentStatus(dir, { checkTotal });
    signature = digest(reviewEvidence(dir, alignment));
    const latest = progress.history.filter(h => h.step === PRODUCTION_ROLES.voice).at(-1);
    const confirmed = Object.values(alignment.voices).every(voice => voice.status === 'confirmed');
    if (!confirmed) issues.push('句段尚未人工试听确认，请用 --import 和 --confirm 确认当前录音内定位');
    approved = confirmed && alignment.ready && alignment.localApplied && progress.approved?.voice?.signature === signature &&
      latest?.decision === 'approved' && latest.signature === signature;
    if (!alignment.ready) issues.push('录音或原稿已变化，或句段定位缺失、待确认，请核对并重新定位');
    if (!alignment.localApplied) issues.push('当前录音内句段尚未应用，请先运行 align-voice');
    // 整体平移可以保留内容批准，但全片验收前必须重新应用映射。
    if (!alignment.applied && (!approved || checkTotal || requireApplied)) issues.push('句段定位尚未应用，请运行 align-voice 更新同步点');
    if (requireApproval && !approved) issues.push('当前人声尚未签批或批准已过期，请先完成制作人声签批');
  } catch (error) {
    issues.push(error.message);
  }
  return { applicable: true, ready: issues.length === 0, signature, issues, approved };
}

export function requireVoiceReview(dir, options = {}) {
  const review = voiceReviewStatus(dir, options);
  if (!review.ready) throw new Error(review.issues.join('；'));
  return review;
}
