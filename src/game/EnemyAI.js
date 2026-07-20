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
 *
 * 高精度人物模型与动画系统（v2 深化版）：
 *  - 骨骼层级结构（hip→chest→neck→head，arm→elbow→forearm，leg→knee→ankle）
 *  - 精细化部件（战术背心/护目镜/夜视仪/肩甲/二头肌护甲/腰带扣/弹匣 pouch/
 *              战术背包/背包顶袋/水壶/下颌/耳朵/头盔侧轨/头戴耳机/
 *              肘护甲/手指/膝盖护甲/大腿侧袋/小腿侧袋/鞋头/鞋底/
 *              武器瞄具/前后准星/扳机护圈/拉机柄/护木）
 *  - 几何精度：球体 16x12，胶囊 8x12，圆柱 14 段（v1 的 2 倍）
 *  - 待机呼吸动画（胸腔+颈部+头部三层级联，频率随性格浮动）
 *  - 待机调整姿势（每 4-8 秒一次微转头，增加生命感）
 *  - 行走动画（腿摆动 + 膝盖弯曲 + 脚踝背屈/跖屈 + 肘部弯曲 + 摆臂 + 身体起伏摇晃）
 *  - 奔跑动画（更高步频 + 更大摆幅 + 肘部 90° 弯曲 + 膝盖更深弯曲）
 *  - 射击后坐力动画（右臂上抬 + 右肘弯曲加深 + 武器后仰 + 胸腔微震）
 *  - 枪口火焰（球+点光源，80ms 衰减，随机旋转）
 *  - 换弹动画（双手到胸前 + 双肘弯曲 + 武器抖动 + 武器下沉）
 *  - 受伤反馈（头/颈/胸三层后仰 + 沿攻击方向侧向倾斜 300ms）
 *  - 多阶段死亡动画（头后仰 → 跪倒 → 倒地，1.2 秒，easeOutCubic 缓动，
 *                   随机前倒/左倒/右倒方向）
 *  - 交战持枪姿态（双臂抬起 + 双肘弯曲 + 颈部前倾瞄准）
 *  - 搜索状态（颈部+头部协同扫描，不同频率增加自然感）
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
    // 长期卡住恢复计数（v3 新增）：短时间内反复触发卡住恢复时累加
    // 超过阈值后放弃当前目标（如巡逻点在墙后无通道），避免在墙边无限来回
    this._stuckRecoveryCount = 0;
    // 最后一次卡住恢复的时间戳（秒），用于衰减计数器
    this._lastStuckRecoveryTime = 0;
    // 个人性格种子（不同 AI 有不同行为偏好）
    this._personality = Math.random();
    // retreat 冷却到期时间戳（秒）：避免低血量时 engage↔retreat 死循环抖动
    // 触发：从 retreat 切回 engage 时设置 now + 5 秒，期间即使血量低也不再切 retreat
    this._retreatCooldownUntil = 0;
    // retreat 到达掩体的时间戳（秒）：用于停留观察计时
    this._retreatArriveTime = -1;

    // ---- 动画状态 ----
    // 行走动画相位（用于腿臂摆动 sin 函数）
    this._walkPhase = 0;
    // 上次射击时间（用于射击后坐力动画衰减）
    this._lastShootAnimTime = -10;
    // 受伤动画结束时间（用于头部后仰衰减）
    this._hurtAnimEndTime = 0;
    // 受伤方向（弧度，相对 AI 朝向）：用于侧向倾斜反馈 - v2 新增
    this._hurtDir = 0;
    // 死亡动画阶段（0=未开始, 1=头后仰, 2=跪倒, 3=倒地）
    this._deathStage = 0;
    // 死亡动画累积时间（用 delta 累积，避免低帧率跳过阶段）
    this._deathElapsed = 0;
    // 死亡倒地随机方向（-1 左倒, 1 右倒, 0 前倒） - v2 新增
    this._deathFallDir = 0;
    // 上次水平速度大小（用于判定静止/行走/奔跑）
    this._lastSpeed = 0;
    // 待机时下次"调整姿势"时间（每 4-8 秒一次微动作） - v2 新增
    this._nextIdleAdjust = 0;
    // 当前待机调整动画的剩余时间（0 表示无调整） - v2 新增
    this._idleAdjustRemain = 0;
    // 待机调整目标头部偏转角度 - v2 新增
    this._idleAdjustTarget = 0;

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
   * 构建最高精度骨骼层级角色模型（v2 深化版）
   * --------------------------------------------------------------
   * 层级结构（用于关节动画，括号内为关键 mesh 数量）：
   *   group (root, position=AI位置, rotation.y=yaw)
   *     └── hipGroup (骨盆, y=0.95)
   *          ├── chestGroup (胸腔, y=0.35) - 呼吸/受伤起伏
   *          │    ├── torsoMesh (躯干圆柱, 唯一 castShadow)
   *          │    ├── beltMesh (腰带)
   *          │    ├── vestMesh (战术背心)
   *          │    ├── lampMesh (阵营标识灯条)
   *          │    ├── backpackMesh (战术背包, z=-0.22)
   *          │    ├── neckGroup (颈部, y=0.50) ← v2 新增
   *          │    │    └── headGroup (头部, y=0.12)
   *          │    │         ├── headMesh (头颅球 16段)
   *          │    │         ├── jawMesh (下颌) ← v2 新增
   *          │    │         ├── earMeshL/R (耳朵 x2) ← v2 新增
   *          │    │         ├── helmetMesh (头盔半球 16段)
   *          │    │         ├── helmetRidge (头盔顶脊)
   *          │    │         ├── visorMesh (护目镜)
   *          │    │         └── nightVisionMesh (夜视仪)
   *          │    ├── leftArmGroup (左肩关节, x=-0.42, y=0.32)
   *          │    │    ├── leftUpperArmMesh (上臂胶囊)
   *          │    │    ├── leftShoulder (肩护甲)
   *          │    │    └── leftElbowGroup (肘关节, y=-0.30) ← v2 新增
   *          │    │         ├── leftForearmMesh (前臂胶囊)
   *          │    │         └── leftGlove (手套)
   *          │    └── rightArmGroup (右肩关节, x=0.42, y=0.32) - 射击后坐力
   *          │         ├── rightUpperArmMesh (上臂)
   *          │         ├── rightShoulder (肩护甲)
   *          │         └── rightElbowGroup (肘关节, y=-0.30) ← v2 新增
   *          │              ├── rightForearmMesh (前臂)
   *          │              ├── rightGlove (手套)
   *          │              └── weaponGroup (武器挂在右前臂, y=-0.25, z=-0.10)
   *          │                   ├── weaponBodyMesh (枪身)
   *          │                   ├── weaponMagMesh (弹匣)
   *          │                   ├── weaponGripMesh (握把)
   *          │                   ├── weaponStockMesh (枪托)
   *          │                   ├── weaponMuzzleMesh (枪管)
   *          │                   ├── weaponSightMesh (瞄具) ← v2 新增
   *          │                   ├── weaponTriggerMesh (扳机护圈) ← v2 新增
   *          │                   └── muzzleFlash (枪口火焰组)
   *          ├── leftLegGroup (左髋关节, x=-0.16) - 行走摆动
   *          │    ├── leftThighMesh (大腿)
   *          │    ├── leftThighPocketMesh (大腿侧袋) ← v2 新增
   *          │    └── leftKneeGroup (膝关节, y=-0.42) ← 重命名
   *          │         ├── leftKneePadMesh (膝盖护甲半球) ← v2 新增
   *          │         ├── leftShinMesh (小腿)
   *          │         └── leftAnkleGroup (脚踝关节, y=-0.40) ← v2 新增
   *          │              └── leftBoot (靴子)
   *          └── rightLegGroup (右髋关节, x=0.16) - 行走摆动
   *               ├── rightThighMesh (大腿)
   *               ├── rightThighPocketMesh (大腿侧袋) ← v2 新增
   *               └── rightKneeGroup (膝关节, y=-0.42)
   *                    ├── rightKneePadMesh (膝盖护甲)
   *                    ├── rightShinMesh (小腿)
   *                    └── rightAnkleGroup (脚踝关节, y=-0.40)
   *                         └── rightBoot (靴子)
   *
   * 性能：9 AI 同屏约 380 个 mesh（v1 28→v2 约 42/AI），
   *       所有部件 frustumCulled=true，仅 torsoMesh castShadow=true。
   *       几何精度：球体 16x12，胶囊 8x12，圆柱 14 段（v1 的 2 倍）
   * @private
   */
  _buildModel() {
    this.group = new THREE.Group();

    // ---- 材质（提升 PBR 精度）----
    const teamColor = this.team === 'ct' ? 0x004466 : 0x663300;
    const accentColor = this.team === 'ct' ? 0x00D4FF : 0xFF5500;
    const skinColor = 0xD0A570;
    const gearColor = this.team === 'ct' ? 0x0A2A3A : 0x3A1A0A;
    const bootColor = 0x1A1A1F;
    const backpackColor = this.team === 'ct' ? 0x06222E : 0x2A1408;

    const bodyMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.75, metalness: 0.08 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: accentColor, emissive: accentColor, emissiveIntensity: 0.45, roughness: 0.35
    });
    const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.85, metalness: 0.0 });
    const gearMat = new THREE.MeshStandardMaterial({ color: gearColor, roughness: 0.55, metalness: 0.35 });
    const bootMat = new THREE.MeshStandardMaterial({ color: bootColor, roughness: 0.45, metalness: 0.25 });
    const weaponMat = new THREE.MeshStandardMaterial({ color: 0x1A1A1F, roughness: 0.35, metalness: 0.88 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.25, metalness: 0.96 });
    const backpackMat = new THREE.MeshStandardMaterial({ color: backpackColor, roughness: 0.85, metalness: 0.05 });

    // ---- 骨盆（root of body）----
    const hipGroup = new THREE.Group();
    hipGroup.position.y = 0.95;
    this.group.add(hipGroup);
    this.hipGroup = hipGroup;

    // ---- 胸腔（呼吸/受伤起伏的载体）----
    const chestGroup = new THREE.Group();
    chestGroup.position.y = 0.35;
    hipGroup.add(chestGroup);
    this.chestGroup = chestGroup;

    // 身体躯干（圆锥+圆柱组合，腰部收窄，14 段提升圆度）
    const torsoMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.30, 0.34, 0.7, 14),
      bodyMat
    );
    torsoMesh.position.y = 0.15;
    torsoMesh.castShadow = true;   // 唯一投影部件
    torsoMesh.receiveShadow = false;
    chestGroup.add(torsoMesh);
    this.torsoMesh = torsoMesh;

    // 腰带（细圆柱 + 前方扣环）
    const beltMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.345, 0.345, 0.08, 14),
      gearMat
    );
    beltMesh.position.y = -0.18;
    beltMesh.castShadow = false;
    chestGroup.add(beltMesh);

    // 腰带扣（小金属盒，增加细节）
    const beltBuckle = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.05, 0.025),
      metalMat
    );
    beltBuckle.position.set(0, -0.18, 0.345);
    beltBuckle.castShadow = false;
    chestGroup.add(beltBuckle);

    // 战术背心（胸前方块，增加层次感）
    const vestMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.42, 0.18),
      gearMat
    );
    vestMesh.position.set(0, 0.18, 0.18);
    vestMesh.castShadow = false;
    chestGroup.add(vestMesh);
    this.vestMesh = vestMesh;

    // 背心弹匣插槽（前方 3 个小盒，增加战术细节）
    for (let i = -1; i <= 1; i++) {
      const pouch = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.10, 0.04),
        gearMat
      );
      pouch.position.set(i * 0.11, 0.10, 0.28);
      pouch.castShadow = false;
      chestGroup.add(pouch);
    }

    // 阵营标识灯条（胸前发光带）
    const lampMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.04, 0.02),
      accentMat
    );
    lampMesh.position.set(0, 0.32, 0.275);
    lampMesh.castShadow = false;
    chestGroup.add(lampMesh);
    this.lamp = lampMesh;

    // 战术背包（背后方块，z=-0.22）
    const backpackMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.42, 0.18),
      backpackMat
    );
    backpackMesh.position.set(0, 0.15, -0.24);
    backpackMesh.castShadow = false;
    chestGroup.add(backpackMesh);
    // 背包顶袋（小盒，增加细节）
    const backpackTopPouch = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.08, 0.10),
      backpackMat
    );
    backpackTopPouch.position.set(0, 0.38, -0.24);
    backpackTopPouch.castShadow = false;
    chestGroup.add(backpackTopPouch);
    // 背包侧水壶（左右各一个小圆柱）
    const backpackSideL = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.16, 8),
      backpackMat
    );
    backpackSideL.position.set(-0.22, 0.10, -0.24);
    backpackSideL.castShadow = false;
    chestGroup.add(backpackSideL);
    const backpackSideR = backpackSideL.clone();
    backpackSideR.position.x = 0.22;
    chestGroup.add(backpackSideR);

    // ---- 颈部组（v2 新增：让头部独立于胸腔转动）----
    const neckGroup = new THREE.Group();
    neckGroup.position.y = 0.50;
    chestGroup.add(neckGroup);
    this.neckGroup = neckGroup;

    // 颈部圆柱（皮肤色，短粗）
    const neckMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.10, 0.12, 10),
      skinMat
    );
    neckMesh.position.y = 0.06;
    neckMesh.castShadow = false;
    neckGroup.add(neckMesh);

    // ---- 头部组（挂在颈部下，转头/后仰的载体）----
    const headGroup = new THREE.Group();
    headGroup.position.y = 0.12;
    neckGroup.add(headGroup);
    this.headGroup = headGroup;

    // 头颅（球，16x12 提升精度）
    const headMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.20, 16, 12),
      skinMat
    );
    headMesh.castShadow = false;
    headGroup.add(headMesh);
    this.headMesh = headMesh;

    // 下颌（小盒，增加面部轮廓） - v2 新增
    const jawMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.08, 0.16),
      skinMat
    );
    jawMesh.position.set(0, -0.10, 0.08);
    jawMesh.castShadow = false;
    headGroup.add(jawMesh);

    // 耳朵（左右各一小扁球） - v2 新增
    const earGeo = new THREE.SphereGeometry(0.04, 8, 6);
    const earMeshL = new THREE.Mesh(earGeo, skinMat);
    earMeshL.position.set(-0.18, 0.0, 0.0);
    earMeshL.scale.set(0.6, 1.0, 1.4);
    earMeshL.castShadow = false;
    headGroup.add(earMeshL);
    const earMeshR = new THREE.Mesh(earGeo, skinMat);
    earMeshR.position.set(0.18, 0.0, 0.0);
    earMeshR.scale.set(0.6, 1.0, 1.4);
    earMeshR.castShadow = false;
    headGroup.add(earMeshR);

    // 头盔（半球，16x8 提升精度）
    const helmetMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.235, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      gearMat
    );
    helmetMesh.position.y = 0.02;
    helmetMesh.castShadow = false;
    headGroup.add(helmetMesh);
    this.helmetMesh = helmetMesh;

    // 头盔顶部脊（小方块，增加战术感）
    const helmetRidge = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.04, 0.30),
      gearMat
    );
    helmetRidge.position.set(0, 0.24, 0);
    helmetRidge.castShadow = false;
    headGroup.add(helmetRidge);

    // 头盔侧轨（左右各一条，挂载配件感） - v2 新增
    const helmetRailL = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.06, 0.30),
      gearMat
    );
    helmetRailL.position.set(-0.20, 0.08, 0);
    helmetRailL.castShadow = false;
    headGroup.add(helmetRailL);
    const helmetRailR = helmetRailL.clone();
    helmetRailR.position.x = 0.20;
    headGroup.add(helmetRailR);

    // 护目镜（黑色椭圆扁片）
    const visorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.08, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.2, metalness: 0.5 })
    );
    visorMesh.position.set(0, 0.04, 0.18);
    visorMesh.castShadow = false;
    headGroup.add(visorMesh);
    this.visorMesh = visorMesh;

    // 夜视仪小盒（头盔前突）
    const nightVisionMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.06, 0.08),
      gearMat
    );
    nightVisionMesh.position.set(0, 0.14, 0.22);
    nightVisionMesh.castShadow = false;
    headGroup.add(nightVisionMesh);

    // 头戴式耳机（左右半球，连接护目镜下方） - v2 新增
    const headsetGeo = new THREE.SphereGeometry(0.06, 10, 6);
    const headsetL = new THREE.Mesh(headsetGeo, gearMat);
    headsetL.position.set(-0.22, -0.02, 0);
    headsetL.scale.set(0.5, 1.0, 1.2);
    headsetL.castShadow = false;
    headGroup.add(headsetL);
    const headsetR = new THREE.Mesh(headsetGeo, gearMat);
    headsetR.position.set(0.22, -0.02, 0);
    headsetR.scale.set(0.5, 1.0, 1.2);
    headsetR.castShadow = false;
    headGroup.add(headsetR);

    // ---- 左臂组（左肩关节）----
    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(-0.42, 0.32, 0);
    chestGroup.add(leftArmGroup);
    this.leftArmGroup = leftArmGroup;

    // 左上臂（短胶囊，到肘部）
    const leftUpperArmMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.085, 0.25, 8, 12),
      bodyMat
    );
    leftUpperArmMesh.position.y = -0.17;
    leftUpperArmMesh.castShadow = false;
    leftArmGroup.add(leftUpperArmMesh);

    // 左肩护甲（半球）
    const leftShoulder = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 12, 8),
      gearMat
    );
    leftShoulder.position.y = -0.02;
    leftShoulder.castShadow = false;
    leftArmGroup.add(leftShoulder);

    // 左二头肌护甲（小半球，增加手臂细节） - v2 新增
    const leftBicep = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 6),
      gearMat
    );
    leftBicep.position.set(0, -0.15, 0.06);
    leftBicep.scale.set(0.8, 1.2, 0.8);
    leftBicep.castShadow = false;
    leftArmGroup.add(leftBicep);

    // 左肘关节组（v2 新增：前臂可独立弯曲）
    const leftElbowGroup = new THREE.Group();
    leftElbowGroup.position.y = -0.30;
    leftArmGroup.add(leftElbowGroup);
    this.leftElbowGroup = leftElbowGroup;

    // 左前臂（胶囊）
    const leftForearmMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.075, 0.25, 8, 12),
      bodyMat
    );
    leftForearmMesh.position.y = -0.17;
    leftForearmMesh.castShadow = false;
    leftElbowGroup.add(leftForearmMesh);

    // 左肘关节护甲（小扁球，覆盖肘部） - v2 新增
    const leftElbowPad = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 6),
      gearMat
    );
    leftElbowPad.position.set(0, 0, 0.05);
    leftElbowPad.scale.set(1.0, 0.7, 1.0);
    leftElbowPad.castShadow = false;
    leftElbowGroup.add(leftElbowPad);

    // 左手套（小盒，含 4 指凸起感） - v2 加细节
    const leftGlove = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.12, 0.16),
      gearMat
    );
    leftGlove.position.set(0, -0.32, 0.01);
    leftGlove.castShadow = false;
    leftElbowGroup.add(leftGlove);
    // 左手套手指（小盒，前突）
    const leftFingers = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.06, 0.06),
      gearMat
    );
    leftFingers.position.set(0, -0.32, 0.10);
    leftFingers.castShadow = false;
    leftElbowGroup.add(leftFingers);

    // ---- 右臂组（右肩关节，挂武器）----
    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(0.42, 0.32, 0);
    chestGroup.add(rightArmGroup);
    this.rightArmGroup = rightArmGroup;

    // 右上臂
    const rightUpperArmMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.085, 0.25, 8, 12),
      bodyMat
    );
    rightUpperArmMesh.position.y = -0.17;
    rightUpperArmMesh.castShadow = false;
    rightArmGroup.add(rightUpperArmMesh);

    // 右肩护甲
    const rightShoulder = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 12, 8),
      gearMat
    );
    rightShoulder.position.y = -0.02;
    rightShoulder.castShadow = false;
    rightArmGroup.add(rightShoulder);

    // 右二头肌护甲 - v2 新增
    const rightBicep = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 6),
      gearMat
    );
    rightBicep.position.set(0, -0.15, 0.06);
    rightBicep.scale.set(0.8, 1.2, 0.8);
    rightBicep.castShadow = false;
    rightArmGroup.add(rightBicep);

    // 右肘关节组 - v2 新增
    const rightElbowGroup = new THREE.Group();
    rightElbowGroup.position.y = -0.30;
    rightArmGroup.add(rightElbowGroup);
    this.rightElbowGroup = rightElbowGroup;

    // 右前臂
    const rightForearmMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.075, 0.25, 8, 12),
      bodyMat
    );
    rightForearmMesh.position.y = -0.17;
    rightForearmMesh.castShadow = false;
    rightElbowGroup.add(rightForearmMesh);

    // 右肘关节护甲 - v2 新增
    const rightElbowPad = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 6),
      gearMat
    );
    rightElbowPad.position.set(0, 0, 0.05);
    rightElbowPad.scale.set(1.0, 0.7, 1.0);
    rightElbowPad.castShadow = false;
    rightElbowGroup.add(rightElbowPad);

    // 右手套
    const rightGlove = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.12, 0.16),
      gearMat
    );
    rightGlove.position.set(0, -0.32, 0.01);
    rightGlove.castShadow = false;
    rightElbowGroup.add(rightGlove);
    // 右手套手指
    const rightFingers = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.06, 0.06),
      gearMat
    );
    rightFingers.position.set(0, -0.32, 0.10);
    rightFingers.castShadow = false;
    rightElbowGroup.add(rightFingers);

    // ---- 武器组（挂在右肘下）----
    // 修复：武器部件本地 z 坐标枪口朝 -Z，但人体正面朝 +Z
    // 通过 weaponGroup.rotation.y = π 翻转武器朝向，让枪口与人体正面一致
    const weaponGroup = new THREE.Group();
    weaponGroup.position.set(0, -0.30, -0.10);
    weaponGroup.rotation.y = Math.PI;  // 翻转武器朝向，枪口朝 +Z（与人体正面一致）
    rightElbowGroup.add(weaponGroup);
    this.weaponGroup = weaponGroup;

    // 枪身（主体盒子，沿 Z 方向延伸）
    const weaponBodyMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.10, 0.55),
      weaponMat
    );
    weaponBodyMesh.position.set(0, 0, -0.10);
    weaponBodyMesh.castShadow = false;
    weaponGroup.add(weaponBodyMesh);

    // 枪身护木（前段加粗圆柱，握持部位） - v2 新增
    const weaponHandguard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10),
      weaponMat
    );
    weaponHandguard.rotation.x = Math.PI / 2;
    weaponHandguard.position.set(0, 0, -0.25);
    weaponHandguard.castShadow = false;
    weaponGroup.add(weaponHandguard);

    // 弹匣（向下凸出）
    const weaponMagMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.18, 0.08),
      metalMat
    );
    weaponMagMesh.position.set(0, -0.13, 0.05);
    weaponMagMesh.castShadow = false;
    weaponGroup.add(weaponMagMesh);

    // 握把（向下倾斜）
    const weaponGripMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.14, 0.06),
      weaponMat
    );
    weaponGripMesh.position.set(0, -0.12, 0.18);
    weaponGripMesh.rotation.x = 0.2;
    weaponGripMesh.castShadow = false;
    weaponGroup.add(weaponGripMesh);

    // 枪托（向后延伸）
    const weaponStockMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.09, 0.20),
      weaponMat
    );
    weaponStockMesh.position.set(0, -0.01, 0.28);
    weaponStockMesh.castShadow = false;
    weaponGroup.add(weaponStockMesh);

    // 枪管（向前延伸的圆柱，10 段提升精度）
    const weaponMuzzleMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.35, 10),
      metalMat
    );
    weaponMuzzleMesh.rotation.x = Math.PI / 2;
    weaponMuzzleMesh.position.set(0, 0.01, -0.45);
    weaponMuzzleMesh.castShadow = false;
    weaponGroup.add(weaponMuzzleMesh);
    this.weaponMuzzleMesh = weaponMuzzleMesh;

    // 武器瞄具（顶部小盒 + 准星柱） - v2 新增
    const weaponSightMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.10),
      metalMat
    );
    weaponSightMesh.position.set(0, 0.08, -0.05);
    weaponSightMesh.castShadow = false;
    weaponGroup.add(weaponSightMesh);
    // 后准星（圆环，简化为小圆柱）
    const weaponRearSight = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.04, 6),
      metalMat
    );
    weaponRearSight.position.set(0, 0.075, 0.10);
    weaponRearSight.castShadow = false;
    weaponGroup.add(weaponRearSight);
    // 前准星（小柱）
    const weaponFrontSight = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.05, 6),
      metalMat
    );
    weaponFrontSight.position.set(0, 0.085, -0.32);
    weaponFrontSight.castShadow = false;
    weaponGroup.add(weaponFrontSight);

    // 扳机护圈（小圆环，简化为扁圆柱） - v2 新增
    const weaponTriggerMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.025, 0.008, 6, 10),
      metalMat
    );
    weaponTriggerMesh.rotation.x = Math.PI / 2;
    weaponTriggerMesh.position.set(0, -0.07, 0.18);
    weaponTriggerMesh.castShadow = false;
    weaponGroup.add(weaponTriggerMesh);

    // 拉机柄（小柱，右侧凸出） - v2 新增
    const weaponChargingHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.08, 6),
      metalMat
    );
    weaponChargingHandle.rotation.z = Math.PI / 2;
    weaponChargingHandle.position.set(0.05, 0.04, 0.05);
    weaponChargingHandle.castShadow = false;
    weaponGroup.add(weaponChargingHandle);

    // ---- 左腿组（左髋关节）----
    const leftLegGroup = new THREE.Group();
    leftLegGroup.position.set(-0.16, -0.15, 0);
    hipGroup.add(leftLegGroup);
    this.leftLegGroup = leftLegGroup;

    // 左大腿（胶囊，8x12 提升精度）
    const leftThighMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.12, 0.30, 8, 12),
      bodyMat
    );
    leftThighMesh.position.y = -0.20;
    leftThighMesh.castShadow = false;
    leftLegGroup.add(leftThighMesh);

    // 左大腿侧袋（战术口袋） - v2 新增
    const leftThighPocketMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.18, 0.06),
      gearMat
    );
    leftThighPocketMesh.position.set(-0.06, -0.18, 0.07);
    leftThighPocketMesh.rotation.z = 0.1;
    leftThighPocketMesh.castShadow = false;
    leftLegGroup.add(leftThighPocketMesh);

    // 左膝关节组（重命名：leftShinGroup → leftKneeGroup）
    // 保留 this.leftShinGroup 作为兼容别名，避免破坏既有动画代码
    const leftKneeGroup = new THREE.Group();
    leftKneeGroup.position.y = -0.40;
    leftLegGroup.add(leftKneeGroup);
    this.leftKneeGroup = leftKneeGroup;
    this.leftShinGroup = leftKneeGroup;  // 兼容别名

    // 左膝盖护甲（半球，凸向前） - v2 新增
    const leftKneePadMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      gearMat
    );
    leftKneePadMesh.position.set(0, 0, 0.05);
    leftKneePadMesh.rotation.x = Math.PI / 2;
    leftKneePadMesh.castShadow = false;
    leftKneeGroup.add(leftKneePadMesh);

    // 左小腿（胶囊）
    const leftShinMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.10, 0.25, 8, 12),
      bodyMat
    );
    leftShinMesh.position.y = -0.18;
    leftShinMesh.castShadow = false;
    leftKneeGroup.add(leftShinMesh);

    // 左小腿侧袋（小腿战术口袋） - v2 新增
    const leftShinPocketMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.12, 0.05),
      gearMat
    );
    leftShinPocketMesh.position.set(-0.05, -0.18, 0.06);
    leftShinPocketMesh.castShadow = false;
    leftKneeGroup.add(leftShinPocketMesh);

    // 左脚踝关节组 - v2 新增（落地时脚部独立弯曲）
    const leftAnkleGroup = new THREE.Group();
    leftAnkleGroup.position.y = -0.36;
    leftKneeGroup.add(leftAnkleGroup);
    this.leftAnkleGroup = leftAnkleGroup;

    // 左靴（盒子，含鞋头凸起）
    const leftBoot = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.10, 0.28),
      bootMat
    );
    leftBoot.position.set(0, -0.04, 0.06);
    leftBoot.castShadow = false;
    leftAnkleGroup.add(leftBoot);
    // 左鞋头（前突小盒，增加鞋型轮廓） - v2 新增
    const leftBootToe = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.06, 0.06),
      bootMat
    );
    leftBootToe.position.set(0, -0.06, 0.20);
    leftBootToe.castShadow = false;
    leftAnkleGroup.add(leftBootToe);
    // 左鞋底（薄黑色盒，强化视觉层次） - v2 新增
    const leftBootSole = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.02, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.6, metalness: 0.0 })
    );
    leftBootSole.position.set(0, -0.10, 0.06);
    leftBootSole.castShadow = false;
    leftAnkleGroup.add(leftBootSole);

    // ---- 右腿组（右髋关节）----
    const rightLegGroup = new THREE.Group();
    rightLegGroup.position.set(0.16, -0.15, 0);
    hipGroup.add(rightLegGroup);
    this.rightLegGroup = rightLegGroup;

    // 右大腿
    const rightThighMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.12, 0.30, 8, 12),
      bodyMat
    );
    rightThighMesh.position.y = -0.20;
    rightThighMesh.castShadow = false;
    rightLegGroup.add(rightThighMesh);

    // 右大腿侧袋 - v2 新增
    const rightThighPocketMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.18, 0.06),
      gearMat
    );
    rightThighPocketMesh.position.set(0.06, -0.18, 0.07);
    rightThighPocketMesh.rotation.z = -0.1;
    rightThighPocketMesh.castShadow = false;
    rightLegGroup.add(rightThighPocketMesh);

    // 右膝关节组 - v2 重命名
    const rightKneeGroup = new THREE.Group();
    rightKneeGroup.position.y = -0.40;
    rightLegGroup.add(rightKneeGroup);
    this.rightKneeGroup = rightKneeGroup;
    this.rightShinGroup = rightKneeGroup;  // 兼容别名

    // 右膝盖护甲 - v2 新增
    const rightKneePadMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      gearMat
    );
    rightKneePadMesh.position.set(0, 0, 0.05);
    rightKneePadMesh.rotation.x = Math.PI / 2;
    rightKneePadMesh.castShadow = false;
    rightKneeGroup.add(rightKneePadMesh);

    // 右小腿
    const rightShinMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.10, 0.25, 8, 12),
      bodyMat
    );
    rightShinMesh.position.y = -0.18;
    rightShinMesh.castShadow = false;
    rightKneeGroup.add(rightShinMesh);

    // 右小腿侧袋 - v2 新增
    const rightShinPocketMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.12, 0.05),
      gearMat
    );
    rightShinPocketMesh.position.set(0.05, -0.18, 0.06);
    rightShinPocketMesh.castShadow = false;
    rightKneeGroup.add(rightShinPocketMesh);

    // 右脚踝关节组 - v2 新增
    const rightAnkleGroup = new THREE.Group();
    rightAnkleGroup.position.y = -0.36;
    rightKneeGroup.add(rightAnkleGroup);
    this.rightAnkleGroup = rightAnkleGroup;

    // 右靴
    const rightBoot = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.10, 0.28),
      bootMat
    );
    rightBoot.position.set(0, -0.04, 0.06);
    rightBoot.castShadow = false;
    rightAnkleGroup.add(rightBoot);
    // 右鞋头 - v2 新增
    const rightBootToe = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.06, 0.06),
      bootMat
    );
    rightBootToe.position.set(0, -0.06, 0.20);
    rightBootToe.castShadow = false;
    rightAnkleGroup.add(rightBootToe);
    // 右鞋底 - v2 新增
    const rightBootSole = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.02, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.6, metalness: 0.0 })
    );
    rightBootSole.position.set(0, -0.10, 0.06);
    rightBootSole.castShadow = false;
    rightAnkleGroup.add(rightBootSole);

    // ---- 枪口火焰（默认隐藏）----
    this._buildMuzzleFlash();

    // 同步初始位置
    this.group.position.copy(this.position);
  }

  /**
   * 构建枪口火焰：球 + 点光源，射击时短暂闪现
   * 默认隐藏，由 _shootAtPlayer 触发，_updateMuzzleFlash 衰减
   * @private
   */
  _buildMuzzleFlash() {
    const flashGroup = new THREE.Group();
    // 火焰球（核心）
    const flashCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xFFDD66, transparent: true, opacity: 0 })
    );
    flashCore.castShadow = false;
    flashGroup.add(flashCore);
    // 火焰外层（带发光）
    const flashOuter = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xFF8800, transparent: true, opacity: 0 })
    );
    flashOuter.castShadow = false;
    flashGroup.add(flashOuter);
    // 点光源（短暂照亮周围）
    const flashLight = new THREE.PointLight(0xFFAA44, 0, 4);
    flashLight.castShadow = false;
    flashGroup.add(flashLight);
    // 挂到枪口位置
    flashGroup.position.set(0, 0.01, -0.65);
    this.weaponGroup.add(flashGroup);
    this.muzzleFlash = flashGroup;
    this.muzzleFlashCore = flashCore;
    this.muzzleFlashOuter = flashOuter;
    this.muzzleFlashLight = flashLight;
    this.muzzleFlashEndTime = 0;
  }

  /**
   * 更新枪口火焰：根据当前时间衰减透明度
   * @param {number} now 当前时间（秒）
   * @private
   */
  _updateMuzzleFlash(now) {
    if (now < this.muzzleFlashEndTime) {
      // 闪烁中：根据剩余时间计算透明度（前 30% 最亮，后 70% 快速衰减）
      const remain = this.muzzleFlashEndTime - now;
      const total = 0.08;  // 总持续 80ms
      const t = Math.max(0, remain / total);
      const opacity = Math.min(1, t * 1.4);
      this.muzzleFlashCore.material.opacity = opacity;
      this.muzzleFlashOuter.material.opacity = opacity * 0.6;
      this.muzzleFlashLight.intensity = opacity * 3.0;
      // 随机轻微缩放，模拟火焰跳动
      const s = 0.8 + Math.random() * 0.4;
      this.muzzleFlash.scale.set(s, s, s);
    } else {
      this.muzzleFlashCore.material.opacity = 0;
      this.muzzleFlashOuter.material.opacity = 0;
      this.muzzleFlashLight.intensity = 0;
    }
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
      // 多阶段死亡动画
      this._updateDeathAnimation(delta);
      // 枪口火焰继续衰减
      const nowDeath = performance.now() / 1000;
      this._updateMuzzleFlash(nowDeath);
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
    // 改进（v2）：处理撞墙反馈，清零法线速度分量，避免持续推墙震荡
    const collision = this.physics.resolve(this.position, this.radius, this.height);
    if (collision.collided && collision.normal.lengthSq() > 0.01) {
      // 撞墙：将速度沿墙法线分量清零（保留切线分量，让 AI 沿墙滑动）
      const velDotNormal = this.velocity.x * collision.normal.x + this.velocity.z * collision.normal.z;
      if (velDotNormal < 0) {  // 只有朝墙推时才清零（避免背离墙时误清）
        this.velocity.x -= velDotNormal * collision.normal.x;
        this.velocity.z -= velDotNormal * collision.normal.z;
      }
    }

    // ---- 同步模型位置 ----
    this.group.position.copy(this.position);
    this.hitMesh.position.copy(this.position);

    // ---- 平滑朝向 ----
    this._updateFacing(delta);

    // ---- 武器状态更新 ----
    this.weapon.update(now);

    // ---- 人物动画 ----
    this._updateAnimation(delta, now);

    // ---- 枪口火焰衰减 ----
    this._updateMuzzleFlash(now);
  }

  /**
   * 人物动画系统 v2：根据当前状态驱动各关节动画
   * --------------------------------------------------------------
   * 包含：
   *  - 待机呼吸（胸腔+颈部+头部三层级联动画）
   *  - 待机调整姿势（每 4-8 秒一次微转头，增加生命感）
   *  - 行走动画（腿摆动 + 膝盖弯曲 + 脚踝背屈/跖屈 + 肘部弯曲 + 摆臂）
   *  - 奔跑动画（更大摆幅 + 肘部 90° 弯曲 + 膝盖更深弯曲）
   *  - 交战持枪姿态（双臂抬起 + 双肘弯曲 + 颈部前倾瞄准）
   *  - 换弹动画（双手到胸前 + 武器抖动 + 武器下沉）
   *  - 射击后坐力（右臂上抬 + 右肘加深 + 武器后仰 + 胸腔微震）
   *  - 受伤反馈（头/颈/胸三层后仰 + 沿攻击方向侧向倾斜）
   *  - 搜索状态（颈部+头部协同扫描，不同频率）
   * 改进点（v2）：
   *  - 新增肘关节动画（前臂独立弯曲，行走/持枪/换弹不同姿态）
   *  - 新增脚踝关节动画（落地时背屈，抬起时跖屈）
   *  - 新增颈部独立动画（呼吸/瞄准/搜索时颈部协同）
   *  - 受伤方向反馈：根据攻击者相对方向侧向倾斜
   *  - 待机微动作：每 4-8 秒一次随机转头
   * @param {number} delta 帧间隔（秒）
   * @param {number} now 当前时间（秒）
   * @private
   */
  _updateAnimation(delta, now) {
    // ---- 计算水平速度（用于判定静止/行走/奔跑）----
    const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
    this._lastSpeed = THREE.MathUtils.lerp(this._lastSpeed, speed, 0.2);

    // ---- 待机呼吸：胸腔 + 颈部 + 头部三层级联 ----
    // 呼吸频率：1.5 秒一次（随性格略有差异）
    const breathFreq = 1.5 + (this._personality - 0.5) * 0.4;
    const breath = Math.sin(now * breathFreq * Math.PI) * 0.012;
    this.chestGroup.position.y = 0.35 + breath;
    // 颈部随呼吸轻微转动（v2 新增）
    this.neckGroup.rotation.x = breath * 0.15;
    this.neckGroup.rotation.z = breath * 0.05;

    // ---- 待机调整姿势（v2 新增）：每 4-8 秒一次微转头，增加生命感 ----
    if (this._lastSpeed < 0.5 && this.state !== 'engage' && this.state !== 'investigate') {
      if (now > this._nextIdleAdjust && this._idleAdjustRemain <= 0) {
        this._nextIdleAdjust = now + 4 + Math.random() * 4;
        this._idleAdjustRemain = 1.2 + Math.random() * 0.8;
        this._idleAdjustTarget = (Math.random() - 0.5) * 0.6;
      }
      if (this._idleAdjustRemain > 0) {
        this._idleAdjustRemain -= delta;
        // 平滑过渡到目标角度
        this.headGroup.rotation.y = THREE.MathUtils.lerp(
          this.headGroup.rotation.y, this._idleAdjustTarget, 0.05
        );
      }
    } else {
      this._idleAdjustRemain = 0;
      this._nextIdleAdjust = now + 4;
    }

    // ---- 行走/奔跑动画 ----
    if (this._lastSpeed > 0.5) {
      // 步频：速度越快频率越高
      const stepFreq = 1.5 + Math.min(this._lastSpeed, 5.0) * 0.5;
      this._walkPhase += delta * stepFreq * Math.PI;

      const isRunning = this._lastSpeed > 4.0 && this.state !== 'engage';
      const swingAmp = isRunning ? 0.55 : 0.35;
      const bodyBounce = isRunning ? 0.06 : 0.03;

      const swing = Math.sin(this._walkPhase) * swingAmp;
      const swingOpp = Math.sin(this._walkPhase + Math.PI) * swingAmp;

      // 腿摆动（髋关节）
      this.leftLegGroup.rotation.x = swing;
      this.rightLegGroup.rotation.x = swingOpp;
      // 膝关节弯曲（行走时小腿轻微弯曲，奔跑时更明显）
      const kneeBend = Math.max(0, Math.sin(this._walkPhase + Math.PI / 2)) * (isRunning ? 0.6 : 0.25);
      const kneeBendOpp = Math.max(0, Math.sin(this._walkPhase + Math.PI + Math.PI / 2)) * (isRunning ? 0.6 : 0.25);
      this.leftKneeGroup.rotation.x = kneeBend;
      this.rightKneeGroup.rotation.x = kneeBendOpp;

      // 脚踝关节弯曲（v2 新增）：腿前摆时脚尖上抬（背屈），腿后摆时脚尖下垂（跖屈）
      const ankleBendL = Math.sin(this._walkPhase + Math.PI / 4) * 0.3;
      const ankleBendR = Math.sin(this._walkPhase + Math.PI + Math.PI / 4) * 0.3;
      this.leftAnkleGroup.rotation.x = ankleBendL;
      this.rightAnkleGroup.rotation.x = ankleBendR;

      // 手臂反向摆动 + 肘部弯曲（v2 新增）
      if (this.state !== 'engage' && this.state !== 'reload' && this.state !== 'retreat') {
        this.leftArmGroup.rotation.x = swingOpp * 0.6;
        this.rightArmGroup.rotation.x = swing * 0.6;
        // 肘部基础弯曲：行走 30°，奔跑 80°（自然姿态）
        const elbowBase = isRunning ? 1.4 : 0.5;
        // 摆臂时肘部弯曲度跟随摆动相位变化（前摆时更弯）
        const elbowVarL = Math.max(0, Math.sin(this._walkPhase + Math.PI / 3)) * 0.3;
        const elbowVarR = Math.max(0, Math.sin(this._walkPhase + Math.PI / 3)) * 0.3;
        this.leftElbowGroup.rotation.x = elbowBase + elbowVarL;
        this.rightElbowGroup.rotation.x = elbowBase + elbowVarR;
      }

      // 身体上下起伏 + 左右轻微摇晃
      const bounce = Math.abs(Math.sin(this._walkPhase * 2)) * bodyBounce;
      this.hipGroup.position.y = 0.95 + bounce;
      this.hipGroup.rotation.z = Math.sin(this._walkPhase) * 0.02;
    } else {
      // 静止：所有关节缓慢回归原位
      this.leftLegGroup.rotation.x = THREE.MathUtils.lerp(this.leftLegGroup.rotation.x, 0, 0.15);
      this.rightLegGroup.rotation.x = THREE.MathUtils.lerp(this.rightLegGroup.rotation.x, 0, 0.15);
      this.leftKneeGroup.rotation.x = THREE.MathUtils.lerp(this.leftKneeGroup.rotation.x, 0, 0.15);
      this.rightKneeGroup.rotation.x = THREE.MathUtils.lerp(this.rightKneeGroup.rotation.x, 0, 0.15);
      // 脚踝归位（v2 新增）
      this.leftAnkleGroup.rotation.x = THREE.MathUtils.lerp(this.leftAnkleGroup.rotation.x, 0, 0.15);
      this.rightAnkleGroup.rotation.x = THREE.MathUtils.lerp(this.rightAnkleGroup.rotation.x, 0, 0.15);
      if (this.state !== 'engage' && this.state !== 'reload' && this.state !== 'retreat') {
        this.leftArmGroup.rotation.x = THREE.MathUtils.lerp(this.leftArmGroup.rotation.x, 0, 0.15);
        this.rightArmGroup.rotation.x = THREE.MathUtils.lerp(this.rightArmGroup.rotation.x, 0, 0.15);
        // 肘部归位到轻微弯曲 0.2（自然下垂姿态，v2 新增）
        this.leftElbowGroup.rotation.x = THREE.MathUtils.lerp(this.leftElbowGroup.rotation.x, 0.2, 0.15);
        this.rightElbowGroup.rotation.x = THREE.MathUtils.lerp(this.rightElbowGroup.rotation.x, 0.2, 0.15);
      }
      this.hipGroup.position.y = THREE.MathUtils.lerp(this.hipGroup.position.y, 0.95, 0.2);
      this.hipGroup.rotation.z = THREE.MathUtils.lerp(this.hipGroup.rotation.z, 0, 0.15);
    }

    // ---- 交战姿态：双手持枪 + 双肘弯曲 + 颈部前倾瞄准 ----
    if (this.state === 'engage') {
      // 左臂抬起扶枪（向前伸）
      this.leftArmGroup.rotation.x = THREE.MathUtils.lerp(this.leftArmGroup.rotation.x, -1.1, 0.2);
      this.leftArmGroup.rotation.z = THREE.MathUtils.lerp(this.leftArmGroup.rotation.z, 0.3, 0.2);
      // 左肘弯曲：前臂指向枪身（v2 新增）
      this.leftElbowGroup.rotation.x = THREE.MathUtils.lerp(this.leftElbowGroup.rotation.x, -1.2, 0.2);
      // 右臂自然下垂持枪
      this.rightArmGroup.rotation.x = THREE.MathUtils.lerp(this.rightArmGroup.rotation.x, -0.3, 0.2);
      // 右肘弯曲：前臂指向握把（v2 新增）
      this.rightElbowGroup.rotation.x = THREE.MathUtils.lerp(this.rightElbowGroup.rotation.x, -0.6, 0.2);
      // 颈部微前倾（瞄准姿态，v2 新增）
      this.neckGroup.rotation.x = THREE.MathUtils.lerp(this.neckGroup.rotation.x, -0.08, 0.1);
      this.headGroup.rotation.x = THREE.MathUtils.lerp(this.headGroup.rotation.x, 0, 0.1);
    } else if (this.state === 'reload' || this.state === 'retreat') {
      // 换弹/撤退：双手下沉到胸前
      this.leftArmGroup.rotation.x = THREE.MathUtils.lerp(this.leftArmGroup.rotation.x, -0.5, 0.15);
      this.rightArmGroup.rotation.x = THREE.MathUtils.lerp(this.rightArmGroup.rotation.x, -0.5, 0.15);
      // 肘部弯曲加深（双手到胸前，v2 新增）
      this.leftElbowGroup.rotation.x = THREE.MathUtils.lerp(this.leftElbowGroup.rotation.x, -1.5, 0.15);
      this.rightElbowGroup.rotation.x = THREE.MathUtils.lerp(this.rightElbowGroup.rotation.x, -1.5, 0.15);
      // 换弹时武器抖动 + 下沉（模拟换弹匣操作）
      if (this.state === 'reload' && this.weapon.isReloading) {
        const reloadShake = Math.sin(now * 25) * 0.08;
        this.rightArmGroup.rotation.z = reloadShake;
        this.weaponGroup.rotation.z = reloadShake * 0.5;
        // 武器下沉（手放下换弹匣，v2 新增）
        this.weaponGroup.position.y = THREE.MathUtils.lerp(this.weaponGroup.position.y, -0.36, 0.15);
      } else {
        this.rightArmGroup.rotation.z = THREE.MathUtils.lerp(this.rightArmGroup.rotation.z, 0, 0.15);
        this.weaponGroup.rotation.z = THREE.MathUtils.lerp(this.weaponGroup.rotation.z, 0, 0.15);
        this.weaponGroup.position.y = THREE.MathUtils.lerp(this.weaponGroup.position.y, -0.30, 0.15);
      }
      // 颈部回归
      this.neckGroup.rotation.x = THREE.MathUtils.lerp(this.neckGroup.rotation.x, 0, 0.1);
    } else {
      // 巡逻/搜索/待机：手臂自然下垂
      this.leftArmGroup.rotation.z = THREE.MathUtils.lerp(this.leftArmGroup.rotation.z, 0, 0.1);
      this.rightArmGroup.rotation.z = THREE.MathUtils.lerp(this.rightArmGroup.rotation.z, 0, 0.1);
      this.weaponGroup.rotation.z = THREE.MathUtils.lerp(this.weaponGroup.rotation.z, 0, 0.1);
      this.weaponGroup.position.y = THREE.MathUtils.lerp(this.weaponGroup.position.y, -0.30, 0.1);
      this.neckGroup.rotation.x = THREE.MathUtils.lerp(this.neckGroup.rotation.x, 0, 0.1);
    }

    // ---- 射击后坐力动画：右臂上抬 + 右肘加深 + 武器后仰 ----
    // 衰减：0.15 秒内从峰值衰减到 0
    const recoilElapsed = now - this._lastShootAnimTime;
    if (recoilElapsed < 0.15) {
      const recoilT = Math.max(0, 1 - recoilElapsed / 0.15);
      const recoil = Math.sin(recoilT * Math.PI) * 0.35;
      // 右臂上抬
      this.rightArmGroup.rotation.x -= recoil * 0.5;
      // 右肘弯曲加深（被后坐力带起，v2 新增）
      this.rightElbowGroup.rotation.x -= recoil * 0.3;
      // 武器后仰
      this.weaponGroup.rotation.x = -recoil * 0.4;
      // 胸腔微震
      this.chestGroup.rotation.x = -recoil * 0.05;
    } else {
      this.weaponGroup.rotation.x = THREE.MathUtils.lerp(this.weaponGroup.rotation.x, 0, 0.2);
      this.chestGroup.rotation.x = THREE.MathUtils.lerp(this.chestGroup.rotation.x, 0, 0.2);
    }

    // ---- 受伤反馈：头部+颈部+胸腔三层后仰 + 侧向倾斜（v2 强化）----
    if (now < this._hurtAnimEndTime) {
      const hurtRemain = this._hurtAnimEndTime - now;
      const hurtT = hurtRemain / 0.3;  // 总持续 300ms
      const hurt = Math.sin(hurtT * Math.PI) * 0.25;
      this.headGroup.rotation.x = -hurt;
      this.neckGroup.rotation.x -= hurt * 0.4;
      this.chestGroup.rotation.x -= hurt * 0.3;
      // 侧向倾斜：根据攻击者方向（v2 新增）
      // _hurtDir 是攻击者相对 AI 朝向的方向角（0=正前，π/2=正右）
      // 受伤时向攻击方向倾斜（被冲击力推动感）
      const sideTilt = Math.sin(this._hurtDir) * hurt * 0.4;
      this.chestGroup.rotation.z = sideTilt;
      this.hipGroup.rotation.z = sideTilt * 0.3;
    } else {
      this.chestGroup.rotation.z = THREE.MathUtils.lerp(this.chestGroup.rotation.z, 0, 0.15);
    }

    // ---- 搜索状态：颈部+头部协同扫描（v2 强化，不同频率增加自然感）----
    if (this.state === 'investigate') {
      // 颈部小幅度扫描（主扫描由 group.rotation.y 完成）
      const scanNeck = Math.sin(now * 1.2) * 0.15;
      // 头部更大幅度扫描，频率略快于颈部
      const scanHead = Math.sin(now * 1.5) * 0.25;
      this.neckGroup.rotation.y = scanNeck;
      this.headGroup.rotation.y = scanHead;
    } else {
      this.neckGroup.rotation.y = THREE.MathUtils.lerp(this.neckGroup.rotation.y, 0, 0.15);
      // 头部 Y 归零（待机调整时由上方逻辑处理）
      if (this._idleAdjustRemain <= 0) {
        this.headGroup.rotation.y = THREE.MathUtils.lerp(this.headGroup.rotation.y, 0, 0.15);
      }
    }
  }

  /**
   * 物理动力学倒地系统 v3（Pseudo-Ragdoll）
   * --------------------------------------------------------------
   * 替代 v2 的脚本动画，使用伪物理模拟实现自然倒地：
   *
   * 物理模型：
   *  - 整体倒地：group 绕 X/Z 轴有角速度（ωx, ωz）
   *    · 重力矩：τ = g * sin(θ) （θ 为当前倾斜角，越倾斜重力矩越大）
   *    · 角加速度：α = τ / I （I 为转动惯量，简化为 1）
   *    · 阻尼：ω *= 0.92 每帧（空气阻力 + 关节摩擦）
   *    · 地面碰撞：倾角接近 π/2 时停止（角速度归零）
   *  - 关节松弛：头/颈/胸/手臂/肘/腿/膝各关节有独立角速度
   *    · 重力驱动：各关节朝"自然下垂"方向旋转（如手臂下垂、头前倾）
   *    · 弹簧约束：每个关节有目标角度范围（避免穿模），超出时弹簧拉回
   *    · 阻尼：关节角速度衰减
   *  - 初始冲量：基于受击方向（_hurtDir）给 group 和关节初始角速度
   *
   * 优点：
   *  - 每次倒地姿态不同（受随机扰动 + 初始冲量影响）
   *  - 自然过渡（无脚本切换的生硬感）
   *  - 物理参数可调（重力、阻尼、弹簧强度）
   *
   * @param {number} delta 帧时间（秒）
   * @private
   */
  _updateDeathAnimation(delta) {
    // ---- 初始化（死亡瞬间触发物理状态）----
    if (this._deathStage === 0) {
      this._deathElapsed = 0;
      this._deathStage = 1;

      // group 整体角速度（ωx, ωy, ωz）
      this._ragdollAngularVel = new THREE.Vector3(0, 0, 0);
      this._ragdollSettled = false;  // 是否已稳定

      // 关节独立角速度（每个关节有独立物理）
      this._jointAngVel = {
        head:  new THREE.Vector3(0, 0, 0),
        neck:  new THREE.Vector3(0, 0, 0),
        chest: new THREE.Vector3(0, 0, 0),
        lArm:  new THREE.Vector3(0, 0, 0),
        rArm:  new THREE.Vector3(0, 0, 0),
        lElbow:new THREE.Vector3(0, 0, 0),
        rElbow:new THREE.Vector3(0, 0, 0),
        lLeg:  new THREE.Vector3(0, 0, 0),
        rLeg:  new THREE.Vector3(0, 0, 0),
        lKnee: new THREE.Vector3(0, 0, 0),
        rKnee: new THREE.Vector3(0, 0, 0)
      };

      // ---- 计算初始冲量：基于受击方向 _hurtDir ----
      // _hurtDir：0=正前受击（应向后倒）、π/2=右侧受击（向左倒）、π=正后受击（向前倒）
      const hurtDir = this._hurtDir || 0;
      // v3.1 调整：增大初始冲量，让击杀反作用力更明显（4-6.5 → 9-13 弧度/秒）
      const impulseStrength = 9.0 + Math.random() * 4.0;

      // rotation.x 通道：正前受击 → 向后倒（rotation.x 变负）；正后受击 → 向前倒（变正）
      const frontBackImpulse = -Math.cos(hurtDir) * impulseStrength;
      // rotation.z 通道：右侧受击 → 向左倒（rotation.z 变正）；左侧受击 → 向右倒（变负）
      const sideImpulse = -Math.sin(hurtDir) * impulseStrength;
      this._ragdollAngularVel.x = frontBackImpulse;
      this._ragdollAngularVel.z = sideImpulse;

      // ---- 关节初始冲量（痉挛式松弛）----
      // 头部受击后甩动方向与 group 一致，但更剧烈
      const headImpulse = impulseStrength * 1.4;
      this._jointAngVel.head.x = -Math.cos(hurtDir) * headImpulse + (Math.random() - 0.5) * 2.0;
      this._jointAngVel.head.z = -Math.sin(hurtDir) * headImpulse + (Math.random() - 0.5) * 2.0;
      this._jointAngVel.neck.x = this._jointAngVel.head.x * 0.5;
      this._jointAngVel.neck.z = this._jointAngVel.head.z * 0.5;
      this._jointAngVel.chest.x = this._jointAngVel.head.x * 0.3;
      this._jointAngVel.chest.z = this._jointAngVel.head.z * 0.3;

      // 双臂张开（失去控制）：左臂向左甩，右臂向右甩
      this._jointAngVel.lArm.z = impulseStrength * 1.2 + Math.random() * 1.0;
      this._jointAngVel.rArm.z = -impulseStrength * 1.2 - Math.random() * 1.0;
      // 肘关节弯曲（松弛）
      this._jointAngVel.lElbow.x = impulseStrength * 0.8;
      this._jointAngVel.rElbow.x = impulseStrength * 0.8;

      // 膝盖瞬间弯软（跪倒前兆）
      this._jointAngVel.lKnee.x = impulseStrength * 0.5;
      this._jointAngVel.rKnee.x = impulseStrength * 0.5;
      // 大腿轻微外摆
      this._jointAngVel.lLeg.z = -impulseStrength * 0.2;
      this._jointAngVel.rLeg.z = impulseStrength * 0.2;
    }

    this._deathElapsed += delta;
    const elapsed = this._deathElapsed;

    // ---- 物理参数 ----
    // v3.1 调整：增大重力 + 降低阻尼，让倒地更快更有冲量感
    const GRAVITY = 22.0;              // 重力加速度（12 → 22，倒地更快）
    const ANGULAR_DAMP = 0.86;         // group 角速度阻尼（0.92 → 0.86，冲量衰减更慢）
    const JOINT_DAMP = 0.82;           // 关节角速度阻尼（0.88 → 0.82，关节更松散）
    const MAX_TILT = Math.PI / 2 - 0.05;  // 最大倾角（接近 π/2 时触地）
    const SETTLE_THRESHOLD = 0.05;     // 角速度低于此值视为稳定

    // ---- 1. 整体倒地物理（group 旋转）----
    if (!this._ragdollSettled) {
      const currentTiltX = this.group.rotation.x;
      const currentTiltZ = this.group.rotation.z;
      const tiltMag = Math.sqrt(currentTiltX * currentTiltX + currentTiltZ * currentTiltZ);

      // 重力矩：倾角越大，重力矩越大（加速倒地）
      if (tiltMag > 0.01) {
        this._ragdollAngularVel.x += GRAVITY * Math.sin(currentTiltX) * delta;
        this._ragdollAngularVel.z += GRAVITY * Math.sin(currentTiltZ) * delta;
      } else {
        // 几乎直立时给一点扰动启动倒地
        this._ragdollAngularVel.x += (Math.random() - 0.5) * 0.5 * delta;
        this._ragdollAngularVel.z += (Math.random() - 0.5) * 0.5 * delta;
      }

      // 阻尼
      this._ragdollAngularVel.x *= ANGULAR_DAMP;
      this._ragdollAngularVel.z *= ANGULAR_DAMP;

      // 应用角速度
      this.group.rotation.x += this._ragdollAngularVel.x * delta;
      this.group.rotation.z += this._ragdollAngularVel.z * delta;

      // 重心下降（倾倒过程中 group.position.y 降低，模拟重心降低）
      // v3.1 调整：lerp 系数 0.1 → 0.25，重心下降更快（下落感更真实）
      const targetY = Math.max(0, 0.5 * (1 - tiltMag / MAX_TILT));
      this.group.position.y = THREE.MathUtils.lerp(this.group.position.y, targetY, 0.25);

      // 地面碰撞检测：倾角超过 MAX_TILT 时停止并轻微反弹
      // v3.1 调整：反弹系数 0.3 → 0.12（冲量增大后避免回弹过多）
      if (Math.abs(this.group.rotation.x) >= MAX_TILT) {
        this.group.rotation.x = Math.sign(this.group.rotation.x) * MAX_TILT;
        this._ragdollAngularVel.x = -this._ragdollAngularVel.x * 0.12;
      }
      if (Math.abs(this.group.rotation.z) >= MAX_TILT) {
        this.group.rotation.z = Math.sign(this.group.rotation.z) * MAX_TILT;
        this._ragdollAngularVel.z = -this._ragdollAngularVel.z * 0.12;
      }

      // 检查是否稳定（角速度很小且已触地）
      const angVelMag = this._ragdollAngularVel.length();
      if (angVelMag < SETTLE_THRESHOLD && tiltMag >= MAX_TILT - 0.1) {
        this._ragdollSettled = true;
      }
    }

    // ---- 2. 关节物理（独立 ragdoll 摆动）----
    // 通用关节更新函数：重力驱动 + 阻尼 + 弹簧约束（避免穿模）
    const updateJoint = (joint, angVel, gravityDir, limits) => {
      if (!joint) return;
      // 重力驱动：朝 gravityDir 方向加速
      angVel.x += gravityDir.x * GRAVITY * 0.5 * delta;
      angVel.y += gravityDir.y * GRAVITY * 0.5 * delta;
      angVel.z += gravityDir.z * GRAVITY * 0.5 * delta;
      // 阻尼
      angVel.x *= JOINT_DAMP;
      angVel.y *= JOINT_DAMP;
      angVel.z *= JOINT_DAMP;
      // 应用角速度
      joint.rotation.x += angVel.x * delta;
      joint.rotation.y += angVel.y * delta;
      joint.rotation.z += angVel.z * delta;
      // 弹簧约束：超出角度限制时拉回（带能量损失）
      if (limits) {
        if (joint.rotation.x < limits.minX) {
          joint.rotation.x = limits.minX;
          angVel.x = Math.abs(angVel.x) * 0.3;
        } else if (joint.rotation.x > limits.maxX) {
          joint.rotation.x = limits.maxX;
          angVel.x = -Math.abs(angVel.x) * 0.3;
        }
        if (joint.rotation.z < limits.minZ) {
          joint.rotation.z = limits.minZ;
          angVel.z = Math.abs(angVel.z) * 0.3;
        } else if (joint.rotation.z > limits.maxZ) {
          joint.rotation.z = limits.maxZ;
          angVel.z = -Math.abs(angVel.z) * 0.3;
        }
      }
    };

    // 各关节物理参数：重力方向（朝自然下垂）+ 角度限制（避免穿模）
    // 头部：前倾下垂
    updateJoint(this.headGroup, this._jointAngVel.head,
      new THREE.Vector3(1, 0, 0),
      {minX: -1.5, maxX: 1.5, minZ: -1.0, maxZ: 1.0});
    // 颈部：跟随头部但幅度小
    updateJoint(this.neckGroup, this._jointAngVel.neck,
      new THREE.Vector3(0.8, 0, 0),
      {minX: -1.0, maxX: 1.0, minZ: -0.6, maxZ: 0.6});
    // 胸腔：轻微前倾
    updateJoint(this.chestGroup, this._jointAngVel.chest,
      new THREE.Vector3(0.3, 0, 0),
      {minX: -0.8, maxX: 0.8, minZ: -0.5, maxZ: 0.5});
    // 左臂：朝身体侧下方甩（rotation.z 增大）
    updateJoint(this.leftArmGroup, this._jointAngVel.lArm,
      new THREE.Vector3(0, 0, 1.0),
      {minX: -1.5, maxX: 1.5, minZ: -0.3, maxZ: 1.8});
    // 右臂：朝身体侧下方甩（rotation.z 减小）
    updateJoint(this.rightArmGroup, this._jointAngVel.rArm,
      new THREE.Vector3(0, 0, -1.0),
      {minX: -1.5, maxX: 1.5, minZ: -1.8, maxZ: 0.3});
    // 左肘：弯曲（前臂向前甩）
    updateJoint(this.leftElbowGroup, this._jointAngVel.lElbow,
      new THREE.Vector3(1.2, 0, 0),
      {minX: -0.2, maxX: 2.4, minZ: -0.5, maxZ: 0.5});
    // 右肘：弯曲
    updateJoint(this.rightElbowGroup, this._jointAngVel.rElbow,
      new THREE.Vector3(1.2, 0, 0),
      {minX: -0.2, maxX: 2.4, minZ: -0.5, maxZ: 0.5});
    // 左腿：大腿重力下垂 + 轻微外摆
    updateJoint(this.leftLegGroup, this._jointAngVel.lLeg,
      new THREE.Vector3(0, 0, -0.2),
      {minX: -1.5, maxX: 0.3, minZ: -0.8, maxZ: 0.8});
    // 右腿
    updateJoint(this.rightLegGroup, this._jointAngVel.rLeg,
      new THREE.Vector3(0, 0, 0.2),
      {minX: -1.5, maxX: 0.3, minZ: -0.8, maxZ: 0.8});
    // 左膝：弯曲（跪倒姿态）
    updateJoint(this.leftKneeGroup, this._jointAngVel.lKnee,
      new THREE.Vector3(1.5, 0, 0),
      {minX: -0.2, maxX: 2.2, minZ: -0.3, maxZ: 0.3});
    // 右膝
    updateJoint(this.rightKneeGroup, this._jointAngVel.rKnee,
      new THREE.Vector3(1.5, 0, 0),
      {minX: -0.2, maxX: 2.2, minZ: -0.3, maxZ: 0.3});

    // hipGroup 下降（模拟重心降低，配合跪倒）
    const tiltMag = Math.sqrt(
      this.group.rotation.x * this.group.rotation.x +
      this.group.rotation.z * this.group.rotation.z
    );
    const targetHipY = Math.max(0.3, 0.95 - tiltMag * 0.5);
    this.hipGroup.position.y = THREE.MathUtils.lerp(this.hipGroup.position.y, targetHipY, 0.15);

    // ---- 3. 强制停止（5 秒后强制稳定，避免无限小震荡）----
    if (elapsed > 5.0) {
      this._ragdollAngularVel.set(0, 0, 0);
      this._ragdollSettled = true;
      for (const k in this._jointAngVel) {
        this._jointAngVel[k].set(0, 0, 0);
      }
    }
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

    // v3 新增：长期卡住恢复 —— 8 秒内连续触发 3 次卡住恢复，说明当前路点走不通
    // （如路点在墙后且无通道），直接跳到下一个路点，避免在墙边无限来回
    if (this._stuckRecoveryCount >= 3) {
      this._stuckRecoveryCount = 0;
      this._avoidSteer = 0;
      this.patrolIndex = (this.patrolIndex + 1) % this.patrolPoints.length;
      this.patrolOffset.set(
        (Math.random() - 0.5) * 3.0,
        0,
        (Math.random() - 0.5) * 3.0
      );
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
      // 中距离：横向 strafe（绕侧）+ 偶尔靠近/远离
      // 修复：先合成期望方向再调用 _moveWithAvoidance，避免调用后覆盖避障结果
      const sideSign = this._personality > 0.5 ? 1 : -1;
      const strafeFlip = Math.floor(this.stateTimer / (2 + this._personality * 2)) % 2 === 0;
      const finalSign = strafeFlip ? sideSign : -sideSign;
      const sideDir = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(finalSign);
      // 30% 概率在 strafe 时也轻微靠近/远离（增加运动不可预测性）
      // 注意：必须在调用 _moveWithAvoidance 之前合成，否则会覆盖避障结果
      let desiredDir = sideDir;
      if (Math.random() < 0.3) {
        const approachSign = distToPlayer > 18 ? 1 : -1;
        desiredDir = sideDir.clone().addScaledVector(dir, approachSign * 0.3).normalize();
      }
      this._moveWithAvoidance(desiredDir, 2.5, delta);
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
   * 带避障的移动 v2：扇形多射线 + 沿墙绕行 + 卡住检测
   * --------------------------------------------------------------
   * 算法改进：
   *  1) 扇形 7 射线探测：前向 + 左右 30°/60°/90°，找到最通畅且最接近期望方向的方向
   *  2) 沿墙绕行：当前方和侧方都堵时，沿墙壁切线方向移动（右手/左手定则）
   *  3) 卡住检测：连续 0.5 秒位置几乎未变但有移动意图时，强制反向避障
   *  4) 每帧检测（无节流），高速时也能及时避障
   *  5) 加速度模型 + 阻尼，避免瞬间启停
   *
   * @param {THREE.Vector3} desiredDir 期望移动方向（已归一化）
   * @param {number} speed 目标速度
   * @param {number} delta 帧时间
   * @private
   */
  _moveWithAvoidance(desiredDir, speed, delta) {
    // ---- 卡住检测 ----
    // 记录当前位置，与上次比较，如果几乎未动但有移动意图，触发卡住恢复
    if (!this._lastStuckPos) {
      this._lastStuckPos = this.position.clone();
      this._stuckTimer = 0;
    } else {
      const movedDist = Math.hypot(
        this.position.x - this._lastStuckPos.x,
        this.position.z - this._lastStuckPos.z
      );
      if (movedDist < 0.05 && desiredDir.lengthSq() > 0.01) {
        this._stuckTimer += delta;
        // 卡住超过 0.4 秒：切换避障方向（v3 改进）
        // - 之前无方向：随机选一个方向开始绕行
        // - 之前有方向：反向切换（这次往另一侧绕，避免重复撞同一面墙）
        if (this._stuckTimer > 0.4) {
          this._avoidSteer = this._avoidSteer === 0
            ? (Math.random() < 0.5 ? 1 : -1)
            : -this._avoidSteer;
          this._stuckTimer = 0;
          this._lastStuckPos.copy(this.position);
          // 长期卡住计数（v3 新增）：
          // 8 秒内连续触发 3 次卡住恢复，说明当前路径走不通（如目标在墙后无通道）
          // 由 _updatePatrol / _updateInvestigate 等调用方检查 _stuckRecoveryCount 决定是否放弃目标
          const now = performance.now() / 1000;
          if (now - this._lastStuckRecoveryTime > 8.0) {
            // 超过 8 秒未触发：重置计数器
            this._stuckRecoveryCount = 0;
          }
          this._stuckRecoveryCount++;
          this._lastStuckRecoveryTime = now;
        }
      } else {
        this._stuckTimer = 0;
        this._lastStuckPos.copy(this.position);
      }
    }

    // ---- 扇形多射线避障检测 ----
    // 探测距离：基础 2.5m，按速度动态扩展（速度越快看得越远）
    const checkDist = 2.5;
    const dynamicCheck = Math.max(1.5, checkDist + speed * 0.2);
    const origin = new THREE.Vector3(
      this.position.x,
      this.position.y + 1.0,  // 与视线高度一致（_canSee 用 y+1.5，避障用 y+1.0 兼顾低位障碍）
      this.position.z
    );

    // 扇形射线角度：前向 + 左右 30°/60°/90°
    const angles = [-Math.PI/2, -Math.PI/3, -Math.PI/6, 0, Math.PI/6, Math.PI/3, Math.PI/2];
    const rayResults = angles.map(a => {
      const d = new THREE.Vector3(
        desiredDir.x * Math.cos(a) - desiredDir.z * Math.sin(a),
        0,
        desiredDir.x * Math.sin(a) + desiredDir.z * Math.cos(a)
      );
      const ray = new THREE.Ray(origin, d);
      const hits = this.physics.raycastBoxes(ray, dynamicCheck);
      const dist = hits.length > 0 ? hits[0].distance : dynamicCheck;
      return { angle: a, dir: d, dist, clear: dist >= dynamicCheck };
    });

    // ---- 决定实际移动方向 ----
    // v3 重写：当 bestDir 已选择垂直绕行方向时，必须真正使用 bestDir，
    //         而非用 desiredDir + 小角度 sideSteer（旧逻辑会让 AI 仍朝墙走，导致墙边震荡卡死）
    const forwardClear = rayResults[3].clear;  // 中间射线 = 前向（desiredDir 方向）
    let actualDir;

    if (forwardClear) {
      // 前方通畅：直接走期望方向，清零避障状态
      // 注意：直接置零而非 lerp 衰减，避免浮点精度残留（lerp 永远不到 0）
      actualDir = desiredDir.clone();
      this._avoidSteer = 0;
    } else {
      // 前方有墙：需要绕行
      // 若未确定绕行侧，根据最佳角度选择（取符号）
      if (this._avoidSteer === 0) {
        // 评分：通畅距离 - |角度|*0.5（角度越大扣分越多，但通畅距离是主要因素）
        let bestScore = -Infinity;
        let bestAngle = 0;
        for (const r of rayResults) {
          const score = r.dist - Math.abs(r.angle) * 0.5;
          if (score > bestScore) {
            bestScore = score;
            bestAngle = r.angle;
          }
        }
        this._avoidSteer = Math.sign(bestAngle) || 1;
      }

      // 在 _avoidSteer 同侧选最通畅方向（优先 30°，其次 60°，最后 90°）
      // 同侧扫描确保 AI 持续沿墙绕行，不会左右摇摆
      const sign = this._avoidSteer;
      const sideCandidates = rayResults.filter(r =>
        Math.sign(r.angle) === sign && r.angle !== 0
      );
      // 评分 = dist（同侧时优先通畅距离，角度已在选 side 时确定）
      let sideBest = sideCandidates[0] || rayResults[0];
      for (const r of sideCandidates) {
        if (r.dist > sideBest.dist) sideBest = r;
      }
      actualDir = sideBest.dir.clone();

      // 死角处理：所有方向都不通，选通畅距离最大的方向（哪怕角度大）
      const allBlocked = rayResults.every(r => !r.clear);
      if (allBlocked) {
        let maxDist = 0;
        let maxDir = desiredDir;
        for (const r of rayResults) {
          if (r.dist > maxDist) {
            maxDist = r.dist;
            maxDir = r.dir;
          }
        }
        actualDir = maxDir.clone();
      }
    }

    // ---- 加速度模型：当前速度向目标速度插值 ----
    const targetVel = actualDir.clone().multiplyScalar(speed);
    const accel = this.state === 'engage' ? 8.0 : 5.0;
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

    // ---- 触发射击动画：枪口火焰 + 后坐力 ----
    this._lastShootAnimTime = now;
    this.muzzleFlashEndTime = now + 0.08;
    // 随机旋转枪口火焰，让每次闪烁形态不同
    this.muzzleFlash.rotation.z = Math.random() * Math.PI * 2;

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
    // 正向向量：group.rotation.y = yaw 时，正面朝向 +Z 是 yaw=0，朝向 +X 是 yaw=PI/2
    // 所以 forward = (sin(yaw), 0, cos(yaw))，与人体正面（+Z）和武器枪口（+Z，已翻转）一致
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
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

    // ---- 触发受伤动画：头部/胸腔后仰 300ms ----
    this._hurtAnimEndTime = performance.now() / 1000 + 0.3;

    // ---- 记录受伤方向（v2 新增）：用于侧向倾斜反馈 ----
    // 计算攻击者相对 AI 朝向的方向角（0=正前，π/2=正右，π=正后）
    if (attacker && attacker.position) {
      const dx = attacker.position.x - this.position.x;
      const dz = attacker.position.z - this.position.z;
      // AI 朝向：(sin(yaw), 0, cos(yaw))，正向角度=atan2(dx, dz) - yaw
      const worldAngle = Math.atan2(dx, dz);
      this._hurtDir = worldAngle - this.yaw;
      // 归一化到 [-π, π]
      while (this._hurtDir > Math.PI) this._hurtDir -= Math.PI * 2;
      while (this._hurtDir < -Math.PI) this._hurtDir += Math.PI * 2;
    }

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
      // 触发死亡动画（_deathStage=0 表示需要初始化）
      this._deathStage = 0;
      // 随机倒地方向（v2 新增）：前倒/左倒/右倒，让每次死亡姿态不同
      const r = Math.random();
      if (r < 0.4) this._deathFallDir = 0;       // 40% 前倒
      else if (r < 0.7) this._deathFallDir = -1; // 30% 左倒
      else this._deathFallDir = 1;                // 30% 右倒
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
    // v2 新增：卡住检测状态重置
    if (this._lastStuckPos) this._lastStuckPos.copy(this.position);
    this._stuckTimer = 0;
    // v3 新增：长期卡住计数重置
    this._stuckRecoveryCount = 0;
    this._lastStuckRecoveryTime = 0;

    // ---- 重置动画状态 ----
    this._walkPhase = 0;
    this._lastShootAnimTime = -10;
    this._hurtAnimEndTime = 0;
    this._hurtDir = 0;            // v2 新增
    this._deathStage = 0;
    this._deathElapsed = 0;
    this._deathFallDir = 0;       // v2 新增
    // v3 新增：物理倒地状态清理
    if (this._ragdollAngularVel) this._ragdollAngularVel.set(0, 0, 0);
    this._ragdollSettled = false;
    if (this._jointAngVel) {
      for (const k in this._jointAngVel) {
        this._jointAngVel[k].set(0, 0, 0);
      }
    }
    this._lastSpeed = 0;
    this.muzzleFlashEndTime = 0;
    this._nextIdleAdjust = 0;     // v2 新增
    this._idleAdjustRemain = 0;   // v2 新增
    this._idleAdjustTarget = 0;   // v2 新增

    // ---- 复位所有关节变换（避免重生后残留死亡姿态）----
    if (this.group) {
      this.group.rotation.set(0, 0, 0);
      this.group.position.copy(this.position);
    }
    if (this.hipGroup) {
      this.hipGroup.position.set(0, 0.95, 0);
      this.hipGroup.rotation.set(0, 0, 0);
    }
    if (this.chestGroup) {
      this.chestGroup.position.set(0, 0.35, 0);
      this.chestGroup.rotation.set(0, 0, 0);
    }
    // v2 新增：颈部关节复位
    if (this.neckGroup) this.neckGroup.rotation.set(0, 0, 0);
    if (this.headGroup) this.headGroup.rotation.set(0, 0, 0);
    if (this.leftArmGroup) this.leftArmGroup.rotation.set(0, 0, 0);
    if (this.rightArmGroup) this.rightArmGroup.rotation.set(0, 0, 0);
    // v2 新增：肘关节复位
    if (this.leftElbowGroup) this.leftElbowGroup.rotation.set(0, 0, 0);
    if (this.rightElbowGroup) this.rightElbowGroup.rotation.set(0, 0, 0);
    // 武器组复位（含 position.y，v2 新增，避免换弹动画残留位置）
    // 修复：保留 rotation.y = π（武器朝向翻转），只重置 x/z
    if (this.weaponGroup) {
      this.weaponGroup.rotation.set(0, Math.PI, 0);
      this.weaponGroup.position.set(0, -0.30, -0.10);
    }
    if (this.leftLegGroup) this.leftLegGroup.rotation.set(0, 0, 0);
    if (this.rightLegGroup) this.rightLegGroup.rotation.set(0, 0, 0);
    // 膝关节（兼容旧名称 leftShinGroup）复位
    if (this.leftKneeGroup) this.leftKneeGroup.rotation.set(0, 0, 0);
    if (this.rightKneeGroup) this.rightKneeGroup.rotation.set(0, 0, 0);
    // v2 新增：脚踝关节复位
    if (this.leftAnkleGroup) this.leftAnkleGroup.rotation.set(0, 0, 0);
    if (this.rightAnkleGroup) this.rightAnkleGroup.rotation.set(0, 0, 0);
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
