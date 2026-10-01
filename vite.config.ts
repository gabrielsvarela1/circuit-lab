import { defineConfig } from 'vitest/config';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/circuit-lab/' : '/',
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
