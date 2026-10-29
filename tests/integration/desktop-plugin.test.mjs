// 桌面安装契约：marketplace -> 插件 -> onboarding/skills，并验证安装副本不依赖源码仓库路径。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('desktop marketplace resolves a plugin with discoverable entry skills and onboarding', () => {
  const file = path.join(ROOT, '.agents/plugins/marketplace.json');
  assert.ok(fs.existsSync(file), '缺少 Codex/ChatGPT 桌面 marketplace');
  const market = json(file);
  assert.equal(market.name, 'wukong-animation');
  const entry = market.plugins.find((p) => p.name === 'wukong-animation');
  assert.ok(entry, 'marketplace 必须提供 wukong-animation');
  assert.equal(entry.source.source, 'local');
  assert.equal(entry.source.path, './plugin');
  assert.equal(entry.policy.installation, 'AVAILABLE');
  assert.equal(entry.policy.authentication, 'ON_INSTALL');
  assert.equal(entry.category, 'Creativity');
  const dir = path.resolve(ROOT, entry.source.path);
  const manifest = json(path.join(dir, 'plugin.json'));
  const compat = json(path.join(dir, '.codex-plugin/plugin.json'));
  const claude = json(path.join(dir, '.claude-plugin/plugin.json'));
  const legacyMarket = json(path.join(ROOT, '.claude-plugin/marketplace.json'));
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  for (const other of [compat, claude, legacyMarket.plugins[0]]) {
    assert.equal(other.name, manifest.name);
    assert.equal(other.version, manifest.version, '各宿主必须安装同一版本');
  }
  const openai = manifest.extensions['com.openai'];
  assert.equal(openai.onboardingSkill, './skills/setup/SKILL.md');
  assert.ok(fs.existsSync(path.resolve(dir, openai.onboardingSkill)));
  assert.deepEqual(compat.interface, openai.interface);
  assert.equal(compat.skills, './skills/');
  assert.equal(compat.extensions['com.openai'].onboardingSkill, openai.onboardingSkill);
  assert.ok(openai.interface.shortDescription.length <= 30);
  for (const name of ['film', 'setup', 'styles', 'director', 'ink-wash', 'keynote', 'new-style']) {
    const skill = fs.readFileSync(path.join(dir, 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(`^---\nname: ${name}\ndescription: .+\n---`));
    assert.doesNotMatch(skill, /\$\{CLAUDE_PLUGIN_ROOT\}|\$ARGUMENTS/, '共享技能不能依赖 Claude 命令替换');
  }
  for (const name of ['film', 'setup', 'styles']) {
    assert.ok(fs.existsSync(path.join(dir, 'commands', `${name}.md`)), '保留 Claude Code 入口');
  }
});

test('a clean cached plugin finds its own resources and writes films into the selected workspace', (t) => {
  assert.ok(fs.existsSync(path.join(ROOT, 'plugin/skills/film/SKILL.md')), '缺少桌面 film 入口');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wka desktop-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const installed = path.join(tmp, '插件 缓存', 'wukong-animation');
  const cwd = path.join(tmp, '用户 工程');
  fs.mkdirSync(cwd, { recursive: true });
  // 与干净 clone 一致：不带被忽略的依赖、示范片成片和机器上的缓存。
  const files = spawnSync('git', ['ls-files', '-z', '--cached', '--', 'plugin'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(files.status, 0, files.stderr);
  // 新增入口在提交前也纳入测试；不抓取并行 new-style 测试临时生成的未跟踪目录。
  const packaged = new Set([
    ...files.stdout.split('\0').filter(Boolean),
    'plugin/plugin.json',
    'plugin/.codex-plugin/plugin.json',
    ...['film', 'setup', 'styles'].map((name) => `plugin/skills/${name}/SKILL.md`),
  ]);
  for (const rel of packaged) {
    const dest = path.join(installed, path.relative('plugin', rel));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dest);
  }
  const env = { ...process.env, WUKONG_ANIMATION_HOME: path.join(tmp, '用户 缓存') };
  delete env.CLAUDE_PLUGIN_ROOT;
  delete env.PLUGIN_ROOT;
  const wka = (...args) => {
    const r = spawnSync(process.execPath, [path.join(installed, 'engine/bin/wka.mjs'), ...args], { cwd, env, encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return r.stdout;
  };
  assert.match(wka('list', 'styles'), /ink-wash/);
  assert.match(wka('list', 'styles'), /keynote/);
  wka('status');
  wka('brief', '桌面试片');
  const brief = path.join(cwd, 'films/桌面试片/brief.md');
  fs.writeFileSync(brief, '用户已确认的简报\n');
  wka('init', '桌面试片', '--style', 'ink-wash', '--aspect', '9:16');
  assert.equal(fs.readFileSync(brief, 'utf8'), '用户已确认的简报\n');
  const film = json(path.join(cwd, 'films/桌面试片/film.json'));
  assert.equal(film.style, 'ink-wash');
  assert.deepEqual(film.size, [1080, 1920]);
  assert.ok(film.shots.every((s) => fs.existsSync(path.join(cwd, 'films/桌面试片', s.file))));
  assert.equal(fs.existsSync(path.join(installed, 'films')), false, '不能把用户工程写到插件缓存');
  assert.ok(json(path.join(installed, 'catalog.json')).styles.some((s) => s.id === 'ink-wash'));
});
