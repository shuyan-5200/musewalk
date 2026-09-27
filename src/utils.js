// ============================================================
//  通用工具：缓动 / 补间 / Canvas 文字纹理
// ============================================================
import * as THREE from 'three';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

// ---------- 补间管理 ----------
const tweens = new Set();

export function tween({ dur = 1, delay = 0, ease = easeInOutCubic, onUpdate, onComplete }) {
  const tw = { time: -delay, dur, ease, onUpdate, onComplete, alive: true };
  tweens.add(tw);
  return tw;
}

export function updateTweens(dt) {
  for (const tw of [...tweens]) {
    if (!tw.alive) { tweens.delete(tw); continue; }
    tw.time += dt;
    if (tw.time < 0) continue;
    const k = clamp(tw.time / tw.dur, 0, 1);
    tw.onUpdate?.(tw.ease(k), k);
    if (k >= 1) {
      tw.alive = false;
      tweens.delete(tw);
      tw.onComplete?.();
    }
  }
}

// ---------- 手动字距绘制（canvas letterSpacing 兼容性差） ----------
export function drawSpaced(ctx, text, cx, y, spacing = 0) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let x = cx - total / 2;
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, x + widths[i] / 2, y);
    x += widths[i] + spacing;
  });
}

// ---------- Canvas 文字纹理平面 ----------
// draw(ctx, w, h) 自由绘制；返回带透明纹理的 Mesh
export function textPlane({ width, height, ppm = 150, draw, depthTest = true }) {
  const w = Math.round(width * ppm);
  const h = Math.round(height * ppm);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  mesh.renderOrder = 2;
  return mesh;
}

export const FONT_CN = '"Noto Serif SC Variable", "Noto Serif SC", "Songti SC", serif';
export const FONT_EN = '"Cormorant Garamond Variable", "Cormorant Garamond", "Times New Roman", serif';

// 模块级共享纹理不归单个场景所有；驱逐一座展廊时不得把它们一并 dispose。
export function markSharedTexture(texture) {
  texture.userData.musewalkShared = true;
  return texture;
}

export const isSharedTexture = (texture) => !!texture?.userData?.musewalkShared;

// ---------- 柔光圆点贴图（粒子 / 光斑共用） ----------
let _softTex = null;
export function softCircleTexture() {
  if (_softTex) return _softTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _softTex = markSharedTexture(new THREE.CanvasTexture(c));
  return _softTex;
}

// ---------- 图像平均色（用于画境背景） ----------
export function imageAverageColor(img) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return new THREE.Color(r / n / 255, g / n / 255, b / n / 255);
}

// ---------- 资源释放 ----------
export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        for (const k in m) {
          if (m[k] && m[k].isTexture && !isSharedTexture(m[k])) m[k].dispose();
        }
        m.dispose();
      });
    }
  });
}
