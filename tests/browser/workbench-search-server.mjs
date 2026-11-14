// Isolated, reproducible workbench fixture for workbench-search.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeProduction } from '../../plugin/engine/core/state.mjs';
import { captureWorkbench, registerWorkbenchArtifact } from '../../plugin/engine/core/workbench.mjs';
import { startWorkbench } from '../../plugin/engine/cli/workbench-server.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-search-browser-'));
initializeProduction(directory);
fs.writeFileSync(path.join(directory, 'brief.md'), '# 搜索验证\n\n悟空穿过山林，寻找新的故事。\n');
fs.writeFileSync(path.join(directory, 'story.md'), '# 山林中的回声\n\n悟空听见山谷里的回声。\n\n悟**空**向前，`ABC` 与 abc。\n\n.*[x] 是字面量。\n\n| 镜号 | 内容 |\n| --- | --- |\n| s01 | 悟空望向远山 |\n| s02 | 云海翻涌 |\n\n' + Array.from({ length: 50 }, (_, index) => `第 ${index + 1} 段：山风轻轻吹过树林。`).join('\n\n') + '\n\n悟空在终点回望。\n');
fs.writeFileSync(path.join(directory, 'preview.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#2d6a32"/></svg>');
registerWorkbenchArtifact(directory, { file: 'preview.svg', step: 3, label: '画面示例' });
captureWorkbench(directory);
fs.appendFileSync(path.join(directory, 'story.md'), '\n\n版本二补充。\n');
captureWorkbench(directory);
const app = await startWorkbench(directory, { port: Number(process.argv[2] || 63917) });
console.log(app.url);
async function stop() {
  await app.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
