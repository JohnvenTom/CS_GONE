import { defineConfig } from 'vite';

/**
 * Vite 构建配置
 * - base: './' 允许打包后通过相对路径直接打开
 * - server.host: 监听所有网卡，方便局域网调试
 * - build.target: 现代浏览器原生 ES Module
 */
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 1500
  }
});
