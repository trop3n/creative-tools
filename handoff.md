# Handoff — creative-tools, Nov. 18–21, 2026

**Current state (Nov. 21):** All work is committed and pushed; `main` matches `origin/main`. The only local change is `packages/build/inline.js` (line endings only; leave it out of commits). The suite runs from `a9d1168` in LXC container 105 on `pve` (see below).

The suite holds nine apps: `launcher`, `glyf`, `durandal`, `leela`, `bloom`, `tycho`, `thoth`, `pfhor` and `jjaro`. All are registered in `suite.json` and have `dev:` and `build:` scripts in the root `package.json`. Shared code lives in `packages/core` (dither engine, gradient engine, `encodeFramesToMp4`, hand-off store). `npm test` runs the engine checks for core, TYCHO, THOTH, PFHOR and JJARO; all pass.

```
npm run dev:<app>      # single app (ports 5170–5187; see README)
npm test               # engine checks
npm run build          # whole suite → dist/
```

**History:** Two Claude Code sessions started the work on the evening of Nov. 18. Later sessions (Nov. 19–20) built TYCHO, THOTH, PFHOR and JJARO, polished DURANDAL and deployed the suite.

| Session | Tools | Started from |
|---|---|---|
| A (run in `~/dev/creative-tools`) | DURANDAL, then LEELA | `~/dither-research`, then `~/hazeglow-research/ALGORITHMS.md` |
| B (run in `~`, used a temporary worktree) | BLOOM | `~/creative/specs/1stave-effects/01-procedural-botanical.md` |
| Nov. 19–20 | TYCHO, THOTH, PFHOR, DURANDAL polish, deploy, JJARO | the 1stAve specs, then `holocloth-research` on kaizen |

**Hosted** (last deploy `a9d1168`) in LXC container 105 (`creative-tools`) on `pve`, the Proxmox host: **https://creative-tools.tail5e1c3e.ts.net/**, tailnet only. It moved there from the host itself on Nov. 21; the old `pve.tail5e1c3e.ts.net` address no longer serves anything.

- Container: unprivileged Debian 13, 1 core, 256 MB, 2 GB on `local-lvm`, 10.10.5.205 on `vmbr0`, starts at boot, `/dev/net/tun` passed through (same pattern as etch and garage). It runs only Tailscale; nothing else was installed.
- Files live in `/srv/creative-tools` inside the container. `tailscale serve` shares that folder over HTTPS (the webcam and clipboard need HTTPS).
- SSH: `ssh root@creative-tools` (Tailscale SSH is on in the container). Or `ssh pve`, then `pct enter 105`.
- Redeploy from Windows: `deploy/deploy.sh` needs `rsync`, which Git Bash doesn't have. Instead, run `npm run build`, then:
  ```bash
  tar -C dist -cf - . | ssh root@creative-tools 'set -e; mkdir -p /srv/creative-tools.new && tar -C /srv/creative-tools.new -xf - && rm -rf /srv/creative-tools && mv /srv/creative-tools.new /srv/creative-tools && chmod -R a+rX /srv/creative-tools'
  ```
  `tailscale serve` keeps pointing at the folder, so no restart is needed.
- Moving to the new address left saved looks and recent projects behind (they're kept per address in the browser). Project files on disk still open.
- Undo: on `pve`, `pct stop 105 && pct destroy 105`, and remove the `creative-tools` machine from the Tailscale admin console.

---

## DURANDAL — dithering (session A)

**Status:** Done. Every item from the research notes is built, plus a polish round. Last DURANDAL commit is `38fd79d`.

**What it has:** 17 styles (error diffusion, ordered and pattern), Ostromukhov variable-coefficient diffusion, two-tone, palette and CMYK print modes. It also has GPU pattern styles, cell shapes (dot-matrix, LED, CRT), crosshatch, stipple, diamonds and spiral. Sources are image, video and webcam. Exports are PNG, SVG and MP4. It has keyframed settings over video with a timeline, saved looks and project files.

**Known deviations from the research (on purpose):**
- Sierra uses the published kernel. The research's version sums to 33/32 and brightens images.
- The Cluster (BitTone) matrix is renumbered to 0–15.

**Options the session offered next (none started):**
- Rename keyframes, drag keyframe marks on the timeline, and keep a short list of recent projects.
- ~~Do a review and cleanup pass over the DURANDAL code.~~ **Done Nov. 19.** An independent review found 11 issues (4 medium, 7 low, none severe); all 11 were verified against the code and fixed:
  1. Scrubbing a paused video could show the frame from before the seek. The loop now waits for the seek to land.
  2. Edits during an MP4 render changed the rest of the file. Settings are now locked while rendering (a toast says so; keyframes still apply).
  3. A video whose picture can't be decoded (sound only, ProRes, unsupported HEVC) played blank and could switch the GPU path off. Core's `openVideoFile` now refuses it with a message, for every tool.
  4. The GPU and CPU cut different grids for videos over 1280 px. Both engines now get the same capped frame.
  5. Opening a project with no keyframes over a keyframed video was overwritten by the video's keyframes on the next frame.
  6. Switching sources while recording the webcam discarded the recording. It's now saved.
  7. "Rendering…" could stick, and an MP4 render could stall at "Starting…".
  8. PNG export could save a blank image after a GPU loss. It now says the frame is gone, like SVG.
  9. A slow load (a big video, a webcam prompt) could take over from a newer choice.
  10. Values from project files, keyframes and looks are now clamped to the sliders' ranges.
  11. Shaped-cell SVG export over 1 million cells now explains instead of running out of memory.
  - Checked in headless Edge: same grid on GPU and CPU (320 × 180 for a 1920 px video), paused seeks show the right frame, settings stay locked through an MP4 render, a sound-only file is refused, no console errors. A comparison run against the pre-fix build hung on a seek and was stopped, so the seek check isn't confirmed to catch the old bug.
  - ~~Pattern styles in two-tone mode read Threshold 50% as about twice the brightness.~~ **Fixed Nov. 20** in core (`applyField` and `fieldCutoffs` scale by `threshold / 127.5`): 50% now keeps a flat gray's tone, as CMYK already did, so Bayer, Dots and the rest match the diffusion styles. Saved looks, projects and LEELA's Dither effect that use a pattern style come out darker than before. The Bayer, wave and rings test baselines no longer follow the Python reference.

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
- ~~Tulips, daisies and dahlias are simpler.~~ Tuned Nov. 19: tulips are closed, rounded cups (petals curve across their width); daisies have strap rays with round tips and a domed yellow centre; dahlias are about 80 rolled petals on a golden-angle spiral. Carnation, lily and cosmos are unchanged.
- ~~Flower heads turn partly toward the camera instead of strictly following the stem.~~ **Changed Nov. 20:** heads follow their stem's direction, as the spec's `HeadSlot` asks, and no longer swivel as the camera drifts. Upright heads now show more of their sides.

**Loose ends:**
- ~~`origin/bloom` still exists on GitHub.~~ Deleted Nov. 20.
- "BLOOM" is a working name. Renaming it means a find-and-replace across `apps/bloom`, `suite.json`, `package.json` and the README.

## JJARO — holographic-foil cloth (Nov. 20)

**Status:** Built from `holocloth-research` on kaizen, as an original take rather than a copy of that app. In the suite at `apps/jjaro` (port 5187), with a `suite.json` entry, a launcher preview, root `dev:jjaro`/`build:jjaro` scripts and its checks in the root `npm test`. Commits: `45f7f9e` (cloth, foil, printing), `d5b0fd3` (presets, looks, links, projects), `a29719a` (effects and export), `a9d1168` (suite wiring). Deployed Nov. 20; now at https://creative-tools.tail5e1c3e.ts.net/jjaro/

**What it has:**
- **Cloth:** Verlet with structural, shear and bend constraints, a fixed 120 Hz step, long-range tethers to the pins (so hung sheets don't sag to twice their length), grip friction and self-repulsion. Five setups: hung by two corners, hung along one edge, draped over a hidden ball, dropped in a heap, floating. Drag with a mouse or touch (a soft patch follows; a pinned corner moves its pin); dragging the backdrop orbits; scroll or pinch zooms; wind with gusts.
- **Foil:** a diffraction grating (Stam 1999) with Wyman's CIE fit, orders 1–3, four groove patterns (lines, rings, mosaic, swirl), metal tints, and 1–3 soft boxes sweeping on a loop. The drawn surface is a Catmull–Rom refinement three times finer than the simulation, which removed the triangle jaggies.
- **Printing:** kinegram (grooves turned a quarter turn inside the artwork), foil stamp on matte paper, and ink on foil, from a dropped or pasted image or a sample star. The image is kept in localStorage (capped at 1024 px).
- **Suite features:** eight presets, Randomize (both keep Detail and Frame), saved looks, `#c=` share links with `hashchange`, `.jjaro.json` project files (these carry the image; links and looks don't).
- **Export:** glow, depth of field (BLOOM's gather) and grain. PNG up to 8192 px in padded tiles, optionally transparent. MP4 at 1080/1440/2160 freezes the folds and loops whole rounds of the lights, with an optional 6° camera sway.

**Left open:**
- Touch dragging hasn't been tried on a real phone or tablet.
- The heap can show small spots where folds pass through each other.
- The research's pour-liquid feature was left out of v1 on purpose; it could come back later as a small "droplets" feature.
- Spectrum order was checked by eye, not numerically.

## What's next

1. ~~Geomator~~ **Done Nov. 19 as TYCHO** (`apps/tycho`, port 5184). It draws flat Canvas2D, exports PNG, SVG and MP4, and runs its engine checks with `npm test -w @studio/tycho`.
2. ~~Chromaniac~~ **Built Nov. 19 as THOTH** (`apps/thoth`, port 5185; Thoth was another Marathon AI). Canvas2D source layers (backdrop, image/video/webcam, shape, type) go through a WebGL2 halftone pass (RGB, CMYK, Mono). It exports PNG and MP4, and its engine checks run with `npm test -w @studio/thoth`.
3. ~~Robotron~~ **Built Nov. 19 as PFHOR** (`apps/pfhor`, port 5186; named after Marathon's alien race). A quadtree over summed-area tables of an image, video, webcam or built-in sample, drawn as circles or squares in a flat palette. Splits ease in only while Resolve animates the threshold. Exports PNG, SVG and MP4; engine checks run with `npm test -w @studio/pfhor`. All four 1stAve specs are now built.
4. ~~Pasted share links needed a reload~~ **Fixed Nov. 19:** LEELA, BLOOM, TYCHO, THOTH and PFHOR apply a `#c=` link pasted into an open tab (`hashchange`). GLYF and DURANDAL have no share links.
5. ~~Tune BLOOM's weaker flower kinds~~ and ~~review DURANDAL~~ done Nov. 19. ~~DURANDAL polish~~ **Done Nov. 20:** keyframes take an optional name (kept when a keyframe is updated, saved in project files); a strip of diamonds under the Video position slider moves keyframes by drag or arrow keys (Shift: 10 frames) and refuses a drop onto another keyframe; "Recent projects" keeps a copy of the last five projects saved or opened, in this browser. ~~Deleting `origin/bloom`~~ done Nov. 20.
6. ~~Holographic foil (`holocloth-research`)~~ **Built Nov. 20 as JJARO** (see above) and deployed to `pve`.

Nothing from this list is open. Remaining ideas: try JJARO's touch dragging on a real phone or tablet, and the open items under each tool above.

## Gotchas from these sessions

- **Two agents in one repo:** Session B used a separate worktree on a branch and held off merging until session A was idle. Reuse that pattern if you run parallel sessions again.
- **Line endings:** `packages/build/inline.js` sometimes shows as modified with no content change (CRLF). Both sessions left it out of commits on purpose.
- **Shell heredocs and `sed` anchors** broke several edits on Windows (CRLF, quoting). The sessions fell back to the Edit tool.
- **Checking the apps:** Sessions used headless Edge screenshots and scripted clicks. "Send to DURANDAL" works only in the built suite (`npm run build`, served together), not between separate dev servers.
- **Checking exports headlessly:** The JJARO session drove Edge over CDP (port 9335) and caught exports with a stand-in `window.claude.use('downloads')`, then checked MP4 loops with ffmpeg. A real browser download wasn't tested.
