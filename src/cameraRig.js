// ============================================================
//  相机系统：基于 camera-controls（yomotsu，MIT）的第一人称漫步
//  —— 拖拽环顾 / 方向键·WASD 漫步 / 点击前往全部走库内 SmoothDamp
//  （临界阻尼弹簧，Unity 同源算法），手感统一且丝滑。
//  模式：walk（漫步）/ locked（聚焦运镜托管）/ driven（画境托管）
// ============================================================
import * as THREE from 'three';
import CameraControls from 'camera-controls';

CameraControls.install({ THREE });

const EYE = 1.7;
// 手感参数（集中可调）
const WALK_SPEED = 3.0;       // 步行 m/s
const RUN_SPEED = 5.6;        // Shift 快走
const TURN_SPEED = 0.65;      // 方向键左/右转身角速度 rad/s（约 37°/s，舒缓不晕，松手即缓停）
const ROTATE_SPEED = -0.26;   // 拖拽环顾速度（负值 = 第一人称方向）
const PITCH_RANGE = 0.8;      // 俯仰半幅
const SMOOTH_MOVE = 0.3;      // 行走/滑行的 SmoothDamp 时间
const SMOOTH_DRAG = 0.13;     // 拖拽环顾的 SmoothDamp 时间
const SMOOTH_CINEMA = 0.8;    // 聚焦运镜的 SmoothDamp 时间
const FP_R = 1e-4;            // 第一人称相机半径（须 = 下方 min/maxDistance）：
                             // 瞬移/越界贴回的「眼后回退量」必须用它，绝不能用 1.0——
                             // 否则半径被瞬置为 1，相机随后从 1m 处 dolly 回拉 = 整页猛晃

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.mode = 'walk';
    this.pos = new THREE.Vector3(0, EYE, 8); // 第一人称锚点（= 注视目标）
    this.bounds = null;
    this.keys = Object.create(null);

    const c = new CameraControls(camera, dom);
    this.controls = c;
    c.minDistance = c.maxDistance = 1e-4;       // 第一人称：相机贴在目标点上
    c.azimuthRotateSpeed = ROTATE_SPEED;
    c.polarRotateSpeed = ROTATE_SPEED;
    c.minPolarAngle = Math.PI / 2 - PITCH_RANGE;
    c.maxPolarAngle = Math.PI / 2 + PITCH_RANGE;
    c.smoothTime = SMOOTH_MOVE;
    c.draggingSmoothTime = SMOOTH_DRAG;
    c.mouseButtons.wheel = CameraControls.ACTION.NONE;
    c.mouseButtons.middle = CameraControls.ACTION.NONE;
    c.mouseButtons.right = CameraControls.ACTION.NONE;
    c.touches.two = CameraControls.ACTION.NONE;
    c.touches.three = CameraControls.ACTION.NONE;

    window.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = Object.create(null); });

    // 画境（driven）模式下的拖拽环顾：相机被画境驱动，旋转由这里托管
    this.yaw = 0; this.pitch = 0; this.tYaw = 0; this.tPitch = 0;
    this._drag = null;
    dom.addEventListener('pointerdown', (e) => {
      if (this.mode === 'driven' && e.button === 0) {
        this._drag = { x: e.clientX, y: e.clientY, yaw: this.tYaw, pitch: this.tPitch };
      }
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this._drag) return;
      // 画境拖拽 = 抓住画面拖动（与直觉一致）：右拖画面右移、下拖画面下移
      this.tYaw = this._drag.yaw + (e.clientX - this._drag.x) * 0.0026;
      this.tPitch = THREE.MathUtils.clamp(
        this._drag.pitch + (e.clientY - this._drag.y) * 0.0021, -0.85, 0.85,
      );
    });
    const endDrag = () => { this._drag = null; };
    dom.addEventListener('pointerup', endDrag);
    dom.addEventListener('pointercancel', endDrag);

    this._saved = null;
    this._swayBase = null;
    this._tmpF = new THREE.Vector3();
    this._tmpC = new THREE.Vector3();
  }

  _forwardOf(yaw, pitch) {
    return this._tmpF.set(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );
  }

  /** 当前位姿（pos 为注视目标点 ≈ 眼位） */
  getPose() {
    return {
      pos: this.controls.getTarget(new THREE.Vector3(), false),
      yaw: this.controls.azimuthAngle,
      pitch: this.controls.polarAngle - Math.PI / 2,
      radius: this.controls.distance,
    };
  }

  /** 原样恢复一份位姿：品读态需保留临时 1m 构图半径，漫游态则是 FP_R。 */
  setPose(p) {
    const radius = Number.isFinite(p.radius) ? Math.max(1e-6, p.radius) : FP_R;
    const f = this._forwardOf(p.yaw, p.pitch);
    this.controls.setLookAt(
      p.pos.x - f.x * radius, p.pos.y - f.y * radius, p.pos.z - f.z * radius,
      p.pos.x, p.pos.y, p.pos.z, false,
    );
    this.pos.copy(p.pos);
    this._swayBase = null;
  }

  /** 直接瞬移（场景切换用） */
  teleport(pos, yaw = 0, pitch = 0) {
    const f = this._forwardOf(yaw, pitch);
    this.controls.setLookAt(
      pos.x - f.x * FP_R, pos.y - f.y * FP_R, pos.z - f.z * FP_R,
      pos.x, pos.y, pos.z, false,
    );
    this.pos.copy(pos);
    this._swayBase = null;
  }

  /** 平滑滑行至目标点（点击移动 / 开场） */
  glideTo(target) {
    return this.controls.moveTo(target.x, EYE, target.z, true);
  }

  /** 平滑滑行至目标位姿（开场仪式镜头 / 进出馆门）。
   *  smoothTime 越大越缓；进出馆门用较大值放慢穿越，结束恢复常速。 */
  glideToPose(target, yaw = 0, pitch = 0, settleMs = 3000, smoothTime = SMOOTH_MOVE) {
    this.controls.smoothTime = smoothTime;
    const f = this._forwardOf(yaw, pitch);
    const motion = this.controls.setLookAt(
      // 漫游始终是第一人称极小半径。若这里留 1m，虽然 target/碰撞到位，
      // 实际镜头会落后 1m；旧版再用 teleport 拉回 FP_R 才造成整页跳动。
      target.x - f.x * FP_R, target.y - f.y * FP_R, target.z - f.z * FP_R,
      target.x, target.y, target.z,
      true,
    );
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.controls.smoothTime = SMOOTH_MOVE;
        resolve();
      };
      motion.then(finish, finish);
      // 保留超时只是防 Promise 异常不落地，绝不再强制 teleport。
      // 旧版低帧率时会在第 3 秒把尚未走完的镜头拽到终点，造成第二次整页跳动。
      window.setTimeout(finish, Math.max(settleMs, 8000));
    });
  }

  /** 落地页的悠然环视 */
  sway(t) {
    if (this._swayBase == null) this._swayBase = this.controls.azimuthAngle;
    this.controls.rotateAzimuthTo(this._swayBase + Math.sin(t * 0.05) * 0.12, true);
  }

  /** 聚焦运镜（锁定交互），返回 Promise */
  focusTo(targetPos, yaw, pitch) {
    if (this.mode !== 'locked') this._saved = this.getPose();
    this.mode = 'locked';
    this.controls.enabled = false;
    this.controls.smoothTime = SMOOTH_CINEMA;
    const f = this._forwardOf(yaw, pitch);
    return this.controls
      .setLookAt(targetPos.x - f.x, targetPos.y - f.y, targetPos.z - f.z,
        targetPos.x, targetPos.y, targetPos.z, true)
      .then(() => { this.controls.smoothTime = SMOOTH_MOVE; });
  }

  /** 从聚焦中释放，回到此前位置 */
  release() {
    const s = this._saved;
    this._saved = null;
    if (!s) {
      this.mode = 'walk';
      this.controls.enabled = true;
      return Promise.resolve();
    }
    this.controls.smoothTime = 0.55;
    const f = this._forwardOf(s.yaw, s.pitch);
    return this.controls
      // 聚焦构图可以临时用 1m 视向半径，但回到漫游时必须恢复 FP_R；
      // 否则逻辑眼位/碰撞在 target，真正 camera 却长期落后 1m。
      .setLookAt(s.pos.x - f.x * FP_R, s.pos.y - f.y * FP_R, s.pos.z - f.z * FP_R,
        s.pos.x, s.pos.y, s.pos.z, true)
      .then(() => {
        this.controls.smoothTime = SMOOTH_MOVE;
        this.mode = 'walk';
        this.controls.enabled = true;
      });
  }

  /** 画境接管开始（位置交给画境，旋转走内部 yaw/pitch） */
  beginDriven() {
    this.mode = 'driven';
    this.controls.enabled = false;
    this.yaw = this.tYaw = 0;
    this.pitch = this.tPitch = 0;
  }

  // ============================================================
  //  入画环绕模式（orbit）—— 仅供 dream（入画立体画境）使用。
  //  围绕画心的轨道相机：拖拽 = 绕画心稳定旋转（可看画背面）、
  //  滚轮 / 双指 = 推近拉远（min/maxDistance 限深）。
  //  与 walk/locked/driven 完全隔离：进出成对调用，快照恢复
  //  所有被改动的 controls 参数，不影响其他空间的漫游手感。
  // ============================================================
  /** 入画→星尘对轴：环绕态平滑回到画正前方、俯仰回平，保持距离 */
  async faceFront(dur = 0.45) {
    if (this.mode !== 'orbit') return;
    this.controls.rotateTo(0, Math.PI / 2, true);
    await new Promise((r) => setTimeout(r, dur * 1000));
  }

  beginOrbit({ target, pos, minDist, maxDist, minPolar, maxPolar, rotSpeed = 0.9 }) {
    const c = this.controls;
    this._orbitSnap = {
      minD: c.minDistance, maxD: c.maxDistance,
      minPol: c.minPolarAngle, maxPol: c.maxPolarAngle,
      minAz: c.minAzimuthAngle, maxAz: c.maxAzimuthAngle,
      azSpd: c.azimuthRotateSpeed, polSpd: c.polarRotateSpeed,
      wheel: c.mouseButtons.wheel, two: c.touches.two,
    };
    this.mode = 'orbit';   // update() 中自然只走 controls.update，无键盘位移、无行走域钳制
    c.enabled = true;
    c.minDistance = minDist;
    c.maxDistance = maxDist;
    c.minPolarAngle = minPolar;
    c.maxPolarAngle = maxPolar;
    c.minAzimuthAngle = -Infinity;   // 允许绕满一圈，看画的反面
    c.maxAzimuthAngle = Infinity;
    c.azimuthRotateSpeed = rotSpeed; // 正值 = 标准环绕方向（模型查看器手感）
    c.polarRotateSpeed = rotSpeed;
    c.mouseButtons.wheel = CameraControls.ACTION.DOLLY;
    c.touches.two = CameraControls.ACTION.TOUCH_DOLLY;
    c.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, false);
  }

  endOrbit() {
    const s = this._orbitSnap;
    if (!s) return;
    this._orbitSnap = null;
    const c = this.controls;
    c.minDistance = s.minD;
    c.maxDistance = s.maxD;
    c.minPolarAngle = s.minPol;
    c.maxPolarAngle = s.maxPol;
    c.minAzimuthAngle = s.minAz;
    c.maxAzimuthAngle = s.maxAz;
    c.azimuthRotateSpeed = s.azSpd;
    c.polarRotateSpeed = s.polSpd;
    c.mouseButtons.wheel = s.wheel;
    c.touches.two = s.two;
  }

  update(dt) {
    if (this.mode === 'driven') {
      // 画境：位置由 immersion 设定，这里只做带阻尼的拖拽视角
      const damp = 1 - Math.exp(-dt * 5);
      this.yaw += (this.tYaw - this.yaw) * damp;
      this.pitch += (this.tPitch - this.pitch) * damp;
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      return;
    }

    if (this.mode === 'walk') {
      const k = this.keys;
      const speed = (k.ShiftLeft || k.ShiftRight) ? RUN_SPEED : WALK_SPEED;

      // 前进/后退：W/S 或 上/下箭头
      const dz = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
      // 横向平移：仅 A/D（左/右箭头改作转身，见下）
      const dx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
      if (dz || dx) {
        const n = Math.hypot(dx, dz);
        if (dz) this.controls.forward((dz / n) * speed * dt, true);
        if (dx) this.controls.truck((dx / n) * speed * dt, 0, true);
      }

      // 转身：左/右箭头 —— 平滑转视角，走路时用键盘就能转向，不必再用鼠标。
      // 方向与鼠标拖拽一致（右箭头视角右转）。库内"右转"= 方位角 theta 减小，
      // 故右取负、左取正；走 enableTransition 让其随 smoothTime 平滑、松手缓停。
      // 同时按【上+左/右】即可一边前进一边拐弯，走出自然的弧线。
      const turn = (k.ArrowLeft ? 1 : 0) - (k.ArrowRight ? 1 : 0);
      if (turn) this.controls.rotate(turn * TURN_SPEED * dt, 0, true);
    }

    this.controls.update(dt);
    this.controls.getTarget(this.pos, false);

    // 行走域钳制：越界时贴回最近的合法点（保持视向，掐断穿墙惯性）
    if (this.mode === 'walk' && this.bounds) {
      this._tmpC.copy(this.pos);
      this.bounds(this._tmpC);
      if (this._tmpC.distanceToSquared(this.pos) > 1e-8) {
        // 贴回最近合法点：只平移注视目标（= 第一人称眼位），保持视向与极小半径不变。
        // 旧实现「沿视向回退 1.0 再 setLookAt」会把半径瞬置为 1，相机随后 dolly 回拉 → 整页猛晃。
        this.controls.setTarget(this._tmpC.x, this._tmpC.y, this._tmpC.z, false);
        this.pos.copy(this._tmpC);
      }
    }
  }
}
