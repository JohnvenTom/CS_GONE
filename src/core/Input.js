/**
 * Input.js - 输入管理（Pointer Lock + 键鼠）
 * --------------------------------------------------------------
 * 职责：
 *  - 维护键盘按键状态（持续按下检测）
 *  - 监听鼠标移动并输出 yaw/pitch 增量
 *  - 管理指针锁定状态切换
 *  - 提供事件回调注册接口
 * --------------------------------------------------------------
 */

export class Input {
  /**
   * @param {HTMLCanvasElement} canvas 主画布
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = {
      dx: 0, dy: 0,
      buttons: new Set(),
      wheel: 0
    };
    this.pointerLocked = false;
    this.sensitivity = 0.0022;

    // 按键按下瞬间回调（用于一次性触发：换弹/购买/切换等）
    this._pressCallbacks = new Map();

    this._bind();
  }

  /**
   * 绑定所有输入事件监听
   * @private
   */
  _bind() {
    // ---- 键盘 ----
    window.addEventListener('keydown', (e) => {
      // 阻止 Tab 等浏览器默认行为
      if (['Tab', 'Space', 'ControlLeft', 'ControlRight'].includes(e.code)) {
        e.preventDefault();
      }
      if (!this.keys.has(e.code)) {
        // 触发一次性回调
        const cbs = this._pressCallbacks.get(e.code);
        if (cbs) cbs.forEach(cb => cb(e));
      }
      this.keys.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    // ---- 鼠标移动（仅在指针锁定时累积） ----
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
      }
    });

    // ---- 鼠标按键 ----
    this.canvas.addEventListener('mousedown', (e) => {
      this.mouse.buttons.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.mouse.buttons.delete(e.button);
    });

    // ---- 滚轮 ----
    window.addEventListener('wheel', (e) => {
      this.mouse.wheel = Math.sign(e.deltaY);
    }, { passive: true });

    // ---- 指针锁定状态 ----
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (this.onPointerLockChange) this.onPointerLockChange(this.pointerLocked);
    });
  }

  /**
   * 请求指针锁定（需用户手势触发）
   * 注意：现代浏览器中 requestPointerLock() 返回 Promise，
   *      在非用户手势上下文调用会被拒绝，此处统一 catch 防止未捕获异常
   */
  requestPointerLock() {
    if (this.pointerLocked) return;
    try {
      const ret = this.canvas.requestPointerLock();
      // 浏览器可能返回 Promise（新规范）或 undefined（旧规范）
      if (ret && typeof ret.catch === 'function') {
        ret.catch((err) => {
          // 静默处理：通常是因为调用时不在用户手势上下文
          // 例如 setTimeout 延迟调用、AI 自动触发的场景
          console.warn('[Input] 指针锁定请求被拒绝（可能不在用户手势上下文）:', err && err.name);
        });
      }
    } catch (e) {
      console.warn('[Input] requestPointerLock 抛出异常:', e);
    }
  }

  /**
   * 释放指针锁定
   */
  exitPointerLock() {
    if (this.pointerLocked) {
      document.exitPointerLock();
    }
  }

  /**
   * 注册按键按下瞬间回调（一次性，按住不重复）
   * @param {string} code KeyboardEvent.code
   * @param {(e:KeyboardEvent)=>void} cb 回调
   */
  onPress(code, cb) {
    if (!this._pressCallbacks.has(code)) {
      this._pressCallbacks.set(code, []);
    }
    this._pressCallbacks.get(code).push(cb);
  }

  /**
   * 查询某键当前是否按下
   * @param {string} code
   * @returns {boolean}
   */
  isDown(code) {
    return this.keys.has(code);
  }

  /**
   * 查询鼠标按键当前是否按下
   * @param {number} button 0=左 1=中 2=右
   * @returns {boolean}
   */
  isMouseDown(button) {
    return this.mouse.buttons.has(button);
  }

  /**
   * 消费并清空鼠标移动增量
   * @returns {{dx:number, dy:number}}
   */
  consumeMouseDelta() {
    const { dx, dy } = this.mouse;
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return { dx, dy };
  }

  /**
   * 消费滚轮增量
   * @returns {number} -1 / 0 / 1
   */
  consumeWheel() {
    const w = this.mouse.wheel;
    this.mouse.wheel = 0;
    return w;
  }

  /**
   * 在主循环末尾调用，确保鼠标按键按下瞬间不会丢失
   * （此处无需特殊处理，按键状态由事件维护）
   */
  endFrame() {}
}
