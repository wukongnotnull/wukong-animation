// Drafts are never formal submissions. Pending local writes survive an unavailable service.
export async function createSession({ read, write, storage, prefix, onState = () => {} }) {
  const localKey = 'workbench-pending:' + prefix;
  let entries = (await read()).entries, pending = {}, running = null;
  try { pending = JSON.parse(storage.getItem(localKey) || '{}'); } catch { onState('error', '浏览器草稿无法读取，请保留原数据后检查'); }
  const persist = () => { try { storage.setItem(localKey, JSON.stringify(pending)); return true; } catch { onState('error', '浏览器无法保留草稿，请保持页面打开并恢复本机连接'); return false; } };
  const session = {
    get: key => Object.hasOwn(pending, key) ? pending[key].value : entries[key]?.value,
    values: () => Object.fromEntries([...new Set([...Object.keys(entries), ...Object.keys(pending)])].map(key => [key, session.get(key)])),
    set(key, value) {
      if (JSON.stringify(session.get(key)) === JSON.stringify(value)) return;
      pending[key] = { value: structuredClone(value), expected: pending[key]?.expected ?? entries[key]?.revision ?? 0 };
      if (persist()) onState('local', '草稿已保留在此浏览器，待同步本机工程');
    },
    dirty: () => Object.keys(pending).length > 0,
    async flush() {
      if (running) return running;
      running = (async () => {
        let failed = false;
        for (const key of Object.keys(pending)) {
          const sent = pending[key];
          try {
            const result = await write({ key, expected: sent.expected, value: sent.value }); entries[key] = result;
            if (pending[key] === sent) delete pending[key]; else pending[key].expected = result.revision;
            persist();
          } catch (error) { failed = true; onState('error', error.message + '；未提交内容仍保留在本页/此浏览器，请勿清除浏览器数据。'); break; }
        }
        if (!failed && !session.dirty()) onState('saved', '');
        return !failed;
      })();
      try { return await running; } finally { running = null; }
    },
    // Only called by an explicit user action after a displayed conflict.
    async keepLocal() { entries = (await read()).entries; for (const key of Object.keys(pending)) pending[key].expected = entries[key]?.revision || 0; persist(); return session.flush(); },
  };
  return session;
}
