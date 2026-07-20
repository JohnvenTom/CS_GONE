/**
 * Crosshair.js - 动态准星
 * --------------------------------------------------------------
 * 状态感知：
 *  - 静止：4 条细线收紧
 *  - 移动：线条外扩 + 颜色变橙
 *  - 射击：上部线条上跳（模拟后坐力）
 *  - 命中：中心爆点
 *  - 爆头：白色 X
 * --------------------------------------------------------------
 */

export class Crosshair {
  constructor() {
    this.el = document.getElementById('crosshair');
    this.hitMarker = document.getElementById('hit-marker');
    if (!this.el || !this.hitMarker) {
      console.warn('[Crosshair] DOM 元素缺失');
    }
    this._hitTimer = null;
  }

  /**
   * 更新准星状态
   * @param {Object} state
   * @param {boolean} state.isMoving
   * @param {boolean} state.isFiring
   * @param {boolean} state.isInspecting
   */
  update({ isMoving = false, isFiring = false, isInspecting = false } = {}) {
    if (!this.el) return;
    this.el.classList.toggle('moving', isMoving);
    this.el.classList.toggle('firing', isFiring);
    this.el.classList.toggle('inspecting', isInspecting);
  }

  /**
   * 显示命中标记
   * @param {boolean} isHeadshot 是否爆头
   */
  showHit(isHeadshot = false) {
    if (!this.hitMarker) return;
    this.hitMarker.classList.toggle('headshot', isHeadshot);
    this.hitMarker.classList.add('show');
    if (this._hitTimer) clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => {
      this.hitMarker.classList.remove('show');
    }, 120);
  }

  /**
   * 显示爆头横幅
   */
  showHeadshotBanner() {
    const banner = document.getElementById('headshot-banner');
    if (!banner) return;
    banner.classList.add('show');
    setTimeout(() => banner.classList.remove('show'), 600);
  }
}
