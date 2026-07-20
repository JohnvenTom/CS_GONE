/**
 * Audio.js - Web Audio 合成音效（无外部音频文件）
 * --------------------------------------------------------------
 * 职责：使用 OscillatorNode + 噪声合成常见 FPS 音效
 *   - 枪声（不同武器不同滤波/包络）
 *   - 换弹声 / 命中 / 爆头 / 脚步声 / UI 滴答
 *   - 炸弹蜂鸣 / 爆炸 / 胜利/失败音乐短句
 * --------------------------------------------------------------
 */

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;
    this.noiseBuffer = null;
  }

  /**
   * 初始化音频上下文（必须在用户手势后调用，否则浏览器会阻止）
   */
  init() {
    if (this.ctx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this._buildNoiseBuffer();
      this.enabled = true;
    } catch (e) {
      console.warn('[Audio] 初始化失败', e);
    }
  }

  /**
   * 恢复音频上下文（浏览器自动暂停策略）
   */
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * 构建 2 秒白噪声 buffer（枪声/爆炸/脚步复用）
   * @private
   */
  _buildNoiseBuffer() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buf;
  }

  /**
   * 内部：播放一次白噪声（带包络和滤波器）
   * @param {number} duration 时长（秒）
   * @param {number} cutoff 低通截止频率 Hz
   * @param {number} gain 峰值音量
   * @param {AudioNode} target 目标节点
   * @private
   */
  _playNoise(duration, cutoff, gain, target) {
    if (!this.enabled) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const g = this.ctx.createGain();
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(filter).connect(g).connect(target || this.master);
    src.start(now);
    src.stop(now + duration);
  }

  /**
   * 内部：播放一次正弦/方波音
   * @param {number} freq 频率
   * @param {number} duration 时长
   * @param {string} type 振荡器类型
   * @param {number} gain 音量
   * @private
   */
  _playTone(freq, duration, type, gain) {
    if (!this.enabled) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + duration);
  }

  /**
   * 枪声合成（按武器类型差异化）
   * @param {string} weaponId 武器 ID
   */
  gunshot(weaponId) {
    if (!this.enabled) return;
    // 不同武器不同参数
    const presets = {
      ak47:    { dur: 0.18, cutoff: 3500, gain: 0.55, low: 80 },
      m4a4:    { dur: 0.14, cutoff: 4200, gain: 0.45, low: 100 },
      awp:     { dur: 0.35, cutoff: 2200, gain: 0.7, low: 60 },
      deagle:  { dur: 0.22, cutoff: 2800, gain: 0.65, low: 70 },
      usp:     { dur: 0.10, cutoff: 5000, gain: 0.35, low: 120 },
      glock:   { dur: 0.10, cutoff: 4800, gain: 0.35, low: 120 },
      mac10:   { dur: 0.10, cutoff: 4500, gain: 0.35, low: 110 },
      mag7:    { dur: 0.25, cutoff: 2000, gain: 0.6, low: 60 },
      p250:    { dur: 0.12, cutoff: 3800, gain: 0.4, low: 110 }
    };
    const p = presets[weaponId] || presets.usp;
    // 高频部分：噪声
    this._playNoise(p.dur, p.cutoff, p.gain, this.master);
    // 低频冲击：方波短促
    this._playTone(p.low, p.dur * 0.5, 'square', p.gain * 0.3);
  }

  /**
   * 换弹声
   */
  reload() {
    if (!this.enabled) return;
    // 两段：弹匣卸下 + 上膛
    setTimeout(() => this._playNoise(0.08, 2000, 0.2, this.master), 0);
    setTimeout(() => this._playNoise(0.05, 3500, 0.25, this.master), 200);
    setTimeout(() => this._playTone(800, 0.04, 'square', 0.2), 380);
  }

  /**
   * 命中敌人（普通）
   */
  hit() {
    if (!this.enabled) return;
    this._playTone(1200, 0.05, 'sine', 0.25);
  }

  /**
   * 爆头命中
   */
  headshot() {
    if (!this.enabled) return;
    this._playTone(1800, 0.08, 'sine', 0.35);
    setTimeout(() => this._playNoise(0.06, 6000, 0.2, this.master), 30);
  }

  /**
   * 玩家受伤
   */
  playerHurt() {
    if (!this.enabled) return;
    this._playNoise(0.12, 800, 0.35, this.master);
    this._playTone(200, 0.1, 'sawtooth', 0.2);
  }

  /**
   * 脚步声
   * @param {boolean} running 是否跑步（音量更大）
   */
  footstep(running = false) {
    if (!this.enabled) return;
    const g = running ? 0.18 : 0.08;
    this._playNoise(0.06, 1500, g, this.master);
  }

  /**
   * UI 滴答（悬停）
   */
  uiTick() {
    if (!this.enabled) return;
    this._playTone(2200, 0.03, 'sine', 0.12);
  }

  /**
   * UI 确认（购买成功）
   */
  uiConfirm() {
    if (!this.enabled) return;
    this._playTone(800, 0.06, 'sine', 0.2);
    setTimeout(() => this._playTone(1200, 0.06, 'sine', 0.2), 60);
  }

  /**
   * UI 拒绝（金钱不足）
   */
  uiDeny() {
    if (!this.enabled) return;
    this._playTone(180, 0.18, 'sawtooth', 0.25);
  }

  /**
   * 炸弹蜂鸣（最后阶段加速）
   * @param {boolean} urgent 是否紧急（最后 10 秒）
   */
  bombBeep(urgent = false) {
    if (!this.enabled) return;
    const freq = urgent ? 1400 : 800;
    this._playTone(freq, 0.08, 'square', 0.35);
  }

  /**
   * 炸弹爆炸
   */
  explosion() {
    if (!this.enabled) return;
    this._playNoise(0.8, 1500, 0.7, this.master);
    this._playTone(60, 0.6, 'sawtooth', 0.4);
    setTimeout(() => this._playNoise(0.4, 800, 0.4, this.master), 100);
  }

  /**
   * 回合胜利（上行音阶）
   */
  roundWin() {
    if (!this.enabled) return;
    [523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(() => this._playTone(f, 0.15, 'triangle', 0.25), i * 100);
    });
  }

  /**
   * 回合失败（下行音阶）
   */
  roundLose() {
    if (!this.enabled) return;
    [400, 350, 300, 250].forEach((f, i) => {
      setTimeout(() => this._playTone(f, 0.2, 'sawtooth', 0.22), i * 120);
    });
  }
}
