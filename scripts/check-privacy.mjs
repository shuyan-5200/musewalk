// 开源发布隐私门禁：扫描会进入仓库的文件，阻断本机路径、邮箱、密钥和本地私稿目录。
// 维护者可以额外提供一份不进仓库的词表（每行一个词，大小写不敏感）：
//   MUSEWALK_PRIVATE_WORDS=/path/to/private-words.txt node scripts/check-privacy.mjs
// 词表里以 `allow <相对路径> <词>` 开头的行表示已知例外，例如公开署名里的正式名称。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'shots']);
const TEXT_EXTENSIONS = new Set([
  '.css', '.html', '.js', '.mjs', '.cjs', '.json', '.md', '.txt', '.yaml', '.yml', '.py', '.sh', '.toml', '.svg',
]);
const SELF = path.relative(ROOT, fileURLToPath(import.meta.url));

// 通用规则：任何公开仓库都不该出现的内容。
const RULES = [
  { label: 'local absolute path', pattern: /\/Users\/[^/\s'"`]+|\/home\/[^/\s'"`]+|[A-Za-z]:\\Users\\/gu },
  { label: 'email address', pattern: /[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com\b)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gu },
  { label: 'secret-like token', pattern: /ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|npm_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/gu },
  { label: 'unfilled placeholder', pattern: /YOUR-USERNAME|\[REPO_URL\]|\[DEMO_URL\]/gu },
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadPrivateWords() {
  const file = process.env.MUSEWALK_PRIVATE_WORDS;
  if (!file) return { words: null, allow: [] };
  const abs = path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) throw new Error(`MUSEWALK_PRIVATE_WORDS 指向的文件不存在：${abs}`);
  const words = [];
  const allow = [];
  for (const raw of fs.readFileSync(abs, 'utf8').split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const allowed = /^allow\s+(\S+)\s+(.+)$/u.exec(line);
    if (allowed) allow.push({ file: allowed[1], word: allowed[2].toLowerCase() });
    else words.push(line);
  }
  if (!words.length) return { words: null, allow };
  return {
    words: new RegExp(words.map(escapeRegExp).join('|'), 'giu'),
    count: words.length,
    allow,
  };
}

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) return [];
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(abs);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (rel === SELF.split(path.sep).join('/')) return [];
    return [rel];
  });
}

const problems = [];
let privateWords;
try {
  privateWords = loadPrivateWords();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const isAllowed = (rel, word) => privateWords.allow.some(
  (entry) => entry.file === rel && entry.word === word.toLowerCase(),
);

if (fs.existsSync(path.join(ROOT, '_handoff'))) {
  problems.push('private directory exists inside public project: _handoff/');
}

for (const rel of filesUnder(ROOT)) {
  const name = path.posix.basename(rel);
  if (/^\.env(?:\..+)?$/u.test(name) && name !== '.env.example') {
    problems.push(`environment file must not be published: ${rel}`);
  }
  if (privateWords.words) {
    privateWords.words.lastIndex = 0;
    const match = privateWords.words.exec(rel);
    if (match && !isAllowed(rel, match[0])) problems.push(`private word: filename: ${rel}`);
  }
  if (!TEXT_EXTENSIONS.has(path.extname(rel).toLowerCase())) continue;
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/u);
  lines.forEach((line, index) => {
    const rules = privateWords.words
      ? [...RULES, { label: 'private word', pattern: privateWords.words }]
      : RULES;
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      for (const match of line.matchAll(rule.pattern)) {
        if (rule.label === 'private word' && isAllowed(rel, match[0])) continue;
        problems.push(`${rule.label}: ${rel}:${index + 1}: ${line.trim().slice(0, 160)}`);
        break;
      }
    }
  });
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  const extra = privateWords.words ? ` + ${privateWords.count} private words` : '';
  console.log(`privacy check ok (generic rules${extra})`);
}
