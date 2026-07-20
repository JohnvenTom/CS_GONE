/**
 * Game.js - 游戏主控制器 / 状态机
 * --------------------------------------------------------------
 * 管理内容：
 *  - 游戏模式（爆破/团死/练习）
 *  - 回合流程（冻结时间 → 回合中 → 回合结算 → 下一局）
 *  - 经济系统（金钱、奖励、连败补偿）
 *  - 炸弹系统（安装/拆除/爆炸倒计时）
 *  - 玩家与敌人团队（5v5）
 *  - 胜负判定
 *  - 与 UI/HUD/计分板/购买菜单的联动
 * --------------------------------------------------------------
 */

import * as THREE from 'three';
import { Player } from './Player.js';
import { EnemyAI } from './EnemyAI.js';
import { WEAPONS } from './Weapons.js';
import { GrenadeSystem } from './GrenadeSystem.js';

export class Game {
  /**
   * @param {Object} deps
   * @param {import('../core/Engine.js').Engine} deps.engine
   * @param {import('../core/Input.js').Input} deps.input
   * @param {import('../world/Physics.js').Physics} deps.physics
   * @param {import('../world/Map.js').GameMap} deps.map
   * @param {import('../audio/Audio.js').AudioSystem} deps.audio
   * @param {import('../ui/HUD.js').HUD} deps.hud
   * @param {import('../ui/Crosshair.js').Crosshair} deps.crosshair
   * @param {import('../ui/BuyWheel.js').BuyWheel} deps.buyWheel
   * @param {import('../ui/Scoreboard.js').Scoreboard} deps.scoreboard
   * @param {import('../ui/KillFeed.js').KillFeed} deps.killFeed
   */
  constructor(deps) {
    this.deps = deps;
    this.engine = deps.engine;
    this.input = deps.input;
    this.physics = deps.physics;
    this.map = deps.map;
    this.audio = deps.audio;
    this.hud = deps.hud;
    this.crosshair = deps.crosshair;
    this.buyWheel = deps.buyWheel;
    this.scoreboard = deps.scoreboard;
    this.killFeed = deps.killFeed;

    // ---- 游戏状态 ----
    this.mode = 'bomb_defusal';
    this.state = {
      round: 1,
      maxRounds: 24, // 24 局 13 胜
      ctScore: 0,
      tScore: 0,
      phase: 'menu',         // 'menu' | 'freeze' | 'active' | 'round_end' | 'game_end'
      phaseTime: 0,          // 当前阶段剩余时间
      ctMoney: 4000,
      tMoney: 4000,
      ctLosingStreak: 0,
      tLosingStreak: 0,
      bomb: {
        state: 'inactive',   // 'inactive' | 'planted' | 'defusing' | 'exploded' | 'defused'
        timer: 40,
        site: null,
        position: null
      },
      tdmKills: { ct: 0, t: 0 },
      tdmTarget: 50
    };

    // ---- 团队 ----
    this.player = null;
    this.enemies = [];     // 所有敌人（含 AI 队友）
    this.allBots = [];     // 所有 AI（CT+T 都包括，玩家除外）
    this.playerTeam = 'ct';

    // ---- 投掷物系统 ----
    // 延迟初始化：在 init() 中创建（依赖 scene/audio/physics）
    this.grenadeSystem = null;

    // ---- 计分快照 ----
    this.roundMVP = null;
    this.roundStats = [];

    // ---- 回调 ----
    this.onGameEnd = null;
    this.onPhaseChange = null;

    this._lastHurtTime = 0;
    this._fpsCheckTime = 0;
    this._fpsFrames = 0;
  }

  /**
   * 初始化游戏（创建玩家、AI、绑定事件）
   */
  init() {
    // 玩家
    this.player = new Player(this.engine.camera, this.physics, this.audio);
    this.engine.scene.add(this.engine.camera); // 玩家武器挂在 camera 上

    // 投掷物系统
    this.grenadeSystem = new GrenadeSystem(this.engine.scene, this.physics, this.audio);

    this._bindInput();
    this._bindPlayerCallbacks();

    // 配置购买菜单
    this.buyWheel.getPlayerMoney = () => this.playerTeam === 'ct' ? this.state.ctMoney : this.state.tMoney;
    this.buyWheel.getTeam = () => this.playerTeam;
    this.buyWheel.onPurchase = (weaponId) => this._purchaseWeapon(weaponId);
    this.buyWheel.onClose = () => { /* 恢复指针锁定由外部处理 */ };

    // 注册主循环
    this.engine.onUpdate((d, e) => this.update(d, e));
  }

  /**
   * 开始游戏
   * @param {string} mode 游戏模式
   * @param {string} [team] 玩家阵营 'ct' | 't'，未指定则保持当前 playerTeam
   */
  startGame(mode, team) {
    this.mode = mode;
    if (team === 'ct' || team === 't') {
      this.playerTeam = team;
    }
    this.state.round = 1;
    this.state.ctScore = 0;
    this.state.tScore = 0;
    this.state.ctMoney = 4000;
    this.state.tMoney = 4000;
    this.state.ctLosingStreak = 0;
    this.state.tLosingStreak = 0;
    this.state.tdmKills = { ct: 0, t: 0 };

    if (mode === 'team_deathmatch') {
      this.state.maxRounds = 999;
    } else {
      this.state.maxRounds = 24;
    }

    this._spawnTeams();
    this._startFreezeTime();
  }

  /**
   * 生成两支队伍（玩家+4队友 vs 5敌人）
   * @private
   */
  _spawnTeams() {
    // 清理旧 AI
    for (const bot of this.allBots) {
      bot.removeFromScene(this.engine.scene);
    }
    this.allBots = [];
    this.enemies = [];

    const teamSize = this.mode === 'practice' ? 1 : 5;

    // 玩家阵营
    const playerTeam = this.playerTeam;
    const enemyTeam = playerTeam === 'ct' ? 't' : 'ct';

    // 玩家自己
    this.player.team = playerTeam;
    const playerSpawn = this.map.spawnPoints[playerTeam][0];
    this.player.respawn(playerSpawn);

    // 玩家方 AI 队友（4 个）
    if (this.mode !== 'practice') {
      for (let i = 0; i < 4; i++) {
        const spawn = this.map.spawnPoints[playerTeam][i + 1] || playerSpawn;
        const bot = this._createBot(playerTeam, spawn, i + 1);
        bot.addToScene(this.engine.scene);
        this.allBots.push(bot);
      }
    }

    // 敌方 AI（5 个）
    const enemyCount = this.mode === 'practice' ? 3 : 5;
    for (let i = 0; i < enemyCount; i++) {
      const spawn = this.map.spawnPoints[enemyTeam][i] || this.map.spawnPoints[enemyTeam][0];
      const bot = this._createBot(enemyTeam, spawn, i + 1);
      bot.addToScene(this.engine.scene);
      this.allBots.push(bot);
      this.enemies.push(bot);
    }

    // 预编译着色器 + 预上传 GPU 资源，消除旋转视角到新角度时的首次渲染卡顿
    this._precompileScene();
  }

  /**
   * 预编译着色器并预上传 GPU 资源
   * 通过临时禁用视锥剔除，渲染一帧，确保所有 mesh 的着色器变体被编译、
   * 几何体和纹理数据被上传到 GPU。
   * 这样玩家旋转视角到任何角度时，都不会触发首次渲染导致的卡顿。
   * 注意事项：仅在 _spawnTeams 后调用一次，避免重复开销
   * @private
   */
  _precompileScene() {
    const scene = this.engine.scene;
    const camera = this.engine.camera;
    const renderer = this.engine.renderer;

    // 记录原始 frustumCulled 值，临时禁用视锥剔除
    const culledMeshes = [];
    scene.traverse(obj => {
      if (obj.isMesh && obj.frustumCulled) {
        culledMeshes.push(obj);
        obj.frustumCulled = false;
      }
    });

    // 预编译着色器变体 + 预渲染（触发 GPU 资源上传）
    renderer.compile(scene, camera);
    renderer.render(scene, camera);

    // 恢复视锥剔除（后续正常渲染时启用，降低 draw call）
    culledMeshes.forEach(m => { m.frustumCulled = true; });
  }

  /**
   * 创建一个 AI Bot
   * @private
   */
  _createBot(team, spawnPos, idx) {
    const bot = new EnemyAI({
      team,
      name: `${team.toUpperCase()}-Bot-${idx}`,
      position: spawnPos,
      physics: this.physics,
      audio: this.audio,
      weaponId: team === 'ct' ? 'm4a4' : 'ak47',
      patrol: this._buildPatrolRoute(team, idx)
    });

    bot.onDeath = (victim, attacker) => this._onBotDeath(victim, attacker);
    bot.onShoot = (b) => { /* 可加枪口火焰 */ };
    bot.onHitPlayer = (player, dmg, hs, bot) => this._onPlayerHurt(dmg, bot.position, hs);
    return bot;
  }

  /**
   * 为 AI 构建巡逻路线
   * @private
   */
  _buildPatrolRoute(team, idx) {
    // 简单的几个关键点
    const routes = {
      ct: [
        [new THREE.Vector3(-25, 0, 18), new THREE.Vector3(0, 0, 0), new THREE.Vector3(-30, 0, -20), new THREE.Vector3(-10, 0, 35)],
        [new THREE.Vector3(25, 0, 18), new THREE.Vector3(0, 0, 5), new THREE.Vector3(30, 0, 20), new THREE.Vector3(10, 0, 35)],
        [new THREE.Vector3(0, 0, 20), new THREE.Vector3(-15, 0, 0), new THREE.Vector3(15, 0, 0), new THREE.Vector3(0, 0, 35)],
        [new THREE.Vector3(-25, 0, 18), new THREE.Vector3(-35, 0, 0), new THREE.Vector3(-30, 0, -20), new THREE.Vector3(0, 0, 30)]
      ],
      t: [
        [new THREE.Vector3(-25, 0, -18), new THREE.Vector3(0, 0, -5), new THREE.Vector3(-30, 0, -20), new THREE.Vector3(-10, 0, -35)],
        [new THREE.Vector3(25, 0, -18), new THREE.Vector3(0, 0, 0), new THREE.Vector3(30, 0, -20), new THREE.Vector3(10, 0, -35)],
        [new THREE.Vector3(0, 0, -20), new THREE.Vector3(15, 0, -5), new THREE.Vector3(-15, 0, -5), new THREE.Vector3(0, 0, -35)],
        [new THREE.Vector3(25, 0, -18), new THREE.Vector3(35, 0, 0), new THREE.Vector3(30, 0, 20), new THREE.Vector3(0, 0, -30)]
      ]
    };
    const teamRoutes = routes[team] || routes.ct;
    return teamRoutes[(idx - 1) % teamRoutes.length];
  }

  /**
   * 绑定输入事件
   * @private
   */
  _bindInput() {
    // 武器切换 1-4
    for (let i = 1; i <= 4; i++) {
      this.input.onPress('Digit' + i, () => {
        if (this.player.isAlive && !this.buyWheel.isOpen) {
          this.player.switchToSlot(String(i));
        }
      });
    }

    // B - 购买菜单
    this.input.onPress('KeyB', () => {
      if (this.state.phase !== 'freeze' && this.state.phase !== 'active') return;
      if (this.state.phase === 'active' && this.state.bomb.state === 'planted') return;
      this.buyWheel.toggle();
      if (this.buyWheel.isOpen) {
        this.input.exitPointerLock();
      } else {
        this.input.requestPointerLock();
      }
    });

    // Tab - 计分板
    this.input.onPress('Tab', () => {
      this.scoreboard.show(true);
      this._renderScoreboard();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.scoreboard.show(false);
    });

    // F - 武器检视
    this.input.onPress('KeyF', () => {
      if (this.player.isAlive) {
        this.player.startInspect(performance.now() / 1000);
      }
    });

    // ESC - 释放指针
    this.input.onPress('Escape', () => {
      if (this.buyWheel.isOpen) {
        this.buyWheel.close();
        this.input.requestPointerLock();
      }
    });

    // 鼠标点击锁定指针
    this.input.canvas.addEventListener('click', () => {
      if (!this.input.pointerLocked && this.state.phase !== 'menu' && this.state.phase !== 'game_end' && !this.buyWheel.isOpen) {
        this.input.requestPointerLock();
      }
    });

    // 指针锁定状态变化
    this.input.onPointerLockChange = (locked) => {
      const pauseHint = document.getElementById('pause-hint');
      if (pauseHint) {
        // 玩家死亡时由死亡界面接管，不显示暂停提示
        const showPause = !locked
          && this.state.phase !== 'menu'
          && this.state.phase !== 'game_end'
          && !this.buyWheel.isOpen
          && !this._playerDead;
        pauseHint.classList.toggle('active', showPause);
      }
    };

    // 主菜单按钮：点击模式后打开选边浮层（不直接开始游戏）
    document.querySelectorAll('.mm-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        this.audio.init();
        this.audio.resume();
        this._openTeamSelect(mode);
      });
    });

    // 选边浮层：选择阵营
    document.querySelectorAll('.ts-team').forEach(btn => {
      btn.addEventListener('click', () => {
        const team = btn.dataset.team;
        const mode = this._pendingMode;
        this._closeTeamSelect();
        document.getElementById('main-menu').classList.add('hidden');
        this.startGame(mode, team);
        // 在 click 用户手势内同步请求指针锁定（避免 Promise 拒绝）
        this.input.requestPointerLock();
      });
    });

    // 选边浮层：返回主菜单
    const tsBack = document.getElementById('ts-back');
    if (tsBack) {
      tsBack.addEventListener('click', () => {
        this._closeTeamSelect();
      });
    }

    // 死亡界面：换边重生按钮
    const dsSwitchBtn = document.getElementById('ds-switch-team');
    if (dsSwitchBtn) {
      dsSwitchBtn.addEventListener('click', () => {
        this._switchPlayerTeam();
      });
    }
  }

  /**
   * 打开选边浮层
   * @param {string} mode 游戏模式
   * @private
   */
  _openTeamSelect(mode) {
    this._pendingMode = mode;
    const ts = document.getElementById('team-select');
    if (!ts) return;
    const modeLabels = {
      bomb_defusal: '爆破模式 · 5v5',
      team_deathmatch: '团队死斗 · 50 杀获胜',
      practice: '人机练习 · 单挑 AI'
    };
    const labelEl = document.getElementById('ts-mode-label');
    if (labelEl) labelEl.textContent = modeLabels[mode] || '选择你想加入的队伍';
    ts.classList.add('active');
  }

  /**
   * 关闭选边浮层
   * @private
   */
  _closeTeamSelect() {
    const ts = document.getElementById('team-select');
    if (ts) ts.classList.remove('active');
    this._pendingMode = null;
  }

  /**
   * 玩家主动换边：切换阵营并立即重生
   * 规则：
   *  - 切换 playerTeam 与 player.team
   *  - 重新生成双方 AI（让玩家加入新阵营的队友）
   *  - 立即触发 _startFreezeTime 重生玩家
   *  - 重置比分与经济（用户主动换边视为重新开局）
   * @private
   */
  _switchPlayerTeam() {
    const newTeam = this.playerTeam === 'ct' ? 't' : 'ct';
    this.playerTeam = newTeam;
    this.player.team = newTeam;

    // 重置比分与经济（视为新开局）
    this.state.ctScore = 0;
    this.state.tScore = 0;
    this.state.ctMoney = 4000;
    this.state.tMoney = 4000;
    this.state.ctLosingStreak = 0;
    this.state.tLosingStreak = 0;
    this.state.round = 1;

    // 关闭死亡界面
    this._hideDeathScreen();

    // 重新生成队伍（含预编译）+ 启动冻结时间
    this._spawnTeams();
    this._startFreezeTime();

    // 恢复指针锁定
    this.input.requestPointerLock();
  }

  /**
   * 绑定玩家事件回调
   * @private
   */
  _bindPlayerCallbacks() {
    const p = this.player;

    p.onHit = (enemy, point, isHeadshot, damage) => {
      this.crosshair.showHit(isHeadshot);
      this.killFeed.showFloatingDamage(point, damage, isHeadshot);
      if (isHeadshot) this.crosshair.showHeadshotBanner();
    };

    p.onKill = (enemy, isHeadshot) => {
      this._onPlayerKill(enemy, isHeadshot);
    };

    p.onDamageDealt = (point, damage, isHeadshot) => {
      // 已在 onHit 处理
    };

    p.onHurt = (dmg, angle) => {
      this.hud.showDamageIndicator(angle);
    };

    p.onDeath = (attacker, headshot) => {
      this._onPlayerDeath(attacker, headshot);
    };

    p.onFire = (weaponId) => {
      // 触发准星后坐状态（短暂）
      this._firingTimer = 0.08;
    };

    p.onWeaponChanged = () => {
      this._updateHUDWeaponBar();
    };

    // 投掷物回调：将投掷事件转发给 GrenadeSystem 实现具体效果
    // 参数：grenadeId 投掷物ID, pos 起始位置, vel 初速度, thrower 投掷者
    p.onThrowGrenade = (grenadeId, pos, vel, thrower) => {
      if (this.grenadeSystem) {
        this.grenadeSystem.throw(grenadeId, pos, vel, thrower, this.enemies, this.player);
      }
    };
  }

  /**
   * 购买武器
   * @private
   */
  _purchaseWeapon(weaponId) {
    const def = WEAPONS[weaponId];
    if (!def) return false;
    const money = this.playerTeam === 'ct' ? this.state.ctMoney : this.state.tMoney;
    if (money < def.price) return false;

    const ok = this.player.buyWeapon(weaponId);
    if (!ok) return false;

    // 扣钱
    if (this.playerTeam === 'ct') this.state.ctMoney -= def.price;
    else this.state.tMoney -= def.price;

    this.hud.showPurchaseToast(def.name);
    this._updateHUDWeaponBar();
    return true;
  }

  /**
   * 启动冻结时间
   * 注意：此处不主动 requestPointerLock，因为可能不在用户手势上下文中，
   *      浏览器会拒绝。玩家点击画布时会自动触发锁定（见 _bindInput）。
   * @private
   */
  _startFreezeTime() {
    this.state.phase = 'freeze';
    this.state.phaseTime = 5;
    this.state.bomb = { state: 'inactive', timer: 40, site: null, position: null };
    // 清理上一回合残留的投掷物和效果（爆炸/烟雾/火焰）
    if (this.grenadeSystem) this.grenadeSystem.clear();
    this._respawnAll();
  }

  /**
   * 重生所有玩家
   * 规则（参照 CS:GO）：
   *  - 玩家存活：保留装备（武器/护甲/头盔/拆弹器/手雷），仅重置位置/生命/状态
   *  - 玩家死亡：清空装备，发放默认手枪
   *  - 出生点：从本方出生点池中随机选择（不重复，避免重叠）
   * @private
   */
  _respawnAll() {
    // 关闭死亡界面（如有）
    this._hideDeathScreen();

    // 为双方分别随机分配出生点（Fisher-Yates 打乱后顺序取用）
    const ctSpawns = this._shuffleSpawns(this.map.spawnPoints.ct.slice());
    const tSpawns = this._shuffleSpawns(this.map.spawnPoints.t.slice());

    // 玩家
    const playerSpawns = this.playerTeam === 'ct' ? ctSpawns : tSpawns;
    const playerSpawn = playerSpawns[0];
    if (this.player.isAlive) {
      // 存活进入下一局：保留装备
      this.player.respawnKeepGear(playerSpawn);
    } else {
      // 死亡复活：清空装备，发放默认手枪 + 重置护甲
      this.player.respawn(playerSpawn);
      this.player.armor = 0;
      this.player.hasHelmet = false;
      this.player.hasDefuser = false;
    }

    // AI：按 team 分组，每组顺序取打乱后的出生点
    let ctIdx = 0, tIdx = 0;
    for (const bot of this.allBots) {
      const spawnList = bot.team === 'ct' ? ctSpawns : tSpawns;
      const idx = bot.team === 'ct' ? ctIdx++ : tIdx++;
      const spawn = spawnList[idx % spawnList.length];
      const wpnId = bot.team === 'ct' ? 'm4a4' : 'ak47';
      if (bot.isAlive) {
        // AI 存活：保留装备
        bot.respawnKeepGear(spawn);
      } else {
        // AI 死亡：重置武器和护甲
        bot.respawn(spawn, wpnId);
        bot.armor = 0;
      }
    }
  }

  /**
   * Fisher-Yates 洗牌：随机打乱数组顺序
   * @param {Array} arr 待打乱数组
   * @returns {Array} 打乱后的新数组（原数组不变）
   * @private
   */
  _shuffleSpawns(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * 启动回合
   * @private
   */
  _startRound() {
    this.state.phase = 'active';
    this.state.phaseTime = this.mode === 'team_deathmatch' ? 600 : 105;
  }

  /**
   * 回合结束
   * @private
   */
  _endRound(winner) {
    if (this.state.phase === 'round_end' || this.state.phase === 'game_end') return;
    this.state.phase = 'round_end';
    this.state.phaseTime = 10;

    // 经济结算
    const loserTeam = winner === 'ct' ? 't' : 'ct';
    const loserStreak = winner === 'ct' ? 'tLosingStreak' : 'ctLosingStreak';
    const winStreak = winner === 'ct' ? 'tLosingStreak' : 'ctLosingStreak'; // 重置败者方连败

    if (winner === 'ct') {
      this.state.ctScore++;
      this.state.ctMoney += 3250;
      const lossBonus = Math.min(1400 + this.state[loserStreak] * 500, 2900);
      this.state.tMoney += lossBonus;
      this.state.tLosingStreak++;
      this.state.ctLosingStreak = 0;
    } else {
      this.state.tScore++;
      this.state.tMoney += 3250;
      const lossBonus = Math.min(1400 + this.state[loserStreak] * 500, 2900);
      this.state.ctMoney += lossBonus;
      this.state.ctLosingStreak++;
      this.state.tLosingStreak = 0;
    }

    // 团死模式仅累计击杀，不算回合
    if (this.mode === 'team_deathmatch') {
      this.state.ctScore = this.state.tdmKills.ct;
      this.state.tScore = this.state.tdmKills.t;
      if (this.state.ctScore >= this.state.tdmTarget || this.state.tScore >= this.state.tdmTarget) {
        this._endGame();
        return;
      }
    }

    // 音效
    if (winner === this.playerTeam) {
      this.audio.roundWin();
    } else {
      this.audio.roundLose();
    }

    // 判定游戏结束
    const totalRounds = this.state.ctScore + this.state.tScore;
    if (this.mode !== 'team_deathmatch') {
      if (this.state.ctScore >= 13 || this.state.tScore >= 13 || totalRounds >= this.state.maxRounds) {
        this._showRoundEndPanel(winner, true, false);
        setTimeout(() => this._endGame(), 10000);
        return;
      }
    }

    // 半场换边判定（爆破模式第 12 局结束后 CT/T 互换）
    const isHalfTime = this.mode === 'bomb_defusal' && totalRounds === 12;
    if (isHalfTime) {
      this._switchSides();
    }

    this._showRoundEndPanel(winner, false, isHalfTime);
  }

  /**
   * 半场换边（CS:GO 规则：第 12 局结束后 CT 与 T 互换阵营）
   * 处理内容：
   *  - 玩家阵营切换（playerTeam + player.team）
   *  - 所有 AI 阵营切换
   *  - 金钱互换（金钱跟随队伍，原 CT 的钱变成新 T 的钱）
   *  - 重置双方连败补偿计数（新半场从 0 开始）
   *  - 比分保留（CS:GO 规则：换边后比分延续）
   * 注意：此方法不直接重生玩家，由后续 _startFreezeTime → _respawnAll 处理
   *       存活玩家保留装备（respawnKeepGear），死亡玩家重置装备（respawn）
   * @private
   */
  _switchSides() {
    // 玩家阵营切换
    this.playerTeam = this.playerTeam === 'ct' ? 't' : 'ct';
    this.player.team = this.playerTeam;

    // 所有 AI 阵营切换
    for (const bot of this.allBots) {
      bot.team = bot.team === 'ct' ? 't' : 'ct';
    }

    // 重建敌人列表（仅包含与玩家不同阵营的 AI）
    // 关键：换边后若不重建，玩家会射击到新队友，且无法命中新敌人
    this.enemies = this.allBots.filter(b => b.team !== this.playerTeam);

    // 金钱互换（金钱跟随队伍：原 CT 队的钱变成新 T 队的钱）
    const tmpMoney = this.state.ctMoney;
    this.state.ctMoney = this.state.tMoney;
    this.state.tMoney = tmpMoney;

    // 重置双方连败补偿（新半场从 0 开始计算）
    this.state.ctLosingStreak = 0;
    this.state.tLosingStreak = 0;

    // 比分保留（CS:GO 规则：换边后比分延续，不重置）
  }

  /**
   * 显示回合结束面板
   * @param {string} winner 获胜方 'ct' | 't'
   * @param {boolean} isGameEnd 是否为游戏结束（最终局）
   * @param {boolean} isHalfTime 是否为半场换边（第 12 局结束）
   * @private
   */
  _showRoundEndPanel(winner, isGameEnd = false, isHalfTime = false) {
    const panel = document.getElementById('round-end-panel');
    const title = document.getElementById('rep-title');
    const halftime = document.getElementById('rep-halftime');
    const mvp = document.getElementById('rep-mvp');
    const stats = document.getElementById('rep-stats');
    const progress = document.getElementById('rep-progress');
    const continueText = document.getElementById('rep-continue-text');

    title.textContent = isGameEnd ?
      (winner === 'ct' ? 'CT 胜利！' : 'T 胜利！') :
      (winner === 'ct' ? 'CT 赢得回合' : 'T 赢得回合');
    title.className = 'rep-title ' + (winner === 'ct' ? 'ct-win' : 't-win');

    // 半场换边通知显示/隐藏
    if (halftime) {
      halftime.classList.toggle('show', !!isHalfTime);
    }

    // 简单 MVP 选取
    const allPlayers = [this.player, ...this.allBots];
    let mvpPlayer = allPlayers[0];
    let maxKills = -1;
    for (const p of allPlayers) {
      const k = p.kills || 0;
      if (k > maxKills) {
        maxKills = k;
        mvpPlayer = p;
      }
    }
    mvp.textContent = maxKills > 0 ? `MVP: ${mvpPlayer.name || '玩家'} (${maxKills} 击杀)` : '';

    // 统计（换边后 team 已切换，显示的是新阵营的存活情况）
    const ctAlive = allPlayers.filter(p => p.team === 'ct' && p.isAlive).length;
    const tAlive = allPlayers.filter(p => p.team === 't' && p.isAlive).length;
    stats.innerHTML = `
      CT 存活: ${ctAlive} / 5<br>
      T 存活: ${tAlive} / 5<br>
      CT 比分: ${this.state.ctScore} · T 比分: ${this.state.tScore}
    `;

    // 倒计时进度
    panel.classList.add('active');
    let timeLeft = 10;
    progress.style.width = '100%';
    const tick = () => {
      timeLeft -= 0.1;
      progress.style.width = (timeLeft / 10 * 100) + '%';
      continueText.textContent = isGameEnd ? `游戏结束 ${Math.ceil(timeLeft)}s` : `下一回合 ${Math.ceil(timeLeft)}s`;
      if (timeLeft <= 0) {
        panel.classList.remove('active');
        // 隐藏半场通知（下次显示前需重置）
        if (halftime) halftime.classList.remove('show');
        return;
      }
      if (this.state.phase === 'round_end') {
        setTimeout(tick, 100);
      } else {
        panel.classList.remove('active');
        if (halftime) halftime.classList.remove('show');
      }
    };
    tick();
  }

  /**
   * 游戏结束
   * @private
   */
  _endGame() {
    this.state.phase = 'game_end';
    this.input.exitPointerLock();
    if (this.onGameEnd) this.onGameEnd(this.state);
  }

  /**
   * 玩家击杀事件
   * @private
   */
  _onPlayerKill(enemy, isHeadshot) {
    const reward = isHeadshot ? 600 : 300;
    if (this.playerTeam === 'ct') this.state.ctMoney += reward;
    else this.state.tMoney += reward;

    enemy.kills = (enemy.kills || 0); // already incremented in EnemyAI
    // player.kills 已在 Player._fireRaycast 中自增，此处不再重复计数

    // TDM 计分
    if (this.mode === 'team_deathmatch') {
      this.state.tdmKills[this.playerTeam]++;
    }

    this.killFeed.addKill({
      killerName: '玩家',
      killerTeam: this.playerTeam,
      victimName: enemy.name,
      victimTeam: enemy.team,
      weaponName: this.player.getCurrentWeapon()?.def.name || '武器',
      headshot: isHeadshot
    });
    this.killFeed.showReward(reward);
  }

  /**
   * AI 击杀事件
   * @private
   */
  _onBotDeath(victim, attacker) {
    if (attacker && attacker.isLocalPlayer) return; // 已在 onPlayerKill 处理

    // AI 互杀
    if (attacker && attacker.kills !== undefined) {
      attacker.kills = (attacker.kills || 0) + 1;
      if (attacker.team === 'ct') this.state.ctMoney += 300;
      else this.state.tMoney += 300;
    }

    if (this.mode === 'team_deathmatch' && attacker) {
      this.state.tdmKills[attacker.team]++;
    }

    this.killFeed.addKill({
      killerName: attacker ? attacker.name : '系统',
      killerTeam: attacker ? attacker.team : 'ct',
      victimName: victim.name,
      victimTeam: victim.team,
      weaponName: attacker && attacker.getCurrentWeapon ? attacker.getCurrentWeapon()?.def.name : (attacker?.weapon?.def.name || '武器'),
      headshot: false
    });
  }

  /**
   * 玩家死亡
   * 显示死亡界面（含击杀者信息）而非依赖 pause-hint
   * @param {Object} attacker 击杀者（EnemyAI 实例，可能为 null）
   * @param {boolean} headshot 是否被爆头
   * @private
   */
  _onPlayerDeath(attacker, headshot) {
    this.player.deaths = (this.player.deaths || 0) + 1;
    // 释放指针锁定，但通过 _playerDead 标志阻止 pause-hint 显示
    this._playerDead = true;
    this.input.exitPointerLock();
    // 显示死亡界面
    this._showDeathScreen(attacker, headshot);
    this._checkRoundEnd();
  }

  /**
   * 显示死亡界面
   * @param {Object} attacker 击杀者
   * @param {boolean} headshot 是否爆头
   * @private
   */
  _showDeathScreen(attacker, headshot) {
    const ds = document.getElementById('death-screen');
    if (!ds) return;

    // 击杀者名称
    const killerNameEl = document.getElementById('ds-killer-name');
    if (killerNameEl) {
      killerNameEl.textContent = attacker && attacker.name ? attacker.name : '系统';
      killerNameEl.style.color = attacker && attacker.team === 't'
        ? '#FF5500'
        : '#00D4FF';
    }

    // 武器名
    const weaponEl = document.getElementById('ds-weapon');
    if (weaponEl) {
      const w = attacker && attacker.weapon ? attacker.weapon.def.name : '未知武器';
      weaponEl.textContent = w;
    }

    // 爆头标签
    const hsTag = document.getElementById('ds-headshot-tag');
    if (hsTag) hsTag.classList.toggle('show', !!headshot);

    // 统计数据
    const killsEl = document.getElementById('ds-kills');
    if (killsEl) killsEl.textContent = this.player.kills || 0;
    const dmgEl = document.getElementById('ds-damage');
    if (dmgEl) dmgEl.textContent = Math.round(this.player.damageDealt || 0);
    const deathsEl = document.getElementById('ds-deaths');
    if (deathsEl) deathsEl.textContent = this.player.deaths || 0;

    ds.classList.add('active');
  }

  /**
   * 关闭死亡界面
   * @private
   */
  _hideDeathScreen() {
    const ds = document.getElementById('death-screen');
    if (ds) ds.classList.remove('active');
    this._playerDead = false;
  }

  /**
   * 玩家受伤（来自 AI）
   * @private
   */
  _onPlayerHurt(damage, fromPos, isHeadshot) {
    // 已通过 player.takeDamage 处理
  }

  /**
   * 检查回合是否应该结束（一方全灭）
   * @private
   */
  _checkRoundEnd() {
    const ctAlive = [this.player, ...this.allBots].filter(p => p.team === 'ct' && p.isAlive).length;
    const tAlive = [this.player, ...this.allBots].filter(p => p.team === 't' && p.isAlive).length;

    if (ctAlive === 0) {
      // 炸弹未安装时 T 胜
      if (this.state.bomb.state !== 'planted') {
        this._endRound('t');
      }
    } else if (tAlive === 0) {
      if (this.state.bomb.state !== 'planted') {
        this._endRound('ct');
      }
    }
  }

  /**
   * 主更新
   * @param {number} delta
   * @param {number} elapsed
   */
  update(delta, elapsed) {
    // ---- 阶段计时 ----
    if (this.state.phase !== 'menu' && this.state.phase !== 'game_end') {
      this.state.phaseTime -= delta;
      if (this.state.phaseTime <= 0) {
        this._advancePhase();
      }
    }

    // ---- 炸弹计时 ----
    if (this.state.bomb.state === 'planted' || this.state.bomb.state === 'defusing') {
      this.state.bomb.timer -= delta;
      if (this.state.bomb.timer <= 5 && Math.floor(this.state.bomb.timer) !== this._lastBombBeep) {
        this._lastBombBeep = Math.floor(this.state.bomb.timer);
        this.audio.bombBeep(this.state.bomb.timer < 10);
      }
      if (this.state.bomb.timer <= 0) {
        this._explodeBomb();
      }
    }

    // ---- 玩家更新 ----
    if (this.state.phase !== 'menu' && this.state.phase !== 'game_end') {
      const frozen = this.state.phase === 'freeze' || this.state.phase === 'round_end';
      this.player.update(delta, this.input, this.enemies, frozen);
      this.player.inputMoving = this.input.isDown('KeyW') || this.input.isDown('KeyS') ||
                                  this.input.isDown('KeyA') || this.input.isDown('KeyD');
    }

    // ---- AI 更新 ----
    if (this.state.phase === 'active') {
      const target = this.player.isAlive ? this.player : null;
      for (const bot of this.allBots) {
        // AI 攻击目标是敌方
        const enemyTarget = bot.team !== this.playerTeam ? target : null;
        const otherEnemies = this.allBots.filter(b => b.team !== bot.team && b.isAlive);
        const actualTarget = enemyTarget || (otherEnemies.length > 0 ? otherEnemies[0] : null);
        bot.update(delta, actualTarget, this.allBots);
      }
      this._checkRoundEnd();
    } else {
      // 冻结时间 AI 也站着不动
      for (const bot of this.allBots) {
        bot.state = 'idle';
        // 死亡的 bot 继续播放死亡动画（修复：回合结束后死亡动画应完整播放）
        if (!bot.isAlive) {
          bot.update(delta, null, this.allBots);
        }
      }
    }

    // ---- 投掷物系统 ----
    // 更新所有飞行中的投掷物和已生效的爆炸/烟雾/火焰效果
    if (this.grenadeSystem) {
      this.grenadeSystem.setTargets(this.enemies, this.player);
      this.grenadeSystem.update(delta, this.enemies, this.player);
    }

    // ---- UI 更新 ----
    this._updateHUD();

    // ---- 购买菜单 ----
    this.buyWheel.update(delta);

    // ---- 准星 ----
    this.crosshair.update({
      isMoving: this.player.isAlive && (this.player._inputMoving || false),
      isFiring: this._firingTimer > 0,
      isInspecting: this.player.inspectState.active
    });
    if (this._firingTimer > 0) this._firingTimer -= delta;

    // ---- 性能降级 ----
    this._fpsCheckTime += delta;
    this._fpsFrames++;
    if (this._fpsCheckTime >= 1) {
      const fps = this._fpsFrames / this._fpsCheckTime;
      this.hud.setLowPerformance(fps < 45);
      this._fpsCheckTime = 0;
      this._fpsFrames = 0;
    }
  }

  /**
   * 阶段推进
   * @private
   */
  _advancePhase() {
    if (this.state.phase === 'freeze') {
      this._startRound();
    } else if (this.state.phase === 'active') {
      // 回合时间耗尽 → CT 胜
      if (this.state.bomb.state !== 'planted') {
        this._endRound('ct');
      } else {
        // 炸弹已安装，回合计时暂停
        this.state.phaseTime = 999;
      }
    } else if (this.state.phase === 'round_end') {
      this.state.round++;
      this._startFreezeTime();
    }
  }

  /**
   * 炸弹爆炸
   * @private
   */
  _explodeBomb() {
    this.state.bomb.state = 'exploded';
    this.state.bomb.timer = 0;
    this.audio.explosion();
    // 爆炸特效（简化：场景震屏）
    this._screenShake = 0.5;
    this._endRound('t');
  }

  /**
   * 更新 HUD
   * @private
   */
  _updateHUD() {
    const p = this.player;
    const stats = p.getStats();
    this.hud.updateVitals(stats.health, stats.armor);

    const w = p.getWeaponState();
    this.hud.updateAmmo(w);

    this.hud.updateWeaponBar(p.weapons, p.currentSlot, p.team);

    this.hud.updateScore(this.state.ctScore, this.state.tScore, this.state.round, this.state.maxRounds);
    this.hud.updateRoundPhase(this.state.phase, this.state.phaseTime);
    this.hud.updateEconomy(this.state.ctMoney, this.state.tMoney);
    this.hud.updateBomb(this.state.bomb);
  }

  /**
   * 更新武器栏（强制刷新）
   * @private
   */
  _updateHUDWeaponBar() {
    this.hud.updateWeaponBar(this.player.weapons, this.player.currentSlot, this.player.team);
  }

  /**
   * 渲染计分板
   * @private
   */
  _renderScoreboard() {
    const ctPlayers = [];
    const tPlayers = [];

    // 玩家
    const playerData = {
      name: '玩家',
      team: this.player.team,
      kills: this.player.kills || 0,
      deaths: this.player.deaths || 0,
      assists: 0,
      isAlive: this.player.isAlive,
      money: this.playerTeam === 'ct' ? this.state.ctMoney : this.state.tMoney
    };
    if (this.player.team === 'ct') ctPlayers.push(playerData);
    else tPlayers.push(playerData);

    // AI
    for (const bot of this.allBots) {
      const s = bot.getStats();
      if (bot.team === 'ct') ctPlayers.push(s);
      else tPlayers.push(s);
    }

    this.scoreboard.render({
      ct: ctPlayers,
      t: tPlayers,
      ctScore: this.state.ctScore,
      tScore: this.state.tScore,
      localPlayerName: '玩家'
    });
  }
}
