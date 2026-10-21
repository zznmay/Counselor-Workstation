import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const { compressDir } = require('./server/lib/precompress.js') as {
  compressDir: (dir: string) => { files: number; compressed: number; bytesSaved: number; errors: string[] };
};

/** 构建后生成 .br/.gz 旁路文件，服务端直接回放，避免每次请求实时压缩 */
function precompressPlugin(): Plugin {
  return {
    name: 'workbench-precompress',
    apply: 'build',
    closeBundle() {
      try {
        const dist = fileURLToPath(new URL('./dist', import.meta.url));
        const result = compressDir(dist);
        if (result.compressed > 0) {
          this.info(`预压缩 ${result.compressed}/${result.files} 个文件，节省约 ${Math.round(result.bytesSaved / 1024)} KB`);
        }
        if (result.errors.length > 0) this.warn(`预压缩部分失败：${result.errors[0]}`);
      } catch (e) {
        this.warn(`预压缩不可用：${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), precompressPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 入口自愈依赖 manifest 精准识别 entry，避免把懒加载的 index-*.js 误认成入口。
    // 写到 dist 根目录（而非 .vite/），避免部分发布链路排除点目录导致入口自愈失效。
    manifest: 'manifest.json',
  },
  server: {
    port: 5173,
    host: true,
    // 开发模式代理到本地服务端（生产由服务端同源托管 dist，无需代理）
    proxy: {
      '/api': {
        target: 'https://localhost:8443',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
