import { openWorkbenchUrl } from '../workbench-server.mjs';
import { openWorkbench } from '../workbench-service.mjs';
import { captureWorkbench, registerWorkbenchArtifact, workbenchPending, recordWorkbenchRepair } from '../../core/workbench.mjs';

export function workbenchCommands({ pos, opt, log }) {
  return { workbench: async () => {
    const dir = pos[0] || '.';
    if (pos.length > 1 && ['repair', 'register', 'pending', 'capture'].some(name => opt(name))) throw new Error('审阅记录操作只接受一个片目录；多个目录仅用于启动工作台');
    if (opt('repair')) {
      if (typeof opt('repair') !== 'string') throw new Error('--repair 后需要意见或阶段返修编号');
      const result = recordWorkbenchRepair(dir, { id: opt('repair'), artifactId: opt('artifact') || undefined, versionId: opt('version'), summary: opt('summary'), verification: opt('verification') });
      log(JSON.stringify(result, null, 2)); return;
    }
    if (opt('register')) {
      if (typeof opt('register') !== 'string') throw new Error('--register 后需要文件路径');
      const depends = opt('depends');
      if (depends === true) throw new Error('--depends 后需要用逗号分隔的来源路径');
      const result = registerWorkbenchArtifact(dir, { file: opt('register'), step: Number(opt('step')), label: opt('label') || undefined, required: !opt('reference'), ...(depends ? { depends: String(depends).split(',').map(s => s.trim()) } : {}) });
      log(JSON.stringify(result, null, 2)); return result.ok ? 0 : 2;
    }
    if (opt('pending')) { log(JSON.stringify(workbenchPending(dir), null, 2)); return; }
    if (opt('capture')) { const report = captureWorkbench(dir); log(JSON.stringify(report, null, 2)); return report.ok ? 0 : 2; }
    const app = await openWorkbench(dir, { directories: pos.slice(1), port: opt('port') === null ? null : Number(opt('port')) });
    log(`审阅工作台：${app.url}`);
    log(app.reused ? '已加入现有工作台；原页面将自动更新项目列表。' : '素材保留本机；关闭此命令后服务停止。按 Ctrl+C 退出。');
    if (opt('open')) try { await openWorkbenchUrl(app.url); } catch (error) { log('无法自动打开浏览器：' + error.message + '；请手动打开上面的链接。'); }
    if (app.reused) return;
    const stop = () => { app.close().catch(() => {}); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      await new Promise(resolve => app.server.once('close', resolve));
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  } };
}
