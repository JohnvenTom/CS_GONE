/**
 * BuyWheel.js - 转轮购买菜单（Canvas 2D 实现）
 * --------------------------------------------------------------
 * 8 扇区转轮 + 二级子菜单 + 键鼠混合操作
 *
 * 交互：
 *  - 鼠标移动：根据极坐标确定扇区索引和层级
 *  - 悬停 0.3s：展开二级子武器环
 *  - 左键：购买当前高亮项
 *  - 数字键 1-8：直接定位主扇区
 *  - Q/E：在主扇区锁定下切换子武器
 *  - B 或 ESC：关闭
 *
 * 视觉：
 *  - 主扇区悬停膨胀 1.1×
 *  - 颜色随分类变化（金/蓝/绿/红/紫/橙/灰/深灰）
 *  - 中央显示金钱 + 当前选中武器信息
 *  - 关闭时粒子碎裂消散
 * --------------------------------------------------------------
 */

import { BUY_CATEGORIES, WEAPONS } from '../game/Weapons.js';

const DEG = Math.PI / 180;

export class BuyWheel {
  /**
   * @param {Object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {import('../audio/Audio.js').AudioSystem} opts.audio
   */
  constructor(opts) {
    this.canvas = opts.canvas;
    this.audio = opts.audio;
    this.ctx = this.canvas.getContext('2d');

    this.isOpen = false;
    this.activeSector = -1;
    this.activeSubIdx = -1;
    this.hoverTimer = 0;
    this.hoverThreshold = 0.3;
    this.expanded = false; // 是否展开二级菜单
    this.particles = []; // 关闭时的粒子
    this.fadeAlpha = 1;
    this.openProgress = 0; // 0~1 打开动画进度

    // 信息 DOM
    this.infoEl = document.getElementById('buy-wheel-info');
    this.moneyEl = document.getElementById('bw-money');
    this.nameEl = document.getElementById('bw-name');
    this.statsEl = document.getElementById('bw-stats');
    this.hintEl = document.getElementById('buy-hint');

    // 玩家状态回调
    this.getPlayerMoney = () => 0;
    this.getTeam = () => 'ct';
    this.onPurchase = () => {};
    this.onClose = () => {};

    // 鼠标位置
    this.mouseX = 0;
    this.mouseY = 0;
    this.lastTime = performance.now() / 1000;

    this._bindEvents();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  /**
   * 调整 canvas 尺寸匹配窗口
   * @private
   */
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * 绑定鼠标和键盘事件
   * @private
   */
  _bindEvents() {
    this.canvas.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });

    this.canvas.addEventListener('click', (e) => {
      if (!this.isOpen) return;
      this._handleClick();
    });

    // 键盘：数字键 1-8 切换主扇区
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.replace('Digit', ''), 10);
        if (n >= 1 && n <= 8) {
          this._selectSector(n - 1);
        }
      } else if (e.code === 'KeyQ') {
        this._cycleSub(-1);
      } else if (e.code === 'KeyE') {
        this._cycleSub(1);
      }
    });
  }

  /**
   * 打开转轮
   */
  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.openProgress = 0;
    this.activeSector = -1;
    this.activeSubIdx = -1;
    this.expanded = false;
    this.canvas.classList.add('active');
    this.infoEl.classList.add('active');
    this.hintEl.classList.add('active');
  }

  /**
   * 关闭转轮
   */
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.canvas.classList.remove('active');
    this.infoEl.classList.remove('active');
    this.hintEl.classList.remove('active');
    this._spawnParticles();
    if (this.onClose) this.onClose();
  }

  /**
   * 切换开关
   */
  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  /**
   * 生成关闭时的粒子
   * @private
   */
  _spawnParticles() {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const r = Math.min(window.innerWidth, window.innerHeight) * 0.35;
    for (let i = 0; i < 60; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = r * (0.5 + Math.random() * 0.5);
      this.particles.push({
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: Math.cos(angle) * (50 + Math.random() * 100),
        vy: Math.sin(angle) * (50 + Math.random() * 100),
        life: 0.6,
        maxLife: 0.6,
        size: 2 + Math.random() * 3,
        color: ['#00D4FF', '#FF5500', '#FFAA00', '#FFFFFF'][Math.floor(Math.random() * 4)]
      });
    }
  }

  /**
   * 主循环：由外部驱动
   * @param {number} delta
   */
  update(delta) {
    // 打开动画
    if (this.isOpen && this.openProgress < 1) {
      this.openProgress = Math.min(1, this.openProgress + delta * 4);
    }

    // 检测鼠标悬停扇区
    if (this.isOpen) {
      this._updateHover(delta);
    }

    // 更新粒子
    this.particles = this.particles.filter(p => {
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.vy += 100 * delta;
      p.life -= delta;
      return p.life > 0;
    });

    this._draw();
  }

  /**
   * 检测鼠标悬停哪个扇区/子武器
   * @private
   */
  _updateHover(delta) {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const dx = this.mouseX - cx;
    const dy = this.mouseY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const r = Math.min(window.innerWidth, window.innerHeight) * 0.35;

    // 内圈：关闭按钮
    if (dist < r * 0.25) {
      this.activeSector = 7; // 关闭扇区
      this.activeSubIdx = -1;
      this.expanded = false;
      return;
    }

    // 主扇区
    let angle = Math.atan2(dy, dx) + Math.PI / 2; // 0 朝上
    if (angle < 0) angle += Math.PI * 2;
    const sectorIdx = Math.floor(angle / (Math.PI * 2 / 8)) % 8;

    if (sectorIdx !== this.activeSector) {
      this.activeSector = sectorIdx;
      this.activeSubIdx = -1;
      this.expanded = false;
      this.hoverTimer = 0;
      this.audio.uiTick();
    } else {
      this.hoverTimer += delta;
      if (this.hoverTimer >= this.hoverThreshold && !this.expanded) {
        this.expanded = true;
        this.activeSubIdx = 0;
        this.audio.uiTick();
      }
    }

    // 检测子武器（外圈）
    if (this.expanded) {
      const cat = BUY_CATEGORIES[this.activeSector];
      if (cat && cat.items.length > 0 && dist > r * 1.05 && dist < r * 1.5) {
        // 外圈角度细分
        const subAngleStep = (Math.PI * 2 / 8) / cat.items.length;
        let subAngle = Math.atan2(dy, dx) + Math.PI / 2 - this.activeSector * (Math.PI * 2 / 8);
        if (subAngle < 0) subAngle += Math.PI * 2;
        const subIdx = Math.floor(subAngle / subAngleStep) % cat.items.length;
        if (subIdx !== this.activeSubIdx) {
          this.activeSubIdx = subIdx;
          this.audio.uiTick();
        }
      }
    }
  }

  /**
   * 处理点击购买
   * @private
   */
  _handleClick() {
    const cat = BUY_CATEGORIES[this.activeSector];
    if (!cat) return;
    if (cat.id === 'close') {
      this.close();
      return;
    }
    if (!this.expanded || this.activeSubIdx < 0) {
      // 仅展开主扇区
      this.expanded = true;
      this.activeSubIdx = 0;
      return;
    }
    // 使用阵营过滤后的可见武器列表
    const visibleItems = cat.items.filter(id => this._isAvailable(id));
    const weaponId = visibleItems[this.activeSubIdx];
    if (!weaponId) return;
    const def = WEAPONS[weaponId];
    const money = this.getPlayerMoney();
    if (money < def.price) {
      // 不足
      this.moneyEl.classList.add('insufficient');
      setTimeout(() => this.moneyEl.classList.remove('insufficient'), 400);
      this.audio.uiDeny();
      return;
    }
    const ok = this.onPurchase(weaponId);
    if (ok) {
      this.audio.uiConfirm();
      this._flashSector(this.activeSector, '#00FF88');
    } else {
      this.audio.uiDeny();
    }
  }

  /**
   * 通过键盘选择主扇区
   * @private
   */
  _selectSector(idx) {
    this.activeSector = idx;
    this.expanded = true;
    this.activeSubIdx = 0;
    this.hoverTimer = this.hoverThreshold;
    this.audio.uiTick();
  }

  /**
   * 在展开的扇区内循环切换子武器（仅循环阵营可购买的武器）
   * @private
   */
  _cycleSub(dir) {
    if (!this.expanded || this.activeSector < 0) return;
    const cat = BUY_CATEGORIES[this.activeSector];
    if (!cat || cat.items.length === 0) return;
    const visibleItems = cat.items.filter(id => this._isAvailable(id));
    if (visibleItems.length === 0) return;
    this.activeSubIdx = (this.activeSubIdx + dir + visibleItems.length) % visibleItems.length;
    this.audio.uiTick();
  }

  /**
   * 闪烁扇区
   * @private
   */
  _flashSector(idx, color) {
    this._flash = { idx, color, time: 0.4 };
  }

  /**
   * 绘制转轮
   * @private
   */
  _draw() {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    // 关闭粒子
    if (this.particles.length > 0) {
      for (const p of this.particles) {
        const alpha = p.life / p.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (!this.isOpen && this.particles.length === 0) return;

    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.35 * this.openProgress;

    // 半透明背景径向遮罩
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2);
    grad.addColorStop(0, 'rgba(11, 12, 16, 0.75)');
    grad.addColorStop(0.7, 'rgba(11, 12, 16, 0.45)');
    grad.addColorStop(1, 'rgba(11, 12, 16, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 绘制 8 个扇区
    BUY_CATEGORIES.forEach((cat, i) => {
      const startAngle = i * 45 - 90 - 22.5; // -90 让 0 号在顶部
      const endAngle = startAngle + 45;
      const isHover = (i === this.activeSector);

      // 扇区膨胀
      const r1 = isHover ? r * 1.08 : r;

      // 闪烁效果
      let fillColor = cat.color;
      let alpha = isHover ? 0.4 : 0.22;
      if (this._flash && this._flash.idx === i) {
        alpha = 0.6 + Math.sin(this._flash.time * 30) * 0.3;
        fillColor = this._flash.color;
      }

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r1, startAngle * DEG, endAngle * DEG);
      ctx.closePath();

      // 填充
      const hex = fillColor;
      ctx.fillStyle = this._hexToRgba(hex, alpha);
      ctx.fill();

      // 描边
      ctx.strokeStyle = isHover ? hex : 'rgba(255,255,255,0.15)';
      ctx.lineWidth = isHover ? 2.5 : 1;
      ctx.stroke();

      // 标签
      const midAngle = (startAngle + endAngle) / 2 * DEG;
      const labelR = r1 * 0.7;
      const lx = cx + Math.cos(midAngle) * labelR;
      const ly = cy + Math.sin(midAngle) * labelR;
      ctx.save();
      ctx.translate(lx, ly);
      let rot = midAngle + Math.PI / 2;
      if (rot > Math.PI / 2 && rot < Math.PI * 1.5) rot += Math.PI;
      ctx.rotate(rot);
      ctx.fillStyle = isHover ? '#fff' : 'rgba(255,255,255,0.6)';
      ctx.font = `${isHover ? '700' : '600'} ${isHover ? 14 : 12}px Rajdhani, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cat.shortName, 0, 0);
      // 类别图标（emoji）
      ctx.font = '18px sans-serif';
      ctx.fillText(this._categoryEmoji(cat.id), 0, -22);
      ctx.restore();

      // 数字键
      const keyR = r1 * 0.45;
      const kx = cx + Math.cos(midAngle) * keyR;
      const ky = cy + Math.sin(midAngle) * keyR;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '10px Orbitron, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), kx, ky);
    });

    // 绘制二级子菜单（外圈）
    if (this.expanded && this.activeSector >= 0) {
      const cat = BUY_CATEGORIES[this.activeSector];
      if (cat && cat.items.length > 0) {
        // 过滤掉阵营不匹配的武器（不在菜单中显示）
        const visibleItems = cat.items.filter(id => this._isAvailable(id));
        if (visibleItems.length > 0) {
          const sectorStartAngle = this.activeSector * 45 - 90 - 22.5;
          const sectorEndAngle = sectorStartAngle + 45;
          const subStep = (sectorEndAngle - sectorStartAngle) / visibleItems.length;
          const innerR = r * 1.12;
          const outerR = r * 1.5;

          visibleItems.forEach((itemId, i) => {
            const sA = (sectorStartAngle + i * subStep) * DEG;
            const eA = (sectorStartAngle + (i + 1) * subStep) * DEG;
            const isHoverSub = (i === this.activeSubIdx);
            const def = WEAPONS[itemId];

            ctx.beginPath();
            ctx.arc(cx, cy, outerR, sA, eA);
            ctx.arc(cx, cy, innerR, eA, sA, true);
            ctx.closePath();

            const affordable = this.getPlayerMoney() >= def.price;
            let subColor = cat.color;
            let subAlpha = 0.3;
            if (!affordable) subColor = '#FF2040';
            if (isHoverSub) subAlpha = 0.55;

            ctx.fillStyle = this._hexToRgba(subColor, subAlpha);
            ctx.fill();
            ctx.strokeStyle = isHoverSub ? subColor : 'rgba(255,255,255,0.2)';
            ctx.lineWidth = isHoverSub ? 2 : 1;
            ctx.stroke();

            // 子武器名（弧形文字）
            const midA = (sA + eA) / 2;
            const textR = (innerR + outerR) / 2;
            const tx = cx + Math.cos(midA) * textR;
            const ty = cy + Math.sin(midA) * textR;
            ctx.save();
            ctx.translate(tx, ty);
            let rot = midA + Math.PI / 2;
            if (rot > Math.PI / 2 && rot < Math.PI * 1.5) rot += Math.PI;
            ctx.rotate(rot);
            ctx.fillStyle = affordable ? '#fff' : '#FF6680';
            ctx.font = `${isHoverSub ? '700' : '500'} 12px Rajdhani, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(def.name, 0, 0);
            // 价格
            ctx.font = '10px Orbitron, monospace';
            ctx.fillStyle = affordable ? 'rgba(0,255,136,0.9)' : 'rgba(255,32,64,0.9)';
            ctx.fillText('$' + def.price, 0, 14);
            ctx.restore();
          });
        }
      }
    }

    // 内圈：关闭按钮
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = this.activeSector === 7 ? 'rgba(255,32,64,0.6)' : 'rgba(40,40,50,0.8)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '600 12px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('关闭', cx, cy - 8);
    ctx.font = '9px Orbitron, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('B / 8', cx, cy + 8);

    // 闪烁衰减
    if (this._flash) {
      this._flash.time -= 1 / 60;
      if (this._flash.time <= 0) this._flash = null;
    }

    // 更新中央信息
    this._updateInfo();
  }

  /**
   * 更新中央信息 DOM
   * @private
   */
  _updateInfo() {
    if (!this.isOpen) return;
    const money = this.getPlayerMoney();
    this.moneyEl.textContent = `$${money}`;
    this.moneyEl.classList.toggle('insufficient', false);

    const cat = BUY_CATEGORIES[this.activeSector];
    if (!cat || this.activeSector < 0) {
      this.nameEl.textContent = '选择装备';
      this.statsEl.textContent = '';
      return;
    }
    if (cat.id === 'close') {
      this.nameEl.textContent = '关闭菜单';
      this.statsEl.textContent = '';
      return;
    }
    if (this.expanded && this.activeSubIdx >= 0 && cat.items[this.activeSubIdx]) {
      const def = WEAPONS[cat.items[this.activeSubIdx]];
      this.nameEl.textContent = def.name;
      this.statsEl.textContent = `$${def.price} · 伤害 ${def.damage} · 射速 ${def.fireRate}/s`;
      const affordable = money >= def.price;
      this.moneyEl.classList.toggle('insufficient', !affordable);
    } else {
      this.nameEl.textContent = cat.name;
      this.statsEl.textContent = `${cat.items.length} 件装备`;
    }
  }

  /**
   * 阵营限制过滤：根据玩家阵营隐藏不可购买的武器
   * @param {string} weaponId
   * @returns {boolean}
   * @private
   */
  _isAvailable(weaponId) {
    const def = WEAPONS[weaponId];
    if (!def) return false;
    if (def.side === 'any') return true;
    return def.side === this.getTeam();
  }

  /**
   * 类别 emoji
   * @private
   */
  _categoryEmoji(id) {
    return ({
      pistols: '🔫',
      smgs: '💨',
      shotguns: '💥',
      rifles: '🎯',
      snipers: '🔭',
      grenades: '💣',
      equipment: '🛡️',
      close: '✖'
    })[id] || '◉';
  }

  /**
   * 工具：hex + alpha → rgba
   * @private
   */
  _hexToRgba(hex, alpha) {
    if (hex.startsWith('rgba')) return hex;
    const h = hex.replace('#', '');
    const r = parseInt(h.substr(0, 2), 16);
    const g = parseInt(h.substr(2, 2), 16);
    const b = parseInt(h.substr(4, 2), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
}
