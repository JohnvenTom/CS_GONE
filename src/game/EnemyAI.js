/**
 * EnemyAI.js - 敌人 AI（5v5 团队）
 * --------------------------------------------------------------
 * 智能状态机：
 *  idle → patrol → investigate（搜索最后看到位置） → engage（交战）
 *                                              ↓
 *  engage → reload（找掩体换弹） / retreat（低血量撤退） → engage
 *  失去视野 2.5 秒 → investigate
 *  搜索超时 8 秒 → patrol
 *
 * 能力：
 *  - 自然巡逻（路点停留 + 随机偏移 + 速度浮动 + 偶尔跳点）
 *  - 视野检测玩家（180° 视野 + 墙体遮挡）
 *  - 搜索最后看到的位置（原地旋转扫描）
 *  - 交战保持距离 + 横向 strafe + 射击
 *  - 换弹/撤退时寻找掩体（8 方向射线探测）
 *  - 简易避障（前方 + 左右射线绕行）
 *  - 加速度模型平滑移动（避免瞬间启停）
 *  - 受伤立即响应（记录攻击者位置 → 撤退/交战/搜索）
 *  - 个人性格种子（不同 AI 有不同速度/strafe 偏好）
 * --------------------------------------------------------------
 */

import * as THREE from 'three';
import { WeaponInstance, WEAPONS } from './Weapons.js';

export class EnemyAI {
  /**
   * @param {Object} opts
   * @param {string} opts.team 'ct' | 't'
   * @param {string} opts.name 显示名
   * @param {THREE.Vector3} opts.position 出生点
   * @param {import('../world/Physics.js').Physics} opts.physics
   * @param {import('../audio/Audio.js').AudioSystem} opts.audio
   * @param {Array<THREE.Vector3>} opts.patrol 路点列表
   * @param {string} opts.weaponId 武器 ID
   */
  constructor(opts) {
    this.team = opts.team;
    this.name = opts.name || (opts.team === 'ct' ? 'CT Bot' : 'T Bot');
    this.position = opts.position.clone();
    this.physics = opts.physics;
    this.audio = opts.audio;
    this.patrolPoints = opts.patrol || [];
    this.weapon = new WeaponInstance(opts.weaponId || (opts.team === 'ct' ? 'm4a4' : 'ak47'));

    this.isAlive = true;
    this.maxHealth = 100;
    this.health = 100;
    this.armor = 0;
    this.radius = 0.4;
    this.height = 1.7;
    this.yaw = 0;
    this.state = 'idle';
    this.target = null;       // 玩家引用
    this.lastSeenTargetTime = 0;
    this.lastFireTime = 0;
    this.stateTimer = 0;
    this.patrolIndex = 0;
    this.aimError = new THREE.Vector3();
    this.aimErrorTarget = new THREE.Vector3();
    this.kills = 0;
    this.deaths = 0;
    this.assists = 0;
    this.damage = 0;

    // ---- 智能寻路相关状态 ----
    // 平滑移动：当前速度向量，用于加速度模型
    this.velocity = new THREE.Vector3();
    // 最后一次看到玩家的位置（用于 investigate 搜索）
    this.lastSeenPos = new THREE.Vector3();
    // 当前移动方向（用于朝向插值与避障决策）
    this._moveDir = new THREE.Vector3();
    // 巡逻：路点停留计时器（到达路点后驻足观察）
    this.patrolWaitTimer = 0;
    // 巡逻：当前路点的随机偏移目标（避免严格走直线）
    this.patrolOffset = new THREE.Vector3();
    // 搜索：扫描角度（到达 lastSeenPos 后原地旋转扫描）
    this.investigateScanAngle = 0;
    // 搜索：扫描方向（1 顺时针，-1 逆时针）
    this.investigateScanDir = 1;
    // 掩体：当前掩体位置（找到后缓存）
    this.coverPos = null;
    // 掩体：掩体法线（从掩体指向开阔地的方向，AI 站在掩体后朝此方向射击）
    this.coverNormal = new THREE.Vector3();
    // 换弹状态计时
    this.reloadStateTimer = 0;
    // 上次避障检测时间（节流，避免每帧做射线）
    this._lastAvoidCheck = 0;
    // 当前避障偏转方向（-1 左，0 直行，1 右）
    this._avoidSteer = 0;
    // 个人性格种子（不同 AI 有不同行为偏好）
    this._personality = Math.random();
    // retreat 冷却到期时间戳（秒）：避免低血量时 engage↔retreat 死循环抖动
    // 触发：从 retreat 切回 engage 时设置 now + 5 秒，期间即使血量低也不再切 retreat
    this._retreatCooldownUntil = 0;
    // retreat 到达掩体的时间戳（秒）：用于停留观察计时
    this._retreatArriveTime = -1;

    // ---- 3D 模型 ----
    this._buildModel();

    // ---- 命中网格（射线检测用） ----
    this.hitMesh = this._buildHitMesh();
    this.hitMesh.userData.enemy = this;
    this.hitMesh.position.copy(this.position);

    this._raycaster = new THREE.Raycaster();

    // 回调
    this.onShoot = null;
    this.onDeath = null;
    this.onHitPlayer = null;
  }

  /**
   * 构建可见的角色模型（胶囊 + 阵营色头/身）
   * 性能优化：仅身体保留 castShadow，其余部件不投影；
   *          降低几何分段（圆柱 12→8，球 16→8），9 个 AI 同屏时显著减少顶点数
   * @private
   */
  _buildModel() {
    this.group = new THREE.Group();
    const teamColor = this.team === 'ct' ? 0x004466 : 0x663300;
    const accentColor = this.team === 'ct' ? 0x00D4FF : 0xFF5500;
    const skinColor = 0xD0A570;

    const bodyMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.7, metalness: 0.1 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: accentColor, emissive: accentColor, emissiveIntensity: 0.3, roughness: 0.5
    });
    const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.8 });

    // 身体（圆柱）- 唯一投影部件
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.35, 1.1, 8),
      bodyMat
    );
    body.position.y = 0.95;
    body.castShadow = true;
    body.receiveShadow = false;
    this.group.add(body);
    this.bodyMesh = body;

    // 头（球）- 不投影（小物体投影效果差且占开销）
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6),
      skinMat
    );
    head.position.y = 1.7;
    head.castShadow = false;
    this.group.add(head);
    this.headMesh = head;

    // 头盔（半球，标识阵营）
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      accentMat
    );
    helmet.position.y = 1.75;
    helmet.castShadow = false;
    this.group.add(helmet);

    // 手臂
    const armGeo = new THREE.CapsuleGeometry(0.1, 0.6, 3, 5);
    const leftArm = new THREE.Mesh(armGeo, bodyMat);
    leftArm.position.set(-0.4, 1.0, 0);
    leftArm.castShadow = false;
    this.group.add(leftArm);
    const rightArm = new THREE.Mesh(armGeo, bodyMat);
    rightArm.position.set(0.4, 1.0, 0);
    rightArm.castShadow = false;
    this.group.add(rightArm);

    // 武器（简单盒子）
    const weaponMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.8 });
    const weaponMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.15, 0.5),
      weaponMat
    );
    weaponMesh.position.set(0.4, 1.0, -0.25);
    weaponMesh.castShadow = false;
    this.group.add(weaponMesh);

    // 腿（两个细圆柱）
    const legGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.8, 6);
    const leftLeg = new THREE.Mesh(legGeo, bodyMat);
    leftLeg.position.set(-0.15, 0.4, 0);
    leftLeg.castShadow = false;
    this.group.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, bodyMat);
    rightLeg.position.set(0.15, 0.4, 0);
    rightLeg.castShadow = false;
    this.group.add(rightLeg);

    // 阵营标识灯（带发光）
    const lampGeo = new THREE.SphereGeometry(0.06, 6, 6);
    const lamp = new THREE.Mesh(lampGeo, accentMat);
    lamp.position.set(0, 1.3, 0.35);
    lamp.castShadow = false;
    this.group.add(lamp);
    this.lamp = lamp;

    this.group.position.copy(this.position);
  }

  /**
   * 构建命中检测用的网格（隐形，包含头和身体两个区域）
   * 注意1：每个子 mesh 都必须设置 userData.enemy，因为 Raycaster.intersectObjects
   *       返回的 hit.object 是被命中的子 mesh 而非父 Group。若仅在 Group 上设置，
   *       Player._fireRaycast 中 hit.object.userData.enemy 会是 undefined，
   *       导致射击命中后无反馈。
   * 注意2：使用 material.visible=false 会让 Raycaster 跳过该 mesh（Three.js 行为），
   *       因此这里使用 transparent + opacity:0 来"视觉隐形"但保留 raycast 能力。
   *       或者直接用 mesh.visible=true + 几乎透明的颜色。此处采用透明方案。
   * @private
   */
  _buildHitMesh() {
    const group = new THREE.Group();
    // 视觉隐形但可被 raycast 的材质
    // 注意：visible:false 会导致 Raycaster 忽略此 mesh，必须用 opacity:0
    const hitMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false
    });
    // 身体盒
    const bodyGeo = new THREE.BoxGeometry(0.7, 1.4, 0.5);
    const body = new THREE.Mesh(bodyGeo, hitMat);
    body.position.y = 0.95;
    body.userData.enemy = this;        // 关键：子 mesh 也需要持有 enemy 引用
    body.userData.part = 'body';
    group.add(body);
    // 头盒
    const headGeo = new THREE.BoxGeometry(0.45, 0.45, 0.45);
    const head = new THREE.Mesh(headGeo, hitMat);
    head.position.y = 1.7;
    head.userData.enemy = this;        // 关键：子 mesh 也需要持有 enemy 引用
    head.userData.isHead = true;
    head.userData.part = 'head';
    group.add(head);
    return group;
  }

  /**
   * 主更新 - 智能状态机
   * 状态流转：
   *  idle → patrol → investigate（搜索最后看到位置） → engage（交战）
   *                                              ↓
   *  engage → reload（找掩体换弹） / retreat（低血量撤退） → engage
   *  失去视野 3 秒 → investigate
   *  搜索超时 → patrol
   * @param {number} delta
   * @param {import('./Player.js').Player} player
   * @param {Array<EnemyAI>} allEnemies
   */
  update(delta, player, allEnemies) {
    if (!this.isAlive) {
      // 倒地动画
      if (this.group.rotation.x < Math.PI / 2 - 0.05) {
        this.group.rotation.x += delta * 4;
        this.group.position.y = Math.max(0, this.group.position.y - delta * 0.5);
      }
      return;
    }

    const now = performance.now() / 1000;
    this.stateTimer += delta;

    // ---- 目标检测与状态切换 ----
    const canSeePlayer = player && player.isAlive && this._canSee(player);
    if (canSeePlayer) {
      this.target = player;
      this.lastSeenTargetTime = now;
      // 记录最后看到的位置（用于丢失后搜索）
      this.lastSeenPos.copy(player.position);
      // 看到玩家立即进入交战（除非正在换弹且弹匣已满，或正在撤退）
      // 注意：retreat 状态下不强制切 engage，让 _updateRetreat 自己处理
      //       否则会导致 engage↔retreat 死循环（retreat→engage→health<30→retreat→...）
      //       且 _updateRetreat 永远不会被真正执行（coverPos 一直 null，AI 卡住不动）
      if (this.state !== 'engage' && this.state !== 'reload' && this.state !== 'retreat') {
        this._setState('engage');
      } else if (this.state === 'reload' && this.weapon.magAmmo > 0) {
        // 换弹中途看到玩家且已有子弹，立即反击
        this._setState('engage');
      }
    } else if (this.target && now - this.lastSeenTargetTime > 2.5) {
      // 失去视野超过 2.5 秒：去最后看到的位置搜索
      if (this.state === 'engage' || this.state === 'reload') {
        this._setState('investigate');
        this.investigateScanAngle = 0;
        this.investigateScanDir = Math.random() < 0.5 ? 1 : -1;
      } else if (this.state === 'investigate' && this.stateTimer > 8) {
        // 搜索 8 秒无果，回到巡逻
        this.target = null;
        this._setState('patrol');
      }
    }

    // ---- 状态机执行 ----
    switch (this.state) {
      case 'idle':
        if (this.stateTimer > 0.8) this._setState('patrol');
        break;
      case 'patrol':
        this._updatePatrol(delta);
        break;
      case 'investigate':
        this._updateInvestigate(delta);
        break;
      case 'engage':
        this._updateEngage(delta, player, now);
        break;
      case 'reload':
        this._updateReload(delta, now);
        break;
      case 'retreat':
        this._updateRetreat(delta);
        break;
    }

    // ---- 物理碰撞解决 ----
    this.physics.resolve(this.position, this.radius, this.height);

    // ---- 同步模型位置 ----
    this.group.position.copy(this.position);
    this.hitMesh.position.copy(this.position);

    // ---- 平滑朝向 ----
    this._updateFacing(delta);

    // ---- 武器状态更新 ----
    this.weapon.update(now);
  }

  /**
   * 切换状态（重置计时器，便于子状态逻辑使用）
   * @param {string} newState
   * @private
   */
  _setState(newState) {
    this.state = newState;
    this.stateTimer = 0;
  }

  /**
   * 平滑朝向：根据当前移动方向或目标位置插值 yaw
   * @param {number} delta
   * @private
   */
  _updateFacing(delta) {
    let targetYaw = this.yaw;
    if (this.target && this.state === 'engage') {
      // 交战时朝向玩家
      const dir = new THREE.Vector3().subVectors(this.target.position, this.position);
      targetYaw = Math.atan2(dir.x, dir.z);
    } else if (this._moveDir.lengthSq() > 0.001) {
      targetYaw = Math.atan2(this._moveDir.x, this._moveDir.z);
    } else if (this.state === 'investigate') {
      // 搜索时使用扫描角度
      targetYaw = this.investigateScanAngle;
    }
    // 角度插值速率：交战时快速转向（0.15），其他状态慢速（0.08）
    const lerpRate = this.state === 'engage' ? 0.15 : 0.08;
    this.yaw = this._lerpAngle(this.yaw, targetYaw, lerpRate);
    this.group.rotation.y = this.yaw;
  }

  /**
   * 角度插值（处理环绕）
   * @private
   */
  _lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  /**
   * 自然巡逻：沿路点移动，到达后停留观察，路径加入随机偏移
   * 改进点：
   *  - 到达路点后停留 1-3 秒观察环境
   *  - 路点目标加入 ±1.5m 随机偏移，避免严格走直线
   *  - 速度有 ±0.4 浮动，模拟人类步伐不一致
   *  - 15% 概率跳过下一个路点，增加路径变化
   * @private
   */
  _updatePatrol(delta) {
    if (this.patrolPoints.length === 0) return;

    // 路点停留阶段
    if (this.patrolWaitTimer > 0) {
      this.patrolWaitTimer -= delta;
      this._moveDir.set(0, 0, 0);
      // 停留时缓慢扫视四周（增加真实感）
      this.yaw += delta * 0.3 * this.investigateScanDir;
      return;
    }

    const target = this.patrolPoints[this.patrolIndex];
    // 路点目标加入随机偏移（每次到达路点时重新生成）
    const effectiveTarget = target.clone().add(this.patrolOffset);
    const dir = new THREE.Vector3().subVectors(effectiveTarget, this.position);
    dir.y = 0;
    const dist = dir.length();

    if (dist < 0.8) {
      // 到达路点：停留 1-3 秒，生成下一个路点的随机偏移
      this.patrolWaitTimer = 1.0 + Math.random() * 2.0;
      this.investigateScanDir = Math.random() < 0.5 ? 1 : -1;
      this.patrolOffset.set(
        (Math.random() - 0.5) * 3.0,
        0,
        (Math.random() - 0.5) * 3.0
      );
      // 15% 概率跳过下一个路点（增加路径变化）
      if (Math.random() < 0.15) {
        this.patrolIndex = (this.patrolIndex + 2) % this.patrolPoints.length;
      } else {
        this.patrolIndex = (this.patrolIndex + 1) % this.patrolPoints.length;
      }
      this._moveDir.set(0, 0, 0);
      return;
    }

    dir.normalize();
    // 带避障的移动，速度加入性格浮动
    const baseSpeed = 3.0 + (this._personality - 0.5) * 0.8;
    this._moveWithAvoidance(dir, baseSpeed, delta);
  }

  /**
   * 搜索状态：前往最后看到玩家的位置，到达后原地旋转扫描
   * 改进点：
   *  - 先移动到 lastSeenPos
   *  - 到达后原地旋转扫描 180° 范围
   *  - 扫描期间若发现玩家会立即切回 engage（由主 update 检测）
   *  - 超时 8 秒未发现则回巡逻
   * @private
   */
  _updateInvestigate(delta) {
    const dir = new THREE.Vector3().subVectors(this.lastSeenPos, this.position);
    dir.y = 0;
    const dist = dir.length();

    if (dist > 1.5) {
      // 还没到达最后看到的位置：移动过去
      dir.normalize();
      this._moveWithAvoidance(dir, 3.8, delta);
    } else {
      // 已到达：原地扫描四周
      this._moveDir.set(0, 0, 0);
      // 扫描速度：每秒约 90°
      this.investigateScanAngle += delta * 1.6 * this.investigateScanDir;
      // 扫描范围 ±π（180°），到达边界后反向
      if (Math.abs(this.investigateScanAngle - this.yaw) > Math.PI) {
        this.investigateScanDir *= -1;
      }
      // 扫描角度基准为朝向 lastSeenPos 的方向
      const baseAngle = Math.atan2(dir.x, dir.z);
      this.investigateScanAngle = baseAngle + (this.stateTimer * 1.6 * this.investigateScanDir);
    }
  }

  /**
   * 交战状态：保持距离 + 射击 + 横向移动 + 掩体利用
   * 改进点：
   *  - 远距离：靠近玩家（speed 4.5）
   *  - 近距离：后撤（speed 3.0）
   *  - 中距离：横向 strafe + 偶尔找掩体
   *  - 弹匣空：切 reload 状态找掩体换弹
   *  - 血量 < 30：切 retreat 状态撤退
   * @private
   */
  _updateEngage(delta, player, now) {
    if (!player || !player.isAlive) {
      this._setState('patrol');
      return;
    }

    // ---- 血量过低：撤退 ----
    // 加入冷却检查：避免从 retreat 切回 engage 后立即又被切回 retreat（死循环抖动）
    // 注意事项：冷却期内即使血量低也继续战斗，让 AI 有机会反击或换弹
    const nowSec = performance.now() / 1000;
    if (this.health < 30 && this.state === 'engage' && nowSec > this._retreatCooldownUntil) {
      this._setState('retreat');
      this.coverPos = null; // 强制重新找掩体
      return;
    }

    // ---- 弹匣空：找掩体换弹 ----
    if (this.weapon.magAmmo <= 0) {
      this._setState('reload');
      this.coverPos = null;
      this.reloadStateTimer = 0;
      return;
    }

    const distToPlayer = this.position.distanceTo(player.position);
    const dir = new THREE.Vector3().subVectors(player.position, this.position);
    dir.y = 0;
    dir.normalize();

    // ---- 距离控制 ----
    if (distToPlayer > 28) {
      // 太远：靠近
      this._moveWithAvoidance(dir, 4.5, delta);
    } else if (distToPlayer < 10) {
      // 太近：后撤
      this._moveWithAvoidance(dir.clone().negate(), 3.5, delta);
    } else {
      // 中距离：横向 strafe（绕侧）
      // 性格决定偏好方向：50% AI 偏向某一侧
      const sideSign = this._personality > 0.5 ? 1 : -1;
      // 偶尔切换 strafe 方向（每 2-4 秒）
      const strafeFlip = Math.floor(this.stateTimer / (2 + this._personality * 2)) % 2 === 0;
      const finalSign = strafeFlip ? sideSign : -sideSign;
      const sideDir = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(finalSign);
      this._moveWithAvoidance(sideDir, 2.5, delta);

      // 30% 概率在 strafe 时也轻微靠近/远离（增加运动不可预测性）
      if (Math.random() < 0.3) {
        const approachSign = distToPlayer > 18 ? 1 : -1;
        this._moveDir.addScaledVector(dir, approachSign * 0.3).normalize();
      }
    }

    // ---- 射击 ----
    if (distToPlayer < this.weapon.def.range && this.weapon.magAmmo > 0) {
      const aiFireRateFactor = 0.4;
      const fireInterval = 1 / (this.weapon.def.fireRate * aiFireRateFactor);
      if (now - this.lastFireTime > fireInterval) {
        this._shootAtPlayer(player, now);
        this.lastFireTime = now;
      }
    }
  }

  /**
   * 换弹状态：寻找附近掩体，躲到掩体后换弹
   * 改进点：
   *  - 优先使用已缓存的掩体
   *  - 无缓存时调用 _findCover 寻找
   *  - 到达掩体后停留直到换弹完成
   *  - 换弹完成且有目标 → engage；无目标 → patrol
   * @private
   */
  _updateReload(delta, now) {
    // 确保换弹请求已发出
    if (!this.weapon.isReloading && this.weapon.magAmmo < this.weapon.def.magSize) {
      this.weapon.startReload(now);
    }

    // 寻找掩体
    if (!this.coverPos) {
      this.coverPos = this._findCover(this.position, this.target ? this.target.position : null);
    }

    if (this.coverPos) {
      const dir = new THREE.Vector3().subVectors(this.coverPos, this.position);
      dir.y = 0;
      const dist = dir.length();
      if (dist > 0.8) {
        // 移动到掩体
        dir.normalize();
        this._moveWithAvoidance(dir, 4.0, delta);
      } else {
        // 已到掩体：等待换弹完成
        this._moveDir.set(0, 0, 0);
      }
    } else {
      // 没找到掩体：原地换弹（边后退边换弹）
      if (this.target) {
        const backDir = new THREE.Vector3().subVectors(this.position, this.target.position);
        backDir.y = 0;
        backDir.normalize();
        this._moveWithAvoidance(backDir, 2.0, delta);
      } else {
        this._moveDir.set(0, 0, 0);
      }
    }

    // 换弹完成：恢复交战或巡逻
    if (!this.weapon.isReloading && this.weapon.magAmmo > 0) {
      if (this.target && performance.now() / 1000 - this.lastSeenTargetTime < 4) {
        this._setState('engage');
      } else {
        this._setState('investigate');
        this.investigateScanAngle = 0;
      }
      this.coverPos = null;
    }
  }

  /**
   * 撤退状态：低血量时后退到掩体，停留观察一段时间后重新交战
   * 改进点：
   *  - 到达掩体后停留 stateTimer > 2.5 秒（让换弹完成 + 模拟"喘息"）
   *  - 停留期间原地观察（缓慢扫描）
   *  - 切回 engage 时设置 5 秒冷却，避免立即又被切回 retreat（死循环抖动）
   *  - 若无掩体则直线远离目标
   * 注意：当前无自动回血机制，撤退主要价值是脱离火力线 + 换弹 + 视觉自然
   * @private
   */
  _updateRetreat(delta) {
    // 寻找掩体（远离当前目标方向）
    if (!this.coverPos) {
      this.coverPos = this._findCover(this.position, this.target ? this.target.position : null);
      this._retreatArriveTime = -1; // 重置到达时间
    }

    if (this.coverPos) {
      const dir = new THREE.Vector3().subVectors(this.coverPos, this.position);
      dir.y = 0;
      const dist = dir.length();
      if (dist > 0.8) {
        // 还在前往掩体的路上
        dir.normalize();
        this._moveWithAvoidance(dir, 4.5, delta);
      } else {
        // 已到达掩体：记录到达时间（首次）
        if (this._retreatArriveTime < 0) {
          this._retreatArriveTime = performance.now() / 1000;
        }
        // 尝试换弹（如果需要）
        if (this.weapon.magAmmo < this.weapon.def.magSize && !this.weapon.isReloading) {
          this.weapon.startReload(performance.now() / 1000);
        }
        this._moveDir.set(0, 0, 0);
        // 停留观察 2.5 秒后才评估是否切回（避免抖动 + 给玩家压迫感）
        const waitSec = performance.now() / 1000 - this._retreatArriveTime;
        if (waitSec > 2.5 && !this.weapon.isReloading) {
          // 设置 5 秒冷却：即使血量低也不会立即再切 retreat
          this._retreatCooldownUntil = performance.now() / 1000 + 5;
          if (this.target && performance.now() / 1000 - this.lastSeenTargetTime < 3) {
            this._setState('engage');
            this.coverPos = null;
          } else {
            this._setState('investigate');
            this.investigateScanAngle = 0;
            this.investigateScanDir = Math.random() < 0.5 ? 1 : -1;
            this.coverPos = null;
          }
        }
      }
    } else {
      // 无掩体：直接远离目标
      if (this.target) {
        const fleeDir = new THREE.Vector3().subVectors(this.position, this.target.position);
        fleeDir.y = 0;
        fleeDir.normalize();
        this._moveWithAvoidance(fleeDir, 4.0, delta);
      } else {
        this._setState('patrol');
      }
    }
  }

  /**
   * 带避障的移动：在期望方向上前进，遇到墙壁时自动绕行
   * 算法：
   *  1) 沿期望方向发射 2m 前向探测射线
   *  2) 若被堵，向左右各 30° 发射探测射线，选择更通畅方向
   *  3) 应用加速度模型平滑移动（避免瞬间启停）
   *  4) 每帧最多做一次避障检测（已由调用频率保证）
   * @param {THREE.Vector3} desiredDir 期望移动方向（已归一化）
   * @param {number} speed 目标速度
   * @param {number} delta
   * @private
   */
  _moveWithAvoidance(desiredDir, speed, delta) {
    // ---- 避障检测（每 0.1 秒一次，节流） ----
    const now = performance.now() / 1000;
    if (now - this._lastAvoidCheck > 0.1) {
      this._lastAvoidCheck = now;
      const checkDist = 2.0;
      const origin = new THREE.Vector3(
        this.position.x,
        this.position.y + 0.5,
        this.position.z
      );
      const forwardRay = new THREE.Ray(origin, desiredDir);
      const forwardHits = this.physics.raycastBoxes(forwardRay, checkDist);

      if (forwardHits.length > 0 && forwardHits[0].distance < checkDist) {
        // 前方有墙：检测左右两侧
        const leftDir = new THREE.Vector3(
          desiredDir.x * Math.cos(0.6) - desiredDir.z * Math.sin(0.6),
          0,
          desiredDir.x * Math.sin(0.6) + desiredDir.z * Math.cos(0.6)
        );
        const rightDir = new THREE.Vector3(
          desiredDir.x * Math.cos(-0.6) - desiredDir.z * Math.sin(-0.6),
          0,
          desiredDir.x * Math.sin(-0.6) + desiredDir.z * Math.cos(-0.6)
        );
        const leftRay = new THREE.Ray(origin, leftDir);
        const rightRay = new THREE.Ray(origin, rightDir);
        const leftHits = this.physics.raycastBoxes(leftRay, checkDist);
        const rightHits = this.physics.raycastBoxes(rightRay, checkDist);
        const leftClear = leftHits.length === 0 || leftHits[0].distance >= checkDist;
        const rightClear = rightHits.length === 0 || rightHits[0].distance >= checkDist;

        if (leftClear && !rightClear) {
          this._avoidSteer = -1;
        } else if (rightClear && !leftClear) {
          this._avoidSteer = 1;
        } else if (leftClear && rightClear) {
          // 两侧都通：选距离目标更近的一侧（这里用性格偏好）
          this._avoidSteer = this._personality > 0.5 ? 1 : -1;
        } else {
          // 两侧都堵：保持当前转向（继续尝试）
          this._avoidSteer = this._avoidSteer || 1;
        }
      } else {
        this._avoidSteer = 0;
      }
    }

    // ---- 计算实际移动方向（应用避障偏转） ----
    let actualDir = desiredDir;
    if (this._avoidSteer !== 0) {
      const steerAngle = 0.6 * this._avoidSteer;
      actualDir = new THREE.Vector3(
        desiredDir.x * Math.cos(steerAngle) - desiredDir.z * Math.sin(steerAngle),
        0,
        desiredDir.x * Math.sin(steerAngle) + desiredDir.z * Math.cos(steerAngle)
      );
    }

    // ---- 加速度模型：当前速度向目标速度插值 ----
    const targetVel = actualDir.clone().multiplyScalar(speed);
    const accel = this.state === 'engage' ? 8.0 : 5.0; // 交战时加速更快
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, targetVel.x, Math.min(1, accel * delta));
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, targetVel.z, Math.min(1, accel * delta));

    // ---- 应用位移 ----
    this.position.x += this.velocity.x * delta;
    this.position.z += this.velocity.z * delta;

    // ---- 记录移动方向（用于朝向插值） ----
    this._moveDir.copy(actualDir);
  }

  /**
   * 寻找附近最近的掩体位置
   * 算法：
   *  - 从 AI 位置朝 8 个方向（每 45°）发射 5m 射线
   *  - 找到最近的墙壁命中点
   *  - 返回墙壁前 0.8m 的位置作为掩体站位
   *  - 优先选择远离威胁方向（targetDir）的掩体
   * @param {THREE.Vector3} from AI 当前位置
   * @param {THREE.Vector3|null} threatPos 威胁位置（玩家），用于选择背对威胁的掩体
   * @returns {THREE.Vector3|null} 掩体位置，未找到返回 null
   * @private
   */
  _findCover(from, threatPos) {
    const origin = new THREE.Vector3(from.x, from.y + 0.5, from.z);
    let bestCover = null;
    let bestScore = -Infinity;

    // 威胁方向（如果有的话，优先找背对威胁的掩体）
    const threatDir = threatPos
      ? new THREE.Vector3().subVectors(threatPos, from).normalize()
      : null;

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
      const ray = new THREE.Ray(origin, dir);
      const hits = this.physics.raycastBoxes(ray, 5);

      if (hits.length > 0) {
        const wallPoint = hits[0].point;
        const wallDist = hits[0].distance;
        // 站位：墙前 0.8m（背靠墙）
        const coverPos = new THREE.Vector3(
          wallPoint.x - dir.x * 0.8,
          from.y,
          wallPoint.z - dir.z * 0.8
        );

        // 评分：距离越近越好 + 背对威胁越好
        let score = 10 - wallDist; // 距离分（近的优先）
        if (threatDir) {
          // 掩体方向与威胁方向的反向越接近越好（dot 越接近 -1 越好）
          const awayFromThreat = dir.dot(threatDir);
          score += -awayFromThreat * 5; // awayFromThreat 为负时 score 增加
        }

        if (score > bestScore) {
          bestScore = score;
          bestCover = coverPos;
        }
      }
    }
    return bestCover;
  }

  /**
   * 向玩家射击（真实射线 + 散布）
   * --------------------------------
   * 设计目标：
   *  - 不再使用"按概率命中"模型，改为发射物理射线
   *  - 这样玩家有真实躲避机会（移动、找掩体）
   *  - 散布 = 武器基础散布 × AI 散布倍率 × 距离衰减
   *  - AI 散布倍率刻意大于玩家（让 AI 不那么准）
   *  - 同时降低射速，进一步降低 DPS
   * @param {import('./Player.js').Player} player
   * @param {number} now 当前时间（秒）
   * @private
   */
  _shootAtPlayer(player, now) {
    const fired = this.weapon.tryFire(now, false);
    if (!fired) return;

    this.audio.gunshot(this.weapon.id);
    if (this.onShoot) this.onShoot(this);

    // ---- 计算散布 ----
    // AI 散布倍率：步枪 2.5x，冲锋枪 2.0x，狙击枪 4.0x，手枪 2.0x
    // 这样 AI 在远距离下命中率会显著降低，玩家有躲避机会
    const category = this.weapon.def.category;
    let aiSpreadMultiplier = 2.5;
    if (category === 'smg') aiSpreadMultiplier = 2.0;
    else if (category === 'sniper') aiSpreadMultiplier = 4.0;
    else if (category === 'pistol') aiSpreadMultiplier = 2.0;
    else if (category === 'shotgun') aiSpreadMultiplier = 1.5;

    // 距离衰减：远距离额外增加散布（模拟 AI 瞄准精度下降）
    const dist = this.position.distanceTo(player.position);
    const distanceFactor = 1.0 + Math.max(0, dist - 15) * 0.05; // 15m 后每米 +5%

    // 最终散布角度（弧度）
    const spread = this.weapon.def.spread * aiSpreadMultiplier * distanceFactor;

    // ---- 计算射线方向（从 AI 胸口到玩家身体）----
    const fromPos = new THREE.Vector3(
      this.position.x,
      this.position.y + 1.4, // AI 持枪高度
      this.position.z
    );
    // 瞄准玩家胸部（玩家脚部 + 1.0）
    const targetPos = new THREE.Vector3(
      player.position.x,
      player.position.y + 1.0,
      player.position.z
    );
    const baseDir = new THREE.Vector3().subVectors(targetPos, fromPos).normalize();

    // 在基础方向上添加散布扰动（球面均匀分布近似）
    // 通过在垂直于 baseDir 的平面上随机偏移实现
    const up = Math.abs(baseDir.y) < 0.99
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(baseDir, up).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, baseDir).normalize();

    const angleX = (Math.random() - 0.5) * spread * 2;
    const angleY = (Math.random() - 0.5) * spread * 2;
    const shotDir = baseDir.clone()
      .addScaledVector(right, Math.tan(angleX))
      .addScaledVector(realUp, Math.tan(angleY))
      .normalize();

    // ---- 发射射线 ----
    const ray = new THREE.Ray(fromPos, shotDir);
    const range = this.weapon.def.range;

    // 检查墙壁遮挡
    const wallHits = this.physics.raycastBoxes(ray, range);
    const wallDist = wallHits.length > 0 ? wallHits[0].distance : Infinity;

    // 检查命中玩家
    // 玩家 AABB：以 player.position 为脚部，加 radius 和 height
    const pMin = new THREE.Vector3(
      player.position.x - player.radius,
      player.position.y,
      player.position.z - player.radius
    );
    const pMax = new THREE.Vector3(
      player.position.x + player.radius,
      player.position.y + player.currentHeight,
      player.position.z + player.radius
    );
    const playerBox = new THREE.Box3(pMin, pMax);
    const hitPoint = new THREE.Vector3();
    const hitPlayer = ray.intersectBox(playerBox, hitPoint);
    const playerDist = hitPlayer ? fromPos.distanceTo(hitPoint) : Infinity;

    // 玩家在墙后或射程外 → 未命中
    if (!hitPlayer || playerDist > wallDist || playerDist > range) {
      // 未命中：可在这里加"擦肩"提示
      return;
    }

    // ---- 命中判定 ----
    // 爆头判定：命中点 Y 坐标 >= player.position.y + 1.5 视为爆头
    const isHeadshot = hitPoint.y >= player.position.y + 1.5;
    const damage = this.weapon.def.damage * (isHeadshot ? this.weapon.def.headshotMultiplier : 1);
    // 伤害浮动（90%-110%）模拟距离衰减和命中部位差异
    const finalDamage = Math.round(damage * (0.9 + Math.random() * 0.2));

    const killed = player.takeDamage(finalDamage, this.position, isHeadshot, this);
    if (this.onHitPlayer) this.onHitPlayer(player, finalDamage, isHeadshot, this);
    if (killed) {
      this.kills++;
      // player.deaths 由 Game._onPlayerDeath 统一管理，避免重复计数
    }
  }

  /**
   * 视野检测：是否能看到玩家
   * @private
   */
  _canSee(player) {
    const dist = this.position.distanceTo(player.position);
    if (dist > 60) return false; // 视野范围

    // 视线方向
    const dir = new THREE.Vector3().subVectors(player.position, this.position).normalize();
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // 注意：group.rotation.y = yaw 时，正面朝向 +Z 是 yaw=0，朝向 +X 是 yaw=PI/2
    // 实际朝向：forward = (sin(yaw), 0, cos(yaw))？需校验
    // 这里给 AI 较宽广的视野（180°）
    const dot = dir.dot(forward);
    if (dot < -0.3) return false; // 在背后

    // 视线遮挡检测
    const ray = new THREE.Ray(
      new THREE.Vector3(this.position.x, this.position.y + 1.5, this.position.z),
      dir
    );
    const wallHits = this.physics.raycastBoxes(ray, dist);
    if (wallHits.length > 0 && wallHits[0].distance < dist - 0.5) {
      return false; // 被墙挡住
    }
    return true;
  }

  /**
   * 受到伤害
   * 改进点：
   *  - 记录攻击者位置到 lastSeenPos（即使看不到攻击者，也会去那个位置搜索）
   *  - 受伤立即响应：血量过低撤退，有视野则交战，无视野则搜索
   *  - 不再傻站挨打
   * @param {number} damage
   * @param {Object} attacker 攻击者
   * @returns {boolean} 是否死亡
   */
  takeDamage(damage, attacker) {
    if (!this.isAlive) return false;
    this.health -= damage;
    this.damage += damage;

    // 被打就锁定目标
    if (attacker && attacker.position) {
      this.target = attacker;
      this.lastSeenTargetTime = performance.now() / 1000;
      // 记录攻击者位置：即使后续丢失视野，也会去这里搜索
      this.lastSeenPos.copy(attacker.position);
      // 受伤立即响应：血量过低撤退，否则有视野则交战，无视野则搜索
      if (this.health < 30) {
        if (this.state !== 'retreat') {
          this._setState('retreat');
          this.coverPos = null;
        }
      } else if (this._canSee(attacker)) {
        if (this.state !== 'engage') {
          this._setState('engage');
        }
      } else {
        // 看不到攻击者：去受伤位置搜索
        if (this.state !== 'investigate' && this.state !== 'retreat') {
          this._setState('investigate');
          this.investigateScanAngle = 0;
          this.investigateScanDir = Math.random() < 0.5 ? 1 : -1;
        }
      }
    }

    if (this.health <= 0) {
      this.health = 0;
      this.isAlive = false;
      this.deaths++;
      if (this.onDeath) this.onDeath(this, attacker);
      return true;
    }
    return false;
  }

  /**
   * 重生：重置位置、生命、武器及所有 AI 状态
   * 注意：此方法会替换武器，仅用于新游戏/回合开始时全员重置
   *       存活进入下一局请使用 respawnKeepGear
   * @param {THREE.Vector3} pos
   * @param {string} weaponId
   */
  respawn(pos, weaponId) {
    this.position.copy(pos);
    this.health = 100;
    this.isAlive = true;
    this.state = 'idle';
    this.stateTimer = 0;
    this.weapon = new WeaponInstance(weaponId || this.weapon.id);
    this._resetAIState();
    this.group.rotation.x = 0;
    this.group.position.copy(this.position);
  }

  /**
   * 存活进入下一局：保留武器和护甲，只重置位置、生命、状态
   * 同时补满当前武器弹匣（避免带半截子弹进入下一局）
   * @param {THREE.Vector3} pos
   */
  respawnKeepGear(pos) {
    this.position.copy(pos);
    this.health = 100;
    this.isAlive = true;
    this.state = 'idle';
    this.stateTimer = 0;
    this.target = null;
    this.lastFireTime = 0;
    // 保留 weapon 引用，补满弹匣
    if (this.weapon) {
      this.weapon.magAmmo = this.weapon.def.magSize;
      this.weapon.reserveAmmo = this.weapon.def.reserveAmmo;
      this.weapon.isReloading = false;
      this.weapon.lastFireTime = 0;
    }
    this._resetAIState();
    this.group.rotation.x = 0;
    this.group.position.copy(this.position);
  }

  /**
   * 重置智能寻路相关状态（重生/换局时调用）
   * @private
   */
  _resetAIState() {
    this.velocity.set(0, 0, 0);
    this.lastSeenPos.set(0, 0, 0);
    this._moveDir.set(0, 0, 0);
    this.patrolWaitTimer = 0;
    this.patrolOffset.set(0, 0, 0);
    this.investigateScanAngle = 0;
    this.investigateScanDir = 1;
    this.coverPos = null;
    this.reloadStateTimer = 0;
    this._lastAvoidCheck = 0;
    this._avoidSteer = 0;
    this._retreatCooldownUntil = 0;
    this._retreatArriveTime = -1;
  }

  /**
   * 添加到场景
   * @param {THREE.Scene} scene
   */
  addToScene(scene) {
    scene.add(this.group);
    scene.add(this.hitMesh);
  }

  /**
   * 从场景移除
   * @param {THREE.Scene} scene
   */
  removeFromScene(scene) {
    scene.remove(this.group);
    scene.remove(this.hitMesh);
  }

  /**
   * 获取用于计分板的统计
   */
  getStats() {
    return {
      name: this.name,
      team: this.team,
      kills: this.kills,
      deaths: this.deaths,
      assists: this.assists,
      isAlive: this.isAlive,
      damage: Math.round(this.damage),
      money: 0 // AI 不显示金钱
    };
  }
}
