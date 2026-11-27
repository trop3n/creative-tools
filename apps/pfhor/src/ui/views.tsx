// PFHOR's panels: the stage, its tool bar, and the inspector.
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
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Toolbar} from '@astryxdesign/core/Toolbar';
import {
  ArrowLeftRight, Camera, Check, Download, FileCode, Film, FolderOpen, Image, ImagePlus, Link, Minus, Pause, Play, Plus, RotateCcw, Save, Shuffle, Trash2, X,
} from 'lucide-react';
import {pickFiles} from '@studio/core';
import {SHAPES, METRICS, MAPPINGS} from '../engine/mosaic.js';
import {SAMPLES} from '../engine/samples.js';
import {PRESETS, PALETTES, ASPECTS, MAX_COLORS} from '../engine/config.js';
import {
  useStore, attachCanvas, applyPreset, randomize, togglePlay, restart, set, applyPalette, setColor, addColor, removeColor, reverseColors,
  pickSample, openMedia, startCamera, startLive, exportPNG, exportSVG, exportMP4, cancelMP4, videoSupported, videoSeconds, setExportSize, setExportLoops,
  setMatchVideo, saveLook, applyLook, deleteLook, saveProject, openFile, copyLink, stillBlob, applySuiteColors, toast,
} from '../engine/live.js';
import {CUSTOM, fixedSize, fixedSizeLabel, frameIds, frameLabel} from '@studio/core/frames';
import {ICON, InspectorRow, InspectorSection, SliderRow, Swatch, CustomSizeRow} from './parts';
import {RecentFromSuite, SendToRow, SuitePaletteRow, LiveFromSuite} from './suite';

const styles = stylex.create({
  frame: {position: 'relative', width: '100%', height: '100%'},
  canvas: {display: 'block', borderRadius: 'var(--radius-container)', boxShadow: 'var(--shadow-med)'},
});

const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `${v.toFixed(2)}×`;
const secs = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} s`;
const opts = (o: Record<string, string>) => Object.entries(o).map(([value, label]) => ({value, label}));

/* ================= stage ================= */
export function Stage() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { attachCanvas(ref.current); return () => attachCanvas(null); }, []);
  return (
    <Center xstyle={styles.frame}>
      <canvas ref={ref} role="img" aria-label="The picture as a mosaic of shapes, big where it is flat and small where it is detailed" {...stylex.props(styles.canvas)} />
    </Center>
  );
}

export function StageToolbar() {
  const s = useStore();
  const moving = s.config.resolve > 0 || s.config.scatter > 0;
  return (
    <Toolbar
      label="Playback"
      size="sm"
      startContent={
        <>
          <IconButton label={s.playing ? 'Pause' : 'Play'} tooltip={s.playing ? 'Pause' : 'Play'} size="sm" variant="ghost" icon={<Icon icon={s.playing ? Pause : Play} size={ICON} />} onClick={togglePlay} />
          <IconButton label="Back to the start" tooltip="Back to the start" size="sm" variant="ghost" icon={<Icon icon={RotateCcw} size={ICON} />} onClick={restart} />
          <Text type="supporting" hasTabularNumbers maxLines={1}>
            {moving ? `${s.time.toFixed(1)} / ${secs(s.config.loop)} · ` : ''}{`${s.cells.toLocaleString()} cells`}
          </Text>
          <IconButton label="Randomize" tooltip="Randomize" size="sm" variant="ghost" icon={<Icon icon={Shuffle} size={ICON} />} onClick={randomize} />
        </>
      }
    />
  );
}

/* ================= inspector ================= */
export function Inspector() {
  const s = useStore();
  return (
    <>
      <InspectorSection title="Start from">
        <Selector label="Preset" isLabelHidden size="sm" width="100%" placeholder="Choose a preset" value={s.preset} options={PRESETS.map(p => ({value: p.id, label: p.name}))} onChange={v => applyPreset(v)} />
        <HStack gap={1} wrap="wrap">
          <Button label="Randomize" size="sm" variant="primary" icon={<Icon icon={Shuffle} size={ICON} />} onClick={randomize} />
        </HStack>
        <Text type="supporting">Presets and Randomize change the look and keep your picture.</Text>
      </InspectorSection>
      <SourceSection />
      <DetailSection />
      <ShapeSection />
      <ColorsSection />
      <MotionSection />
      <ExportSection />
      <LooksSection />
    </>
  );
}

function SourceSection() {
  const s = useStore();
  const c = s.config, m = s.media;
  const pick = async () => { const [f] = await pickFiles('image/*,video/*'); openMedia(f); };
  return (
    <InspectorSection title="Picture">
      <InspectorRow label="Sample">
        <Selector label="Sample picture" isLabelHidden size="sm" width="100%" placeholder="Your picture" value={m ? '' : c.sample} options={opts(SAMPLES)} onChange={v => pickSample(v)} />
      </InspectorRow>
      <HStack gap={1} wrap="wrap">
        <Button label={m ? 'Replace' : 'Open image or video'} size="sm" variant="secondary" icon={<Icon icon={ImagePlus} size={ICON} />} isDisabled={s.mediaBusy} onClick={pick} />
        <Button label="Webcam" size="sm" variant="ghost" icon={<Icon icon={Camera} size={ICON} />} isDisabled={s.mediaBusy} onClick={startCamera} />
      </HStack>
      <LiveFromSuite onPick={startLive} isDisabled={!!s.exporting || s.mediaBusy} />
      <RecentFromSuite onOpen={openMedia} />
      {m ? <Text type="supporting" maxLines={1}>{m.label}</Text> : null}
      {m?.kind === 'camera' && !m.live ? <Switch label="Mirror the webcam" size="sm" value={c.mirror} onChange={v => set('mirror', v)} /> : null}
      <SliderRow label="Contrast" value={c.contrast} min={0.5} max={2.5} step={0.01} format={times} onChange={v => set('contrast', v)} />
      <SliderRow label="Brightness" value={c.brightness} min={-0.4} max={0.4} step={0.01} format={v => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`} onChange={v => set('brightness', v)} />
      <Text type="supporting">Faces and close-ups work best. You can also drop an image or video on the page.</Text>
    </InspectorSection>
  );
}

function DetailSection() {
  const {config: c} = useStore();
  return (
    <InspectorSection title="Detail">
      <SliderRow label="Threshold" value={c.threshold} min={0.01} max={0.5} step={0.005} format={v => v.toFixed(3)} onChange={v => set('threshold', v)} />
      <InspectorRow label="Split on">
        <Selector label="Split on" isLabelHidden size="sm" width="100%" value={c.metric} options={opts(METRICS)} onChange={v => set('metric', v)} />
      </InspectorRow>
      <SliderRow label="Largest" value={c.roots} min={1} max={8} step={1} format={v => (v === 1 ? '1 across' : `${v} across`)} onChange={v => set('roots', v)} />
      <SliderRow label="Depth" value={c.maxDepth} min={1} max={8} step={1} format={v => `${v} levels`} onChange={v => set('maxDepth', v)} />
      <SliderRow label="Smallest" value={c.minSize} min={2} max={32} step={1} format={v => `${v} px`} onChange={v => set('minSize', v)} />
      <SliderRow label="Resolution" value={c.detail} min={128} max={640} step={32} format={v => `${v} px`} onChange={v => set('detail', v)} />
      <Text type="supporting">A cell splits in four when its detail is over the threshold: lower it for more, smaller cells. Largest sets how many big cells span the short side; Smallest and Resolution are measured on the analysis image.</Text>
    </InspectorSection>
  );
}

function ShapeSection() {
  const s = useStore(), c = s.config, glyphs = c.shape === 'glyph';
  return (
    <InspectorSection title="Shapes">
      <InspectorRow label="Shape">
        <Selector label="Shape" isLabelHidden size="sm" width="100%" value={c.shape} options={opts(SHAPES)} onChange={v => set('shape', v)} />
      </InspectorRow>
      {c.shape === 'circle' || c.shape === 'mixed' ? <SliderRow label="Circle size" value={c.fill} min={0.4} max={1} step={0.01} format={pct} onChange={v => set('fill', v)} /> : null}
      {glyphs && !s.glyphCount ? <Text type="supporting">Open GLYF and put glyphs in its set. Until then, the cells are squares.</Text> : null}
      {c.shape !== 'circle' ? <SliderRow label="Gap" value={c.gap} min={0} max={0.4} step={0.01} format={pct} onChange={v => set('gap', v)} /> : null}
      {glyphs ? null : <SliderRow label="Outline" value={c.stroke} min={0} max={6} step={0.25} format={v => (v === 0 ? 'Off' : `${v} px`)} onChange={v => set('stroke', v)} />}
      <InspectorRow label="Colors">
        {c.stroke > 0 && !glyphs ? <Swatch label="Outline color" value={c.strokeColor} onChange={v => set('strokeColor', v)} /> : null}
        <Swatch label="Background" value={c.background} onChange={v => set('background', v)} />
      </InspectorRow>
      <Text type="supporting">{glyphs ? 'Each cell is a glyph from GLYF in its color: the stronger the tone against the background, the more ink in the glyph.' : 'Outline width is for a 1080 px frame and scales with the export.'}</Text>
    </InspectorSection>
  );
}

function ColorsSection() {
  const {config: c} = useStore();
  return (
    <InspectorSection title="Palette">
      <InspectorRow label="Palette">
        <Selector label="Palette" isLabelHidden size="sm" width="100%" placeholder="Custom" value={c.palette} options={PALETTES.map(p => ({value: p.id, label: p.name}))} onChange={v => applyPalette(v)} />
      </InspectorRow>
      <HStack gap={1} wrap="wrap">
        {c.colors.map((col, i) => <Swatch key={i} label={`Color ${i + 1}`} value={col} onChange={v => setColor(i, v)} />)}
        {c.colors.length < MAX_COLORS ? <IconButton label="Add a color" tooltip="Add a color" size="sm" variant="ghost" icon={<Icon icon={Plus} size={ICON} />} onClick={addColor} /> : null}
        {c.colors.length > 2 ? <IconButton label="Remove the last color" tooltip="Remove the last color" size="sm" variant="ghost" icon={<Icon icon={Minus} size={ICON} />} onClick={removeColor} /> : null}
        <IconButton label="Reverse the colors" tooltip="Reverse" size="sm" variant="ghost" icon={<Icon icon={ArrowLeftRight} size={ICON} />} onClick={reverseColors} />
      </HStack>
      <SuitePaletteRow colors={c.colors} onUse={applySuiteColors} onSaved={n => toast(`Saved "${n}" to the suite palettes`)} />
      <InspectorRow label="Mapping">
        <Selector label="Color mapping" isLabelHidden size="sm" width="100%" value={c.mapping} options={opts(MAPPINGS)} onChange={v => set('mapping', v)} />
      </InspectorRow>
      {c.mapping === 'ramp' ? (
        <InspectorRow label="Order">
          <Selector label="Ramp order" isLabelHidden size="sm" width="100%" value={c.order} options={[{value: 'light', label: 'Dark to light'}, {value: 'listed', label: 'As listed'}]} onChange={v => set('order', v)} />
        </InspectorRow>
      ) : null}
      <Text type="supporting">
        {c.mapping === 'ramp'
          ? 'Each cell takes the color at its lightness along the palette, so skin and shadow can land on any hue. Use As listed and Reverse to choose the order yourself.'
          : 'Each cell takes the palette color closest to its own, in Oklab.'}
      </Text>
    </InspectorSection>
  );
}

function MotionSection() {
  const {config: c} = useStore();
  return (
    <InspectorSection title="Motion">
      <SliderRow label="Resolve" value={c.resolve} min={0} max={1} step={0.01} format={v => (v < 0.005 ? 'Off' : pct(v))} onChange={v => set('resolve', v)} />
      <SliderRow label="Scatter" value={c.scatter} min={0} max={1} step={0.01} format={v => (v < 0.005 ? 'Off' : pct(v))} onChange={v => set('scatter', v)} />
      {c.resolve > 0 || c.scatter > 0 ? <SliderRow label="Loop" value={c.loop} min={2} max={30} step={0.5} format={secs} onChange={v => set('loop', v)} /> : null}
      <InspectorRow label="Frame">
        <Selector label="Frame shape" isLabelHidden size="sm" width="100%" value={c.aspect} options={frameIds(ASPECTS).map(k => ({value: k, label: frameLabel(k)}))} onChange={v => set('aspect', v)} />
      </InspectorRow>
      {c.aspect === CUSTOM.id ? <CustomSizeRow w={c.customW} h={c.customH} onChange={set} /> : null}
      <Text type="supporting">Resolve coarsens the mosaic toward mid-loop and sharpens it again. Scatter flings the cells apart mid-loop and lands them back home. Both loop seamlessly.</Text>
    </InspectorSection>
  );
}

function ExportSection() {
  const s = useStore();
  const canVideo = videoSupported();
  const isVideo = s.media?.kind === 'video';
  const moving = s.config.resolve > 0 || s.config.scatter > 0;
  return (
    <InspectorSection title="Export">
      <InspectorRow label="Size">
        {fixedSize(s.config.aspect, [s.config.customW, s.config.customH]) ? (
          <Text type="body">{fixedSizeLabel(s.config.aspect, [s.config.customW, s.config.customH])}</Text>
        ) : (
          <Selector label="Export size" isLabelHidden size="sm" width="100%" value={String(s.exportSize)} options={[1080, 1440, 2160, 3840].map(v => ({value: String(v), label: `${v} px long side`}))} onChange={v => setExportSize(Number(v))} />
        )}
      </InspectorRow>
      {isVideo ? <Switch label="Match the video's length" size="sm" value={s.matchVideo} onChange={setMatchVideo} /> : null}
      {!isVideo || !s.matchVideo ? <SliderRow label="Video" value={s.exportLoops} min={1} max={8} step={1} format={v => `${v} × ${secs(s.config.loop)}`} onChange={setExportLoops} /> : null}
      {s.exporting ? (
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <ProgressBar label="Rendering video" value={s.exporting.done} max={s.exporting.total} hasValueLabel formatValueLabel={(v, mx) => `${v} / ${mx} frames`} />
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
      <SendToRow make={stillBlob} isDisabled={!!s.exporting} onError={m => toast(m, 'error')} />
      <Text type="supporting">
        {s.media?.kind === 'camera'
          ? `PNG and SVG save the frame on screen. Video export works with images and video files, not ${s.media.live ? 'a live picture' : 'the webcam'}.`
          : !canVideo
            ? 'PNG and SVG save the frame on screen. Video export needs Chrome or Edge.'
            : `PNG and SVG save the frame on screen. The MP4 renders ${secs(videoSeconds())} at 30 fps${!isVideo && !moving ? '; turn on Resolve or Scatter so it moves' : ''}.`}
      </Text>
    </InspectorSection>
  );
}

const openProjectFile = async () => { const [f] = await pickFiles('.json,application/json'); openFile(f); };

function LooksSection() {
  const {looks} = useStore();
  const [name, setName] = useState('');
  const save = () => { if (name.trim()) { saveLook(name); setName(''); } };
  return (
    <InspectorSection title="Saved looks">
      <HStack gap={1}>
        <StackItem size="fill">
          <TextInput label="Name for this look" isLabelHidden size="sm" width="100%" placeholder="Name this look" value={name} onChange={v => setName(v)} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
        </StackItem>
        <Button label="Save" size="sm" variant="secondary" icon={<Icon icon={Save} size={ICON} />} isDisabled={!name.trim()} onClick={save} />
      </HStack>
      {looks.length ? (
        <List density="compact">
          {looks.map(l => (
            <ListItem
              key={l.name}
              label={l.name}
              description={`${PALETTES.find(p => p.id === l.config.palette)?.name ?? 'Custom colors'}, ${SHAPES[l.config.shape as keyof typeof SHAPES] ?? ''}`}
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
      <Text type="supporting">A link or a project file holds every setting, but not your picture.</Text>
    </InspectorSection>
  );
}
