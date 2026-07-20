/**
 * HUD.js - 抬头显示
 * --------------------------------------------------------------
 * 管理：
 *  - 左下：HP/护甲环
 *  - 右下：弹药/换弹进度
 *  - 底部：武器栏
 *  - 顶部：比分/回合/计时器
 *  - 经济条
 *  - 受伤红屏
 *  - 炸弹状态
 *  - 性能降级切换
 * --------------------------------------------------------------
 */

export class HUD {
  constructor() {
    // 缓存 DOM
    this.el = {
      hpValue: document.getElementById('hp-value'),
      armorValue: document.getElementById('armor-value'),
      ringHp: document.querySelector('.ring-hp'),
      ringArmor: document.querySelector('.ring-armor'),
      hpPanel: document.getElementById('hp-armor-panel'),
      ammoWeapon: document.getElementById('ammo-weapon'),
      ammoMag: document.getElementById('ammo-mag'),
      ammoReserve: document.getElementById('ammo-reserve'),
      reloadBar: document.getElementById('reload-bar'),
      ctScore: document.getElementById('ct-score'),
      tScore: document.getElementById('t-score'),
      ctEco: document.getElementById('ct-eco'),
      tEco: document.getElementById('t-eco'),
      roundPhase: document.getElementById('round-phase'),
      roundTimer: document.getElementById('round-timer'),
      roundCount: document.getElementById('round-count'),
      slots: [
        document.getElementById('slot-1'),
        document.getElementById('slot-2'),
        document.getElementById('slot-3'),
        document.getElementById('slot-4')
      ],
      slotContainers: document.querySelectorAll('.weapon-slot'),
      damageVignette: document.getElementById('damage-vignette'),
      bombStatus: document.getElementById('bomb-status'),
      bombTimer: document.getElementById('bomb-timer'),
      bombState: document.getElementById('bomb-state'),
      purchaseToast: document.getElementById('purchase-toast')
    };
    this.HP_RING_LEN = 264;
    this.ARMOR_RING_LEN = 214;
    this._vignetteTimer = null;
  }

  /**
   * 更新生命值/护甲显示
   * @param {number} hp
   * @param {number} armor
   */
  updateVitals(hp, armor) {
    if (!this.el.hpValue) return;
    this.el.hpValue.textContent = Math.max(0, Math.ceil(hp));
    this.el.armorValue.textContent = Math.max(0, Math.ceil(armor));

    // HP 环
    const hpRatio = Math.max(0, hp / 100);
    this.el.ringHp.style.strokeDashoffset = String(this.HP_RING_LEN * (1 - hpRatio));
    this.el.ringHp.classList.remove('medium', 'low');
    if (hp < 30) this.el.ringHp.classList.add('low');
    else if (hp < 60) this.el.ringHp.classList.add('medium');

    // 护甲环
    const armorRatio = Math.max(0, armor / 100);
    this.el.ringArmor.style.strokeDashoffset = String(this.ARMOR_RING_LEN * (1 - armorRatio));

    // 低血量心跳
    this.el.hpPanel.classList.toggle('low-hp', hp > 0 && hp < 30);
    this.el.damageVignette.classList.toggle('critical', hp > 0 && hp < 25);
  }

  /**
   * 更新弹药显示
   * @param {Object} w 武器状态
   */
  updateAmmo(w) {
    if (!this.el.ammoMag) return;
    this.el.ammoWeapon.textContent = w.name;
    this.el.ammoMag.textContent = w.mag;
    this.el.ammoReserve.textContent = w.reserve;
    if (w.isReloading) {
      this.el.reloadBar.classList.add('active');
      this.el.reloadBar.style.width = (w.reloadProgress * 100) + '%';
    } else {
      this.el.reloadBar.classList.remove('active');
      this.el.reloadBar.style.width = '0%';
    }
  }

  /**
   * 更新武器栏
   * @param {Object} weapons {1: WeaponInstance, 2: ...}
   * @param {string} currentSlot
   * @param {string} team 玩家阵营
   */
  updateWeaponBar(weapons, currentSlot, team) {
    this.el.slotContainers.forEach((slot, i) => {
      const idx = String(i + 1);
      const w = weapons[idx];
      const nameEl = this.el.slots[i];
      nameEl.textContent = w ? w.def.name : '—';
      slot.classList.toggle('active', idx === currentSlot);
      slot.classList.toggle('t-side', team === 't');
    });
  }

  /**
   * 更新比分
   * @param {number} ctScore
   * @param {number} tScore
   * @param {number} round 当前局数
   * @param {number} maxRounds 最大局数
   */
  updateScore(ctScore, tScore, round, maxRounds) {
    this.el.ctScore.textContent = ctScore;
    this.el.tScore.textContent = tScore;
    this.el.roundCount.textContent = `第 ${round} / ${maxRounds} 局`;
  }

  /**
   * 更新回合阶段与计时器
   * @param {string} phase 'freeze' | 'active' | 'round_end' | 'game_end'
   * @param {number} time 剩余秒数
   */
  updateRoundPhase(phase, time) {
    const phaseLabels = {
      freeze: '冻结时间',
      active: '回合中',
      round_end: '回合结束',
      game_end: '游戏结束'
    };
    this.el.roundPhase.textContent = phaseLabels[phase] || phase;
    this.el.roundTimer.textContent = Math.ceil(time);
  }

  /**
   * 更新经济条
   * @param {number} ctMoney
   * @param {number} tMoney
   */
  updateEconomy(ctMoney, tMoney) {
    this.el.ctEco.textContent = `$${ctMoney}`;
    this.el.tEco.textContent = `$${tMoney}`;
  }

  /**
   * 显示受伤红屏
   * @param {number} angle 受击方向（弧度，0=正前）
   */
  showDamageIndicator(angle) {
    if (this._vignetteTimer) clearTimeout(this._vignetteTimer);
    this.el.damageVignette.classList.add('active');
    this._vignetteTimer = setTimeout(() => {
      this.el.damageVignette.classList.remove('active');
    }, 200);

    // 方向指示器
    const ind = document.createElement('div');
    ind.className = 'dmg-indicator';
    ind.style.setProperty('--angle', (angle * 180 / Math.PI) + 'deg');
    document.getElementById('damage-indicators').appendChild(ind);
    setTimeout(() => ind.remove(), 800);
  }

  /**
   * 更新炸弹状态
   * @param {Object} bomb
   * @param {string} bomb.state 'inactive' | 'planted' | 'exploded' | 'defused'
   * @param {number} bomb.timer 剩余秒数
   */
  updateBomb(bomb) {
    if (!bomb || bomb.state === 'inactive' || bomb.state === 'exploded' || bomb.state === 'defused') {
      this.el.bombStatus.classList.remove('active');
      return;
    }
    this.el.bombStatus.classList.add('active');
    this.el.bombTimer.textContent = Math.ceil(bomb.timer);
    this.el.bombState.textContent = bomb.state === 'planted' ? '已安装' : (bomb.state === 'defusing' ? '正在拆除' : '已安装');
    this.el.bombStatus.classList.toggle('critical', bomb.timer < 10);
  }

  /**
   * 显示购买提示
   * @param {string} itemName
   */
  showPurchaseToast(itemName) {
    const t = document.createElement('div');
    t.className = 'pt-item';
    t.textContent = `+ ${itemName}`;
    this.el.purchaseToast.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  /**
   * 性能降级切换
   * @param {boolean} low 是否降级
   */
  setLowPerformance(low) {
    document.body.classList.toggle('low-fps', low);
  }
}
