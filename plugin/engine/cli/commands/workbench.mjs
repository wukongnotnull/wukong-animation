import { startWorkbench, openWorkbenchUrl } from '../workbench-server.mjs';
import { captureWorkbench, registerWorkbenchArtifact, workbenchPending } from '../../core/workbench.mjs';

export function workbenchCommands({ pos, opt, log }) {
  return { workbench: async () => {
    const dir = pos[0] || '.';
    if (opt('register')) {
      if (typeof opt('register') !== 'string') throw new Error('--register 后需要文件路径');
      const depends = opt('depends');
      if (depends === true) throw new Error('--depends 后需要用逗号分隔的来源路径');
      const result = registerWorkbenchArtifact(dir, { file: opt('register'), step: Number(opt('step')), label: opt('label') || undefined, ...(depends ? { depends: String(depends).split(',').map(s => s.trim()) } : {}) });
      log(JSON.stringify(result, null, 2)); return;
    }
    if (opt('pending')) { log(JSON.stringify(workbenchPending(dir), null, 2)); return; }
    if (opt('capture')) { const report = captureWorkbench(dir); log(JSON.stringify(report, null, 2)); return report.ok ? 0 : 2; }
    const app = await startWorkbench(dir, { port: Number(opt('port', 0)) });
    log(`审阅工作台：${app.url}`); log('素材保留本机；关闭此命令后服务停止。按 Ctrl+C 退出。');
    const stop = () => { app.close().catch(() => {}); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      if (opt('open')) try { await openWorkbenchUrl(app.url); } catch (error) { log('无法自动打开浏览器：' + error.message + '；请手动打开上面的链接。'); }
      await new Promise(resolve => app.server.once('close', resolve));
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  } };
}
