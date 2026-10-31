const QC_DEFAULTS = { whitespace_min: 0, paper_tol: 20, accent_tol: 60, accent_max: 1, diff_max: 30, cuts_max: 99, skip_start: 0.5 };

/** 质检阈值：缺省值 ← style.json 的 qc ← qc.by_aspect[画幅] */
export function qcConfig(style, aspect) {
  const { by_aspect: byAspect = {}, ...qc } = style.qc || {};
  return { ...QC_DEFAULTS, ...qc, ...(byAspect[aspect] || {}) };
}

