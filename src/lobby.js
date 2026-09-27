// ============================================================
//  博物馆主体（连续空间）：
//  圆形大厅（Rotunda）+ 自门洞延伸的三条馆廊 ——
//  长廊两侧是艺术家之门（点击进入展廊）；
//  open 型馆（未来馆）的长廊里挂虚位以待的空画框。
//  扩展逻辑：加艺术家 = 长廊加长一跨；只有加馆才动大厅的门。
// ============================================================
import * as THREE from 'three';
import { SCULPTURE_MODEL } from './appVariant.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { makeDust, makeMistyImage, makeDoorGlow } from './fx.js';
import { textPlane, drawSpaced, FONT_CN, FONT_EN, lerp, softCircleTexture } from './utils.js';

const R = 14;        // 大厅半径
const H = 9;         // 大厅净高
const GAP = 0.145;   // 门洞在鼓形墙上的半张角（弧上约 ±2m）

// 中厅（环形展示厅）：自门廊外延的圆形房间，画屏沿环排布
const DPASS = 3.6;          // 门廊→环厅 的甬道长
const ENTRANCE_HALF = 0.46; // 环墙入口开口半角（朝 +z）
const RING_H = 6.6;         // 环厅净高
const ringRadiusFor = (n) => Math.max(7, Math.min(11.5, 5.6 + n * 0.62));

// 界面文案（createLobby 装载时注入；模块级，供 buildEmptyFrame 等模块级辅助函数使用）
let LOBBY_UI = {};

function cssColor(hex, a = 1) {
  return `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;
}

function makeMarbleTexture({ base = [238, 234, 224], vein = [169, 158, 139], accent = [205, 196, 178], scale = 1 } = {}) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const ny = y / size;
      const flow = Math.sin((nx * 7.2 + ny * 3.4) * scale + Math.sin(ny * 18.0) * 0.42);
      const cloud = Math.sin((nx * 18.0 - ny * 10.0) * scale) * 0.22 + Math.sin((nx + ny) * 44.0) * 0.08;
      const veinLine = Math.pow(Math.max(0, 1 - Math.abs(flow + cloud) * 3.2), 3.0);
      const soft = 0.5 + 0.5 * Math.sin((nx * 2.1 + ny * 2.8) * Math.PI * 2);
      const mix = Math.min(1, veinLine * 0.65 + soft * 0.1);
      const i = (y * size + x) * 4;
      data[i] = base[0] * (1 - mix) + vein[0] * mix + accent[0] * veinLine * 0.18;
      data[i + 1] = base[1] * (1 - mix) + vein[1] * mix + accent[1] * veinLine * 0.18;
      data[i + 2] = base[2] * (1 - mix) + vein[2] * mix + accent[2] * veinLine * 0.18;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 1);
  return texture;
}

function makeSoftShadowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 6, size / 2, size / 2, size / 2);
  // 更软的接地阴影：核心略淡 + 拉长的羽化尾巴，在变亮的地面上不显得是一块硬补丁
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.2)');
  g.addColorStop(0.78, 'rgba(0,0,0,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---------- 艺术家画屏（代表作填满作暗背景 + 居中信息 + 凸出框体 + 发光粒子） ----------
const PORTAL_CY = 2.45; // 画屏中心高度

function buildArtistPortal(wing, artist, wingIndex, artistIndex, texture) {
  const g = new THREE.Group();
  // 环厅卡片统一用「馆」主题色，使同一圆形厅里所有画屏的光晕/字饰一致；
  // 艺术家各自的氛围覆写（如先锋四子的炭黑白盒红调）只作用于其专属展廊内部，不渗到圆形厅。
  const accent = wing.accent;
  const work = artist.works[0] || {};
  const cy = PORTAL_CY;

  // 画屏尺寸（按代表作比例，限高限宽）
  const img = texture && texture.image;
  const aspect = img && img.width ? img.width / img.height : 0.74;
  let h = 3.0;
  let w = h * aspect;
  const maxW = 4.1;
  if (w > maxW) { w = maxW; h = w / aspect; }
  // 背后光晕直径：正圆 + 限径。随画屏大小微调但封顶 4.9m——
  // 既保持各屏光晕大小相近（视觉间距均衡），又确保贴在弧形环墙上不戳穿被切边。
  const haloD = Math.min(Math.max(w, h) * 1.5, 4.9);
  const FD = 0.13; // 凸出墙面的厚度（立体感）

  // 凸出框体：深色薄盒 + 细铜内线（微微浮起于墙）
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.2, h + 0.2, FD),
    new THREE.MeshStandardMaterial({ color: 0x130f0b, roughness: 0.68, metalness: 0.3 }),
  );
  frame.position.set(0, cy, FD / 2 - 0.02);
  g.add(frame);
  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.03, h + 0.03, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x6a5a3c, metalness: 0.7, roughness: 0.5, envMapIntensity: 0.5 }),
  );
  lip.position.set(0, cy, FD + 0.005);
  g.add(lip);

  // 代表作：填满画屏、压暗作背景
  let screen;
  if (texture) {
    const misty = makeMistyImage(texture, accent, w, h, { dim: 0.46, haloDiameter: haloD });
    misty.group.position.set(0, cy, FD + 0.02);
    g.add(misty.group);
    screen = misty.screen;
    screen.userData.type = 'door';
    screen.userData.wingIndex = wingIndex;
    screen.userData.artistIndex = artistIndex;
  } else {
    const fallback = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: 1 }),
    );
    fallback.position.set(0, cy, FD + 0.02);
    fallback.userData = { type: 'door', wingIndex, artistIndex, hoverTarget: 0, update: () => {} };
    g.add(fallback);
    screen = fallback;
  }

  // 四周发光粒子（盒域略大于画屏，多半落在边缘外，似光尘环绕）
  const dust = makeDust({
    count: 90, box: [w + 1.7, h + 1.7, 0.6], center: [0, cy, FD + 0.12],
    color: accent, opacity: 0.5, size: 0.05,
  });
  g.add(dust);

  // 居中信息层级（内厅信息面板式）+ 底部诗句单行；覆于代表作之上
  const overlay = textPlane({
    width: w, height: h, ppm: 220,
    draw: (ctx, cw, ch) => {
      // 字号按卡片宽度自适应：长名 / 长诗自动收进卡内
      const maxW = cw * 0.9;
      const fit = (text, px, spRatio, fam, style = '') => {
        ctx.font = `${style}300 ${px}px ${fam}`;
        const wpx = ctx.measureText(text).width + px * spRatio * Math.max(0, text.length - 1);
        if (wpx > maxW) px *= maxW / wpx;
        return { px, sp: px * spRatio };
      };
      // 中部暗角，托起文字可读性
      const rg = ctx.createRadialGradient(cw / 2, ch * 0.45, ch * 0.06, cw / 2, ch * 0.5, ch * 0.66);
      rg.addColorStop(0, 'rgba(8,7,6,0.6)');
      rg.addColorStop(1, 'rgba(8,7,6,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, cw, ch);
      // 称谓
      let f = fit(`「 ${artist.epithet} 」`, ch * 0.05, 0.35, FONT_CN);
      ctx.fillStyle = cssColor(accent, 0.88);
      ctx.font = `300 ${f.px}px ${FONT_CN}`;
      drawSpaced(ctx, `「 ${artist.epithet} 」`, cw / 2, ch * 0.31, f.sp);
      // 姓名（主标，大）
      f = fit(artist.name, ch * 0.115, 0.12, FONT_CN);
      ctx.fillStyle = 'rgba(243,237,225,0.99)';
      ctx.font = `300 ${f.px}px ${FONT_CN}`;
      drawSpaced(ctx, artist.name, cw / 2, ch * 0.45, f.sp);
      // 拉丁名（斜体）
      f = fit(artist.original, ch * 0.05, 0, FONT_EN, 'italic ');
      ctx.fillStyle = 'rgba(238,231,217,0.66)';
      ctx.font = `italic 300 ${f.px}px ${FONT_EN}`;
      ctx.fillText(artist.original, cw / 2, ch * 0.55);
      // 年代
      ctx.fillStyle = cssColor(accent, 0.72);
      ctx.font = `300 ${ch * 0.042}px ${FONT_EN}`;
      drawSpaced(ctx, artist.dates, cw / 2, ch * 0.615, ch * 0.01);
      // 细分隔线
      const grad = ctx.createLinearGradient(cw * 0.34, 0, cw * 0.66, 0);
      grad.addColorStop(0, cssColor(accent, 0));
      grad.addColorStop(0.5, cssColor(accent, 0.55));
      grad.addColorStop(1, cssColor(accent, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(cw * 0.34, ch * 0.67, cw * 0.32, 1.5);
      // 诗句（保留原文案，单独一行置底）
      if (work.line) {
        f = fit(`「 ${work.line} 」`, ch * 0.046, 0.05, FONT_CN);
        ctx.fillStyle = 'rgba(238,231,217,0.84)';
        ctx.font = `300 ${f.px}px ${FONT_CN}`;
        drawSpaced(ctx, `「 ${work.line} 」`, cw / 2, ch * 0.9, f.sp);
      }
    },
  });
  overlay.position.set(0, cy, FD + 0.05);
  g.add(overlay);

  // 复合 update：代表作微动/悬停 + 粒子流动
  const baseUpdate = screen.userData.update || (() => {});
  screen.userData.update = (dt, t) => { baseUpdate(dt, t); dust.userData.update(dt, t); };

  return { group: g, screen, pickables: [screen] };
}

// ---------- 虚位以待的空画框（未来馆） ----------
const FRAME_PALETTE = [0xe0564a, 0x7fb4d8, 0xd4af5a, 0x8aa67c, 0xb48ad8];

function buildEmptyFrame(wing, idx) {
  const g = new THREE.Group();
  const portrait = idx % 2 === 0;
  const w = portrait ? 1.5 : 2.1;
  const h = portrait ? 1.9 : 1.45;
  const accent = FRAME_PALETTE[idx % FRAME_PALETTE.length];

  const gold = new THREE.MeshStandardMaterial({ color: 0xa8843c, metalness: 0.92, roughness: 0.34 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.1), gold);
  g.add(frame);
  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x241c10, roughness: 0.6 }),
  );
  lip.position.z = 0.035;
  g.add(lip);
  const canvas = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    // 未填画框：恒定暗哑色（不受灯光影响、低于辉光阈值），保持「虚位以待」而不发亮
    new THREE.MeshBasicMaterial({ color: 0x6f6859 }),
  );
  canvas.position.z = 0.062;
  g.add(canvas);

  // 框下彩色细签（未来馆的「活泼」点缀，克制为一道色线）
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.55, 0.045, 0.03),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(1.25) }),
  );
  bar.position.set(0, -(h / 2 + 0.32), 0.04);
  g.add(bar);

  // 「虚位以待」铭牌
  const plaque = textPlane({
    width: 0.95, height: 0.34, ppm: 360,
    draw: (ctx, cw, ch) => {
      ctx.fillStyle = 'rgba(12,10,8,0.5)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = cssColor(accent, 0.5);
      ctx.lineWidth = 2;
      ctx.strokeRect(5, 5, cw - 10, ch - 10);
      ctx.fillStyle = 'rgba(238,231,217,0.92)';
      ctx.font = `300 ${ch * 0.3}px ${FONT_CN}`;
      drawSpaced(ctx, `No.${String(idx + 1).padStart(3, '0')} ${LOBBY_UI.reservedTitle || 'Reserved'}`, cw / 2, ch * 0.34, 2);
      ctx.fillStyle = 'rgba(238,231,217,0.45)';
      ctx.font = `300 ${ch * 0.18}px ${FONT_EN}`;
      drawSpaced(ctx, String(LOBBY_UI.reservedOriginal || 'Reserved for you').toUpperCase(), cw / 2, ch * 0.72, 2);
    },
  });
  plaque.position.set(0, -(h / 2 + 0.62), 0.04);
  g.add(plaque);

  const ud = { type: 'frame-empty', index: idx };
  frame.userData = ud;
  canvas.userData = ud;
  return g;
}

// ---------- 未来馆主画位：把真迹挂进金框（点击即就地品读，复用展厅画作组件） ----------
const FUTURE_CY = 2.35; // 未来馆画作中心高度

// 由内向外的槽位顺序：第一幅作品落在最居中（正对入口的背墙正中），其后左右交替向外铺开
function centerOutOrder(n) {
  const mid = (n - 1) / 2;
  return Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => (Math.abs(a - mid) - Math.abs(b - mid)) || (a - b));
}

function buildFutureWork(wing, artist, work, texture, featured) {
  const g = new THREE.Group();
  const accent = wing.accent;
  const img = texture && texture.image;
  const aspect = img && img.width ? img.width / img.height : 0.75;
  const land = work.wide || aspect > 1.2; // 横幅画作放宽限宽，避免被压成细条
  const maxH = featured ? 2.7 : (land ? 1.95 : 2.05);
  const maxW = featured ? (land ? 4.0 : 3.4) : (land ? 3.3 : 2.05);
  let h = maxH;
  let w = h * aspect;
  if (w > maxW) { w = maxW; h = w / aspect; }

  // 悬停辉光（与展厅画作同款，叠加发光）
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 1.1, h + 1.1),
    new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  glow.position.z = -0.06;
  g.add(glow);

  // 金框 + 暗色内衬
  const gold = new THREE.MeshStandardMaterial({ color: 0xa8843c, metalness: 0.92, roughness: 0.34 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.34, h + 0.34, 0.12), gold);
  g.add(frame);
  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x1c150c, roughness: 0.6 }),
  );
  lip.position.z = 0.04;
  g.add(lip);

  // 真迹画布
  const canvas = texture
    ? new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture }))
    : new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0xcfc5b0, roughness: 0.96 }));
  canvas.position.z = 0.075;
  g.add(canvas);

  // 铭牌：画名 / 译名 / 画家（字号随文字长度自适应，长标题自动收进框内，不超边）
  const plaque = textPlane({
    width: 1.16, height: 0.42, ppm: 360,
    draw: (ctx, cw, ch) => {
      ctx.fillStyle = 'rgba(12,10,8,0.55)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = cssColor(accent, 0.55);
      ctx.lineWidth = 2;
      ctx.strokeRect(5, 5, cw - 10, ch - 10);
      const maxW = cw * 0.9; // 框内可用宽度（留边距）
      // 自适应字号：文字超过可用宽度时按比例缩小
      const fit = (text, px, spRatio, fam, weight = '300', style = '') => {
        ctx.font = `${style}${weight} ${px}px ${fam}`;
        const wpx = ctx.measureText(text).width + px * spRatio * Math.max(0, text.length - 1);
        if (wpx > maxW) px *= maxW / wpx;
        return { px, sp: px * spRatio };
      };
      // 画名
      const title = `《${work.title}》`;
      let f = fit(title, ch * 0.23, 0.04, FONT_CN, '400');
      ctx.fillStyle = 'rgba(238,231,217,0.95)';
      ctx.font = `400 ${f.px}px ${FONT_CN}`;
      drawSpaced(ctx, title, cw / 2, ch * 0.3, f.sp);
      // 译名
      if (work.original) {
        f = fit(work.original, ch * 0.15, 0, FONT_EN, '300', 'italic ');
        ctx.fillStyle = cssColor(accent, 0.85);
        ctx.font = `italic 300 ${f.px}px ${FONT_EN}`;
        ctx.fillText(work.original, cw / 2, ch * 0.58);
      }
      // 画家
      f = fit(artist.name, ch * 0.13, 0, FONT_CN, '300');
      ctx.fillStyle = 'rgba(238,231,217,0.55)';
      ctx.font = `300 ${f.px}px ${FONT_CN}`;
      ctx.fillText(artist.name, cw / 2, ch * 0.81);
    },
  });
  plaque.position.set(0, -(h / 2 + 0.42), 0.05);
  g.add(plaque);

  const entry = {
    work, artist, hall: wing,
    group: g, glow, canvas, w, h, texture,
    center: new THREE.Vector3(), normal: new THREE.Vector3(),
    hover: 0, hoverTarget: 0, featured,
  };
  const ud = { type: 'work', entry };
  canvas.userData = ud;
  frame.userData = ud;
  lip.userData = ud;
  return { group: g, entry, canvas, w, h };
}

// ---------- 中厅（环形展示厅）：画屏沿环排布，入口缺口朝大厅 ----------
function buildAntechamber(wing, wingIndex, doors, pickTargets, portals, portalTex, futureTex, futureWorks) {
  const g = new THREE.Group(); // 局部：+z 朝大厅中心，-z 向外
  const isOpen = wing.type === 'open';

  // open 馆（未来馆）：真迹排在最居中的「主画位」，其余槽位仍是虚位以待的空框。
  // 第一幅作品 = 正对入口的背墙正中；新增作品自动左右交替向外铺开（馆随作品生长）。
  let openSlots = null;
  let n;
  if (isOpen) {
    const pieces = [];
    (wing.artists || []).forEach((a) => (a.works || []).forEach((wk) => pieces.push({ artist: a, work: wk })));
    const emptyCount = wing.frames || 0;
    n = Math.max(1, pieces.length + emptyCount);
    const order = centerOutOrder(n);
    openSlots = new Array(n).fill(null);
    let oi = 0;
    pieces.forEach((p, pi) => {
      openSlots[order[oi++]] = { kind: 'work', artist: p.artist, work: p.work, featured: pi === 0 };
    });
    let en = 0;
    while (oi < n) openSlots[order[oi++]] = { kind: 'empty', index: en++ };
  } else {
    n = wing.artists.length;
  }
  const rr = ringRadiusFor(n);
  const Cz = -(DPASS + rr); // 环心 z（局部）

  const wallMat = new THREE.MeshStandardMaterial({ color: wing.wall, roughness: 0.95, metalness: 0.02 });

  // 环厅地面：镜面反射 + 暗色罩（与艺术家内厅同质感，倒映画屏与星光）
  const mirror = new Reflector(new THREE.CircleGeometry(rr, 72), {
    clipBias: 0.003, textureWidth: 512, textureHeight: 512, color: 0x8a8a90,
  });
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.set(0, 0.01, Cz);
  g.add(mirror);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(rr, 72),
    new THREE.MeshBasicMaterial({ color: wing.floor, transparent: true, opacity: 0.82, depthWrite: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.02, Cz);
  floor.userData.type = 'floor';
  g.add(floor);
  pickTargets.push(floor);

  // 环墙（three 圆柱 thetaStart 自 +z 起，缺口正对入口）
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(rr + 0.25, rr + 0.25, RING_H, 80, 1, true, ENTRANCE_HALF, Math.PI * 2 - 2 * ENTRANCE_HALF),
    new THREE.MeshStandardMaterial({ color: wing.wall, roughness: 0.95, metalness: 0.02, side: THREE.BackSide }),
  );
  wall.position.set(0, RING_H / 2, Cz);
  g.add(wall);

  // 顶 + 中央天光
  const ceil = new THREE.Mesh(
    new THREE.CircleGeometry(rr + 0.3, 72),
    new THREE.MeshStandardMaterial({ color: 0x0a0908, roughness: 1, side: THREE.DoubleSide }),
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, RING_H, Cz);
  g.add(ceil);
  const sky = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 48),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(wing.lightColor).multiplyScalar(isOpen ? 0.5 : 0.4) }),
  );
  sky.rotation.x = Math.PI / 2;
  sky.position.set(0, RING_H - 0.05, Cz);
  g.add(sky);

  // 踢脚发光环（与展廊一脉相承）
  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(rr - 0.05, 0.025, 8, 120),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(wing.accent).multiplyScalar(1.4) }),
  );
  trim.rotation.x = Math.PI / 2;
  trim.position.set(0, 0.14, Cz);
  g.add(trim);

  // 中央顶灯
  const pl = new THREE.PointLight(wing.lightColor, isOpen ? 16 : 13, rr * 2.4, 1.6);
  pl.position.set(0, RING_H - 0.7, Cz);
  g.add(pl);

  // 入口甬道（门廊 → 环厅）
  [-1, 1].forEach((s) => {
    const pw = new THREE.Mesh(new THREE.BoxGeometry(0.4, RING_H, DPASS + 1.6), wallMat);
    pw.position.set(s * 2.2, RING_H / 2, -DPASS / 2 + 0.4);
    g.add(pw);
  });

  // 甬道地面：隐形但可拾取，桥接「大厅圆盘 ↔ 环厅地面」之间的空档，
  // 使点击地面前往在跨门处不再断点（视觉保持原样，仅供点选落点）
  const passFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(4.0, DPASS + 2.0),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  passFloor.rotation.x = -Math.PI / 2;
  passFloor.position.set(0, 0.02, -DPASS / 2 + 0.3);
  passFloor.userData.type = 'floor';
  g.add(passFloor);
  pickTargets.push(passFloor);
  const pceil = new THREE.Mesh(
    new THREE.BoxGeometry(4.4, 0.3, DPASS + 1.0),
    new THREE.MeshStandardMaterial({ color: 0x0a0908, roughness: 1 }),
  );
  pceil.position.set(0, RING_H - 0.15, -DPASS / 2 + 0.4);
  g.add(pceil);

  // 内容沿环铺开：以背墙（φ=π，正对入口）为中心聚拢，少画家时不散到两侧
  const margin = ENTRANCE_HALF + 0.38;          // 距入口的安全角
  const avail = Math.PI * 2 - 2 * margin;        // 可用弧
  // open 馆（未来馆）把画框收束在背墙中段、远离入口豁口（否则边缘画框背后会露出黑色入口）；常规馆维持原铺展
  const spread = isOpen ? Math.min(avail, 3.6) : avail;
  const used = Math.min((n - 1) * 0.8, spread);  // 实际铺开角（每屏约 0.8rad）
  for (let k = 0; k < n; k++) {
    const phi = n === 1 ? Math.PI : Math.PI - used / 2 + used * (k / (n - 1));
    const px = Math.sin(phi) * (rr - 0.3);
    const pz = Cz + Math.cos(phi) * (rr - 0.3);
    if (isOpen) {
      const slot = openSlots[k];
      if (slot.kind === 'work') {
        const built = buildFutureWork(wing, slot.artist, slot.work, futureTex[slot.work.id], slot.featured);
        built.group.position.set(px, FUTURE_CY, pz);
        built.group.rotation.y = phi + Math.PI; // 面朝环心
        g.add(built.group);
        built.group.traverse((m) => { if (m.userData?.type === 'work') pickTargets.push(m); });
        futureWorks.push(built.entry);
        // 每幅真迹都配一束顶部聚光（自环心一侧上方打向画面）——所有画作一致的「打光」感，主画位略强
        const lx = Math.sin(phi) * (rr - 2.6);
        const lz = Cz + Math.cos(phi) * (rr - 2.6);
        const spot = new THREE.SpotLight(wing.lightColor, slot.featured ? 78 : 64, 16, 0.5, 0.72, 1.6);
        spot.position.set(lx, RING_H - 0.5, lz);
        spot.target.position.set(px, FUTURE_CY, pz);
        g.add(spot, spot.target);
      } else {
        const f = buildEmptyFrame(wing, slot.index);
        f.position.set(px, 2.15, pz);
        f.rotation.y = phi + Math.PI;
        g.add(f);
        f.traverse((m) => { if (m.userData?.type) pickTargets.push(m); });
      }
    } else {
      const artist = wing.artists[k];
      const d = buildArtistPortal(wing, artist, wingIndex, k, portalTex[artist.id]);
      d.group.position.set(px, 0, pz);
      d.group.rotation.y = phi + Math.PI; // 面朝环心
      g.add(d.group);
      portals.push(d.screen);
      pickTargets.push(...d.pickables);
      doors.push({ wingIndex, artistIndex: k, phi });
    }
  }

  return { group: g, rr, Cz };
}

// ---------- 博物馆主体 ----------
export function createLobby(gallery, portalTex = {}, futureTex = {}) {
  const wings = gallery.wings;
  const uiText = gallery.ui || {};
  LOBBY_UI = uiText;   // 同步给模块级辅助函数（buildEmptyFrame 在 createLobby 之外）
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050403);
  const wallMarble = makeMarbleTexture({
    base: [232, 228, 218], vein: [158, 148, 132], accent: [248, 244, 232], scale: 0.85,
  });

  const textureLoader = new THREE.TextureLoader();
  const spotlightMap = textureLoader.load(import.meta.env.BASE_URL + 'textures/disturb.jpg');
  spotlightMap.minFilter = THREE.LinearFilter;
  spotlightMap.magFilter = THREE.LinearFilter;
  spotlightMap.generateMipmaps = false;
  spotlightMap.colorSpace = THREE.SRGBColorSpace;

  const targets = [];
  const portals = []; // 艺术家画屏（代表作镜面屏）
  const futureWorks = [];       // 未来馆已挂上的真迹 entry（就地品读用）
  const doorFx = [];            // 馆门选中辉光控制器 {picker, glow, light, base, hover}
  const doorRegistry = [];      // {wingIndex, artistIndex, pos, yaw}
  const corridorInfo = [];      // {a, origin, length, open}

  // ---------- 门洞角度（数量随配置，沿入口对面的弧均匀分布） ----------
  const n = wings.length;
  const STEP = 0.78;
  const spread = n > 1 ? Math.min((n - 1) * STEP, Math.PI * 1.5) : 0;
  const angles = wings.map((_, i) => (n > 1 ? -spread / 2 + (spread / (n - 1)) * i : 0));

  // ---------- 鼓形墙（在开放馆的门位留出真实洞口） ----------
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x302a24, map: wallMarble, roughness: 0.88, metalness: 0.01, side: THREE.DoubleSide,
  });
  const plinthMat = new THREE.MeshStandardMaterial({
    color: 0x1b1713, map: wallMarble, roughness: 0.84, metalness: 0.02, side: THREE.DoubleSide,
  });

  // 世界方位角 θ（x = r·sinθ, z = r·cosθ）：门 i 位于 θ = π - a_i
  const openThetas = wings
    .map((w, i) => ({ open: !w.comingSoon, theta: Math.PI - angles[i] }))
    .filter((d) => d.open)
    .map((d) => ((d.theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2))
    .sort((x, y) => x - y);

  const arcs = [];
  if (openThetas.length === 0) {
    arcs.push([0, Math.PI * 2]);
  } else {
    for (let i = 0; i < openThetas.length; i++) {
      const t0 = openThetas[i] + GAP;
      const t1 = (i + 1 < openThetas.length ? openThetas[i + 1] : openThetas[0] + Math.PI * 2) - GAP;
      arcs.push([t0, t1]);
    }
  }
  arcs.forEach(([t0, t1]) => {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 64, 1, true, t0, t1 - t0), wallMat);
    drum.position.y = H / 2;
    scene.add(drum);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.04, R - 0.04, 1.05, 64, 1, true, t0, t1 - t0), plinthMat);
    plinth.position.y = 0.52;
    scene.add(plinth);
  });

  // 檐口（整环，高于门洞）
  const cornice = new THREE.Mesh(
    new THREE.CylinderGeometry(R - 0.06, R - 0.06, 0.55, 96, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x28221d, map: wallMarble, roughness: 0.86, side: THREE.BackSide }),
  );
  cornice.position.y = H - 0.55;
  scene.add(cornice);

  // 铜质腰线：下环避开门洞分段
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0x77603a, metalness: 0.88, roughness: 0.42, envMapIntensity: 0.65,
  });
  arcs.forEach(([t0, t1]) => {
    const seg = new THREE.Group();
    const torus = new THREE.Mesh(new THREE.TorusGeometry(R - 0.07, 0.022, 8, 96, t1 - t0), brassMat);
    torus.rotation.x = Math.PI / 2;
    seg.add(torus);
    seg.rotation.y = t1 - Math.PI / 2; // 弧段对齐到 [t0, t1]
    seg.position.y = 1.08;
    scene.add(seg);
  });

  // ---------- 穹顶 ----------
  const ceil = new THREE.Mesh(
    new THREE.CircleGeometry(R + 0.3, 96),
    new THREE.MeshStandardMaterial({ color: 0x25211d, map: wallMarble, roughness: 0.94, side: THREE.DoubleSide }),
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  scene.add(ceil);

  // ---------- 大厅地面（承光面） ----------
  // 之前是近黑(0x1b1a18，反射率~1%)，真聚光灯打上去几乎看不见，所以才在上面
  // 贴了一张叠加贴图当假光斑——那块硬边"圆饼/地毯"。现在删掉那张假贴图，
  // 把地面调亮成中性暖灰：下面那盏【带 disturb.jpg 贴图的真聚光灯】会把同一张
  // 有机的青/琥珀色光斑投到地面上，靠 penumbra/decay 自然地"迅速变暗、逐渐隐去"，
  // 没有清晰边界——和沙盒「官方单灯感」完全同一套：一盏图片灯，同时照雕塑和地面。
  // 灯锥之外只有微弱半球光(0.16)，整体仍是暗场，只有移动的光池被照亮。
  const floorTint = new THREE.Mesh(
    new THREE.CircleGeometry(R + 0.2, 80),
    new THREE.MeshLambertMaterial({ color: 0x8a8478 }),
  );
  floorTint.rotation.x = -Math.PI / 2;
  floorTint.position.y = 0.012;
  floorTint.userData.type = 'floor';
  scene.add(floorTint);
  targets.push(floorTint);

  // ---------- 中央雕塑 ----------
  const sculptureBaseMat = new THREE.MeshStandardMaterial({
    color: 0x1d1712, map: wallMarble, roughness: 0.62, metalness: 0.05, envMapIntensity: 0.18,
  });
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(1.08, 1.18, 0.36, 72),
    sculptureBaseMat,
  );
  pedestal.position.y = 0.18;
  scene.add(pedestal);
  const pedestalCap = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.22, 0.08, 72), brassMat);
  pedestalCap.position.y = 0.4;
  scene.add(pedestalCap);

  const sculptureShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.8, 1.25),
    new THREE.MeshBasicMaterial({
      map: makeSoftShadowTexture(), color: 0x17120f, transparent: true, opacity: 0.34, depthWrite: false,
    }),
  );
  sculptureShadow.rotation.x = -Math.PI / 2;
  sculptureShadow.position.y = 0.035;
  scene.add(sculptureShadow);

  const sculpture = new THREE.Group();
  scene.add(sculpture);
  let finishSculpture;
  const sculptureReady = new Promise((resolve) => { finishSculpture = resolve; });
  new THREE.BufferGeometryLoader().load(
    import.meta.env.BASE_URL + SCULPTURE_MODEL,
    (geometry) => {
      geometry.scale(0.0024, 0.0024, 0.0024);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshLambertMaterial({ color: 0xfffbf1, emissive: 0x241f18, emissiveIntensity: 0.12 }),
      );
      mesh.rotation.y = Math.PI;
      mesh.position.y = 0.44 - geometry.boundingBox.min.y;
      sculpture.add(mesh);
      finishSculpture(true);
    },
    undefined,
    (error) => {
      console.warn('[museum] sculpture failed to load; continuing with the pedestal', error);
      finishSculpture(false);
    },
  );

  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(0, 0.1, 0);
  scene.add(spotTarget);
  const spot = new THREE.SpotLight(0xffffff, 155, 0, Math.PI / 6, 1, 2);
  spot.map = spotlightMap;
  spot.position.set(3.1, H - 1.55, 3.1);
  spot.target = spotTarget;
  scene.add(spot, spot.target);

  const statueTarget = new THREE.Object3D();
  statueTarget.position.set(0, 1.58, 0);
  scene.add(statueTarget);
  const statueFill = new THREE.SpotLight(0xfff7ea, 20, 13, 0.52, 0.82, 1.6);
  statueFill.position.set(0, H - 1.35, 3.2);
  statueFill.target = statueTarget;
  scene.add(statueFill, statueFill.target);

  // ---------- 馆门 + 馆廊 ----------
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x2c241d, map: wallMarble, roughness: 0.74, metalness: 0.04,
  });
  const stoneDark = new THREE.MeshStandardMaterial({ color: 0x0d0a08, roughness: 0.86 });

  wings.forEach((wing, i) => {
    const a = angles[i];
    const open = !wing.comingSoon;
    const g = new THREE.Group();
    g.position.set(Math.sin(a) * (R - 0.1), 0, -Math.cos(a) * (R - 0.1));
    g.rotation.y = -a;
    scene.add(g);

    if (open) {
      // 真实门洞：穿墙甬道（侧壁 + 顶部填充），可步行通过
      [-1, 1].forEach((s) => {
        const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.85, 1.7), stoneDark);
        cheek.position.set(s * 2.05, 2.42, -0.15);
        g.add(cheek);
      });
      const passTop = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.5, 1.7), stoneDark);
      passTop.position.set(0, 5.6, -0.15);
      g.add(passTop);
      const filler = new THREE.Mesh(new THREE.BoxGeometry(5.6, H - 6.3, 0.55), wallMat);
      filler.position.set(0, (6.3 + H) / 2, 0.1);
      g.add(filler);
    } else {
      // 未开馆：保持封死的门洞（暗室，无光膜）
      const inset = new THREE.Mesh(new THREE.BoxGeometry(3.6, 4.8, 1.0), new THREE.MeshStandardMaterial({ color: 0x060504, roughness: 1 }));
      inset.position.set(0, 2.4, -0.1);
      g.add(inset);
    }

    // 石质门套：双层壁柱 + 柱头 + 楣梁（沿用定稿样式）
    [-1, 1].forEach((s) => {
      const pilaster = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5.5, 0.42), stoneMat);
      pilaster.position.set(s * 2.12, 2.75, 0.7);
      g.add(pilaster);
      const innerJamb = new THREE.Mesh(new THREE.BoxGeometry(0.28, 5.0, 0.22), stoneDark);
      innerJamb.position.set(s * 1.78, 2.5, 0.86);
      g.add(innerJamb);
      const capital = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.3, 0.46), stoneMat);
      capital.position.set(s * 2.12, 5.62, 0.74);
      g.add(capital);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.36, 0.46), stoneDark);
      base.position.set(s * 2.12, 0.18, 0.74);
      g.add(base);
    });
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.85, 0.44), stoneMat);
    lintel.position.set(0, 6.2, 0.72);
    g.add(lintel);
    const lintelTrim = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.07, 0.045), brassMat);
    lintelTrim.position.set(0, 5.81, 0.97);
    lintelTrim.renderOrder = 8;
    g.add(lintelTrim);

    // 门楣铭牌
    const tabletBack = new THREE.Mesh(new THREE.BoxGeometry(4.25, 1.45, 0.08), stoneDark);
    tabletBack.position.set(0, 7.32, 0.74);
    tabletBack.renderOrder = 7;
    g.add(tabletBack);
    const tablet = textPlane({
      width: 4.05, height: 1.28, ppm: 210,
      // depthTest 必须为 true：否则铭牌无视深度缓冲、永远画在最前面，
      // 当雕塑挡在它前面时就会"透过"雕塑显出馆名（穿行时看到的那种透明感）。
      // 它背后的铭牌底板只差 ~3cm，正常深度测试不会闪烁，所以不需要关掉 depthTest。
      depthTest: true,
      draw: (ctx, w, h) => {
        ctx.strokeStyle = cssColor(wing.accent, 0.65);
        ctx.lineWidth = 3;
        ctx.strokeRect(10, 10, w - 20, h - 20);
        ctx.strokeStyle = cssColor(wing.accent, 0.3);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(22, 22, w - 44, h - 44);
        ctx.fillStyle = cssColor(wing.accent, 0.92);
        ctx.font = `400 ${h * 0.16}px ${FONT_EN}`;
        ctx.fillText(wing.no, w / 2, h * 0.24);
        ctx.fillStyle = open ? 'rgba(238,231,217,0.95)' : 'rgba(238,231,217,0.6)';
        ctx.font = `300 ${h * 0.245}px ${FONT_CN}`;
        {
          // 馆名自适应收字：英文长馆名不截断。
          const maxW = w * 0.92;
          let px = h * 0.21, sp = 6;
          ctx.font = `300 ${px}px ${FONT_CN}`;
          const tw = [...String(wing.name)].reduce((a2, c2) => a2 + ctx.measureText(c2).width, 0)
                   + sp * Math.max(0, String(wing.name).length - 1);
          if (tw > maxW) { const k2 = maxW / tw; px *= k2; sp *= k2; ctx.font = `300 ${px}px ${FONT_CN}`; }
          drawSpaced(ctx, wing.name, w / 2, h * 0.52, sp);
        }
        if (open) {
          ctx.fillStyle = 'rgba(238,231,217,0.42)';
          ctx.font = `300 ${h * 0.12}px ${FONT_EN}`;
          {
            const maxW = w * 0.9;
            let px = h * 0.12, sp = 3;
            ctx.font = `300 ${px}px ${FONT_EN}`;
            const tw = [...String(wing.latin)].reduce((a2, c2) => a2 + ctx.measureText(c2).width, 0)
                     + sp * Math.max(0, String(wing.latin).length - 1);
            if (tw > maxW) { const k2 = maxW / tw; px *= k2; sp *= k2; ctx.font = `300 ${px}px ${FONT_EN}`; }
            drawSpaced(ctx, wing.latin, w / 2, h * 0.79, sp);
          }
        } else {
          ctx.fillStyle = cssColor(wing.accent, 0.75);
          ctx.font = `300 ${h * 0.115}px ${FONT_CN}`;
          drawSpaced(ctx, uiText.comingSoon || 'COMING SOON', w / 2, h * 0.79, 2);
        }
      },
    });
    tablet.position.set(0, 7.32, 0.86);
    tablet.renderOrder = 20;
    g.add(tablet);

    // 门槛石（大厅侧 + 长廊侧）
    const threshold = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.1, 1.5), stoneDark);
    threshold.position.set(0, 0.05, 1.1);
    g.add(threshold);

    // 门洞照明
    const pl = new THREE.PointLight(wing.accent, open ? 4 : 1.3, 9, 1.8);
    pl.position.set(0, 3.2, 0.9);
    g.add(pl);
    const tabletLight = new THREE.PointLight(0xffe2b8, 3, 5, 1.8);
    tabletLight.position.set(0, 6.6, 1.6);
    g.add(tabletLight);

    // 馆廊
    if (open) {
      const innerThreshold = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.09, 1.0), stoneDark);
      innerThreshold.position.set(0, 0.045, -0.85);
      g.add(innerThreshold);

      // 馆门拾取面：覆盖整个门洞，双面可点——大厅一侧点击进馆、馆内一侧点击出馆。
      // 它比门后的画屏更近，射线先命中它，在大厅里点不穿到里面的画作。
      const picker = new THREE.Mesh(
        new THREE.PlaneGeometry(4.6, 5.2),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      );
      picker.position.set(0, 2.5, 0.35);
      picker.userData = { type: 'wing-door', wingIndex: i, hoverTarget: 0 };
      g.add(picker);
      targets.push(picker);

      // 选中辉光：整扇门轻微发光（静止全暗，悬停渐亮；双面可见，馆内回望也亮）
      const glow = makeDoorGlow(3.7, 4.7, wing.accent);
      glow.group.position.set(0, 2.55, 0);
      g.add(glow.group);

      // 门楣铭牌辉光：与馆门一同微微发光（铭牌后柔光晕，悬停渐亮）
      const tabletGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(5.2, 2.3),
        new THREE.MeshBasicMaterial({
          color: wing.accent, map: softCircleTexture(), transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      tabletGlow.position.set(0, 7.32, 0.8);
      g.add(tabletGlow);

      doorFx.push({
        picker, glow, light: pl, base: pl.intensity,
        tablet: tabletGlow, tlight: tabletLight, tbase: tabletLight.intensity, hover: 0,
      });

      const { group: cg, rr, Cz } = buildAntechamber(wing, i, doorRegistry, targets, portals, portalTex, futureTex, futureWorks);
      g.add(cg);
      corridorInfo.push({ a, origin: g.position.clone(), rr, Cz, wing, index: i });
    } else {
      corridorInfo.push(null);
    }
  });

  // ---------- 未来馆真迹：场景图组装完毕后，解出每幅画的世界坐标中心与法线 ----------
  // （供「就地品读」运镜使用——与展厅画作 entry 同样的 center/normal 字段）
  scene.updateMatrixWorld(true);
  const _wq = new THREE.Quaternion();
  futureWorks.forEach((e) => {
    e.canvas.getWorldPosition(e.center);
    e.canvas.getWorldQuaternion(_wq);
    e.normal.set(0, 0, 1).applyQuaternion(_wq).normalize(); // 画面 +z 朝环心（观者一侧）
  });

  // ---------- 光柱中的微尘 ----------
  const dust = makeDust({ count: 170, box: [7, H - 1.5, 7], center: [0, H / 2, 0], opacity: 0.22 });
  scene.add(dust);

  // ---------- 环境光 ----------
  scene.add(new THREE.HemisphereLight(0xf4eadc, 0x211a14, 0.16));
  scene.add(new THREE.AmbientLight(0xffffff, 0.018));

  // ---------- 行走区域：大厅圆盘 ∪ 各馆廊矩形（取最近投影） ----------
  const tmpV = new THREE.Vector3();
  function corridorLocal(p, info) {
    // 世界 → 馆廊局部（+z 朝大厅，-z 向外）；馆廊组旋转为 -a，逆变换即 Ry(+a)
    tmpV.copy(p).sub(info.origin);
    const cosA = Math.cos(info.a);
    const sinA = Math.sin(info.a);
    return {
      x: tmpV.x * cosA + tmpV.z * sinA,
      z: -tmpV.x * sinA + tmpV.z * cosA,
    };
  }
  function localToWorld(lx, lz, info, out) {
    // 局部 → 世界：Ry(-a)
    const cosA = Math.cos(info.a);
    const sinA = Math.sin(info.a);
    out.set(lx * cosA - lz * sinA, 0, lx * sinA + lz * cosA).add(info.origin);
    return out;
  }

  const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const bounds = (p) => {
    const y = p.y;
    const candidates = [];

    // 大厅圆盘（含中央基座绕行）
    {
      const c = new THREE.Vector3(p.x, 0, p.z);
      const r = Math.hypot(c.x, c.z);
      if (r > 12.2) { c.x *= 12.2 / r; c.z *= 12.2 / r; }
      const rc = Math.hypot(c.x, c.z);
      if (rc < 1.5 && rc > 0.001) { c.x *= 1.5 / rc; c.z *= 1.5 / rc; }
      candidates.push(c);
    }

    // 门廊甬道 + 环厅
    corridorInfo.forEach((info) => {
      if (!info) return;
      const l = corridorLocal(p, info);
      // 甬道（大厅 ↔ 环厅的窄口）：两端都与相邻区域交叠，消除"接缝无人区"——
      // 否则人落在两个可行走区之间时会被就近吸附、来回跳（走进通道时镜头被拽一下）。
      //  · 朝大厅一侧（出门垛后 lz>0.7）张成喇叭口，平滑并入大厅圆盘；
      //  · 朝环厅一侧把远端伸进环厅圆盘(半径 rr-0.7，最近边在 lz≈-(DPASS+0.7))，留足交叠。
      {
        const lz = clampNum(l.z, -(DPASS + 1.5), 2.4);
        const halfW = 1.9 + Math.max(0, lz - 0.7) * 1.7; // 门内仍是 ±1.9 窄口（防穿墙），仅大厅侧张开
        const lx = clampNum(l.x, -halfW, halfW);
        candidates.push(localToWorld(lx, lz, info, new THREE.Vector3()));
      }
      // 环厅圆盘（半径内留 0.7m 余量）
      {
        const dx = l.x;
        const dz = l.z - info.Cz;
        const dd = Math.hypot(dx, dz);
        const R2 = info.rr - 0.7;
        let lx = l.x;
        let lz = l.z;
        if (dd > R2 && dd > 1e-4) { lx = dx * R2 / dd; lz = info.Cz + dz * R2 / dd; }
        candidates.push(localToWorld(lx, lz, info, new THREE.Vector3()));
      }
    });

    let best = candidates[0];
    let bd = Infinity;
    for (const c of candidates) {
      const d = (c.x - p.x) * (c.x - p.x) + (c.z - p.z) * (c.z - p.z);
      if (d < bd) { bd = d; best = c; }
    }
    p.x = best.x;
    p.z = best.z;
    p.y = y;
  };

  // 所在分区：-1 = 大厅，否则为馆 index（用于面包屑与音景）
  const zoneAt = (p) => {
    for (const info of corridorInfo) {
      if (!info) continue;
      const l = corridorLocal(p, info);
      if (Math.hypot(l.x, l.z - info.Cz) < info.rr + 0.5) return info.index; // 环厅内
      if (l.z < -0.4 && Math.abs(l.x) < 2.2 && l.z > -(DPASS + 0.5)) return info.index; // 甬道
    }
    return -1;
  };

  // 某画屏在环上的局部位置（由登记的 phi 还原）
  const portalLocal = (info, phi, radius) => ({
    x: Math.sin(phi) * radius,
    z: info.Cz + Math.cos(phi) * radius,
  });
  const yawTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

  // 展廊返回点：回到环厅、正对来时那扇画屏
  const doorReturn = (wingIndex, artistIndex) => {
    const info = corridorInfo[wingIndex];
    const d = doorRegistry.find((x) => x.wingIndex === wingIndex && x.artistIndex === artistIndex);
    if (!info || !d) return null;
    const s = portalLocal(info, d.phi, info.rr - 0.3);
    const c = portalLocal(info, d.phi, info.rr * 0.42);
    const stand = localToWorld(c.x, c.z, info, new THREE.Vector3());
    stand.y = 1.7;
    const screen = localToWorld(s.x, s.z, info, new THREE.Vector3());
    return { pos: stand, yaw: yawTo(stand, screen) };
  };

  // 环厅中心（巡检/深链用）：站环心、面向背侧
  const corridorMid = (wingIndex) => {
    const info = corridorInfo[wingIndex];
    if (!info) return null;
    const pos = localToWorld(0, info.Cz, info, new THREE.Vector3());
    pos.y = 1.7;
    const far = localToWorld(0, info.Cz - (info.rr - 0.3), info, new THREE.Vector3());
    return { pos, yaw: yawTo(pos, far) };
  };

  // 正对某画屏的相机位姿（巡检 / 粒子穿越落点 / 深链用）
  const portalView = (wingIndex, artistIndex) => {
    const info = corridorInfo[wingIndex];
    const d = doorRegistry.find((x) => x.wingIndex === wingIndex && x.artistIndex === artistIndex);
    if (!info || !d) return null;
    const s = portalLocal(info, d.phi, info.rr - 0.3);
    const c = portalLocal(info, d.phi, info.rr - 3.4);
    const cam = localToWorld(c.x, c.z, info, new THREE.Vector3());
    cam.y = 1.7;
    const screen = localToWorld(s.x, s.z, info, new THREE.Vector3());
    const distH = Math.hypot(screen.x - cam.x, screen.z - cam.z);
    return { pos: cam, yaw: yawTo(cam, screen), pitch: Math.atan2(PORTAL_CY - 1.7, distH) };
  };

  // 进馆落点：站在环厅入口内侧（靠门口）、面朝画屏聚拢的背墙，尽收画屏入视野
  // （比定位到环心视野更开阔；环厅近门边恒在 z=-DPASS 处，故落点与半径无关）
  const wingEnter = (wingIndex) => {
    const info = corridorInfo[wingIndex];
    if (!info) return null;
    const pos = localToWorld(0, -(DPASS + 1.4), info, new THREE.Vector3());
    pos.y = 1.7;
    const look = localToWorld(0, info.Cz - (info.rr - 0.3), info, new THREE.Vector3());
    return { pos, yaw: yawTo(pos, look) };
  };

  // 出馆落点：回到鼓厅、站在该门内侧不远处，面朝中央雕塑
  const wingExit = (wingIndex) => {
    const info = corridorInfo[wingIndex];
    if (!info) return null;
    const standR = 6.8;
    const pos = new THREE.Vector3(Math.sin(info.a) * standR, 1.7, -Math.cos(info.a) * standR);
    return { pos, yaw: yawTo(pos, new THREE.Vector3(0, 1.7, 0)) };
  };

  function update(dt, t) {
    dust.userData.update(dt, t);
    const a = t * 0.16;
    spot.position.set(Math.cos(a) * 3.2, H - 1.55, Math.sin(a) * 3.2);
    spotTarget.position.set(-Math.cos(a) * 0.55, 0.1, -Math.sin(a) * 0.55);
    sculptureShadow.rotation.z = -a + Math.PI / 2;
    sculptureShadow.position.set(-Math.cos(a) * 0.35, 0.035, -Math.sin(a) * 0.35);
    for (const p of portals) {
      p.userData.update(dt, t);
    }
    // 未来馆真迹：悬停渐亮 + 极微放大（与展厅画作同款手感）
    for (const e of futureWorks) {
      e.hover = lerp(e.hover, e.hoverTarget, Math.min(1, dt * 6));
      e.glow.material.opacity = e.hover * 0.3;
      e.group.scale.setScalar(1 + e.hover * 0.012);
    }
    // 馆门选中辉光：缓动 hover，驱动门洞光膜/描边/外晕 + 门楣铭牌柔光，并微抬门洞与铭牌照明
    for (const d of doorFx) {
      const target = d.picker.userData.hoverTarget || 0;
      d.hover += (target - d.hover) * Math.min(1, dt * 6);
      d.glow.update(t, d.hover);
      d.light.intensity = d.base + d.hover * 1.8;
      d.tablet.material.opacity = d.hover * 0.24;
      d.tlight.intensity = d.tbase + d.hover * 4;
    }
  }

  return {
    scene,
    ready: sculptureReady,
    targets,
    futureWorks,
    update,
    bounds,
    zoneAt,
    doorReturn,
    corridorMid,
    portalView,
    wingEnter,
    wingExit,
    entry: { pos: new THREE.Vector3(-2.45, 2.1, 6.12), yaw: -0.12, pitch: 0.105 },
  };
}
