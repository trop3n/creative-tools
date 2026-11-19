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
  ArrowLeftRight, Check, Dices, Download, FolderOpen, Link, Minus, Move, Pause, Play, Plus, RotateCcw, Save, Shuffle, Trash2,
} from 'lucide-react';
import {pickFiles} from '@studio/core';
import {PRESETS, MAX_STOPS, MAX_POINTS} from '@studio/core/gradient';
import {
  useStore, attachCanvas, applyPreset, randomize, reseed, togglePlay, restart, toggleHandles, set, setPair, setShape, asHex,
  setStop, addStop, removeStop, reversePalette, setPoint, addPoint, removePoint, pointerDown, pointerMove, pointerUp,
  saveLook, applyLook, deleteLook, saveProject, openProject, copyLink,
} from '../engine/live.js';
import {ICON, InspectorRow, InspectorSection, SliderRow, Swatch} from './parts';

const styles = stylex.create({
  frame: {position: 'relative', width: '100%', height: '100%'},
  canvas: {display: 'block', width: '100%', height: '100%', borderRadius: 'var(--radius-container)', boxShadow: 'var(--shadow-med)', touchAction: 'none'},
  meshCursor: {cursor: 'crosshair'},
  overlay: {position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible'},
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
        {...stylex.props(styles.canvas, mesh && styles.meshCursor)}
      />
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

      <InspectorSection title="Grain">
        <SliderRow label="Amount" value={c.grain} min={0} max={1} step={0.01} format={pct} onChange={v => set('grain', v)} />
        <Text type="supporting">Film grain hides banding, and is lighter in the shadows.</Text>
      </InspectorSection>

      <LooksSection />
    </>
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
