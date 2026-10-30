// 安装身份按需读取；help/status 不应因为尚未安装依赖而失败。
import fs from 'node:fs';
import path from 'node:path';
import { digest, atomicJson } from './evidence.mjs';

export const RECEIPT = '.wka-install.json';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const sorted = value => Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
const jsonFile = file => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`${file}：${e.message}`, { cause: e }); }
};

export function dependencyManifest(engineRoot, { platform = process.platform, arch = process.arch, nodeVersion = process.version } = {}) {
  const packageFile = path.join(engineRoot, 'package.json'), lockFile = path.join(engineRoot, 'package-lock.json');
  const pkg = jsonFile(packageFile), lock = jsonFile(lockFile);
  if (!object(pkg) || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(pkg.version)) throw new Error(`${packageFile}：无效的引擎版本`);
  if (!object(lock) || lock.lockfileVersion !== 3 || !object(lock.packages) || !object(lock.packages[''])) throw new Error(`${lockFile}：需要完整的 lockfileVersion 3 锁文件`);
  for (const key of ['dependencies', 'optionalDependencies', 'devDependencies']) {
    if ((pkg[key] !== undefined && !object(pkg[key])) || JSON.stringify(sorted(pkg[key])) !== JSON.stringify(sorted(lock.packages[''][key]))) {
      throw new Error(`${lockFile}：${key} 与 package.json 不一致，请维护者重新生成锁文件`);
    }
  }
  if (lock.packages[''].version !== pkg.version || lock.packages[''].name !== pkg.name) throw new Error(`${lockFile}：引擎清单身份不一致`);
  const expected = {};
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name) || name === '.' || name === '..') throw new Error(`${lockFile}：无效依赖名称 ${name}`);
    const version = lock.packages[`node_modules/${name}`]?.version;
    if (typeof version !== 'string' || !version) throw new Error(`${lockFile}：缺少 ${name} 的锁定版本`);
    expected[name] = { version, optional: Object.hasOwn(pkg.optionalDependencies || {}, name) };
  }
  const nodeMajor = Number(String(nodeVersion).replace(/^v/, '').split('.')[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 20) throw new Error('依赖安装需要 Node.js 20 或更新版本');
  const packageBytes = fs.readFileSync(packageFile), lockBytes = fs.readFileSync(lockFile);
  const identityData = { version: 1, engineVersion: pkg.version, packageSha256: digest(packageBytes), lockSha256: digest(lockBytes), platform, arch, nodeMajor };
  return { ...identityData, identity: digest(identityData), expected, packageBytes, lockBytes };
}

export function dependencyDirectory(home, input) {
  return path.join(home, 'deps', input.engineVersion, `${input.platform}-${input.arch}-node${input.nodeMajor}-${input.identity}`);
}

export function verifyDependencyFiles(root, input) {
  for (const [name, sha] of [['package.json', input.packageSha256], ['package-lock.json', input.lockSha256]]) {
    if (digest(fs.readFileSync(path.join(root, name))) !== sha) throw new Error(`${root}：${name} 与当前插件不一致，请重新运行 wka setup`);
  }
  const modules = fs.realpathSync(path.join(root, 'node_modules'));
  if (!modules.startsWith(fs.realpathSync(root) + path.sep)) throw new Error(`${root}：node_modules 的来源超出安装目录范围`);
  for (const [name, { version, optional }] of Object.entries(input.expected)) {
    const base = path.join(root, 'node_modules', name);
    if (optional && !fs.existsSync(base)) continue;
    const actual = jsonFile(path.join(base, 'package.json'));
    if (actual.version !== version) throw new Error(`${root}：${name} 版本 ${actual.version} 与锁定版本 ${version} 不一致，请运行 wka setup`);
    if (!fs.realpathSync(base).startsWith(modules + path.sep)) throw new Error(`${name} 的实际来源超出依赖目录范围`);
  }
}

export function stampDependencies(root, input, { npmVersion }) {
  verifyDependencyFiles(root, input);
  const receipt = { version: 1, identity: input.identity, nodeVersion: process.version, npmVersion, completedAt: new Date().toISOString() };
  atomicJson(path.join(root, 'node_modules', RECEIPT), receipt);
  return receipt;
}

export function verifyInstallation(root, input) {
  const file = path.join(root, 'node_modules', RECEIPT);
  let receipt;
  try { receipt = jsonFile(file); }
  catch (e) { throw new Error(`${root}：依赖安装未完成或缺少安装凭据，请运行 wka setup；${e.message}`, { cause: e }); }
  if (receipt?.version !== 1 || receipt.identity !== input.identity || !receipt.completedAt || typeof receipt.npmVersion !== 'string') {
    throw new Error(`${root}：安装凭据与当前锁文件/运行环境不一致，请运行 wka setup`);
  }
  verifyDependencyFiles(root, input);
  return receipt;
}
