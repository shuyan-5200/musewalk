// ============================================================
//  入画美术馆 · MUSEWALK — 主程序（状态机与交互路由）
//  空间层级：大厅+馆廊（连续空间） → 艺术家展廊 → 品读 → 入画 → 星尘
// ============================================================
// 字体随站点自托管（不依赖 Google Fonts，国内也能加载）；中文按 unicode-range 分片，只下载用到的字。
import '@fontsource-variable/noto-serif-sc';
import '@fontsource-variable/cormorant-garamond';
import '@fontsource-variable/cormorant-garamond/wght-italic.css';
import './styles.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HINTS, loadGallery } from './data.js';
import { createUI } from './ui.js';
import { CameraRig } from './cameraRig.js';
import { createLobby } from './lobby.js';
import { createHall } from './hall.js';
import { Dream } from './dream.js';
import { Immersion } from './immersion.js';
import { createComposer, makeRipple } from './fx.js';
import { AmbientAudio } from './audio.js';
import {
  updateTweens, tween, clamp, lerp, easeOutCubic, easeInOutSine, isSharedTexture,
} from './utils.js';
// 触摸端判定（唯一开关：驱动 CSS body.is-touch 与下方所有移动端分支；PC 不进任何分支）
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches;
if (IS_TOUCH) document.body.classList.add('is-touch');

// 触摸端提示文案：去掉键盘相关、补充手势引导。H 在 boot 装载 config 后才定稿——
// config 的 hints 块可整体覆盖 HINTS（中/英由 config 决定，引擎缺省英文、不写死语言）
let H = HINTS;
const deriveHints = () => {
  H = IS_TOUCH ? {
    ...HINTS,
    lobby: HINTS.touchLobby, hall: HINTS.touchHall,
    focus: HINTS.touchFocus, dream: HINTS.touchDream,
  } : { ...HINTS };
};

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_TOUCH, powerPreference: 'high-performance' });
// 手机 GPU 弱：DPR 封顶 1.5（PC 维持 2），渲染像素大幅下降，点击滑行更丝滑
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
const TEXTURE_ANISOTROPY = Math.min(renderer.capabilities.getMaxAnisotropy(), IS_TOUCH ? 4 : 8);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 160);
const rig = new CameraRig(camera, canvas);
const audio = new AmbientAudio();
const dream = new Dream(IS_TOUCH);
const immersion = new Immersion(rig, IS_TOUCH);

const pmrem = new THREE.PMREMGenerator(renderer);
const roomEnvironment = new RoomEnvironment();
const envTarget = pmrem.fromScene(roomEnvironment, 0.04);
const envTex = envTarget.texture;
roomEnvironment.dispose();
pmrem.dispose();

const { composer, renderPass, bloom } = createComposer(renderer, new THREE.Scene(), camera);
let bloomTarget = 0.42; // 大厅暗场聚光，展廊 0.55，画中 0.78

// ---------- 状态 ----------
let state = 'boot'; // boot | landing | lobby | transition | hall | focus | dream(入画) | immersion(星尘)
let gallery = null;      // 馆藏配置（boot 时装载）
let museum = null;       // 大厅 + 馆廊（连续空间）
let portalTextures = null; // 各艺术家代表作纹理（大厅已加载，进展廊粒子过场复用）
let active = null;
let currentHall = null;  // 当前艺术家展廊 wrap
let currentDoor = null;  // {wingIndex, artistIndex}
let focusEntry = null;
let focusReturn = 'hall';// 品读/画境结束后回到哪里：'hall' 展厅 | 'lobby' 馆廊（未来馆就地品读）
let focusPose = null;    // 品读机位存档：入画/星尘归来时原样落回画前
let dreamReturnMode = 'flat'; // 星尘「回到画境」保留离开前的原画/立体选择
let zone = -1;           // -1 大厅，否则为馆 index

// 界面文案：引擎缺省英文（data.js 的 UI_DEFAULTS），config 的 ui 块可整体覆盖（中文版走此路）
function label(key) {
  return gallery?.ui?.[key] || '';
}
const MAX_CACHED_HALLS = IS_TOUCH ? 1 : 2;
const hallCache = new Map();
const texLoader = new THREE.TextureLoader();

function setActive(wrap) {
  active = wrap;
  renderPass.scene = wrap.scene;
  rig.bounds = wrap.bounds;
}

function disposeTexture(tex, seen) {
  if (!tex?.isTexture || tex === envTex || isSharedTexture(tex) || seen.has(tex)) return;
  seen.add(tex);
  const source = tex.source?.data;
  tex.dispose();
  source?.close?.();
}

function disposeMaterial(mat, seenTextures) {
  if (!mat) return;
  for (const key of Object.keys(mat)) {
    disposeTexture(mat[key], seenTextures);
  }
  mat.dispose?.();
}

function disposeHall(wrap) {
  if (!wrap?.scene) return;
  const seenTextures = new WeakSet();
  wrap.scene.traverse((obj) => {
    obj.dispose?.();
    obj.geometry?.dispose?.();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((mat) => disposeMaterial(mat, seenTextures));
  });
  wrap.scene.clear();
  if (Array.isArray(wrap.targets)) wrap.targets.length = 0;
  if (Array.isArray(wrap.works)) wrap.works.length = 0;
}

function pruneHallCache(currentKey, limit = MAX_CACHED_HALLS) {
  while (hallCache.size > limit) {
    let evicted = false;
    for (const [key, wrap] of hallCache) {
      if (key === currentKey || wrap === currentHall) continue;
      hallCache.delete(key);
      disposeHall(wrap);
      if (import.meta.env.DEV) console.debug('[hall evicted]', key, renderer.info.memory);
      evicted = true;
      break;
    }
    if (!evicted) break;
  }
}

// ---------- UI ----------
const ui = createUI({
  onEnter: enterGalleryWorld,
  onToggleSound: () => ui.setSoundButton(audio.toggleMute()),
  onHome: goHome,
  onEnterPainting: enterDream,
  onClosePanel: closeFocus,
  onExitDream: exitDream,
  onStardust: dreamToStardust,
  onDreamMode: () => { if (state === 'dream') ui.dreamMode(dream.toggleMode()); },
  onBackToDream: stardustToDream,
  onExitImmersion: exitImmersion,
});

// ---------- 字体与纹理装载 ----------
function hallGlyphs(hall) {
  let s = hall.name + hall.latin + hall.intro;
  hall.artists.forEach((a) => {
    s += a.name + a.original + a.dates + a.epithet;
    a.works.forEach((w) => { s += w.title + w.original + w.year; });
  });
  return s;
}

async function ensureFonts(text) {
  const jobs = [];
  ['200', '300', '400'].forEach((w) => {
    jobs.push(document.fonts.load(`${w} 64px "Noto Serif SC Variable"`, text));
    jobs.push(document.fonts.load(`italic ${w} 64px "Cormorant Garamond Variable"`, text));
    jobs.push(document.fonts.load(`${w} 64px "Cormorant Garamond Variable"`, text));
  });
  await Promise.race([
    Promise.allSettled(jobs),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
}

function loadHallTextures(hall) {
  const works = hall.artists.flatMap((a) => a.works);
  return Promise.all(works.map((w) => new Promise((res) => {
    texLoader.load(
      w.file,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = TEXTURE_ANISOTROPY;
        res([w.id, t]);
      },
      undefined,
      () => res([w.id, null]),
    );
  }))).then((pairs) => Object.fromEntries(pairs.filter(([, t]) => t)));
}

// 中厅画屏纹理：每位艺术家取代表作（works[0]），键为艺术家 id
function loadPortalTextures(wings) {
  const jobs = [];
  wings.forEach((w) => {
    if (w.type === 'open') return;
    w.artists.forEach((a) => {
      const work = a.works[0];
      if (!work) return;
      jobs.push(new Promise((res) => {
        texLoader.load(
          work.file,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = TEXTURE_ANISOTROPY;
            res([a.id, t]);
          },
          undefined,
          () => res([a.id, null]),
        );
      }));
    });
  });
  return Promise.all(jobs).then((pairs) => Object.fromEntries(pairs.filter(([, t]) => t)));
}

// 未来馆已挂上的真迹纹理：键为画作 id（供长廊里就地品读/入画使用）
function loadFutureTextures(wings) {
  const jobs = [];
  wings.forEach((w) => {
    if (w.type !== 'open') return;
    (w.artists || []).forEach((a) => (a.works || []).forEach((work) => {
      if (!work.file) return;
      jobs.push(new Promise((res) => {
        texLoader.load(
          work.file,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = TEXTURE_ANISOTROPY;
            res([work.id, t]);
          },
          undefined,
          () => res([work.id, null]),
        );
      }));
    }));
  });
  return Promise.all(jobs).then((pairs) => Object.fromEntries(pairs.filter(([, t]) => t)));
}

// 艺术家展廊的合成描述：氛围继承所在馆、可被 artist.atmosphere 覆写（data.js 已解析为 theme）
function galleryOf(wing, artist) {
  return {
    ...artist.theme,
    no: wing.no,
    name: artist.name,
    short: artist.name,
    latin: artist.original,
    en: '',
    intro: artist.bio,
    artists: [artist],
  };
}

function wingShortName(wing) {
  return (wing?.name || '').split('·')[0].trim() || 'this';
}

// 面包屑里的名字：中文名去掉排版空格（「文森特 · 梵高」→「文森特·梵高」），英文名保留空格。
function crumbName(name = '') {
  return /[\u3400-\u9fff]/u.test(name) ? name.replace(/ /g, '') : name;
}

// ---------- 启动 ----------
async function boot() {
  ui.setLoad(0.05);
  try {
    gallery = await loadGallery();
  } catch (err) {
    ui.bootError(err.message);
    ui.veil(false, { dur: 1200 });
    return;
  }
  deriveHints();                        // config 的 hints 已并入 HINTS，此刻定稿（含触摸端变体）
  ui.setLanding(gallery);
  ui.hud(false, { soundOnly: true, landingMode: true }); // 落地页起即可主动开启音乐
  ui.setLoad(0.1);
  const fontText = (
    'MUSEWALK LOBBY大厅回长廊进入走中返即将开馆虚位以待COMING SOON RESERVED FOR YOU BACK TO THE GALLERIA No.0123456789'
    + Object.values(gallery.ui || {}).join('')
    + gallery.title + gallery.subtitle + gallery.kicker + gallery.tagline
    + gallery.enterLabel + gallery.loadingLine + gallery.footnote
    + gallery.wings.map((w) => w.no + w.name + w.latin + w.short + (w.intro || '')
      + w.artists.map((a) => a.name + a.original + a.dates + a.epithet
        + (w.type === 'open' ? a.works.map((x) => x.title + x.original + x.year).join('') : '')).join('')).join('')
  );
  // 字体、代表作与未来馆纹理互不依赖，并行准备可明显缩短冷启动。
  const [, portalTex, futureTex] = await Promise.all([
    ensureFonts(fontText),
    loadPortalTextures(gallery.wings),
    loadFutureTextures(gallery.wings),
  ]);
  portalTextures = portalTex;
  ui.setLoad(0.7);
  museum = createLobby(gallery, portalTex, futureTex);
  museum.scene.environment = envTex;
  setActive(museum);
  ui.setLoad(0.82);
  await museum.ready;                    // 首屏雕塑真正挂载后再揭幕，避免录屏/冷加载时突然跳出
  // 落地机位：手机竖屏视野窄，后拉抬高让雕塑居中、背后两馆都露出一点；PC 维持原机位
  if (IS_TOUCH) rig.teleport(new THREE.Vector3(0, 2.9, 12.5), 0, -0.035);
  else rig.teleport(new THREE.Vector3(0, 2.6, 10.2), 0, 0);
  ui.setLoad(1);
  state = 'landing';
  ui.veil(false, { dur: 2000 });
}

function enterGalleryWorld() {
  if (state !== 'landing') return;
  state = 'transition';
  ui.hideLanding();
  ui.hud(false, { soundOnly: true });
  // 直接从当前落地机位平滑入场；旧版先瞬移 1.25m 再 glide，会造成单帧跳变。
  rig.glideToPose(museum.entry.pos, museum.entry.yaw, museum.entry.pitch).then(() => {
    state = 'lobby';
    ui.hud(true);
    ui.crumb(label('lobbyCrumbLabel'));
    ui.showHome(false);
    ui.hint(H.lobby);
    audio.setMode('lobby');
  });
}

// ---------- 分区感知（面包屑 / 音景 / 未来馆提示） ----------
let futureHinted = false;
function refreshZone(force = false) {
  if (!museum) return;
  const z = museum.zoneAt(rig.pos);
  if (z === zone && !force) return;
  zone = z;
  if (state !== 'lobby') return;
  if (zone < 0) {
    ui.crumb(label('lobbyCrumbLabel'));
    ui.showHome(false);
    audio.setMode('lobby');
  } else {
    const wing = gallery.wings[zone];
    ui.crumb(`${wing.no} · ${crumbName(wing.name)}`);
    ui.homeButton(label('homeLabel'), label('homeTip'));
    ui.showHome(true);
    audio.setMode('hall');
    if (wing.type === 'open' && !futureHinted) {
      futureHinted = true;
      // 进入未来馆：用艺术家展厅同款卡片承载献词（wing.intro），轻点消散
      ui.hallIntro({ no: wing.no, name: wing.name, latin: wing.latin, intro: wing.intro }, label('futureIntroGoText'));
    }
  }
}

// ---------- 场景流转 ----------
// 幕后构建展廊（命中缓存秒回；否则加载字体 + 全部画作纹理 + 布展）
async function buildHall(wing, artist, key) {
  let wrap = hallCache.get(key);
  if (wrap) {
    hallCache.delete(key);
    hallCache.set(key, wrap);
    return wrap;
  }
  // 新厅纹理解码前就预留一个缓存位，避免瞬时峰值变成「旧两厅 + 正在加载的第三厅」。
  pruneHallCache(key, Math.max(0, MAX_CACHED_HALLS - 1));
  const hall = galleryOf(wing, artist);
  await ensureFonts(hallGlyphs(hall));
  const textures = await loadHallTextures(hall);
  wrap = createHall(hall, textures);
  wrap.scene.environment = envTex;
  hallCache.set(key, wrap);
  pruneHallCache(key);
  return wrap;
}

// 进艺术家展廊：复用画境粒子做过场——点中的代表作溶为粒子、镜头前推穿越，
// 幕后并行加载/构建展廊（用粒子穿越遮住贴图加载，不再长时间黑屏）；
// 加载完且穿越够久后粒子散去、淡入展廊。
async function enterArtistGallery(wingIndex, artistIndex) {
  if (state !== 'lobby') return;
  const wing = gallery.wings[wingIndex];
  const artist = wing?.artists[artistIndex];
  if (!wing || !artist || wing.comingSoon) return;
  state = 'transition';
  ui.hint(null);
  ui.caption(null);
  clearHover();
  audio.chime();

  const key = `${wingIndex}:${artistIndex}`;
  const repTex = portalTextures?.[artist.id];
  const hallDesc = galleryOf(wing, artist); // 引言卡文案（无需贴图即可呈现）

  const settle = (wrap) => {
    currentHall = wrap;
    currentDoor = { wingIndex, artistIndex };
    // 直到切换完成前，旧厅仍是 currentHall，预驱逐会刻意保留它；
    // 新厅成为当前厅后再收一次，才能真正兑现手机 1 厅 / PC 2 厅上限。
    pruneHallCache(key);
    setActive(wrap);
    rig.teleport(wrap.entry.pos, wrap.entry.yaw, wrap.entry.pitch);
    bloomTarget = 0.55;
    ui.crumb(`${wing.no} · ${crumbName(artist.name)}`);
    ui.homeButton(label('wingHomeLabel'), `${label('wingHomeTipPrefix')}${wingShortName(wing)}${label('wingHomeTipSuffix')}`);
    ui.showHome(true);
  };

  // 代表作纹理缺失（极少数）→ 退回原黑场过门
  if (!repTex || !repTex.image) {
    await ui.veil(true, { dur: 750 });
    const wrap = await buildHall(wing, artist, key);
    settle(wrap);
    await ui.veil(false, { dur: 1000 });
    await ui.hallIntro(wrap.hall);
    state = 'hall';
    ui.hint(H.hall);
    audio.setMode('hall');
    return;
  }

  // —— 粒子过场 + 自适应引言卡 ——
  // 点画框 → 代表作凝成粒子、镜头立即起速前推；引言卡随之淡入（覆于粒子之上，
  // 给出馆名 + 画家简介可读）。幕后并行加载：慢则卡片显示 LOADING（不再干等懵逼），
  // 就绪后粒子散去切入走廊、显示「点击入内」。全程文字只此一卡、不跳变；快/缓存不显 LOADING。
  ui.hud(false, { soundOnly: true });
  const pscene = immersion.enter({
    texture: repTex,
    work: { title: '', original: '' },     // 过场内不显题字，文案统一交给引言卡
  });
  immersion.camZ = 26;     // 起点更近：镜头推进与粒子弥散更明显（不发愣）
  immersion.speed = 4.5;   // 立即起速，开场即穿越
  renderPass.scene = pscene;
  bloomTarget = 0.78;

  const intro = ui.galleryIntro(hallDesc);   // 引言卡随粒子淡入（可读馆名/画家简介）

  // 幕后加载（命中缓存秒回）；慢则卡片 grace 后自动显示 LOADING
  const minFly = new Promise((r) => setTimeout(r, 900));
  const wrap = await buildHall(wing, artist, key);
  intro.setLoaded();        // 贴图就绪 → 收起 LOADING（若从未显示则无碍）
  await minFly;             // 保证至少一段粒子穿越（即便秒加载）

  // —— 交叉过渡（优雅渐变）：粒子先在画境里柔和淡一程，弱化切换瞬间；
  //    再把这团粒子云移入展廊、叠在走廊之上继续缓缓淡尽。粒子为加性混合，
  //    淡出即让后面的走廊一点点透出——「粒子渐隐」与「走廊渐现」同时发生。
  immersion.fadeRate = 1.6;                      // 柔和淡出
  immersion.fadeTarget = 0;
  await new Promise((r) => setTimeout(r, 520));  // 先淡到约半透，弱化场景切换那一刻

  const points = immersion.points;
  const pmat = immersion.mat;
  const curOp = pmat ? pmat.uniforms.uOpacity.value : 0;
  if (points) wrap.scene.add(points);            // 粒子云移入展廊（自动脱离画境场景）
  immersion.dispose();                           // 画境其余清理（场景 / 尘 / 题字）

  rig.mode = 'walk';
  rig.controls.enabled = true;
  settle(wrap);                                  // 切到展廊场景 + 落位门口（走廊开始渲染）

  if (points && pmat) {
    // 粒子云摆到门口相机前方、正对相机，随后缓缓淡尽，走廊自粒子间渐现
    points.position.set(wrap.entry.pos.x, wrap.entry.pos.y, wrap.entry.pos.z - 9);
    points.rotation.set(0, 0, 0);
    tween({
      dur: 1.5,
      ease: easeOutCubic,
      onUpdate: (k) => { pmat.uniforms.uOpacity.value = curOp * (1 - k); },
      onComplete: () => {
        wrap.scene.remove(points);
        points.geometry?.dispose();
        pmat.dispose();
      },
    });
  }

  intro.enableEnter();      // 走廊渐现 → 卡片页脚切为「点击任意处入内」
  await intro.wait();       // 等用户点击入内
  intro.close();
  ui.hud(true);
  state = 'hall';
  ui.hint(H.hall);
  audio.setMode('hall');
}

// ---------- 点击馆门：平滑进出该馆（连续空间，不切换场景；放慢穿越） ----------
function enterWing(wingIndex) {
  if (state !== 'lobby') return;
  const wing = gallery.wings[wingIndex];
  if (!wing || wing.comingSoon) return;
  if (zone === wingIndex) return; // 已身处该馆内，无需再滑入
  const enter = museum.wingEnter(wingIndex);
  if (!enter) return;
  clearHover();
  ui.caption(null);
  audio.chime();
  // 放慢穿越：较大 smoothTime + 放宽 settle，缓缓推门而入
  rig.glideToPose(enter.pos, enter.yaw, 0, 4800, 0.95).then(() => refreshZone(true));
}

// 点击馆门（馆内一侧）：平滑滑出，回到鼓厅、面朝中央雕塑
function exitWing(wingIndex) {
  if (state !== 'lobby') return;
  const exit = museum.wingExit(wingIndex);
  if (!exit) return;
  clearHover();
  ui.caption(null);
  audio.chime();
  rig.glideToPose(exit.pos, exit.yaw, 0, 4800, 0.95).then(() => refreshZone(true));
}

async function backToCorridor() {
  if (state !== 'hall') return;
  state = 'transition';
  ui.panel(null);
  ui.caption(null);
  clearHover();
  await ui.veil(true, { dur: 750 });
  const ret = currentDoor ? museum.doorReturn(currentDoor.wingIndex, currentDoor.artistIndex) : null;
  setActive(museum);
  bloomTarget = 0.42;
  if (ret) rig.teleport(ret.pos, ret.yaw, 0);
  else rig.teleport(museum.entry.pos, museum.entry.yaw, museum.entry.pitch);
  currentHall = null;
  focusEntry = null;
  focusPose = null;
  state = 'lobby';
  refreshZone(true);
  await ui.veil(false, { dur: 1000 });
  ui.hint(H.lobby);
}

async function goHome() {
  // 聚焦态（仅触摸）：点右上角圆键 = 退出聚焦，等同双击画作返回
  if (state === 'focus') { if (IS_TOUCH) closeFocus(); return; }
  // 展廊内：先回长廊；馆廊内：回大厅中心
  if (state === 'hall') { backToCorridor(); return; }
  if (state !== 'lobby' || zone < 0) return;
  state = 'transition';
  ui.caption(null);
  clearHover();
  await ui.veil(true, { dur: 650 });
  rig.teleport(museum.entry.pos, museum.entry.yaw, museum.entry.pitch);
  state = 'lobby';
  refreshZone(true);
  await ui.veil(false, { dur: 900 });
}

// ---------- 聚焦画作 ----------
// from='hall' 展厅内品读；from='lobby' 未来馆长廊里就地品读（不进展廊，直接弹右侧浮层）
function focusWork(entry, from = 'hall') {
  if (state !== 'hall' && state !== 'lobby') return;
  focusReturn = from;
  state = 'focus';
  focusEntry = entry;
  ui.caption(null);
  clearHover();
  const vfov = (camera.fov * Math.PI) / 180;
  const hTan = Math.tan(vfov / 2) * camera.aspect;
  // 桌面端右侧信息面板会盖住画面右边：按面板左侧的可视宽度取景，并把画放在这块区域的正中。
  // （面板宽度与 styles.css 的 .panel 一致；窗口太窄时面板几乎铺满，就不做偏移。）
  const panelPx = IS_TOUCH ? 0 : Math.min(440, innerWidth * 0.94);
  const visibleFrac = IS_TOUCH || innerWidth < 900 ? 1 : (innerWidth - panelPx) / innerWidth;
  // 手机竖屏横向视野很窄：加大留白与最大后退距离，并垂直居中，确保画作完整入框
  const pad = IS_TOUCH ? 1.45 : 1.3;
  const extra = IS_TOUCH ? 0.6 : 0.55;
  const maxD = IS_TOUCH ? 8 : 5.4;
  const dist = clamp(
    Math.max(
      (entry.h / 2) / Math.tan(vfov / 2),
      (entry.w / 2) / (hTan * visibleFrac),
    ) * pad + extra,
    1.7, maxD,
  );
  const target = entry.center.clone().addScaledVector(entry.normal, dist);
  if (visibleFrac < 1) {
    // 机位沿画面向右平移，画在屏幕上就相应左移到可视区中心；视线仍垂直于墙面，画不变形。
    const right = new THREE.Vector3().crossVectors(entry.normal.clone().negate(), camera.up).normalize();
    target.addScaledVector(right, dist * hTan * (1 - visibleFrac));
  }
  target.y = entry.center.y - (IS_TOUCH ? 0 : 0.12);
  const yaw = Math.atan2(entry.normal.x, entry.normal.z);
  const pitch = IS_TOUCH ? 0 : Math.atan2(entry.center.y - target.y, dist) * 0.9;
  audio.chime();
  rig.focusTo(target, yaw, pitch, 2.0).then(() => {
    if (state === 'focus') ui.panel(entry);
  });
  ui.vignette(true);
  if (IS_TOUCH) document.body.classList.add('focus-mobile'); // 把手势提示抬到抽屉之上
  ui.hint(H.focus, IS_TOUCH);                    // 触摸端常驻提示（右上角圆键保留，可点返回）
}

function closeFocus() {
  if (state !== 'focus') return;
  const back = focusReturn;
  state = 'transition';
  document.body.classList.remove('focus-mobile');
  ui.panel(null);
  ui.vignette(false);
  rig.release(1.6).then(() => {
    if (state === 'transition') {
      if (back === 'lobby') {
        state = 'lobby';
        refreshZone(true);
        ui.hint(H.lobby);
      } else {
        state = 'hall';
        ui.hint(H.hall);
      }
      focusEntry = null;
      focusPose = null;
    }
  });
}

// ---------- 入画（第一段：环绕观赏的立体画境） ----------
// 相机 = 以画心为轴的环绕模式（rig.beginOrbit / endOrbit，快照进出，
// 不碰其他空间的漫游参数）：拖拽绕画心稳定旋转（可看画背面）、
// 滚轮 / 双指推近拉远。画永远保持在画面中心。

// 挂上画境场景 + 环绕相机（enterDream 与 stardustToDream 共用）
function mountDreamScene(entry, opts) {
  const scene = dream.enter(entry, { ...opts, depthPolicy: gallery.depthPolicy });
  renderPass.scene = scene;
  bloomTarget = 0.5;
  rig.beginOrbit(dream.orbit);
  ui.vignette(true);
  ui.hud(false, { soundOnly: true });
  ui.dream(entry.work, dream.poem);
  ui.dreamMode(dream.mode, dream.hasModes);
}

function settleDreamState() {
  state = 'dream';
  if (IS_TOUCH) document.body.classList.add('dream-mobile');
  ui.hint(H.dream, IS_TOUCH);
}

// —— 入画→星尘过渡旋钮：对轴后无幕直切 ——
const HANDOFF_ALIGN = 0.45;     // 直切前对轴：相机回正 + 画境氛围暗下（秒）

async function enterDream(entry) {
  if (state !== 'focus') return;
  dreamReturnMode = 'flat';              // 从画前新进入时始终默认原画
  state = 'transition';
  document.body.classList.remove('focus-mobile');
  ui.panel(null);
  ui.hint(null);
  ui.caption(null);
  focusPose = rig.getPose();          // 存档品读机位：归来时原样落回画前
  audio.setMode('dream');
  audio.chime();
  await ui.veil(true, { white: true, dur: 800 });
  mountDreamScene(entry);
  await ui.veil(false, { dur: 1800 });
  settleDreamState();
}

// 点「化作星尘」→ 暗幕换场，画身溶作星尘（第二段：粒子）
async function dreamToStardust() {
  if (state !== 'dream') return;
  state = 'transition';
  document.body.classList.remove('dream-mobile');
  ui.hint(null);
  ui.caption(null);
  const entry = focusEntry;
  audio.setMode('immersion');
  audio.swell();                       // 只用声音渐涌，不再有白闪光点
  // 无暗幕直切：相机回正、画境氛围沉入夜色，星尘以「浮雕形态 +
  // 同视角镜位」接管（粒子按同一深度图立体分布、粒度对齐），溶解节奏沿用星尘原调校
  ui.dream(null);
  tween({ dur: HANDOFF_ALIGN, ease: easeInOutSine, onUpdate: (k) => dream.setDim(k) });
  await rig.faceFront(HANDOFF_ALIGN);
  const dist = camera.position.distanceTo(dream.orbit.target);
  const hand = dream.getHandoff();
  dreamReturnMode = hand.mode;
  dream.dispose();
  rig.endOrbit();
  if (focusPose) rig.setPose(focusPose);   // 让星尘存档的是品读机位，归来不迷路
  const scene = immersion.enter(entry, {
    matchDist: dist, paintingW: hand.W,
    relief: hand.mode === 'solid' ? hand.depth : null,   // 原作模式＝从平面溶开（原版调校）
  });
  renderPass.scene = scene;
  bloomTarget = 0.78;
  ui.immersion(entry.work);
  state = 'immersion';
  if (IS_TOUCH) document.body.classList.add('immersion-mobile');
  ui.hint(H.immersion);
}

// 星尘 →「回到画境」（返回上一步）
async function stardustToDream() {
  if (state !== 'immersion') return;
  state = 'transition';
  document.body.classList.remove('immersion-mobile');
  ui.immersion(null);
  audio.setMode('dream');
  immersion.fadeTarget = 0;            // 粒子在暗幕下快速淡去
  immersion.fadeRate = 3;
  await ui.veil(true, { dur: 700 });
  immersion.dispose();
  mountDreamScene(focusEntry, {
    quickRise: true,
    initialMode: dreamReturnMode,
  }); // 归来：画快速聚拢，并保留离开前的原画/立体选择
  await ui.veil(false, { dur: 1500 });
  settleDreamState();
}

// 从画境退回画前（品读）
async function exitDream() {
  if (state !== 'dream') return;
  state = 'transition';
  document.body.classList.remove('dream-mobile');
  ui.dream(null);
  ui.hint(null);
  ui.caption(null);
  await ui.veil(true, { dur: 750 });
  dream.dispose();
  rig.endOrbit();
  rig.mode = 'locked';
  rig.controls.enabled = false;
  if (focusPose) rig.setPose(focusPose);
  renderPass.scene = active.scene;
  bloomTarget = focusReturn === 'lobby' ? 0.42 : 0.55;
  ui.hud(true);
  await ui.veil(false, { dur: 1000 });
  ui.panel(focusEntry);
  state = 'focus';
  if (IS_TOUCH) document.body.classList.add('focus-mobile');
  ui.hint(H.focus, IS_TOUCH);
  audio.setMode('hall');
}

// ---------- 星尘（第二段）退出 ----------
async function exitImmersion() {
  if (state !== 'immersion') return;
  state = 'transition';
  document.body.classList.remove('immersion-mobile');
  ui.immersion(null);
  await Promise.race([immersion.exit(), new Promise((r) => setTimeout(r, 1500))]);
  await ui.veil(true, { dur: 700 });
  immersion.dispose();
  rig.mode = 'locked';
  renderPass.scene = active.scene; // 展厅来则回展厅，未来馆来则回馆廊（active 即来时所在 wrap）
  bloomTarget = focusReturn === 'lobby' ? 0.42 : 0.55;
  ui.hud(true);
  await ui.veil(false, { dur: 1000 });
  ui.panel(focusEntry);
  state = 'focus';
  if (IS_TOUCH) document.body.classList.add('focus-mobile');
  ui.hint(H.focus, IS_TOUCH);
  audio.setMode('hall');
}

// ---------- 拾取与悬停 ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hovered = null;

function pick(clientX, clientY) {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(active.targets, true);
  for (const hit of hits) {
    let o = hit.object;
    while (o) {
      if (o.userData && o.userData.type) return { node: o, point: hit.point };
      o = o.parent;
    }
  }
  return null;
}

function setHoverTarget(node, v) {
  if (node.userData.entry) node.userData.entry.hoverTarget = v;
  else if ('hoverTarget' in node.userData) node.userData.hoverTarget = v;
}

function clearHover() {
  if (!hovered) return;
  setHoverTarget(hovered, 0);
  hovered = null;
  document.body.classList.remove('can-hover');
}

function onHover(e) {
  // 入画态无可悬停目标（光核彩蛋已移除，唯一触发是画外「化作星尘」按钮）
  if (state === 'dream') return;
  if (state !== 'lobby' && state !== 'hall') return;
  const hit = pick(e.clientX, e.clientY);
  let node = hit && hit.node.userData.type !== 'floor' ? hit.node : null;
  // 馆门双向都高亮（大厅侧进馆 / 馆内侧出馆）；
  // 画屏：在大厅尚未入馆时不响应（统一由馆门接管，大厅里点/悬停不到里面画作）
  if (node && node.userData.type === 'door' && state === 'lobby' && zone !== node.userData.wingIndex) node = null;
  if (hovered !== node) {
    clearHover();
    hovered = node;
    if (node) {
      setHoverTarget(node, 1);
      document.body.classList.add('can-hover');
    }
  }
  if (!node) { ui.caption(null); return; }
  const type = node.userData.type;
  if (type === 'work') {
    ui.caption(node.userData.entry.work, e.clientX, e.clientY);
  } else if (type === 'frame-empty') {
    ui.caption({ title: label('reservedTitle'), original: label('reservedOriginal') }, e.clientX, e.clientY);
  } else {
    ui.caption(null);
  }
}

// 悬停题签仅在有指针悬停能力的设备（PC）启用；触摸端没有"悬停"，跳过以免拖动看景时误弹题签
let lastHover = 0;
if (!IS_TOUCH) {
  canvas.addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (now - lastHover > 40) { lastHover = now; onHover(e); }
  });
}

// 点击（区分拖拽）
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  // 触摸抖动大：放宽"点击 vs 拖拽"阈值，避免轻点被误判成拖动
  if (moved > (IS_TOUCH ? 14 : 8)) return;
  handleClick(e);
});

function spawnRipple(point, color, scene = active.scene) {
  const r = makeRipple(color);
  r.position.set(point.x, 0.035, point.z);
  scene.add(r);
  tween({
    dur: 0.95,
    ease: easeOutCubic,
    onUpdate: (k) => {
      r.scale.setScalar(0.25 + k * 1.45);
      r.material.opacity = 0.85 * (1 - k);
    },
    onComplete: () => {
      scene.remove(r);
      r.geometry.dispose();
      r.material.dispose();
    },
  });
}

// 触摸端聚焦态：单击画作 → 步入画境；双击 → 返回展厅（替代桌面的"单击退出"）
let _focusTapAt = 0;
let _focusTapTimer = null;
function handleFocusTapMobile() {
  const now = performance.now();
  if (now - _focusTapAt < 300) {            // 双击：返回展厅
    _focusTapAt = 0;
    clearTimeout(_focusTapTimer);
    closeFocus();
  } else {                                   // 先记单击，等 300ms 看是否还有第二击
    _focusTapAt = now;
    clearTimeout(_focusTapTimer);
    _focusTapTimer = setTimeout(() => {
      if (state === 'focus' && focusEntry) enterDream(focusEntry);
    }, 300);
  }
}

// 触摸端入画态：双击 → 回到画前（光核彩蛋已移除，单击在入画态无功能）
let _dreamTapAt = 0;
function handleDreamTapMobile() {
  const now = performance.now();
  if (now - _dreamTapAt < 300) { _dreamTapAt = 0; exitDream(); }
  else _dreamTapAt = now;
}

function handleClick(e) {
  if (state === 'focus') {
    if (IS_TOUCH) handleFocusTapMobile(); // 触摸：单击进画境 / 双击返回
    else closeFocus();                    // PC：单击退出（维持原样）
    return;
  }
  // 入画态唯一触发是画外「化作星尘」按钮；触摸端保留双击回到画前，PC 单击无功能
  if (state === 'dream') {
    if (IS_TOUCH) handleDreamTapMobile();
    return;
  }
  if (state !== 'lobby' && state !== 'hall') return;

  const hit = pick(e.clientX, e.clientY);
  if (!hit) return;
  const { node, point } = hit;
  const type = node.userData.type;

  if (type === 'wing-door' && state === 'lobby') {
    // 同一扇门双向一键：在馆内点击则滑出回大厅，在大厅点击则滑入该馆
    if (zone === node.userData.wingIndex) exitWing(node.userData.wingIndex);
    else enterWing(node.userData.wingIndex);
  } else if (type === 'door' && state === 'lobby') {
    // 画屏：已在该馆内才进艺术家展廊；否则（理论上被馆门挡住）统一改为滑入该馆
    if (zone === node.userData.wingIndex) enterArtistGallery(node.userData.wingIndex, node.userData.artistIndex);
    else enterWing(node.userData.wingIndex);
  } else if (type === 'frame-empty' && state === 'lobby') {
    audio.chime();
    ui.hint(H.future, true);
    setTimeout(() => ui.hint(null), 5000);
  } else if (type === 'lobby' && state === 'hall') {
    backToCorridor();
  } else if (type === 'work' && state === 'hall') {
    focusWork(node.userData.entry);
  } else if (type === 'work' && state === 'lobby') {
    // 未来馆长廊里点击真迹：不进展廊，直接就地品读（右侧浮层），复用展厅画作组件
    focusWork(node.userData.entry, 'lobby');
  } else if (type === 'floor') {
    // 点击滑行：涟漪落点 + SmoothDamp 平滑滑过去
    const accent = state === 'hall' && currentHall
      ? currentHall.hall.accent
      : (zone >= 0 ? gallery.wings[zone].accent : 0xb7a98c);
    const dest = point.clone();
    active.bounds?.(dest);
    spawnRipple(point, accent);
    rig.glideTo(dest);
  }
}

// ---------- 键盘 ----------
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (state === 'immersion') exitImmersion();
    else if (state === 'dream') exitDream();
    else if (state === 'focus') closeFocus();
    else if (state === 'hall') backToCorridor();
  }
});

// ---------- 自适应 ----------
let resizeFrame = 0;
let renderWidth = window.innerWidth;
let renderHeight = window.innerHeight;
window.addEventListener('resize', () => {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (width === renderWidth && height === renderHeight) return;
    renderWidth = width;
    renderHeight = height;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    composer.setSize(width, height);
    immersion.onResize();
  });
});

window.addEventListener('pagehide', (event) => {
  if (!event.persisted) envTarget.dispose();
});

// ---------- 主循环 ----------
const clock = new THREE.Clock();
let zoneClock = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  updateTweens(dt);
  if (state === 'landing') rig.sway(t);
  rig.update(dt);
  zoneClock += dt;
  if (zoneClock > 0.25 && state === 'lobby') { zoneClock = 0; refreshZone(); }
  if (immersion.active) immersion.update(dt, t);
  else if (dream.active) dream.update(dt, t, audio.tide01());
  else active?.update?.(dt, t);
  audio.update(dt);
  bloom.strength = lerp(bloom.strength, bloomTarget, Math.min(1, dt * 2));
  composer.render();
}

boot();
loop();

// 供自动化巡检使用（不影响正常体验）
window.__musewalk = {
  state: () => state,
  pos: () => rig.pos.toArray(),
  viewRadius: () => camera.position.distanceTo(rig.pos),
  audioMuted: () => audio.muted,
  dreamMode: () => dream.mode,
  enterGalleryById: (wingId, artistId) => {
    const wi = gallery?.wings.findIndex((wing) => wing.id === wingId) ?? -1;
    const ai = wi >= 0 ? gallery.wings[wi].artists.findIndex((artist) => artist.id === artistId) : -1;
    if (wi >= 0 && ai >= 0) enterArtistGallery(wi, ai);
  },
  configSummary: () => ({
    depthPolicy: gallery?.depthPolicy,
    wings: gallery?.wings.map((wing) => ({
      id: wing.id,
      type: wing.type,
      comingSoon: !!wing.comingSoon,
      frames: wing.frames,
      artists: wing.artists.map((artist) => artist.id),
      works: wing.artists.reduce((sum, artist) => sum + artist.works.length, 0),
    })) || [],
  }),
  backToLobby: backToCorridor,
  gotoWing: (i) => {
    if (state !== 'lobby' || !museum) return;
    const mid = museum.corridorMid(i);
    if (mid) { rig.teleport(mid.pos, mid.yaw, 0); refreshZone(true); }
  },
  gotoWingById: (wingId) => {
    if (state !== 'lobby' || !museum) return;
    const i = gallery?.wings.findIndex((wing) => wing.id === wingId) ?? -1;
    const mid = i >= 0 ? museum.corridorMid(i) : null;
    if (mid) { rig.teleport(mid.pos, mid.yaw, 0); refreshZone(true); }
  },
  facePortalById: (wingId, artistId) => {
    if (state !== 'lobby' || !museum) return;
    const wi = gallery?.wings.findIndex((wing) => wing.id === wingId) ?? -1;
    const ai = wi >= 0 ? gallery.wings[wi].artists.findIndex((artist) => artist.id === artistId) : -1;
    const v = wi >= 0 && ai >= 0 ? museum.portalView(wi, ai) : null;
    if (v) { rig.teleport(v.pos, v.yaw, v.pitch || 0); refreshZone(true); }
  },
  gotoLobby: () => {
    if (state !== 'lobby' || !museum) return;
    rig.teleport(museum.entry.pos, museum.entry.yaw, museum.entry.pitch);
    refreshZone(true);
  },
  focusWork: (id) => {
    if (!currentHall) return;
    const e = id ? currentHall.works.find((w) => w.work.id === id) : currentHall.works[0];
    if (e) focusWork(e);
  },
  enterDreamNow: () => { if (focusEntry) enterDream(focusEntry); },
};
