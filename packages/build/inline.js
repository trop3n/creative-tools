#!/usr/bin/env node
// Folds an app's dist/assets/*.js and *.css into dist/index.html, so the tool is one file.
// Run from the app folder: node ../../packages/build/inline.js  (or the `studio-inline` bin).
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const read = rel => fs.readFileSync(path.join(dist, rel.replace(/^\.\//, '')), 'utf8');
// Fontsource ships each face as woff2 plus a woff fallback; every browser that runs
// this app reads woff2, so drop the inlined woff copies (they double the file size).
const dropWoff = css => css.replace(/,\s*url\(data:font\/woff;base64,[A-Za-z0-9+/=]+\)\s*format\("woff"\)/g, '');
html = html.replace(/<link rel="stylesheet"[^>]*href="(\.\/assets\/[^"]+\.css)"[^>]*>/g, (_, href) => `<style>${dropWoff(read(href))}</style>`);
html = html.replace(/<script type="module"[^>]*src="(\.\/assets\/[^"]+\.js)"[^>]*><\/script>/g, (_, src) =>
  `<script type="module">${read(src).replace(/<\/script/gi, '<\\/script')}</script>`);
fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.rmSync(path.join(dist, 'assets'), {recursive: true, force: true});
console.log(`inlined -> dist/index.html (${(html.length / 1024).toFixed(0)} KB)`);
