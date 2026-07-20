/**
 * EnemyAI.js - 敌人 AI（5v5 团队）
 * --------------------------------------------------------------
 * 状态机：idle → patrol → chase → attack → dead
 * 能力：
 *  - 沿预设路点巡逻
 *  - 视野检测玩家
 *  - 进入射程后射击（带精度抖动）
 *  - 受伤反击
 *  - 死亡掉落
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
   * 主更新
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

    // ---- 检查目标 ----
    if (player && player.isAlive && this._canSee(player)) {
      this.target = player;
      this.lastSeenTargetTime = now;
      if (this.state !== 'attack') {
        this.state = 'attack';
        this.stateTimer = 0;
      }
    } else if (this.target && now - this.lastSeenTargetTime > 3) {
      this.target = null;
      this.state = 'patrol';
      this.stateTimer = 0;
    }

    // ---- 状态机 ----
    switch (this.state) {
      case 'idle':
        if (this.stateTimer > 1) {
          this.state = 'patrol';
          this.stateTimer = 0;
        }
        break;
      case 'patrol':
        this._updatePatrol(delta);
        break;
      case 'attack':
        this._updateAttack(delta, player, now);
        break;
    }

    // ---- 移动碰撞 ----
    this.physics.resolve(this.position, this.radius, this.height);

    // ---- 同步模型位置 ----
    this.group.position.copy(this.position);
    this.hitMesh.position.copy(this.position);

    // ---- 平滑朝向目标 ----
    if (this.target) {
      const dir = new THREE.Vector3().subVectors(this.target.position, this.position);
      const targetYaw = Math.atan2(dir.x, dir.z);
      this.yaw = this._lerpAngle(this.yaw, targetYaw, 0.1);
    } else if (this._moveDir) {
      const targetYaw = Math.atan2(this._moveDir.x, this._moveDir.z);
      this.yaw = this._lerpAngle(this.yaw, targetYaw, 0.1);
    }
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
   * 巡逻：沿路点移动
   * @private
   */
  _updatePatrol(delta) {
    if (this.patrolPoints.length === 0) return;
    const target = this.patrolPoints[this.patrolIndex];
    const dir = new THREE.Vector3().subVectors(target, this.position);
    dir.y = 0;
    const dist = dir.length();
    if (dist < 1.0) {
      this.patrolIndex = (this.patrolIndex + 1) % this.patrolPoints.length;
      return;
    }
    dir.normalize();
    this._moveDir = dir;
    const speed = 3.0;
    this.position.x += dir.x * speed * delta;
    this.position.z += dir.z * speed * delta;
  }

  /**
   * 攻击：保持距离 + 射击
   * @private
   */
  _updateAttack(delta, player, now) {
    if (!player || !player.isAlive) {
      this.state = 'patrol';
      return;
    }

    const distToPlayer = this.position.distanceTo(player.position);

    // 保持一定距离（15-25 米）
    const dir = new THREE.Vector3().subVectors(player.position, this.position);
    dir.y = 0;
    dir.normalize();
    if (distToPlayer > 25) {
      this.position.x += dir.x * 4.5 * delta;
      this.position.z += dir.z * 4.5 * delta;
      this._moveDir = dir;
    } else if (distToPlayer < 12) {
      this.position.x -= dir.x * 3.0 * delta;
      this.position.z -= dir.z * 3.0 * delta;
      this._moveDir = dir.clone().negate();
    } else {
      // 横向移动（绕侧）
      const sideDir = new THREE.Vector3(-dir.z, 0, dir.x);
      const sign = (this.patrolIndex % 2 === 0) ? 1 : -1;
      this.position.x += sideDir.x * sign * 2.0 * delta;
      this.position.z += sideDir.z * sign * 2.0 * delta;
      this._moveDir = sideDir.multiplyScalar(sign);
    }

    // ---- 射击 ----
    if (distToPlayer < this.weapon.def.range && this.weapon.magAmmo > 0) {
      // AI 射速倍率：相对玩家武器射速的 0.4 倍
      // 这样玩家有更充足的时间反应和移动躲避
      const aiFireRateFactor = 0.4;
      const fireInterval = 1 / (this.weapon.def.fireRate * aiFireRateFactor);
      if (now - this.lastFireTime > fireInterval) {
        this._shootAtPlayer(player, now);
        this.lastFireTime = now;
      }
    }

    // 自动换弹
    if (this.weapon.magAmmo <= 0) {
      this.weapon.startReload(now);
    }
    this.weapon.update(now);
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
      if (this.state !== 'attack') {
        this.state = 'attack';
        this.stateTimer = 0;
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
   * 重生：重置位置、生命、武器
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
    this.group.rotation.x = 0;
    this.group.position.copy(this.position);
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
