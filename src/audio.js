// ============================================================
//  环境音：WebAudio 实时生成的治愈系音景（无任何音频文件）
//  设计核心「环境潮汐」—— 整个音景以 TIDE_PERIOD 为周期
//  缓缓涨落，海风般的柔噪随周期漫上来，
//  如潮汐拍岸。大地低音 + 温暖低位和声垫（Dadd9/A）+ 稀疏而
//  绵长的五声风铃（双延迟交叉回响，尾音丝绒化）。
//  视觉层（画境薄雾 / 浮雕起伏）通过 tide01() 与音景保持同频。
// ============================================================

// —— 音景参数（集中可调）——
const TIDE_PERIOD = 6.5;      // 潮汐周期（秒）：渐盈约 42% · 渐舒约 58%
const MASTER_LEVEL = 0.42;    // 总响度（较旧版 0.5 更轻柔）
const MASTER_LP = 3200;       // 主输出低通（Hz）：给所有声音蒙一层丝绒
// 「嗡鸣」教训：低音失谐拍频（110.35 对 55 的泛音
// 产生 0.35Hz 搏动）+ 低位大二度音簇（D3+E3 在低频区打架）= 又密又浑的嗡鸣。
// 修法：低音干净纯八度且更轻；和声垫改开放排列、整体上移一个八度 → 空灵。
const DRONE_FREQS = [55, 110];                          // 大地低音（纯八度，无拍频）
const DRONE_LEVEL = 0.02;
const PAD_FREQS = [146.83, 220, 293.66, 329.63, 440];   // D3·A3·D4·E4·A4 —— Dsus2 开放空灵
const PAD_DETUNE = 4;         // 声部随机失谐（音分）
const PAD_TIDE = 0.34;        // 和声垫随潮汐的起伏深度
const TIDE_LEVEL = 0.020;     // 潮汐柔噪基准音量（随潮位涨落）
const CHIME_SCALE = [440, 493.88, 554.37, 659.25, 739.99, 880]; // A 大调五声
const CHIME_LEVEL = 0.0085;   // 风铃音量（较旧版 0.016 更轻）
const CHIME_DECAY = 6.5;      // 风铃余韵（秒）
const MODES = {               // 各场景音色：垫音量 / 滤波亮度(Hz) / 潮汐倍率 / 风铃间隔(秒)
  lobby:     { pad: 0.022, cutoff: 680,  tide: 0.9, chime: [12, 24] },
  hall:      { pad: 0.019, cutoff: 560,  tide: 0.7, chime: [14, 26] },
  dream:     { pad: 0.028, cutoff: 620,  tide: 1.5, chime: [10, 20] },  // 入画：温暖不浑，潮汐最近
  immersion: { pad: 0.034, cutoff: 1200, tide: 1.1, chime: [7, 14] },   // 星尘：空灵微亮
};

export class AmbientAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.padFilter = null;
    this.padGain = null;
    this.muted = true;   // 默认静音：用户需主动点击右上角声音按钮才开启环境音
    this.mode = 'lobby';
    this.nextChime = 4;
    this.time = 0;
    this._tide = 0.5;
    this._acc = 0;
    this._suspendTimer = null;
  }

  /** 环境潮汐相位 0..1；视觉层与音景同频的唯一时钟 */
  tide01() { return this._tide; }

  // 必须在用户手势之后调用
  ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;
    ctx.resume().catch(() => {}); // 防御性兜底：部分浏览器策略会把新建的 context 留在 suspended

    // 主链：所有声音 → 丝绒低通 → 轻压缩 → 总音量
    const masterLP = ctx.createBiquadFilter();
    masterLP.type = 'lowpass';
    masterLP.frequency.value = MASTER_LP;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -28;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.25;
    comp.release.value = 0.4;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    masterLP.connect(comp);
    comp.connect(this.master);
    this.master.connect(ctx.destination);
    this.bus = masterLP;

    // —— 大地低音（纯八度双正弦，轻轻托底，不搏动）——
    const droneGain = ctx.createGain();
    droneGain.gain.value = DRONE_LEVEL;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 160;
    DRONE_FREQS.forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(droneFilter);
      o.start();
    });
    droneFilter.connect(droneGain);
    droneGain.connect(this.bus);

    const initialMode = MODES[this.mode] || MODES.lobby;

    // —— 温暖和声垫（低位密排，随潮汐起伏）——
    this.padGain = ctx.createGain();
    this.padGain.gain.value = initialMode.pad;
    this.padBase = initialMode.pad;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = initialMode.cutoff;
    this.padFilter.Q.value = 0.5;
    PAD_FREQS.forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * PAD_DETUNE * 2;
      o.connect(this.padFilter);
      o.start();
    });
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.bus);

    // —— 潮汐柔噪（海风 / 浪沫：高潮位时缓缓漫上来）——
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const tideHP = ctx.createBiquadFilter();
    tideHP.type = 'highpass';
    tideHP.frequency.value = 110;
    this.tideLP = ctx.createBiquadFilter();
    this.tideLP.type = 'lowpass';
    this.tideLP.frequency.value = 480;
    this.tideLP.Q.value = 0.4;
    this.tideGain = ctx.createGain();
    this.tideGain.gain.value = 0;
    noise.connect(tideHP);
    tideHP.connect(this.tideLP);
    this.tideLP.connect(this.tideGain);
    this.tideGain.connect(this.bus);
    noise.start();

    // —— 风铃回响（双延迟交叉反馈，尾音过低通 → 绵长丝绒余韵）——
    const d1 = ctx.createDelay(2);
    d1.delayTime.value = 0.309;
    const d2 = ctx.createDelay(2);
    d2.delayTime.value = 0.473;
    const fb1 = ctx.createGain();
    fb1.gain.value = 0.34;
    const fb2 = ctx.createGain();
    fb2.gain.value = 0.30;
    d1.connect(fb1); fb1.connect(d2);
    d2.connect(fb2); fb2.connect(d1);
    const wetLP = ctx.createBiquadFilter();
    wetLP.type = 'lowpass';
    wetLP.frequency.value = 1600;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    d1.connect(wetLP); d2.connect(wetLP);
    wetLP.connect(wet);
    wet.connect(this.bus);
    this.chimeBus = ctx.createGain();
    this.chimeBus.gain.value = 1;
    this.chimeBus.connect(d1);
    this.chimeBus.connect(this.bus);

    // 淡入目标必须尊重当前静音状态，否则默认静音形同虚设
    this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_LEVEL, ctx.currentTime, 3.2);
    return true;
  }

  /** 一声风铃：双分音（基频 + 微失谐二倍频），慢起绵长 */
  chime() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const base = CHIME_SCALE[Math.floor(Math.random() * CHIME_SCALE.length)] *
      (this.mode === 'immersion' ? 1 : 0.5);
    const t0 = ctx.currentTime;
    [[base, 1], [base * 2.004, 0.35]].forEach(([f, amp]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(CHIME_LEVEL * amp, t0 + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + CHIME_DECAY);
      o.connect(g);
      g.connect(this.chimeBus);
      o.start(t0);
      o.stop(t0 + CHIME_DECAY + 0.5);
    });
  }

  /** 柔和涌起（化作星尘的那一刻：潮汐短暂满溢 + 低位五度轻和音） */
  swell() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    if (this.tideGain) {
      this.tideGain.gain.cancelScheduledValues(t0);
      this.tideGain.gain.setTargetAtTime(TIDE_LEVEL * 3.2, t0, 0.5);
      this.tideGain.gain.setTargetAtTime(TIDE_LEVEL, t0 + 1.4, 1.2);
    }
    [220, 329.63].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.012, t0 + 0.8 + i * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 6);
      o.connect(g);
      g.connect(this.chimeBus);
      o.start(t0);
      o.stop(t0 + 6.5);
    });
  }

  setMode(mode) {
    this.mode = mode;
    if (!this.ctx) return;
    const m = MODES[mode] || MODES.lobby;
    const t = this.ctx.currentTime;
    this.padBase = m.pad;
    this.padFilter.frequency.setTargetAtTime(m.cutoff, t, 2.2);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this._suspendTimer) {
      clearTimeout(this._suspendTimer);
      this._suspendTimer = null;
    }
    // 默认关闭时不创建 AudioContext/振荡器；只在用户主动开启的手势内初始化。
    if (!this.muted && !this.ensure()) this.muted = true;
    if (this.ctx) {
      if (!this.muted) this.ctx.resume().catch(() => {}); // 取消静音时顺手踢醒可能被挂起的 context
      this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_LEVEL, this.ctx.currentTime, 0.6);
      if (this.muted) {
        // 等当前风铃尾音自然结束后暂停音频图；再次开启会先取消计时并 resume。
        this._suspendTimer = setTimeout(() => {
          this._suspendTimer = null;
          if (this.muted && this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
        }, 7000);
      }
    }
    return this.muted;
  }

  update(dt) {
    // 环境潮汐时钟永远走（静音时视觉微动仍保持连续）。
    this.time += dt;
    const p = (this.time % TIDE_PERIOD) / TIDE_PERIOD;
    const q = p < 0.42 ? (p / 0.42) * 0.5 : 0.5 + ((p - 0.42) / 0.58) * 0.5;
    this._tide = 0.5 - 0.5 * Math.cos(q * Math.PI * 2);

    if (!this.ctx || this.muted) return;

    // 潮汐调制（每 ~80ms 提交一次平滑自动化，避免每帧铺满事件）
    this._acc += dt;
    if (this._acc > 0.08) {
      this._acc = 0;
      const t = this.ctx.currentTime;
      const m = MODES[this.mode] || MODES.lobby;
      const v = this._tide;
      this.padGain.gain.setTargetAtTime(this.padBase * (0.82 + PAD_TIDE * v), t, 0.12);
      this.tideGain.gain.setTargetAtTime(TIDE_LEVEL * m.tide * (0.30 + 0.95 * (1 - v)), t, 0.18);
      this.tideLP.frequency.setTargetAtTime(380 + 320 * v, t, 0.2);
    }

    if (this.time >= this.nextChime) {
      this.chime();
      const span = (MODES[this.mode] || MODES.lobby).chime;
      this.nextChime = this.time + span[0] + Math.random() * (span[1] - span[0]);
    }
  }
}
