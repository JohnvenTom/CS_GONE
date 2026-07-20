/**
 * Weapons.js - 武器静态数据 + 武器实例类
 * --------------------------------------------------------------
 * 包含：
 *  - WEAPONS 武器数据表（伤害/射速/弹匣/精度/价格/阵营限制等）
 *  - WeaponInstance 单把武器实例（弹药/换弹/后坐力状态机）
 *  - BUY_CATEGORIES 转轮菜单的 8 个分类数据
 * --------------------------------------------------------------
 */

/**
 * 武器数据表
 * @typedef {Object} WeaponDef
 * @property {string} id
 * @property {string} name 显示名
 * @property {string} category 类别：pistol/smg/shotgun/rifle/sniper/grenade/equipment
 * @property {number} price 价格
 * @property {number} damage 基础伤害（身体）
 * @property {number} headshotMultiplier 爆头倍率
 * @property {number} fireRate 每秒射速（发/秒）
 * @property {number} magSize 弹匣容量
 * @property {number} reserveAmmo 备弹量
 * @property {number} reloadTime 换弹时间（秒）
 * @property {number} range 射程（米，超出衰减）
 * @property {number} spread 基础散布角度（弧度）
 * @property {number} moveSpreadFactor 移动时散布倍率
 * @property {number} recoilVertical 垂直后坐力（每发上抬角度）
 * @property {number} recoilHorizontal 水平后坐力（最大随机偏移角度）
 * @property {number} zoomFactor 右键缩放倍率（1 表示不可缩放）
 * @property {boolean} automatic 是否全自动
 * @property {string} side 阵营限制：'any' | 'ct' | 't'
 * @property {string} modelType 第一人称模型类型：pistol/rifle/sniper/shotgun
 */
export const WEAPONS = {
  // ---------- 手枪 ----------
  usp: {
    id: 'usp', name: 'USP-S', category: 'pistol', price: 200,
    damage: 28, headshotMultiplier: 4, fireRate: 5, magSize: 12, reserveAmmo: 24,
    reloadTime: 2.0, range: 80, spread: 0.005, moveSpreadFactor: 4,
    recoilVertical: 0.012, recoilHorizontal: 0.005, zoomFactor: 1,
    automatic: false, side: 'ct', modelType: 'pistol'
  },
  glock: {
    id: 'glock', name: 'Glock-18', category: 'pistol', price: 200,
    damage: 24, headshotMultiplier: 3, fireRate: 6, magSize: 20, reserveAmmo: 40,
    reloadTime: 1.8, range: 70, spread: 0.008, moveSpreadFactor: 4,
    recoilVertical: 0.010, recoilHorizontal: 0.006, zoomFactor: 1,
    automatic: false, side: 't', modelType: 'pistol'
  },
  p250: {
    id: 'p250', name: 'P250', category: 'pistol', price: 300,
    damage: 32, headshotMultiplier: 3, fireRate: 6, magSize: 13, reserveAmmo: 26,
    reloadTime: 1.9, range: 75, spread: 0.006, moveSpreadFactor: 4,
    recoilVertical: 0.012, recoilHorizontal: 0.006, zoomFactor: 1,
    automatic: false, side: 'any', modelType: 'pistol'
  },
  deagle: {
    id: 'deagle', name: 'Desert Eagle', category: 'pistol', price: 700,
    damage: 55, headshotMultiplier: 3.5, fireRate: 3, magSize: 7, reserveAmmo: 35,
    reloadTime: 2.2, range: 100, spread: 0.003, moveSpreadFactor: 6,
    recoilVertical: 0.04, recoilHorizontal: 0.02, zoomFactor: 1,
    automatic: false, side: 'any', modelType: 'pistol'
  },

  // ---------- 冲锋枪 ----------
  mac10: {
    id: 'mac10', name: 'MAC-10', category: 'smg', price: 1050,
    damage: 22, headshotMultiplier: 2.5, fireRate: 13, magSize: 30, reserveAmmo: 100,
    reloadTime: 2.6, range: 60, spread: 0.012, moveSpreadFactor: 2,
    recoilVertical: 0.012, recoilHorizontal: 0.012, zoomFactor: 1,
    automatic: true, side: 't', modelType: 'smg'
  },
  mp9: {
    id: 'mp9', name: 'MP9', category: 'smg', price: 1250,
    damage: 22, headshotMultiplier: 2.5, fireRate: 12, magSize: 30, reserveAmmo: 120,
    reloadTime: 2.4, range: 65, spread: 0.010, moveSpreadFactor: 2,
    recoilVertical: 0.011, recoilHorizontal: 0.010, zoomFactor: 1,
    automatic: true, side: 'ct', modelType: 'smg'
  },

  // ---------- 霰弹枪 ----------
  mag7: {
    id: 'mag7', name: 'MAG-7', category: 'shotgun', price: 1300,
    damage: 20, headshotMultiplier: 2, fireRate: 1.2, magSize: 5, reserveAmmo: 30,
    reloadTime: 2.4, range: 25, spread: 0.05, moveSpreadFactor: 3,
    recoilVertical: 0.06, recoilHorizontal: 0.02, zoomFactor: 1,
    automatic: false, side: 'ct', modelType: 'shotgun', pellets: 8
  },

  // ---------- 步枪 ----------
  ak47: {
    id: 'ak47', name: 'AK-47', category: 'rifle', price: 2700,
    damage: 36, headshotMultiplier: 4, fireRate: 9, magSize: 30, reserveAmmo: 90,
    reloadTime: 2.5, range: 120, spread: 0.004, moveSpreadFactor: 5,
    recoilVertical: 0.018, recoilHorizontal: 0.012, zoomFactor: 1,
    automatic: true, side: 't', modelType: 'rifle'
  },
  m4a4: {
    id: 'm4a4', name: 'M4A4', category: 'rifle', price: 3100,
    damage: 33, headshotMultiplier: 4, fireRate: 10, magSize: 30, reserveAmmo: 90,
    reloadTime: 3.1, range: 120, spread: 0.003, moveSpreadFactor: 5,
    recoilVertical: 0.014, recoilHorizontal: 0.010, zoomFactor: 1,
    automatic: true, side: 'ct', modelType: 'rifle'
  },

  // ---------- 狙击枪 ----------
  awp: {
    id: 'awp', name: 'AWP', category: 'sniper', price: 4750,
    damage: 115, headshotMultiplier: 1.5, fireRate: 0.9, magSize: 10, reserveAmmo: 30,
    reloadTime: 3.7, range: 200, spread: 0.0005, moveSpreadFactor: 20,
    recoilVertical: 0.08, recoilHorizontal: 0.02, zoomFactor: 2.5,
    automatic: false, side: 'any', modelType: 'sniper'
  },

  // ---------- 投掷物 ----------
  he: {
    id: 'he', name: '高爆手雷', category: 'grenade', price: 300,
    damage: 80, headshotMultiplier: 1, fireRate: 1, magSize: 1, reserveAmmo: 1,
    reloadTime: 0, range: 0, spread: 0, moveSpreadFactor: 1,
    recoilVertical: 0, recoilHorizontal: 0, zoomFactor: 1,
    automatic: false, side: 'any', modelType: 'grenade'
  },
  flashbang: {
    id: 'flashbang', name: '闪光弹', category: 'grenade', price: 200,
    damage: 0, headshotMultiplier: 1, fireRate: 1, magSize: 1, reserveAmmo: 1,
    reloadTime: 0, range: 0, spread: 0, moveSpreadFactor: 1,
    recoilVertical: 0, recoilHorizontal: 0, zoomFactor: 1,
    automatic: false, side: 'any', modelType: 'grenade'
  },
  smoke: {
    id: 'smoke', name: '烟雾弹', category: 'grenade', price: 300,
    damage: 0, headshotMultiplier: 1, fireRate: 1, magSize: 1, reserveAmmo: 1,
    reloadTime: 0, range: 0, spread: 0, moveSpreadFactor: 1,
    recoilVertical: 0, recoilHorizontal: 0, zoomFactor: 1,
    automatic: false, side: 'any', modelType: 'grenade'
  },
  molotov: {
    id: 'molotov', name: '燃烧弹', category: 'grenade', price: 400,
    damage: 40, headshotMultiplier: 1, fireRate: 1, magSize: 1, reserveAmmo: 1,
    reloadTime: 0, range: 0, spread: 0, moveSpreadFactor: 1,
    recoilVertical: 0, recoilHorizontal: 0, zoomFactor: 1,
    automatic: false, side: 'any', modelType: 'grenade'
  },

  // ---------- 近战武器 ----------
  knife: {
    id: 'knife', name: '战术匕首', category: 'melee', price: 0,
    damage: 55, headshotMultiplier: 2.5, fireRate: 2, magSize: 0, reserveAmmo: 0,
    reloadTime: 0, range: 2.5, spread: 0, moveSpreadFactor: 1,
    recoilVertical: 0, recoilHorizontal: 0, zoomFactor: 1,
    automatic: false, side: 'any', modelType: 'melee'
  },

  // ---------- 装备 ----------
  kevlar: {
    id: 'kevlar', name: '防弹背心', category: 'equipment', price: 650,
    damage: 0, headshotMultiplier: 1, fireRate: 0, magSize: 0, reserveAmmo: 0,
    reloadTime: 0, range: 0, spread: 0, moveSpreadFactor: 1,
    recoilVertical: 0, recoilHorizontal: 0, zoomFactor: 1,
    automatic: false, side: 'any', modelType: 'equipment', armor: 100
  },
  helmet: {
    id: 'helmet', name: '背心+头盔', category: 'equipment', price: 1000,
    damage: 0, headshotMultiplier: 1, fireRate: 0, magSize: 0, reserveAmmo: 0,
    reloadTime: 0, range: 0, spread: 0, moveSpreadFactor: 1,
    recoilVertical: 0, recoilHorizontal: 0, zoomFactor: 1,
    automatic: false, side: 'any', modelType: 'equipment', armor: 100, helmet: true
  },
  defuser: {
    id: 'defuser', name: '拆弹器', category: 'equipment', price: 400,
    damage: 0, headshotMultiplier: 1, fireRate: 0, magSize: 0, reserveAmmo: 0,
    reloadTime: 0, range: 0, spread: 0, moveSpreadFactor: 1,
    recoilVertical: 0, recoilHorizontal: 0, zoomFactor: 1,
    automatic: false, side: 'ct', modelType: 'equipment', defuser: true
  }
};

/**
 * 转轮购买菜单的 8 个分类（按规范要求顺序）
 */
export const BUY_CATEGORIES = [
  {
    id: 'pistols', name: '手枪', shortName: 'PISTOLS', color: '#FFAA00',
    items: ['usp', 'glock', 'p250', 'deagle']
  },
  {
    id: 'smgs', name: '冲锋枪', shortName: 'SMGS', color: '#00D4FF',
    items: ['mac10', 'mp9']
  },
  {
    id: 'shotguns', name: '霰弹枪', shortName: 'SHOTGUNS', color: '#00FF88',
    items: ['mag7']
  },
  {
    id: 'rifles', name: '步枪', shortName: 'RIFLES', color: '#FF2040',
    items: ['ak47', 'm4a4']
  },
  {
    id: 'snipers', name: '狙击枪', shortName: 'SNIPERS', color: '#AA66FF',
    items: ['awp']
  },
  {
    id: 'grenades', name: '投掷物', shortName: 'GRENADES', color: '#FF8800',
    items: ['he', 'flashbang', 'smoke', 'molotov']
  },
  {
    id: 'equipment', name: '装备', shortName: 'EQUIPMENT', color: '#AAAAAA',
    items: ['kevlar', 'helmet', 'defuser']
  },
  {
    id: 'close', name: '关闭菜单', shortName: 'CLOSE', color: '#444444',
    items: []
  }
];

/**
 * 武器实例 - 维护弹药和后坐力状态
 */
export class WeaponInstance {
  /**
   * @param {string} id 武器 ID
   */
  constructor(id) {
    this.def = WEAPONS[id];
    if (!this.def) throw new Error(`未知武器 ID: ${id}`);
    this.id = id;
    this.magAmmo = this.def.magSize;
    this.reserveAmmo = this.def.reserveAmmo;
    this.lastFireTime = 0;
    this.isReloading = false;
    this.reloadEndTime = 0;
    this.recoilPitch = 0;   // 当前累计后坐力上抬（弧度）
    this.recoilYaw = 0;     // 当前累计水平偏移
    this.recoilRecovery = 0; // 后坐力恢复速率
  }

  /**
   * 尝试开火
   * @param {number} now 当前时间（秒）
   * @param {boolean} triggerHeld 是否扣住扳机（用于自动武器）
   * @returns {boolean} 是否真正开火
   */
  tryFire(now, triggerHeld) {
    if (this.isReloading) return false;
    if (this.magAmmo <= 0) return false;

    const interval = 1 / this.def.fireRate;
    if (now - this.lastFireTime < interval) return false;

    if (!this.def.automatic && !triggerHeld) {
      // 半自动武器需要扣下瞬间触发，这里通过外部 press 标志判定
    }

    this.magAmmo--;
    this.lastFireTime = now;
    return true;
  }

  /**
   * 开始换弹
   * @param {number} now 当前时间
   * @returns {boolean} 是否成功开始
   */
  startReload(now) {
    if (this.isReloading) return false;
    if (this.magAmmo >= this.def.magSize) return false;
    if (this.reserveAmmo <= 0) return false;
    this.isReloading = true;
    this.reloadEndTime = now + this.def.reloadTime;
    return true;
  }

  /**
   * 更新换弹状态
   * @param {number} now 当前时间
   */
  update(now) {
    if (this.isReloading && now >= this.reloadEndTime) {
      const need = this.def.magSize - this.magAmmo;
      const take = Math.min(need, this.reserveAmmo);
      this.magAmmo += take;
      this.reserveAmmo -= take;
      this.isReloading = false;
    }
  }

  /**
   * 获取换弹进度（0~1）
   * @param {number} now 当前时间
   * @returns {number}
   */
  getReloadProgress(now) {
    if (!this.isReloading) return 0;
    const total = this.def.reloadTime;
    const remain = this.reloadEndTime - now;
    return Math.max(0, Math.min(1, 1 - remain / total));
  }

  /**
   * 应用一发后坐力
   * @returns {{pitch:number, yaw:number}} 这一发的后坐力增量
   */
  applyRecoil() {
    this.recoilPitch += this.def.recoilVertical;
    // 水平后坐力：随机左右
    const sign = Math.random() < 0.5 ? -1 : 1;
    const yawDelta = sign * Math.random() * this.def.recoilHorizontal;
    this.recoilYaw += yawDelta;
    return { pitch: this.def.recoilVertical, yaw: yawDelta };
  }

  /**
   * 后坐力恢复（每帧调用）
   * @param {number} delta 帧间隔
   */
  recoverRecoil(delta) {
    const recoverRate = 0.08; // 弧度/秒
    this.recoilPitch = Math.max(0, this.recoilPitch - recoverRate * delta);
    this.recoilYaw *= Math.max(0, 1 - recoverRate * delta * 2);
  }
}
