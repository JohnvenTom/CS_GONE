/**
 * Physics.js - 简化版 AABB 物理碰撞
 * --------------------------------------------------------------
 * 实现：
 *  - 玩家与墙壁/箱体的轴对齐包围盒碰撞
 *  - 玩家与地面/天花板的高度限制
 *  - 简单重力 + 跳跃
 *  - 射线 vs AABB 检测（用于射击命中判定）
 * 注意：不使用完整物理引擎，仅满足 FPS 玩法需求
 * --------------------------------------------------------------
 */

import * as THREE from 'three';

export class Physics {
  constructor() {
    /** @type {Array<{box:THREE.Box3, data?:any}>} 静态碰撞体 */
    this.colliders = [];
    /** @type {number} 地面 Y 坐标 */
    this.groundY = 0;
    /** @type {number} 世界边界 */
    this.worldBounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
    // 复用临时对象，避免每帧 GC
    this._tmpBox = new THREE.Box3();
  }

  /**
   * 添加一个轴对齐碰撞体
   * @param {THREE.Vector3} min 最小角
   * @param {THREE.Vector3} max 最大角
   * @param {any} data 附加数据（如可破坏标记）
   */
  addBox(min, max, data = null) {
    this.colliders.push({ box: new THREE.Box3(min.clone(), max.clone()), data });
  }

  /**
   * 添加一个以中心+尺寸描述的碰撞体
   * @param {THREE.Vector3} center
   * @param {THREE.Vector3} size
   * @param {any} data
   */
  addBoxCenterSize(center, size, data = null) {
    const half = size.clone().multiplyScalar(0.5);
    this.addBox(center.clone().sub(half), center.clone().add(half), data);
  }

  /**
   * 设置地面高度
   * @param {number} y
   */
  setGround(y) {
    this.groundY = y;
  }

  /**
   * 设置世界边界
   * @param {number} minX
   * @param {number} maxX
   * @param {number} minZ
   * @param {number} maxZ
   */
  setBounds(minX, maxX, minZ, maxZ) {
    this.worldBounds = { minX, maxX, minZ, maxZ };
  }

  /**
   * 玩家碰撞解决：传入玩家位置（带半径和高度），返回调整后的位置
   * 算法：
   *  1) 多次迭代（最多 6 次）保证多箱子堆叠、角落夹击等场景收敛
   *  2) 优先级：Y 方向（站到顶上 / 头顶撞）> X/Z 方向推开
   *  3) 推动方向参考"玩家中心相对箱子中心的位置"，确保玩家被推到最近的边外
   *     （比"最小渗透轴"更直观，且对玩家完全嵌入场景也有效）
   *  4) 多箱子同时碰撞时，累加各轴推力并取绝对值最大者，防止互相抵消
   * 改进（v2）：返回碰撞反馈对象 {pos, collided, normal}，让 AI 能感知撞墙并作出反应
   * @param {THREE.Vector3} pos 玩家脚部位置（会被原地修改）
   * @param {number} radius 玩家半径
   * @param {number} height 玩家高度
   * @returns {{pos:THREE.Vector3, collided:boolean, normal:THREE.Vector3}} 调整后的位置 + 碰撞信息
   */
  resolve(pos, radius, height) {
    // 复用临时变量，避免每帧 GC
    const pMin = this._tmpMin || (this._tmpMin = new THREE.Vector3());
    const pMax = this._tmpMax || (this._tmpMax = new THREE.Vector3());

    // 碰撞反馈：累加所有推动方向的法线（归一化后表示"墙的推开方向"）
    let collided = false;
    let netNormalX = 0, netNormalZ = 0;

    for (let iter = 0; iter < 6; iter++) {
      let anyCollision = false;

      // 每轮迭代重新计算玩家 AABB
      pMin.set(pos.x - radius, pos.y, pos.z - radius);
      pMax.set(pos.x + radius, pos.y + height, pos.z + radius);

      // ---- 收集本轮所有碰撞信息 ----
      // 累积各方向的净推力，避免对角夹击时来回震荡
      let netPushX = 0, netPushZ = 0;
      let resolveY = null;  // Y 方向单独处理（同一时间只可能站一个顶）

      for (const c of this.colliders) {
        const box = c.box;
        if (pMax.x <= box.min.x || pMin.x >= box.max.x) continue;
        if (pMax.y <= box.min.y || pMin.y >= box.max.y) continue;
        if (pMax.z <= box.min.z || pMin.z >= box.max.z) continue;

        anyCollision = true;
        collided = true;

        const overlapX1 = box.max.x - pMin.x;  // 推 -X（玩家向左退）
        const overlapX2 = pMax.x - box.min.x;  // 推 +X（玩家向右退）
        const overlapZ1 = box.max.z - pMin.z;  // 推 -Z
        const overlapZ2 = pMax.z - box.min.z;  // 推 +Z

        // ---- Y 方向优先判断 ----
        // 站在箱子顶上（玩家脚部接近箱顶）
        if (pos.y >= box.max.y - 0.2) {
          // 选最高的顶（防止堆叠箱子时穿到中间）
          if (resolveY === null || box.max.y > resolveY) {
            resolveY = box.max.y;
          }
          continue;
        }
        // 头顶撞到箱子底（玩家在箱下方）
        if (pos.y + height <= box.min.y + 0.2) {
          if (resolveY === null || box.min.y - height < resolveY) {
            resolveY = box.min.y - height;
          }
          continue;
        }

        // ---- X/Z 方向：基于玩家中心相对箱子中心的位置决定推力方向 ----
        // 玩家中心 pos.x 与箱子中心 (box.min.x + box.max.x) / 2 的偏移决定推力方向
        // 这种方式即使玩家完全嵌入也能正确推出到最近的边
        const boxCenterX = (box.min.x + box.max.x) * 0.5;
        const boxCenterZ = (box.min.z + box.max.z) * 0.5;
        const dx = pos.x - boxCenterX;  // 玩家相对箱中心的 X 偏移
        const dz = pos.z - boxCenterZ;  // 玩家相对箱中心的 Z 偏移

        // 推力大小：让玩家完全脱离箱子所需的最小距离
        // X 方向推到 box 外需要 |dx| >= boxHalfX + radius
        const boxHalfX = (box.max.x - box.min.x) * 0.5;
        const boxHalfZ = (box.max.z - box.min.z) * 0.5;

        // 计算把玩家推到 X 方向外面需要的位移（带符号）
        const pushXTarget = (dx >= 0 ? 1 : -1) * (boxHalfX + radius);
        const pushXDelta = pushXTarget - dx;  // 需要应用的 X 位移

        const pushZTarget = (dz >= 0 ? 1 : -1) * (boxHalfZ + radius);
        const pushZDelta = pushZTarget - dz;

        // 选择需要的位移绝对值较小的轴推开（更近的边）
        if (Math.abs(pushXDelta) <= Math.abs(pushZDelta)) {
          // 推 X 方向
          if (Math.abs(pushXDelta) > Math.abs(netPushX)) netPushX = pushXDelta;
          // 累加碰撞法线（推力方向 = 法线方向）
          netNormalX += Math.sign(pushXDelta);
        } else {
          if (Math.abs(pushZDelta) > Math.abs(netPushZ)) netPushZ = pushZDelta;
          netNormalZ += Math.sign(pushZDelta);
        }
      }

      if (!anyCollision) break;

      // ---- 应用 Y 方向解决 ----
      if (resolveY !== null) {
        pos.y = resolveY;
      }

      // ---- 应用 X/Z 方向解决 ----
      // 优先推绝对值更大的轴（避免角落震荡）
      if (Math.abs(netPushX) >= Math.abs(netPushZ) && netPushX !== 0) {
        pos.x += netPushX;
      } else if (netPushZ !== 0) {
        pos.z += netPushZ;
      }
    }

    // ---- 世界边界 ----
    pos.x = Math.max(this.worldBounds.minX + radius, Math.min(this.worldBounds.maxX - radius, pos.x));
    pos.z = Math.max(this.worldBounds.minZ + radius, Math.min(this.worldBounds.maxZ - radius, pos.z));

    // ---- 地面 ----
    if (pos.y < this.groundY) pos.y = this.groundY;

    // ---- 返回碰撞反馈 ----
    // 法线归一化（如果没碰撞则为零向量）
    const normalLen = Math.sqrt(netNormalX * netNormalX + netNormalZ * netNormalZ);
    const normal = this._tmpNormal || (this._tmpNormal = new THREE.Vector3());
    if (normalLen > 0.001) {
      normal.set(netNormalX / normalLen, 0, netNormalZ / normalLen);
    } else {
      normal.set(0, 0, 0);
    }

    return { pos, collided, normal };
  }

  /**
   * 射线 vs 所有 AABB 检测
   * @param {THREE.Ray} ray
   * @param {number} maxDist 最大距离
   * @returns {Array<{point:THREE.Vector3, distance:number, data:any}>} 命中列表（按距离排序）
   */
  raycastBoxes(ray, maxDist = 200) {
    const hits = [];
    for (const c of this.colliders) {
      const hit = ray.intersectBox(c.box, new THREE.Vector3());
      if (hit) {
        const dist = ray.origin.distanceTo(hit);
        if (dist <= maxDist) {
          hits.push({ point: hit, distance: dist, data: c.data, box: c.box });
        }
      }
    }
    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }

  /**
   * 点是否在某个碰撞体内
   * @param {THREE.Vector3} p
   * @returns {boolean}
   */
  isInsideAnyBox(p) {
    for (const c of this.colliders) {
      if (c.box.containsPoint(p)) return true;
    }
    return false;
  }
}
