/**
 * Player.js - 第一人称玩家控制器
 * --------------------------------------------------------------
 * 职责：
 *  - WASD 移动 + 鼠标视角（Pointer Lock）
 *  - 跳跃 / 蹲伏 / 静步
 *  - 射击（Raycaster 命中判定 + 爆头检测）
 *  - 武器切换 / 换弹 / 后坐力
 *  - 生命值 / 护甲
 *  - 第一人称武器视图模型
 *  - 武器检视系统（按 F 触发动画）
 * --------------------------------------------------------------
 */

import * as THREE from 'three';
import { WeaponInstance, WEAPONS } from './Weapons.js';
import { buildWeaponModel } from './WeaponModels.js';

export class Player {
  /**
   * @param {THREE.Camera} camera 主相机
   * @param {import('../world/Physics.js').Physics} physics 物理系统
   * @param {import('../audio/Audio.js').AudioSystem} audio 音频
   */
  constructor(camera, physics, audio) {
    this.camera = camera;
    this.physics = physics;
    this.audio = audio;

    // ---- 阵营与状态 ----
    this.team = 'ct';
    this.isAlive = true;
    this.isLocalPlayer = true;

    // ---- 位置 / 速度 ----
    this.position = new THREE.Vector3(0, 0, 45);
    this.velocity = new THREE.Vector3();
    this.yaw = Math.PI;   // 朝向 -Z
    this.pitch = 0;
    this.radius = 0.4;
    this.standHeight = 1.7;
    this.crouchHeight = 1.0;
    this.currentHeight = 1.7;
    this.eyeHeight = 1.6;
    this.isOnGround = true;
    this.isCrouching = false;
    this.isWalking = false; // 静步

    // ---- 生命 ----
    this.maxHealth = 100;
    this.health = 100;
    this.armor = 0;
    this.hasHelmet = false;
    this.hasDefuser = false;

    // ---- 战斗统计（用于死亡界面 / 计分板）----
    this.kills = 0;
    this.deaths = 0;
    this.damageDealt = 0;
    this.lastAttacker = null;        // 最后攻击者（用于死亡界面）
    this.lastDamageWasHeadshot = false;

    // ---- 武器 ----
    this.weapons = {};       // slot -> WeaponInstance
    this.currentSlot = '1';  // 1=主武器, 2=副武器, 3=近战, 4=投掷物
    this.grenades = { he: 0, flashbang: 0, smoke: 0, molotov: 0 };
    this._ensureDefaultWeapons();

    // ---- 射击状态 ----
    this.lastShotTime = 0;
    this.lastReloadSoundTime = 0;
    this.footstepDistance = 0;
    this.lastFootstepTime = 0;
    this.firePressConsumed = false; // 半自动武器扳机防抖
    this._jumpKeyWasDown = false;   // 跳跃键边缘检测：仅按下瞬间触发起跳，按住不重复
    // ---- 近战状态 ----
    this._knifeSwingEndTime = 0;    // 挥刀动画结束时间（用于刀身摆动）
    // ---- 投掷物状态 ----
    this._grenadeCharging = false;  // 是否正在蓄力投掷
    this._grenadeChargeStart = 0;   // 蓄力开始时间

    // ---- 武器视图模型 ----
    this.weaponGroup = new THREE.Group();
    this.camera.add(this.weaponGroup);
    this._buildWeaponViewModel();

    // ---- 检视系统 ----
    this.inspectState = {
      active: false,
      progress: 0,
      duration: 2.5,
      spotLight: null
    };

    // ---- 枪口火焰 ----
    this.muzzleFlash = null;
    this.muzzleFlashEndTime = 0;
    this._buildMuzzleFlash();

    // ---- 子弹轨迹系统 ----
    // 对象池：预创建 16 条线，循环复用，避免每帧 GC
    // 子弹轨迹用于可视化射线命中点，提升射击反馈
    // 注意：_tracerGroup 的父节点延迟到 _spawnTracer 第一次调用时挂载
    //       因为 constructor 执行时 camera 可能还未添加到场景树
    this._tracers = [];
    this._tracerGroup = new THREE.Group();
    this._buildTracerPool();

    // ---- 命中标记回调 ----
    this.onHit = null;       // (enemy, point, isHeadshot, damage) => void
    this.onKill = null;      // (enemy, isHeadshot) => void
    this.onDamageDealt = null; // (point, damage, isHeadshot) => void
    this.onFire = null;      // (weaponId) => void
    this.onReloadStart = null;
    this.onReloadComplete = null;
    this.onWeaponChanged = null;
    this.onHurt = null;      // (damage, directionAngle) => void
    this.onDeath = null;
    // ---- 投掷物回调：交由 GrenadeSystem 实现具体效果 ----
    this.onThrowGrenade = null;  // (grenadeId, position, velocity, thrower) => void
  }

  /**
   * 给玩家发放默认武器（手枪 + 匕首）
   * @private
   */
  _ensureDefaultWeapons() {
    const defaultPistol = this.team === 'ct' ? 'usp' : 'glock';
    this.weapons['2'] = new WeaponInstance(defaultPistol);
    // 默认装备战术匕首到 slot 3（近战武器）
    this.weapons['3'] = new WeaponInstance('knife');
  }

  /**
   * 重生：重置位置、生命、武器
   * 注意：此方法会清空所有装备，仅用于新游戏/回合开始时全员重置
   *       存活进入下一局请使用 respawnKeepGear
   * @param {THREE.Vector3} pos 出生点
   */
  respawn(pos) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = this.team === 'ct' ? Math.PI : 0;
    this.pitch = 0;
    this.health = 100;
    this.isAlive = true;
    this.currentHeight = this.standHeight;
    this.isCrouching = false;

    // 重置武器为默认手枪
    this.weapons = {};
    this._ensureDefaultWeapons();
    this.grenades = { he: 0, flashbang: 0, smoke: 0, molotov: 0 };
    this.currentSlot = '2';

    // 重置战斗统计
    this.kills = 0;
    this.deaths = 0;
    this.damageDealt = 0;
    this.lastAttacker = null;
    this.lastDamageWasHeadshot = false;

    // 应用相机
    this._updateCamera();
  }

  /**
   * 存活进入下一局：保留装备（武器/护甲/头盔/拆弹器/手雷），
   * 只重置位置、生命值、状态，并补满所有武器弹匣（CS:GO 规则）
   * @param {THREE.Vector3} pos 出生点
   */
  respawnKeepGear(pos) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = this.team === 'ct' ? Math.PI : 0;
    this.pitch = 0;
    this.health = 100;
    this.isAlive = true;
    this.currentHeight = this.standHeight;
    this.isCrouching = false;
    // 重置射击相关状态
    this.firePressConsumed = false;
    this.lastShotTime = 0;
    // 补满所有武器弹匣（保留武器本身）
    for (const slot in this.weapons) {
      const w = this.weapons[slot];
      if (w && w.def) {
        w.magAmmo = w.def.magSize;
        w.reserveAmmo = w.def.reserveAmmo;
        w.isReloading = false;
        w.lastFireTime = 0;
      }
    }
    // 应用相机
    this._updateCamera();
  }

  /**
   * 购买武器
   * @param {string} weaponId
   * @returns {boolean} 是否成功
   */
  buyWeapon(weaponId) {
    const def = WEAPONS[weaponId];
    if (!def) return false;
    if (def.side !== 'any' && def.side !== this.team) return false;

    if (def.category === 'equipment') {
      if (def.armor) {
        this.armor = def.armor;
        this.hasHelmet = !!def.helmet;
      }
      if (def.defuser) this.hasDefuser = true;
      return true;
    }
    if (def.category === 'grenade') {
      if (this.grenades[weaponId] >= 1) return false;
      this.grenades[weaponId] = 1;
      this.weapons['4'] = new WeaponInstance(weaponId);
      return true;
    }
    // 主武器/副武器
    let slot;
    if (def.category === 'pistol') slot = '2';
    else slot = '1';
    this.weapons[slot] = new WeaponInstance(weaponId);
    if (this.currentSlot !== '1' && this.currentSlot !== '2') {
      this.currentSlot = slot;
    }
    if (this.onWeaponChanged) this.onWeaponChanged(this.getCurrentWeapon());
    return true;
  }

  /**
   * 获取当前武器实例
   * @returns {WeaponInstance|null}
   */
  getCurrentWeapon() {
    return this.weapons[this.currentSlot] || null;
  }

  /**
   * 切换武器槽位
   * @param {string} slot
   */
  switchToSlot(slot) {
    if (!this.weapons[slot]) return;
    if (this.currentSlot === slot) return;
    const w = this.getCurrentWeapon();
    if (w) w.isReloading = false;
    this.currentSlot = slot;
    if (this.onWeaponChanged) this.onWeaponChanged(this.getCurrentWeapon());
  }

  /**
   * 主更新循环
   * @param {number} delta
   * @param {import('../core/Input.js').Input} input
   * @param {Array} enemies 敌人列表（用于射击命中）
   * @param {boolean} frozen 是否冻结（冻结时间）
   */
  update(delta, input, enemies, frozen = false) {
    if (!this.isAlive) return;

    const now = performance.now() / 1000;
    const weapon = this.getCurrentWeapon();

    // ---- 鼠标视角 ----
    if (!frozen && input.pointerLocked) {
      const { dx, dy } = input.consumeMouseDelta();
      this.yaw -= dx * input.sensitivity;
      this.pitch -= dy * input.sensitivity;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    }

    // ---- 后坐力恢复 ----
    if (weapon) {
      weapon.recoverRecoil(delta);
      this.pitch += weapon.recoilPitch * 0.0; // 后坐力直接作用在视角上（外部已加）
    }

    // ---- 移动 ----
    if (!frozen) {
      this._updateMovement(delta, input);
    }

    // ---- 跳跃 + 重力 ----
    this._updateVertical(delta, input, frozen);

    // ---- 武器逻辑 ----
    if (weapon) {
      weapon.update(now);

      // 换弹
      if (input.isDown('KeyR') && !weapon.isReloading) {
        if (weapon.startReload(now)) {
          this.audio.reload();
          if (this.onReloadStart) this.onReloadStart(weapon);
        }
      }

      // 右键开镜（独立于射击，每帧更新）
      this._updateZoom(input, weapon);

      // 射击
      if (input.pointerLocked && !frozen) {
        this._tryShoot(input, weapon, enemies, now);
      }
    }

    // ---- 武器视图模型动画 ----
    this._updateWeaponViewModel(delta, input, now);

    // ---- 检视动画 ----
    this._updateInspect(delta, input, now);

    // ---- 枪口火焰 ----
    this._updateMuzzleFlash(now);

    // ---- 子弹轨迹淡出 ----
    this._updateTracers(now);

    // ---- 应用到相机 ----
    this._updateCamera();
  }

  /**
   * 更新水平移动
   * @private
   */
  _updateMovement(delta, input) {
    const speed = this._getMoveSpeed();
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // forward 朝向 -Z 时 yaw=PI，sin(PI)=0, cos(PI)=-1 → (0,0,-1) ✓
    // 但我们的 yaw 约定：相机朝 -Z 时 yaw=0（默认）。重新推导：
    // 设 camera.rotation.y = yaw，相机初始面向 -Z，yaw=PI 应面向 +Z
    // 为简化：直接用相机方向
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    camDir.y = 0; camDir.normalize();
    const right = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();

    const move = new THREE.Vector3();
    if (input.isDown('KeyW')) move.add(camDir);
    if (input.isDown('KeyS')) move.sub(camDir);
    if (input.isDown('KeyD')) move.add(right);
    if (input.isDown('KeyA')) move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * delta);
      this.isWalking = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      this.position.x += move.x;
      this.position.z += move.z;

      // 脚步声
      this.footstepDistance += move.length();
      const stepInterval = this.isWalking ? 0.7 : 0.35;
      if (performance.now() / 1000 - this.lastFootstepTime > stepInterval) {
        if (this.isOnGround) {
          this.audio.footstep(!this.isWalking && !this.isCrouching);
          this.lastFootstepTime = performance.now() / 1000;
        }
      }
    } else {
      this.isWalking = false;
    }

    // 蹲伏
    this.isCrouching = input.isDown('ControlLeft') || input.isDown('ControlRight');
    const targetHeight = this.isCrouching ? this.crouchHeight : this.standHeight;
    this.currentHeight += (targetHeight - this.currentHeight) * 0.2;

    // 碰撞解决
    this.physics.resolve(this.position, this.radius, this.currentHeight);
  }

  /**
   * 获取当前移动速度
   * @private
   */
  _getMoveSpeed() {
    let base = 5.5; // m/s
    if (this.isCrouching) base = 2.5;
    if (this.isWalking) base = 2.2;
    // 拿狙击枪移动慢
    const w = this.getCurrentWeapon();
    if (w && w.def.category === 'sniper') base *= 0.85;
    if (w && w.def.id === 'awp') base *= 0.85;
    return base;
  }

  /**
   * 更新垂直运动（跳跃 + 重力）
   * 防连跳关键：使用按键边缘检测（按下瞬间触发，按住不重复）
   *             玩家按住 Space 落地后不会自动再跳，必须松开重新按下
   * @param {number} delta 帧间隔（秒）
   * @param {import('../core/Input.js').Input} input 输入系统
   * @param {boolean} frozen 是否冻结（冻结时间不允许操作）
   * @private
   */
  _updateVertical(delta, input, frozen) {
    // 重力增大到 30，让下落更快、跳跃更短促（接近 CS:GO 手感）
    const gravity = 30;
    const jumpVelocity = 6.0;

    // ---- 跳跃输入：边缘检测（仅按下瞬间触发，按住不重复）----
    const spaceDown = !frozen && input.isDown('Space');
    const spaceJustPressed = spaceDown && !this._jumpKeyWasDown;
    this._jumpKeyWasDown = spaceDown;
    if (spaceJustPressed && this.isOnGround) {
      this.velocity.y = jumpVelocity;
      this.isOnGround = false;  // 起跳瞬间清除落地标志
    }

    // ---- 应用重力 ----
    this.velocity.y -= gravity * delta;
    // 限制最大下落速度，避免穿透地面
    if (this.velocity.y < -30) this.velocity.y = -30;
    this.position.y += this.velocity.y * delta;

    // ---- 落地检测：先假设在空中，再判定是否真的踩到表面 ----
    this.isOnGround = false;

    // 1) 地面：脚部低于地面高度
    if (this.position.y <= 0) {
      this.position.y = 0;
      this.velocity.y = 0;
      this.isOnGround = true;
    } else {
      // 2) 箱顶：让物理解决，只有当 y 被实际抬高时才判定为踩到箱顶
      //    关键：若物理解决未改变 y（玩家在空中无碰撞），不能误判为落地
      const prevY = this.position.y;
      this.physics.resolve(this.position, this.radius, this.currentHeight);
      // 物理解决后 y 被抬高（托住了下落的玩家），说明踩到了箱顶
      if (this.position.y > prevY + 0.001 && this.velocity.y <= 0) {
        this.velocity.y = 0;
        this.isOnGround = true;
      }
    }
  }

  /**
   * 尝试射击 / 近战 / 投掷
   * 根据武器类别分派到不同处理流程：
   *  - melee（近战）：调用 _meleeAttack 进行短距离挥砍
   *  - grenade（投掷物）：调用 _throwGrenade 进行抛物线投掷
   *  - 其他（枪械）：原射线射击逻辑
   * @private
   */
  _tryShoot(input, weapon, enemies, now) {
    // ---- 近战武器（匕首）：左键挥砍 ----
    if (weapon.def.category === 'melee') {
      this._meleeAttack(input, weapon, enemies, now);
      return;
    }

    // ---- 投掷物（手雷）：左键按住蓄力、松开投掷 ----
    if (weapon.def.category === 'grenade') {
      this._throwGrenade(input, weapon, enemies, now);
      return;
    }

    // ---- 枪械：原有逻辑 ----
    const triggerDown = input.isMouseDown(0);
    if (!weapon.def.automatic) {
      // 半自动：扳机按下瞬间触发
      if (!triggerDown) this.firePressConsumed = false;
      if (this.firePressConsumed) return;
      if (!triggerDown) return;
    }

    // 注意：开镜缩放逻辑已迁移到 _updateZoom，独立于射击触发
    // 这样即使未扣扳机也能右键开镜（AWP 等狙击枪需要）
    if (!triggerDown) return;
    if (weapon.magAmmo <= 0) {
      // 弹匣空了，自动尝试换弹
      if (!weapon.isReloading) weapon.startReload(now);
      return;
    }

    const fired = weapon.tryFire(now, triggerDown);
    if (!fired) return;
    if (!weapon.def.automatic) this.firePressConsumed = true;

    // ---- 后坐力 ----
    const recoil = weapon.applyRecoil();
    this.pitch += recoil.pitch;
    this.yaw += recoil.yaw;
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));

    // ---- 音效 ----
    this.audio.gunshot(weapon.id);
    if (this.onFire) this.onFire(weapon.id);

    // ---- 枪口火焰 ----
    this.muzzleFlashEndTime = now + 0.05;
    if (this.muzzleFlash) this.muzzleFlash.visible = true;

    // ---- 射线检测 ----
    this._fireRaycast(weapon, enemies);

    // 霰弹枪多发弹丸
    if (weapon.def.pellets && weapon.def.pellets > 1) {
      for (let i = 1; i < weapon.def.pellets; i++) {
        this._fireRaycast(weapon, enemies);
      }
    }
  }

  /**
   * 近战攻击（匕首挥砍）
   * 实现：
   *  - 左键按下瞬间触发（边缘检测，按住不重复）
   *  - 短射线检测前方 2.5m 内的敌人
   *  - 命中后造成 55 点伤害（爆头 2.5x = 137）
   *  - 攻击间隔 0.5 秒（防止快速连点）
   *  - 挥刀动画：weaponModelGroup 短时间旋转
   * @param {import('../core/Input.js').Input} input
   * @param {WeaponInstance} weapon 匕首武器实例
   * @param {Array} enemies 敌人列表
   * @param {number} now 当前时间（秒）
   * @private
   */
  _meleeAttack(input, weapon, enemies, now) {
    const triggerDown = input.isMouseDown(0);

    // 边缘检测：左键按下瞬间触发
    if (!triggerDown) {
      this.firePressConsumed = false;
      return;
    }
    if (this.firePressConsumed) return;

    // 攻击间隔控制（fireRate=2 → 间隔 0.5s）
    const interval = 1 / weapon.def.fireRate;
    if (now - weapon.lastFireTime < interval) return;

    this.firePressConsumed = true;
    weapon.lastFireTime = now;

    // ---- 挥刀动画：触发短时间摆动 ----
    this._knifeSwingEndTime = now + 0.25;

    // ---- 短射线检测前方敌人 ----
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    raycaster.far = weapon.def.range;  // 2.5m

    // 检测敌人命中
    const enemyMeshes = enemies.filter(e => e.isAlive).map(e => e.hitMesh);
    const enemyHits = raycaster.intersectObjects(enemyMeshes, true);

    // 检测墙壁（避免穿墙砍人）
    const wallHits = this.physics.raycastBoxes(raycaster.ray, weapon.def.range);
    const wallDist = wallHits.length > 0 ? wallHits[0].distance : Infinity;

    // ---- 命中判定 ----
    if (enemyHits.length > 0 && enemyHits[0].distance < wallDist) {
      const hit = enemyHits[0];
      const enemy = hit.object.userData.enemy || hit.object.parent?.userData?.enemy;
      if (enemy && enemy.isAlive) {
        // 爆头判定：命中点 y 高于敌人位置 1.5m
        const isHeadshot = hit.point.y > enemy.position.y + 1.5;
        const damage = isHeadshot
          ? weapon.def.damage * weapon.def.headshotMultiplier
          : weapon.def.damage;

        const killed = enemy.takeDamage(damage, this);

        // 命中反馈
        if (this.onHit) this.onHit(enemy, hit.point, isHeadshot, damage);
        if (this.killFeed) this.killFeed.showFloatingDamage(hit.point, damage, isHeadshot);
        if (this.crosshair) this.crosshair.showHit(isHeadshot);

        // 击杀
        if (killed) {
          this.kills++;
          if (this.onKill) this.onKill(enemy, isHeadshot);
        }

        // 近战音效
        this.audio.hit();
      }
    } else {
      // 挥空音效（轻微）
      // 暂复用 uiTick 作为挥刀声
      this.audio.uiTick();
    }

    if (this.onFire) this.onFire(weapon.id);
  }

  /**
   * 投掷手雷
   * 实现：
   *  - 左键按下开始蓄力（_grenadeChargeStart 记录时间）
   *  - 左键松开投掷（力度根据按住时长 0~1s 对应 5~15 m/s）
   *  - 创建投掷物对象交由 GrenadeSystem 管理
   *  - 投掷后从 grenades 字典减 1，自动切换到上一武器
   * @param {import('../core/Input.js').Input} input
   * @param {WeaponInstance} weapon 投掷物武器实例
   * @param {Array} enemies 敌人列表
   * @param {number} now 当前时间（秒）
   * @private
   */
  _throwGrenade(input, weapon, enemies, now) {
    const triggerDown = input.isMouseDown(0);

    // 按下瞬间：开始蓄力
    if (triggerDown && !this._grenadeCharging) {
      this._grenadeCharging = true;
      this._grenadeChargeStart = now;
      return;
    }

    // 松开瞬间：投掷
    if (!triggerDown && this._grenadeCharging) {
      this._grenadeCharging = false;
      const chargeTime = Math.min(1.0, now - this._grenadeChargeStart);
      // 力度 5~15 m/s（蓄力 0~1 秒）
      const power = 5 + chargeTime * 10;

      // 检查是否还有该类手雷
      const grenadeId = weapon.def.id;
      if (this.grenades[grenadeId] <= 0) return;

      // 计算投掷初速度（沿相机朝向 + 一点上扬）
      const camDir = new THREE.Vector3();
      this.camera.getWorldDirection(camDir);
      const vel = camDir.clone().multiplyScalar(power);
      vel.y += 2.0;  // 上扬分量，让弹道更接近抛物线

      // 投掷起点：相机位置 + 前方偏移
      const startPos = this.camera.position.clone().add(camDir.clone().multiplyScalar(0.5));

      // 委托给 GrenadeSystem 投掷（如果有挂载）
      if (this.onThrowGrenade) {
        this.onThrowGrenade(grenadeId, startPos, vel, this);
      }

      // 消耗一枚手雷
      this.grenades[grenadeId]--;
      // 从 weapons 中移除该手雷（投完即没）
      if (this.grenades[grenadeId] <= 0) {
        delete this.weapons['4'];
        // 自动切回上一武器（主武器 → 副武器 → 匕首）
        if (this.weapons['1']) this.switchToSlot('1');
        else if (this.weapons['2']) this.switchToSlot('2');
        else if (this.weapons['3']) this.switchToSlot('3');
      } else {
        // 还有同类手雷，重建武器实例（让玩家可继续投掷）
        this.weapons['4'] = new WeaponInstance(grenadeId);
        this._rebuildWeaponModel();
      }

      if (this.onWeaponChanged) this.onWeaponChanged(this.getCurrentWeapon());
    }
  }

  /**
   * 更新右键开镜缩放
   * 独立于射击逻辑，确保 AWP 等狙击枪随时可右键开镜
   * @param {import('../core/Input.js').Input} input
   * @param {WeaponInstance|null} weapon 当前武器
   * @private
   */
  _updateZoom(input, weapon) {
    if (!weapon) return;
    // 仅当武器支持缩放（zoomFactor > 1）且右键按下时才开镜
    const zooming = input.isMouseDown(2) && weapon.def.zoomFactor > 1;
    const targetFov = zooming ? 75 / weapon.def.zoomFactor : 75;
    // 平滑插值
    this.camera.fov += (targetFov - this.camera.fov) * 0.2;
    this.camera.updateProjectionMatrix();
  }

  /**
   * 发射一根射线检测命中
   * @private
   */
  _fireRaycast(weapon, enemies) {
    // 从屏幕中心发射
    const raycaster = new THREE.Raycaster();
    // 散布
    const spread = weapon.def.spread * (this._isMoving() ? weapon.def.moveSpreadFactor : 1);
    const ndcX = (Math.random() - 0.5) * spread * 2;
    const ndcY = (Math.random() - 0.5) * spread * 2;
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    raycaster.far = weapon.def.range;

    // 检测敌人
    const enemyMeshes = enemies.filter(e => e.isAlive).map(e => e.hitMesh);
    const enemyHits = raycaster.intersectObjects(enemyMeshes, true);

    // 检测墙壁（避免穿墙打人）
    const wallHits = this.physics.raycastBoxes(raycaster.ray, weapon.def.range);

    const wallDist = wallHits.length > 0 ? wallHits[0].distance : Infinity;
    const enemyDist = enemyHits.length > 0 ? enemyHits[0].distance : Infinity;

    // ---- 计算枪口世界坐标（用于子弹轨迹起点）----
    const muzzleWorld = new THREE.Vector3();
    if (this.muzzleFlash) {
      this.muzzleFlash.getWorldPosition(muzzleWorld);
    } else {
      this.camera.getWorldPosition(muzzleWorld);
    }

    // ---- 决定轨迹终点 ----
    // 优先：敌人命中点 > 墙壁命中点 > 射程终点
    let tracerEnd = null;
    if (enemyDist < wallDist && enemyHits.length > 0) {
      const hit = enemyHits[0];
      tracerEnd = hit.point.clone();

      // 防御性查找：从命中对象向上查找 userData.enemy
      // （正常情况下子 mesh 自带 userData.enemy，此为保险措施）
      let enemyObj = hit.object;
      while (enemyObj && !enemyObj.userData.enemy) enemyObj = enemyObj.parent;
      const enemy = enemyObj?.userData.enemy;
      if (!enemy || !enemy.isAlive) {
        // 敌人无效，但仍画一条轨迹到命中点
      } else {
        // 爆头判定：优先用 hit.object.userData.isHead，回退到高度判定
        const isHeadshot = !!(hit.object.userData.isHead || hit.object.userData.part === 'head');
        const damage = weapon.def.damage * (isHeadshot ? weapon.def.headshotMultiplier : 1);
        const finalDamage = Math.round(damage);

        // 通知敌人受伤
        const killed = enemy.takeDamage(finalDamage, this);

        // 累计伤害统计（用于死亡界面 / 计分板）
        this.damageDealt = (this.damageDealt || 0) + finalDamage;
        if (killed) this.kills = (this.kills || 0) + 1;

        if (this.onDamageDealt) this.onDamageDealt(hit.point.clone(), finalDamage, isHeadshot);
        if (this.onHit) this.onHit(enemy, hit.point.clone(), isHeadshot, finalDamage);
        if (killed && this.onKill) this.onKill(enemy, isHeadshot);
      }
    } else if (wallHits.length > 0) {
      // 命中墙壁
      tracerEnd = wallHits[0].point.clone();
    } else {
      // 都没命中：画到射程终点
      tracerEnd = raycaster.ray.origin.clone()
        .add(raycaster.ray.direction.clone().multiplyScalar(weapon.def.range));
    }

    // 生成子弹轨迹
    this._spawnTracer(muzzleWorld, tracerEnd);
  }

  /**
   * 玩家是否在移动
   * @private
   */
  _isMoving() {
    const w = ['KeyW', 'KeyS', 'KeyA', 'KeyD'];
    for (const k of w) {
      if (this.keys && this.keys.has(k)) return true;
    }
    // 这里直接通过 velocity 判断更可靠
    return Math.abs(this.velocity.x) + Math.abs(this.velocity.z) > 0.1 ||
           this._inputMoving;
  }

  /**
   * 接收外部输入移动状态
   * @param {import('../core/Input.js').Input} input
   * @private
   */
  // (此处 _isMoving 改为依赖外部传入)
  set inputMoving(v) { this._inputMoving = v; }

  /**
   * 玩家受伤
   * @param {number} damage 原始伤害
   * @param {THREE.Vector3} fromDirection 来源方向（攻击者位置）
   * @param {boolean} headshot 是否爆头
   * @param {Object} attacker 攻击者对象（EnemyAI 实例，用于死亡界面展示）
   * @returns {boolean} 是否死亡
   */
  takeDamage(damage, fromDirection, headshot = false, attacker = null) {
    if (!this.isAlive) return false;

    // 记录最后攻击者信息（用于死亡界面展示）
    if (attacker) {
      this.lastAttacker = attacker;
      this.lastDamageWasHeadshot = !!headshot;
    }

    let dmg = damage;
    // 护甲吸收
    if (this.armor > 0) {
      if (headshot && this.hasHelmet) {
        const absorbed = dmg * 0.7;
        this.armor -= absorbed * 0.5;
        dmg = dmg * 0.3 + dmg * 0.3; // 简化
      } else if (this.armor > 0) {
        const absorbed = dmg * 0.5;
        this.armor -= absorbed * 0.5;
        dmg = dmg * 0.5;
      }
      this.armor = Math.max(0, this.armor);
    }

    this.health -= dmg;
    this.audio.playerHurt();

    // 计算受击方向（屏幕角度）
    const dir = new THREE.Vector3().subVectors(fromDirection, this.position).normalize();
    const angle = Math.atan2(dir.x, dir.z) - this.yaw;

    if (this.onHurt) this.onHurt(dmg, angle);

    if (this.health <= 0) {
      this.health = 0;
      this.isAlive = false;
      // 死亡回调传攻击者与爆头标志，供 Game 显示死亡界面
      if (this.onDeath) this.onDeath(attacker, !!headshot);
      return true;
    }
    return false;
  }

  /**
   * 更新相机位置与朝向
   * @private
   */
  _updateCamera() {
    this.camera.position.set(
      this.position.x,
      this.position.y + this.eyeHeight * (this.currentHeight / this.standHeight),
      this.position.z
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  /**
   * 构建第一人称武器视图模型
   * @private
   */
  _buildWeaponViewModel() {
    // 主体：根据 modelType 创建简化几何
    this.weaponModelGroup = new THREE.Group();
    this.weaponGroup.add(this.weaponModelGroup);

    // 待机位置（屏幕右下角）
    this.weaponGroup.position.set(0.25, -0.22, -0.5);
    this.weaponGroup.rotation.set(0, 0, 0);

    this._rebuildWeaponModel();
  }

  /**
   * 重建当前武器的视图模型
   * 使用 WeaponModels.js 模块为每把武器构建独特、细化的模型
   * @private
   */
  _rebuildWeaponModel() {
    // 清空旧模型（递归释放几何体和材质，避免内存泄漏）
    while (this.weaponModelGroup.children.length > 0) {
      const c = this.weaponModelGroup.children[0];
      this.weaponModelGroup.remove(c);
      c.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
          else o.material.dispose();
        }
      });
    }

    const w = this.getCurrentWeapon();
    if (!w) return;

    // 委托给 WeaponModels 模块构建（按 weaponId 分派到专属构建函数）
    const modelGroup = buildWeaponModel(w.def.id, this.team);
    this.weaponModelGroup.add(modelGroup);
  }

  /**
   * 构建枪口火焰
   * @private
   */
  _buildMuzzleFlash() {
    const geo = new THREE.SphereGeometry(0.05, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xFFCC44, transparent: true, opacity: 0.9
    });
    this.muzzleFlash = new THREE.Mesh(geo, mat);
    this.muzzleFlash.position.set(0, 0.02, -0.7);
    this.muzzleFlash.visible = false;
    this.weaponGroup.add(this.muzzleFlash);

    // 点光源
    this.muzzleLight = new THREE.PointLight(0xFFAA44, 0, 5);
    this.muzzleLight.position.set(0, 0, -0.7);
    this.weaponGroup.add(this.muzzleLight);
  }

  /**
   * 构建子弹轨迹对象池
   * 预创建 16 条 Line，通过 visible + opacity 控制显隐
   * 每条轨迹使用 BufferAttribute 预分配 6 个 float（2 个端点）
   * @private
   */
  _buildTracerPool() {
    const POOL_SIZE = 16;
    const TRACER_LIFETIME = 0.06; // 单条轨迹存活时间（秒）
    for (let i = 0; i < POOL_SIZE; i++) {
      // 预分配 2 个端点（6 个 float）
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xFFEE88,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      this._tracerGroup.add(line);
      this._tracers.push({
        line, geo, mat,
        active: false,
        expireTime: 0,
        lifetime: TRACER_LIFETIME
      });
    }
  }

  /**
   * 生成一条子弹轨迹（从枪口到命中点）
   * @param {THREE.Vector3} from 起点世界坐标
   * @param {THREE.Vector3} to 终点世界坐标
   * @private
   */
  _spawnTracer(from, to) {
    // 懒挂载：第一次调用时把 _tracerGroup 加到场景根
    // 此时 camera 必然已经被 Game.init 加到场景中
    if (!this._tracerGroup.parent && this.camera.parent) {
      this.camera.parent.add(this._tracerGroup);
    }

    // 找一个空闲槽位，全占用则覆盖最老的
    let slot = this._tracers.find(s => !s.active);
    if (!slot) slot = this._tracers[0];

    const positions = slot.geo.attributes.position.array;
    positions[0] = from.x; positions[1] = from.y; positions[2] = from.z;
    positions[3] = to.x;   positions[4] = to.y;   positions[5] = to.z;
    slot.geo.attributes.position.needsUpdate = true;
    slot.mat.opacity = 0.9;
    slot.line.visible = true;
    slot.active = true;
    slot.expireTime = performance.now() / 1000 + slot.lifetime;
  }

  /**
   * 更新所有轨迹的淡出/回收
   * @param {number} now 当前时间（秒）
   * @private
   */
  _updateTracers(now) {
    for (const slot of this._tracers) {
      if (!slot.active) continue;
      const remain = slot.expireTime - now;
      if (remain <= 0) {
        slot.active = false;
        slot.line.visible = false;
      } else {
        // 线性淡出
        slot.mat.opacity = 0.9 * (remain / slot.lifetime);
      }
    }
  }

  /**
   * 更新枪口火焰
   * @private
   */
  _updateMuzzleFlash(now) {
    if (this.muzzleFlash.visible && now > this.muzzleFlashEndTime) {
      this.muzzleFlash.visible = false;
      this.muzzleLight.intensity = 0;
    } else if (this.muzzleFlash.visible) {
      this.muzzleLight.intensity = 2;
      this.muzzleFlash.scale.setScalar(0.8 + Math.random() * 0.5);
      this.muzzleFlash.rotation.z = Math.random() * Math.PI;
    }
  }

  /**
   * 武器视图模型动画（待机晃动 + 移动摆动 + 换弹旋转）
   * @private
   */
  _updateWeaponViewModel(delta, input, now) {
    // 触发武器模型重建（如果切了武器）
    if (this._lastWeaponSlot !== this.currentSlot) {
      this._lastWeaponSlot = this.currentSlot;
      this._rebuildWeaponModel();
    }

    if (this.inspectState.active) return; // 检视时跳过普通动画

    const w = this.getCurrentWeapon();
    if (!w) return;

    // 待机呼吸效果
    const breath = Math.sin(now * 2) * 0.005;
    const breathY = Math.sin(now * 2 + 0.5) * 0.005;

    // 移动摆动
    const moving = input.isDown('KeyW') || input.isDown('KeyS') ||
                   input.isDown('KeyA') || input.isDown('KeyD');
    const bobAmount = moving ? (this.isWalking ? 0.005 : 0.015) : 0;
    const bobX = Math.sin(now * (this.isWalking ? 6 : 10)) * bobAmount;
    const bobY = Math.abs(Math.sin(now * (this.isWalking ? 6 : 10))) * bobAmount;

    // 换弹动画
    let reloadOffset = 0;
    let reloadRot = 0;
    if (w.isReloading) {
      const t = w.getReloadProgress(now);
      // 一个上下翻转的简单曲线
      reloadOffset = -Math.sin(t * Math.PI) * 0.15;
      reloadRot = Math.sin(t * Math.PI * 2) * 0.3;
    }

    // 后坐力反冲
    const recoilOffset = w.recoilPitch * 0.5;

    this.weaponGroup.position.set(
      0.25 + bobX,
      -0.22 + breath + bobY + reloadOffset - recoilOffset * 0.5,
      -0.5
    );
    this.weaponGroup.rotation.set(
      breath * 2 + reloadRot,
      0,
      0
    );

    // ---- 匕首挥砍动画 ----
    // 触发 _knifeSwingEndTime 后的 0.25 秒内，刀身做向下劈砍动作
    if (this._knifeSwingEndTime > now) {
      const remain = this._knifeSwingEndTime - now;
      const totalDur = 0.25;
      const t = 1 - remain / totalDur;  // 0→1 进度
      // 半正弦曲线：前半段下劈，后半段回弹
      const swing = Math.sin(t * Math.PI);  // 0→1→0
      // 应用绕 X 轴旋转（向下劈砍）+ 一点 Z 轴摆动
      this.weaponGroup.rotation.x -= swing * 0.8;
      this.weaponGroup.rotation.z += swing * 0.3;
      // 同时让刀身向前推一点（增强冲击感）
      this.weaponGroup.position.z -= swing * 0.1;
    }

    // ---- 投掷物蓄力动画（手微微后拉）----
    if (this._grenadeCharging) {
      const chargeTime = Math.min(1.0, now - this._grenadeChargeStart);
      const pull = chargeTime * 0.15;
      this.weaponGroup.position.y -= pull;
      this.weaponGroup.position.z += pull * 0.5;
      this.weaponGroup.rotation.x -= pull * 0.5;
    }
  }

  /**
   * 触发武器检视
   * @param {number} now
   */
  startInspect(now) {
    if (this.inspectState.active) return;
    this.inspectState.active = true;
    this.inspectState.progress = 0;
    this.inspectState.startTime = now;
  }

  /**
   * 更新检视动画
   * @private
   */
  _updateInspect(delta, input, now) {
    const s = this.inspectState;
    if (!s.active) {
      // 检查是否触发
      return;
    }
    s.progress += delta / s.duration;

    // 智能打断：射击/移动/切武器
    const w = this.getCurrentWeapon();
    if (input.isMouseDown(0) || input.isDown('KeyW') || input.isDown('KeyS') ||
        input.isDown('KeyA') || input.isDown('KeyD') || input.isDown('Space')) {
      s.progress = Math.max(s.progress, 0.85); // 快进到复位
    }

    if (s.progress >= 1) {
      s.active = false;
      s.progress = 0;
      return;
    }

    const t = s.progress;
    let posX = 0.25, posY = -0.22, posZ = -0.5;
    let rotX = 0, rotY = 0, rotZ = 0;

    // 阶段 1 (0-0.2)：抬起
    if (t < 0.2) {
      const k = t / 0.2;
      posX = 0.25;
      posY = -0.22 + k * 0.15;
      posZ = -0.5 + k * 0.2;
      rotX = -k * 0.5;
    }
    // 阶段 2 (0.2-0.8)：翻转展示
    else if (t < 0.8) {
      const k = (t - 0.2) / 0.6;
      posX = 0.25;
      posY = -0.07 + Math.sin(k * Math.PI * 2) * 0.02;
      posZ = -0.3;
      rotX = -0.5;
      rotY = k * Math.PI * 2;
      rotZ = Math.sin(k * Math.PI * 4) * 0.25;
    }
    // 阶段 3 (0.8-1.0)：复位（弹簧）
    else {
      const k = (t - 0.8) / 0.2;
      const ease = 1 - Math.pow(1 - k, 3);
      posX = 0.25;
      posY = -0.07 + ease * (-0.15);
      posZ = -0.3 + ease * (-0.2);
      rotX = -0.5 + ease * 0.5;
      rotY = 0;
      rotZ = 0;
      // 弹簧余震
      if (k > 0.7) {
        const bounce = Math.sin((k - 0.7) * 30) * (1 - k) * 0.4;
        rotX += bounce;
      }
    }

    this.weaponGroup.position.set(posX, posY, posZ);
    this.weaponGroup.rotation.set(rotX, rotY, rotZ);
  }

  /**
   * 获取当前武器数据（用于 HUD）
   * @returns {Object}
   */
  getWeaponState() {
    const w = this.getCurrentWeapon();
    if (!w) return { name: '—', mag: 0, reserve: 0, isReloading: false, reloadProgress: 0 };
    const now = performance.now() / 1000;
    return {
      name: w.def.name,
      id: w.id,
      mag: w.magAmmo,
      reserve: w.reserveAmmo,
      isReloading: w.isReloading,
      reloadProgress: w.getReloadProgress(now),
      category: w.def.category,
      side: w.def.side
    };
  }

  /**
   * 获取玩家状态快照（HUD 用）
   */
  getStats() {
    return {
      health: Math.ceil(this.health),
      armor: Math.ceil(this.armor),
      isAlive: this.isAlive,
      isCrouching: this.isCrouching,
      isWalking: this.isWalking,
      isMoving: this._inputMoving || false
    };
  }
}
