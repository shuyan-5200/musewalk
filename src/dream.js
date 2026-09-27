// ============================================================
//  入画：步入立体画境 —— 画作撑开成一方可漫步的梦境空间。
//  设计原则：
//  「画面必须完整可读」—— 明度不是深度，人物类画作经不起大置换。
//  浮雕只做**大尺度的轻起伏**（重模糊深度 + 边缘锁平 + 小振幅），
//  画像一幅在风里轻轻起伏的绢；立体感交给：环绕视差 + 画缘环抱
//  + 漂浮雾幕（不带画面内容，纯氛围）+ 取色穹顶 / 静水 / 光尘。
//  「化作星尘」唯一触发是画外 UI 按钮（ui.dream 的 .dream-star）；
//  场内无可点目标（光核彩蛋已移除：太刺眼，也不该是功能入口）。
//
//  相机采用**以画心为轴的环绕模式**（cameraRig
//  的 orbit 模式）——拖拽 = 绕画心稳定旋转（可绕到画背面）、
//  滚轮/双指 = 推近拉远。画永远保持在画面中心，无跳变、无游走；
//  不再有 WASD / 点地行走（代码更简、手感更稳）。
//
//  纯前端零依赖：深度由画面明度自动推得（重模糊 + 分位拉伸）；
//  work.depth 可选真实深度图增强（约定：亮 = 近，MiDaS 风格）；
//  work.splat 字段为将来 3DGS（高斯泼溅）资产预留，本模块不消费。
//
//  生产画身 = 笔触星屑（strokes）——正面完整可读、不透明零奶雾、一次 draw call、
//  与「化作星尘」同一粒子语言。历史候选方案只保留在专项文档，不进入生产包。
//  「原作 / 立体」双模式
//  （toggleMode，细看缩放 ORBIT_MIN_*）与星尘无幕直切交接（getHandoff + setDim，
//  星尘按同一深度分布以浮雕形态接管）。
//  生产基线：进场默认 flat，用户主动切 solid；
//  全馆默认 uniform-auto，只有整馆 enhanced 才消费真深度。生产配置不支持逐画换方案。
// ============================================================
import * as THREE from 'three';
import { makeDust, makeBeam } from './fx.js';
import { HINTS } from './data.js';
import { softCircleTexture, disposeObject, clamp } from './utils.js';
import { buildStrokesBody } from './dreamBodies/strokes.js';

// —— 画境手感参数（集中可调）——
const WALL_H = 6.2;           // 浮雕主墙高度（米）
const WALL_LIFT = -0.4;       // 主墙下缘相对地面（负值=下缘轻浸入水面，画心贴近视线）
const MIST = [                // 漂浮雾幕（纯氛围，无画面内容）：z 距墙 / 相位
  { z: 2.1, phase: 0.0 },
  { z: 3.4, phase: 2.6 },
];
// —— 环绕相机（以画心为轴）——
const ORBIT_TARGET_Z = 0.5;   // 轴心（画心）的 z
const ORBIT_START = 7.8;      // 起始观赏距离（米）
const ORBIT_RANGE = 7.0;      // 可拉远量（maxDist = minDist + RANGE）
const ORBIT_MIN_ABS = 1.7;    // 细看下限（米）：可贴近端详笔触/细节
const ORBIT_MIN_FACTOR = 0.24;// 细看下限随画幅：min = max(ABS, W×系数) + 画身凸出量
const ORBIT_POLAR = [Math.PI / 2 - 0.55, Math.PI / 2 + 0.12]; // 俯仰限位（上多下少，不入地）
const FOG_BASE = 0.030;       // 雾密度（随环境潮汐 ±18%）
const TIDE_AMP = 0.10;        // 画身随环境潮汐的置换幅度

// 明度深度图：小尺寸采样 → 重盒式模糊两轮（半径 5）→ 分位对比拉伸。
// 重模糊是关键：只留大尺度明暗起伏，人物/笔触细节不参与置换。
function buildDepthTexture(img) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;
  let lum = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    lum[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  }
  const blur = (src, r) => {
    const tmp = new Float32Array(S * S);
    const out = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {         // 横向
      for (let x = 0; x < S; x++) {
        let s = 0, n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = x + k;
          if (xx >= 0 && xx < S) { s += src[y * S + xx]; n++; }
        }
        tmp[y * S + x] = s / n;
      }
    }
    for (let x = 0; x < S; x++) {         // 纵向
      for (let y = 0; y < S; y++) {
        let s = 0, n = 0;
        for (let k = -r; k <= r; k++) {
          const yy = y + k;
          if (yy >= 0 && yy < S) { s += tmp[yy * S + x]; n++; }
        }
        out[y * S + x] = s / n;
      }
    }
    return out;
  };
  lum = blur(blur(lum, 5), 5);
  const sorted = Float32Array.from(lum).sort();
  const lo = sorted[Math.floor(sorted.length * 0.05)];
  const hi = sorted[Math.floor(sorted.length * 0.95)];
  const span = Math.max(1e-4, hi - lo);
  const out = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = Math.round(clamp((lum[i] - lo) / span, 0, 1) * 255);
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// 画作调色：均色（雾 / 穹顶基调）+ 明亮强调色（光尘 / 光池）
function palette(img) {
  const S = 24;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;
  let r = 0, g = 0, b = 0, best = -1, bi = 0;
  for (let i = 0; i < S * S; i++) {
    const R = d[i * 4] / 255, G = d[i * 4 + 1] / 255, B = d[i * 4 + 2] / 255;
    r += R; g += G; b += B;
    const lum = 0.299 * R + 0.587 * G + 0.114 * B;
    const sat = Math.max(R, G, B) - Math.min(R, G, B);
    const score = lum * (0.25 + sat);
    if (score > best) { best = score; bi = i; }
  }
  const n = S * S;
  const avg = new THREE.Color(r / n, g / n, b / n);
  const accent = new THREE.Color(d[bi * 4] / 255, d[bi * 4 + 1] / 255, d[bi * 4 + 2] / 255);
  const hsl = {};
  accent.getHSL(hsl);
  accent.setHSL(hsl.h, Math.min(1, hsl.s * 1.15 + 0.08), clamp(hsl.l, 0.45, 0.62));
  return { avg, accent };
}

const FOG_GLSL = /* glsl */ `
  vec3 applyFog(vec3 col, vec3 fogCol, float fogD, float dist) {
    float f = 1.0 - exp(-fogD * fogD * dist * dist);
    return mix(col, fogCol, f * 0.9);
  }
`;

export class Dream {
  constructor(isTouch) {
    this.isTouch = isTouch;
    this.active = false;
    this.scene = null;
    this.poem = '';
    this.accentHex = 0xb7a98c;
    this.orbit = null;   // 环绕相机参数（enter 时按画幅计算，交给 rig.beginOrbit）
    this._body = null;   // 画身模块实例
    this._mode = 'flat'; // 默认先看完整原作，用户主动点击后才进入立体画境
    this._dim = 0;       // 氛围暗下 0..1（直切星尘前沉入夜色）
    this._W = 0;
  }

  /** 由画作纹理撑开立体画境，返回场景。opts.quickRise：星尘归来时画快速聚拢 */
  enter(entry, opts = {}) {
    const img = entry.texture.image;
    const aspect = img.width / img.height;
    const W = clamp(WALL_H * aspect, 4.6, 13.2);
    const H = WALL_H;
    const cy = H / 2 + WALL_LIFT;
    const { avg, accent } = palette(img);
    this.accentHex = accent.getHex();
    this._W = W;
    this._mode = opts.initialMode === 'solid' ? 'solid' : 'flat';
    this._dim = 0;

    const deep = avg.clone().multiplyScalar(0.10);
    const mid = avg.clone().multiplyScalar(0.32);
    const top = avg.clone().lerp(accent, 0.35).multiplyScalar(0.5);
    const fogCol = avg.clone().multiplyScalar(0.22);

    const scene = new THREE.Scene();
    scene.background = deep.clone();

    // —— 雾霭穹顶（画作调色的三段渐变）——
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(42, 32, 20),
      new THREE.ShaderMaterial({
        uniforms: {
          uBottom: { value: deep }, uMid: { value: mid }, uTop: { value: top },
          uDim: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying float vY;
          void main() {
            vY = normalize(position).y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uBottom; uniform vec3 uMid; uniform vec3 uTop;
          uniform float uDim;
          varying float vY;
          void main() {
            vec3 col = mix(uBottom, uMid, smoothstep(-0.25, 0.12, vY));
            col = mix(col, uTop, smoothstep(0.12, 0.75, vY));
            col *= 1.0 - uDim * 0.85;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    dome.renderOrder = -1;
    scene.add(dome);
    this._domeMat = dome.material;

    // —— 明度伪深度（兜底）：默认浮雕直接消费（work.depth 就绪后热替换）；
    //    风格画身把它当 autoDepthTex 兜底，真实深度图由模块自行加载 ——
    const depthTex = buildDepthTexture(img);
    this._depthTex = depthTex;

    // —— 画身（画作立体化本体）：生产统一 strokes；候选方案只保留文档记录 ——
    const body = buildStrokesBody({
      texture: entry.texture, img, W, H, cy,
      // 深度资产只能整馆开关，不允许单幅画悄悄切换一套浮雕强度。
      depthUrl: opts.depthPolicy === 'enhanced' ? (entry.work?.depth || '') : '',
      autoDepthTex: depthTex,
      avg, accent, fogCol,
      fogBase: FOG_BASE, tideAmp: TIDE_AMP,
      isTouch: this.isTouch,
      riseDelay: opts.quickRise ? 0.15 : undefined,   // 归来时不再长静置，画快速聚拢
    });
    body.group.position.set(0, cy, 0);
    scene.add(body.group);
    this._body = body;
    body.setMode?.(this._mode, true);

    // —— 漂浮雾幕（纯氛围景深，无画面内容；明度视差幕会让人物重影/糊脸）——
    const mist = this.isTouch ? MIST.slice(0, 1) : MIST;
    this._mistMats = mist.map((L, i) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uPhase: { value: L.phase }, uDim: { value: 0 },
          uCol: { value: fogCol.clone().multiplyScalar(1.6) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime, uPhase, uDim;
          uniform vec3 uCol;
          varying vec2 vUv;
          void main() {
            float n = sin(vUv.x * 7.0 + uTime * 0.05 + uPhase)
                    * sin(vUv.y * 5.0 - uTime * 0.04 + uPhase * 1.7);
            float fx = smoothstep(0.0, 0.22, vUv.x) * (1.0 - smoothstep(0.78, 1.0, vUv.x));
            float fy = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
            float a = (0.05 + 0.03 * n) * fx * fy * (1.0 - uDim);
            gl_FragColor = vec4(uCol, a);
          }
        `,
        transparent: true,
        depthWrite: false,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.25, 4.2), mat);
      m.position.set(0, 2.5, L.z);
      m.renderOrder = 2 + i;
      m.frustumCulled = false;
      scene.add(m);
      return mat;
    });

    // —— 静水地面（画色沉入深潭，远处溶进雾里）——
    const floorMat = new THREE.ShaderMaterial({
      uniforms: {
        uDeep: { value: deep.clone().multiplyScalar(0.7) },
        uFog: { value: fogCol }, uFogD: { value: FOG_BASE },
        uAccent: { value: accent }, uTime: { value: 0 }, uDim: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vDist;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uDeep, uFog, uAccent;
        uniform float uFogD, uTime, uDim;
        varying vec2 vUv;
        varying float vDist;
        ${FOG_GLSL}
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          vec3 col = mix(uDeep, uFog, smoothstep(0.3, 0.95, r));
          float streak = sin(vUv.x * 14.0 + uTime * 0.12) * sin(vUv.y * 11.0 - uTime * 0.09);
          col += uAccent * max(streak, 0.0) * 0.03 * (1.0 - r);
          col = applyFog(col, uFog, uFogD, vDist);
          col *= 1.0 - uDim * 0.8;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(17, 48), floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    this._floorMat = floorMat;

    // —— 光池（画作的光洒在水面上）——
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 0.85, 3.6),
      new THREE.MeshBasicMaterial({
        color: accent, map: softCircleTexture(), transparent: true, opacity: 0.14,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.02, 1.7);
    pool.renderOrder = 5;
    scene.add(pool);
    this._pool = pool;

    // —— 两道光柱（复用 fx，随环境潮汐明灭）——
    this._beams = [-1, 1].map((s) => {
      const beam = makeBeam({ rTop: 0.5, rBottom: 2.6, height: 9, color: this.accentHex, opacity: 0.09 });
      beam.position.set(s * W * 0.28, 5.2, 2.0);
      beam.rotation.z = s * 0.14;
      scene.add(beam);
      return beam;
    });

    // —— 画色浮尘 ——
    const dust = makeDust({
      count: this.isTouch ? 120 : 300,
      box: [Math.max(20, W * 1.8), 9, 13], center: [0, 3.4, 4.5],
      color: accent.clone().multiplyScalar(1.25).getHex(),
      opacity: 0.42, size: 0.055,
    });
    scene.add(dust);
    this._dust = dust;

    // —— 环绕相机 ——（光核彩蛋已移除：唯一触发是画外「化作星尘」按钮）
    // 细看缩放：允许贴近端详（原作/立体皆可）；贴近后侧绕会近距掠过笔触，
    // 属沉浸而非穿帮（画身不透明、俯仰有限位）。手感旋钮见顶部 ORBIT_MIN_*。
    const minDist = clamp(Math.max(ORBIT_MIN_ABS, W * ORBIT_MIN_FACTOR) + (this._body?.minDistAdd || 0), 1.4, 8.4);
    const maxDist = minDist + ORBIT_RANGE;
    const startDist = clamp(ORBIT_START, minDist + 0.4, maxDist - 0.6);
    this.orbit = {
      target: new THREE.Vector3(0, cy, ORBIT_TARGET_Z),
      pos: new THREE.Vector3(0, cy * 0.92, ORBIT_TARGET_Z + startDist),
      minDist,
      maxDist,
      minPolar: ORBIT_POLAR[0],
      maxPolar: ORBIT_POLAR[1],
    };

    // —— 诗句（work.poem 可配；未配则按画取一句默认治愈文案）——
    const id = entry.work?.id || entry.work?.title || '';
    const hash = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
    this.poem = entry.work?.poem || HINTS.dreamPoems[hash % HINTS.dreamPoems.length];

    this.scene = scene;
    this.active = true;
    return scene;
  }

  /** 「原作 / 立体」双模式：仅 strokes 画身支持 */
  get mode() { return this._mode; }
  get hasModes() { return !!this._body?.setMode; }
  toggleMode() {
    if (!this.hasModes) return this._mode;
    this._mode = this._mode === 'solid' ? 'flat' : 'solid';
    this._body.setMode(this._mode);
    return this._mode;
  }

  /** 星尘交接包：画幅 + 当前模式 + 深度分布（星尘以同形同粒度接管） */
  getHandoff() {
    return { W: this._W, mode: this._mode, depth: this._body?.getDepthInfo?.() || null };
  }

  /** 氛围暗下 0..1：直切星尘前，穹顶/雾/静水/光尘沉入夜色，与星尘暗底无缝相接 */
  setDim(k) { this._dim = clamp(k, 0, 1); }

  update(dt, t, tide = 0.5) {
    if (!this.active || !this.scene) return;
    const fogD = FOG_BASE * (1 + (tide - 0.5) * 0.36);

    const dim = this._dim;
    this._body?.update(dt, t, tide, fogD);
    this._mistMats.forEach((m) => { m.uniforms.uTime.value = t; m.uniforms.uDim.value = dim; });
    this._floorMat.uniforms.uTime.value = t;
    this._floorMat.uniforms.uFogD.value = fogD;
    this._floorMat.uniforms.uDim.value = dim;
    this._domeMat.uniforms.uDim.value = dim;
    this._dust.userData.update(dt, t);
    this._dust.material.uniforms.uOpacity.value = 0.42 * (1 - dim);

    // 光池与光柱随环境潮汐明灭（氛围暗下时一并沉入夜色）
    this._pool.material.opacity = (0.12 + tide * 0.07) * (1 - dim);
    this._beams.forEach((b) => { b.material.opacity = (0.07 + tide * 0.05) * (1 - dim); });
  }

  dispose() {
    this._body?.dispose?.();   // 画身模块先自清（幂等；scene 级 disposeObject 随后兜底）
    this._body = null;
    if (this.scene) {
      // 光柱贴图为模块级共享纹理：先手工卸下，避免 disposeObject 误杀
      this._beams?.forEach((b) => {
        this.scene.remove(b);
        b.geometry.dispose();
        b.material.dispose();
      });
      disposeObject(this.scene);
      this.scene = null;
    }
    this._depthTex?.dispose();
    this._depthTex = null;
    this._beams = null;
    this.active = false;
  }
}
