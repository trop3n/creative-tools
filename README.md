# Creative Tools

A self-hosted suite of browser creative tools. Each tool is its own small app; they
share a core library, one Astryx theme and one origin (so they can share saved data).

| Path | What it is |
| --- | --- |
| `apps/launcher` | Home page: one card per tool, read from `suite.json` |
| `apps/glyf` | GLYF: draw glyphs, then use them as the characters of a dithered image, video or webcam feed |
| `apps/durandal` | DURANDAL: dither images, video or a webcam feed into 1-bit or palette pixel art (error diffusion, Bayer and pattern styles; up to 16 colors from presets, the image or a custom set; pattern styles run on the GPU via WebGL2 at full resolution); exports PNG, SVG and MP4 |
| `packages/core` (`@studio/core`) | Image/video/webcam sources, MP4 render with audio, canvas recording, saving and opening files, storage, and the dither engine (`@studio/core/dither`, CPU plus a WebGL2 path for pattern styles, tested with `npm test`) |
| `packages/theme` (`@studio/theme`) | The suite's Astryx theme and self-hosted fonts (Montserrat, JetBrains Mono) |
| `packages/build` (`@studio/build`) | Shared Vite config and the `studio-inline` single-file step |
| `suite.json` | The tool registry: name, folder, URL path, category, description, preview |

## Commands

Needs Node 22 or newer.

```bash
npm install
npm run dev            # GLYF dev server, http://localhost:5180
npm run dev:launcher   # launcher dev server, http://localhost:5170
npm run dev:durandal   # DURANDAL dev server, http://localhost:5181
npm test               # dither engine tests
npm run build          # builds every app into dist/ (launcher at /, tools at /<path>/)
npm run serve          # serves dist/ at http://localhost:5100
```

Every app builds to a single self-contained `index.html` (JS, CSS and fonts inlined),
so a tool also works opened straight from disk.

## Adding a tool

1. Create `apps/<tool>` with a `package.json` named `@studio/<tool>` that depends on
   `@studio/core` and `@studio/theme`, devDepends on `@studio/build`, and builds with
   `vite build && studio-inline`.
2. `vite.config.ts`: `export default defineConfig(studioApp({port: 51xx}))`.
3. Wrap the app in `<Theme theme={studioTheme}>` and import Astryx's `reset.css` and `astryx.css`.
4. Add an entry to `suite.json` and a preview SVG in `apps/launcher/src/previews/`.
5. Start UI from an Astryx template (`npx astryx build "<idea>"`); see `.claude/CLAUDE.md`.

Shared data: keys under `studio.shared.*` (`shared` in `@studio/core/storage`) are
visible to every tool, because the whole suite is served from one origin.

## Hosting

`deploy/Caddyfile.example` serves `dist/` as static files. Serve it over HTTPS
(for example `tailscale serve`) so the webcam and clipboard work.
`DEPLOY_TARGET=user@host:/srv/creative-tools ./deploy/deploy.sh` builds and copies it.

## Theme

The theme source is `packages/theme/themes/studio/studio.theme.ts`. Change it from
`packages/theme` with `npx astryx experimental theme editor set studio <thing> <value>`.
