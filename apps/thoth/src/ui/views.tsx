// THOTH's panels: the stage, its tool bar, and the inspector.
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
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Toolbar} from '@astryxdesign/core/Toolbar';
import {Camera, Check, Download, Eye, Film, FolderOpen, Image, ImagePlus, Link, Pause, Play, RotateCcw, Save, Shuffle, Trash2, X} from 'lucide-react';
import {pickFiles} from '@studio/core';
import {MOTIONS, BACKDROPS, FILLS, SHAPES} from '../engine/source.js';
import {DOT_SHAPES} from '../engine/halftone.js';
import {PRESETS, ASPECTS, MODES, WEIGHTS} from '../engine/config.js';
import {
  useStore, attachCanvas, applyPreset, randomize, togglePlay, restart, set, setIn, setFill, setBackdropColor, setMode,
  openMedia, startCamera, removeMedia, exportPNG, exportMP4, cancelMP4, videoSupported, videoSeconds, setExportSize, setExportLoops,
  setMatchVideo, saveLook, applyLook, deleteLook, saveProject, openFile, copyLink,
} from '../engine/live.js';
import {fixedSize, fixedSizeLabel, frameLabel} from '@studio/core/frames';
import {ICON, InspectorRow, InspectorSection, SliderRow, Swatch} from './parts';

const styles = stylex.create({
  frame: {position: 'relative', width: '100%', height: '100%'},
  canvas: {display: 'block', borderRadius: 'var(--radius-container)', boxShadow: 'var(--shadow-med)'},
});

const pct = (v: number) => `${Math.round(v * 100)}%`;
const deg = (v: number) => `${Math.round(v)}°`;
const times = (v: number) => `${v.toFixed(2)}×`;
const secs = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} s`;
const opts = (o: Record<string, string>) => Object.entries(o).map(([value, label]) => ({value, label}));
type Layer = 'backdrop' | 'media' | 'shape' | 'text';

/* ================= stage ================= */
export function Stage() {
  const ref = useRef<HTMLCanvasElement>(null);
  const s = useStore();
  useEffect(() => { attachCanvas(ref.current); return () => attachCanvas(null); }, []);
  if (!s.supported) {
    return (
      <Center height="100%">
        <Text type="supporting">This browser can't run WebGL2, which THOTH needs to draw.</Text>
      </Center>
    );
  }
  return (
    <Center xstyle={styles.frame}>
      <canvas ref={ref} role="img" aria-label="Animated content drawn as halftone dots" {...stylex.props(styles.canvas)} />
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
            {`${s.time.toFixed(1)} / ${secs(s.config.loop)}`}
          </Text>
          <IconButton
            label={s.config.showSource ? 'Show the halftone' : 'Show the source'}
            tooltip={s.config.showSource ? 'Show the halftone' : 'Show the source'}
            size="sm"
            variant={s.config.showSource ? 'secondary' : 'ghost'}
            icon={<Icon icon={Eye} size={ICON} />}
            onClick={() => set('showSource', !s.config.showSource)}
          />
          <IconButton label="Randomize" tooltip="Randomize" size="sm" variant="ghost" icon={<Icon icon={Shuffle} size={ICON} />} onClick={randomize} />
        </>
      }
    />
  );
}

/* ================= shared rows ================= */
function MotionRows({layer}: {layer: Layer}) {
  const L = useStore().config[layer] as any;
  const kinds = layer === 'text' ? MOTIONS : Object.fromEntries(Object.entries(MOTIONS).filter(([k]) => k !== 'scroll' || layer === 'backdrop'));
  return (
    <>
      <InspectorRow label="Motion">
        <Selector label={`${layer} motion`} isLabelHidden size="sm" width="100%" value={L.motion} options={opts(kinds)} onChange={v => setIn(layer, 'motion', v)} />
      </InspectorRow>
      {L.motion !== 'still' ? (
        <>
          <SliderRow label="Speed" value={L.speed} min={1} max={8} step={1} format={v => `${v}× a loop`} onChange={v => setIn(layer, 'speed', v)} />
          {L.motion !== 'spin' && L.motion !== 'scroll' ? <SliderRow label="Amount" value={L.amount} min={0} max={1} step={0.01} format={pct} onChange={v => setIn(layer, 'amount', v)} /> : null}
        </>
      ) : null}
    </>
  );
}

function FillRows({layer}: {layer: 'shape' | 'text'}) {
  const F = useStore().config[layer].fill;
  return (
    <>
      <InspectorRow label="Fill">
        <Selector label={`${layer} fill`} isLabelHidden size="sm" width="100%" value={F.kind} options={opts(FILLS)} onChange={v => setFill(layer, 'kind', v)} />
      </InspectorRow>
      {F.kind === 'solid' || F.kind === 'gradient' ? (
        <InspectorRow label="Colors">
          <Swatch label={F.kind === 'solid' ? 'Fill color' : 'Gradient start'} value={F.a} onChange={v => setFill(layer, 'a', v)} />
          {F.kind === 'gradient' ? <Swatch label="Gradient end" value={F.b} onChange={v => setFill(layer, 'b', v)} /> : null}
        </InspectorRow>
      ) : (
        <SliderRow label="Start hue" value={F.hue} min={0} max={360} step={1} format={deg} onChange={v => setFill(layer, 'hue', v)} />
      )}
      {F.kind === 'gradient' || F.kind === 'rainbow' ? <SliderRow label="Angle" value={F.angle} min={-180} max={180} step={1} format={deg} onChange={v => setFill(layer, 'angle', v)} /> : null}
    </>
  );
}

/* ================= inspector ================= */
export function Inspector() {
  const s = useStore();
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
        </HStack>
      </InspectorSection>
      <ScreenSection />
      <TextSection />
      <ShapeSection />
      <MediaSection />
      <BackdropSection />
      <TimingSection />
      <ExportSection />
      <LooksSection />
    </>
  );
}

function ScreenSection() {
  const {config: c} = useStore();
  return (
    <InspectorSection title="Halftone">
      <InspectorRow label="Screens">
        <Selector label="Screens" isLabelHidden size="sm" width="100%" value={c.mode} options={opts(MODES)} onChange={v => setMode(v)} />
      </InspectorRow>
      <InspectorRow label="Dot">
        <Selector label="Dot shape" isLabelHidden size="sm" width="100%" value={c.dotShape} options={opts(DOT_SHAPES)} onChange={v => set('dotShape', v)} />
      </InspectorRow>
      <SliderRow label="Pitch" value={c.pitch} min={4} max={80} step={1} format={v => `${Math.round(v)} px`} onChange={v => set('pitch', v)} />
      <SliderRow label="Dot size" value={c.dot} min={0.4} max={2} step={0.01} format={times} onChange={v => set('dot', v)} />
      <SliderRow label="Angle" value={c.angle} min={-90} max={90} step={1} format={deg} onChange={v => set('angle', v)} />
      {c.mode === 'rgb' ? (
        <>
          <SliderRow label="Spread" value={c.spread} min={0} max={45} step={1} format={deg} onChange={v => set('spread', v)} />
          <SliderRow label="Split" value={c.split} min={0} max={0.5} step={0.01} format={pct} onChange={v => set('split', v)} />
          <InspectorRow label="Background">
            <Swatch label="Background" value={c.background} onChange={v => set('background', v)} />
          </InspectorRow>
        </>
      ) : null}
      {c.mode === 'cmyk' ? <SliderRow label="Black" value={c.gcr} min={0} max={1} step={0.01} format={pct} onChange={v => set('gcr', v)} /> : null}
      {c.mode !== 'rgb' ? (
        <InspectorRow label="Paper">
          <Swatch label="Paper" value={c.paper} onChange={v => set('paper', v)} />
          {c.mode === 'mono' ? <Swatch label="Ink" value={c.ink} onChange={v => set('ink', v)} /> : null}
        </InspectorRow>
      ) : null}
      {c.mode === 'mono' ? <Switch label="Dots for light, not dark" size="sm" value={c.invert} onChange={v => set('invert', v)} /> : null}
      <Text type="supporting">
        {c.mode === 'rgb'
          ? 'Red, green and blue dot screens add up as light: Spread turns them apart, Split shifts them off each other.'
          : c.mode === 'cmyk'
            ? 'Cyan, magenta, yellow and black screens at 15°, 75°, 0° and 45° print onto paper. Black sets how much gray goes to black ink.'
            : 'One ink on paper, at 45° to the angle.'}
        {' '}Pitch is set for a 1080 px frame and scales with the export. A dot size over 1× merges neighbors into blobs.
      </Text>
    </InspectorSection>
  );
}

function TextSection() {
  const L = useStore().config.text;
  return (
    <InspectorSection title="Type">
      <Switch label="Show type" size="sm" value={L.on} onChange={v => setIn('text', 'on', v)} />
      {L.on ? (
        <>
          <TextArea label="Text" isLabelHidden size="sm" rows={3} value={L.text} onChange={(v: string) => setIn('text', 'text', v)} />
          <InspectorRow label="Weight">
            <Selector label="Weight" isLabelHidden size="sm" width="100%" value={String(L.weight)} options={WEIGHTS.map(w => ({value: String(w), label: w === 900 ? 'Black' : w === 700 ? 'Bold' : w === 600 ? 'Semibold' : w === 500 ? 'Medium' : 'Regular'}))} onChange={v => setIn('text', 'weight', Number(v))} />
          </InspectorRow>
          <SliderRow label="Size" value={L.size} min={0.03} max={0.8} step={0.01} format={pct} onChange={v => setIn('text', 'size', v)} />
          <SliderRow label="Tracking" value={L.tracking} min={-0.1} max={0.5} step={0.01} format={pct} onChange={v => setIn('text', 'tracking', v)} />
          <SliderRow label="Leading" value={L.leading} min={0.7} max={1.6} step={0.01} format={times} onChange={v => setIn('text', 'leading', v)} />
          <FillRows layer="text" />
          <MotionRows layer="text" />
        </>
      ) : null}
    </InspectorSection>
  );
}

function ShapeSection() {
  const L = useStore().config.shape;
  return (
    <InspectorSection title="Shape">
      <Switch label="Show a shape" size="sm" value={L.on} onChange={v => setIn('shape', 'on', v)} />
      {L.on ? (
        <>
          <InspectorRow label="Shape">
            <Selector label="Shape" isLabelHidden size="sm" width="100%" value={L.kind} options={opts(SHAPES)} onChange={v => setIn('shape', 'kind', v)} />
          </InspectorRow>
          <SliderRow label="Size" value={L.size} min={0.05} max={1.5} step={0.01} format={pct} onChange={v => setIn('shape', 'size', v)} />
          <SliderRow label="Count" value={L.count} min={1} max={8} step={1} format={v => (v === 1 ? 'One' : `${v} in a ring`)} onChange={v => setIn('shape', 'count', v)} />
          <FillRows layer="shape" />
          <MotionRows layer="shape" />
        </>
      ) : null}
    </InspectorSection>
  );
}

function MediaSection() {
  const s = useStore();
  const L = s.config.media;
  const m = s.media;
  const pick = async () => { const [f] = await pickFiles('image/*,video/*'); openMedia(f); };
  return (
    <InspectorSection title="Image or video">
      <HStack gap={1} wrap="wrap">
        <Button label={m ? 'Replace' : 'Open image or video'} size="sm" variant="secondary" icon={<Icon icon={ImagePlus} size={ICON} />} isDisabled={s.mediaBusy} onClick={pick} />
        <Button label="Webcam" size="sm" variant="ghost" icon={<Icon icon={Camera} size={ICON} />} isDisabled={s.mediaBusy} onClick={startCamera} />
        {m ? <IconButton label="Remove the image or video" tooltip="Remove" size="sm" variant="ghost" icon={<Icon icon={Trash2} size={ICON} />} onClick={removeMedia} /> : null}
      </HStack>
      {m ? (
        <>
          <Text type="supporting" maxLines={1}>{m.label}</Text>
          <Switch label="Show it" size="sm" value={L.on} onChange={v => setIn('media', 'on', v)} />
          <InspectorRow label="Fit">
            <Selector label="Fit" isLabelHidden size="sm" width="100%" value={L.fit} options={[{value: 'cover', label: 'Fill the frame'}, {value: 'contain', label: 'Fit inside'}]} onChange={v => setIn('media', 'fit', v)} />
          </InspectorRow>
          <SliderRow label="Scale" value={L.scale} min={0.3} max={3} step={0.01} format={times} onChange={v => setIn('media', 'scale', v)} />
          <SliderRow label="Contrast" value={L.contrast} min={0.3} max={3} step={0.01} format={times} onChange={v => setIn('media', 'contrast', v)} />
          <SliderRow label="Brightness" value={L.brightness} min={0.3} max={2} step={0.01} format={times} onChange={v => setIn('media', 'brightness', v)} />
          <MotionRows layer="media" />
        </>
      ) : (
        <Text type="supporting">Put a photo, a video or your webcam under the type and shape. Contrast helps it read as dots. You can also drop a file on the page.</Text>
      )}
    </InspectorSection>
  );
}

function BackdropSection() {
  const B = useStore().config.backdrop;
  return (
    <InspectorSection title="Backdrop">
      <InspectorRow label="Field">
        <Selector label="Backdrop field" isLabelHidden size="sm" width="100%" value={B.kind} options={opts(BACKDROPS)} onChange={v => setIn('backdrop', 'kind', v)} />
      </InspectorRow>
      {B.kind !== 'solid' ? <Switch label="Cycle through hues" size="sm" value={B.hue} onChange={v => setIn('backdrop', 'hue', v)} /> : null}
      {!B.hue || B.kind === 'solid' ? (
        <InspectorRow label="Colors">
          {(B.kind === 'solid' ? [0] : B.kind === 'bands' ? [0, 1] : [0, 1, 2]).map(i => (
            <Swatch key={i} label={`Backdrop color ${i + 1}`} value={B.colors[i]} onChange={v => setBackdropColor(i, v)} />
          ))}
        </InspectorRow>
      ) : null}
      {B.kind === 'linear' || B.kind === 'bands' || B.kind === 'conic' ? <SliderRow label="Angle" value={B.angle} min={-180} max={180} step={1} format={deg} onChange={v => setIn('backdrop', 'angle', v)} /> : null}
      {B.kind === 'bands' ? <SliderRow label="Bands" value={B.count} min={1} max={16} step={1} onChange={v => setIn('backdrop', 'count', v)} /> : null}
      {B.kind !== 'solid' ? <MotionRows layer="backdrop" /> : null}
      <Text type="supporting">The field behind everything. In RGB, black prints nothing; in CMYK and Mono, white prints nothing.</Text>
    </InspectorSection>
  );
}

function TimingSection() {
  const {config: c} = useStore();
  return (
    <InspectorSection title="Loop and color">
      <SliderRow label="Loop" value={c.loop} min={2} max={30} step={0.5} format={secs} onChange={v => set('loop', v)} />
      <SliderRow label="Hue turns" value={c.hueCycles} min={0} max={8} step={1} format={v => (v === 0 ? 'Off' : `${v} a loop`)} onChange={v => set('hueCycles', v)} />
      <SliderRow label="Hue steps" value={c.hueSteps} min={0} max={12} step={1} format={v => (v < 2 ? 'Smooth' : `${v} steps`)} onChange={v => set('hueSteps', v < 2 ? 0 : v)} />
      <InspectorRow label="Frame">
        <Selector label="Frame shape" isLabelHidden size="sm" width="100%" value={c.aspect} options={Object.keys(ASPECTS).map(k => ({value: k, label: frameLabel(k)}))} onChange={v => set('aspect', v)} />
      </InspectorRow>
      <Text type="supporting">Every motion and hue cycle repeats a whole number of times per loop, so exported loops have no seam. Hue steps make colors flick from one to the next instead of gliding.</Text>
    </InspectorSection>
  );
}

function ExportSection() {
  const s = useStore();
  const canVideo = videoSupported();
  const isVideo = s.media?.kind === 'video';
  return (
    <InspectorSection title="Export">
      <InspectorRow label="Size">
        {fixedSize(s.config.aspect) ? (
          <Text type="body">{fixedSizeLabel(s.config.aspect)}</Text>
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
      {isVideo ? <Switch label="Match the video's length" size="sm" value={s.matchVideo} onChange={setMatchVideo} /> : null}
      {!isVideo || !s.matchVideo ? (
        <SliderRow label="Video" value={s.exportLoops} min={1} max={8} step={1} format={v => `${v} × ${secs(s.config.loop)}`} onChange={setExportLoops} />
      ) : null}
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
          <Button label="Render MP4" size="sm" variant="secondary" icon={<Icon icon={Film} size={ICON} />} isDisabled={!canVideo} onClick={exportMP4} />
        </HStack>
      )}
      <Text type="supporting">
        {s.media?.kind === 'camera'
          ? 'The PNG is the frame on screen. Video export works with images and video files, not the webcam.'
          : canVideo
            ? `The PNG is the frame on screen. The MP4 renders ${secs(videoSeconds())} at 30 fps, frame by frame${isVideo && !s.matchVideo ? '; the video repeats if it is shorter' : ''}.`
            : 'The PNG is the frame on screen. Video export needs Chrome or Edge.'}
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
              description={`${MODES[l.config.mode as keyof typeof MODES] ?? ''}, ${Math.round(l.config.pitch)} px dots`}
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
      <Text type="supporting">A link or a project file holds every setting, but not your image or video.</Text>
    </InspectorSection>
  );
}
