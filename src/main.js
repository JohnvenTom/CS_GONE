/**
 * main.js - 游戏入口
 * --------------------------------------------------------------
 * 组装所有模块，启动主循环
 * --------------------------------------------------------------
 */

import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { AudioSystem } from './audio/Audio.js';
import { Physics } from './world/Physics.js';
import { GameMap } from './world/Map.js';
import { Game } from './game/Game.js';
import { HUD } from './ui/HUD.js';
import { Crosshair } from './ui/Crosshair.js';
import { BuyWheel } from './ui/BuyWheel.js';
import { Scoreboard } from './ui/Scoreboard.js';
import { KillFeed } from './ui/KillFeed.js';

/**
 * 应用入口：异步初始化所有系统
 */
async function main() {
  // ---- 隐藏加载屏 ----
  const loadingScreen = document.getElementById('loading-screen');
  const showLoading = (text) => {
    const t = loadingScreen.querySelector('.ls-text');
    if (t) t.textContent = text;
  };

  try {
    showLoading('初始化引擎...');

    // ---- 引擎与输入 ----
    const canvas = document.getElementById('game-canvas');
    const engine = new Engine(canvas);
    const input = new Input(canvas);

    // ---- 音频 ----
    const audio = new AudioSystem();
    // 音频需在用户手势后初始化，主菜单点击时触发

    // ---- 物理 + 地图 ----
    showLoading('构建战场...');
    const physics = new Physics();
    const gameMap = new GameMap(engine.scene, physics);

    // ---- UI 模块 ----
    showLoading('装配 HUD...');
    const hud = new HUD();
    const crosshair = new Crosshair();
    const buyWheel = new BuyWheel({
      canvas: document.getElementById('buy-wheel-canvas'),
      audio
    });
    const scoreboard = new Scoreboard();
    const killFeed = new KillFeed(engine.camera);

    // ---- 游戏控制器 ----
    showLoading('加载游戏逻辑...');
    const game = new Game({
      engine, input, physics, map: gameMap, audio,
      hud, crosshair, buyWheel, scoreboard, killFeed
    });
    game.init();

    // ---- 启动主循环 ----
    engine.start();

    // ---- 显示主菜单 ----
    setTimeout(() => {
      loadingScreen.classList.add('hidden');
    }, 400);

    // ---- 调试入口 ----
    window.__game = game;
    window.__engine = engine;
    console.log('[CS:GONE] 初始化完成 · 选择模式开始游戏');

  } catch (err) {
    console.error('[CS:GONE] 初始化失败', err);
    showLoading('初始化失败: ' + err.message);
  }
}

main();
