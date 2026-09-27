// 发布资产采用“明确许可白名单”：换名、改动文件或未登记的新模型都不会自动通过。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_VARIANT_FILE = path.join(ROOT, 'src', 'appVariant.js');
const LICENSE_MANIFEST_FILE = path.join(ROOT, 'scripts', 'release-asset-licenses.json');
const ART_MANIFEST_FILE = path.join(ROOT, 'public', 'art', 'sources.manifest.json');
const PUBLIC_CONFIG_FILE = path.join(ROOT, 'public', 'gallery.config.json');
const README_FILES = ['README.md', 'README.zh-CN.md'];
const SCREENSHOT_DIR = 'docs/screenshots';
const APPROVED_LICENSES = new Set([
  'CC0-1.0',
  'PDM-1.0', // Creative Commons Public Domain Mark：来源方声明作品已无版权限制

  'CC-BY-1.0',
  'CC-BY-2.0',
  'CC-BY-2.5',
  'CC-BY-3.0',
  'CC-BY-4.0',
]);
const APPROVED_ARTWORK_LICENSES = new Set([
  'public domain',
  'cc0',
  'cc0 1.0',
  'cc0 1.0 universal',
  'cc by 1.0',
  'cc by 2.0',
  'cc by 2.5',
  'cc by 3.0',
  'cc by 4.0',
]);

function fail(message) {
  console.error(`release asset check failed: ${message}`);
  process.exitCode = 1;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${path.relative(ROOT, file)}: ${error.message}`);
  }
}

function readConfiguredSculpturePath() {
  let source;
  try {
    source = fs.readFileSync(APP_VARIANT_FILE, 'utf8');
  } catch (error) {
    throw new Error(`cannot read src/appVariant.js: ${error.message}`);
  }

  const matches = [...source.matchAll(
    /^\s*export\s+const\s+SCULPTURE_MODEL\s*=\s*(['"])([^'"\r\n]+)\1\s*;?/gm,
  )];
  if (matches.length !== 1) {
    throw new Error(
      'src/appVariant.js must export exactly one literal SCULPTURE_MODEL path',
    );
  }
  return matches[0][2];
}

function validateRelativePublicPath(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (
    value !== value.trim()
    || value.includes('\\')
    || value.includes('?')
    || value.includes('#')
    || value.startsWith('/')
    || /^[a-z][a-z\d+.-]*:/i.test(value)
  ) {
    throw new Error(`${label} must be a plain path relative to public/`);
  }

  const normalized = path.posix.normalize(value);
  if (
    normalized !== value
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
  ) {
    throw new Error(`${label} must not contain traversal or non-canonical segments`);
  }
  return value;
}

function validateApprovedModels(manifest) {
  if (!manifest || manifest.schemaVersion !== 1) {
    throw new Error('release-asset-licenses.json must use schemaVersion 1');
  }
  if (!Array.isArray(manifest.approvedSculptureModels)) {
    throw new Error('approvedSculptureModels must be an array');
  }

  const paths = new Set();
  for (const [index, entry] of manifest.approvedSculptureModels.entries()) {
    const label = `approvedSculptureModels[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${label} must be an object`);
    }
    validateRelativePublicPath(entry.path, `${label}.path`);
    if (paths.has(entry.path)) {
      throw new Error(`${label}.path duplicates another approved model`);
    }
    paths.add(entry.path);

    if (typeof entry.sha256 !== 'string' || !/^[a-f\d]{64}$/.test(entry.sha256)) {
      throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`);
    }
    for (const field of ['creator', 'source', 'licenseUrl', 'reviewedAt', 'reviewer', 'notes']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        throw new Error(`${label}.${field} is required`);
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedAt)) {
      throw new Error(`${label}.reviewedAt must be YYYY-MM-DD`);
    }
    let sourceUrl;
    try {
      sourceUrl = new URL(entry.source);
    } catch {
      throw new Error(`${label}.source must be an absolute http(s) URL`);
    }
    if (!['http:', 'https:'].includes(sourceUrl.protocol)) {
      throw new Error(`${label}.source must be an absolute http(s) URL`);
    }
    if (!APPROVED_LICENSES.has(entry.license)) {
      throw new Error(
        `${label}.license must be an explicit public-domain (CC0 / PDM) or CC-BY identifier `
        + `(${[...APPROVED_LICENSES].join(', ')})`,
      );
    }
    let licenseUrl;
    try {
      licenseUrl = new URL(entry.licenseUrl);
    } catch {
      throw new Error(`${label}.licenseUrl must be an absolute http(s) URL`);
    }
    if (!['http:', 'https:'].includes(licenseUrl.protocol)) {
      throw new Error(`${label}.licenseUrl must be an absolute http(s) URL`);
    }
  }
  return manifest.approvedSculptureModels;
}

function validateApprovedPublicAssets(manifest) {
  if (!Array.isArray(manifest.approvedPublicAssets)) {
    throw new Error('approvedPublicAssets must be an array');
  }
  const paths = new Set();
  for (const [index, entry] of manifest.approvedPublicAssets.entries()) {
    const label = `approvedPublicAssets[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${label} must be an object`);
    }
    validateRelativePublicPath(entry.path, `${label}.path`);
    if (paths.has(entry.path)) throw new Error(`${label}.path is duplicated`);
    paths.add(entry.path);
    if (typeof entry.sha256 !== 'string' || !/^[a-f\d]{64}$/.test(entry.sha256)) {
      throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`);
    }
    if (!APPROVED_LICENSES.has(entry.license)) {
      throw new Error(`${label}.license must be an explicit public-domain (CC0 / PDM) or CC-BY identifier`);
    }
    for (const field of ['creator', 'source', 'licenseUrl', 'reviewedAt', 'reviewer', 'notes']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        throw new Error(`${label}.${field} is required`);
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedAt)) {
      throw new Error(`${label}.reviewedAt must be YYYY-MM-DD`);
    }
    for (const field of ['source', 'licenseUrl']) {
      let url;
      try {
        url = new URL(entry[field]);
      } catch {
        throw new Error(`${label}.${field} must be an absolute http(s) URL`);
      }
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error(`${label}.${field} must be an absolute http(s) URL`);
      }
    }
    const file = path.join(ROOT, 'public', ...entry.path.split('/'));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`approved public asset is missing: public/${entry.path}`);
    }
    if (sha256(file) !== entry.sha256) {
      throw new Error(`public/${entry.path} changed after its license/privacy review`);
    }
  }
  return manifest.approvedPublicAssets;
}

function validateBlockedModels(manifest) {
  if (!Array.isArray(manifest.knownBlockedSculptureModels)) {
    throw new Error('knownBlockedSculptureModels must be an array');
  }
  for (const [index, entry] of manifest.knownBlockedSculptureModels.entries()) {
    const label = `knownBlockedSculptureModels[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${label} must be an object`);
    }
    validateRelativePublicPath(entry.path, `${label}.path`);
    if (typeof entry.sha256 !== 'string' || !/^[a-f\d]{64}$/.test(entry.sha256)) {
      throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`);
    }
    if (typeof entry.source !== 'string' || !entry.source.trim()) {
      throw new Error(`${label}.source is required`);
    }
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new Error(`${label}.reason is required`);
    }
  }
  return manifest.knownBlockedSculptureModels;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function validateReviewedScreenshots(manifest) {
  const artifacts = manifest?.manualReview?.artifacts;
  if (!Array.isArray(artifacts)) {
    throw new Error('manualReview.artifacts must be an array');
  }

  const referenced = new Set();
  for (const readme of README_FILES) {
    const body = fs.readFileSync(path.join(ROOT, readme), 'utf8');
    for (const match of body.matchAll(/\((docs\/screenshots\/[^)\s]+)\)/g)) {
      referenced.add(match[1]);
    }
  }
  const onDisk = fs.readdirSync(path.join(ROOT, SCREENSHOT_DIR))
    .filter((name) => /\.(?:png|jpe?g|webp)$/i.test(name))
    .map((name) => `${SCREENSHOT_DIR}/${name}`);
  const stale = onDisk.filter((file) => !referenced.has(file));
  if (stale.length) {
    throw new Error(`unreferenced documentation screenshots must be removed: ${stale.join(', ')}`);
  }

  const reviewedPaths = new Set();
  for (const [index, artifact] of artifacts.entries()) {
    const label = `manualReview.artifacts[${index}]`;
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      throw new Error(`${label} must be an object`);
    }
    if (typeof artifact.path !== 'string' || !artifact.path.startsWith(`${SCREENSHOT_DIR}/`)) {
      throw new Error(`${label}.path must point inside ${SCREENSHOT_DIR}/`);
    }
    if (reviewedPaths.has(artifact.path)) throw new Error(`${label}.path is duplicated`);
    reviewedPaths.add(artifact.path);
    if (typeof artifact.sha256 !== 'string' || !/^[a-f\d]{64}$/.test(artifact.sha256)) {
      throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(artifact.reviewedAt || '')) {
      throw new Error(`${label}.reviewedAt must be YYYY-MM-DD`);
    }
    for (const field of ['reviewer', 'decision', 'notes']) {
      if (typeof artifact[field] !== 'string' || !artifact[field].trim()) {
        throw new Error(`${label}.${field} is required`);
      }
    }
    if (artifact.decision !== 'approved') {
      throw new Error(`${label}.decision must be approved for a public release`);
    }
  }

  for (const screenshot of referenced) {
    const file = path.join(ROOT, ...screenshot.split('/'));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`README screenshot is missing: ${screenshot}`);
    }
    const review = artifacts.find((artifact) => artifact.path === screenshot);
    if (!review) {
      throw new Error(`${screenshot} has no manual privacy/branding review record`);
    }
    const digest = sha256(file);
    if (review.sha256 !== digest) {
      throw new Error(
        `${screenshot} changed after manual review (expected ${review.sha256}, got ${digest})`,
      );
    }
  }
  console.log(`documentation screenshot review ok (${referenced.size} approved images)`);
}

function isApprovedArtworkLicense(value) {
  const normalized = String(value || '').replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ').toLowerCase();
  return APPROVED_ARTWORK_LICENSES.has(normalized);
}

function validateArtworkProvenance() {
  const config = readJson(PUBLIC_CONFIG_FILE);
  const manifest = readJson(ART_MANIFEST_FILE);
  if (manifest?.schemaVersion !== 1 || !manifest.files || typeof manifest.files !== 'object') {
    throw new Error('public/art/sources.manifest.json must use schemaVersion 1 and contain files');
  }

  const works = [];
  for (const wing of config.wings || []) {
    for (const artist of wing.artists || []) {
      for (const work of artist.works || []) works.push(work);
    }
  }
  const paths = works.map((work) => work.file);
  if (paths.some((file) => typeof file !== 'string' || !/^art\/[A-Za-z0-9._-]+\.jpe?g$/i.test(file))) {
    throw new Error('official demo artwork paths must be flat JPEG files inside public/art/');
  }
  if (new Set(paths).size !== paths.length) throw new Error('official demo artwork paths must be unique');

  const expectedNames = new Set(paths.map((file) => path.posix.basename(file)));
  const actualNames = fs.readdirSync(path.join(ROOT, 'public', 'art'))
    .filter((name) => /\.jpe?g$/i.test(name));
  const unconfigured = actualNames.filter((name) => !expectedNames.has(name));
  if (unconfigured.length) {
    throw new Error(`unconfigured artwork files must be removed: ${unconfigured.join(', ')}`);
  }

  const manifestNames = Object.keys(manifest.files);
  const staleRecords = manifestNames.filter((name) => !expectedNames.has(name));
  if (staleRecords.length) {
    throw new Error(`stale artwork provenance records must be removed: ${staleRecords.join(', ')}`);
  }

  for (const work of works) {
    const name = path.posix.basename(work.file);
    const record = manifest.files[name];
    const label = `art provenance ${name}`;
    if (!record || typeof record !== 'object') throw new Error(`${label} is missing`);
    if (record.workId !== work.id) throw new Error(`${label}.workId must match config work.id`);
    if (record.localPath !== `public/${work.file}`) throw new Error(`${label}.localPath is wrong`);
    if (!isApprovedArtworkLicense(record.licenseShortName)) {
      throw new Error(`${label} has an unapproved license: ${record.licenseShortName || 'missing'}`);
    }
    if (typeof record.commonsFileTitle !== 'string' || !record.commonsFileTitle.startsWith('File:')) {
      throw new Error(`${label}.commonsFileTitle is required`);
    }
    let sourceUrl;
    try {
      sourceUrl = new URL(record.canonicalDescriptionUrl);
    } catch {
      throw new Error(`${label}.canonicalDescriptionUrl must be an absolute URL`);
    }
    if (sourceUrl.protocol !== 'https:' || sourceUrl.hostname !== 'commons.wikimedia.org') {
      throw new Error(`${label}.canonicalDescriptionUrl must use https://commons.wikimedia.org/`);
    }
    if (String(record.licenseShortName).toLowerCase().startsWith('cc by')) {
      if (!(String(record.artist || '').trim() || String(record.credit || '').trim())) {
        throw new Error(`${label} CC BY record needs Artist or Credit metadata`);
      }
      if (!String(record.licenseUrl || '').trim()) throw new Error(`${label} CC BY record needs licenseUrl`);
    }

    const file = path.join(ROOT, 'public', ...work.file.split('/'));
    const stats = fs.statSync(file);
    if (record.bytes !== stats.size) throw new Error(`${label}.bytes does not match the local file`);
    if (record.sha256 !== sha256(file)) throw new Error(`${label}.sha256 does not match the local file`);
  }
  console.log(`artwork provenance check ok (${works.length} licensed files)`);
  return { manifest, artworkPaths: paths };
}

function validatePublicInventory({ artworkManifest, artworkPaths, configuredSculpture, publicAssets }) {
  const accounted = new Set([
    ...fs.readdirSync(path.join(ROOT, 'public'))
      .filter((name) => /^gallery\.config(?:\.[\w-]+)?\.json$/.test(name)),
    'art/sources.manifest.json',
    configuredSculpture,
    ...artworkPaths,
    ...publicAssets.map((entry) => entry.path),
  ]);
  for (const record of Object.values(artworkManifest.files)) {
    accounted.add(String(record.localPath || '').replace(/^public\//, ''));
  }

  const actual = [];
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else actual.push(rel);
    }
  };
  walk(path.join(ROOT, 'public'));
  const unexpected = actual.filter((file) => !accounted.has(file));
  const missing = [...accounted].filter((file) => !actual.includes(file));
  if (unexpected.length) throw new Error(`unreviewed files exist in public/: ${unexpected.join(', ')}`);
  if (missing.length) throw new Error(`reviewed public asset is missing: ${missing.join(', ')}`);
  console.log(`public asset inventory ok (${actual.length} accounted files)`);
}

try {
  const configuredPath = validateRelativePublicPath(
    readConfiguredSculpturePath(),
    'SCULPTURE_MODEL',
  );
  const sculptureFile = path.join(ROOT, 'public', ...configuredPath.split('/'));
  if (!fs.existsSync(sculptureFile) || !fs.statSync(sculptureFile).isFile()) {
    throw new Error(
      `configured sculpture is missing: public/${configuredPath}; `
      + 'update the model file and license manifest together',
    );
  }

  const manifest = readJson(LICENSE_MANIFEST_FILE);
  const approvedModels = validateApprovedModels(manifest);
  const blockedModels = validateBlockedModels(manifest);
  const publicAssets = validateApprovedPublicAssets(manifest);
  const artwork = validateArtworkProvenance();
  validateReviewedScreenshots(manifest);
  const digest = sha256(sculptureFile);
  validatePublicInventory({
    artworkManifest: artwork.manifest,
    artworkPaths: artwork.artworkPaths,
    configuredSculpture: configuredPath,
    publicAssets,
  });
  const knownBlock = blockedModels.find(
    (entry) => entry.path === configuredPath || entry.sha256 === digest,
  );
  if (knownBlock) {
    throw new Error(
      `public/${configuredPath} is explicitly blocked: ${knownBlock.reason} `
      + `(current SHA-256 ${digest}); a blocked path or hash cannot be approved `
      + 'without first removing its reviewed block record',
    );
  }
  const matchingPath = approvedModels.find((entry) => entry.path === configuredPath);

  if (!matchingPath) {
    throw new Error(
      `public/${configuredPath} is not on the approved sculpture license list `
      + `(SHA-256 ${digest}); add a reviewed CC0/CC-BY record before release`,
    );
  }
  if (matchingPath.sha256 !== digest) {
    throw new Error(
      `public/${configuredPath} does not match its approved SHA-256 `
      + `(expected ${matchingPath.sha256}, got ${digest}); `
      + 'changed assets require a new license review',
    );
  }

  console.log(
    `release asset check ok: public/${configuredPath} `
    + `(${matchingPath.license}, ${matchingPath.creator.trim()})`,
  );
} catch (error) {
  fail(error.message);
}
