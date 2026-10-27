// 剪映字体对照：剪映用不了任意字体文件，网页字体换成剪映字库里最接近的（pyJianYingDraft FontType 的名字）。
// 对照表在 fonts.json；值为 null 表示有意用剪映默认字体。新风格的字幕字体要在表里补一项（lint 会查）。
import fs from 'node:fs';

export const JIANYING_FONTS = JSON.parse(fs.readFileSync(new URL('./fonts.json', import.meta.url), 'utf8'));

/** 对照表里没有的字体（值为 null 的算有）。 */
export const missingJianyingFonts = (families) => [...new Set(families)].filter((f) => !Object.hasOwn(JIANYING_FONTS, f));
