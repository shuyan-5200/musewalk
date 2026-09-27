// ============================================================
//  入画美术馆 · MUSEWALK — 馆藏配置装载与规范化
//  馆内一切内容（馆名 / 馆 / 画家 / 画作 / 文案）来自
//  public/gallery.config.json；本文件只负责装载、补全默认值，
//  以及存放与内容无关的引擎提示文案。
//
//  空间层级：大厅 → 馆（门后甬道 + 圆形画屏厅）→ 艺术家展廊 → 画作
// ============================================================

// 状态提示文案（引擎 UI，跟随产品而非馆藏内容）
export const HINTS = {
  lobby: 'Arrow keys / WASD to walk · Click the floor to travel · Drag to look around · Click a doorway to enter',
  hall: 'Arrow keys / WASD to walk · Click the floor to travel · Click a painting to view',
  focus: 'Click "Step Into the Painting" to enter its world',
  dream: 'Drag to orbit — you can even see the back · Scroll to zoom · When ready, tap "Become Stardust"',
  immersion: 'Drag to look around · The painting has dissolved into stardust, all around you',
  future: 'This frame is reserved · awaiting its next painting',
  touchLobby: 'Tap the floor to travel · Drag to look around · Tap a doorway to enter',
  touchHall: 'Tap the floor to travel · Drag to look around · Tap a painting to view',
  touchFocus: 'Tap to step into the painting · Double-tap to go back',
  touchDream: 'Drag to orbit · Pinch to zoom · Tap "Become Stardust" · Double-tap to go back',
  // 入画默认诗句（work.poem 未配置时按画轮换；皆为治愈系短句）
  dreamPoems: [
    'The wind comes through the canvas, still warm with paint',
    'Slow down — let the light learn your shape',
    'Here, time is something weightless',
    'The colors drift, and the room grows still',
    'The world grows quiet until only color remains',
    'You step inside like a line of poetry entering the frame',
  ],
};

const UI_DEFAULTS = {
  lobbyCrumbLabel: 'LOBBY',
  mobileFootnote: 'Tap the floor to travel · Drag to look around · Headphones recommended',
  mobileNote: 'Mobile runs at reduced resolution — visit on a computer for the full experience',
  soundLabel: 'Sound',
  soundTip: 'Ambient sound on/off',
  homeLabel: 'Lobby',
  homeTip: 'Back to the central hall',
  wingHomeLabel: 'Wing',
  wingHomeTipPrefix: 'Back to ',
  wingHomeTipSuffix: ' Wing',
  // 品读 / 画境 / 星尘里：一键回到这位艺术家的展廊
  galleryHomeLabel: 'Gallery',
  galleryHomeTipPrefix: 'Back to ',
  galleryHomeTipSuffix: "'s gallery",
  futureIntroGoText: '— tap to continue —',
  hallIntroGoText: '— click anywhere to enter —',
  galleryLoadingLine: 'Hanging the paintings · lighting the lamps',
  panelSwipeHint: 'Swipe up / tap to read',
  panelArtistLabel: 'ARTIST',
  panelEnterLabel: 'Step Into the Painting',
  panelCloseLabel: 'Back',
  dreamStarLabel: 'Become Stardust',
  dreamExitLabel: 'Step Back Out',
  dreamModeFlat: 'The Original',
  dreamModeSolid: 'In Relief',
  comingSoon: 'COMING SOON',
  immersionBackLabel: 'Return to the Painting',
  immersionExitLabel: 'Back to the Gallery',
  reservedTitle: 'Reserved',
  reservedOriginal: 'Awaiting its next painting',
};

const hexToInt = (s) => parseInt(String(s).replace('#', ''), 16);

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']; // ASCII：任何字体都有，不会显示成方块

const THEME_KEYS = ['accent', 'wall', 'panel', 'floor', 'fog', 'lightColor'];

function configWarn(message, detail) {
  console.warn(`[gallery config] ${message}`, detail ?? '');
}

/** 把一组 #rrggbb 主题字段转为引擎所需的整数，并保留 accentCss */
function intTheme(src) {
  const out = { accentCss: src.accent };
  THEME_KEYS.forEach((k) => { out[k] = hexToInt(src[k]); });
  out.frameStyle = src.frameStyle;
  return out;
}

/** 补全默认值并把颜色转为整数 */
function normalize(cfg) {
  // 发布基线必须全馆一致：默认统一使用温和的自动伪深度。
  // 只有整馆深度资产补齐且验收后，才显式把 depthPolicy 改为 enhanced。
  const depthPolicy = cfg.depthPolicy === 'enhanced' ? 'enhanced' : 'uniform-auto';
  // config 的 hints 块可整体覆盖引擎提示文案（中文版走此路；main.js 的 H 在此之后定稿）
  if (cfg.hints) Object.assign(HINTS, cfg.hints);
  if (!Array.isArray(cfg.wings)) configWarn('missing "wings"; using an empty museum');
  const wings = (Array.isArray(cfg.wings) ? cfg.wings : []).map((w, i) => {
    const base = {
      no: ROMAN[i] || String(i + 1),
      short: w.name || '',
      latin: '', en: '', intro: '',
      type: 'collection',          // collection 常规馆 | open 未来馆（空框）
      frames: 10,                  // open 馆的空框数量
      frameStyle: 'dark',
      comingSoon: false,
      accent: '#b7a98c', wall: '#2a211c', panel: '#39302a',
      floor: '#0d0a08', fog: '#0c0908', lightColor: '#ffe2b8',
      ...w,
    };
    const wingTheme = intTheme(base);
    return {
      ...base,
      ...wingTheme,
      artists: (base.artists || []).flatMap((a, ai) => {
        if (!Array.isArray(a.works) || a.works.length === 0) {
          configWarn('artist has no works; skipped', a.id || a.name || `${base.id || base.name}:${ai}`);
          return [];
        }
        const works = a.works.flatMap((x, wi) => {
          if (!x?.file) {
            configWarn('work is missing "file"; skipped', x?.id || x?.title || `${a.id || a.name}:${wi}`);
            return [];
          }
          return [{
            title: '', original: '', year: '', medium: '', museum: '', desc: '', line: '',
            poem: '',   // 入画（立体画境）中缓缓浮现的一句诗；空则用引擎默认治愈文案
            depth: '',  // 可选：真实深度图路径（亮 = 近），用于增强入画浮雕
            splat: '',  // 预留：3DGS 高斯泼溅资产路径（.spz/.ply），当前引擎不消费
            ...x,
          }];
        });
        if (works.length === 0) {
          configWarn('artist has no valid works; skipped', a.id || a.name || `${base.id || base.name}:${ai}`);
          return [];
        }
        const artist = {
          name: '', original: '', dates: '', place: '', epithet: '', bio: '',
          ...a,
          works,
        };
        // 展廊氛围：默认继承所在馆，可被 artist.atmosphere 按字段覆写
        artist.theme = intTheme({ ...base, ...(a.atmosphere || {}) });
        return [artist];
      }),
    };
  });
  return {
    title: 'MUSEWALK', subtitle: '', kicker: '', tagline: '',
    enterLabel: 'Enter the Museum',
    loadingLine: 'Hanging the paintings · lighting the lamps',
    footnote: 'Arrow keys / WASD to walk · Click the floor to travel · Drag to look around · Headphones recommended',
    ...cfg,
    depthPolicy,
    ui: { ...UI_DEFAULTS, ...(cfg.ui || {}) },
    wings,
  };
}

/**
 * 装载馆藏配置。默认读取站点根部的 gallery.config.json；
 * 可用 ?config=另一份.json 临时切换（仅限同源相对路径）。
 */
const DEFAULT_CONFIG = 'gallery.config.json';

// 只接受同源、不越级的相对 .json 路径；不合法时退回默认配置。
function safeConfigName(name) {
  const portable = String(name || '').replaceAll('\\', '/');
  const segments = portable.split('/');
  if (
    !portable
    || portable.startsWith('/')
    || portable.includes('://')
    || segments.includes('..')
    || !portable.endsWith('.json')
    || segments.some((segment) => !segment || !/^[\p{L}\p{N}_.-]+$/u.test(segment))
  ) return DEFAULT_CONFIG;
  return portable;
}

async function fetchConfig(name) {
  const res = await fetch(import.meta.env.BASE_URL + name, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${name} — HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (err) {
    throw new Error(`Could not load ${name} — check the JSON syntax`);
  }
}

// 没有显式 ?config 时，若默认配置声明了 altLang.lang（如 "zh"）且浏览器首选语言匹配，直接装载对应语言版本。
function prefersLanguage(lang) {
  const wanted = String(lang || '').toLowerCase();
  if (!wanted) return false;
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  const first = String(languages[0] || '').toLowerCase();
  return first === wanted || first.startsWith(`${wanted}-`);
}

export async function loadGallery() {
  const requested = new URLSearchParams(location.search).get('config');
  const name = safeConfigName(requested || DEFAULT_CONFIG);
  let cfg = await fetchConfig(name);
  if (!requested && cfg.altLang?.config && prefersLanguage(cfg.altLang.lang)) {
    try {
      cfg = await fetchConfig(safeConfigName(cfg.altLang.config));
    } catch (err) {
      console.warn('[museum] alternate-language config failed to load; using the default', err);
    }
  }
  return normalize(cfg);
}
