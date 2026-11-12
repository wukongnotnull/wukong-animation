/** 接触表版式：张数不多时每行 3 张（或每镜 frames 张）；张数多时排成接近方形、总宽不超过 4096。 */
export function contactSheetLayout(count, width, height, frames = 1) {
  if (count <= 12) {
    const cols = Math.min(count, frames > 1 ? frames : 3);
    const tw = 640;
    return { cols, rows: Math.ceil(count / cols), tw, th: Math.round((tw * height) / width) };
  }
  const cols = Math.min(count, Math.max(1, Math.ceil(Math.sqrt(count * height / width))));
  const tw = Math.max(160, Math.floor(4096 / cols / 2) * 2);
  return { cols, rows: Math.ceil(count / cols), tw, th: Math.round((tw * height) / width) };
}
