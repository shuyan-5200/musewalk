// ============================================================
// 画身 · 笔触星屑（strokes）—— 全馆唯一生产画身。
// 历史候选方案已从生产包移除，避免逐画风格与性能成本漂移。
// 立意：梵高厚重的笔触化作数万枚悬浮的颜料小片，按真实深度站进
// 空间——正面看仍是那幅完整的画，环绕时看到「一幅由笔触构成的
// 体积」，与本站「化作星尘」的粒子语言一脉相承。
//
// 当前由 src/dream.js 直接调用；返回统一画身接口：
//   { group, update(dt,t,tide,fogD), dispose(), minDistAdd }
//
// 技术要点（一次 draw call）：
//  · InstancedBufferGeometry：base = PlaneGeometry(1,1)，实例属性
//    aUv（网格中心 uv）+ aSeed（vec4 随机种子）。
//  · 顶点着色器采样深度图定 z（统一为 1=近），视空间平移展开成
//    永远面向相机的公告牌；边缘锁平（同 _buildRelief 的 ef 思路）。
//  · 补丁 UV（正面无缝的关键）：片元采画 uv = aUv + 视平面偏移 /
//    画幅——相邻小片重叠区域采到同一世界位置的同一 texel，正面看
//    天衣无缝地重组成原画。
//  · 片元解析式超椭圆剪影 cutout（不透明 + depthWrite，z-buffer
//    天然处理数万片的排序，正反面环绕都正确）。
//  · 正面无洞的保障（验收红线，勿破坏此不等式）：
//    0.5 × SIZE_MUL × (1−SIZE_VAR) × 0.898 × (1−ANISO) ≥ 0.71（步长）
//    其中 0.898 = 剪影保留半径系数（mask = 1−r⁴ 在 MASK_CUT=0.35 处）。
//  · 深度按 §5 教训走：work.depth 真深度（亮=近，sign=+1）就绪后才
//    立起全厚；未配置/加载失败则停留浅浮雕（明度伪深度 sign=−1，
//    幅度 ×0.5），静默无报错，含 dispose-后-到达守卫。
// ============================================================
import * as THREE from 'three';
import { clamp, easeInOutSine } from '../utils.js';

// —— 可调旋钮（集中）——
const COUNT_PC = 42000;     // 目标实例数（PC）：gx≈√(N×宽高比)，卧室 ≈230×182
const COUNT_TOUCH = 15000;  // 目标实例数（触摸端降配）
const SIZE_MUL = 2.35;      // 小片尺寸 = 网格步长 × 此倍率（⚠️ 见头注的无洞不等式）
const SIZE_VAR = 0.20;      // per-seed 大小随机 ±20%
const THICK = 1.6;          // 画身厚度（米）：深度 0→1 摊开的 z 跨度
const Z_ANCHOR = 0.35;      // 自动伪深度的稳定锚点
const JITTER = 0.05;        // per-seed z 微抖（±米），错开重叠小片的前后
const EDGE = 0.05;          // 边缘锁平带宽（uv 比例）：画缘 5% 内 z 渐归 0，轮廓方正
const RISE_DELAY = 1.1;     // 入场立起前的静置（秒）——等白幕退去，让人看见「站立」
const RISE_DUR = 1.5;       // 入场「画碎成笔触、站立成空间」缓动时长（秒）
const FALLBACK_AMP = 0.5;   // 全馆默认的温和自动浮雕强度（× THICK）
const BOB_AMP = 0.012;      // 每片悬浮 bob 幅度（米，极微——几乎静止的悬浮）
const BOB_FREQ = 0.4;       // 悬浮 bob 频率
const ROT_RANGE = 0.9;      // per-seed 剪影旋转跨度（弧度，±0.45；更松的笔触感）
const ANISO = 0.16;         // per-seed 剪影各向异性上限（更似笔触而非圆点）
const MASK_CUT = 0.35;      // 剪影 cutout 阈值（mask = 1 − r⁴，discard 风格）
const EDGE_SHADE = 0.12;    // 剪影边缘软过渡压暗（乘色模拟非 alpha）
const SHIMMER = 0.03;       // 微光泽闪烁幅度（克制！）
const DEPTH_HINT = 0.12;    // 深度明暗暗示：近微亮 / 远微暗（±6%）
const MIN_DIST_ADD = 0.4;   // 画身全幅立起后的相机安全后退量
const MODE_EASE = 2.6;      // 「原作 ↔ 立体」切换缓动速率（1/秒）

// 与 dream.js 同款雾函数（模块自包含，不改共享代码）
const FOG_GLSL = /* glsl */ `
  vec3 applyFog(vec3 col, vec3 fogCol, float fogD, float dist) {
    float f = 1.0 - exp(-fogD * fogD * dist * dist);
    return mix(col, fogCol, f * 0.9);
  }
`;

// —— 真深度整形（治「景深不准」）——
// 深度模型对画作有系统性偏差（文献：MDE 倾向把平面媒介按平面处理），原始输出
// 常挤在中段 → 每幅画立体感忽强忽弱、锚面（停在画平面处的深度）漂移。三步整形：
// ① 重采样 ≤512 ② 2%–98% 分位拉伸铺满 0..1（同幅画内部对比最大化）
// ③ 锚点取**中位数**——一半笔触沉入墙后、一半向观者浮出，每幅画自平衡
//   （AdaMPI「按深度分布放层」思想的单层版）。
function shapeDepthTexture(img) {
  const scale = Math.min(1, 512 / Math.max(img.width, img.height));
  const w = Math.max(2, Math.round(img.width * scale));
  const h = Math.max(2, Math.round(img.height * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c2 = cv.getContext('2d', { willReadFrequently: true });
  c2.drawImage(img, 0, 0, w, h);
  const im = c2.getImageData(0, 0, w, h);
  const d = im.data;
  const n = w * h;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = d[i * 4];
  const sorted = Float32Array.from(g).sort();
  const lo = sorted[Math.floor(n * 0.02)];
  const hi = sorted[Math.floor(n * 0.98)];
  const span = Math.max(1, hi - lo);
  const anchor = clamp((sorted[Math.floor(n * 0.5)] - lo) / span, 0.22, 0.6);
  for (let i = 0; i < n; i++) {
    const v = Math.round(clamp((g[i] - lo) / span, 0, 1) * 255);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  c2.putImageData(im, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return { tex, anchor };
}

export function buildStrokesBody(ctx) {
  const { W, H } = ctx;
  const aspect = W / H;

  // —— 网格：按目标实例数与画幅比换算，格子近似正方 ——
  const target = ctx.isTouch ? COUNT_TOUCH : COUNT_PC;
  const gx = Math.max(24, Math.round(Math.sqrt(target * aspect)));
  const gy = Math.max(24, Math.round(gx / aspect));
  const count = gx * gy;
  const stepX = W / gx;
  const stepY = H / gy;

  // —— 实例属性：aUv = 格心 uv；aSeed = (z抖/各向异性, bob相位, 大小, 旋转/闪烁) ——
  const aUv = new Float32Array(count * 2);
  const aSeed = new Float32Array(count * 4);
  let p = 0;
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      aUv[p * 2] = (i + 0.5) / gx;
      aUv[p * 2 + 1] = (j + 0.5) / gy;
      aSeed[p * 4] = Math.random();
      aSeed[p * 4 + 1] = Math.random();
      aSeed[p * 4 + 2] = Math.random();
      aSeed[p * 4 + 3] = Math.random();
      p++;
    }
  }

  // —— 实例化几何：base 取 PlaneGeometry(1,1) 的 position/uv/index ——
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(base.getIndex().clone());
  geo.setAttribute('position', base.getAttribute('position').clone());
  geo.setAttribute('uv', base.getAttribute('uv').clone());
  base.dispose();
  geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(aUv, 2));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 4));
  geo.instanceCount = count;
  // frustumCulled=false 下不参与剔除；给个够大的包围球仅作兜底
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(W, H));

  const uniforms = {
    uMap: { value: ctx.texture },
    uDepth: { value: ctx.autoDepthTex },   // 全馆默认：明度伪深度（暗=近 → sign=−1）
    uDepthSign: { value: -1 },
    uDepthAmp: { value: FALLBACK_AMP },    // 实验策略启用真深度后才切到 1
    uMix: { value: 0 },                    // 入场：0 平面镶嵌 → 1 站立成空间
    uAnchor: { value: Z_ANCHOR },
    uTide: { value: 0.5 },
    uTideAmp: { value: ctx.tideAmp },
    uTime: { value: 0 },
    uFog: { value: ctx.fogCol },
    uFogD: { value: ctx.fogBase },
    uQuad: { value: new THREE.Vector2(stepX * SIZE_MUL, stepY * SIZE_MUL) },
    uPaint: { value: new THREE.Vector2(W, H) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec2 aUv;
      attribute vec4 aSeed;
      uniform sampler2D uDepth;
      uniform float uDepthSign, uDepthAmp, uMix, uTide, uTideAmp, uTime;
      uniform float uAnchor;
      uniform vec2 uQuad, uPaint;
      varying vec2 vUv;
      varying vec2 vLocal;
      varying float vDist, vShade, vSeedW;
      void main() {
        // —— 深度采样定 z（统一为 1 = 近）——
        float d = 0.5 + (texture2D(uDepth, aUv).r - 0.5) * uDepthSign;
        // 边缘锁平：画缘内 z 渐归 0，轮廓保持方正（同 _buildRelief 的 ef）
        float ef = smoothstep(0.0, ${EDGE.toFixed(4)}, aUv.x)
                 * (1.0 - smoothstep(${(1 - EDGE).toFixed(4)}, 1.0, aUv.x))
                 * smoothstep(0.0, ${EDGE.toFixed(4)}, aUv.y)
                 * (1.0 - smoothstep(${(1 - EDGE).toFixed(4)}, 1.0, aUv.y));
        // 环境潮汐同频：厚度轻微涨落
        float amp = 1.0 + (uTide - 0.5) * uTideAmp;
        float z = ((d - uAnchor) * ${THICK.toFixed(4)} * uDepthAmp * amp
                + (aSeed.x - 0.5) * ${(JITTER * 2).toFixed(4)}) * ef * uMix;
        // 锚点（画面内世界位置）+ 极微悬浮 bob（几乎静止）
        vec3 anchor = vec3((aUv - 0.5) * uPaint, z);
        anchor.y += sin(uTime * ${BOB_FREQ.toFixed(4)} + aSeed.y * 6.2832)
                  * ${BOB_AMP.toFixed(4)} * uMix;
        // per-seed 大小 / 各向异性 / 轻旋转（剪影用圆 mask，形状全靠此仿射）
        float sizeVar = 1.0 + (aSeed.z - 0.5) * ${(SIZE_VAR * 2).toFixed(4)};
        float aniso = fract(aSeed.x * 13.7) * ${ANISO.toFixed(4)};
        float ang = (aSeed.w - 0.5) * ${ROT_RANGE.toFixed(4)};
        float ca = cos(ang), sa = sin(ang);
        vec2 lo = position.xy * vec2(1.0 + aniso, 1.0 - aniso);
        vec2 off = vec2(lo.x * ca - lo.y * sa, lo.x * sa + lo.y * ca) * uQuad * sizeVar;
        // 补丁 UV：重叠区域采同一世界位置的同一 texel → 正面无缝重组原画
        vUv = aUv + off / uPaint;
        vLocal = position.xy * 2.0;
        vShade = d - 0.5;
        vSeedW = aSeed.w;
        // 公告牌：锚点入视空间后在视平面内展开，小片始终面向相机
        vec4 mv = modelViewMatrix * vec4(anchor, 1.0);
        mv.xy += off;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uFog;
      uniform float uFogD, uTime;
      varying vec2 vUv;
      varying vec2 vLocal;
      varying float vDist, vShade, vSeedW;
      ${FOG_GLSL}
      void main() {
        // 笔触剪影：解析式超椭圆（1−r⁴ 顶部平、边缘速落，颜料厚点感），
        // cutout 风格 discard —— 不透明 + depthWrite，排序交给 z-buffer
        float r2 = dot(vLocal, vLocal);
        float m = 1.0 - r2 * r2;
        if (m < ${MASK_CUT.toFixed(4)}) discard;
        vec3 col = texture2D(uMap, vUv).rgb;
        col *= 1.0 + vShade * ${DEPTH_HINT.toFixed(4)};        // 近微亮 / 远微暗
        col *= 1.0 + sin(uTime * 0.5 + vSeedW * 6.2832) * ${SHIMMER.toFixed(4)};
        // 剪影边缘 1~2px 软过渡（乘到颜色上模拟，避免真 alpha 混合的排序难题）
        col *= 1.0 - ${EDGE_SHADE.toFixed(4)}
                   * (1.0 - smoothstep(${MASK_CUT.toFixed(4)}, ${(MASK_CUT + 0.25).toFixed(4)}, m));
        col = min(col, vec3(1.0));                             // 输出 ≤1，不吃 bloom
        col = applyFog(col, uFog, uFogD, vDist);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh);   // 站位 = 画心原点、面朝 +z（dream 会把 group 摆到 (0, cy, 0)）

  // —— 入场编排与真深度异步加载 ——
  // armed 后 riseT 从 −RISE_DELAY 起走：静置片刻（白幕退去）再缓缓站立。
  let disposed = false;
  let realDepth = null;
  let armed = false;
  let riseT = -(ctx.riseDelay ?? RISE_DELAY);   // 星尘归来时可传短 riseDelay：画快速聚拢
  let modeMix = 0;                              // 默认原作；用户主动点击后才立起
  let modeTarget = 0;
  const arm = () => { armed = true; };

  if (ctx.depthUrl) {
    new THREE.TextureLoader().load(
      ctx.depthUrl,
      (tex) => {
        // dispose-后-到达守卫：画境已拆则只清纹理，什么都不做
        if (disposed) { tex.dispose(); return; }
        const shaped = shapeDepthTexture(tex.image);   // 分位拉伸 + 中位锚点（治「景深不准」）
        tex.dispose();
        realDepth = shaped.tex;
        uniforms.uDepth.value = realDepth;   // 换真深度（亮=近）——此刻 uMix 仍为 0，无缝
        uniforms.uDepthSign.value = 1;
        uniforms.uDepthAmp.value = 1;
        uniforms.uAnchor.value = shaped.anchor;
        arm();
      },
      undefined,
      () => { if (!disposed) arm(); },   // 加载失败：静默停留浅浮雕形态
    );
  } else {
    arm();   // 未配置深度图：直接以兜底伪深度 ×0.5 幅度立起
  }

  return {
    group,
    minDistAdd: MIN_DIST_ADD,
    /** 「原作 / 立体」切换：flat = 笔触无缝落回原作平面，solid = 立起成体 */
    setMode(m, immediate = false) {
      modeTarget = m === 'flat' ? 0 : 1;
      if (immediate) modeMix = modeTarget;
    },
    /** 星尘交接：按同一深度分布以浮雕形态起步，粒度对齐、无缝直切 */
    getDepthInfo() {
      return {
        img: realDepth ? realDepth.image : ctx.autoDepthTex.image,
        sign: uniforms.uDepthSign.value,
        anchor: uniforms.uAnchor.value,
        amp: THICK * uniforms.uDepthAmp.value * uniforms.uMix.value,   // 平面模式下自然为 0
      };
    },
    update(dt, t, tide, fogD) {
      uniforms.uTime.value = t;
      uniforms.uTide.value = tide;
      uniforms.uFogD.value = fogD;
      if (armed && riseT < RISE_DUR) riseT += dt;
      const riseK = armed ? easeInOutSine(clamp(riseT / RISE_DUR, 0, 1)) : 0;
      modeMix += (modeTarget - modeMix) * Math.min(1, dt * MODE_EASE);
      uniforms.uMix.value = riseK * modeMix;
    },
    dispose() {
      // 只释放自建资源；ctx.texture / ctx.autoDepthTex 归 dream 管，绝不动
      disposed = true;
      geo.dispose();
      mat.dispose();
      realDepth?.dispose();
      realDepth = null;
    },
  };
}
