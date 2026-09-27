// 无浏览器的快速门禁：配置、资源、ID 与开源未来馆红线。
import fs from 'node:fs';
import path from 'node:path';

const rootArg = process.argv.find((arg) => arg.startsWith('--root='));
const ROOT = path.resolve(process.cwd(), rootArg ? rootArg.slice('--root='.length) : '.');
const PUBLIC_MODE = process.argv.includes('--public');
const publicDir = path.join(ROOT, 'public');
const configFiles = fs.readdirSync(publicDir)
  .filter((name) => /^gallery\.config(?:\.[\w-]+)?\.json$/.test(name))
  .sort();
const errors = [];
const parsedConfigs = new Map();
const fail = (message) => errors.push(message);
const SYSTEM_JUNK = /(?:^|\/)(?:\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX|\._[^/]+)$/i;

function scanPublicJunk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(publicDir, abs).replaceAll('\\', '/');
    if (SYSTEM_JUNK.test(rel)) fail(`public/ 含系统杂项文件：${rel}`);
    if (entry.isDirectory()) scanPublicJunk(abs);
  }
}

scanPublicJunk(publicDir);

function localPublicFile(configName, value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${configName}: ${label} 路径为空`);
    return null;
  }
  const portable = value.replaceAll('\\', '/');
  if (portable.startsWith('/') || portable.includes('://') || portable.split('/').includes('..')) {
    fail(`${configName}: ${label} 必须是 public/ 内的同源相对路径 (${value})`);
    return null;
  }
  const abs = path.resolve(publicDir, portable);
  const relative = path.relative(publicDir, abs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${configName}: ${label} 越出 public/ (${value})`);
    return null;
  }
  return abs;
}

function checkImageSignature(file, label) {
  const ext = path.extname(file).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return;
  const head = fs.readFileSync(file).subarray(0, 12);
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP';
  const matches = ext === '.png' ? isPng : ext === '.webp' ? isWebp : isJpeg;
  if (!matches) fail(`${label}: 文件内容与扩展名 ${ext} 不一致`);
}

if (!configFiles.length) fail('未找到 gallery.config*.json');

for (const name of configFiles) {
  const abs = path.join(publicDir, name);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(abs, 'utf8'));
    parsedConfigs.set(name, config);
  } catch (error) {
    fail(`${name}: JSON 无法解析 (${error.message})`);
    continue;
  }

  const depthPolicy = config.depthPolicy || 'uniform-auto';
  if (!['uniform-auto', 'enhanced'].includes(depthPolicy)) fail(`${name}: 未知 depthPolicy ${depthPolicy}`);

  const wingIds = new Set();
  const workIds = new Set();
  for (const wing of config.wings || []) {
    if (!wing.id) fail(`${name}: 馆缺 id`);
    else if (wingIds.has(wing.id)) fail(`${name}: 馆 id 重复 ${wing.id}`);
    else wingIds.add(wing.id);
    const artistIds = new Set();
    for (const artist of wing.artists || []) {
      if (!artist.id) fail(`${name}: ${wing.id || 'wing'} 中艺术家缺 id`);
      else if (artistIds.has(artist.id)) fail(`${name}: ${wing.id || 'wing'} 中艺术家 id 重复 ${artist.id}`);
      else artistIds.add(artist.id);
      for (const work of artist.works || []) {
        if (!work.id) fail(`${name}: 画作缺 id`);
        else if (workIds.has(work.id)) fail(`${name}: 画作 id 重复 ${work.id}`);
        else workIds.add(work.id);
        const workFile = localPublicFile(name, work.file, `画作 ${work.id || '(unknown)'}`);
        if (!workFile || !fs.existsSync(workFile)) {
          fail(`${name}: 缺画作资源 ${work.file || '(empty)'}`);
        } else checkImageSignature(workFile, `${name}: 画作 ${work.id || '(unknown)'}`);
        if (work.depth) {
          const depthFile = localPublicFile(name, work.depth, `深度图 ${work.id || '(unknown)'}`);
          if (!depthFile || !fs.existsSync(depthFile)) fail(`${name}: 缺深度资源 ${work.depth}`);
          else checkImageSignature(depthFile, `${name}: 深度图 ${work.id || '(unknown)'}`);
        }
        if (depthPolicy === 'enhanced' && !work.depth) {
          fail(`${name}: enhanced 必须全馆覆盖深度图，${work.id || '(unknown)'} 未配置 depth`);
        }
        if (work.dream) fail(`${name}: ${work.id} 使用了已移除的逐画浮雕方案字段 dream`);
      }
    }
  }

  if (config.altLang?.config) {
    const altConfig = localPublicFile(name, config.altLang.config, 'altLang.config');
    if (!altConfig || !fs.existsSync(altConfig)) fail(`${name}: altLang 指向不存在的 ${config.altLang.config}`);
  }

  if (PUBLIC_MODE && (name === 'gallery.config.json' || name === 'gallery.config.zh.json')) {
    const future = (config.wings || []).find((wing) => wing.id === 'future');
    if (!future) fail(`${name}: 开源主配置缺少未来馆空占位`);
  }

  if (PUBLIC_MODE) {
    const future = (config.wings || []).find((wing) => wing.id === 'future');
    const works = (future?.artists || []).reduce((sum, artist) => sum + (artist.works || []).length, 0);
    if (future && (future.type !== 'open' || future.frames !== 6 || (future.artists || []).length || works)) {
      fail(`${name}: 开源未来馆必须是 artists:[] / works:0 / frames:6`);
    }
  }
}

function contentSignature(config) {
  return (config.wings || []).map((wing) => ({
    id: wing.id,
    type: wing.type,
    frames: wing.frames,
    artists: (wing.artists || []).map((artist) => ({
      id: artist.id,
      works: (artist.works || []).map((work) => ({ id: work.id, file: work.file, depth: work.depth || '' })),
    })),
  }));
}

for (const [name, config] of parsedConfigs) {
  const alternate = config.altLang?.config;
  if (!alternate || !parsedConfigs.has(alternate)) continue;
  const current = JSON.stringify(contentSignature(config));
  const translated = JSON.stringify(contentSignature(parsedConfigs.get(alternate)));
  if (current !== translated) fail(`${name}: 与 ${alternate} 的馆/艺术家/画作结构不一致`);
}

const variantPath = path.join(ROOT, 'src', 'appVariant.js');
if (!fs.existsSync(variantPath)) fail('缺少 src/appVariant.js');
else {
  const variant = fs.readFileSync(variantPath, 'utf8');
  const sculpture = variant.match(/SCULPTURE_MODEL\s*=\s*['"]([^'"]+)['"]/u)?.[1];
  const sculptureFile = sculpture && localPublicFile('appVariant.js', sculpture, 'SCULPTURE_MODEL');
  if (!sculpture || !sculptureFile || !fs.existsSync(sculptureFile)) {
    fail(`appVariant.js: 缺雕塑资源 ${sculpture || '(unreadable)'}`);
  }
}

function scanSymlinks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', 'shots', '_handoff'].includes(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (fs.lstatSync(abs).isSymbolicLink()) fail(`不允许软链接: ${path.relative(ROOT, abs)}`);
    else if (entry.isDirectory()) scanSymlinks(abs);
  }
}
if (PUBLIC_MODE) scanSymlinks(ROOT);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`config check ok (${configFiles.length} configs, ${PUBLIC_MODE ? 'official public demo' : 'customizable project'} mode)`);
}
