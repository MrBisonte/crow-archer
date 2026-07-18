import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The build inlines everything into one dist/index.html, keeping the
// "download one file and play" property of the original game.html.
export default defineConfig({
  plugins: [viteSingleFile()],
  server: { port: 8081 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
