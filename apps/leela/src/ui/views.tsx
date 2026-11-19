// LEELA's panels: the stage (canvas with draggable handles), its tool bar, and the inspector.
import {useEffect, useRef, useState} from 'react';
import * as stylex from '@stylexjs/stylex';
import {Button} from '@astryxdesign/core/Button';
import {Center} from '@astryxdesign/core/Center';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {HStack, StackItem} from '@astryxdesign/core/Layout';
import {List, ListItem} from '@astryxdesign/core/List';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Selector} from '@astryxdesign/core/Selector';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Toolbar} from '@astryxdesign/core/Toolbar';
import {
  ArrowLeftRight, Check, Clapperboard, Dices, Download, FolderOpen, Image as ImageIcon, Link, Minus, Move, Pause, Play, Plus, RotateCcw, Save, Send, Shuffle, Trash2,
} from 'lucide-react';
import {pickFiles, canEncodeVideo} from '@studio/core';
import {PRESETS, MAX_STOPS, MAX_POINTS} from '@studio/core/gradient';
import {STYLES} from '@studio/core/dither';
import {
  useStore, attachCanvas, applyPreset, randomize, reseed, togglePlay, restart, toggleHandles, set, setPair, setShape, asHex,
  setStop, addStop, removeStop, reversePalette, setPoint, addPoint, removePoint, pointerDown, pointerMove, pointerUp, pointerLeave,
  saveLook, applyLook, deleteLook, saveProject, openProject, copyLink,
  SIZES, MAX_SIDE, setOut, outSize, videoPlan, exportPNG, exportMP4, cancelVideo, sendToDurandal, canSendToDurandal, attachFx, gradientColors,
} from '../engine/live.js';
import {ICON, InspectorRow, InspectorSection, PresetChip, SliderRow, Swatch} from './parts';

const styles = stylex.create({
  frame: {position: 'relative', width: '100%', height: '100%'},
  canvas: {display: 'block', width: '100%', height: '100%', borderRadius: 'var(--radius-container)', boxShadow: 'var(--shadow-med)', touchAction: 'none'},
  meshCursor: {cursor: 'crosshair'},
  overlay: {position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible'},
  fxLayer: {position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', borderRadius: 'var(--radius-container)', imageRendering: 'pixelated'},
  ringOuter: {fill: 'none', stroke: 'var(--color-background-inverted)', strokeWidth: 4, opacity: 0.55},
  ringInner: {stroke: 'var(--color-background-body)', strokeWidth: 2},
  cross: {stroke: 'var(--color-background-body)', strokeWidth: 2},
});
const paint = stylex.create({fill: (c: string) => ({fill: c})});

const pct = (v: number) => `${Math.round(v * 100)}%`;
const deg = (v: number) => `${Math.round(v)}°`;
const SHAPE_LABELS: Record<string, string> = {blob: 'Blob', pill: 'Pill', band: 'Band', ring: 'Ring', mesh: 'Mesh'};
const MOTION_LABELS: Record<string, string> = {drift: 'Drift', breathe: 'Breathe', flow: 'Flow', none: 'Still'};

/* ================= stage ================= */
export function Stage() {
  const ref = useRef<HTMLCanvasElement>(null);
  const s = useStore();
  useEffect(() => { attachCanvas(ref.current); return () => attachCanvas(null); }, []);
  if (!s.supported) {
    return (
      <Center height="100%">
        <Text type="supporting">This browser can't run WebGL2, which LEELA needs to draw.</Text>
      </Center>
    );
  }
  const c = s.config, mesh = c.shape === 'mesh';
  return (
    <Center xstyle={styles.frame}>
      <canvas
        ref={ref}
        aria-label="Gradient. Drag the handles to move the shape or the mesh points."
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onPointerLeave={pointerLeave}
        {...stylex.props(styles.canvas, mesh && styles.meshCursor)}
      />
      {c.effect === 'dither' ? <DitherLayer /> : null}
      {s.handles ? (
        <svg aria-hidden="true" {...stylex.props(styles.overlay)}>
          {mesh ? (
            c.mesh.map((p, i) => (
              <g key={i}>
                <circle cx={pct(p.x)} cy={pct(p.y)} r={s.drag === i ? 12 : 10} {...stylex.props(styles.ringOuter)} />
                <circle cx={pct(p.x)} cy={pct(p.y)} r={s.drag === i ? 11 : 9} {...stylex.props(styles.ringInner, paint.fill(asHex(p.color)))} />
              </g>
            ))
          ) : (
            <g>
              <circle cx={pct(c.center[0])} cy={pct(c.center[1])} r={s.drag === -2 ? 12 : 10} {...stylex.props(styles.ringOuter)} />
              <circle cx={pct(c.center[0])} cy={pct(c.center[1])} r={s.drag === -2 ? 11 : 9} {...stylex.props(styles.ringInner, paint.fill('transparent'))} />
            </g>
          )}
        </svg>
      ) : null}
    </Center>
  );
}

/** The dithered picture, drawn over the gradient (drags pass through to it). */
function DitherLayer() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { attachFx(ref.current); return () => attachFx(null); }, []);
  return <canvas ref={ref} aria-hidden="true" {...stylex.props(styles.fxLayer)} />;
}

export function StageToolbar() {
  const s = useStore();
  return (
    <Toolbar
      label="Playback"
      size="sm"
      startContent={
        <>
          <IconButton label={s.playing ? 'Pause' : 'Play'} tooltip={s.playing ? 'Pause' : 'Play'} size="sm" variant="ghost" icon={<Icon icon={s.playing ? Pause : Play} size={ICON} />} onClick={togglePlay} />
          <IconButton label="Back to the start" tooltip="Back to the start" size="sm" variant="ghost" icon={<Icon icon={RotateCcw} size={ICON} />} onClick={restart} />
          <Text type="supporting" hasTabularNumbers maxLines={1}>
            {s.config.loop > 0 ? `${(s.time % s.config.loop).toFixed(1)} / ${s.config.loop} s` : `${s.time.toFixed(1)} s`}
          </Text>
          <IconButton
            label={s.handles ? 'Hide handles' : 'Show handles'}
            tooltip={s.handles ? 'Hide handles' : 'Show handles'}
            size="sm"
            variant={s.handles ? 'secondary' : 'ghost'}
            icon={<Icon icon={Move} size={ICON} />}
            onClick={toggleHandles}
          />
          <Button label="PNG" size="sm" variant="ghost" icon={<Icon icon={Download} size={ICON} />} isDisabled={s.exporting} onClick={exportPNG} />
          <Button label="MP4" size="sm" variant="ghost" icon={<Icon icon={Clapperboard} size={ICON} />} isDisabled={s.exporting || !canEncodeVideo()} onClick={exportMP4} />
        </>
      }
    />
  );
}

/* ================= inspector ================= */
export function Inspector() {
  const s = useStore();
  const c = s.config, mesh = c.shape === 'mesh';
  return (
    <>
      <InspectorSection title="Start from">
        <Selector
          label="Preset"
          isLabelHidden
          size="sm"
          width="100%"
          placeholder="Choose a preset"
          value={s.preset}
          options={PRESETS.map(p => ({value: p.id, label: p.name}))}
          onChange={v => applyPreset(v)}
        />
        <HStack gap={1} wrap="wrap">
          <Button label="Randomize" size="sm" variant="primary" icon={<Icon icon={Shuffle} size={ICON} />} onClick={randomize} />
          <Button label="New noise" size="sm" variant="ghost" icon={<Icon icon={Dices} size={ICON} />} onClick={reseed} />
        </HStack>
        <Text type="supporting">Randomize makes a whole new gradient. New noise keeps everything and changes only the warp pattern.</Text>
      </InspectorSection>

      <InspectorSection title="Shape">
        <SegmentedControl label="Shape" size="sm" layout="fill" value={c.shape} onChange={v => setShape(v)}>
          {Object.entries(SHAPE_LABELS).map(([k, label]) => (
            <SegmentedControlItem key={k} value={k} label={label} />
          ))}
        </SegmentedControl>
        {mesh ? (
          <>
            <SliderRow label="Softness" value={c.softness} min={0} max={1} step={0.01} format={pct} onChange={v => set('softness', v)} />
            <MeshPoints />
          </>
        ) : (
          <>
            <SliderRow label="Width" value={c.size[0]} min={0.05} max={1.5} step={0.01} format={pct} onChange={v => setPair('size', 0, v)} />
            <SliderRow label={c.shape === 'band' ? 'Thickness' : 'Height'} value={c.size[1]} min={0.05} max={1.5} step={0.01} format={pct} onChange={v => setPair('size', 1, v)} />
            {c.shape !== 'band' ? <SliderRow label="Roundness" value={c.roundness} min={0} max={1} step={0.01} format={pct} onChange={v => set('roundness', v)} /> : null}
            <SliderRow label="Softness" value={c.softness} min={0} max={1} step={0.01} format={pct} onChange={v => set('softness', v)} />
            <SliderRow label="Rotation" value={c.rotation} min={-180} max={180} step={1} format={deg} onChange={v => set('rotation', v)} />
            <Text type="supporting">Drag the handle on the canvas to move the shape.</Text>
          </>
        )}
      </InspectorSection>

      {!mesh ? (
        <InspectorSection title="Colors">
          <InspectorRow label="Ramp">
            {c.palette.map((col, i) => (
              <Swatch key={i} label={`Color ${i + 1}`} value={asHex(col)} onChange={v => setStop(i, v)} />
            ))}
          </InspectorRow>
          <InspectorRow label="">
            {c.palette.length < MAX_STOPS ? <IconButton label="Add a color" tooltip="Add a color" size="sm" variant="ghost" icon={<Icon icon={Plus} size={ICON} />} onClick={addStop} /> : null}
            {c.palette.length > 2 ? <IconButton label="Remove the last color" tooltip="Remove the last color" size="sm" variant="ghost" icon={<Icon icon={Minus} size={ICON} />} onClick={() => removeStop(c.palette.length - 1)} /> : null}
            <IconButton label="Reverse the colors" tooltip="Reverse" size="sm" variant="ghost" icon={<Icon icon={ArrowLeftRight} size={ICON} />} onClick={reversePalette} />
          </InspectorRow>
          <InspectorRow label="Backdrop">
            <Swatch label="Backdrop" value={asHex(c.background)} onChange={v => set('background', v)} />
          </InspectorRow>
          <SliderRow label="Direction" value={c.ramp} min={0} max={1} step={0.01} format={v => (v < 0.05 ? 'From center' : v > 0.95 ? 'Linear' : pct(v))} onChange={v => set('ramp', v)} />
          {c.ramp > 0 ? <SliderRow label="Angle" value={c.angle} min={0} max={360} step={1} format={deg} onChange={v => set('angle', v)} /> : null}
          <Text type="supporting">Colors blend in Oklab, so the middles stay bright. The first color sits at the center of the shape, or at the start of the line.</Text>
        </InspectorSection>
      ) : null}

      <InspectorSection title="Warp">
        <SliderRow label="Amount" value={c.warp} min={0} max={1} step={0.01} format={pct} onChange={v => set('warp', v)} />
        <SliderRow label="Scale" value={c.warpScale} min={0.5} max={4} step={0.05} format={v => v.toFixed(2)} onChange={v => set('warpScale', v)} />
      </InspectorSection>

      <InspectorSection title="Motion">
        <SegmentedControl label="Motion" size="sm" layout="fill" value={c.motion} onChange={v => set('motion', v)}>
          {Object.entries(MOTION_LABELS).map(([k, label]) => (
            <SegmentedControlItem key={k} value={k} label={label} />
          ))}
        </SegmentedControl>
        {c.motion !== 'none' ? (
          <>
            <SliderRow label="Speed" value={c.speed} min={0} max={2} step={0.01} format={v => `${v.toFixed(2)}×`} onChange={v => set('speed', v)} />
            <Switch label="Seamless loop" size="sm" value={c.loop > 0} onChange={on => set('loop', on ? 8 : 0)} />
            {c.loop > 0 ? <SliderRow label="Length" value={c.loop} min={1} max={30} step={1} format={v => `${v} s`} onChange={v => set('loop', v)} /> : null}
          </>
        ) : null}
        <Text type="supporting">
          {c.motion === 'drift'
            ? 'The warp drifts slowly, like smoke.'
            : c.motion === 'breathe'
              ? 'The shape swells and settles.'
              : c.motion === 'flow'
                ? 'Colors slide through the shape, and mesh points circle.'
                : 'A still image. Grain stays fixed.'}
          {c.motion !== 'none' && c.loop > 0 ? ' The loop ends exactly where it began, so it repeats with no seam.' : ''}
        </Text>
      </InspectorSection>

      <InspectorSection title="Hover">
        <SliderRow label="Strength" value={c.hover} min={0} max={1} step={0.01} format={v => (v ? pct(v) : 'Off')} onChange={v => set('hover', v)} />
        {c.hover > 0 ? (
          <SegmentedControl label="Hover direction" size="sm" layout="fill" value={c.hoverMode} onChange={v => set('hoverMode', v)}>
            <SegmentedControlItem value="push" label="Push away" />
            <SegmentedControlItem value="pull" label="Pull in" />
          </SegmentedControl>
        ) : null}
        <Text type="supporting">The picture bends around the pointer on the stage, easing in and out. It's for live use, so exports leave it out.</Text>
      </InspectorSection>

      <InspectorSection title="Grain">
        <SliderRow label="Amount" value={c.grain} min={0} max={1} step={0.01} format={pct} onChange={v => set('grain', v)} />
        <Text type="supporting">Film grain hides banding, and is lighter in the shadows.</Text>
      </InspectorSection>

      <EffectSection />

      <ExportSection />

      <LooksSection />
    </>
  );
}

const EFFECT_LABELS: Record<string, string> = {none: 'None', pixelate: 'Pixelate', ascii: 'ASCII', glass: 'Ribbed glass', dither: 'Dither (DURANDAL)'};
const STYLE_OPTIONS = STYLES.map(st => ({value: st.id, label: `${st.name} · ${st.family === 'Pattern' ? 'pattern' : st.family === 'Scanline' ? 'scanline' : 'diffusion'}`}));

function EffectSection() {
  const {config: c} = useStore();
  const fx = c.effect;
  return (
    <InspectorSection title="Effect">
      <Selector label="Effect" isLabelHidden size="sm" width="100%" value={fx} options={Object.entries(EFFECT_LABELS).map(([value, label]) => ({value, label}))} onChange={v => set('effect', v)} />
      {fx !== 'none' ? (
        <SliderRow label={fx === 'glass' ? 'Rib width' : 'Cell size'} value={c.effectSize} min={2} max={64} step={1} format={v => `${v} px`} onChange={v => set('effectSize', v)} />
      ) : null}
      {fx === 'glass' ? <SliderRow label="Strength" value={c.effectAmount} min={0} max={1} step={0.01} format={pct} onChange={v => set('effectAmount', v)} /> : null}
      {fx === 'ascii' ? <SliderRow label="Contrast" value={c.effectAmount} min={0} max={1} step={0.01} format={pct} onChange={v => set('effectAmount', v)} /> : null}
      {fx === 'dither' ? (
        <>
          <InspectorRow label="Style">
            <Selector label="Dither style" isLabelHidden size="sm" width="100%" value={c.ditherStyle} options={STYLE_OPTIONS} onChange={v => set('ditherStyle', v)} />
          </InspectorRow>
          <SegmentedControl label="Dither colors" size="sm" layout="fill" value={c.ditherColors} onChange={v => set('ditherColors', v)}>
            <SegmentedControlItem value="gradient" label="Its colors" />
            <SegmentedControlItem value="two" label="Two tones" />
            <SegmentedControlItem value="cmyk" label="CMYK" />
          </SegmentedControl>
          {c.ditherColors !== 'cmyk' ? (
            <InspectorRow label="Colors">
              {(c.ditherColors === 'two' ? [gradientColors()[0], gradientColors().slice(-1)[0]] : gradientColors()).map((col, i) => (
                <PresetChip key={i} label="Dither color" color={col} isOn={false} />
              ))}
            </InspectorRow>
          ) : null}
        </>
      ) : null}
      <Text type="supporting">
        {fx === 'none'
          ? 'Pixelate, ASCII and glass are drawn here; Dither runs the frame through DURANDAL’s engine.'
          : fx === 'pixelate'
            ? 'One color per cell. Sizes are set for a 1080-pixel frame and scale with the export.'
            : fx === 'ascii'
              ? 'Characters whose density follows how far each cell stands out from the backdrop. Contrast thickens faint ones.'
              : fx === 'glass'
                ? 'Vertical ribs, each a small lens that flips what lies behind it.'
                : c.ditherColors === 'gradient'
                  ? 'Dithers to the gradient’s own colors: the ramp (or mesh points) and the backdrop. Pattern styles run on the GPU, diffusion styles on the CPU.'
                  : c.ditherColors === 'two'
                    ? 'Dithers to the darkest and lightest of the gradient’s colors.'
                    : 'Splits into cyan, magenta, yellow and black ink, each dithered on its own, on white.'}
      </Text>
    </InspectorSection>
  );
}

/**
 * A pixel count typed freely: it is checked and limited when you press Enter or
 * stop typing for a moment, so in-between values like "1" on the way to "1200"
 * aren't clamped as you type.
 */
function PixelsInput({label, value, onCommit}: {label: string; value: number; onCommit: (v: number) => void}) {
  const [draft, setDraft] = useState(String(value));
  const timer = useRef(0);
  useEffect(() => setDraft(String(value)), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (text: string) => {
    clearTimeout(timer.current);
    const n = parseInt(text, 10);
    if (isFinite(n)) onCommit(n); else setDraft(String(value));
  };
  return (
    <TextInput
      label={label}
      isLabelHidden
      size="sm"
      width="100%"
      value={draft}
      onChange={v => {
        const text = v.replace(/[^0-9]/g, '');
        setDraft(text);
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => commit(text), 900);
      }}
      onKeyDown={e => { if (e.key === 'Enter') commit(draft); }}
    />
  );
}

function ExportSection() {
  const s = useStore();
  const o = s.out, {w, h} = outSize(), plan = videoPlan();
  const num = (v: string, d: number) => { const n = parseInt(v, 10); return isFinite(n) ? Math.min(MAX_SIDE, Math.max(16, n)) : d; };
  const moving = s.config.motion !== 'none';
  return (
    <InspectorSection title="Export">
      <InspectorRow label="Size">
        <Selector label="Export size" isLabelHidden size="sm" width="100%" value={o.size} options={SIZES.map(z => ({value: z.id, label: z.label}))} onChange={v => setOut({size: v})} />
      </InspectorRow>
      {o.size === 'custom' ? (
        <InspectorRow label="Pixels">
          <StackItem size="fill">
            <PixelsInput label="Width in pixels" value={o.w} onCommit={v => setOut({w: num(String(v), o.w)})} />
          </StackItem>
          <Text type="supporting">×</Text>
          <StackItem size="fill">
            <PixelsInput label="Height in pixels" value={o.h} onCommit={v => setOut({h: num(String(v), o.h)})} />
          </StackItem>
        </InspectorRow>
      ) : null}
      <HStack gap={1} wrap="wrap">
        <Button label="Save PNG" size="sm" variant="primary" icon={<Icon icon={Download} size={ICON} />} isDisabled={s.exporting} onClick={exportPNG} />
      </HStack>
      <Text type="supporting" hasTabularNumbers>{`${w} × ${h} px, the frame on screen now. Up to ${MAX_SIDE} px on a side.`}</Text>

      {moving ? (
        <>
          <InspectorRow label="Frame rate">
            <SegmentedControl label="Frame rate" size="sm" layout="fill" value={String(o.fps)} onChange={v => setOut({fps: Number(v)})}>
              {['24', '30', '60'].map(f => (
                <SegmentedControlItem key={f} value={f} label={f} />
              ))}
            </SegmentedControl>
          </InspectorRow>
          {plan.loop ? (
            <SliderRow label="Loops" value={o.loops} min={1} max={10} step={1} format={v => `${v} × ${plan.loop} s`} onChange={v => setOut({loops: v})} />
          ) : (
            <SliderRow label="Length" value={o.seconds} min={1} max={30} step={1} format={v => `${v} s`} onChange={v => setOut({seconds: v})} />
          )}
          <HStack gap={1} wrap="wrap">
            <Button
              label={s.exporting ? 'Cancel render' : 'Render MP4'}
              size="sm"
              variant={s.exporting ? 'destructive' : 'primary'}
              icon={<Icon icon={Clapperboard} size={ICON} />}
              isDisabled={!canEncodeVideo()}
              tooltip={canEncodeVideo() ? undefined : 'This browser cannot encode video. Use Chrome or Edge.'}
              onClick={s.exporting ? cancelVideo : exportMP4}
            />
          </HStack>
          <Text type="supporting" hasTabularNumbers>
            {s.progress ||
              `${plan.seconds} s at ${o.fps} fps: ${plan.frames} frames at ${Math.floor(w / 2) * 2} × ${Math.floor(h / 2) * 2}. ` +
                (plan.loop
                  ? 'It starts at the beginning of the loop and ends where it began, so it repeats with no seam.'
                  : 'Turn on Seamless loop under Motion for a video that repeats with no seam.')}
          </Text>
        </>
      ) : null}

      {canSendToDurandal() ? (
        <>
          <InspectorRow label="Send to">
            <Button label="Frame" size="sm" variant="ghost" icon={<Icon icon={ImageIcon} size={ICON} />} isDisabled={s.exporting} onClick={() => sendToDurandal('image')} />
            {moving ? (
              <Button label="Animation" size="sm" variant="ghost" icon={<Icon icon={Send} size={ICON} />} isDisabled={s.exporting || !canEncodeVideo()} onClick={() => sendToDurandal('video')} />
            ) : null}
          </InspectorRow>
          <Text type="supporting">Sends this frame or animation to DURANDAL, which opens in a new tab with it as the source, ready to dither.</Text>
        </>
      ) : null}
    </InspectorSection>
  );
}

function MeshPoints() {
  const {config: c} = useStore();
  return (
    <>
      <List density="compact">
        {c.mesh.map((p, i) => (
          <ListItem
            key={i}
            label={`Point ${i + 1}`}
            description={`${pct(p.x)} across, ${pct(p.y)} down`}
            startContent={<Swatch label={`Point ${i + 1} color`} value={asHex(p.color)} onChange={v => setPoint(i, {color: v})} />}
            endContent={
              c.mesh.length > 2 ? (
                <IconButton label={`Remove point ${i + 1}`} tooltip="Remove" size="sm" variant="ghost" icon={<Icon icon={Trash2} size={ICON} />} onClick={() => removePoint(i)} />
              ) : null
            }
          />
        ))}
      </List>
      <HStack gap={1}>
        <Button label="Add a point" size="sm" variant="secondary" icon={<Icon icon={Plus} size={ICON} />} isDisabled={c.mesh.length >= MAX_POINTS} onClick={addPoint} />
      </HStack>
      <Text type="supporting">Drag the points on the canvas. Each one pulls the color toward its own; Softness sets how far.</Text>
    </>
  );
}

const openProjectFile = async () => { const [f] = await pickFiles('.json,application/json'); openProject(f); };

function LooksSection() {
  const {looks} = useStore();
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
          {looks.map(l => (
            <ListItem
              key={l.name}
              label={l.name}
              description={`${SHAPE_LABELS[l.config.shape] ?? l.config.shape} · ${MOTION_LABELS[l.config.motion] ?? l.config.motion}${l.config.loop ? ` · ${l.config.loop} s loop` : ''}`}
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
        <Text type="supporting">Save a gradient under a name to come back to it. Looks stay in this browser.</Text>
      )}
      <HStack gap={1} wrap="wrap">
        <Button label="Copy link" size="sm" variant="ghost" icon={<Icon icon={Link} size={ICON} />} onClick={copyLink} />
        <Button label="Save project" size="sm" variant="ghost" icon={<Icon icon={Download} size={ICON} />} onClick={saveProject} />
        <Button label="Open project" size="sm" variant="ghost" icon={<Icon icon={FolderOpen} size={ICON} />} onClick={openProjectFile} />
      </HStack>
      <Text type="supporting">A link or a project file holds the whole gradient, to share or keep. You can also drop a project file on the page.</Text>
    </InspectorSection>
  );
}
