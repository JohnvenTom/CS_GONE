/**
 * KillFeed.js - 击杀反馈 + 浮动伤害数字
 * --------------------------------------------------------------
 * - 顶右侧动态击杀列表
 * - 屏幕中央击杀奖励提示
 * - 世界坐标 → 屏幕坐标的浮动伤害数字
 * --------------------------------------------------------------
 */

import * as THREE from 'three';

export class KillFeed {
  /**
   * @param {THREE.Camera} camera 主相机（用于世界坐标转屏幕）
   */
  constructor(camera) {
    this.camera = camera;
    this.feedEl = document.getElementById('kill-feed');
    this.rewardEl = document.getElementById('kill-reward');
    this.floatingEl = document.getElementById('floating-damages');
    this._rewardTimer = null;
  }

  /**
   * 添加一条击杀记录
   * @param {Object} info
   * @param {string} info.killerName
   * @param {string} info.killerTeam 'ct' | 't'
   * @param {string} info.victimName
   * @param {string} info.victimTeam
   * @param {string} info.weaponName
   * @param {boolean} info.headshot
   */
  addKill(info) {
    if (!this.feedEl) return;
    const e = document.createElement('div');
    e.className = 'kf-entry';
    e.innerHTML = `
      <span class="kf-killer ${info.killerTeam}">${info.killerName}</span>
      <span class="kf-weapon">${info.weaponName}${info.headshot ? ' <span class="kf-headshot">HS</span>' : ''}</span>
      <span class="kf-victim ${info.victimTeam}">${info.victimName}</span>
    `;
    this.feedEl.appendChild(e);
    // 限制最多 5 条
    while (this.feedEl.children.length > 5) {
      this.feedEl.removeChild(this.feedEl.firstChild);
    }
    setTimeout(() => e.remove(), 6000);
  }

  /**
   * 显示击杀奖励
   * @param {number} amount 金钱
   */
  showReward(amount) {
    if (!this.rewardEl) return;
    this.rewardEl.textContent = `+ $${amount}`;
    this.rewardEl.classList.add('show');
    if (this._rewardTimer) clearTimeout(this._rewardTimer);
    this._rewardTimer = setTimeout(() => {
      this.rewardEl.classList.remove('show');
    }, 1500);
  }

  /**
   * 在世界坐标处弹出浮动伤害数字
   * @param {THREE.Vector3} worldPos 世界坐标
   * @param {number} damage 伤害值
   * @param {boolean} isHeadshot 是否爆头
   */
  showFloatingDamage(worldPos, damage, isHeadshot = false) {
    if (!this.floatingEl || !this.camera) return;
    const screen = worldPos.clone().project(this.camera);
    // 转屏幕像素
    const x = (screen.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-screen.y * 0.5 + 0.5) * window.innerHeight;
    // 屏幕外不显示
    if (screen.z > 1 || x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) return;

    const el = document.createElement('div');
    el.className = 'fd-number' + (isHeadshot ? ' headshot' : '');
    el.textContent = damage;
    el.style.left = (x - 10) + 'px';
    el.style.top = (y - 20) + 'px';
    this.floatingEl.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }
}
