// DURANDAL's panels: the style list (rail), the stage, its tool bar, and the inspector.
import {useEffect, useRef, useState} from 'react';
import * as stylex from '@stylexjs/stylex';
import {Button} from '@astryxdesign/core/Button';
import {Center} from '@astryxdesign/core/Center';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Layout';
import {List, ListItem} from '@astryxdesign/core/List';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Selector} from '@astryxdesign/core/Selector';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {Toolbar} from '@astryxdesign/core/Toolbar';
import {Slider} from '@astryxdesign/core/Slider';
import {TextInput} from '@astryxdesign/core/TextInput';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Camera, CameraOff, Check, Circle, Clapperboard, Crosshair, Diamond, Download, FolderOpen, Save, Trash2, ImageUp, Minus, Pause, Pencil, Play, Plus, RefreshCw, RotateCcw, Square, Volume2, VolumeX, X} from 'lucide-react';
import {pickFiles, canEncodeVideo} from '@studio/core';
import {STYLES, STYLE_BY_ID, PALETTES, MAX_COLORS, SHAPES, INKS as PROCESS_INKS} from '@studio/core/dither';
import {useStore, currentParams} from '../engine/state.js';
import {
  setCanvas, setSetting, setParam, setStyle, setLook, resetTone, exportPNG, exportSVG, gpuAvailable,
  paletteColors, setImageCount, repickImageColors, editCustom,
} from '../engine/render.js';
import {
  SAMPLES, loadSample, loadFile, playPause, seekFraction, setSound, setVolume, renderVideo, startWebcam, stopCamera,
  setMirrorImage, toggleRecord, seekTo, setKeyframe, removeKeyframe, clearKeyframes, setEase, renameKeyframe, moveKeyframe,
} from '../engine/media.js';
import {saveProject, openProject, saveLook, applyLook, deleteLook, openRecent, forgetRecent} from '../engine/project.js';
import {ICON, InspectorRow, InspectorSection, PresetChip, SliderRow, Swatch} from './parts';

const INKS = ['#00304e', '#242222', '#4c3046', '#c99530', '#90a344'];
const PAPERS = ['#dfdfdf', '#ffffff', '#242222', '#00304e', '#c99530'];

const BLURBS: Record<string, string> = {
  'floyd-steinberg': 'The classic. Fine, even grain.',
  atkinson: 'Bright and crisp; drops some error on purpose.',
  'jarvis-judice-ninke': 'Wide kernel, smooth and soft.',
  stucki: 'Like Jarvis, a little sharper.',
  burkes: 'Two rows, quick and clean.',
  sierra: 'Three rows, balanced texture.',
  'two-row-sierra': 'A lighter Sierra.',
  'sierra-lite': 'Tiny kernel, gritty texture.',
  'stevenson-arce': 'Wide, airy scatter.',
  ostromukhov: 'Weights shift with tone. Even, wormless dots.',
  bayer: 'Regular crosshatch grid. Retro screens.',
  bittone: 'Clustered 4×4 dots, print-like.',
  dots: 'Round halftone dots on a rotated grid.',
  lines: 'Engraved lines that swell in shadow.',
  crosshatch: 'Pen hatching that layers up in shadow.',
  stipple: 'Scattered dots with no grid. Hand stippling.',
  diamonds: 'Diamond dots that grow and join.',
  spiral: 'Arms winding out from the center.',
  wave: 'Sine bands drifting down the frame.',
  rings: 'Concentric ripples from the center.',
  noise: 'Random threshold, film-grain feel.',
  scanline: 'Each row on its own: VHS streaks.',
};
const FAMILIES = [...new Set(STYLES.map(s => s.family))];

const styles = stylex.create({
  output: {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '100%',
    width: 'auto',
    height: 'auto',
    minWidth: 0,
    minHeight: 0,
    imageRendering: 'pixelated',
    borderRadius: 'var(--radius-container)',
    boxShadow: 'var(--shadow-med)',
  },
  // Scale the cell-sized canvas up to fill the stage while keeping its aspect.
  fit: {width: '100%', height: '100%', objectFit: 'contain', boxShadow: 'none', borderRadius: 0},
  frame: {position: 'relative', overflow: 'hidden', minHeight: 0},
  // The keyframe strip under the position slider. The Slider insets its thumb's travel
  // by half its 20 px thumb at each end, so the strip does too and the diamonds line up
  // with the slider's marks.
  strip: {position: 'relative', height: 'var(--spacing-6)', marginInline: '10px', touchAction: 'none'},
  stripLine: {
    position: 'absolute', insetInline: 0, top: '50%', height: '1px',
    backgroundColor: 'var(--color-border)',
  },
  diamond: {
    position: 'absolute', top: '50%',
    width: 'var(--spacing-3)', height: 'var(--spacing-3)',
    padding: 0,
    transform: 'translate(-50%, -50%) rotate(45deg)',
    backgroundColor: 'var(--color-background)',
    borderWidth: '2px', borderStyle: 'solid', borderColor: 'var(--color-accent)',
    borderRadius: '2px',
    cursor: 'grab',
    outline: {default: 'none', ':focus-visible': '2px solid var(--color-accent)'},
    outlineOffset: '2px',
  },
  diamondOn: {backgroundColor: 'var(--color-accent)'},
  diamondDrag: {cursor: 'grabbing', zIndex: 1},
  diamondOff: {cursor: 'default', opacity: 0.5},
});
const place = stylex.create({left: (f: number) => ({left: `${f * 100}%`})});

/* ================= rail ================= */
export function StyleRail() {
  const s = useStore();
  return (
    <VStack gap={4}>
      {FAMILIES.map(family => (
        <List key={family} density="compact" header={<Text type="label" weight="semibold">{family}</Text>}>
          {STYLES.filter(st => st.family === family).map(st => (
            <ListItem
              key={st.id}
              label={st.name}
              description={BLURBS[st.id]}
              isSelected={s.settings.style === st.id}
              onClick={() => setStyle(st.id)}
            />
          ))}
        </List>
      ))}
    </VStack>
  );
}

/* ================= stage ================= */
export function Stage() {
  const s = useStore();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { setCanvas(ref.current); return () => setCanvas(null); }, []);
  const r = s.result;
  return (
    <VStack gap={2} height="100%">
      <StackItem size="fill">
        <Center width="100%" height="100%" xstyle={styles.frame}>
          <canvas ref={ref} width={10} height={10} aria-label="Dithered image" {...stylex.props(styles.output, styles.fit)} />
        </Center>
      </StackItem>
      <HStack gap={3} hAlign="between">
        <Text type="supporting" hasTabularNumbers>
          {r ? `${r.w} × ${r.h} cells · ${r.gpu ? 'GPU' : `${Math.round(r.ms)} ms`}${s.busy && s.media.kind !== 'video' && s.media.kind !== 'camera' ? ' · rendering…' : ''}` : 'Rendering…'}
        </Text>
        <Text type="supporting" maxLines={1}>
          {s.media.label}
        </Text>
      </HStack>
    </VStack>
  );
}

const openMedia = async () => { const [f] = await pickFiles('image/*,video/*,.json,application/json'); loadFile(f); };
const openProjectFile = async () => { const [f] = await pickFiles('.json,application/json'); if (f) openProject(f); };
const clock = (sec: number) => {
  sec = Math.max(0, sec || 0);
  return Math.floor(sec / 60) + ':' + (sec % 60).toFixed(1).padStart(4, '0');
};

export function StageToolbar() {
  const {media} = useStore();
  return (
    <Toolbar
      label="Output"
      size="sm"
      startContent={
        <>
          {media.kind === 'video' ? (
            <>
              <IconButton
                label={media.playing ? 'Pause' : 'Play'}
                tooltip={media.playing ? 'Pause' : 'Play'}
                size="sm"
                variant="ghost"
                isDisabled={media.exporting}
                icon={<Icon icon={media.playing ? Pause : Play} size={ICON} />}
                onClick={playPause}
              />
              <IconButton
                label={media.sound ? 'Turn sound off' : 'Turn sound on'}
                tooltip={media.sound ? 'Sound on' : 'Sound off'}
                size="sm"
                variant="ghost"
                icon={<Icon icon={media.sound ? Volume2 : VolumeX} size={ICON} />}
                onClick={() => setSound(!media.sound)}
              />
              <Text type="supporting" hasTabularNumbers>
                {clock(media.time)} / {clock(media.duration)}
              </Text>
            </>
          ) : null}
          {media.kind === 'camera' ? (
            <Button
              label={media.recording ? `Stop ${clock(media.recTime)}` : 'Record'}
              size="sm"
              variant={media.recording ? 'destructive' : 'secondary'}
              icon={<Icon icon={media.recording ? Square : Circle} size={ICON} />}
              onClick={toggleRecord}
            />
          ) : null}
          {media.kind !== 'video' && media.kind !== 'camera' ? (
            <Button label="Open" size="sm" variant="ghost" icon={<Icon icon={ImageUp} size={ICON} />} onClick={openMedia} />
          ) : null}
          <Button label="PNG" size="sm" variant="ghost" icon={<Icon icon={Download} size={ICON} />} onClick={exportPNG} />
          <Button label="SVG" size="sm" variant="ghost" icon={<Icon icon={Download} size={ICON} />} onClick={exportSVG} />
        </>
      }
    />
  );
}

/* ================= inspector ================= */
const signed = (v: number) => (v > 0 ? '+' : '') + v;

export function Inspector() {
  const s = useStore();
  const st = s.settings, look = s.look;
  const style = STYLE_BY_ID[st.style];
  const params = currentParams();
  return (
    <>
      <InspectorSection title="Source">
        <SegmentedControl
          label="Sample image"
          size="sm"
          layout="fill"
          value={s.media.kind === 'sample' ? look.sample : ''}
          onChange={loadSample}>
          {Object.entries(SAMPLES).map(([k, label]) => (
            <SegmentedControlItem key={k} value={k} label={label} />
          ))}
        </SegmentedControl>
        <HStack gap={1} wrap="wrap">
          <Button label="Image or video…" size="sm" variant="primary" icon={<Icon icon={ImageUp} size={ICON} />} onClick={openMedia} />
          {s.media.kind === 'camera' ? (
            <Button label="Stop camera" size="sm" icon={<Icon icon={CameraOff} size={ICON} />} onClick={stopCamera} />
          ) : (
            <Button label="Webcam" size="sm" icon={<Icon icon={Camera} size={ICON} />} onClick={() => startWebcam()} />
          )}
        </HStack>
        <Text type="supporting">You can also drop an image or video anywhere on the page, or paste an image.</Text>
      </InspectorSection>

      {s.media.kind === 'video' ? <VideoSection /> : null}
      {s.media.kind === 'video' ? <KeyframesSection /> : null}
      {s.media.kind === 'camera' ? <WebcamSection /> : null}

      <InspectorSection title={style.name}>
        <Text type="supporting">{BLURBS[style.id]}</Text>
        {style.params.map((p: any) =>
          p.type === 'toggle' ? (
            <Switch key={p.key} label={p.label} size="sm" value={!!params[p.key]} onChange={v => setParam(p.key, v)} />
          ) : p.type === 'select' ? (
            <InspectorRow key={p.key} label={p.label}>
              <SegmentedControl label={p.label} size="sm" layout="fill" value={String(params[p.key])} onChange={v => setParam(p.key, Number(v))}>
                {p.options.map((o: number) => (
                  <SegmentedControlItem key={o} value={String(o)} label={`${o}×${o}`} />
                ))}
              </SegmentedControl>
            </InspectorRow>
          ) : (
            <SliderRow key={p.key} label={p.label} value={params[p.key]} min={p.min} max={p.max} step={p.step} onChange={v => setParam(p.key, v)} />
          ),
        )}
      </InspectorSection>

      <InspectorSection title="Pixels">
        <SliderRow label="Pixel size" value={st.block} min={1} max={32} format={v => `${v} px`} onChange={v => setSetting('block', v)} />
        {st.mode === 'palette' ? (
          <SliderRow label="Strength" value={st.strength ?? 100} min={0} max={100} format={v => `${v}%`} onChange={v => setSetting('strength', v)} />
        ) : (
          <SliderRow label="Threshold" value={st.threshold} min={0} max={100} format={v => `${v}%`} onChange={v => setSetting('threshold', v)} />
        )}
        <Switch label="Invert" size="sm" value={!!st.invert} onChange={v => setSetting('invert', v)} />
        {gpuAvailable() && style.family === 'Pattern' ? (
          <Switch label="Render patterns on the GPU" size="sm" value={look.gpu !== false} onChange={v => setLook('gpu', v)} />
        ) : null}
      </InspectorSection>

      <InspectorSection title="Tone">
        <SliderRow label="Brightness" value={st.brightness} min={-100} max={100} format={signed} onChange={v => setSetting('brightness', v)} />
        <SliderRow label="Contrast" value={st.contrast} min={-100} max={100} format={signed} onChange={v => setSetting('contrast', v)} />
        <SliderRow label="Midtones" value={st.midtones} min={-100} max={100} format={signed} onChange={v => setSetting('midtones', v)} />
        <SliderRow label="Highlights" value={st.highlights} min={-100} max={100} format={signed} onChange={v => setSetting('highlights', v)} />
        <SliderRow label="Shadows" value={st.shadows} min={-100} max={100} format={signed} onChange={v => setSetting('shadows', v)} />
        <SliderRow label="Blur" value={st.blur} min={0} max={20} format={v => `${v} px`} onChange={v => setSetting('blur', v)} />
        <HStack>
          <Button label="Reset tone" size="sm" variant="ghost" icon={<Icon icon={RotateCcw} size={ICON} />} onClick={resetTone} />
        </HStack>
      </InspectorSection>

      <InspectorSection title="Color">
        <SegmentedControl label="Color mode" size="sm" layout="fill" value={st.mode === 'palette' || st.mode === 'cmyk' ? st.mode : 'mono'} onChange={v => setSetting('mode', v)}>
          <SegmentedControlItem value="mono" label="Two tones" />
          <SegmentedControlItem value="palette" label="Palette" />
          <SegmentedControlItem value="cmyk" label="CMYK" />
        </SegmentedControl>
        {st.mode === 'palette' ? <PaletteControls /> : st.mode === 'cmyk' ? <CmykControls /> : <TwoTones />}
      </InspectorSection>

      <InspectorSection title="Cell shape">
        <InspectorRow label="Shape">
          <Selector
            label="Cell shape"
            isLabelHidden
            size="sm"
            width="100%"
            value={look.cellShape || 'square'}
            options={SHAPES.map(sh => ({value: sh.id, label: sh.name}))}
            onChange={v => setLook('cellShape', v)}
          />
        </InspectorRow>
        <SliderRow label="Gap" value={look.gap || 0} min={0} max={80} format={v => `${v}%`} onChange={v => setLook('gap', v)} />
        {(look.cellShape && look.cellShape !== 'square') || look.gap > 0 ? (
          <>
            <InspectorRow label="Gap color">
              <SegmentedControl label="Gap color" size="sm" layout="fill" value={look.gapTone === 'light' ? 'light' : 'dark'} onChange={v => setLook('gapTone', v)}>
                <SegmentedControlItem value="dark" label="Darkest" />
                <SegmentedControlItem value="light" label="Lightest" />
              </SegmentedControl>
            </InspectorRow>
            <Text type="supporting">Shapes need a few pixels per cell. Raise Pixel size if they look rough.</Text>
          </>
        ) : null}
      </InspectorSection>

      <LooksSection />

      <InspectorSection title="Export">
        <InspectorRow label="Size">
          <Selector
            label="Export size"
            isLabelHidden
            size="sm"
            width="100%"
            value={look.exportScale}
            options={[
              {value: 'full', label: 'Full size (pixel blocks)'},
              {value: 'cells', label: 'One pixel per cell'},
            ]}
            onChange={v => setLook('exportScale', v)}
          />
        </InspectorRow>
        <HStack gap={1} wrap="wrap">
          <Button label="Save PNG" size="sm" variant="primary" icon={<Icon icon={Download} size={ICON} />} onClick={exportPNG} />
          <Button label="Save SVG" size="sm" variant="secondary" icon={<Icon icon={Download} size={ICON} />} onClick={exportSVG} />
        </HStack>
        <Text type="supporting">
          {s.result
            ? look.exportScale === 'cells'
              ? `${s.result.w} × ${s.result.h} px`
              : `${s.result.w * st.block} × ${s.result.h * st.block} px`
            : ' '}
        </Text>
      </InspectorSection>
    </>
  );
}

const PALETTE_OPTIONS = [
  ...PALETTES.map(p => ({value: p.id, label: p.name})),
  {value: 'image', label: 'From the image'},
  {value: 'custom', label: 'Custom'},
];

function CmykControls() {
  const {settings: st} = useStore();
  return (
    <>
      <InspectorRow label="Inks">
        {PROCESS_INKS.map(i => (
          <PresetChip key={i.id} label={`${i.name} ink`} color={i.color} isOn={false} />
        ))}
      </InspectorRow>
      <SliderRow label="Black" value={st.black ?? 100} min={0} max={100} format={v => `${v}%`} onChange={v => setSetting('black', v)} />
      <Text type="supporting">
        Each ink is dithered on its own with the style and overprinted on white. Pattern screens turn to 15°, 75°, 0° and 45°. Black sets how much of the shared gray prints as black ink.
      </Text>
    </>
  );
}

function TwoTones() {
  const {look} = useStore();
  return (
    <>
      <InspectorRow label="Ink">
        {INKS.map(c => (
          <PresetChip key={c} label="Ink" color={c} isOn={look.ink === c} onPick={() => setLook('ink', c)} />
        ))}
        <Swatch label="Custom ink" value={look.ink} onChange={v => setLook('ink', v)} />
      </InspectorRow>
      <InspectorRow label="Paper">
        {PAPERS.map(c => (
          <PresetChip key={c} label="Paper" color={c} isOn={look.paper === c} onPick={() => setLook('paper', c)} />
        ))}
        <Swatch label="Custom paper" value={look.paper} onChange={v => setLook('paper', v)} />
      </InspectorRow>
    </>
  );
}

function PaletteControls() {
  const {settings: st, look} = useStore();
  const colors: string[] = paletteColors({pick: false});
  // Editing any swatch turns the palette on show into the custom palette.
  const edit = (next: string[]) => editCustom(next);
  return (
    <>
      <InspectorRow label="Palette">
        <Selector label="Palette" isLabelHidden size="sm" width="100%" value={st.palette} options={PALETTE_OPTIONS} onChange={v => setSetting('palette', v)} />
      </InspectorRow>
      <InspectorRow label="Colors">
        {colors.map((c, i) => (
          <Swatch key={i} label={`Color ${i + 1}`} value={c} onChange={v => edit(colors.map((x, j) => (j === i ? v : x)))} />
        ))}
        {colors.length < MAX_COLORS ? (
          <IconButton label="Add a color" tooltip="Add a color" size="sm" variant="ghost" icon={<Icon icon={Plus} size={ICON} />} onClick={() => edit([...colors, colors[colors.length - 1]])} />
        ) : null}
        {colors.length > 2 ? (
          <IconButton label="Remove the last color" tooltip="Remove the last color" size="sm" variant="ghost" icon={<Icon icon={Minus} size={ICON} />} onClick={() => edit(colors.slice(0, -1))} />
        ) : null}
      </InspectorRow>
      {st.palette === 'image' ? (
        <>
          <SliderRow label="How many" value={look.imageCount} min={2} max={MAX_COLORS} onChange={setImageCount} />
          <HStack>
            <Button label="Pick again from this frame" size="sm" variant="ghost" icon={<Icon icon={RefreshCw} size={ICON} />} onClick={repickImageColors} />
          </HStack>
        </>
      ) : null}
      <Text type="supporting">Up to {MAX_COLORS} colors. Changing one saves the set as your custom palette.</Text>
    </>
  );
}

function VideoSection() {
  const {media: m, look} = useStore();
  return (
    <InspectorSection title="Video">
      <Slider
        label="Position"
        isLabelHidden
        min={0}
        max={1000}
        value={m.duration ? Math.round((m.time / m.duration) * 1000) : 0}
        onChange={(v: number) => seekFraction(v / 1000)}
        valueDisplay="none"
        marks={m.duration ? m.keys.map((k: any) => ({value: Math.round((k.t / m.duration) * 1000)})) : undefined}
        isDisabled={m.exporting}
      />
      {m.duration && m.keys.length ? <KeyframeStrip /> : null}
      <SliderRow label="Volume" value={m.volume} min={0} max={1} step={0.01} format={v => Math.round(v * 100) + '%'} onChange={setVolume} />
      <InspectorRow label="Frame rate">
        <SegmentedControl label="Frame rate" size="sm" layout="fill" value={look.fps} onChange={v => setLook('fps', v)}>
          {['24', '25', '30', '60'].map(f => (
            <SegmentedControlItem key={f} value={f} label={f} />
          ))}
        </SegmentedControl>
      </InspectorRow>
      <Switch label="Include the source audio" size="sm" value={!!look.audio} onChange={v => setLook('audio', v)} />
      <Button
        label={m.exporting ? 'Cancel render' : 'Render video .mp4'}
        size="sm"
        variant={m.exporting ? 'destructive' : 'primary'}
        icon={<Icon icon={Clapperboard} size={ICON} />}
        isDisabled={!canEncodeVideo()}
        tooltip={canEncodeVideo() ? undefined : "This browser cannot encode video. Use Chrome or Edge."}
        onClick={renderVideo}
      />
      <Text type="supporting" hasTabularNumbers>
        {m.progress ||
          'Renders every frame offline at full quality. Pixel blocks are scaled up by whole numbers toward 1920 px, so they stay sharp.'}
      </Text>
    </InspectorSection>
  );
}

/**
 * A diamond per keyframe under the position slider. Drag one to move it in time; click
 * one to go there. Focused, arrow keys nudge it a frame (Shift: 10 frames) and Enter goes there.
 */
function KeyframeStrip() {
  const {media: m, look} = useStore();
  const rail = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{from: number; t: number; x: number; moved: boolean} | null>(null);
  const timeAt = (clientX: number) => {
    const box = rail.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * m.duration;
  };
  // A keyframe's time is its React key, so a moved diamond remounts: put focus back on it.
  const refocus = useRef<number | null>(null);
  useEffect(() => {
    if (refocus.current === null) return;
    rail.current?.querySelector<HTMLElement>(`[data-t="${refocus.current}"]`)?.focus();
    refocus.current = null;
  }, [m.keys]);
  const move = (from: number, to: number, keepFocus = false) => {
    const at = moveKeyframe(from, to);
    if (at === null) return;
    if (keepFocus) refocus.current = at;
    seekTo(at);
  };
  const frame = 1 / (Number(look.fps) || 30);
  return (
    <div ref={rail} {...stylex.props(styles.strip)}>
      <div {...stylex.props(styles.stripLine)} />
      {m.keys.map((k: any) => {
        const t = drag?.from === k.t ? drag.t : k.t;
        const name = k.name || clock(k.t);
        const on = Math.abs(k.t - m.time) <= 1 / 60;
        return (
          <div
            key={k.t}
            data-t={k.t}
            role="slider"
            tabIndex={m.exporting ? -1 : 0}
            aria-label={`Keyframe ${name}`}
            aria-valuemin={0}
            aria-valuemax={m.duration}
            aria-valuenow={t}
            aria-valuetext={clock(t)}
            aria-disabled={m.exporting || undefined}
            title={`${name}: drag to move, click to go there`}
            onPointerDown={e => {
              if (m.exporting || e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag({from: k.t, t: k.t, x: e.clientX, moved: false});
            }}
            onPointerMove={e => {
              if (!drag || drag.from !== k.t) return;
              const moved = drag.moved || Math.abs(e.clientX - drag.x) > 3;
              setDrag({...drag, moved, t: moved ? timeAt(e.clientX) : drag.t});
            }}
            onPointerUp={() => {
              if (!drag || drag.from !== k.t) return;
              setDrag(null);
              if (drag.moved) move(k.t, drag.t); else seekTo(k.t);
            }}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={e => {
              if (m.exporting) return;
              const sign = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (sign) { e.preventDefault(); move(k.t, k.t + sign * frame * (e.shiftKey ? 10 : 1), true); }
              else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); seekTo(k.t); }
            }}
            {...stylex.props(
              styles.diamond,
              place.left(t / m.duration),
              on && styles.diamondOn,
              drag?.from === k.t && styles.diamondDrag,
              m.exporting && styles.diamondOff,
            )}
          />
        );
      })}
    </div>
  );
}

/** Named looks kept in this browser, and project files that hold everything. */
function LooksSection() {
  const {looks, recents} = useStore() as any;
  const [name, setName] = useState('');
  const save = () => { if (name.trim()) { saveLook(name); setName(''); } };
  return (
    <InspectorSection title="Saved looks">
      <HStack gap={1}>
        <StackItem size="fill">
          <TextInput
            label="Name for this look"
            isLabelHidden
            size="sm"
            width="100%"
            placeholder="Name this look"
            value={name}
            onChange={v => setName(v)}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
          />
        </StackItem>
        <Button label="Save" size="sm" variant="secondary" icon={<Icon icon={Save} size={ICON} />} isDisabled={!name.trim()} onClick={save} />
      </HStack>
      {looks.length ? (
        <List density="compact">
          {looks.map((l: any) => (
            <ListItem
              key={l.name}
              label={l.name}
              description={`${STYLE_BY_ID[l.settings.style]?.name ?? l.settings.style} · ${l.settings.mode === 'cmyk' ? 'CMYK' : l.settings.mode === 'palette' ? 'Palette' : 'Two tones'} · ${l.settings.block} px`}
              endContent={
                <HStack gap={0}>
                  <IconButton label={`Use ${l.name}`} tooltip="Use this look" size="sm" variant="ghost" icon={<Icon icon={Check} size={ICON} />} onClick={() => applyLook(l.name)} />
                  <IconButton label={`Delete ${l.name}`} tooltip="Delete" size="sm" variant="ghost" icon={<Icon icon={Trash2} size={ICON} />} onClick={() => deleteLook(l.name)} />
                </HStack>
              }
            />
          ))}
        </List>
      ) : (
        <Text type="supporting">Save the style, settings and colors under a name to come back to them. Looks stay in this browser.</Text>
      )}
      <HStack gap={1} wrap="wrap">
        <Button label="Save project" size="sm" variant="ghost" icon={<Icon icon={Download} size={ICON} />} onClick={saveProject} />
        <Button label="Open project" size="sm" variant="ghost" icon={<Icon icon={FolderOpen} size={ICON} />} onClick={openProjectFile} />
      </HStack>
      <Text type="supporting">A project file holds every setting, and a video’s keyframes, to share or keep. You can also drop one on the page.</Text>
      {recents.length ? (
        <List density="compact" header={<Text type="label" weight="semibold">Recent projects</Text>}>
          {recents.map((r: any) => (
            <ListItem
              key={r.name}
              label={r.name}
              description={`${new Date(r.at).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}${r.data.video?.keys?.length ? ` · ${r.data.video.keys.length} keyframes` : ''}`}
              endContent={
                <HStack gap={0}>
                  <IconButton label={`Open ${r.name}`} tooltip="Open this project" size="sm" variant="ghost" icon={<Icon icon={FolderOpen} size={ICON} />} onClick={() => openRecent(r.name)} />
                  <IconButton label={`Remove ${r.name} from recent projects`} tooltip="Remove from this list" size="sm" variant="ghost" icon={<Icon icon={X} size={ICON} />} onClick={() => forgetRecent(r.name)} />
                </HStack>
              }
            />
          ))}
        </List>
      ) : null}
    </InspectorSection>
  );
}

/** Keyframe the settings over the video's time; they ease between keyframes as it plays and renders. */
function KeyframesSection() {
  const {media: m} = useStore();
  const here = m.keys.find((k: any) => Math.abs(k.t - m.time) <= 1 / 60);
  const [naming, setNaming] = useState<{t: number; name: string} | null>(null);
  const finishNaming = () => { if (naming) renameKeyframe(naming.t, naming.name); setNaming(null); };
  return (
    <InspectorSection title="Keyframes">
      <HStack gap={1} wrap="wrap">
        <Button
          label={here ? `Update keyframe at ${clock(m.time)}` : `Set keyframe at ${clock(m.time)}`}
          size="sm"
          variant="primary"
          icon={<Icon icon={Diamond} size={ICON} />}
          isDisabled={m.exporting}
          onClick={setKeyframe}
        />
        {m.keys.length ? <Button label="Clear all" size="sm" variant="ghost" isDisabled={m.exporting} onClick={clearKeyframes} /> : null}
      </HStack>
      {naming ? (
        <HStack gap={1}>
          <StackItem size="fill">
            <TextInput
              label={`Name for the keyframe at ${clock(naming.t)}`}
              isLabelHidden
              size="sm"
              width="100%"
              placeholder={clock(naming.t)}
              value={naming.name}
              hasAutoFocus
              onChange={v => setNaming({...naming, name: v})}
              onKeyDown={e => { if (e.key === 'Enter') finishNaming(); else if (e.key === 'Escape') setNaming(null); }}
            />
          </StackItem>
          <Button label="Done" size="sm" variant="secondary" icon={<Icon icon={Check} size={ICON} />} onClick={finishNaming} />
        </HStack>
      ) : null}
      {m.keys.length ? (
        <List density="compact">
          {m.keys.map((k: any) => (
            <ListItem
              key={k.t}
              label={k.name || clock(k.t)}
              description={`${k.name ? clock(k.t) + ' · ' : ''}${STYLE_BY_ID[k.style]?.name ?? k.style} · ${k.values.block} px`}
              isSelected={k === here}
              endContent={
                <HStack gap={0}>
                  <IconButton label={`Rename ${k.name || 'keyframe at ' + clock(k.t)}`} tooltip="Rename" size="sm" variant="ghost" icon={<Icon icon={Pencil} size={ICON} />} isDisabled={m.exporting} onClick={() => setNaming({t: k.t, name: k.name || ''})} />
                  <IconButton label={`Go to ${clock(k.t)}`} tooltip="Go to this keyframe" size="sm" variant="ghost" icon={<Icon icon={Crosshair} size={ICON} />} isDisabled={m.exporting} onClick={() => seekTo(k.t)} />
                  <IconButton label={`Remove keyframe at ${clock(k.t)}`} tooltip="Remove" size="sm" variant="ghost" icon={<Icon icon={Trash2} size={ICON} />} isDisabled={m.exporting} onClick={() => removeKeyframe(k.t)} />
                </HStack>
              }
            />
          ))}
        </List>
      ) : null}
      <Switch label="Ease in and out" size="sm" value={m.ease !== false} onChange={setEase} />
      <Text type="supporting">
        {m.keys.length < 2
          ? 'Pause, set the sliders, and set a keyframe. Do it again at another time, and pixel size, threshold, tone, blur and the style’s own sliders glide between them as the video plays and renders.'
          : 'Changes you make while paused stay on screen until you set or update a keyframe; playing or scrubbing goes back to the keyframes. A style change takes effect at its keyframe.'}
      </Text>
    </InspectorSection>
  );
}

function WebcamSection() {
  const {media: m, look} = useStore();
  return (
    <InspectorSection title="Webcam">
      {m.cams.length > 1 ? (
        <Selector label="Camera" size="sm" options={m.cams} value={m.camId} onChange={v => startWebcam(v)} />
      ) : null}
      <Switch label="Mirror image" size="sm" value={!!look.mirror} onChange={setMirrorImage} />
      <Text type="supporting">Record captures the output live, as you see it, with no sound.</Text>
    </InspectorSection>
  );
}
