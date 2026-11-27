// TYCHO's panels: the stage, its tool bar, and the inspector.
import {useEffect, useRef, useState} from 'react';
import * as stylex from '@stylexjs/stylex';
import {Button} from '@astryxdesign/core/Button';
import {Center} from '@astryxdesign/core/Center';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {HStack, StackItem} from '@astryxdesign/core/Layout';
import {List, ListItem} from '@astryxdesign/core/List';
import {ProgressBar} from '@astryxdesign/core/ProgressBar';
import {Selector} from '@astryxdesign/core/Selector';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {ToggleButton} from '@astryxdesign/core/ToggleButton';
import {Toolbar} from '@astryxdesign/core/Toolbar';
import {
  Check, Dices, Download, Drum, FileCode, Film, FolderOpen, Image, LayoutGrid, Link, Minus, Pause, Play, Plus, RotateCcw, Save, Shapes, Shuffle,
  SkipForward, Trash2, X,
} from 'lucide-react';
import {pickFiles} from '@studio/core';
import {SHAPES, SHAPE_IDS, MOTIONS, MOTION_IDS, timing} from '../engine/modules.js';
import {PRESETS, PALETTES, ASPECTS, MAX_COLORS, SHUFFLE_MODES, BEAT_CHOICES} from '../engine/config.js';
import {
  useStore, attachCanvas, applyPreset, randomize, newLayout, newModules, togglePlay, restart, nextCut, set, toggleIn,
  applyPalette, setColor, addColor, removeColor, applySuitePalette, tapTempo, loopSeconds,
  exportPNG, stillBlob, exportSVG, exportMP4, cancelMP4, videoSupported, videoSeconds, setExportSize, setExportLoops,
  saveLook, applyLook, deleteLook, saveProject, openProject, copyLink, toast,
} from '../engine/live.js';
import {CUSTOM, fixedSize, fixedSizeLabel, frameIds, frameLabel} from '@studio/core/frames';
import {ICON, InspectorRow, InspectorSection, SliderRow, Swatch, CustomSizeRow} from './parts';
import {SendToRow, SuitePaletteRow} from './suite';

const styles = stylex.create({
  frame: {position: 'relative', width: '100%', height: '100%'},
  canvas: {display: 'block', borderRadius: 'var(--radius-container)', boxShadow: 'var(--shadow-med)'},
});

const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `${v.toFixed(2)}×`;
const beats = (n: number) => (n === 1 ? '1 beat' : `${n} beats`);
const secs = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} s`;

/* ================= stage ================= */
export function Stage() {
  const ref = useRef<HTMLCanvasElement>(null);
  const s = useStore();
  useEffect(() => { attachCanvas(ref.current); return () => attachCanvas(null); }, []);
  if (!s.supported) {
    return (
      <Center height="100%">
        <Text type="supporting">This browser can't draw to a canvas, which TYCHO needs.</Text>
      </Center>
    );
  }
  return (
    <Center xstyle={styles.frame}>
      <canvas ref={ref} role="img" aria-label="A grid of looping geometric pattern tiles" {...stylex.props(styles.canvas)} />
    </Center>
  );
}

export function StageToolbar() {
  const s = useStore();
  const {cut} = timing(s.config);
  return (
    <Toolbar
      label="Playback"
      size="sm"
      startContent={
        <>
          <IconButton label={s.playing ? 'Pause' : 'Play'} tooltip={s.playing ? 'Pause' : 'Play'} size="sm" variant="ghost" icon={<Icon icon={s.playing ? Pause : Play} size={ICON} />} onClick={togglePlay} />
          <IconButton label="Back to the start" tooltip="Back to the start" size="sm" variant="ghost" icon={<Icon icon={RotateCcw} size={ICON} />} onClick={restart} />
          <IconButton label={cut ? 'Jump to the next cut' : 'New modules'} tooltip={cut ? 'Next cut' : 'New modules'} size="sm" variant="ghost" icon={<Icon icon={SkipForward} size={ICON} />} onClick={nextCut} />
          <Text type="supporting" hasTabularNumbers maxLines={1}>
            {`${s.time.toFixed(1)} / ${secs(loopSeconds())}`}
          </Text>
          <IconButton label="New layout" tooltip="New layout" size="sm" variant="ghost" icon={<Icon icon={LayoutGrid} size={ICON} />} onClick={newLayout} />
          <IconButton label="New modules" tooltip="New modules" size="sm" variant="ghost" icon={<Icon icon={Shapes} size={ICON} />} onClick={newModules} />
        </>
      }
    />
  );
}

/* ================= inspector ================= */
export function Inspector() {
  const s = useStore();
  const c = s.config;
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
          <Button label="New layout" size="sm" variant="ghost" icon={<Icon icon={LayoutGrid} size={ICON} />} onClick={newLayout} />
          <Button label="New modules" size="sm" variant="ghost" icon={<Icon icon={Dices} size={ICON} />} onClick={newModules} />
        </HStack>
        <Text type="supporting">Randomize changes everything. New layout re-cuts the grid and keeps your module settings. New modules refills the same cells.</Text>
      </InspectorSection>

      <InspectorSection title="Layout">
        <InspectorRow label="Frame">
          <Selector
            label="Frame shape"
            isLabelHidden
            size="sm"
            width="100%"
            value={c.aspect}
            options={frameIds(ASPECTS).map(k => ({value: k, label: frameLabel(k)}))}
            onChange={v => set('aspect', v)}
          />
        </InspectorRow>
        {c.aspect === CUSTOM.id ? <CustomSizeRow w={c.customW} h={c.customH} onChange={set} /> : null}
        <SliderRow label="Grid" value={c.grid} min={2} max={10} step={1} format={v => `${v} units`} onChange={v => set('grid', v)} />
        <SliderRow label="Splits" value={c.depth} min={1} max={8} step={1} onChange={v => set('depth', v)} />
        <SliderRow label="Big cells" value={c.hold} min={0} max={0.8} step={0.01} format={pct} onChange={v => set('hold', v)} />
        <SliderRow label="Smallest" value={c.minCell} min={1} max={4} step={1} format={v => (v === 1 ? '1 unit' : `${v} units`)} onChange={v => set('minCell', v)} />
        <SliderRow label="Gutter" value={c.gutter} min={0} max={0.3} step={0.01} format={v => (v < 0.005 ? 'Off' : pct(v))} onChange={v => set('gutter', v)} />
        {c.gutter > 0 ? (
          <InspectorRow label="Gutter color">
            <Swatch label="Gutter color" value={c.gutterColor} onChange={v => set('gutterColor', v)} />
          </InspectorRow>
        ) : null}
        <Text type="supporting">Grid is how many units fit the frame's short side. Splits and Big cells decide how finely the frame is cut.</Text>
      </InspectorSection>

      <InspectorSection title="Modules">
        <SliderRow label="Layers" value={c.layers} min={1} max={3} step={1} format={v => `Up to ${v}`} onChange={v => set('layers', v)} />
        <SliderRow label="Colors" value={c.perModule} min={2} max={4} step={1} format={v => `${v} each`} onChange={v => set('perModule', v)} />
        <SliderRow label="Pattern" value={c.scale} min={0.5} max={2} step={0.05} format={times} onChange={v => set('scale', v)} />
        <Text type="label" color="secondary">Shapes</Text>
        <HStack gap={1} wrap="wrap">
          {SHAPE_IDS.map(id => (
            <ToggleButton key={id} label={SHAPES[id]} size="sm" isPressed={c.shapes.includes(id)} onPressedChange={on => toggleIn('shapes', id, on, 'Keep at least one shape')} />
          ))}
        </HStack>
        <Text type="label" color="secondary">Motions</Text>
        <HStack gap={1} wrap="wrap">
          {MOTION_IDS.map(id => (
            <ToggleButton key={id} label={MOTIONS[id]} size="sm" isPressed={c.motions.includes(id)} onPressedChange={on => toggleIn('motions', id, on, '')} />
          ))}
        </HStack>
        <Text type="supporting">Each cell stacks up to {c.layers} {c.layers === 1 ? 'layer' : 'layers'} of one shape, arranged as a grid, stripes, rays, rings or one big shape. Turn every motion off for a still poster.</Text>
      </InspectorSection>

      <ColorsSection />
      <TimingSection />
      <ExportSection />
      <LooksSection />
    </>
  );
}

function ColorsSection() {
  const {config: c} = useStore();
  return (
    <InspectorSection title="Colors">
      <InspectorRow label="Palette">
        <Selector
          label="Palette"
          isLabelHidden
          size="sm"
          width="100%"
          placeholder="Custom"
          value={c.palette}
          options={PALETTES.map(p => ({value: p.id, label: p.name}))}
          onChange={v => applyPalette(v)}
        />
      </InspectorRow>
      <HStack gap={1} wrap="wrap">
        {c.colors.map((col, i) => (
          <Swatch key={i} label={`Color ${i + 1}`} value={col} onChange={v => setColor(i, v)} />
        ))}
        {c.colors.length < MAX_COLORS ? <IconButton label="Add a color" tooltip="Add a color" size="sm" variant="ghost" icon={<Icon icon={Plus} size={ICON} />} onClick={addColor} /> : null}
        {c.colors.length > 2 ? <IconButton label="Remove the last color" tooltip="Remove the last color" size="sm" variant="ghost" icon={<Icon icon={Minus} size={ICON} />} onClick={() => removeColor(c.colors.length - 1)} /> : null}
      </HStack>
      <SuitePaletteRow colors={c.colors} onUse={applySuitePalette} onSaved={n => toast(`Saved "${n}" to the suite palettes`)} />
      <Text type="supporting">Each module picks {c.perModule} of these {c.colors.length} colors: a background, then colors that stand out from it. Neighboring cells never share a background when the palette allows.</Text>
    </InspectorSection>
  );
}

function TimingSection() {
  const {config: c} = useStore();
  const [tapped, setTapped] = useState(0);
  const t = timing(c);
  return (
    <InspectorSection title="Timing">
      <InspectorRow label="Tempo">
        <StackItem size="fill">
          <Text type="body" hasTabularNumbers>{`${Math.round(c.bpm)} BPM`}</Text>
        </StackItem>
        <Button label={tapped ? `Tap (${tapped})` : 'Tap'} size="sm" variant="secondary" icon={<Icon icon={Drum} size={ICON} />} onClick={() => setTapped(tapTempo())} />
      </InspectorRow>
      <SliderRow label="BPM" value={c.bpm} min={40} max={200} step={1} onChange={v => set('bpm', v)} />
      <InspectorRow label="Motion">
        <Selector
          label="Motion loop length"
          isLabelHidden
          size="sm"
          width="100%"
          value={String(c.motionBeats)}
          options={BEAT_CHOICES.map(n => ({value: String(n), label: `Loops every ${beats(n)}`}))}
          onChange={v => set('motionBeats', Number(v))}
        />
      </InspectorRow>
      <InspectorRow label="Cut">
        <Selector
          label="Cut every"
          isLabelHidden
          size="sm"
          width="100%"
          value={String(c.shuffleBeats)}
          options={[{value: '0', label: 'Never'}, ...BEAT_CHOICES.map(n => ({value: String(n), label: `Every ${beats(n)}`}))]}
          onChange={v => set('shuffleBeats', Number(v))}
        />
      </InspectorRow>
      {c.shuffleBeats > 0 ? (
        <>
          <InspectorRow label="Cuts">
            <Selector
              label="What a cut changes"
              isLabelHidden
              size="sm"
              width="100%"
              value={c.shuffleMode}
              options={Object.entries(SHUFFLE_MODES).map(([value, label]) => ({value, label}))}
              onChange={v => set('shuffleMode', v)}
            />
          </InspectorRow>
          <SliderRow label="Repeat after" value={c.rounds} min={1} max={16} step={1} format={v => (v === 1 ? '1 cut' : `${v} cuts`)} onChange={v => set('rounds', v)} />
        </>
      ) : null}
      <Text type="supporting">
        {c.shuffleBeats > 0
          ? `Motions loop every ${secs(t.motion)}, and the grid cuts to a new arrangement every ${secs(t.cut)}. The whole sequence repeats every ${secs(t.loop)}.`
          : `Motions loop every ${secs(t.motion)}, with no cuts.`}
        {' '}Tap along to music to set the tempo.
      </Text>
    </InspectorSection>
  );
}

function ExportSection() {
  const s = useStore();
  const canVideo = videoSupported();
  return (
    <InspectorSection title="Export">
      <InspectorRow label="Size">
        {fixedSize(s.config.aspect, [s.config.customW, s.config.customH]) ? (
          <Text type="body">{fixedSizeLabel(s.config.aspect, [s.config.customW, s.config.customH])}</Text>
        ) : (
          <Selector
            label="Export size"
            isLabelHidden
            size="sm"
            width="100%"
            value={String(s.exportSize)}
            options={[1080, 1920, 2560, 3840].map(v => ({value: String(v), label: `${v} px long side`}))}
            onChange={v => setExportSize(Number(v))}
          />
        )}
      </InspectorRow>
      <SliderRow label="Video" value={s.exportLoops} min={1} max={8} step={1} format={v => `${v} × ${secs(loopSeconds())}`} onChange={setExportLoops} />
      {s.exporting ? (
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <ProgressBar label="Rendering video" value={s.exporting.done} max={s.exporting.total} hasValueLabel formatValueLabel={(v, m) => `${v} / ${m} frames`} />
          </StackItem>
          <IconButton label="Cancel the video" tooltip="Cancel" size="sm" variant="ghost" icon={<Icon icon={X} size={ICON} />} onClick={cancelMP4} />
        </HStack>
      ) : (
        <HStack gap={1} wrap="wrap">
          <Button label="Save PNG" size="sm" variant="secondary" icon={<Icon icon={Image} size={ICON} />} onClick={exportPNG} />
          <Button label="Save SVG" size="sm" variant="secondary" icon={<Icon icon={FileCode} size={ICON} />} onClick={exportSVG} />
          <Button label="Render MP4" size="sm" variant="secondary" icon={<Icon icon={Film} size={ICON} />} isDisabled={!canVideo} onClick={exportMP4} />
        </HStack>
      )}
      <SendToRow make={stillBlob} isDisabled={!!s.exporting} onError={msg => toast(msg, 'error')} />
      <Text type="supporting">
        {canVideo
          ? `PNG and SVG save the frame on screen. The MP4 renders ${secs(videoSeconds())} at 30 fps from the start, and loops seamlessly.`
          : 'PNG and SVG save the frame on screen. Video export needs Chrome or Edge.'}
      </Text>
    </InspectorSection>
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
              description={`${PALETTES.find(p => p.id === l.config.palette)?.name ?? 'Custom colors'}, ${Math.round(l.config.bpm)} BPM`}
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
        <Text type="supporting">Save a look under a name to come back to it. Looks stay in this browser.</Text>
      )}
      <HStack gap={1} wrap="wrap">
        <Button label="Copy link" size="sm" variant="ghost" icon={<Icon icon={Link} size={ICON} />} onClick={copyLink} />
        <Button label="Save project" size="sm" variant="ghost" icon={<Icon icon={Download} size={ICON} />} onClick={saveProject} />
        <Button label="Open project" size="sm" variant="ghost" icon={<Icon icon={FolderOpen} size={ICON} />} onClick={openProjectFile} />
      </HStack>
      <Text type="supporting">A link or a project file holds the whole look, to share or keep. You can also drop a project file on the page.</Text>
    </InspectorSection>
  );
}
