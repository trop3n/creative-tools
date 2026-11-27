# Creative Tools

A self-hosted suite of browser creative tools. Each tool is its own small app; they
share a core library, one Astryx theme and one origin (so they can share saved data).

| Path | What it is |
| --- | --- |
| `apps/launcher` | Home page: one card per tool, read from `suite.json` |
| `apps/glyf` | GLYF: draw glyphs (rectangles, ellipses, quarters, triangles, polygons, lines; add, cut and keep; any-angle turns, mirror and radial copies) or pick them from a catalog of 19 tunable shape families, then use them as the characters of an image, video, webcam feed, the moving Ribbons or a procedural pattern; glyphs matched by tone and by shape at edges, optionally turned to fit; one ink, the source's colors or a flat palette; exports PNG, SVG and MP4 (Ribbons loop seamlessly) |
| `apps/durandal` | DURANDAL: dither images, video or a webcam feed into 1-bit or palette pixel art (31 styles: 15 error diffusion kernels, Bayer, cluster and other ordered and pattern styles; up to 16 colors from presets, the image, a custom set or an imported .hex or .gpl palette; saturation, sharpen and noise before dithering; CMYK print with four angled ink screens; pattern styles run on the GPU via WebGL2 at full resolution; cells as squares, round dots, diamonds or lines with gaps for dot-matrix and LED looks; a reorderable stack of glitch, light and texture effects over the result); exports PNG, SVG, JPG and MP4 (and PNGs of many images at once in a batch), with keyframed settings and effects over a video, or over a still's own timeline rendered as a looping MP4; saved looks and .durandal.json project files |
| `apps/leela` | LEELA: animated grainy gradients and mesh gradients on the GPU (WebGL2), blended in Oklab, with noise-warped shapes, drift, breathe and flow motion, seamless loops and film grain; pixelate, ASCII, ribbed glass and DURANDAL dithering effects; presets, a seeded randomizer, saved looks, share links and project files; PNG up to 8192 px and MP4 export |
| `apps/bloom` | BLOOM: procedural flowers (carnation, lily, tulip, daisy, cosmos, dahlia) that grow along wandering stems and bloom on a three-stop backdrop, in flat Oklab color ramps, on the GPU (WebGL2) with wind, camera drift and depth of field; presets, a seeded randomizer, regrow loops; exports PNG and frame-accurate MP4 |
| `apps/tycho` | TYCHO: a recursive grid of rectangular cells, each a looping pattern module of 1–3 stacked layers (seven shapes as grids, checkers, stripes, sunbursts, concentric rings, single shapes or glows) with 10 motions, drawn flat with Canvas2D; cuts to a new layout or new modules on the beat, with BPM and tap tempo, so every sequence loops seamlessly; presets, palettes up to 24 colors, saved looks, share links and project files; exports PNG, SVG and MP4 |
| `apps/thoth` | THOTH: a live halftone sandbox. Animated type, shapes, gradient fields (linear, radial, conic, bands), images, video or a webcam are drawn with Canvas2D, then screened on the GPU (WebGL2) as additive RGB, four-ink CMYK or one-ink dots in circle, square, diamond or line shapes, with merging oversized dots; hue cycling, seamless loops, presets, saved looks, share links and project files; exports PNG and MP4 |
| `apps/pfhor` | PFHOR: a quadtree shape mosaic. An image, video or webcam (or a built-in portrait) splits into cells by tone and edge detail, using summed-area tables, and each cell becomes a circle, square or rounded square in a flat palette (lightness ramp or nearest Oklab color) with thin outlines; splits ease in as the threshold moves, for seamless resolve and scatter loops; presets, saved looks, share links and project files; exports PNG, SVG and MP4 |
| `apps/jjaro` | JJARO: a sheet of holographic foil. Verlet cloth (hung by two corners or one edge, draped over a ball, dropped in a heap, or floating) that you can drag with a mouse or touch; the foil is shaded as a diffraction grating (lines, rings, mosaic or swirl grooves) under soft-box lights that sweep on a loop, on the GPU (WebGL2); kinegram, foil-stamp and ink-on-foil printing from a dropped image; water droplets beaded on the foil; glow, depth of field and grain; presets, a seeded randomizer, saved looks, share links and project files; PNG up to 8192 px (optionally transparent) and looping MP4 |
| `packages/core` (`@studio/core`) | Image/video/webcam sources, MP4 render with audio, canvas recording, saving and opening files, storage, the dither engine (`@studio/core/dither`, CPU plus a WebGL2 path for pattern styles), the gradient engine (`@studio/core/gradient`) and the shared frame shapes (`@studio/core/frames`, including the 3072 × 1408 LED wall and Custom size); all tested with `npm test` |
| `packages/theme` (`@studio/theme`) | The suite's Astryx theme and self-hosted fonts (Montserrat, JetBrains Mono) |
| `packages/build` (`@studio/build`) | Shared Vite config and the `studio-inline` single-file step |
| `suite.json` | The tool registry: name, folder, URL path, category, description, preview |

## Connected tools

Inside the built suite the tools share the browser's storage (`packages/core/src/suite.js`):

- **Send to:** every tool can send its current picture (LEELA and BLOOM also their animation) to a tool that takes one: DURANDAL, GLYF, THOTH, PFHOR (images and video) or JJARO (an image as the foil's artwork). The other tool opens in a new tab with it loaded.
- **Recent from the suite:** each of those tools lists the last 12 pictures and videos saved or sent from any tool, under Source.
- **Suite palettes:** Brand plus any palette you save in DURANDAL, GLYF, LEELA (gradient stops), TYCHO, THOTH (backdrop) or PFHOR, usable in any of them.

## Commands

Needs Node 22 or newer.

```bash
npm install
npm run dev            # GLYF dev server, http://localhost:5180
npm run dev:launcher   # launcher dev server, http://localhost:5170
npm run dev:durandal   # DURANDAL dev server, http://localhost:5181
npm run dev:leela      # LEELA dev server, http://localhost:5182
npm run dev:bloom      # BLOOM dev server, http://localhost:5183
npm run dev:tycho      # TYCHO dev server, http://localhost:5184
npm run dev:thoth      # THOTH dev server, http://localhost:5185
npm run dev:pfhor      # PFHOR dev server, http://localhost:5186
npm run dev:jjaro      # JJARO dev server, http://localhost:5187
npm test               # engine tests (core, TYCHO, THOTH, PFHOR, JJARO, GLYF)
npm run build          # builds every app into dist/ (launcher at /, tools at /<path>/)
npm run serve          # serves dist/ at http://localhost:5100
```

Every app builds to a single self-contained `index.html` (JS, CSS and fonts inlined),
so a tool also works opened straight from disk.

Every tool can export for the LED wall at exactly 3072 × 1408: choose **LED wall** in
the Frame menu (LEELA: the export size list). DURANDAL and GLYF cut the middle of the
source to the chosen frame.

**Custom size** in the same menu exports at any width × height you type (16–8192 px,
rounded to even numbers so MP4 can encode it; LEELA has its own Custom export size).

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
