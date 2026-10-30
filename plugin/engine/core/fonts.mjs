// 字体：按需下载到 ~/.wukong-animation/cache/fonts/，渲染前按片中实际用到的字做子集化。
// 中文字体动辄 5–10MB，所以插件本身不打包任何字体。
// 下载或子集化失败时不会中断渲染，而是退回到 style.json 里声明的 fallback 字体。
// 下载来源依次是：WKA_FONT_MIRROR（自配镜像）→ GitHub → jsDelivr（国内通常能连上）。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { FONT_CACHE_DIR, ensureDir } from './paths.mjs';
import { digest, fileDigest, readJson, atomicJson } from './evidence.mjs';

/** google/fonts 仓库的镜像根地址；后面接 KNOWN_FONTS 里的相对路径。 */
const SOURCES = ['https://github.com/google/fonts/raw/main/', 'https://cdn.jsdelivr.net/gh/google/fonts@main/'];

/** 已知的免费可商用字体（SIL OFL 1.1），值是在 google/fonts 仓库里的路径。新增字体就在这里加一行。 */
export const KNOWN_FONTS = {
  'Ma Shan Zheng': 'ofl/mashanzheng/MaShanZheng-Regular.ttf',
  'Zhi Mang Xing': 'ofl/zhimangxing/ZhiMangXing-Regular.ttf',
  'Long Cang': 'ofl/longcang/LongCang-Regular.ttf',
  'Liu Jian Mao Cao': 'ofl/liujianmaocao/LiuJianMaoCao-Regular.ttf',
  'ZCOOL XiaoWei': 'ofl/zcoolxiaowei/ZCOOLXiaoWei-Regular.ttf',
  // 字幕缺省字体；文件名里的方括号要转义，否则 curl 会当成通配符
  'Noto Sans SC': 'ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
  // keynote 的西文与数字、代码字体
  Inter: 'ofl/inter/Inter%5Bopsz,wght%5D.ttf',
  'JetBrains Mono': 'ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf',
};

/**
 * 某个字体的下载地址，按尝试顺序排列。
 * WKA_FONT_MIRROR 指向一个与 google/fonts 仓库同结构的镜像根（如 https://mirror.example.com/google-fonts/）。
 * @returns {string[]}
 */
export function fontUrls(family, env = process.env) {
  const rel = KNOWN_FONTS[family];
  if (!rel) return [];
  const roots = env.WKA_FONT_MIRROR ? [env.WKA_FONT_MIRROR, ...SOURCES] : SOURCES;
  return roots.map((r) => (r.endsWith('/') ? r : r + '/') + rel);
}

const fileName = (family) => family.replace(/\s+/g, '') + '.ttf';

function hasBin(cmd, args = ['--version']) {
  return spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
}

function download(url, dest) {
  // 优先用 curl：它会遵循 HTTPS_PROXY 等代理设置
  if (hasBin('curl')) {
    const r = spawnSync('curl', ['-fsSL', '--connect-timeout', '10', '--max-time', '90', '-o', dest, url], { stdio: 'ignore' });
    return r.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 10_000;
  }
  return false;
}

function isFontFile(file) {
  // 只读文件头 4 字节；中文字体动辄几 MB，没必要整个读进来
  const head = Buffer.alloc(4);
  const fd = fs.openSync(file, 'r');
  try {
    if (fs.readSync(fd, head, 0, 4, 0) < 4) return false;
  } finally {
    fs.closeSync(fd);
  }
  const tag = head.toString('latin1');
  return tag === 'true' || tag === 'OTTO' || head.readUInt32BE(0) === 0x00010000;
}

/** 确保字体在本地缓存中；返回字体文件路径或 null。 */
export function ensureFontFile(family, { log = () => {}, urls = fontUrls(family) } = {}) {
  ensureDir(FONT_CACHE_DIR);
  const dest = path.join(FONT_CACHE_DIR, fileName(family));
  if (process.env.WKA_NO_FONT_DOWNLOAD !== '1' && fs.existsSync(dest) && isFontFile(dest)) return dest;
  if (!urls.length) return null;
  // 测试 / CI 用：不下载，固定走 fallback，保证不同机器上的基准图一致
  if (process.env.WKA_NO_FONT_DOWNLOAD === '1') return null;
  // 全部来源都失败会留一个标记，24 小时内不再重试，避免每次渲染都卡在网络上；
  // 标记里记着当时试过的来源，换了来源（比如刚配了 WKA_FONT_MIRROR）就立刻重试
  const failed = dest + '.failed';
  const tried = urls.join('\n');
  if (fs.existsSync(failed) && fs.readFileSync(failed, 'utf8') === tried && Date.now() - fs.statSync(failed).mtimeMs < 24 * 3600e3) return null;
  log(`下载字体 ${family} …`);
  const tmp = dest + '.part';
  for (const url of urls) {
    if (download(url, tmp) && isFontFile(tmp)) {
      fs.renameSync(tmp, dest);
      fs.rmSync(failed, { force: true });
      return dest;
    }
    fs.rmSync(tmp, { force: true });
  }
  fs.writeFileSync(failed, tried);
  log(`  ! 字体 ${family} 下载失败（试过 ${urls.length} 个来源）。可设置 WKA_FONT_MIRROR 指向镜像，或手动放到 ${dest}`);
  return null;
}

// 源码里的 ASCII 会和代码混在一起被 collectText 滤掉，所以英文、数字、标点整段补上；
// 再加上常用中文标点，题字里临时加个逗号也不会掉成 fallback 字体
const ASCII_PRINTABLE = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
const CJK_PUNCTUATION = '，。、；：？！“”‘’（）《》〈〉「」『』【】—…·～';

/** 子集化要保留的字表：片中用到的字 + 全部可打印 ASCII + 常用中文标点，去重。 */
export function subsetChars(text) {
  return [...new Set(text + ASCII_PRINTABLE + CJK_PUNCTUATION)].join('');
}

/** 用 fonttools 截取用到的字；没有 fonttools 时返回原文件。 */
export function subsetFont(src, text, outDir) {
  const out = path.join(ensureDir(outDir), path.basename(src, '.ttf') + '-subset.ttf');
  const chars = [...subsetChars(text)].sort().join('');
  const signature = digest({ source: fileDigest(src), chars, options: '--no-hinting', version: 1 });
  const evidence = readJson(out + '.json');
  if (evidence?.signature === signature && fs.existsSync(out) && evidence.output === fileDigest(out)) return out;
  const part = out + '.part';
  const r = spawnSync(
    'python3',
    ['-m', 'fontTools.subset', src, `--text=${chars}`, `--output-file=${part}`, '--no-hinting'],
    { stdio: 'ignore' }
  );
  if (r.status === 0 && fs.existsSync(part)) {
    fs.renameSync(part, out);
    atomicJson(out + '.json', { signature, output: fileDigest(out) });
    return out;
  }
  fs.rmSync(part, { force: true });
  return src;
}

/**
 * 为一次渲染准备字体。
 * @returns {{css: string, stacks: Record<string,string>, report: string[]}}
 *   css    —— 注入宿主页的 @font-face
 *   stacks —— family → CSS font-family 字符串（含 fallback），镜头里用 wk.font(family, px) 取
 */
export function prepareFonts(fonts = [], { text = '', workDir, log = () => {} } = {}) {
  let css = '';
  let cacheCss = '';
  const stacks = {};
  const report = [];
  for (const f of fonts) {
    const fallbacks = (f.fallback || []).map((x) => `'${x}'`);
    const file = ensureFontFile(f.family, { log });
    if (file) {
      const used = text ? subsetFont(file, text, path.join(workDir, 'fonts')) : file;
      css += `@font-face{font-family:'${f.family}';src:url('${pathToFileURL(used).href.replace(/'/g,'%27')}');font-display:block;}\n`;
      cacheCss += `@font-face{font-family:'${f.family}';src:url('${pathToFileURL(file).href.replace(/'/g,'%27')}');font-display:block;}\n`;
      stacks[f.family] = [`'${f.family}'`, ...fallbacks, 'serif'].join(',');
      report.push(`${f.family}: ${used === file ? '完整字体' : '已子集化'}`);
    } else {
      stacks[f.family] = [...fallbacks, 'serif'].join(',');
      report.push(`${f.family}: 不可用，退回 ${f.fallback?.[0] ?? 'serif'}`);
    }
  }
  return { css, cacheCss, stacks, report };
}

/** 从镜头源码里收集非 ASCII 字符，作为子集化的字表。 */
export function collectText(files) {
  let s = '';
  for (const f of files) if (fs.existsSync(f)) s += fs.readFileSync(f, 'utf8').replace(/[\x00-\x7f]/g, '');
  return [...new Set(s)].join('');
}
