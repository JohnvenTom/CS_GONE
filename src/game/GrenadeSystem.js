/**
 * GrenadeSystem.js - 投掷物系统
 * --------------------------------------------------------------
 * 职责：
 *  - 管理所有已投掷的手雷（HE/闪光/烟雾/燃烧）
 *  - 抛物线物理：重力 + 地面/墙体反弹
 *  - 引信计时：到期触发对应效果
 *  - 视觉效果：爆炸粒子、烟雾云、火焰区域、闪光白屏
 *  - 范围伤害：HE 爆炸伤害所有敌方单位，燃烧弹持续伤害
 *
 * 使用方式：
 *   const gs = new GrenadeSystem(scene, physics, audio);
 *   gs.throw('he', startPos, velocity, thrower, enemies, player);
 *   engine.onUpdate((d) => gs.update(d, enemies, player));
 * --------------------------------------------------------------
 */

import * as THREE from 'three';

/**
 * 投掷物系统
 */
export class GrenadeSystem {
  /**
   * @param {THREE.Scene} scene 场景引用（用于添加/移除 mesh）
   * @param {import('../world/Physics.js').Physics} physics 物理系统（用于墙体碰撞）
   * @param {import('../audio/Audio.js').AudioSystem} audio 音频系统
   */
  constructor(scene, physics, audio) {
    this.scene = scene;
    this.physics = physics;
    this.audio = audio;

    /** @type {Array<Grenade>} 活跃的投掷物列表 */
    this.grenades = [];
    /** @type {Array<Effect>} 活跃的效果（爆炸/烟雾/火焰）列表 */
    this.effects = [];

    // 预创建闪光白屏 DOM（默认隐藏）
    this._createFlashOverlay();

    // 预创建烟雾材质（共享，避免每枚手雷都新建）
    this._smokeMat = new THREE.MeshBasicMaterial({
      color: 0xcccccc,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
    });
    this._fireMat = new THREE.MeshBasicMaterial({
      color: 0xff6020,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
  }

  /**
   * 创建闪光弹全屏白屏 DOM
   * @private
   */
  _createFlashOverlay() {
    const div = document.createElement('div');
    div.id = 'flash-overlay';
    div.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: white; pointer-events: none; z-index: 90;
      opacity: 0; transition: opacity 0.05s;
    `;
    document.body.appendChild(div);
    this.flashOverlay = div;
  }

  /**
   * 投掷一枚手雷
   * @param {string} type 手雷类型：'he' | 'flashbang' | 'smoke' | 'molotov'
   * @param {THREE.Vector3} position 起始位置
   * @param {THREE.Vector3} velocity 初速度
   * @param {Object} thrower 投掷者（玩家或 EnemyAI）
   * @param {Array} enemies 敌人列表（用于爆炸时伤害判定）
   * @param {Object} player 玩家对象（用于闪光/燃烧影响玩家）
   */
  throw(type, position, velocity, thrower, enemies = [], player = null) {
    // 视觉 mesh：根据类型选择颜色
    const colorMap = {
      he: 0x2d5a2d,        // 橄榄绿
      flashbang: 0xe8e8e8, // 白色
      smoke: 0x4a4a4a,     // 深灰
      molotov: 0xc04020    // 橙红
    };
    const color = colorMap[type] || 0x666666;

    // 弹体几何（小球）
    const geo = new THREE.SphereGeometry(0.06, 12, 12);
    const mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.5,
      metalness: 0.3,
      emissive: 0x111111
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.castShadow = true;
    this.scene.add(mesh);

    // 引信时长（秒）：HE 1.5s，闪光 1.5s，烟雾 2.0s，燃烧 1.2s
    const fuseMap = { he: 1.5, flashbang: 1.5, smoke: 2.0, molotov: 1.2 };
    const fuse = fuseMap[type] || 1.5;

    // 创建投掷物对象
    /** @type {Grenade} */
    const grenade = {
      type,
      mesh,
      position: position.clone(),
      velocity: velocity.clone(),
      thrower,
      fuseTime: fuse,
      landed: false,
      bounces: 0,
      enemies,
      player
    };
    this.grenades.push(grenade);
  }

  /**
   * 主更新循环
   * @param {number} delta 帧间隔（秒）
   * @param {Array} enemies 当前敌人列表（用于爆炸伤害判定）
   * @param {Object} player 玩家对象（用于闪光/燃烧影响玩家）
   */
  update(delta, enemies, player) {
    // ---- 更新所有投掷物 ----
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      // 更新敌人/玩家引用（防止过期）
      g.enemies = enemies;
      g.player = player;

      // 引信计时
      g.fuseTime -= delta;

      // 物理：抛物线 + 碰撞
      if (!g.landed) {
        // 重力
        g.velocity.y -= 20 * delta;
        // 位移
        g.position.x += g.velocity.x * delta;
        g.position.y += g.velocity.y * delta;
        g.position.z += g.velocity.z * delta;

        // 地面碰撞（y=0 为地面）
        if (g.position.y <= 0.05) {
          g.position.y = 0.05;
          // 反弹（衰减）
          if (Math.abs(g.velocity.y) > 1.0) {
            g.velocity.y = -g.velocity.y * 0.4;
            g.velocity.x *= 0.6;
            g.velocity.z *= 0.6;
            g.bounces++;
          } else {
            // 速度太小，停止滚动
            g.velocity.set(0, 0, 0);
            g.landed = true;
          }
        } else {
          // 墙体碰撞检测：检查是否进入某个 box
          // 简化处理：每帧检查一次，若进入 box 则反弹
          const insideBox = this.physics.isInsideAnyBox(g.position);
          if (insideBox) {
            // 推回上一帧位置并反弹
            g.position.x -= g.velocity.x * delta;
            g.position.z -= g.velocity.z * delta;
            g.velocity.x = -g.velocity.x * 0.4;
            g.velocity.z = -g.velocity.z * 0.4;
          }
        }

        // 滚动衰减
        if (g.landed) {
          // 已落地，速度归零（避免无限滚动）
        }

        // 同步 mesh 位置
        g.mesh.position.copy(g.position);
        // 旋转效果（飞行中翻滚）
        if (!g.landed) {
          g.mesh.rotation.x += delta * 8;
          g.mesh.rotation.y += delta * 6;
        }
      }

      // 引信到期：触发效果
      if (g.fuseTime <= 0) {
        this._detonate(g);
        // 移除投掷物 mesh
        this.scene.remove(g.mesh);
        g.mesh.geometry.dispose();
        g.mesh.material.dispose();
        this.grenades.splice(i, 1);
      }
    }

    // ---- 更新所有效果（爆炸/烟雾/火焰）----
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= delta;
      this._updateEffect(e, delta);

      if (e.life <= 0) {
        this._cleanupEffect(e);
        this.effects.splice(i, 1);
      }
    }
  }

  /**
   * 触发手雷效果
   * @param {Grenade} g 投掷物
   * @private
   */
  _detonate(g) {
    switch (g.type) {
      case 'he':
        this._explodeHE(g);
        break;
      case 'flashbang':
        this._flashbang(g);
        break;
      case 'smoke':
        this._deploySmoke(g);
        break;
      case 'molotov':
        this._deployFire(g);
        break;
    }
  }

  /**
   * HE 高爆手雷爆炸
   *  - 爆炸半径 5m，中心 100 伤害，边缘线性衰减到 0
   *  - 视觉：球形扩散粒子 + 点光源闪光
   *  - 音效：调用 audio.explosion()
   * @param {Grenade} g
   * @private
   */
  _explodeHE(g) {
    const center = g.position.clone();
    const radius = 5.0;
    const maxDamage = 100;

    // 音效
    this.audio.explosion();

    // 视觉效果：爆炸火球（球形扩散）
    const fireGeo = new THREE.SphereGeometry(0.5, 16, 16);
    const fireMat = new THREE.MeshBasicMaterial({
      color: 0xff6020,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });
    const fireMesh = new THREE.Mesh(fireGeo, fireMat);
    fireMesh.position.copy(center);
    this.scene.add(fireMesh);

    // 点光源
    const light = new THREE.PointLight(0xff8040, 5, 15);
    light.position.copy(center);
    this.scene.add(light);

    // 创建爆炸效果对象
    this.effects.push({
      type: 'explosion',
      mesh: fireMesh,
      light,
      position: center,
      life: 0.6,           // 总寿命 0.6 秒
      maxLife: 0.6,
      startScale: 0.5,
      endScale: radius * 2
    });

    // 范围伤害：对所有敌人
    const targets = [...g.enemies];
    if (g.player && g.player.isAlive && g.thrower !== g.player) {
      targets.push(g.player);
    }
    // 友军伤害简化：只对敌方造成伤害（CS:GO 实际有友军伤害，此处为了玩法平衡关闭）
    // 实际处理：根据 thrower.team 判断敌方
    for (const t of targets) {
      if (!t.isAlive) continue;
      if (!t.position) continue;
      // 友方不伤害（投掷者是玩家时，队友不受伤害）
      if (g.thrower && g.thrower.team && t.team && g.thrower.team === t.team && t !== g.thrower) {
        // 但玩家自己投的雷会伤害自己（避免恶意自伤）
        if (t === g.player) {
          // 允许自伤
        } else {
          continue;
        }
      }

      const dist = t.position.distanceTo(center);
      if (dist <= radius) {
        // 线性衰减：中心 100，边缘 0
        const damage = maxDamage * (1 - dist / radius);
        // 调用 takeDamage
        if (t.takeDamage) {
          const killed = t.takeDamage(damage, g.thrower);
          // 如果是玩家被炸死，需要触发 onDeath（已在 Player.takeDamage 内部处理）
        }
      }
    }
  }

  /**
   * 闪光弹效果
   *  - 半径 20m 内的所有玩家/敌人被闪白
   *  - 玩家：屏幕全白 0.05s → 渐变恢复 2.5s
   *  - 敌人：暂时失去视野（简化为：被闪的敌人停止射击 2 秒）
   * @param {Grenade} g
   * @private
   */
  _flashbang(g) {
    const center = g.position.clone();
    const radius = 20.0;

    // 音效：高频尖锐
    this.audio._playTone(3000, 0.15, 'square', 0.4);
    setTimeout(() => this.audio._playTone(2000, 0.4, 'sine', 0.25), 50);

    // 视觉：白色闪光球
    const flashGeo = new THREE.SphereGeometry(1.0, 16, 16);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });
    const flashMesh = new THREE.Mesh(flashGeo, flashMat);
    flashMesh.position.copy(center);
    this.scene.add(flashMesh);

    const light = new THREE.PointLight(0xffffff, 10, 25);
    light.position.copy(center);
    this.scene.add(light);

    this.effects.push({
      type: 'flash',
      mesh: flashMesh,
      light,
      position: center,
      life: 0.3,
      maxLife: 0.3
    });

    // 检查玩家是否被闪
    if (g.player && g.player.isAlive) {
      const dist = g.player.position.distanceTo(center);
      if (dist <= radius) {
        // 视线检测：玩家是否朝向闪光
        const toFlash = new THREE.Vector3().subVectors(center, g.player.position).normalize();
        const camDir = new THREE.Vector3();
        g.player.camera.getWorldDirection(camDir);
        const dot = toFlash.dot(camDir);
        // dot > 0 表示闪光在前方视野内
        const inView = dot > -0.2;  // 略放宽（视野边缘也算）
        // 距离衰减：近处全闪，远处部分闪
        const intensity = Math.max(0.3, 1 - dist / radius);
        if (inView) {
          this._showFlashOverlay(intensity);
        } else {
          // 背后闪光照样有影响，但强度减半
          this._showFlashOverlay(intensity * 0.3);
        }
      }
    }

    // 对敌人的影响：被闪的敌人停止射击 2 秒
    for (const enemy of g.enemies) {
      if (!enemy.isAlive) continue;
      const dist = enemy.position.distanceTo(center);
      if (dist <= radius) {
        // 简化处理：设置敌人的 state 为 idle 一段时间
        // 实际实现：给敌人加一个 _blindedUntil 时间戳
        enemy._blindedUntil = performance.now() / 1000 + 2.0;
        enemy.state = 'idle';
        enemy.target = null;
      }
    }
  }

  /**
   * 显示闪光白屏
   * @param {number} intensity 强度 0~1
   * @private
   */
  _showFlashOverlay(intensity) {
    if (!this.flashOverlay) return;
    this.flashOverlay.style.transition = 'opacity 0.05s';
    this.flashOverlay.style.opacity = String(intensity);
    // 2.5 秒内逐渐淡出
    setTimeout(() => {
      this.flashOverlay.style.transition = 'opacity 2.5s ease-out';
      this.flashOverlay.style.opacity = '0';
    }, 50);
  }

  /**
   * 部署烟雾弹
   *  - 在落点生成 9 个球形粒子组成的烟雾云
   *  - 持续 15 秒，逐渐扩散并淡出
   *  - 烟雾内无法看穿（玩家视野受限）
   * @param {Grenade} g
   * @private
   */
  _deploySmoke(g) {
    const center = g.position.clone();
    center.y = 0.5;  // 烟雾中心略高于地面

    // 音效：嘶嘶声
    this.audio._playNoise(0.5, 1500, 0.2, this.audio.master);

    // 创建烟雾粒子组（9 个球形）
    const smokeGroup = new THREE.Group();
    const particles = [];
    for (let i = 0; i < 9; i++) {
      const r = 1.2 + Math.random() * 0.6;
      const geo = new THREE.SphereGeometry(r, 8, 8);
      const mat = this._smokeMat.clone();
      mat.opacity = 0;
      const mesh = new THREE.Mesh(geo, mat);
      // 在中心周围分布
      const angle = (i / 9) * Math.PI * 2;
      const dist = 0.5 + Math.random() * 1.0;
      mesh.position.set(
        Math.cos(angle) * dist,
        Math.random() * 0.8,
        Math.sin(angle) * dist
      );
      smokeGroup.add(mesh);
      particles.push({
        mesh,
        baseY: mesh.position.y,
        mat,
        targetOpacity: 0.6 + Math.random() * 0.2
      });
    }
    smokeGroup.position.copy(center);
    this.scene.add(smokeGroup);

    this.effects.push({
      type: 'smoke',
      group: smokeGroup,
      particles,
      position: center,
      life: 15.0,
      maxLife: 15.0,
      growTime: 2.0  // 前 2 秒扩散
    });
  }

  /**
   * 部署燃烧弹
   *  - 在落点生成火焰区域（半径 3m）
   *  - 持续 8 秒，区域内每秒 40 伤害
   *  - 视觉：多个跳动的橙色锥形
   * @param {Grenade} g
   * @private
   */
  _deployFire(g) {
    const center = g.position.clone();
    center.y = 0.1;
    const radius = 3.0;

    // 音效
    this.audio._playNoise(0.3, 800, 0.3, this.audio.master);

    // 创建火焰粒子组（12 个小锥形/球形）
    const fireGroup = new THREE.Group();
    const particles = [];
    for (let i = 0; i < 12; i++) {
      const r = 0.2 + Math.random() * 0.3;
      const geo = new THREE.SphereGeometry(r, 6, 6);
      const mat = this._fireMat.clone();
      const mesh = new THREE.Mesh(geo, mat);
      // 在半径 3m 内随机分布
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius;
      mesh.position.set(
        Math.cos(angle) * dist,
        Math.random() * 0.5,
        Math.sin(angle) * dist
      );
      fireGroup.add(mesh);
      particles.push({
        mesh,
        baseY: mesh.position.y,
        mat,
        phase: Math.random() * Math.PI * 2,
        speed: 4 + Math.random() * 4
      });
    }
    fireGroup.position.copy(center);
    this.scene.add(fireGroup);

    // 点光源（火光）
    const light = new THREE.PointLight(0xff6020, 3, 8);
    light.position.copy(center);
    light.position.y = 1.0;
    this.scene.add(light);

    this.effects.push({
      type: 'fire',
      group: fireGroup,
      light,
      particles,
      position: center,
      radius,
      life: 8.0,
      maxLife: 8.0,
      damageTick: 0,  // 伤害计时器
      damagePerSec: 40
    });
  }

  /**
   * 更新单个效果
   * @param {Effect} e
   * @param {number} delta
   * @private
   */
  _updateEffect(e, delta) {
    switch (e.type) {
      case 'explosion':
        this._updateExplosion(e, delta);
        break;
      case 'flash':
        this._updateFlash(e, delta);
        break;
      case 'smoke':
        this._updateSmoke(e, delta);
        break;
      case 'fire':
        this._updateFire(e, delta);
        break;
    }
  }

  /**
   * 更新爆炸效果（扩散 + 淡出）
   * @param {Effect} e
   * @param {number} delta
   * @private
   */
  _updateExplosion(e, delta) {
    const t = 1 - e.life / e.maxLife;  // 0→1
    const scale = e.startScale + (e.endScale - e.startScale) * t;
    e.mesh.scale.set(scale, scale, scale);
    e.mat = e.mesh.material;
    e.mat.opacity = 1 - t;
    e.light.intensity = 5 * (1 - t);
  }

  /**
   * 更新闪光效果（快速淡出）
   * @param {Effect} e
   * @param {number} delta
   * @private
   */
  _updateFlash(e, delta) {
    const t = 1 - e.life / e.maxLife;
    e.mesh.scale.setScalar(1 + t * 3);
    e.mesh.material.opacity = 1 - t;
    e.light.intensity = 10 * (1 - t);
  }

  /**
   * 更新烟雾效果（前 2 秒扩散，后段稳定，最后 2 秒淡出）
   * @param {Effect} e
   * @param {number} delta
   * @private
   */
  _updateSmoke(e, delta) {
    const elapsed = e.maxLife - e.life;
    // 前 2 秒：扩散 + 显现
    if (elapsed < e.growTime) {
      const t = elapsed / e.growTime;
      for (const p of e.particles) {
        p.mat.opacity = p.targetOpacity * t;
        // 略微上浮
        p.mesh.position.y = p.baseY + t * 0.5;
      }
    }
    // 最后 3 秒：淡出
    else if (e.life < 3.0) {
      const t = e.life / 3.0;
      for (const p of e.particles) {
        p.mat.opacity = p.targetOpacity * t;
      }
    }
    // 中间段：稳定（无变化）
  }

  /**
   * 更新火焰效果（粒子跳动 + 持续伤害）
   * @param {Effect} e
   * @param {number} delta
   * @private
   */
  _updateFire(e, delta) {
    const now = performance.now() / 1000;
    // 粒子跳动
    for (const p of e.particles) {
      const flicker = Math.sin(now * p.speed + p.phase) * 0.5 + 0.5;
      p.mesh.scale.y = 0.8 + flicker * 0.6;
      p.mesh.position.y = p.baseY + flicker * 0.3;
      p.mat.opacity = 0.6 + flicker * 0.3;
    }
    // 灯光闪烁
    e.light.intensity = 2.5 + Math.sin(now * 8) * 0.5;

    // 持续伤害（每秒一次）
    e.damageTick += delta;
    if (e.damageTick >= 1.0) {
      e.damageTick -= 1.0;
      // 对所有在火焰区域内的目标造成伤害
      const targets = [...(this._currentEnemies || [])];
      if (this._currentPlayer && this._currentPlayer.isAlive) {
        targets.push(this._currentPlayer);
      }
      for (const t of targets) {
        if (!t.isAlive || !t.position) continue;
        const dist = t.position.distanceTo(e.position);
        if (dist <= e.radius) {
          if (t.takeDamage) {
            t.takeDamage(e.damagePerSec, null);
          }
        }
      }
    }

    // 最后 1 秒淡出
    if (e.life < 1.0) {
      const t = e.life / 1.0;
      for (const p of e.particles) {
        p.mat.opacity *= t;
      }
      e.light.intensity *= t;
    }
  }

  /**
   * 清理效果（移除 mesh、释放资源）
   * @param {Effect} e
   * @private
   */
  _cleanupEffect(e) {
    if (e.mesh) {
      this.scene.remove(e.mesh);
      e.mesh.geometry.dispose();
      e.mesh.material.dispose();
    }
    if (e.light) {
      this.scene.remove(e.light);
    }
    if (e.group) {
      this.scene.remove(e.group);
      e.group.traverse(o => {
        if (o.isMesh) {
          o.geometry.dispose();
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
          else o.material.dispose();
        }
      });
    }
  }

  /**
   * 缓存当前敌人/玩家引用（每帧由外部传入，供 _updateFire 使用）
   * 在 update() 开始前由外部调用
   * @param {Array} enemies
   * @param {Object} player
   */
  setTargets(enemies, player) {
    this._currentEnemies = enemies;
    this._currentPlayer = player;
  }

  /**
   * 清空所有投掷物和效果（用于回合重置）
   */
  clear() {
    // 移除所有投掷物
    for (const g of this.grenades) {
      this.scene.remove(g.mesh);
      g.mesh.geometry.dispose();
      g.mesh.material.dispose();
    }
    this.grenades = [];

    // 移除所有效果
    for (const e of this.effects) {
      this._cleanupEffect(e);
    }
    this.effects = [];

    // 隐藏闪光屏
    if (this.flashOverlay) {
      this.flashOverlay.style.opacity = '0';
    }
  }
}
