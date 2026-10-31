#!/usr/bin/env node
// 只在进程入口读取 argv 和设置退出码。
import { runCli } from '../cli/run.mjs';

process.exitCode = await runCli(process.argv.slice(2));
