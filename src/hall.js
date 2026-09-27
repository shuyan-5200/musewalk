// ============================================================
//  展馆生成器：由馆藏数据自动布展的艺术长廊
// ============================================================
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { makeDust, makeMembrane, makeBeam } from './fx.js';
import { textPlane, drawSpaced, FONT_CN, FONT_EN, clamp, lerp } from './utils.js';

const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches;
const WALL_X = 6.5;     // 半宽
const HEIGHT = 7.6;     // 层高
const HANG_Y = 2.42;    // 挂画中线

function cssColor(hex, a = 1) {
  return `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;
}

function frameHalfWidth(style, w) {
  if (style === 'gold') return w / 2 + 0.17;
  if (style === 'dark') return w / 2 + 0.07;
  return w / 2 + 0.275;
}

function spacedWidth(ctx, text, spacing) {
  return [...text].reduce((sum, ch) => sum + ctx.measureText(ch).width, 0)
    + spacing * Math.max(0, text.length - 1);
}

function drawFittedSpaced(ctx, text, cx, y, {
  family,
  weight = 300,
  style = '',
  maxPx,
  startPx,
  minPx,
  spacingPx = 0,
}) {
  let px = startPx;
  let spacing = spacingPx;
  while (px > minPx) {
    ctx.font = `${style}${weight} ${px}px ${family}`;
    if (spacedWidth(ctx, text, spacing) <= maxPx) break;
    px -= 1;
    spacing = Math.max(0, spacing - 0.08);
  }
  ctx.font = `${style}${weight} ${px}px ${family}`;
  drawSpaced(ctx, text, cx, y, spacing);
}

function createPlaque(hall, work, w, panelBounds) {
  const titleText = `《${work.title}》`;
  const desired = clamp(
    0.76 + Math.max(titleText.length * 0.055, (work.original || '').length * 0.021),
    0.92,
    1.55,
  );
  const plaqueH = 0.42;
  const frameRight = frameHalfWidth(hall.frameStyle, w);
  const gapFromFrame = 0.46;
  const gapFromPanelEdge = 0.34;
  const panelLeft = panelBounds.left;
  const panelRight = panelBounds.right;
  const panelW = panelRight - panelLeft;
  const maxPlaqueW = panelW - gapFromPanelEdge * 2 - frameRight * 2 - gapFromFrame;
  const plaqueW = clamp(Math.min(desired, maxPlaqueW), 0.9, 1.55);
  const bundleW = frameRight * 2 + gapFromFrame + plaqueW;
  const usableW = panelW - gapFromPanelEdge * 2;
  const bundleLeft = panelLeft + gapFromPanelEdge + Math.max(0, (usableW - bundleW) / 2);
  const artOffsetX = bundleLeft + frameRight;

  const plaque = textPlane({
    width: plaqueW, height: plaqueH, ppm: 460,
    draw: (ctx, cw, ch) => {
      const pad = ch * 0.13;
      const maxText = cw - pad * 2;
      ctx.fillStyle = 'rgba(10,10,14,0.64)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = cssColor(hall.accent, 0.58);
      ctx.lineWidth = Math.max(2, Math.round(ch * 0.012));
      ctx.strokeRect(pad * 0.48, pad * 0.48, cw - pad * 0.96, ch - pad * 0.96);

      ctx.fillStyle = 'rgba(238,231,217,0.95)';
      drawFittedSpaced(ctx, titleText, cw / 2, ch * 0.3, {
        family: FONT_CN,
        weight: 400,
        maxPx: maxText,
        startPx: ch * 0.2,
        minPx: ch * 0.135,
        spacingPx: 2,
      });

      if (work.original) {
        ctx.fillStyle = cssColor(hall.accent, 0.85);
        drawFittedSpaced(ctx, work.original, cw / 2, ch * 0.56, {
          family: FONT_EN,
          weight: 300,
          style: 'italic ',
          maxPx: maxText,
          startPx: ch * 0.13,
          minPx: ch * 0.09,
        });
      }

      ctx.fillStyle = 'rgba(238,231,217,0.58)';
      drawFittedSpaced(ctx, work.year, cw / 2, ch * 0.78, {
        family: FONT_CN,
        weight: 300,
        maxPx: maxText,
        startPx: ch * 0.11,
        minPx: ch * 0.085,
      });
    },
  });

  plaque.position.set(artOffsetX + frameRight + gapFromFrame + plaqueW / 2, -(HANG_Y - 1.42), 0.24);
  plaque.userData.placement = 'side';
  return { plaque, artOffsetX };
}

// ---------- 画框 ----------
function buildFrame(style, w, h) {
  const g = new THREE.Group();
  if (style === 'gold') {
    const gold = new THREE.MeshStandardMaterial({ color: 0xa8843c, metalness: 0.92, roughness: 0.34 });
    const outer = new THREE.Mesh(new THREE.BoxGeometry(w + 0.34, h + 0.34, 0.12), gold);
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x1c150c, roughness: 0.6 }),
    );
    lip.position.z = 0.04;
    g.add(outer, lip);
    g.userData.canvasZ = 0.075;
  } else if (style === 'dark') {
    const wood = new THREE.MeshStandardMaterial({ color: 0x191310, metalness: 0.25, roughness: 0.5 });
    const fr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.08), wood);
    g.add(fr);
    g.userData.canvasZ = 0.045;
  } else {
    // float — 当代悬浮式背板；保持轮廓，但亮度压低，避免被 bloom 放大成白光。
    const mat = new THREE.MeshStandardMaterial({ color: 0x77767a, roughness: 0.96 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.55, h + 0.55, 0.04), mat);
    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x101013, roughness: 0.6 }),
    );
    stand.position.z = 0.045;
    g.add(back, stand);
    g.userData.canvasZ = 0.08;
  }
  return g;
}

// ---------- 单幅挂画 ----------
function hangWork(hallGroup, hall, artist, work, texture, side, z, panelBounds, works) {
  const img = texture.image;
  const aspect = img.width / img.height;
  const maxH = 2.35;
  const maxW = work.wide ? 3.9 : 2.7;
  let h = maxH;
  let w = h * aspect;
  if (w > maxW) { w = maxW; h = w / aspect; }

  const group = new THREE.Group();
  group.position.set(side * (WALL_X - 0.16), HANG_Y, z);
  group.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;

  // 悬停辉光
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 1.0, h + 1.0),
    new THREE.MeshBasicMaterial({
      color: hall.accent, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  glow.position.z = -0.06;
  group.add(glow);

  const frame = buildFrame(hall.frameStyle, w, h, hall.accent);
  group.add(frame);

  const canvas = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: texture }),
  );
  canvas.position.z = frame.userData.canvasZ;
  group.add(canvas);

  // 铭牌
  const { plaque, artOffsetX } = createPlaque(hall, work, w, panelBounds);
  glow.position.x = artOffsetX;
  frame.position.x = artOffsetX;
  canvas.position.x = artOffsetX;
  group.add(plaque);

  hallGroup.add(group);

  // 射灯
  const spotIntensity = hall.frameStyle === 'float' ? 44 : 76;
  const spot = new THREE.SpotLight(hall.lightColor, spotIntensity, 17, 0.6, 0.78, 1.7);
  spot.position.set(side * (WALL_X - 2.7), HEIGHT - 0.7, z);
  spot.target.position.set(side * WALL_X, HANG_Y, z);
  hallGroup.add(spot, spot.target);

  // 运行时信息（供聚焦与画境使用）
  const entry = {
    work, artist, hall, group, glow, canvas,
    w, h, texture,
    center: new THREE.Vector3(side * (WALL_X - 0.16), HANG_Y, z + side * artOffsetX),
    normal: new THREE.Vector3(-side, 0, 0),
    hover: 0, hoverTarget: 0,
  };
  canvas.userData.type = 'work';
  canvas.userData.entry = entry;
  frame.traverse((m) => { m.userData.type = 'work'; m.userData.entry = entry; });
  works.push(entry);
  return entry;
}

// ---------- 艺术家墙头铭文 ----------
function artistHeader(hall, artist, side, z) {
  const mesh = textPlane({
    width: 6.0, height: 3.0, ppm: 110,
    draw: (ctx, w, h) => {
      ctx.fillStyle = cssColor(hall.accent, 0.78);
      ctx.font = `300 ${h * 0.075}px ${FONT_CN}`;
      drawSpaced(ctx, `「 ${artist.epithet} 」`, w / 2, h * 0.13, 6);
      ctx.fillStyle = 'rgba(238,231,217,0.97)';
      ctx.font = `300 ${h * 0.155}px ${FONT_CN}`;
      drawSpaced(ctx, artist.name, w / 2, h * 0.38, 8);
      ctx.fillStyle = 'rgba(238,231,217,0.5)';
      ctx.font = `italic 300 ${h * 0.082}px ${FONT_EN}`;
      ctx.fillText(artist.original, w / 2, h * 0.6);
      ctx.fillStyle = cssColor(hall.accent, 0.65);
      ctx.font = `300 ${h * 0.065}px ${FONT_EN}`;
      drawSpaced(ctx, artist.dates, w / 2, h * 0.76, 3);
      const grad = ctx.createLinearGradient(w * 0.2, 0, w * 0.8, 0);
      grad.addColorStop(0, 'rgba(212,175,90,0)');
      grad.addColorStop(0.5, cssColor(hall.accent, 0.7));
      grad.addColorStop(1, 'rgba(212,175,90,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(w * 0.2, h * 0.875, w * 0.6, 2);
    },
  });
  mesh.position.set(side * (WALL_X - 0.2), 5.05, z);
  mesh.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  return mesh;
}

// ---------- 展馆主体 ----------
export function createHall(hall, textures) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(hall.fog);
  scene.fog = new THREE.Fog(hall.fog, 10, 64);

  const root = new THREE.Group();
  scene.add(root);
  const targets = [];
  const works = [];

  // ----- 布局规划 -----
  // 单艺术家展廊：画作沿两壁交替（左-右-左），亲密紧凑；
  // 多艺术家（兼容旧配置）：按艺术家分段，沿用原布局。
  const sections = [];
  let zEnd;
  if (hall.artists.length === 1) {
    const STRIDE = 4.0; // 双壁交替的悬挂步距（同侧间距 8m）
    const artist = hall.artists[0];
    artist.works.forEach((work, wi) => {
      const zp = -7.0 - wi * STRIDE;       // 画作中心
      sections.push({ artist, side: wi % 2 === 0 ? -1 : 1, z0: zp + 4.2, works: [work], header: wi === 0 });
    });
    zEnd = -7.0 - (artist.works.length - 1) * STRIDE - 6.5;
  } else {
    let z = -7.5;
    hall.artists.forEach((artist, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const n = artist.works.length;
      const len = 2.2 + 3.8 + (n - 1) * 4.7 + 2.6;
      sections.push({ artist, side, z0: z, works: artist.works, header: true });
      z -= len * 0.66;
    });
    const last = sections[sections.length - 1];
    zEnd = last.z0 - (2.2 + 3.8 + (last.works.length - 1) * 4.7 + 2.6) - 6;
  }
  const totalLen = 7.5 + Math.abs(zEnd) + 2;
  const zMid = (7.5 + zEnd) / 2;

  // ----- 地面（镜面 + 暗色罩） -----
  const mirror = new Reflector(new THREE.PlaneGeometry(WALL_X * 2 + 1.4, totalLen + 6), {
    clipBias: 0.003,
    textureWidth: IS_TOUCH ? 512 : 1024,
    textureHeight: IS_TOUCH ? 512 : 1024,
    multisample: IS_TOUCH ? 0 : 4,
    color: 0x9090a0,
  });
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.z = zMid;
  root.add(mirror);

  const floorTint = new THREE.Mesh(
    new THREE.PlaneGeometry(WALL_X * 2 + 1.4, totalLen + 6),
    new THREE.MeshBasicMaterial({ color: hall.floor, transparent: true, opacity: 0.86, depthWrite: false }),
  );
  floorTint.rotation.x = -Math.PI / 2;
  floorTint.position.set(0, 0.012, zMid);
  floorTint.userData.type = 'floor';
  root.add(floorTint);
  targets.push(floorTint);

  // ----- 墙体 -----
  const wallMat = new THREE.MeshStandardMaterial({ color: hall.wall, roughness: 0.96, metalness: 0.02 });
  [-1, 1].forEach((side) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, HEIGHT, totalLen + 6), wallMat);
    wall.position.set(side * (WALL_X + 0.2), HEIGHT / 2, zMid);
    root.add(wall);
  });

  // 端墙与入口墙
  const endWall = new THREE.Mesh(new THREE.BoxGeometry(WALL_X * 2 + 1.6, HEIGHT, 0.4), wallMat);
  endWall.position.set(0, HEIGHT / 2, zEnd - 0.2);
  root.add(endWall);
  const inWall = new THREE.Mesh(new THREE.BoxGeometry(WALL_X * 2 + 1.6, HEIGHT, 0.4), wallMat);
  inWall.position.set(0, HEIGHT / 2, 6.2);
  root.add(inWall);

  // 天花
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(WALL_X * 2 + 1.6, totalLen + 6),
    new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 1 }),
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, HEIGHT, zMid);
  root.add(ceil);

  // 天光带（柔和发光，被 bloom 拾起）
  const skyStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, totalLen - 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(hall.lightColor).multiplyScalar(0.5) }),
  );
  skyStrip.rotation.x = Math.PI / 2;
  skyStrip.position.set(0, HEIGHT - 0.06, zMid);
  root.add(skyStrip);

  // 沿墙踢脚发光线
  const trimColor = new THREE.Color(hall.accent).multiplyScalar(1.5);
  [-1, 1].forEach((side) => {
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.03, totalLen + 5),
      new THREE.MeshBasicMaterial({ color: trimColor }),
    );
    trim.position.set(side * (WALL_X - 0.02), 0.16, zMid);
    root.add(trim);
  });

  // ----- 逐段布展 -----
  sections.forEach(({ artist, side, z0, works: secWorks, header }) => {
    if (header) root.add(artistHeader(hall, artist, side, z0 - 2.0));
    // 背景衬板
    const n = secWorks.length;
    const panelLen = 7.4 + (n - 1) * 4.7;
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 5.3, panelLen),
      new THREE.MeshStandardMaterial({ color: hall.panel, roughness: 0.92 }),
    );
    const panelZ = z0 - 2.0 - panelLen / 2 + 1.4;
    const panelStart = panelZ - panelLen / 2;
    const panelEnd = panelZ + panelLen / 2;
    panel.position.set(side * (WALL_X - 0.05), 2.95, panelZ);
    root.add(panel);

    secWorks.forEach((work, wi) => {
      const tex = textures[work.id];
      if (!tex) return;
      const wz = z0 - 2.2 - 3.8 - wi * 4.7 + 1.8;
      const panelBounds = side > 0
        ? { left: panelStart - wz, right: panelEnd - wz }
        : { left: wz - panelEnd, right: wz - panelStart };
      const e = hangWork(root, hall, artist, work, tex, side, wz, panelBounds, works);
      e.group.userData.type = 'work';
      e.group.userData.entry = e;
      targets.push(e.group);
    });
  });

  // ----- 端墙铭文 -----
  const endText = textPlane({
    width: 9, height: 4.5, ppm: 100,
    draw: (ctx, w, h) => {
      ctx.fillStyle = cssColor(hall.accent, 0.9);
      ctx.font = `300 ${h * 0.16}px ${FONT_EN}`;
      ctx.fillText(hall.no, w / 2, h * 0.18);
      ctx.fillStyle = 'rgba(238,231,217,0.92)';
      ctx.font = `200 ${h * 0.2}px ${FONT_CN}`;
      drawSpaced(ctx, hall.name, w / 2, h * 0.47, 14);
      ctx.fillStyle = 'rgba(238,231,217,0.4)';
      ctx.font = `300 ${h * 0.07}px ${FONT_EN}`;
      drawSpaced(ctx, hall.latin, w / 2, h * 0.7, 6);
    },
  });
  endText.position.set(0, 4.1, zEnd + 0.25);
  root.add(endText);

  const endBeam = makeBeam({ rTop: 0.8, rBottom: 3.2, height: HEIGHT, color: hall.lightColor, opacity: 0.1 });
  endBeam.position.set(0, HEIGHT / 2, zEnd + 2.5);
  root.add(endBeam);

  // ----- 回长廊之门 -----
  const back = makeMembrane(3.0, 4.6, hall.accent);
  back.position.set(0, 2.3, 5.95);
  back.rotation.y = Math.PI;
  back.userData.type = 'lobby';
  back.userData.hover = 0;
  back.userData.hoverTarget = 0;
  root.add(back);
  targets.push(back);

  const backPlaque = textPlane({
    width: 2.6, height: 0.7, ppm: 200,
    draw: (ctx, w, h) => {
      ctx.fillStyle = 'rgba(238,231,217,0.85)';
      ctx.font = `300 ${h * 0.34}px ${FONT_CN}`;
      drawSpaced(ctx, '回 长 廊', w / 2, h * 0.32, 10);
      ctx.fillStyle = cssColor(hall.accent, 0.7);
      ctx.font = `300 ${h * 0.2}px ${FONT_EN}`;
      drawSpaced(ctx, 'BACK TO THE GALLERIA', w / 2, h * 0.74, 4);
    },
  });
  backPlaque.position.set(0, 5.2, 5.9);
  backPlaque.rotation.y = Math.PI;
  root.add(backPlaque);

  // ----- 灯光与尘埃 -----
  scene.add(new THREE.HemisphereLight(
    new THREE.Color(hall.lightColor).multiplyScalar(0.5),
    new THREE.Color(hall.floor),
    1.1,
  ));
  const amb = new THREE.AmbientLight(0xffffff, 0.18);
  scene.add(amb);

  const dust = makeDust({
    count: 600, box: [WALL_X * 2, HEIGHT - 1, totalLen],
    center: [0, HEIGHT / 2, zMid], opacity: 0.32,
  });
  root.add(dust);

  // ----- 行为 -----
  const bounds = (p) => {
    p.x = Math.max(-WALL_X + 1.0, Math.min(WALL_X - 1.0, p.x));
    p.z = Math.max(zEnd + 1.4, Math.min(4.8, p.z));
  };

  function update(dt, t) {
    dust.userData.update(dt, t);
    back.userData.hover = lerp(back.userData.hover, back.userData.hoverTarget, Math.min(1, dt * 5));
    back.userData.membrane.uniforms.uTime.value = t;
    back.userData.membrane.uniforms.uHover.value = back.userData.hover;
    for (const e of works) {
      e.hover = lerp(e.hover, e.hoverTarget, Math.min(1, dt * 6));
      e.glow.material.opacity = e.hover * 0.32;
      const s = 1 + e.hover * 0.012;
      e.group.scale.setScalar(s);
    }
  }

  return {
    scene,
    targets,
    works,
    update,
    bounds,
    hall,
    entry: { pos: new THREE.Vector3(0, 1.7, 3.6), yaw: 0, pitch: 0 },
  };
}
