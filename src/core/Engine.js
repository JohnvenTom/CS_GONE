/**
 * Engine.js - Three.js 引擎核心
 * --------------------------------------------------------------
 * 职责：场景 / 相机 / 渲染器 / 灯光 / 主循环 / 窗口自适应
 * 不持有任何游戏逻辑，只暴露 update(delta) + render() 给外部驱动
 * --------------------------------------------------------------
 */

import * as THREE from 'three';

export class Engine {
  /**
   * 初始化引擎
   * @param {HTMLCanvasElement} canvas 渲染目标 canvas
   * @returns {Engine} 引擎实例
   * @throws {Error} WebGL 不可用时抛出
   */
  constructor(canvas) {
    this.canvas = canvas;

    // ---- 渲染器 ----
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // ---- 场景 ----
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xC8B89A); // 沙漠天空偏暖色
    this.scene.fog = new THREE.Fog(0xC8B89A, 80, 350);

    // ---- 相机 (第一人称) ----
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.05,
      500
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, 1.7, 0);

    // ---- 灯光 ----
    this._setupLights();

    // ---- 时钟与回调 ----
    this.clock = new THREE.Clock();
    this.callbacks = [];
    this.lastFps = 60;
    this._fpsAccum = 0;
    this._fpsFrames = 0;

    // ---- 自适应 ----
    window.addEventListener('resize', this._onResize.bind(this));
  }

  /**
   * 配置场景灯光：环境光 + 方向光(带阴影) + 半球光(沙漠暖色)
   * @private
   */
  _setupLights() {
    // 半球光：天空蓝 / 地面沙黄
    const hemi = new THREE.HemisphereLight(0xC8D8FF, 0xC8A060, 0.55);
    this.scene.add(hemi);

    // 环境光（保证阴影区也有底色）
    const ambient = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(ambient);

    // 方向光：太阳
    const dir = new THREE.DirectionalLight(0xfff2d0, 1.6);
    dir.position.set(60, 90, 40);
    dir.castShadow = true;
    // 性能优化：1024 阴影贴图（从 2048 降级）
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 300;
    // 性能优化：缩小阴影相机范围，提高阴影精度同时降低渲染开销
    const s = 80;
    dir.shadow.camera.left = -s;
    dir.shadow.camera.right = s;
    dir.shadow.camera.top = s;
    dir.shadow.camera.bottom = -s;
    dir.shadow.bias = -0.0005;
    this.scene.add(dir);
    this.sun = dir;
  }

  /**
   * 注册主循环回调
   * @param {(delta:number, elapsed:number)=>void} cb 每帧回调
   */
  onUpdate(cb) {
    this.callbacks.push(cb);
  }

  /**
   * 启动渲染循环
   */
  start() {
    this._running = true;
    this._loop();
  }

  /**
   * 停止渲染循环
   */
  stop() {
    this._running = false;
  }

  /**
   * 主循环：计算 delta → 回调 → 渲染 → FPS 统计
   * @private
   */
  _loop() {
    if (!this._running) return;
    requestAnimationFrame(() => this._loop());

    const delta = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.elapsedTime;

    for (const cb of this.callbacks) {
      try { cb(delta, elapsed); } catch (e) { console.error('[Engine update]', e); }
    }

    this.renderer.render(this.scene, this.camera);

    // FPS 统计（每秒更新一次）
    this._fpsAccum += delta;
    this._fpsFrames++;
    if (this._fpsAccum >= 1) {
      this.lastFps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }
  }

  /**
   * 窗口尺寸变化时同步相机和渲染器
   * @private
   */
  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  }

  /**
   * 获取当前 FPS
   * @returns {number}
   */
  getFPS() {
    return this.lastFps;
  }
}
