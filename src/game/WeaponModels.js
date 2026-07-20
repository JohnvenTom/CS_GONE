/**
 * WeaponModels.js - 第一人称武器视图模型构建
 * --------------------------------------------------------------
 * 为每把武器提供独特、细化的 3D 模型（基于 Three.js 基础几何体组合）
 *
 * 设计原则：
 *  - 每把武器（按 weaponId）有独立的构建函数，外观差异明显
 *  - 细化模型：包含枪身、枪管、握把、弹匣、瞄具、枪托、拉机柄、导气管等部件
 *  - 材质区分：金属枪身 / 塑料握把 / 橡胶枪托 / 发光瞄点 / 金属弹匣
 *  - 阵营色：CT 蓝色 / T 橙色，用于瞄具发光点，强化阵营识别
 *  - 坐标系：模型原点位于枪身握把前方，-Z 为枪口方向，Y 为上下
 *
 * 使用方式：
 *   import { buildWeaponModel } from './WeaponModels.js';
 *   const group = buildWeaponModel(weaponId, team);
 * --------------------------------------------------------------
 */

import * as THREE from 'three';

/**
 * 构建武器模型（根据 weaponId 分派到对应构建函数）
 * @param {string} weaponId 武器 ID（usp/glock/p250/deagle/mac10/mp9/mag7/ak47/m4a4/awp/he/flashbang/smoke/molotov/kevlar/helmet/defuser）
 * @param {string} team 阵营 'ct' | 't'（影响瞄具发光颜色）
 * @returns {THREE.Group} 武器模型组（已应用阴影设置）
 */
export function buildWeaponModel(weaponId, team) {
  const builders = {
    // 手枪
    usp: buildUSP,
    glock: buildGlock,
    p250: buildP250,
    deagle: buildDeagle,
    // 冲锋枪
    mac10: buildMAC10,
    mp9: buildMP9,
    // 霰弹枪
    mag7: buildMAG7,
    // 步枪
    ak47: buildAK47,
    m4a4: buildM4A4,
    // 狙击枪
    awp: buildAWP,
    // 投掷物
    he: buildHE,
    flashbang: buildFlashbang,
    smoke: buildSmoke,
    molotov: buildMolotov,
    // 近战
    knife: buildKnife,
    // 装备
    kevlar: buildKevlar,
    helmet: buildHelmet,
    defuser: buildDefuser
  };

  const builder = builders[weaponId];
  if (!builder) {
    // 未知武器：回退到通用手枪模型，避免崩溃
    return buildUSP(team);
  }
  const group = builder(team);
  // 应用阴影设置（第一人称武器不投射阴影，避免遮挡视野）
  group.traverse(o => {
    if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
  });
  return group;
}

/**
 * 创建材质工厂：统一管理武器各部件材质
 * @returns {Object} 材质字典
 * @private
 */
function _createMaterials(team) {
  // 阵营色（瞄具发光点）
  const accentColor = team === 'ct' ? 0x00D4FF : 0xFF5500;

  return {
    // 金属枪身（深灰，主流步枪/手枪）
    gunMetal: new THREE.MeshStandardMaterial({
      color: 0x2a2a2e, roughness: 0.35, metalness: 0.85
    }),
    // 黑色塑料（握把、枪托、弹匣外壳）
    plastic: new THREE.MeshStandardMaterial({
      color: 0x141418, roughness: 0.55, metalness: 0.2
    }),
    // 哑光橡胶（防滑纹路、握把贴片）
    rubber: new THREE.MeshStandardMaterial({
      color: 0x0a0a0c, roughness: 0.9, metalness: 0.05
    }),
    // 亮金属（枪管、拉机柄、弹匣底板）
    brightMetal: new THREE.MeshStandardMaterial({
      color: 0x4a4a52, roughness: 0.25, metalness: 0.95
    }),
    // 木纹（AK 枪托、MAG7 枪托）
    wood: new THREE.MeshStandardMaterial({
      color: 0x6b3a1a, roughness: 0.6, metalness: 0.05
    }),
    // 亮金色（Deagle 枪身）
    gold: new THREE.MeshStandardMaterial({
      color: 0xb8860b, roughness: 0.3, metalness: 0.95
    }),
    // 银色（USP 消音器、不锈钢部件）
    silver: new THREE.MeshStandardMaterial({
      color: 0x8a8a92, roughness: 0.2, metalness: 0.95
    }),
    // 阵营色发光（瞄点、战术灯）
    accent: new THREE.MeshStandardMaterial({
      color: accentColor,
      emissive: accentColor,
      emissiveIntensity: 0.6,
      roughness: 0.4, metalness: 0.3
    }),
    // 红色发光（激光指示器、T 枪口提示）
    redDot: new THREE.MeshStandardMaterial({
      color: 0xff2020,
      emissive: 0xff2020,
      emissiveIntensity: 1.0,
      roughness: 0.3
    }),
    // 玻璃（瞄准镜镜片）
    glass: new THREE.MeshStandardMaterial({
      color: 0x1a3a5a,
      transparent: true,
      opacity: 0.4,
      roughness: 0.05,
      metalness: 0.1
    }),
    // 绿色（烟雾弹、HE 标识）
    green: new THREE.MeshStandardMaterial({
      color: 0x2d5a2d, roughness: 0.6, metalness: 0.1
    }),
    // 黄色（HE 高爆弹标识）
    yellow: new THREE.MeshStandardMaterial({
      color: 0xd4a017, roughness: 0.5, metalness: 0.2
    }),
    // 白色（闪光弹标识）
    white: new THREE.MeshStandardMaterial({
      color: 0xe8e8e8, roughness: 0.4, metalness: 0.3
    }),
    // 橙红色（燃烧弹）
    fireOrange: new THREE.MeshStandardMaterial({
      color: 0xc04020, roughness: 0.5, metalness: 0.2
    }),
    // Kevlar 防弹背心色
    kevlarBlack: new THREE.MeshStandardMaterial({
      color: 0x1a1a1a, roughness: 0.7, metalness: 0.1
    })
  };
}

/**
 * 辅助：添加一个 Box 部件到组
 * @param {THREE.Group} group 目标组
 * @param {Object} opts {w, h, d, x, y, z, rx, ry, rz, mat}
 * @returns {THREE.Mesh} 创建的 mesh
 * @private
 */
function _box(group, opts) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(opts.w, opts.h, opts.d),
    opts.mat
  );
  m.position.set(opts.x || 0, opts.y || 0, opts.z || 0);
  if (opts.rx || opts.ry || opts.rz) {
    m.rotation.set(opts.rx || 0, opts.ry || 0, opts.rz || 0);
  }
  group.add(m);
  return m;
}

/**
 * 辅助：添加一个 Cylinder 部件到组
 * @param {THREE.Group} group 目标组
 * @param {Object} opts {rt, rb, h, x, y, z, rx, ry, rz, mat, seg}
 * @returns {THREE.Mesh} 创建的 mesh
 * @private
 */
function _cyl(group, opts) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(opts.rt, opts.rb, opts.h, opts.seg || 12),
    opts.mat
  );
  m.position.set(opts.x || 0, opts.y || 0, opts.z || 0);
  if (opts.rx || opts.ry || opts.rz) {
    m.rotation.set(opts.rx || 0, opts.ry || 0, opts.rz || 0);
  }
  group.add(m);
  return m;
}

/**
 * 辅助：添加一个 Sphere 部件到组
 * @param {THREE.Group} group 目标组
 * @param {Object} opts {r, x, y, z, mat, seg}
 * @returns {THREE.Mesh} 创建的 mesh
 * @private
 */
function _sphere(group, opts) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(opts.r, opts.seg || 12, opts.seg || 12),
    opts.mat
  );
  m.position.set(opts.x || 0, opts.y || 0, opts.z || 0);
  group.add(m);
  return m;
}

// ====================================================================
// 手枪 Handguns
// ====================================================================

/**
 * USP-S 战术手枪（CT 起手枪）
 * 特征：长消音器、紧凑滑套、战术握把
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildUSP(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 滑套（顶部）
  _box(g, { w: 0.07, h: 0.08, d: 0.32, x: 0, y: 0.04, z: -0.08, mat: M.gunMetal });
  // 滑套防滑纹路（横向凹槽）
  for (let i = 0; i < 4; i++) {
    _box(g, { w: 0.072, h: 0.015, d: 0.015, x: 0, y: 0.075, z: -0.05 + i * 0.025, mat: M.rubber });
  }
  // 枪管（前端，从滑套伸出）
  _cyl(g, { rt: 0.018, rb: 0.018, h: 0.08, x: 0, y: 0.04, z: -0.27, rx: Math.PI / 2, mat: M.brightMetal });
  // 消音器（标志性长筒）
  _cyl(g, { rt: 0.025, rb: 0.028, h: 0.22, x: 0, y: 0.04, z: -0.4, rx: Math.PI / 2, mat: M.silver });
  // 消音器纹理环
  for (let i = 0; i < 3; i++) {
    _cyl(g, { rt: 0.029, rb: 0.029, h: 0.008, x: 0, y: 0.04, z: -0.35 - i * 0.05, rx: Math.PI / 2, mat: M.brightMetal });
  }
  // 握把（倾斜）
  _box(g, { w: 0.07, h: 0.2, d: 0.09, x: 0, y: -0.1, z: 0.04, rx: -0.2, mat: M.plastic });
  // 握把防滑贴片
  _box(g, { w: 0.005, h: 0.14, d: 0.07, x: 0.036, y: -0.1, z: 0.04, rx: -0.2, mat: M.rubber });
  _box(g, { w: 0.005, h: 0.14, d: 0.07, x: -0.036, y: -0.1, z: 0.04, rx: -0.2, mat: M.rubber });
  // 扳机护圈
  _cyl(g, { rt: 0.012, rb: 0.012, h: 0.06, x: 0, y: -0.05, z: 0.02, rx: Math.PI / 2, mat: M.plastic });
  // 准星（发光瞄点）
  _box(g, { w: 0.015, h: 0.025, d: 0.015, x: 0, y: 0.11, z: -0.18, mat: M.accent });
  // 照门
  _box(g, { w: 0.04, h: 0.02, d: 0.012, x: 0, y: 0.1, z: 0.02, mat: M.gunMetal });
  return g;
}

/**
 * Glock-18（T 起手枪）
 * 特征：方形滑套、塑料握把、无外部击锤、短枪管
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildGlock(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 方形滑套（Glock 标志性外观）
  _box(g, { w: 0.075, h: 0.075, d: 0.3, x: 0, y: 0.04, z: -0.07, mat: M.plastic });
  // 滑套顶部纹路
  _box(g, { w: 0.04, h: 0.005, d: 0.2, x: 0, y: 0.078, z: -0.05, mat: M.gunMetal });
  // 枪管（短，略伸出滑套）
  _cyl(g, { rt: 0.016, rb: 0.016, h: 0.06, x: 0, y: 0.04, z: -0.24, rx: Math.PI / 2, mat: M.brightMetal });
  // 握把（Glock 一体化聚合物握把，角度较直）
  _box(g, { w: 0.065, h: 0.21, d: 0.085, x: 0, y: -0.105, z: 0.05, rx: -0.15, mat: M.plastic });
  // 握把防滑纹（垂直条纹）
  for (let i = 0; i < 5; i++) {
    _box(g, { w: 0.067, h: 0.005, d: 0.07, x: 0, y: -0.05 - i * 0.035, z: 0.05, rx: -0.15, mat: M.rubber });
  }
  // 扳机护圈
  _cyl(g, { rt: 0.011, rb: 0.011, h: 0.055, x: 0, y: -0.05, z: 0.02, rx: Math.PI / 2, mat: M.plastic });
  // 准星
  _box(g, { w: 0.014, h: 0.022, d: 0.014, x: 0, y: 0.098, z: -0.2, mat: M.white });
  // 照门
  _box(g, { w: 0.038, h: 0.018, d: 0.01, x: 0, y: 0.09, z: 0.04, mat: M.plastic });
  return g;
}

/**
 * P250 紧凑手枪
 * 特征：短粗滑套、紧凑握把、不锈钢枪管
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildP250(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 短粗滑套
  _box(g, { w: 0.072, h: 0.085, d: 0.24, x: 0, y: 0.04, z: -0.04, mat: M.gunMetal });
  // 滑套前后防滑槽
  for (let i = 0; i < 3; i++) {
    _box(g, { w: 0.074, h: 0.012, d: 0.012, x: 0, y: 0.078, z: 0.02 - i * 0.02, mat: M.rubber });
  }
  // 枪管（短）
  _cyl(g, { rt: 0.017, rb: 0.017, h: 0.05, x: 0, y: 0.04, z: -0.18, rx: Math.PI / 2, mat: M.brightMetal });
  // 紧凑握把（P250 比 USP 短粗）
  _box(g, { w: 0.072, h: 0.18, d: 0.09, x: 0, y: -0.09, z: 0.05, rx: -0.18, mat: M.plastic });
  // 握把侧面贴片
  _box(g, { w: 0.004, h: 0.12, d: 0.075, x: 0.038, y: -0.09, z: 0.05, rx: -0.18, mat: M.rubber });
  _box(g, { w: 0.004, h: 0.12, d: 0.075, x: -0.038, y: -0.09, z: 0.05, rx: -0.18, mat: M.rubber });
  // 扳机护圈
  _cyl(g, { rt: 0.011, rb: 0.011, h: 0.055, x: 0, y: -0.04, z: 0.02, rx: Math.PI / 2, mat: M.plastic });
  // 准星
  _box(g, { w: 0.014, h: 0.022, d: 0.014, x: 0, y: 0.108, z: -0.14, mat: M.accent });
  // 照门
  _box(g, { w: 0.036, h: 0.018, d: 0.01, x: 0, y: 0.1, z: 0.06, mat: M.gunMetal });
  return g;
}

/**
 * Desert Eagle 沙漠之鹰
 * 特征：金色枪身、大尺寸、三角形枪口、大弹匣
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildDeagle(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 标志性金色滑套（大尺寸）
  _box(g, { w: 0.085, h: 0.1, d: 0.36, x: 0, y: 0.05, z: -0.1, mat: M.gold });
  // 滑套顶部棱线（Deagle 标志性三角棱）
  _box(g, { w: 0.02, h: 0.015, d: 0.34, x: 0, y: 0.105, z: -0.1, mat: M.gold });
  // 滑套侧面纹饰
  _box(g, { w: 0.003, h: 0.05, d: 0.2, x: 0.044, y: 0.05, z: -0.1, mat: M.brightMetal });
  _box(g, { w: 0.003, h: 0.05, d: 0.2, x: -0.044, y: 0.05, z: -0.1, mat: M.brightMetal });
  // 枪管（粗，三角形外观）
  _cyl(g, { rt: 0.022, rb: 0.026, h: 0.1, x: 0, y: 0.05, z: -0.31, rx: Math.PI / 2, mat: M.gold });
  // 枪口
  _cyl(g, { rt: 0.015, rb: 0.018, h: 0.02, x: 0, y: 0.05, z: -0.36, rx: Math.PI / 2, mat: M.brightMetal });
  // 大尺寸握把
  _box(g, { w: 0.08, h: 0.22, d: 0.1, x: 0, y: -0.11, z: 0.04, rx: -0.2, mat: M.plastic });
  // 握把金色装饰
  _box(g, { w: 0.082, h: 0.02, d: 0.1, x: 0, y: -0.02, z: 0.04, rx: -0.2, mat: M.gold });
  _box(g, { w: 0.082, h: 0.02, d: 0.1, x: 0, y: -0.2, z: 0.04, rx: -0.2, mat: M.gold });
  // 扳机护圈
  _cyl(g, { rt: 0.014, rb: 0.014, h: 0.07, x: 0, y: -0.05, z: 0.02, rx: Math.PI / 2, mat: M.gold });
  // 鸭嘴形扳机
  _box(g, { w: 0.02, h: 0.025, d: 0.015, x: 0, y: -0.05, z: 0.04, mat: M.gold });
  // 准星（高耸）
  _box(g, { w: 0.016, h: 0.035, d: 0.016, x: 0, y: 0.13, z: -0.22, mat: M.redDot });
  // 照门
  _box(g, { w: 0.045, h: 0.025, d: 0.012, x: 0, y: 0.12, z: 0.04, mat: M.gold });
  return g;
}

// ====================================================================
// 冲锋枪 SMG
// ====================================================================

/**
 * MAC-10（T 冲锋枪）
 * 特征：极短枪身、方盒子机匣、大弹匣、无枪托、外露枪栓
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildMAC10(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 方形机匣（MAC-10 标志性方盒）
  _box(g, { w: 0.08, h: 0.12, d: 0.28, x: 0, y: 0.03, z: -0.08, mat: M.plastic });
  // 机匣顶部外露枪栓拉机柄
  _box(g, { w: 0.04, h: 0.025, d: 0.08, x: 0, y: 0.1, z: -0.05, mat: M.brightMetal });
  // 枪管（极短）
  _cyl(g, { rt: 0.014, rb: 0.014, h: 0.1, x: 0, y: 0.03, z: -0.25, rx: Math.PI / 2, mat: M.brightMetal });
  // 枪口螺纹（消音器接口）
  _cyl(g, { rt: 0.018, rb: 0.018, h: 0.04, x: 0, y: 0.03, z: -0.31, rx: Math.PI / 2, mat: M.gunMetal });
  // 大弹匣（MAC-10 标志性长弹匣）
  _box(g, { w: 0.055, h: 0.25, d: 0.07, x: 0, y: -0.18, z: -0.02, mat: M.plastic });
  // 弹匣底板
  _box(g, { w: 0.06, h: 0.02, d: 0.075, x: 0, y: -0.3, z: -0.02, mat: M.brightMetal });
  // 握把（小握把）
  _box(g, { w: 0.06, h: 0.14, d: 0.07, x: 0, y: -0.08, z: 0.1, rx: -0.15, mat: M.plastic });
  // 扳机护圈
  _cyl(g, { rt: 0.012, rb: 0.012, h: 0.05, x: 0, y: -0.04, z: 0.05, rx: Math.PI / 2, mat: M.plastic });
  // 战术带（连接机匣后端到握把）
  _cyl(g, { rt: 0.005, rb: 0.005, h: 0.12, x: 0, y: -0.02, z: 0.08, rx: -0.5, mat: M.rubber });
  // 简易瞄具
  _box(g, { w: 0.01, h: 0.02, d: 0.01, x: 0, y: 0.1, z: -0.18, mat: M.accent });
  return g;
}

/**
 * MP9（CT 冲锋枪）
 * 特征：紧凑枪身、折叠枪托、聚合物外壳、战术导轨
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildMP9(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 机匣（聚合物外壳）
  _box(g, { w: 0.075, h: 0.13, d: 0.32, x: 0, y: 0.03, z: -0.1, mat: M.plastic });
  // 顶部战术导轨
  _box(g, { w: 0.05, h: 0.018, d: 0.28, x: 0, y: 0.105, z: -0.08, mat: M.brightMetal });
  // 导轨横纹
  for (let i = 0; i < 5; i++) {
    _box(g, { w: 0.052, h: 0.005, d: 0.008, x: 0, y: 0.115, z: -0.2 + i * 0.06, mat: M.gunMetal });
  }
  // 枪管
  _cyl(g, { rt: 0.016, rb: 0.016, h: 0.18, x: 0, y: 0.03, z: -0.3, rx: Math.PI / 2, mat: M.brightMetal });
  // 枪口消焰器
  _cyl(g, { rt: 0.022, rb: 0.022, h: 0.05, x: 0, y: 0.03, z: -0.4, rx: Math.PI / 2, mat: M.gunMetal });
  // 弹匣（弯曲，MP9 标志性弯弹匣）
  _box(g, { w: 0.055, h: 0.22, d: 0.065, x: 0, y: -0.16, z: -0.04, rx: -0.1, mat: M.plastic });
  // 弹匣弯曲段
  _box(g, { w: 0.055, h: 0.06, d: 0.065, x: 0, y: -0.27, z: 0.0, rx: -0.5, mat: M.plastic });
  // 握把
  _box(g, { w: 0.06, h: 0.16, d: 0.07, x: 0, y: -0.09, z: 0.08, rx: -0.18, mat: M.plastic });
  // 握把防滑纹
  for (let i = 0; i < 4; i++) {
    _box(g, { w: 0.062, h: 0.005, d: 0.065, x: 0, y: -0.03 - i * 0.035, z: 0.08, rx: -0.18, mat: M.rubber });
  }
  // 折叠枪托（向后展开状态）
  _box(g, { w: 0.05, h: 0.04, d: 0.18, x: 0, y: 0.05, z: 0.18, mat: M.plastic });
  _box(g, { w: 0.04, h: 0.06, d: 0.04, x: 0, y: -0.01, z: 0.27, mat: M.rubber });
  // 扳机护圈
  _cyl(g, { rt: 0.011, rb: 0.011, h: 0.05, x: 0, y: -0.04, z: 0.04, rx: Math.PI / 2, mat: M.plastic });
  // 红点瞄具
  _box(g, { w: 0.03, h: 0.025, d: 0.04, x: 0, y: 0.13, z: -0.05, mat: M.gunMetal });
  _sphere(g, { r: 0.006, x: 0, y: 0.13, z: -0.07, mat: M.redDot });
  return g;
}

// ====================================================================
// 霰弹枪 Shotgun
// ====================================================================

/**
 * MAG-7（CT 霰弹枪）
 * 特征：短枪身、方盒子机匣、弹仓式供弹、木质握把
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildMAG7(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 方形机匣
  _box(g, { w: 0.09, h: 0.13, d: 0.35, x: 0, y: 0.04, z: -0.1, mat: M.gunMetal });
  // 双管（MAG-7 短粗枪管）
  _cyl(g, { rt: 0.024, rb: 0.028, h: 0.32, x: 0, y: 0.06, z: -0.32, rx: Math.PI / 2, mat: M.brightMetal });
  // 枪口
  _cyl(g, { rt: 0.028, rb: 0.03, h: 0.02, x: 0, y: 0.06, z: -0.48, rx: Math.PI / 2, mat: M.brightMetal });
  // 弹仓（管状，位于枪管下方）
  _cyl(g, { rt: 0.018, rb: 0.018, h: 0.28, x: 0, y: -0.02, z: -0.3, rx: Math.PI / 2, mat: M.brightMetal });
  // 护木（枪管下方木质）
  _box(g, { w: 0.06, h: 0.04, d: 0.22, x: 0, y: 0.0, z: -0.28, mat: M.wood });
  // 木质握把
  _box(g, { w: 0.06, h: 0.18, d: 0.08, x: 0, y: -0.09, z: 0.06, rx: -0.2, mat: M.wood });
  // 木质枪托
  _box(g, { w: 0.06, h: 0.1, d: 0.2, x: 0, y: -0.02, z: 0.2, mat: M.wood });
  // 枪托底板
  _box(g, { w: 0.065, h: 0.12, d: 0.015, x: 0, y: -0.02, z: 0.3, mat: M.rubber });
  // 扳机护圈
  _cyl(g, { rt: 0.013, rb: 0.013, h: 0.06, x: 0, y: -0.05, z: 0.02, rx: Math.PI / 2, mat: M.gunMetal });
  // 顶部瞄具导轨
  _box(g, { w: 0.04, h: 0.015, d: 0.25, x: 0, y: 0.115, z: -0.1, mat: M.brightMetal });
  // 准星
  _box(g, { w: 0.014, h: 0.025, d: 0.014, x: 0, y: 0.135, z: -0.3, mat: M.accent });
  return g;
}

// ====================================================================
// 步枪 Rifles
// ====================================================================

/**
 * AK-47（T 标志步枪）
 * 特征：木质枪托/护木、弧形弹匣、气体导气管、斜切口枪口
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildAK47(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 机匣（金属，AK 标志性造型）
  _box(g, { w: 0.075, h: 0.13, d: 0.32, x: 0, y: 0.03, z: -0.1, mat: M.gunMetal });
  // 机匣顶部防尘盖
  _box(g, { w: 0.065, h: 0.025, d: 0.3, x: 0, y: 0.105, z: -0.1, mat: M.gunMetal });
  // 枪管
  _cyl(g, { rt: 0.014, rb: 0.014, h: 0.42, x: 0, y: 0.04, z: -0.35, rx: Math.PI / 2, mat: M.brightMetal });
  // 气体导气管（AK 标志性部件，枪管上方）
  _cyl(g, { rt: 0.012, rb: 0.012, h: 0.3, x: 0, y: 0.08, z: -0.3, rx: Math.PI / 2, mat: M.gunMetal });
  // 准星座（前准星）
  _box(g, { w: 0.025, h: 0.04, d: 0.03, x: 0, y: 0.085, z: -0.5, mat: M.gunMetal });
  // 斜切口枪口制退器（AK 标志性）
  _cyl(g, { rt: 0.018, rb: 0.018, h: 0.04, x: 0, y: 0.04, z: -0.57, rx: Math.PI / 2, mat: M.brightMetal });
  // 弧形弹匣（AK 标志性香蕉弹匣）
  _box(g, { w: 0.055, h: 0.04, d: 0.07, x: 0, y: -0.08, z: -0.05, mat: M.plastic });
  _box(g, { w: 0.055, h: 0.04, d: 0.07, x: 0, y: -0.11, z: -0.02, mat: M.plastic });
  _box(g, { w: 0.055, h: 0.04, d: 0.07, x: 0, y: -0.14, z: 0.01, mat: M.plastic });
  _box(g, { w: 0.055, h: 0.04, d: 0.07, x: 0, y: -0.17, z: 0.04, mat: M.plastic });
  // 弹匣底板
  _box(g, { w: 0.06, h: 0.015, d: 0.075, x: 0, y: -0.19, z: 0.05, mat: M.brightMetal });
  // 木质护木（枪管下方）
  _box(g, { w: 0.06, h: 0.04, d: 0.22, x: 0, y: -0.01, z: -0.32, mat: M.wood });
  // 木质握把
  _box(g, { w: 0.055, h: 0.18, d: 0.07, x: 0, y: -0.1, z: 0.08, rx: -0.25, mat: M.wood });
  // 木质枪托
  _box(g, { w: 0.055, h: 0.1, d: 0.25, x: 0, y: -0.04, z: 0.22, mat: M.wood });
  // 枪托底板
  _box(g, { w: 0.06, h: 0.12, d: 0.015, x: 0, y: -0.04, z: 0.35, mat: M.rubber });
  // 拉机柄（AK 右侧大拉机柄）
  _box(g, { w: 0.05, h: 0.025, d: 0.025, x: 0.045, y: 0.08, z: -0.18, mat: M.brightMetal });
  // 照门（AK 标志性缺口照门）
  _box(g, { w: 0.04, h: 0.03, d: 0.02, x: 0, y: 0.115, z: -0.02, mat: M.gunMetal });
  return g;
}

/**
 * M4A4（CT 标志步枪）
 * 特征：全黑聚合物外观、直弹匣、战术导轨、消焰器
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildM4A4(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 机匣（哑光黑）
  _box(g, { w: 0.075, h: 0.13, d: 0.34, x: 0, y: 0.03, z: -0.1, mat: M.plastic });
  // 顶部战术导轨（M4 全长导轨）
  _box(g, { w: 0.05, h: 0.022, d: 0.38, x: 0, y: 0.105, z: -0.1, mat: M.brightMetal });
  // 导轨横纹
  for (let i = 0; i < 7; i++) {
    _box(g, { w: 0.052, h: 0.005, d: 0.008, x: 0, y: 0.115, z: -0.28 + i * 0.05, mat: M.gunMetal });
  }
  // 枪管
  _cyl(g, { rt: 0.014, rb: 0.014, h: 0.4, x: 0, y: 0.04, z: -0.35, rx: Math.PI / 2, mat: M.brightMetal });
  // 鸟笼式消焰器（M4 标志性）
  _cyl(g, { rt: 0.02, rb: 0.02, h: 0.07, x: 0, y: 0.04, z: -0.56, rx: Math.PI / 2, mat: M.brightMetal });
  // 消焰器槽
  for (let i = 0; i < 4; i++) {
    _box(g, { w: 0.005, h: 0.02, d: 0.06, x: Math.cos(i * Math.PI / 2) * 0.02, y: 0.04 + Math.sin(i * Math.PI / 2) * 0.02, z: -0.56, mat: M.gunMetal });
  }
  // 直弹匣（M4 直弹匣，对比 AK 弧形）
  _box(g, { w: 0.055, h: 0.22, d: 0.065, x: 0, y: -0.16, z: -0.02, mat: M.plastic });
  // 弹匣底板
  _box(g, { w: 0.06, h: 0.015, d: 0.07, x: 0, y: -0.27, z: -0.02, mat: M.brightMetal });
  // 战术护木（聚合物，带散热孔）
  _box(g, { w: 0.07, h: 0.06, d: 0.25, x: 0, y: 0.0, z: -0.32, mat: M.plastic });
  // 散热孔
  for (let i = 0; i < 3; i++) {
    _cyl(g, { rt: 0.008, rb: 0.008, h: 0.07, x: 0, y: 0.0, z: -0.38 + i * 0.06, rx: Math.PI / 2, ry: Math.PI / 2, mat: M.gunMetal });
  }
  // 握把（M4 标志性直角握把）
  _box(g, { w: 0.055, h: 0.18, d: 0.07, x: 0, y: -0.1, z: 0.08, rx: -0.1, mat: M.plastic });
  // 握把防滑纹
  for (let i = 0; i < 5; i++) {
    _box(g, { w: 0.057, h: 0.005, d: 0.065, x: 0, y: -0.03 - i * 0.035, z: 0.08, rx: -0.1, mat: M.rubber });
  }
  // 可伸缩枪托（M4 标志性 6 段枪托）
  _box(g, { w: 0.05, h: 0.08, d: 0.08, x: 0, y: 0.05, z: 0.16, mat: M.plastic });
  // 枪托连接杆
  _box(g, { w: 0.025, h: 0.025, d: 0.14, x: 0, y: 0.07, z: 0.22, mat: M.brightMetal });
  _box(g, { w: 0.025, h: 0.025, d: 0.14, x: 0, y: 0.03, z: 0.22, mat: M.brightMetal });
  // 枪托底板
  _box(g, { w: 0.065, h: 0.1, d: 0.02, x: 0, y: 0.05, z: 0.3, mat: M.rubber });
  // 拉机柄（M4 后置 T 形拉机柄）
  _box(g, { w: 0.05, h: 0.02, d: 0.04, x: 0, y: 0.11, z: 0.06, mat: M.brightMetal });
  // 红点瞄准镜
  _box(g, { w: 0.04, h: 0.05, d: 0.1, x: 0, y: 0.155, z: -0.05, mat: M.gunMetal });
  _sphere(g, { r: 0.012, x: 0, y: 0.155, z: -0.1, mat: M.glass });
  _sphere(g, { r: 0.004, x: 0, y: 0.155, z: -0.105, mat: M.redDot });
  // 战术灯
  _box(g, { w: 0.025, h: 0.025, d: 0.06, x: 0.045, y: -0.01, z: -0.35, mat: M.gunMetal });
  _sphere(g, { r: 0.012, x: 0.045, y: -0.01, z: -0.38, mat: M.accent });
  return g;
}

// ====================================================================
// 狙击枪 Sniper
// ====================================================================

/**
 * AWP 狙击枪
 * 特征：长枪管、大型瞄准镜、木/聚合物枪身、两脚架、枪口制退器
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildAWP(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 长机匣
  _box(g, { w: 0.075, h: 0.13, d: 0.4, x: 0, y: 0.03, z: -0.15, mat: M.gunMetal });
  // 顶部防尘盖
  _box(g, { w: 0.065, h: 0.025, d: 0.38, x: 0, y: 0.105, z: -0.15, mat: M.gunMetal });
  // 超长枪管（AWP 标志性）
  _cyl(g, { rt: 0.016, rb: 0.016, h: 0.6, x: 0, y: 0.04, z: -0.5, rx: Math.PI / 2, mat: M.brightMetal });
  // 枪口制退器
  _cyl(g, { rt: 0.026, rb: 0.026, h: 0.1, x: 0, y: 0.04, z: -0.8, rx: Math.PI / 2, mat: M.gunMetal });
  // 制退器排气孔
  for (let i = 0; i < 3; i++) {
    _cyl(g, { rt: 0.006, rb: 0.006, h: 0.05, x: 0.026, y: 0.04, z: -0.78 - i * 0.025, ry: Math.PI / 2, mat: M.brightMetal });
  }
  // 大型瞄准镜（AWP 核心）
  _cyl(g, { rt: 0.035, rb: 0.035, h: 0.28, x: 0, y: 0.18, z: -0.15, rx: Math.PI / 2, mat: M.gunMetal });
  // 镜头前端
  _cyl(g, { rt: 0.042, rb: 0.035, h: 0.04, x: 0, y: 0.18, z: -0.31, rx: Math.PI / 2, mat: M.brightMetal });
  // 镜头后端
  _cyl(g, { rt: 0.042, rb: 0.035, h: 0.04, x: 0, y: 0.18, z: 0.0, rx: Math.PI / 2, mat: M.brightMetal });
  // 镜片（前端）
  _cyl(g, { rt: 0.032, rb: 0.032, h: 0.005, x: 0, y: 0.18, z: -0.29, rx: Math.PI / 2, mat: M.glass });
  // 镜片（后端）
  _cyl(g, { rt: 0.032, rb: 0.032, h: 0.005, x: 0, y: 0.18, z: -0.02, rx: Math.PI / 2, mat: M.glass });
  // 十字准线（瞄准镜内部）
  _box(g, { w: 0.04, h: 0.001, d: 0.001, x: 0, y: 0.18, z: -0.15, mat: M.redDot });
  _box(g, { w: 0.001, h: 0.04, d: 0.001, x: 0, y: 0.18, z: -0.15, mat: M.redDot });
  // 瞄准镜支架
  _box(g, { w: 0.025, h: 0.05, d: 0.02, x: 0, y: 0.14, z: -0.25, mat: M.gunMetal });
  _box(g, { w: 0.025, h: 0.05, d: 0.02, x: 0, y: 0.14, z: -0.05, mat: M.gunMetal });
  // 弹匣（短小）
  _box(g, { w: 0.05, h: 0.1, d: 0.06, x: 0, y: -0.1, z: -0.05, mat: M.plastic });
  // 握把
  _box(g, { w: 0.055, h: 0.18, d: 0.07, x: 0, y: -0.1, z: 0.08, rx: -0.2, mat: M.plastic });
  // 木质枪托（AWP 经典橄榄色木质）
  _box(g, { w: 0.07, h: 0.13, d: 0.28, x: 0, y: -0.04, z: 0.22, mat: M.wood });
  // 枪托拇指孔
  _cyl(g, { rt: 0.018, rb: 0.018, h: 0.07, x: 0.04, y: -0.02, z: 0.32, ry: Math.PI / 2, mat: M.rubber });
  // 枪托底板（厚橡胶后坐缓冲）
  _box(g, { w: 0.075, h: 0.14, d: 0.025, x: 0, y: -0.04, z: 0.36, mat: M.rubber });
  // 扳机护圈
  _cyl(g, { rt: 0.013, rb: 0.013, h: 0.06, x: 0, y: -0.05, z: 0.02, rx: Math.PI / 2, mat: M.gunMetal });
  // 两脚架（折叠状态）
  _cyl(g, { rt: 0.005, rb: 0.005, h: 0.1, x: 0.03, y: -0.08, z: -0.45, rx: 0.3, mat: M.brightMetal });
  _cyl(g, { rt: 0.005, rb: 0.005, h: 0.1, x: -0.03, y: -0.08, z: -0.45, rx: 0.3, mat: M.brightMetal });
  return g;
}

// ====================================================================
// 投掷物 Grenades
// ====================================================================

/**
 * HE 高爆手雷
 * 特征：橄榄绿色、菱形纹路、顶部引信
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildHE(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 主体（椭圆形）
  _sphere(g, { r: 0.06, x: 0, y: 0, z: 0, mat: M.green, seg: 16 });
  _sphere(g, { r: 0.06, x: 0, y: -0.01, z: 0, mat: M.green, seg: 16 });
  // 顶部引信座
  _cyl(g, { rt: 0.018, rb: 0.02, h: 0.025, x: 0, y: 0.065, z: 0, mat: M.brightMetal });
  // 引信拉环
  _cyl(g, { rt: 0.008, rb: 0.008, h: 0.02, x: 0, y: 0.09, z: 0, mat: M.brightMetal });
  // 拉环
  _cyl(g, { rt: 0.015, rb: 0.015, h: 0.003, x: 0, y: 0.105, z: 0, mat: M.brightMetal });
  // 菱形纹路（标识 HE）
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    _box(g, { w: 0.008, h: 0.02, d: 0.008, x: Math.cos(a) * 0.055, y: 0, z: Math.sin(a) * 0.055, mat: M.yellow });
  }
  return g;
}

/**
 * 闪光弹
 * 特征：白色、平滑表面、顶部引信
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildFlashbang(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 主体（圆柱形）
  _cyl(g, { rt: 0.045, rb: 0.045, h: 0.11, x: 0, y: 0, z: 0, mat: M.white });
  // 顶部引信座
  _cyl(g, { rt: 0.022, rb: 0.025, h: 0.025, x: 0, y: 0.07, z: 0, mat: M.brightMetal });
  // 引信
  _cyl(g, { rt: 0.008, rb: 0.008, h: 0.025, x: 0, y: 0.095, z: 0, mat: M.brightMetal });
  // 拉环
  _cyl(g, { rt: 0.018, rb: 0.018, h: 0.003, x: 0, y: 0.11, z: 0, mat: M.brightMetal });
  // 标识带（红色）
  _cyl(g, { rt: 0.046, rb: 0.046, h: 0.015, x: 0, y: 0.0, z: 0, mat: M.redDot });
  // 底部
  _cyl(g, { rt: 0.045, rb: 0.045, h: 0.01, x: 0, y: -0.06, z: 0, mat: M.brightMetal });
  return g;
}

/**
 * 烟雾弹
 * 特征：深绿色、圆柱形、标识带
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildSmoke(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 主体
  _cyl(g, { rt: 0.045, rb: 0.045, h: 0.12, x: 0, y: 0, z: 0, mat: M.green });
  // 顶部引信座
  _cyl(g, { rt: 0.022, rb: 0.025, h: 0.025, x: 0, y: 0.075, z: 0, mat: M.brightMetal });
  // 引信
  _cyl(g, { rt: 0.008, rb: 0.008, h: 0.025, x: 0, y: 0.1, z: 0, mat: M.brightMetal });
  // 拉环
  _cyl(g, { rt: 0.018, rb: 0.018, h: 0.003, x: 0, y: 0.115, z: 0, mat: M.brightMetal });
  // 标识带（白色）
  _cyl(g, { rt: 0.046, rb: 0.046, h: 0.012, x: 0, y: 0.02, z: 0, mat: M.white });
  // 烟雾标识（S 字样，简化为圆点）
  _sphere(g, { r: 0.012, x: 0, y: 0.02, z: 0.046, mat: M.white, seg: 8 });
  return g;
}

/**
 * 燃烧弹
 * 特征：橙红色、瓶身造型、布条引信
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildMolotov(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 瓶身（圆柱）
  _cyl(g, { rt: 0.04, rb: 0.045, h: 0.12, x: 0, y: 0, z: 0, mat: M.fireOrange });
  // 瓶颈
  _cyl(g, { rt: 0.018, rb: 0.028, h: 0.03, x: 0, y: 0.075, z: 0, mat: M.fireOrange });
  // 瓶盖
  _cyl(g, { rt: 0.018, rb: 0.018, h: 0.015, x: 0, y: 0.1, z: 0, mat: M.brightMetal });
  // 布条引信（从瓶口伸出）
  _cyl(g, { rt: 0.005, rb: 0.005, h: 0.05, x: 0, y: 0.13, z: 0, rx: 0.1, mat: M.rubber });
  // 燃料液面（深色）
  _cyl(g, { rt: 0.039, rb: 0.039, h: 0.005, x: 0, y: 0.04, z: 0, mat: M.redDot });
  // 瓶底
  _cyl(g, { rt: 0.045, rb: 0.045, h: 0.005, x: 0, y: -0.06, z: 0, mat: M.brightMetal });
  return g;
}

// ====================================================================
// 装备 Equipment
// ====================================================================

/**
 * 防弹背心
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildKevlar(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 背心主体
  _box(g, { w: 0.22, h: 0.28, d: 0.06, x: 0, y: 0, z: 0, mat: M.kevlarBlack });
  // 肩带
  _box(g, { w: 0.05, h: 0.08, d: 0.06, x: -0.08, y: 0.16, z: 0, mat: M.kevlarBlack });
  _box(g, { w: 0.05, h: 0.08, d: 0.06, x: 0.08, y: 0.16, z: 0, mat: M.kevlarBlack });
  // 腰带
  _box(g, { w: 0.22, h: 0.04, d: 0.065, x: 0, y: -0.12, z: 0, mat: M.brightMetal });
  // 标识（阵营色）
  _box(g, { w: 0.04, h: 0.04, d: 0.002, x: 0, y: 0.05, z: 0.03, mat: M.accent });
  return g;
}

/**
 * 背心+头盔
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildHelmet(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 背心（同 Kevlar）
  _box(g, { w: 0.22, h: 0.28, d: 0.06, x: 0, y: 0, z: 0, mat: M.kevlarBlack });
  _box(g, { w: 0.05, h: 0.08, d: 0.06, x: -0.08, y: 0.16, z: 0, mat: M.kevlarBlack });
  _box(g, { w: 0.05, h: 0.08, d: 0.06, x: 0.08, y: 0.16, z: 0, mat: M.kevlarBlack });
  _box(g, { w: 0.22, h: 0.04, d: 0.065, x: 0, y: -0.12, z: 0, mat: M.brightMetal });

  // 头盔（半球形）
  _sphere(g, { r: 0.08, x: 0, y: 0.28, z: 0, mat: M.kevlarBlack, seg: 16 });
  // 头盔顶部凸起
  _sphere(g, { r: 0.02, x: 0, y: 0.35, z: 0, mat: M.brightMetal, seg: 8 });
  // 头盔下缘（护颈）
  _cyl(g, { rt: 0.08, rb: 0.09, h: 0.03, x: 0, y: 0.22, z: 0, mat: M.kevlarBlack });
  // 标识
  _box(g, { w: 0.04, h: 0.04, d: 0.002, x: 0, y: 0.05, z: 0.03, mat: M.accent });
  return g;
}

/**
 * 拆弹器
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildDefuser(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // 主体（小型工具箱）
  _box(g, { w: 0.14, h: 0.1, d: 0.05, x: 0, y: 0, z: 0, mat: M.brightMetal });
  // 显示屏
  _box(g, { w: 0.1, h: 0.05, d: 0.002, x: 0, y: 0.02, z: 0.026, mat: M.glass });
  // 显示屏亮光（绿色）
  _box(g, { w: 0.08, h: 0.03, d: 0.001, x: 0, y: 0.02, z: 0.028, mat: M.green });
  // 按钮
  _sphere(g, { r: 0.008, x: -0.04, y: -0.03, z: 0.026, mat: M.redDot, seg: 8 });
  _sphere(g, { r: 0.008, x: 0.04, y: -0.03, z: 0.026, mat: M.accent, seg: 8 });
  // 钳子（剪线工具）
  _box(g, { w: 0.015, h: 0.08, d: 0.02, x: 0.075, y: 0.04, z: 0, mat: M.brightMetal });
  _cyl(g, { rt: 0.008, rb: 0.008, h: 0.04, x: 0.075, y: 0.085, z: 0, mat: M.brightMetal });
  // 挂钩
  _cyl(g, { rt: 0.005, rb: 0.005, h: 0.04, x: -0.07, y: 0.05, z: 0, ry: Math.PI / 2, mat: M.brightMetal });
  return g;
}

// ====================================================================
// 近战武器 Melee
// ====================================================================

/**
 * 战术匕首（M9 刺刀风格）
 * 特征：锯齿刀背、血槽、镀金护手、防滑橡胶握把、圆头柄端
 * 细化：
 *  - 刀刃使用多段渐变厚度，模拟利刃横截面
 *  - 刀背锯齿（4 段三角形齿）
 *  - 血槽为发光阵营色细条
 *  - 护手为镀金金属
 *  - 握把带 6 道防滑纹
 *  - 柄端球形配挂绳孔
 * @param {string} team
 * @returns {THREE.Group}
 * @private
 */
function buildKnife(team) {
  const g = new THREE.Group();
  const M = _createMaterials(team);

  // ---- 刀刃专用材质（高光银色，模拟金属光泽）----
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xc8c8d0, roughness: 0.12, metalness: 0.98
  });
  // 锯齿深色材质（用于刀背锯齿凹处）
  const darkMetalMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1e, roughness: 0.4, metalness: 0.85
  });

  // ---- 刀刃主体（沿 -Z 方向延伸，刀尖在前）----
  // 刀刃分为 3 段：根部（厚）→ 中段（中）→ 尖端（薄）
  // 根部刀身
  _box(g, { w: 0.025, h: 0.045, d: 0.14, x: 0, y: 0.025, z: -0.13, mat: bladeMat });
  // 中段刀身（变薄变窄）
  _box(g, { w: 0.022, h: 0.04, d: 0.14, x: 0, y: 0.028, z: -0.27, mat: bladeMat });
  // 尖端（三角形外观，用旋转的薄 Box 模拟）
  _box(g, { w: 0.018, h: 0.025, d: 0.1, x: 0, y: 0.035, z: -0.39, mat: bladeMat });
  // 刀尖（最尖端，倾斜的小三角块）
  _box(g, { w: 0.012, h: 0.012, d: 0.04, x: 0, y: 0.04, z: -0.46, rx: -0.3, mat: bladeMat });

  // ---- 刀背锯齿（M9 风格，4 个三角形齿）----
  for (let i = 0; i < 4; i++) {
    const z = -0.08 - i * 0.06;
    // 锯齿（小三角块，向上突出）
    _box(g, {
      w: 0.026, h: 0.012, d: 0.018,
      x: 0, y: 0.053, z: z,
      rx: 0.5,  // 倾斜形成锯齿尖
      mat: bladeMat
    });
  }

  // ---- 刀刃边缘（锐利的刃线，深色细条）----
  _box(g, { w: 0.002, h: 0.005, d: 0.36, x: 0, y: 0.005, z: -0.27, mat: darkMetalMat });

  // ---- 血槽（刀身中央凹槽，阵营色发光）----
  _box(g, {
    w: 0.004, h: 0.008, d: 0.32,
    x: 0, y: 0.045, z: -0.27,
    mat: M.accent  // 阵营色发光
  });

  // ---- 护手（镀金横档，分隔刀刃和握把）----
  _box(g, { w: 0.06, h: 0.022, d: 0.025, x: 0, y: 0.025, z: -0.05, mat: M.gold });
  // 护手两端凸起（防止手滑向前）
  _sphere(g, { r: 0.014, x: 0.03, y: 0.025, z: -0.05, mat: M.gold, seg: 10 });
  _sphere(g, { r: 0.014, x: -0.03, y: 0.025, z: -0.05, mat: M.gold, seg: 10 });

  // ---- 握把（橡胶主体，带 6 道防滑纹）----
  _box(g, { w: 0.028, h: 0.035, d: 0.15, x: 0, y: 0.025, z: 0.05, mat: M.rubber });
  // 防滑纹（6 道横向凹槽）
  for (let i = 0; i < 6; i++) {
    _box(g, {
      w: 0.03, h: 0.003, d: 0.012,
      x: 0, y: 0.025 - 0.008 + (i - 2.5) * 0.005,
      z: -0.01 + i * 0.028,
      mat: darkMetalMat
    });
  }
  // 握把侧面装饰（阵营色细条）
  _box(g, { w: 0.002, h: 0.025, d: 0.12, x: 0.015, y: 0.025, z: 0.05, mat: M.accent });
  _box(g, { w: 0.002, h: 0.025, d: 0.12, x: -0.015, y: 0.025, z: 0.05, mat: M.accent });

  // ---- 柄端（球形配挂绳孔）----
  _sphere(g, { r: 0.018, x: 0, y: 0.025, z: 0.135, mat: M.gold, seg: 12 });
  // 挂绳孔（横向小圆柱穿过柄端）
  _cyl(g, {
    rt: 0.005, rb: 0.005, h: 0.04,
    x: 0, y: 0.025, z: 0.135,
    ry: Math.PI / 2,  // 横向（沿 X 轴）
    mat: darkMetalMat
  });

  // ---- 挂绳（小细绳从孔垂下）----
  _cyl(g, {
    rt: 0.002, rb: 0.002, h: 0.05,
    x: 0, y: -0.015, z: 0.135,
    mat: M.rubber
  });
  // 绳头结
  _sphere(g, { r: 0.006, x: 0, y: -0.045, z: 0.135, mat: M.accent, seg: 8 });

  // ---- 刀刃反光高光条（顶部白色细线，强化金属感）----
  _box(g, {
    w: 0.003, h: 0.001, d: 0.34,
    x: 0, y: 0.049, z: -0.27,
    mat: M.white
  });

  return g;
}
