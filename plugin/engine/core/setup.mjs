// 安装到独立暂存目录，成功后才发布；旧身份和不明目录不自动删除。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ENGINE_ROOT, HOME } from './paths.mjs';
import { dependencyManifest, dependencyDirectory, verifyDependencyFiles, verifyInstallation, stampDependencies } from './dependency-manifest.mjs';

function completed(result, label) {
  if (result.error || result.status !== 0) throw new Error(`${label} 失败（退出 ${result.status ?? result.signal ?? '未启动'}）：${result.error?.message || result.stderr || '请检查上述安装日志后重试'}`);
  return result;
}
export function npmVersion(run = spawnSync, cwd = ENGINE_ROOT) {
  return completed(run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], { cwd, encoding: 'utf8', shell: process.platform === 'win32' }), 'npm --version').stdout.trim();
}

const browserProbe = `const fs=require('node:fs'),path=require('node:path');const pw=require(path.join(process.argv[1],'node_modules/playwright'));if(!fs.existsSync(pw.chromium.executablePath()))throw Error('Chromium executable missing');`;
function browserReady(root, run) {
  return run(process.execPath, ['-e', browserProbe, root], { cwd: root, encoding: 'utf8' });
}
function installBrowser(root, run, log) {
  log('安装锁定 Playwright 的 Chromium …');
  completed(run(process.execPath, [path.join(root, 'node_modules/playwright/cli.js'), 'install', 'chromium'], { cwd: root, stdio: 'inherit' }), 'Chromium 安装');
  completed(browserReady(root, run), 'Chromium 可用性检查');
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
function installLock(target) {
  const file = `${target}.lock`, guard = `${target}.recover`, token = crypto.randomUUID();
  const acquire = () => {
    const fd = fs.openSync(file, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), token })); }
    catch (e) { fs.rmSync(file, { force: true }); throw e; }
    finally { fs.closeSync(fd); }
  };
  if (fs.existsSync(guard)) throw new Error(`依赖锁正在恢复，请稍后检查：${guard}`);
  try { acquire(); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try { fs.mkdirSync(guard); } catch { throw new Error(`依赖锁正在恢复：${guard}`); }
    try {
      let old;
      try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 不删除所有者未知的锁 */ }
      if (!old?.token || old.host !== os.hostname() || !Number.isInteger(old.pid) || old.pid <= 0 || alive(old.pid)) throw new Error(`依赖正在安装或锁所有者无法核实：${file}`);
      fs.rmSync(file);
      acquire();
    } finally { fs.rmdirSync(guard); }
  }
  return () => {
    let owner; try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
    if (owner.token === token) fs.rmSync(file);
  };
}

export function setupDependencies({ engineRoot = ENGINE_ROOT, home = HOME, run = spawnSync, log = console.log } = {}) {
  const input = dependencyManifest(engineRoot), root = dependencyDirectory(home, input);
  fs.mkdirSync(path.dirname(root), { recursive: true });
  const unlock = installLock(root);
  let staging;
  try {
    let valid = false;
    if (fs.existsSync(root)) {
      try { verifyInstallation(root, input); valid = true; }
      catch (e) { log(`安装需修复：${e.message}`); }
    }
    if (valid) {
      const probe = browserReady(root, run);
      if (probe.error || probe.status !== 0) installBrowser(root, run, log);
      log(`复用锁定依赖：${root}`);
      return { root, identity: input.identity, reused: true };
    }
    const version = npmVersion(run, engineRoot);
    staging = fs.mkdtempSync(`${root}.install-`);
    fs.writeFileSync(path.join(staging, 'package.json'), input.packageBytes);
    fs.writeFileSync(path.join(staging, 'package-lock.json'), input.lockBytes);
    log(`按锁文件安装 npm 依赖到 ${root} …`);
    completed(run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: staging, stdio: 'inherit', shell: process.platform === 'win32' }), 'npm ci');
    verifyDependencyFiles(staging, input);
    installBrowser(staging, run, log);
    stampDependencies(staging, input, { npmVersion: version });
    let retained;
    if (fs.existsSync(root)) {
      retained = `${root}.invalid-${crypto.randomUUID()}`;
      fs.renameSync(root, retained);
    }
    try { fs.renameSync(staging, root); staging = null; }
    catch (e) { if (retained && !fs.existsSync(root)) fs.renameSync(retained, root); throw e; }
    if (retained) log(`原不完整目录已保留：${retained}`);
    log(`依赖安装完成：${root}`);
    return { root, identity: input.identity, reused: false };
  } finally {
    try { if (staging) fs.rmSync(staging, { recursive: true, force: true }); }
    finally { unlock(); }
  }
}
