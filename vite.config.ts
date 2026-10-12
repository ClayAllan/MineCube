import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    // three / drei 体积较大，这里放宽单 chunk 体积告警阈值
    chunkSizeWarningLimit: 1600,
  },
  test: {
    // 核心游戏逻辑均为纯 TypeScript，不需要 DOM 环境
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
});
