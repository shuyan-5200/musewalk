// 可失败的发布前巡检：真实 DOM 点击 + 核心动线 + 控制台零错误。
// 用法：VERIFY_URL=http://127.0.0.1:5175 VERIFY_TOUCH=1 VERIFY_LABEL=touch-zh node scripts/verify.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERIFY_URL = process.env.VERIFY_URL || 'http://127.0.0.1:5173';
const TOUCH = process.env.VERIFY_TOUCH === '1';
const VERIFY_LABEL = process.env.VERIFY_LABEL || (TOUCH ? 'touch' : 'desktop');
const OUT = fileURLToPath(new URL(`../shots/verify-${VERIFY_LABEL}/`, import.meta.url));
// 慢速环境（如没有显卡的 CI 机器，软件渲染可能不到 1 帧/秒）：VERIFY_SLOW=1 把等待时间放宽 4 倍。
// VERIFY_SIZE=800x500 可缩小桌面窗口，减轻软件渲染负担。
const SLOW = process.env.VERIFY_SLOW === '1';
const T = (ms) => (SLOW ? ms * 4 : ms);
const [SIZE_W, SIZE_H] = (process.env.VERIFY_SIZE || '1366x860').split('x').map(Number);
const VIEWPORT = TOUCH
  ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { width: SIZE_W || 1366, height: SIZE_H || 860, deviceScaleFactor: 1 };
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function browserPath() {
  const explicit = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : ['google-chrome', 'chromium', 'chromium-browser'];
  for (const candidate of candidates) {
    if (candidate.startsWith('/') && fs.existsSync(candidate)) return candidate;
    try {
      const found = execFileSync('which', [candidate], { encoding: 'utf8' }).trim();
      if (found) return found;
    } catch {}
  }
  throw new Error('未找到 Chrome/Chromium：请通过 CHROME_PATH 指定。');
}

const browser = await puppeteer.launch({
  executablePath: browserPath(),
  headless: true,
  timeout: T(120000),
  protocolTimeout: T(120000),
  args: [
    '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
  ],
});

const page = await browser.newPage();
await page.setViewport(VIEWPORT);

const problems = [];
let watchNavigation = false;
const fail = (message) => problems.push(message);
const assert = (ok, message) => { if (!ok) fail(`[assert] ${message}`); };

page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    fail(`[console.${message.type()}] ${message.text()}`);
  }
});
page.on('pageerror', (error) => fail(`[pageerror] ${error.message}`));
page.on('requestfailed', (request) => fail(`[requestfailed] ${request.url()} ${request.failure()?.errorText}`));
page.on('framenavigated', (frame) => {
  if (watchNavigation && frame === page.mainFrame()) fail(`[navigation] 出现非预期整页导航：${frame.url()}`);
});

const inState = (state, timeout = 90000) =>
  page.waitForFunction((expected) => window.__musewalk?.state?.() === expected, { timeout: T(timeout) }, state);
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}${name}.png` });
  const state = await page.evaluate(() => window.__musewalk?.state?.() ?? '?');
  console.log(`shot: ${name} state: ${state}`);
};
const soundState = () => page.evaluate(() => {
  const button = document.querySelector('.sound-btn');
  const rect = button?.getBoundingClientRect();
  const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
  return {
    muted: window.__musewalk?.audioMuted?.(),
    pressed: button?.getAttribute('aria-pressed'),
    on: button?.classList.contains('on'),
    visible: !!button && getComputedStyle(button).pointerEvents !== 'none' && getComputedStyle(button).display !== 'none',
    hitSelf: !!button && (hit === button || button.contains(hit)),
  };
});
const clickSoundAndCheck = async (expectedMuted, scene) => {
  const beforeUrl = page.url();
  const before = await soundState();
  assert(before.visible && before.hitSelf, `${scene}：音乐按钮不可点或被隐形层遮挡`);
  await page.click('.sound-btn');
  await sleep(120);
  const after = await soundState();
  assert(page.url() === beforeUrl, `${scene}：点音乐后 URL 变化`);
  assert(after.muted === expectedMuted, `${scene}：音乐逻辑状态错误`);
  assert(after.on === !expectedMuted && after.pressed === String(!expectedMuted), `${scene}：视觉/aria 状态与音乐不一致`);
};
// 第一人称半径要等镜头阻尼收敛再判断：软渲染帧率抖动时，状态切换那一刻可能还差几毫米。
const settledRadius = async (limit = 0.01, timeout = T(2000)) => {
  try {
    await page.waitForFunction((max) => window.__musewalk.viewRadius() < max, { timeout, polling: 50 }, limit);
  } catch {}
  return page.evaluate(() => window.__musewalk.viewRadius());
};
let labels = {}; // 当前配置的界面文案（进页面后读取）
// 右上角回退键（音乐键旁边那颗）：文案、是否可见、是否真的点得到（没被别的层挡住）。
const homeState = () => page.evaluate(() => {
  const button = document.querySelector('.hud-tools .tool-btn:not(.sound-btn)');
  if (!button) return { visible: false };
  const style = getComputedStyle(button);
  const tools = button.closest('.hud-tools');
  const rect = button.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return {
    label: button.firstChild?.textContent || '',
    visible: style.display !== 'none' && tools.classList.contains('show') && rect.width > 0,
    clickable: style.pointerEvents !== 'none' && (hit === button || button.contains(hit)),
  };
});
const expectHome = async (expectedLabel, scene) => {
  const home = await homeState();
  assert(home.visible && home.clickable, `${scene}：右上角回退键不可见或点不到`);
  assert(home.label === expectedLabel, `${scene}：右上角回退键应为「${expectedLabel}」，实际「${home.label}」`);
};
const clickHomeBackToHall = async (scene) => {
  await expectHome(labels.galleryHomeLabel, scene);
  await page.click('.hud-tools .tool-btn:not(.sound-btn)');
  await inState('hall');
  await expectHome(labels.wingHomeLabel, `${scene}返回后的展廊`);
};
const enterDreamFromFocus = async () => {
  if (TOUCH) {
    await page.touchscreen.tap(Math.round(VIEWPORT.width * 0.5), Math.round(VIEWPORT.height * 0.45));
    await sleep(T(420)); // 单击需等待 300ms，以便与双击返回区分。
  } else {
    // 信息面板从右侧滑入（约 1s）：按钮完整进入视口后再点
    await page.waitForFunction(() => {
      const button = document.querySelector('.panel.show .p-enter');
      if (!button) return false;
      const rect = button.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1 && rect.left >= 0 && rect.right <= innerWidth + 1;
    }, { timeout: T(5000) });
    await page.click('.p-enter');
  }
  await inState('dream');
};

try {
  await page.goto(VERIFY_URL, { waitUntil: 'networkidle2', timeout: T(90000) });
  await inState('landing');
  await page.waitForSelector('.l-enter:not([disabled])', { timeout: T(90000) });
  await page.waitForSelector('.veil.hidden', { timeout: T(10000) });
  watchNavigation = true;

  const summary = await page.evaluate(() => window.__musewalk.configSummary());
  labels = await page.evaluate(() => window.__musewalk.labels());
  assert(summary.depthPolicy === 'uniform-auto', '发布基线必须是全馆 uniform-auto 深度策略');
  // 巡检目标从配置里取：官方 Demo 固定走梵高《星月夜》；自己的美术馆取第一个常规馆的第一位艺术家。
  // 也可以用 VERIFY_WING / VERIFY_ARTIST / VERIFY_WORK 指定。
  const collections = summary.wings.filter((wing) => wing.type === 'collection' && !wing.comingSoon && wing.artists.length);
  const preferred = collections.find((wing) => wing.id === 'modern' && wing.artists.includes('vangogh'));
  const targetWing = collections.find((wing) => wing.id === process.env.VERIFY_WING) || preferred || collections[0];
  if (!targetWing) throw new Error('配置里没有可进入的常规馆（type: collection 且至少一位艺术家）');
  const targetArtist = (process.env.VERIFY_ARTIST && targetWing.artists.includes(process.env.VERIFY_ARTIST))
    ? process.env.VERIFY_ARTIST
    : (targetWing === preferred ? 'vangogh' : targetWing.artists[0]);
  const targetWork = process.env.VERIFY_WORK || (targetArtist === 'vangogh' ? 'vangogh-starry' : null);
  const workLabel = targetWork ? targetWork.replace(`${targetArtist}-`, '') : 'first';
  const openWingIndex = summary.wings.findIndex((wing) => wing.type === 'open');
  const lastWingIndex = openWingIndex >= 0 ? openWingIndex : summary.wings.length - 1;
  console.log(`targets: ${targetWing.id} / ${targetArtist} / ${targetWork || '(first work)'}`);
  const landingSound = await soundState();
  assert(landingSound.muted === true && landingSound.on === false && landingSound.pressed === 'false', '落地页音乐应默认关闭');
  await clickSoundAndCheck(false, '落地页');
  await clickSoundAndCheck(true, '落地页');
  await shot('1-landing');

  const startPos = await page.evaluate(() => window.__musewalk.pos());
  await page.click('.l-enter');
  await sleep(80);
  const firstPos = await page.evaluate(() => window.__musewalk.pos());
  const firstStep = Math.hypot(firstPos[0] - startPos[0], firstPos[1] - startPos[1], firstPos[2] - startPos[2]);
  assert(firstStep < 0.8, `入场首帧跳动过大：${firstStep.toFixed(2)}m`);
  await inState('lobby');
  const viewRadius = await settledRadius();
  assert(viewRadius < 0.01, `入场后第一人称镜头半径异常：${viewRadius.toFixed(4)}m`);
  await clickSoundAndCheck(false, '大厅');
  await clickSoundAndCheck(true, '大厅');
  await shot('2-lobby');

  const p0 = await page.evaluate(() => window.__musewalk.pos());
  await page.keyboard.down('KeyW');
  let walked = 0;
  for (let i = 0; i < (SLOW ? 240 : 40) && walked < 1; i++) {
    await sleep(250);
    const p1 = await page.evaluate(() => window.__musewalk.pos());
    walked = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  }
  await page.keyboard.up('KeyW');
  // SwiftShader 软渲染帧率不稳，这里只守「键盘行走真的产生位移」，不把它误当性能测试。
  assert(walked >= 0.5, `WASD 位移不足：${walked.toFixed(2)}m`);
  await page.evaluate(() => window.__musewalk.gotoLobby());

  for (const [i, step] of [[0, 3], [1, 4]]) {
    if (!summary.wings[i]) continue;
    await page.evaluate((index) => window.__musewalk.gotoWing(index), i);
    await sleep(600);
    await shot(`${step}-corridor-${summary.wings[i].id}`);
  }

  await page.evaluate((wingId, artistId) => window.__musewalk.enterGalleryById(wingId, artistId), targetWing.id, targetArtist);
  await page.waitForSelector('.hall-intro.show', { timeout: T(90000) });
  await page.waitForSelector('.gi-go.show', { timeout: T(120000) });
  await clickSoundAndCheck(false, '展廊引言过场');
  await clickSoundAndCheck(true, '展廊引言过场');
  await shot('5-gallery-intro');
  await page.click('.hall-intro');
  await inState('hall');
  await sleep(1200); // 等入馆粒子退场，确保展廊稳定且截图可用于公开文档。
  await clickSoundAndCheck(false, '展廊');
  await clickSoundAndCheck(true, '展廊');
  await shot(`6-gallery-${targetArtist}`);

  await page.evaluate((workId) => window.__musewalk.focusWork(workId), targetWork);
  await page.waitForSelector('.panel.show', { timeout: T(90000) });
  await clickSoundAndCheck(false, '品读');
  await clickSoundAndCheck(true, '品读');
  const firstFocusRadius = await page.evaluate(() => window.__musewalk.viewRadius());
  assert(Math.abs(firstFocusRadius - 1) < 0.02, `首次品读构图半径异常：${firstFocusRadius.toFixed(4)}m`);
  await shot(`7-focus-${workLabel}`);
  await enterDreamFromFocus();
  assert(await page.evaluate(() => window.__musewalk.dreamMode()) === 'flat', '入画必须默认为原作平面');
  await clickSoundAndCheck(false, '原作画境');
  await page.click('.dream-mode');
  await page.waitForFunction(() => window.__musewalk.dreamMode() === 'solid', { timeout: T(3000) });
  await page.click('.dream-mode');
  await page.waitForFunction(() => window.__musewalk.dreamMode() === 'flat', { timeout: T(3000) });
  await shot('8-dream-flat-default');

  // 用立体模式进星尘，验证「回到画境」保留用户的上一步选择。
  await page.click('.dream-mode');
  await page.waitForFunction(() => window.__musewalk.dreamMode() === 'solid', { timeout: T(3000) });
  await page.click('.dream-star');
  await inState('immersion');
  await clickSoundAndCheck(true, '星尘');
  await shot('9-stardust');

  await page.click('.imm-back');
  await inState('dream');
  assert(await page.evaluate(() => window.__musewalk.dreamMode()) === 'solid', '回到画境应保留离开前的立体模式');
  await page.click('.dream-exit');
  await inState('focus');
  const returnedFocusRadius = await page.evaluate(() => window.__musewalk.viewRadius());
  assert(Math.abs(returnedFocusRadius - firstFocusRadius) < 0.02, '画境返回后应原样恢复品读构图');

  // 从画前重新进入仍必须回到默认原画；再走一遍星尘退出路径。
  if (!TOUCH) {
    await page.waitForFunction(() => {
      const button = document.querySelector('.panel.show .p-enter');
      if (!button) return false;
      const rect = button.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1 && rect.left >= 0 && rect.right <= innerWidth + 1;
    }, { timeout: T(5000) });
  }
  await enterDreamFromFocus();
  assert(await page.evaluate(() => window.__musewalk.dreamMode()) === 'flat', '从画前重新入画必须默认原画');
  await page.click('.dream-star');
  await inState('immersion');
  await page.click('.imm-exit');
  await inState('focus');
  const stardustFocusRadius = await page.evaluate(() => window.__musewalk.viewRadius());
  assert(Math.abs(stardustFocusRadius - firstFocusRadius) < 0.02, '星尘返回后应原样恢复品读构图');
  await shot('10-back-to-focus');
  await expectHome(labels.galleryHomeLabel, '品读');

  if (TOUCH) {
    // Headless Chrome 会合并连续 touchscreen.tap；在真实 canvas 上派发两组 pointer
    // 序列验证 300ms 双击状态机。原生触摸手感仍需真机终检。
    await page.evaluate(async () => {
      const canvas = document.querySelector('#scene');
      const tap = () => {
        const init = { bubbles: true, clientX: innerWidth / 2, clientY: innerHeight * 0.45, button: 0, pointerType: 'touch' };
        canvas.dispatchEvent(new PointerEvent('pointerdown', init));
        canvas.dispatchEvent(new PointerEvent('pointerup', init));
      };
      tap();
      await new Promise((resolve) => setTimeout(resolve, 100));
      tap();
    });
  } else {
    await page.keyboard.press('Escape');
  }
  await inState('hall');
  const releasedRadius = await settledRadius();
  assert(releasedRadius < 0.01, `退出品读后漫游镜头半径异常：${releasedRadius.toFixed(4)}m`);
  await expectHome(labels.wingHomeLabel, '展廊');

  // 右上角「回展廊」：品读、画境、星尘三处都要一键回到展廊。
  await page.evaluate((workId) => window.__musewalk.focusWork(workId), targetWork);
  await page.waitForSelector('.panel.show', { timeout: T(90000) });
  await clickHomeBackToHall('品读');
  await page.evaluate((workId) => window.__musewalk.focusWork(workId), targetWork);
  await page.waitForSelector('.panel.show', { timeout: T(90000) });
  await enterDreamFromFocus();
  await clickHomeBackToHall('画境');
  await page.evaluate((workId) => window.__musewalk.focusWork(workId), targetWork);
  await page.waitForSelector('.panel.show', { timeout: T(90000) });
  await enterDreamFromFocus();
  await page.click('.dream-star');
  await inState('immersion');
  await clickHomeBackToHall('星尘');
  const homeRadius = await settledRadius();
  assert(homeRadius < 0.01, `一键回展廊后漫游镜头半径异常：${homeRadius.toFixed(4)}m`);
  await page.evaluate(() => window.__musewalk.backToLobby());
  await inState('lobby');
  await page.evaluate((index) => window.__musewalk.gotoWing(index), lastWingIndex);
  await sleep(500);
  await shot(`11-corridor-${summary.wings[lastWingIndex].id}`);
  await page.evaluate(() => window.__musewalk.gotoLobby());
  await shot('12-rotunda');
} catch (error) {
  fail(`[verify] ${error.stack || error.message}`);
} finally {
  console.log('\n--- problems ---');
  console.log(problems.length ? problems.slice(0, 60).join('\n') : '(none)');
  await browser.close();
}

if (problems.length) process.exitCode = 1;
