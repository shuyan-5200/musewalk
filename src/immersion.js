// ============================================================
//  画境：走入画中 —— 画作溶解为五万颗漂浮粒子的缥缈宇宙
// ============================================================
import * as THREE from 'three';
import { makeDust } from './fx.js';
import { textPlane, drawSpaced, FONT_CN, FONT_EN, imageAverageColor, clamp, lerp, disposeObject } from './utils.js';

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class Immersion {
  constructor(rig, isTouch = false) {
    this.rig = rig;
    this.isTouch = isTouch;
    this.active = false;
    this.scene = null;
    this.points = null;
    this.mat = null;
    this.camZ = 34;
    this.speed = 0;
    this.drift = 0;
    this.holdT = 0;
    this.saved = null;
    this.opacity = 1;
    this.fadeTarget = 1;
    this.fadeRate = 2.4; // 淡入淡出速率（过场可临时调大以更快收尾）
  }

  /** 由画作纹理构建粒子云。
   *  入画直切：opts.matchDist+paintingW → 镜位按「画面视角大小」匹配；
   *  opts.relief（{img,sign,anchor,amp}）→ 粒子按同一深度图以浮雕形态起步，
   *  与立体画身同形同粒度，无幕直切后由原调校的溶解节奏接管（速度/尺寸未动）。 */
  enter(entry, opts = {}) {
    const img = entry.texture.image;
    const aspect = img.width / img.height;

    // 采样像素
    const targetCount = this.isTouch ? 22000 : 52000;
    const cols = Math.max(60, Math.round(Math.sqrt(targetCount * aspect)));
    const rows = Math.max(60, Math.round(cols / aspect));
    const cv = document.createElement('canvas');
    cv.width = cols; cv.height = rows;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cols, rows);
    const data = ctx.getImageData(0, 0, cols, rows).data;

    const planeW = aspect >= 1 ? 30 : 26 * aspect;
    const planeH = planeW / aspect;
    this.startZ = 34;
    if (opts.matchDist && opts.paintingW) {
      this.startZ = clamp((opts.matchDist * planeW) / opts.paintingW, 10, 30);
    } else if (opts.camZ != null) this.startZ = opts.camZ;
    this.progOffset = this.startZ === 34 ? 0 : 5;   // 直切时约 2 单位推进即开始溶解；经典弧原样

    const n = cols * rows;
    const aPos = new Float32Array(n * 3);
    const aCol = new Float32Array(n * 3);
    const aSeed = new Float32Array(n * 4);
    const aSize = new Float32Array(n);
    const c = new THREE.Color();

    let p = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = (j * cols + i) * 4;
        const r = data[k] / 255, g = data[k + 1] / 255, b = data[k + 2] / 255;
        aPos[p * 3] = (i / (cols - 1) - 0.5) * planeW;
        aPos[p * 3 + 1] = (0.5 - j / (rows - 1)) * planeH;
        aPos[p * 3 + 2] = 0;
        c.setRGB(r, g, b, THREE.SRGBColorSpace);
        aCol[p * 3] = c.r; aCol[p * 3 + 1] = c.g; aCol[p * 3 + 2] = c.b;
        aSeed[p * 4] = Math.random();
        aSeed[p * 4 + 1] = Math.random();
        aSeed[p * 4 + 2] = Math.random();
        aSeed[p * 4 + 3] = Math.random();
        const lum = 0.3 * r + 0.6 * g + 0.1 * b;
        aSize[p] = (0.65 + lum * 0.9) * (planeW / cols) * 2.1;
        p++;
      }
    }

    // 浮雕形态起步：把入画画身的深度分布烘进初始 z（flat0）
    if (opts.relief?.img && opts.relief.amp > 0.001) {
      const R = opts.relief;
      const dcv = document.createElement('canvas');
      dcv.width = cols; dcv.height = rows;
      const dctx = dcv.getContext('2d', { willReadFrequently: true });
      dctx.drawImage(R.img, 0, 0, cols, rows);
      const dd = dctx.getImageData(0, 0, cols, rows).data;
      const zAmp = R.amp * (planeW / (opts.paintingW || planeW));
      for (let q = 0; q < n; q++) {
        const dnear = 0.5 + (dd[q * 4] / 255 - 0.5) * R.sign;
        aPos[q * 3 + 2] = (dnear - R.anchor) * zAmp;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(aPos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(aCol, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 4));
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));

    const fovScale = window.innerHeight / (2 * Math.tan((58 * Math.PI) / 360));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uOpacity: { value: 1 },
        uScale: { value: fovScale },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute vec4 aSeed;
        attribute float aSize;
        uniform float uTime;
        uniform float uProgress;
        uniform float uScale;
        varying vec3 vColor;
        varying float vFade;
        void main() {
          vColor = aColor;
          vec3 flat0 = position;
          // 弥散目标：纵深 + 横向舒展
          vec3 disp = position;
          disp.z += aSeed.x * 26.0 - 19.0;
          disp.x *= 1.0 + aSeed.y * 0.85;
          disp.y *= 1.0 + aSeed.z * 0.85;
          float k = uProgress * (0.55 + 0.45 * aSeed.w); // 每颗粒子各有迟疑
          vec3 pos = mix(flat0, disp, k);
          // 漂浮起伏
          float t = uTime;
          float amp = 0.85 * uProgress;
          pos.x += sin(t * (0.32 + aSeed.x * 0.5) + aSeed.w * 6.283) * amp;
          pos.y += cos(t * (0.27 + aSeed.y * 0.4) + aSeed.w * 12.56) * amp * 0.8;
          pos.z += sin(t * (0.22 + aSeed.z * 0.4) + aSeed.w * 9.42) * amp * 1.2;
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          float ps = aSize * (1.0 + uProgress * 0.55) * uScale / max(0.6, -mv.z);
          gl_PointSize = clamp(ps, 1.0, 26.0);
          vFade = 1.0 - smoothstep(2.0, 26.0, -mv.z) * 0.35;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vFade;
        uniform float uOpacity;
        uniform float uProgress;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r2 = dot(d, d);
          if (r2 > 0.25) discard;
          float a = smoothstep(0.25, 0.05, r2);
          vec3 col = vColor * (1.0 + uProgress * 0.45);
          gl_FragColor = vec4(col, a * uOpacity * vFade);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });

    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;

    // 场景
    const bg = imageAverageColor(img).multiplyScalar(0.16);
    const scene = new THREE.Scene();
    scene.background = bg;
    scene.fog = new THREE.FogExp2(bg.clone(), 0.012);
    scene.add(this.points);

    // 周围的星屑（取画面强调色）
    const accent = imageAverageColor(img).multiplyScalar(1.6);
    const dust = makeDust({
      count: 900, box: [70, 50, 90], center: [0, 0, -6],
      color: accent.getHex(), opacity: 0.5, size: 0.07,
    });
    scene.add(dust);
    this.dust = dust;

    // 深处的幽灵题字
    const ghost = textPlane({
      width: 36, height: 12, ppm: 28,
      draw: (ctx2, w, h) => {
        const maxW = w * 0.9;
        // 自适应收字：长名（如艺术家全名）超宽时整体缩放字号与字距，避免被画布裁切「吞字」
        const fit = (text, px, sp, buildFont) => {
          ctx2.font = buildFont(px);
          const tw = [...text].reduce((a, ch) => a + ctx2.measureText(ch).width, 0)
            + sp * Math.max(0, text.length - 1);
          if (tw > maxW) { const k = maxW / tw; return { px: px * k, sp: sp * k }; }
          return { px, sp };
        };
        const f = fit(entry.work.title, h * 0.34, h * 0.1, (px) => `200 ${px}px ${FONT_CN}`);
        ctx2.fillStyle = 'rgba(238,231,217,0.16)';
        ctx2.font = `200 ${f.px}px ${FONT_CN}`;
        drawSpaced(ctx2, entry.work.title, w / 2, h * 0.42, f.sp);
        const g = fit(entry.work.original, h * 0.13, 4, (px) => `italic 300 ${px}px ${FONT_EN}`);
        ctx2.fillStyle = 'rgba(238,231,217,0.10)';
        ctx2.font = `italic 300 ${g.px}px ${FONT_EN}`;
        drawSpaced(ctx2, entry.work.original, w / 2, h * 0.74, g.sp);
      },
      depthTest: false,
    });
    ghost.position.set(0, 2, -42);
    scene.add(ghost);
    this.ghost = ghost;

    this.scene = scene;
    this.camZ = this.startZ;
    this.speed = 0;
    this.drift = 0;
    this.holdT = 0;
    this.opacity = 1;
    this.fadeTarget = 1;
    this.fadeRate = 2.4;
    this.active = true;

    // 相机交由画境驱动
    this.saved = this.rig.getPose();
    this.rig.beginDriven();

    return scene;
  }

  /** 渐隐并归还相机，返回 Promise（淡出完成） */
  exit() {
    this.fadeTarget = 0;
    return new Promise((res) => { this._onFaded = res; });
  }

  dispose() {
    if (this.scene) {
      disposeObject(this.scene);
      this.scene = null;
    }
    if (this.saved) {
      this.rig.setPose(this.saved);
      this.saved = null;
    }
    this.points = null;
    this.mat = null;
    this.active = false;
  }

  onResize() {
    if (this.mat) {
      this.mat.uniforms.uScale.value = window.innerHeight / (2 * Math.tan((58 * Math.PI) / 360));
    }
  }

  update(dt, t) {
    if (!this.active || !this.scene) return;

    // 速度曲线：趋近 → 穿越 → 悬停漂浮
    const targetSpeed = this.camZ > 12 ? 5.4 : this.camZ > -4 ? 2.4 : this.camZ > -11 ? 1.1 : 0;
    this.speed = lerp(this.speed, targetSpeed, Math.min(1, dt * 0.9));
    this.camZ -= this.speed * dt;

    // 弥散进度（随趋近溶解：z=27 时画面完整，z=8 时全部弥散）
    const prog = smooth(7, 26, (this.startZ - this.camZ) + (this.progOffset || 0));
    this.mat.uniforms.uProgress.value = prog;
    this.mat.uniforms.uTime.value = t;

    // 漂浮系数
    this.drift = lerp(this.drift, prog, Math.min(1, dt * 0.8));
    if (this.speed < 0.2 && this.camZ < -10) this.holdT += dt;

    const cam = this.rig.camera;
    const sway = this.drift;
    cam.position.set(
      Math.sin(t * 0.12) * 1.6 * sway,
      Math.cos(t * 0.095) * 1.1 * sway,
      this.camZ + Math.sin(this.holdT * 0.16) * 2.2 * Math.min(1, this.holdT * 0.05),
    );

    // 粒子云整体极缓旋转
    this.points.rotation.y = Math.sin(t * 0.03) * 0.12 * this.drift;
    this.ghost.position.y = 2 + Math.sin(t * 0.2) * 0.8;
    this.dust.userData.update(dt, t);

    // 淡出
    this.opacity = lerp(this.opacity, this.fadeTarget, Math.min(1, dt * (this.fadeRate || 2.4)));
    this.mat.uniforms.uOpacity.value = this.opacity;
    if (this.fadeTarget === 0 && this.opacity < 0.02 && this._onFaded) {
      const cb = this._onFaded;
      this._onFaded = null;
      cb();
    }
  }
}
