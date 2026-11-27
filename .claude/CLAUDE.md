# CLAUDE

Project-specific guidance for AI coding agents.

## This repo
- npm workspaces suite: apps in `apps/*` (launcher, glyf, durandal, leela, bloom, tycho, thoth, pfhor, jjaro), shared code in `packages/*`. Tool registry: `suite.json`. See README.md. Each app has `dev:<id>` and `build:<id>` root scripts; `npm run build` builds the whole suite.
- `packages/core` holds the dither engine (`@studio/core/dither`, used by DURANDAL and LEELA's Dither effect), the gradient engine (`src/gradient/`, LEELA), the shared `encodeFramesToMp4` (LEELA, BLOOM), the frame shapes, LED wall and Custom size (`src/frames.js`, every tool) and the suite connections (`src/suite.js`: the shelf of recent pictures and videos, Send to, suite palettes; each tool's `ui/suite.tsx` is an identical copy of the UI for them; sending works only in the built suite, not between dev servers or over `file://`; the older single-file `src/handoff.js` is kept for old links).
- If another agent is working in this repo at the same time, work in a separate git worktree on a branch and merge into `main` only when the other session is idle.
- `packages/build/inline.js` can show as modified with no content change (CRLF). Leave it out of commits.
- Apps DO have a StyleX compiler: every app's Vite config comes from `studioApp()` in `packages/build/vite.js` (@stylexjs/unplugin + a Windows dev-URL fix), so `stylex.create` + `xstyle` are fine inside `apps/*`. (The Astryx block below was generated at the repo root, which has no bundler, so it says otherwise.)
- Reusable, framework-free logic (sources, exporters, files, storage) belongs in `packages/core`; the theme is `packages/theme` (slug `studio`).
- Astryx CLI needs Node ≥ 22. Verify UI with `npm run build && npm run serve` and a headless Edge screenshot; `astryx experimental theme editor show --png` fails on this machine.

<!-- ASTRYX:START -->
Astryx v0.7.16 · 174 components
CLI: run every command as `npx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — start every page from a template, never from scratch:
1. `astryx build "<idea>"` — names the template to scaffold from and the parts it lacks.
2. `astryx template <name> <path>` — scaffold it; keep its frame, gap and padding; replace the content.
3. `astryx template <Block>` for parts it lacks; `astryx component <Name>` to read props before using one.
Changing an existing page? Keep it: skip step 2 and add blocks/components inside its sections.
Before you deliver a build, run `astryx doctor --built <dir>`; don't deliver it if it fails.

RULES:
- No <div> — components handle all layout and spacing.
- Read `astryx docs layout` before changing a template's frame.
- Dense data = rows (Table, List/Item), not Card-wrapped lists. Badge = counts only.
- Style with component props first, then tokens (var(--color-*|--spacing-*|--radius-*)). No raw hex/px. No StyleX/Tailwind compiler here — don't use xstyle/utility classes directly. Some templates use StyleX and need a compiler plugin; see `astryx docs styling-overview`.
- THEMES: palettes and custom colors go through the theme, never :root overrides. To make or change a theme (colors, fonts, corners, spacing, a look from a picture), prefer the experimental theme editor over hand-written theme files: `astryx experimental theme editor new <name> --like neutral`, then `editor set <name> <thing> <value>` or `editor how "<what you want>"`; wire it with `astryx theme add <name>`; after each change look at it with `astryx experimental theme editor show <name> --png` and open the PNGs it writes (changes nothing in the app); a theme change is not done until you have looked at the pictures. In code, extend an imported theme to customize it; `theme eject <slug>` only forks source. See `astryx docs theme`.
- SELF-CHECK: re-read the file; replace any raw <div>/<span>, imported .css/@apply, or hardcoded #hex/px with the component or a token.

`astryx help` lists every command. Key ones beyond the workflow:
  search "<query>"   find any component / hook / doc / template
  discover <words>   integrations you could add
  docs <topic>       getting-started, principles, tokens, theme … (`astryx docs` lists all)
  docs cli           commands and API reference
  docs authoring     build an integration package, and every field it holds
  upgrade --from <old version> --apply   run after a dependency bump
<!-- ASTRYX:END -->
