import { defineConfig } from 'vite';

/**
 * Bundles the server to plain JavaScript for deployment.
 *
 * `npm run server` runs the TypeScript directly through tsx, which is a dev
 * dependency and not something to install in a production image. This emits one
 * file that node runs on its own.
 *
 * Dependencies stay external: `ws` is installed in the image by
 * `npm ci --omit=dev`, so it is resolved at runtime rather than inlined, and
 * the bundle stays the server's own code.
 */
export default defineConfig({
  build: {
    ssr: 'src/server/index.ts',
    outDir: 'dist-server',
    target: 'node22',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'index.js' } },
  },
});
