// Shared Vite config for every app in the suite:
//   import {studioApp} from '@studio/build';
//   export default studioApp();
import react from '@vitejs/plugin-react';
import stylex from '@stylexjs/unplugin';

// In dev, @stylexjs/unplugin injects its runtime script and CSS link into index.html
// but builds their URLs with path.join, which yields backslashes on Windows
// (`\@id\virtual:stylex:runtime`) that the browser cannot load. Normalize them.
export const fixStylexDevUrls = {
  name: 'studio:stylex-dev-urls',
  apply: 'serve',
  transformIndexHtml: {
    order: 'post',
    handler: html =>
      html.replace(/(src|href)="([^"]*virtual:stylex[^"]*)"/g, (_, attr, url) => `${attr}="${url.replace(/\\/g, '/')}"`),
  },
};

/**
 * @param {{port?: number}} [opts]
 * Builds one JS bundle and one CSS file with relative URLs, so an app works from any
 * sub-path of the suite (/glyf/, /launcher/…) and can be folded into a single file.
 */
export function studioApp({port} = {}) {
  return ({command}) => ({
    base: command === 'build' ? './' : '/',
    plugins: [stylex.vite(), react(), fixStylexDevUrls],
    server: {port, strictPort: false},
    build: {
      target: 'es2022',
      assetsInlineLimit: 100000000,
      chunkSizeWarningLimit: 4000,
      rollupOptions: {output: {inlineDynamicImports: true}},
    },
  });
}
