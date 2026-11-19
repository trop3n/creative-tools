# Handoff — creative-tools, Nov. 18–19, 2026

Two Claude Code sessions worked in this repo on the evening of Nov. 18. Both finished and pushed their work. `main` is clean and matches `origin/main` at `d25349b` ("Merge main into bloom").

| Session | Tools | Started from |
|---|---|---|
| A (run in `~/dev/creative-tools`) | DURANDAL, then LEELA | `~/dither-research`, then `~/hazeglow-research/ALGORITHMS.md` |
| B (run in `~`, used a temporary worktree) | BLOOM | `~/creative/specs/1stave-effects/01-procedural-botanical.md` |

The suite now holds five apps: `launcher`, `glyf`, `durandal`, `leela` and `bloom`. All are registered in `suite.json` and have `dev:` and `build:` scripts in the root `package.json`. Shared code lives in `packages/core` (dither engine, gradient engine, `encodeFramesToMp4`, hand-off store).

```
npm run dev:durandal | dev:leela | dev:bloom   # single app
npm run build                                  # whole suite → dist/
```

The sessions didn't deploy anything. The suite hasn't been published since this work.

---

## DURANDAL — dithering (session A)

**Status:** Done. Every item from the research notes is built, plus a polish round. Last DURANDAL commit is `38fd79d`.

**What it has:** 17 styles (error diffusion, ordered and pattern), Ostromukhov variable-coefficient diffusion, two-tone, palette and CMYK print modes. It also has GPU pattern styles, cell shapes (dot-matrix, LED, CRT), crosshatch, stipple, diamonds and spiral. Sources are image, video and webcam. Exports are PNG, SVG and MP4. It has keyframed settings over video with a timeline, saved looks and project files.

**Known deviations from the research (on purpose):**
- Sierra uses the published kernel. The research's version sums to 33/32 and brightens images.
- The Cluster (BitTone) matrix is renumbered to 0–15.

**Options the session offered next (none started):**
- Rename keyframes, drag keyframe marks on the timeline, and keep a short list of recent projects.
- Do a review and cleanup pass over the DURANDAL code. LEELA got one; DURANDAL hasn't.

## LEELA — gradients (session A)

**Status:** Done through step 4, plus hover and a code-review pass. Last commit is `efce17a` ("LEELA: fixes from code review").

**Build steps, all committed:**
1. Gradient engine (`packages/core/src/gradient/`) and a bare live app. Shapes are blob, pill, band, ring and mesh (up to 16 points). Colors blend in Oklab, there are four motion modes, seamless loops up to 30 seconds, and grain.
2. Full inspector: draggable handles and mesh points, saved looks, share links and project files. This step also fixed a narrow-screen settings-button bug in GLYF, DURANDAL and LEELA.
3. Export: PNG (tiled, up to 8192 px), offline MP4 and "Send to DURANDAL" (frame or animation, built suite only).
4. Effects: pixelate, ASCII, ribbed glass, and Dither through DURANDAL's engine.
5. Hover push and pull. It's live only and left out of exports.
6. Review fixes: 10 findings, nine fixed. Fixes cover WebGL context loss, the hand-off hang, tiled MP4, frozen config during renders, Speed 0 and more.

**Tests at handoff:** 44 core tests pass, and the Astryx doctor has 0 failures.

**Left open:**
- During playback the inspector re-renders about four times a second to update the time readout. It isn't causing visible slowdowns. If it ever does, split the readout into its own component.

## BLOOM — procedural flowers (session B)

**Status:** Built, merged into `main` and pushed. The build commit is `b1a9f52`, and the merge is `d25349b`. The temporary worktree (`~/dev/creative-tools-bloom`) and the local `bloom` branch were removed.

**What it has:** Seeded growing stems, buds and leaves, and six flower kinds: carnation, lily, tulip, daisy, cosmos and dahlia. It has seven gradient palettes, wind, camera drift, depth of field and a regrow loop mode. It also has presets, Randomize, saved looks, share links and project files. Exports are PNG and MP4 (five aspect ratios, 1080, 1440 or 2160 px). It uses core's shared `encodeFramesToMp4`, and its own encoder copy and `mp4-muxer` dependency were removed.

**Where it falls short of the reference:**
- No SVG export, because the scene is 3D.
- Carnations and lilies match best. Tulips, daisies and dahlias are simpler.
- Flower heads turn partly toward the camera instead of strictly following the stem.

**Loose ends:**
- `origin/bloom` still exists on GitHub. Everything on it is already in `main`, so it can be deleted.
- "BLOOM" is a working name. Renaming it means a find-and-replace across `apps/bloom`, `suite.json`, `package.json` and the README.

## What's next

1. **Next 1stAve spec: Geomator** (`~/creative/specs/1stave-effects/02-modular-geometric-grid.md`). It's a recursive grid split with up to three shape layers per cell, seven shapes and 10 looping motions, reshuffled on the beat. The specs rate it the easiest of the four.
2. Then `03-rgb-halftone-sandbox.md` (Chromaniac) and `04-quadtree-shape-mosaic.md`.
3. **Tycho** is the remaining saved tool name (Marathon theme, like DURANDAL and LEELA). It has no tool assigned yet.
4. Optional: tune BLOOM's weaker flower kinds, do the DURANDAL polish and review listed above, and delete `origin/bloom`.

## Gotchas from these sessions

- **Two agents in one repo:** Session B used a separate worktree on a branch and held off merging until session A was idle. Reuse that pattern if you run parallel sessions again.
- **Line endings:** `packages/build/inline.js` sometimes shows as modified with no content change (CRLF). Both sessions left it out of commits on purpose.
- **Shell heredocs and `sed` anchors** broke several edits on Windows (CRLF, quoting). The sessions fell back to the Edit tool.
- **Checking the apps:** Sessions used headless Edge screenshots and scripted clicks. "Send to DURANDAL" works only in the built suite (`npm run build`, served together), not between separate dev servers.
