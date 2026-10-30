#!/usr/bin/env node
// 仅由 npm ci 成功后的仓库 setup 调用，不随插件分发。
import { ENGINE_ROOT } from '../plugin/engine/core/paths.mjs';
import { dependencyManifest, stampDependencies } from '../plugin/engine/core/dependency-manifest.mjs';
import { npmVersion } from '../plugin/engine/core/setup.mjs';
const input = dependencyManifest(ENGINE_ROOT);
stampDependencies(ENGINE_ROOT, input, { npmVersion: npmVersion() });
console.log(`开发依赖已按锁文件登记：${input.identity}`);
