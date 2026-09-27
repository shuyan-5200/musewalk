// ============================================================
//  视觉效果：辉光合成器 / 漂浮尘埃 / 门扉光膜 / 光锥
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { markSharedTexture, softCircleTexture } from './utils.js';

// ---------- 后期合成（Bloom 辉光） ----------
export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.4,  // strength — 实际值由 main 按场景动态调节（大厅低/展馆中/画境高）
    0.85, // radius
    1.05, // threshold — 避免画作里的普通白色区域被误判成辉光
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return { composer, renderPass, bloom };
}

// ---------- 漂浮尘埃（着色器驱动，零 CPU 开销） ----------
export function makeDust({
  count = 420,
  box = [20, 8, 20],
  center = [0, 4, 0],
  color = 0xfff2d8,
  opacity = 0.5,
  size = 0.035, // 世界尺寸（米）
}) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const sz = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = center[0] + (Math.random() - 0.5) * box[0];
    pos[i * 3 + 1] = center[1] + (Math.random() - 0.5) * box[1];
    pos[i * 3 + 2] = center[2] + (Math.random() - 0.5) * box[2];
    seed[i] = Math.random() * 100;
    sz[i] = size * (0.35 + Math.random());
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uMap: { value: softCircleTexture() },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aSize;
      uniform float uTime;
      varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime;
        p.x += sin(t * 0.11 + aSeed * 17.0) * 0.9;
        p.y += sin(t * 0.07 + aSeed * 23.0) * 0.6;
        p.z += cos(t * 0.09 + aSeed * 29.0) * 0.9;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(aSize * 760.0 / max(0.8, -mv.z), 1.0, 9.0);
        vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(t * 0.5 + aSeed * 41.0));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform sampler2D uMap;
      uniform float uOpacity;
      varying float vA;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vA * uOpacity;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.userData.update = (dt, t) => { mat.uniforms.uTime.value = t; };
  return points;
}

// ---------- 门扉光膜（大厅拱门 / 展馆回门共用） ----------
export function makeMembrane(width, height, color) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uHover: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uHover;
      void main() {
        vec2 uv = vUv;
        float t = uTime * 0.3;
        float w1 = sin(uv.y * 9.0 - t * 3.1 + sin(uv.x * 7.0 + t * 2.0)) * 0.5 + 0.5;
        float w2 = sin(uv.x * 12.0 + t * 2.3 + sin(uv.y * 5.0 - t * 1.6)) * 0.5 + 0.5;
        float glow = mix(w1, w2, 0.5);
        float ex = smoothstep(0.0, 0.18, uv.x) * (1.0 - smoothstep(0.82, 1.0, uv.x));
        float ey = smoothstep(0.0, 0.10, uv.y) * (1.0 - smoothstep(0.86, 1.0, uv.y));
        float a = (0.07 + glow * 0.11 + uHover * 0.24) * ex * ey;
        vec3 col = uColor * (0.55 + glow * 0.4 + uHover * 0.65);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  mesh.userData.membrane = mat;
  return mesh;
}

// ---------- 馆门选中辉光（大厅悬停馆门：整扇门轻微发光，克制） ----------
// 三层叠加：门洞光膜（光自门内漫出）+ 门洞描边（精致选中边）+ 柔光外晕（整扇门发光）。
// 静止全暗，仅由 hover(0→1) 渐亮；返回 { group, update(t, hover) }。
// 调用方把 group 摆在门面（局部 +z 朝大厅），并按 picker.hoverTarget 缓动后喂入 update。
export function makeDoorGlow(width, height, color) {
  const accent = new THREE.Color(color);
  const g = new THREE.Group();

  // 柔光外晕：罩住整扇门的径向柔光，是「整扇门发光」的主体（在门面之前，轻拂石套）
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.55, height * 1.4),
    new THREE.MeshBasicMaterial({
      color: accent, map: softCircleTexture(), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  halo.position.z = 1.05;
  g.add(halo);

  // 门洞光膜：填充门洞、缓慢竖向流动的薄光（在门套之后，自门内漫出）
  const veilMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: accent }, uHover: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; uniform float uTime; uniform vec3 uColor; uniform float uHover;
      void main() {
        float ex = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.82, 1.0, vUv.x));
        float ey = smoothstep(0.0, 0.05, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
        float vbias = mix(1.0, 0.66, smoothstep(0.25, 1.0, vUv.y)); // 下部更实，向上渐淡
        float shimmer = 0.88 + 0.12 * sin(vUv.y * 4.0 - uTime * 0.7 + sin(vUv.x * 3.0));
        float a = uHover * 0.13 * ex * ey * vbias * shimmer;
        gl_FragColor = vec4(uColor * (0.7 + 0.6 * uHover), a);
      }
    `,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  // 门洞光膜在门套之后（z 偏内），似光自门内漫出；被门套石材正常遮挡，只在洞口透出
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(width, height), veilMat);
  veil.position.z = 0.5;
  g.add(veil);

  // 门洞描边：沿门洞勾一道细光线作精致选中边，置于门套之前（z 偏外）以免被门垛遮住
  const outlineMat = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0 });
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(width * 0.97, height * 0.99)), outlineMat,
  );
  outline.position.z = 1.0;
  g.add(outline);

  return {
    group: g,
    update: (t, hover) => {
      veilMat.uniforms.uTime.value = t;
      veilMat.uniforms.uHover.value = hover;
      outlineMat.opacity = hover * 0.55;
      halo.material.opacity = hover * 0.16;
    },
  };
}

// ---------- 柔光纵向光锥（顶光氛围） ----------
let _beamTex = null;
function beamTexture() {
  if (_beamTex) return _beamTex;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  _beamTex = markSharedTexture(new THREE.CanvasTexture(c));
  return _beamTex;
}

export function makeBeam({ rTop = 0.35, rBottom = 1.6, height = 6, color = 0xfff2d8, opacity = 0.16 }) {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, height, 24, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    map: beamTexture(),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return mesh;
}

// ---------- 画屏：似真似幻的代表作（镜面感 + 雾化边缘 + 选中辉光） ----------
// 返回 { group, screen }；screen.userData.update(dt,t) 自驱动画，
// screen.userData.hoverTarget(0/1) 控制选中态。group 由调用方摆位。
export function makeMistyImage(texture, accentHex, w, h, { dim = 1, haloDiameter = 0 } = {}) {
  const accent = new THREE.Color(accentHex);
  const group = new THREE.Group();
  const floatG = new THREE.Group(); // 仅用于悬浮微动，避免与调用方摆位冲突
  group.add(floatG);

  // 背后柔光晕（径向柔化，加性，营造梦幻悬浮）。
  // 默认按画屏比例铺成椭圆；传入 haloDiameter > 0 则改为正圆（径向柔光纹理贴在等边平面上）。
  // 环形展厅（圆形厅）必须用正圆且尺寸克制：宽画屏的宽椭圆光晕边缘会戳穿弧形环墙、被环墙
  // 截掉一截（"切边"），且各屏椭圆胖瘦不一显得参差；正圆 + 限径后大小一致、贴墙不溢出。
  const halW = haloDiameter > 0 ? haloDiameter : w * 2.0;
  const halH = haloDiameter > 0 ? haloDiameter : h * 1.85;
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(halW, halH),
    new THREE.MeshBasicMaterial({
      color: accent, map: softCircleTexture(), transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  halo.position.z = -0.08;
  floatG.add(halo);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uAccent: { value: accent },
      uTime: { value: 0 },
      uHover: { value: 0 },
      uDim: { value: dim },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform vec3 uAccent; uniform float uTime; uniform float uHover; uniform float uDim;
      varying vec2 vUv;
      void main() {
        // 代表作作为暗背景：填满画屏，仅边缘轻羽化
        vec3 col = texture2D(uMap, vUv).rgb * mix(uDim, 1.0, uHover * 0.6);
        float fx = smoothstep(0.0, 0.06, vUv.x) * (1.0 - smoothstep(0.94, 1.0, vUv.x));
        float fy = smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.94, 1.0, vUv.y));
        float edge = fx * fy;
        // 边缘流动薄雾（似镜面水光）
        float mist = 0.5 + 0.5 * sin(vUv.y * 6.0 - uTime * 0.5 + sin(vUv.x * 4.0 + uTime * 0.35));
        float rim = 1.0 - edge;
        col += uAccent * rim * (0.1 + mist * 0.1);
        gl_FragColor = vec4(col, edge);
      }
    `,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  floatG.add(screen);

  // 选中态优雅边线（细长方框，悬停渐亮）
  const outlineMat = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0 });
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(w * 1.04, h * 1.05)), outlineMat,
  );
  outline.position.z = 0.02;
  floatG.add(outline);

  let hover = 0;
  const phase = (w + h) % 6.283; // 各屏错相，避免同步起伏
  screen.userData.hoverTarget = 0;
  screen.userData.update = (dt, t) => {
    hover += ((screen.userData.hoverTarget || 0) - hover) * Math.min(1, dt * 6);
    mat.uniforms.uTime.value = t;
    mat.uniforms.uHover.value = hover;
    halo.material.opacity = 0.34 + hover * 0.4;
    outlineMat.opacity = hover * 0.85;
    floatG.position.y = Math.sin(t * 0.55 + phase) * 0.035;
  };
  return { group, screen };
}

// ---------- 地面落点涟漪 ----------
export function makeRipple(color = 0xb7a98c) {
  const geo = new THREE.RingGeometry(0.96, 1.0, 48);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
