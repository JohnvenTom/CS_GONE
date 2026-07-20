/**
 * Map.js - Dust II 风格地图构建
 * --------------------------------------------------------------
 * 布局（简化版沙漠黄）：
 *
 *                [T 出生点]      y=-40
 *                    |
 *                [T 基地]        y=-25
 *                    |
 *   [A 大道] --- [中路] --- [B 隧道]
 *       |           |           |
 *    [A 点]     [A 小]       [B 点]
 *       |           |           |
 *   [CT 基地] -- [CT 出生点]   y=+40
 *
 * 包含：地面、四周围墙、A/B 点掩体、中路长墙、隧道、出生点标记
 * 所有可碰撞物体都同时注册到 Physics 中
 * --------------------------------------------------------------
 */

import * as THREE from 'three';

export class GameMap {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../world/Physics.js').Physics} physics
   */
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.group = new THREE.Group();
    this.spawnPoints = {
      ct: [],
      t: []
    };
    this.bombSites = {
      A: { center: new THREE.Vector3(-25, 0, 18), radius: 6 },
      B: { center: new THREE.Vector3(25, 0, 18), radius: 6 }
    };
    this._build();
  }

  /**
   * 构建整张地图
   * @private
   */
  _build() {
    this._buildGround();
    this._buildPerimeter();
    this._buildMiddleStructures();
    this._buildBombSites();
    this._buildCrates();
    this._buildSpawnPoints();
    this._setupPhysicsBounds();
    this.scene.add(this.group);
  }

  /**
   * 创建沙漠地面（大平面 + 程序化纹理）
   * @private
   */
  _buildGround() {
    // 程序化沙漠纹理
    const tex = this._makeSandTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(40, 40);

    const geo = new THREE.PlaneGeometry(200, 200, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.95,
      metalness: 0.0,
      color: 0xC8A878
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    this.physics.setGround(0);
  }

  /**
   * 程序化生成沙漠地面纹理
   * @private
   */
  _makeSandTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    // 基色
    ctx.fillStyle = '#C8A878';
    ctx.fillRect(0, 0, 128, 128);
    // 噪点
    for (let i = 0; i < 800; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      const v = Math.random();
      const shade = v > 0.5 ? 210 : 150;
      ctx.fillStyle = `rgba(${shade}, ${shade - 30}, ${shade - 80}, 0.5)`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    // 几道裂纹
    ctx.strokeStyle = 'rgba(120, 90, 50, 0.4)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * 128, Math.random() * 128);
      ctx.lineTo(Math.random() * 128, Math.random() * 128);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * 程序化生成墙壁纹理（带砖块感）
   * @private
   */
  _makeWallTexture(baseColor = '#A88A5C') {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, 128, 128);
    // 砖块网格
    ctx.strokeStyle = 'rgba(60, 40, 20, 0.4)';
    ctx.lineWidth = 1;
    const brickH = 16;
    const brickW = 32;
    for (let row = 0; row < 8; row++) {
      const offset = row % 2 === 0 ? 0 : brickW / 2;
      for (let col = -1; col < 5; col++) {
        ctx.strokeRect(col * brickW + offset, row * brickH, brickW, brickH);
      }
    }
    // 噪点
    for (let i = 0; i < 400; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      const v = Math.random();
      ctx.fillStyle = `rgba(${v > 0.5 ? 200 : 100}, ${v > 0.5 ? 170 : 80}, ${v > 0.5 ? 120 : 50}, 0.3)`;
      ctx.fillRect(x, y, 1, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  /**
   * 构建四周围墙
   * @private
   */
  _buildPerimeter() {
    const wallTex = this._makeWallTexture();
    const wallMat = new THREE.MeshStandardMaterial({
      map: wallTex,
      roughness: 0.9,
      metalness: 0.0,
      color: 0xB89060
    });

    // 四面墙（高 8 米，厚 2 米）
    const wallH = 8;
    const wallT = 2;
    const size = 100;
    const walls = [
      // 北墙 z=-size
      { pos: [0, wallH / 2, -size], size: [size * 2, wallH, wallT] },
      // 南墙 z=+size
      { pos: [0, wallH / 2, size], size: [size * 2, wallH, wallT] },
      // 西墙 x=-size
      { pos: [-size, wallH / 2, 0], size: [wallT, wallH, size * 2] },
      // 东墙 x=+size
      { pos: [size, wallH / 2, 0], size: [wallT, wallH, size * 2] }
    ];

    for (const w of walls) {
      this._addBoxMesh(new THREE.Vector3(...w.pos), new THREE.Vector3(...w.size), wallMat);
    }
  }

  /**
   * 中路结构：分隔墙 + 隧道 + A小/B小 通道
   * @private
   */
  _buildMiddleStructures() {
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xA88A5C, roughness: 0.9
    });

    // 中路分隔长墙（南北向，把地图切成 A/B 两半）
    // 留出中路通道：从 z=-5 到 z=+5 不放墙
    this._addBoxMesh(new THREE.Vector3(0, 2, -50), new THREE.Vector3(2, 4, 80), wallMat);
    this._addBoxMesh(new THREE.Vector3(0, 2, 20), new THREE.Vector3(2, 4, 60), wallMat);

    // 中路两侧的高墙（让狙击位有意义）
    this._addBoxMesh(new THREE.Vector3(-8, 3, -5), new THREE.Vector3(6, 6, 2), wallMat);
    this._addBoxMesh(new THREE.Vector3(8, 3, 5), new THREE.Vector3(6, 6, 2), wallMat);

    // A 大道长墙
    this._addBoxMesh(new THREE.Vector3(-35, 3, -10), new THREE.Vector3(2, 6, 40), wallMat);
    // B 隧道墙
    this._addBoxMesh(new THREE.Vector3(35, 3, 10), new THREE.Vector3(2, 6, 40), wallMat);

    // 中央掩体（短墙）
    this._addBoxMesh(new THREE.Vector3(0, 1, -15), new THREE.Vector3(6, 2, 1), wallMat);
    this._addBoxMesh(new THREE.Vector3(0, 1, 15), new THREE.Vector3(6, 2, 1), wallMat);

    // 隧道顶（B 隧道）
    this._addBoxMesh(new THREE.Vector3(40, 5, 25), new THREE.Vector3(10, 1, 12), wallMat);
  }

  /**
   * 构建 A 点 / B 点标记（地面圆盘 + 标识柱）
   * @private
   */
  _buildBombSites() {
    for (const [key, site] of Object.entries(this.bombSites)) {
      // 地面圆盘
      const discGeo = new THREE.CircleGeometry(site.radius, 32);
      const discMat = new THREE.MeshStandardMaterial({
        color: key === 'A' ? 0xFF6600 : 0x0066FF,
        emissive: key === 'A' ? 0xFF3300 : 0x0033AA,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.5
      });
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.copy(site.center);
      disc.position.y = 0.02;
      this.group.add(disc);

      // 标识柱
      const poleGeo = new THREE.CylinderGeometry(0.15, 0.15, 4, 8);
      const poleMat = new THREE.MeshStandardMaterial({
        color: key === 'A' ? 0xFF6600 : 0x0066FF,
        emissive: key === 'A' ? 0xFF3300 : 0x0033AA,
        emissiveIntensity: 0.8
      });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.copy(site.center);
      pole.position.y = 2;
      pole.castShadow = true;
      this.group.add(pole);

      // 文字标签（CanvasTexture 贴在 Sprite）
      const c = document.createElement('canvas');
      c.width = 128; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.fillStyle = key === 'A' ? '#FF6600' : '#0066FF';
      ctx.font = 'bold 48px Orbitron, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(key, 64, 32);
      const labelTex = new THREE.CanvasTexture(c);
      const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true });
      const label = new THREE.Sprite(labelMat);
      label.position.copy(site.center);
      label.position.y = 5;
      label.scale.set(3, 1.5, 1);
      this.group.add(label);
    }
  }

  /**
   * 散布箱子掩体（A 点、B 点、中路）
   * @private
   */
  _buildCrates() {
    const crateTex = this._makeCrateTexture();
    const crateMat = new THREE.MeshStandardMaterial({
      map: crateTex,
      roughness: 0.8,
      metalness: 0.0
    });

    // 箱子尺寸：2x2x2 标准
    const positions = [
      // A 点附近
      [-22, 1, 18], [-20, 1, 20], [-22, 3, 18], [-25, 1, 16],
      // B 点附近
      [22, 1, 18], [20, 1, 20], [22, 3, 18], [25, 1, 16],
      // 中路
      [0, 1, -10], [0, 1, 10], [-4, 1, 0], [4, 1, 0],
      // A 大道
      [-30, 1, -20], [-32, 1, -22], [-30, 3, -20],
      // B 隧道
      [30, 1, 20], [32, 1, 22], [30, 3, 20],
      // CT 基地
      [-10, 1, 35], [10, 1, 35],
      // T 基地
      [-10, 1, -35], [10, 1, -35]
    ];

    // 性能优化：小箱子不投影（仅接收阴影），大幅降低 draw call 与 shadow pass 开销
    for (const p of positions) {
      this._addBoxMesh(new THREE.Vector3(...p), new THREE.Vector3(2, 2, 2), crateMat, {
        castShadow: false,
        receiveShadow: true
      });
    }
  }

  /**
   * 程序化生成木箱纹理
   * @private
   */
  _makeCrateTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#A07238';
    ctx.fillRect(0, 0, 64, 64);
    // 木板纹路
    ctx.strokeStyle = '#603F18';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, 60, 60);
    ctx.beginPath();
    ctx.moveTo(0, 32); ctx.lineTo(64, 32);
    ctx.moveTo(32, 0); ctx.lineTo(32, 64);
    ctx.stroke();
    // 边框铁钉
    ctx.fillStyle = '#444';
    [[4, 4], [60, 4], [4, 60], [60, 60]].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * 出生点标记（地面发光圆盘 + 数据点）
   * @private
   */
  _buildSpawnPoints() {
    // CT 出生点（南侧）
    for (let i = 0; i < 5; i++) {
      const x = -8 + i * 4;
      const z = 45;
      this._addSpawnMarker(x, z, 'ct');
      this.spawnPoints.ct.push(new THREE.Vector3(x, 0, z));
    }
    // T 出生点（北侧）
    for (let i = 0; i < 5; i++) {
      const x = -8 + i * 4;
      const z = -45;
      this._addSpawnMarker(x, z, 't');
      this.spawnPoints.t.push(new THREE.Vector3(x, 0, z));
    }
  }

  /**
   * 添加一个出生点地面标记
   * @private
   */
  _addSpawnMarker(x, z, team) {
    const geo = new THREE.CircleGeometry(1.2, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: team === 'ct' ? 0x00D4FF : 0xFF5500,
      emissive: team === 'ct' ? 0x00D4FF : 0xFF5500,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.7
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.03, z);
    this.group.add(m);
  }

  /**
   * 设置物理世界边界
   * @private
   */
  _setupPhysicsBounds() {
    this.physics.setBounds(-98, 98, -98, 98);
  }

  /**
   * 添加一个带碰撞体的方块 mesh
   * 性能优化：小尺寸物体不投影，仅大尺寸墙体/结构才 castShadow
   * @param {THREE.Vector3} center 中心位置
   * @param {THREE.Vector3} size 尺寸
   * @param {THREE.Material} mat 材质
   * @param {Object} [opts] 额外选项
   * @param {boolean} [opts.castShadow=true] 是否投影
   * @param {boolean} [opts.receiveShadow=true] 是否接收阴影
   * @private
   */
  _addBoxMesh(center, size, mat, opts = {}) {
    const castShadow = opts.castShadow !== false;
    const receiveShadow = opts.receiveShadow !== false;
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(center);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    this.group.add(mesh);
    // 同步注册到物理
    this.physics.addBoxCenterSize(center, size, { mesh });
  }
}
