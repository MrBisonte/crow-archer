import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The build inlines everything into one dist/index.html, so the game keeps its
// "download one file and play" property with no network access at runtime.
export default defineConfig({
  plugins: [viteSingleFile()],
  server: { port: 8081 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
