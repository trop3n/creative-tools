import {useEffect, useRef} from 'react';
import * as stylex from '@stylexjs/stylex';
import {Button} from '@astryxdesign/core/Button';
import {Center} from '@astryxdesign/core/Center';
import {Grid} from '@astryxdesign/core/Grid';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Layout';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {SelectableCard} from '@astryxdesign/core/SelectableCard';
import {Selector} from '@astryxdesign/core/Selector';
import {Slider} from '@astryxdesign/core/Slider';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {Toolbar} from '@astryxdesign/core/Toolbar';
import {Camera, CameraOff, Circle, Clapperboard, ClipboardCopy, Download, ImageUp, LayoutGrid, Minus, Pause, Play, Plus, Square, Volume2, VolumeX} from 'lucide-react';
import {S, A, useStore, byId, toast, PALETTES, MAX_PALETTE} from '../engine/store.js';
import {PATTERNS} from '../engine/patterns.js';
import {setGen, setOutCanvas, exportPNG, exportSVG, copySVG, pngBlob} from '../engine/generator.js';
import {
  useSample, loadMediaFile, playPause, seekFraction, setSound, setVolume, renderVideo, startWebcam, setMirror, stopCamera, toggleRecord,
  seekRibbons, renderRibbons,
} from '../engine/media.js';
import {CustomSizeRow, GlyphArt, ICON, InspectorRow, InspectorSection, PresetChip, SliderRow, Swatch} from './parts';
import {RecentFromSuite, SendToRow, SuitePaletteRow} from './suite';
import {pickFiles} from '@studio/core';
import {CUSTOM, FRAME_RATIOS, frameIds, frameLabel} from '@studio/core/frames';

const INKS = ['#00304e', '#242222', '#4c3046', '#c99530', '#90a344', '#ffffff'];
const PAPERS = ['#dfdfdf', '#ffffff', '#242222', '#00304e', '#4c3046', '#c99530'];
const FRAME_OPTIONS = [{value: 'source', label: 'Same as the source'}, ...frameIds(FRAME_RATIOS).map(k => ({value: k, label: frameLabel(k)}))];
const tfmt = (s: number) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return m + ':' + (s % 60).toFixed(1).padStart(4, '0'); };
const fixed = (d: number) => (v: number) => v.toFixed(d);

const styles = stylex.create({
  // The canvas keeps its pixel size and scales down to fit the stage on both axes.
  output: {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '100%',
    width: 'auto',
    height: 'auto',
    minWidth: 0,
    minHeight: 0,
    borderRadius: 'var(--radius-container)',
    boxShadow: 'var(--shadow-med)',
  },
  frame: {position: 'relative', overflow: 'hidden', minHeight: 0},
  hidden: {display: 'none'},
});

/* ================= rail ================= */
export function GenerateRail() {
  const s = useStore();
  return (
    <VStack gap={4}>
      <VStack gap={2}>
        <Text type="label" weight="semibold">
          Ramp, light to dark
        </Text>
        {s.ramp.length ? (
          <Grid columns={{minWidth: 30}} gap={1}>
            {s.ramp.map(r => {
              const g = byId(r.id);
              return g ? (
                <VStack key={r.id} gap={0.5} hAlign="center">
                  <GlyphArt shape={g} place={'ramp-' + r.id} small />
                  <Text type="supporting" size="3xs" hasTabularNumbers>
                    {Math.round(r.cov * 100)}
                  </Text>
                </VStack>
              ) : null;
            })}
          </Grid>
        ) : (
          <Text type="supporting">No glyphs in the set.</Text>
        )}
        <Text type="supporting">Glyphs sort by measured ink coverage. Each cell gets the glyph closest to its tone.</Text>
      </VStack>
      <VStack gap={2}>
        <HStack gap={1} vAlign="center">
          <StackItem size="fill">
            <Text type="label" weight="semibold">
              Glyph set
            </Text>
          </StackItem>
          <Button label="All" size="sm" variant="ghost" onClick={() => A.allInSet(true)} />
          <Button label="None" size="sm" variant="ghost" onClick={() => A.allInSet(false)} />
        </HStack>
        <Grid columns={{minWidth: 64}} gap={2}>
          {s.lib.shapes.map(g => (
            <SelectableCard key={g.id} label={g.name} padding={1} isSelected={!!g.inSet} onChange={v => A.setInSet(g.id, v)}>
              <VStack gap={0.5}>
                <GlyphArt shape={g} place={'set-' + g.id} />
                <Text type="supporting" maxLines={1}>
                  {g.name}
                </Text>
                <Text type="supporting" size="3xs" hasTabularNumbers>
                  {g.inSet && s.cov[g.id] != null ? `${Math.round(s.cov[g.id] * 100)}% ink` : ' '}
                </Text>
              </VStack>
            </SelectableCard>
          ))}
        </Grid>
      </VStack>
    </VStack>
  );
}

/* ================= stage ================= */
export function GenerateStage() {
  const s = useStore();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { setOutCanvas(ref.current); return () => setOutCanvas(null); }, []);
  const empty = !s.ramp.length;
  return (
    <VStack gap={2} height="100%">
      <StackItem size="fill">
        <Center width="100%" height="100%" xstyle={styles.frame}>
          {empty ? <Text type="supporting">Add at least one glyph with some ink to the set.</Text> : null}
          <canvas ref={ref} width={10} height={10} aria-label="Generated image" {...stylex.props(styles.output, empty && styles.hidden)} />
        </Center>
      </StackItem>
      <HStack gap={3} hAlign="between">
        <Text type="supporting" hasTabularNumbers>
          {s.stats}
        </Text>
        <Text type="supporting" maxLines={1}>
          {s.media.label}
        </Text>
      </HStack>
    </VStack>
  );
}

export function GenerateToolbar() {
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
                {tfmt(media.time)} / {tfmt(media.duration)}
              </Text>
            </>
          ) : null}
          {media.kind === 'ribbons' ? (
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
              <Text type="supporting" hasTabularNumbers>
                {tfmt(media.time)} / {tfmt(media.duration)}
              </Text>
            </>
          ) : null}
          {media.kind === 'camera' ? (
            <Button
              label={media.recording ? `Stop ${tfmt(media.recTime)}` : 'Record'}
              size="sm"
              variant={media.recording ? 'destructive' : 'secondary'}
              icon={<Icon icon={media.recording ? Square : Circle} size={ICON} />}
              onClick={toggleRecord}
            />
          ) : null}
          <Button label="PNG" size="sm" variant="ghost" icon={<Icon icon={Download} size={ICON} />} onClick={exportPNG} />
          <Button label="SVG" size="sm" variant="ghost" icon={<Icon icon={Download} size={ICON} />} onClick={exportSVG} />
        </>
      }
    />
  );
}

/* ================= palette ================= */
function PaletteEditor() {
  const {gen: g} = useStore();
  const pal: string[] = g.palette;
  const preset = PALETTES.find(p => p.colors.join() === pal.join());
  const setPal = (next: string[]) => setGen('palette', next);
  return (
    <>
      <InspectorRow label="Palette">
        <Selector
          label="Palette preset"
          isLabelHidden
          size="sm"
          width="100%"
          value={preset ? preset.id : 'custom'}
          options={[...PALETTES.map(p => ({value: p.id, label: p.name})), ...(preset ? [] : [{value: 'custom', label: 'Custom'}])]}
          onChange={v => { const p = PALETTES.find(x => x.id === v); if (p) setPal(p.colors.slice()); }}
        />
      </InspectorRow>
      <InspectorRow label="Colors">
        {pal.map((c, i) => (
          <Swatch key={i} label={`Palette color ${i + 1}`} value={c} onChange={v => setPal(pal.map((x, j) => (j === i ? v : x)))} />
        ))}
        <IconButton label="Add a color" tooltip="Add a color" size="sm" variant="ghost" isDisabled={pal.length >= MAX_PALETTE} icon={<Icon icon={Plus} size={ICON} />} onClick={() => setPal([...pal, pal[pal.length - 1]])} />
        <IconButton label="Remove the last color" tooltip="Remove the last color" size="sm" variant="ghost" isDisabled={pal.length <= 1} icon={<Icon icon={Minus} size={ICON} />} onClick={() => setPal(pal.slice(0, -1))} />
      </InspectorRow>
      <SuitePaletteRow colors={pal} onUse={c => setPal(c.slice(0, MAX_PALETTE))} onSaved={n => toast(`Saved "${n}" to the suite palettes`)} />
      {g.color === 'palette' ? (
        <InspectorRow label="Match">
          <SegmentedControl label="Match colors" size="sm" layout="fill" value={g.match} onChange={v => setGen('match', v)}>
            <SegmentedControlItem value="nearest" label="Nearest color" />
            <SegmentedControlItem value="tone" label="By tone" />
          </SegmentedControl>
        </InspectorRow>
      ) : null}
      {g.color === 'palette' ? (
        <Text type="supporting">
          {g.match === 'tone' ? 'Each mark takes the palette color at its tone: the first color for the lightest marks, the last for the darkest.' : 'Each mark takes the palette color nearest the source under it, so every mark is one flat color.'}
        </Text>
      ) : null}
    </>
  );
}

/* ================= inspector ================= */
export function GenerateInspector() {
  const s = useStore();
  const g = s.gen, m = s.media, size = g.mode === 'size';
  return (
    <>
      <InspectorSection title="Source">
        <InspectorRow label="Built-in">
          <Selector
            label="Built-in source"
            isLabelHidden
            size="sm"
            width="100%"
            placeholder="Your image, video or webcam"
            value={m.kind === 'sample' ? g.sample || '' : m.kind === 'ribbons' || m.kind === 'pattern' ? m.kind : ''}
            options={[
              {value: 'sphere', label: 'Spheres'},
              {value: 'rings', label: 'Rings'},
              {value: 'ramp', label: 'Ramp'},
              {value: 'ribbons', label: 'Ribbons (moving)'},
              {value: 'pattern', label: 'Pattern'},
            ]}
            onChange={useSample}
          />
        </InspectorRow>
        <HStack gap={1} wrap="wrap">
          <Button
            label="Image or video…"
            size="sm"
            variant="primary"
            icon={<Icon icon={ImageUp} size={ICON} />}
            onClick={async () => { const [f] = await pickFiles('image/*,video/*'); loadMediaFile(f); }}
          />
          {m.kind === 'camera' ? (
            <Button label="Stop camera" size="sm" icon={<Icon icon={CameraOff} size={ICON} />} onClick={stopCamera} />
          ) : (
            <Button label="Webcam" size="sm" icon={<Icon icon={Camera} size={ICON} />} onClick={() => startWebcam()} />
          )}
        </HStack>
        <RecentFromSuite onOpen={loadMediaFile} />
        <Text type="supporting">You can also drop an image or video on the canvas, or paste an image.</Text>
      </InspectorSection>

      {m.kind === 'pattern' ? (
        <InspectorSection title="Pattern">
          <InspectorRow label="Kind">
            <Selector label="Pattern kind" isLabelHidden size="sm" width="100%" value={g.patKind} options={PATTERNS.map(p => ({value: p.id, label: p.name}))} onChange={v => setGen('patKind', v)} />
          </InspectorRow>
          <Text type="supporting">{(PATTERNS.find(p => p.id === g.patKind) || PATTERNS[0]).hint}</Text>
          <SliderRow label="Scale" value={g.patScale} min={1} max={20} step={0.5} onChange={v => setGen('patScale', v)} />
          <SliderRow label="Detail" value={g.patDetail} min={0} max={1} step={0.05} format={v => Math.round(v * 100) + '%'} onChange={v => setGen('patDetail', v)} />
          <SliderRow label="Angle" value={g.patAngle} min={0} max={180} step={1} format={v => v + '°'} onChange={v => setGen('patAngle', v)} />
          <SliderRow label="Seed" value={g.patSeed} min={1} max={999} onChange={v => setGen('patSeed', v)} />
          <Text type="supporting">The pattern is the source: GLYF reads it like a picture. Try Fit or Random rotation, a Palette, or the quarter-circle glyphs, and save it as SVG.</Text>
        </InspectorSection>
      ) : null}

      {m.kind === 'ribbons' ? (
        <InspectorSection title="Ribbons">
          <Slider
            label="Position"
            isLabelHidden
            min={0}
            max={1000}
            value={m.duration ? Math.round((m.time / m.duration) * 1000) : 0}
            onChange={(v: number) => seekRibbons(v / 1000)}
            valueDisplay="none"
            isDisabled={m.exporting}
          />
          <SliderRow label="Ribbons" value={g.ribCount} min={1} max={8} step={1} onChange={v => setGen('ribCount', v)} isDisabled={m.exporting} />
          <SliderRow label="Width" value={g.ribWidth} min={0.03} max={0.2} step={0.005} format={v => Math.round(v * 100) + '%'} onChange={v => setGen('ribWidth', v)} isDisabled={m.exporting} />
          <SliderRow label="Wander" value={g.ribWander} min={0} max={1} step={0.01} format={v => Math.round(v * 100) + '%'} onChange={v => setGen('ribWander', v)} isDisabled={m.exporting} />
          <SliderRow label="Patches" value={g.ribPatches} min={1} max={8} step={1} format={v => (v === 1 ? '1 a ribbon' : v + ' a ribbon')} onChange={v => setGen('ribPatches', v)} isDisabled={m.exporting} />
          <SliderRow label="Loop" value={g.ribLoop} min={4} max={20} step={1} format={v => v + ' s'} onChange={v => setGen('ribLoop', v)} isDisabled={m.exporting} />
          <SliderRow label="Seed" value={g.ribSeed} min={1} max={999} onChange={v => setGen('ribSeed', v)} isDisabled={m.exporting} />
          <Text type="supporting">The ribbons are drawn in the Palette colors (see Color). Every motion comes round once a loop, so a video of whole loops repeats with no seam.</Text>
          <Button label="Tile look" size="sm" variant="secondary" icon={<Icon icon={LayoutGrid} size={ICON} />} onClick={A.tileLook} isDisabled={m.exporting} />
          <Text type="supporting">Tile look puts only the four tile glyphs in the set, mixes them across the cells, colors them from the palette on near-black, and sets the tone so every ribbon shows.</Text>
          <InspectorRow label="Frame rate">
            <SegmentedControl label="Frame rate" size="sm" layout="fill" value={g.fps} onChange={v => setGen('fps', v)}>
              {['24', '25', '30', '60'].map(f => (
                <SegmentedControlItem key={f} value={f} label={f} />
              ))}
            </SegmentedControl>
          </InspectorRow>
          <SliderRow label="Video" value={g.ribLoops} min={1} max={4} step={1} format={v => `${v} × ${g.ribLoop} s`} onChange={v => setGen('ribLoops', v)} isDisabled={m.exporting} />
          <Button
            label={m.exporting ? 'Cancel render' : 'Render video .mp4'}
            size="sm"
            variant={m.exporting ? 'destructive' : 'primary'}
            icon={<Icon icon={Clapperboard} size={ICON} />}
            onClick={renderRibbons}
          />
          <Text type="supporting" hasTabularNumbers>
            {m.progress || 'Renders every frame offline at full quality, up to 1920 px on the long side (the LED wall and Custom size: exactly that size).'}
          </Text>
        </InspectorSection>
      ) : null}

      {m.kind === 'video' ? (
        <InspectorSection title="Video">
          <Slider
            label="Position"
            isLabelHidden
            min={0}
            max={1000}
            value={m.duration ? Math.round((m.time / m.duration) * 1000) : 0}
            onChange={(v: number) => seekFraction(v / 1000)}
            valueDisplay="none"
            isDisabled={m.exporting}
          />
          <SliderRow label="Volume" value={m.volume} min={0} max={1} step={0.01} format={v => Math.round(v * 100) + '%'} onChange={setVolume} />
          <InspectorRow label="Frame rate">
            <SegmentedControl label="Frame rate" size="sm" layout="fill" value={g.fps} onChange={v => setGen('fps', v)}>
              {['24', '25', '30', '60'].map(f => (
                <SegmentedControlItem key={f} value={f} label={f} />
              ))}
            </SegmentedControl>
          </InspectorRow>
          <Switch label="Include the source audio" size="sm" value={!!g.audio} onChange={v => setGen('audio', v)} />
          <Button
            label={m.exporting ? 'Cancel render' : 'Render video .mp4'}
            size="sm"
            variant={m.exporting ? 'destructive' : 'primary'}
            icon={<Icon icon={Clapperboard} size={ICON} />}
            onClick={renderVideo}
          />
          <Text type="supporting" hasTabularNumbers>
            {m.progress || 'Renders every frame offline at full quality, up to 1920 px on the long side (the LED wall and Custom size: exactly that size). Audio is re-encoded as AAC.'}
          </Text>
        </InspectorSection>
      ) : null}

      {m.kind === 'camera' ? (
        <InspectorSection title="Webcam">
          {m.cams.length > 1 ? (
            <Selector label="Camera" size="sm" options={m.cams} value={m.camId} onChange={v => startWebcam(v)} />
          ) : null}
          <Switch label="Mirror image" size="sm" value={m.mirror} onChange={setMirror} />
          <Text type="supporting">Record captures the output live, as you see it, with no sound. Columns are locked while recording.</Text>
        </InspectorSection>
      ) : null}

      <InspectorSection title="Grid and tone">
        <SliderRow label="Columns" value={g.cols} min={8} max={200} onChange={v => setGen('cols', v)} isDisabled={m.recording} />
        <SliderRow label="Brightness" value={g.bright} min={-0.5} max={0.5} step={0.01} format={v => (v > 0 ? '+' : '') + v.toFixed(2)} onChange={v => setGen('bright', v)} />
        <SliderRow label="Contrast" value={g.contrast} min={0.2} max={3} step={0.01} format={fixed(2)} onChange={v => setGen('contrast', v)} />
        <SliderRow label="Gamma" value={g.gamma} min={0.3} max={3} step={0.01} format={fixed(2)} onChange={v => setGen('gamma', v)} />
        <Switch label="Invert tones" size="sm" value={!!g.invert} onChange={v => setGen('invert', v)} />
        <InspectorRow label="Tone">
          <SegmentedControl label="Tone matching" size="sm" layout="fill" value={g.tone} onChange={v => setGen('tone', v)}>
            <SegmentedControlItem value="linear" label="Linear" />
            <SegmentedControlItem value="classic" label="Classic" />
          </SegmentedControl>
        </InspectorRow>
        <Text type="supporting">{g.tone === 'classic' ? 'Classic matches ink to the screen value: right for marks you see one by one.' : 'Linear matches ink to light, as print does: right for fine grids seen from a distance, such as the LED wall; coarse grids come out darker.'}</Text>
      </InspectorSection>

      <InspectorSection title="Mapping">
        <SegmentedControl label="Mapping mode" size="sm" layout="fill" value={g.mode} onChange={v => setGen('mode', v)}>
          <SegmentedControlItem value="density" label="By density" />
          <SegmentedControlItem value="size" label="By size" />
        </SegmentedControl>
        <InspectorRow label="Dither">
          <Selector
            label="Dither"
            isLabelHidden
            size="sm"
            width="100%"
            isDisabled={size}
            disabledMessage="Size mapping does not dither"
            value={g.dither}
            options={[
              {value: 'none', label: 'None'},
              {value: 'fs', label: 'Floyd–Steinberg'},
              {value: 'atk', label: 'Atkinson'},
              {value: 'bayer', label: 'Bayer 4×4'},
            ]}
            onChange={v => setGen('dither', v)}
          />
        </InspectorRow>
        <InspectorRow label="Steps">
          <SegmentedControl label="Tone steps" size="sm" layout="fill" isDisabled={size} value={g.steps} onChange={v => setGen('steps', v)}>
            <SegmentedControlItem value="measured" label="Measured" />
            <SegmentedControlItem value="even" label="Even" />
          </SegmentedControl>
        </InspectorRow>
        <Switch label="Empty cell as lightest step" size="sm" isDisabled={size} value={!!g.blank} onChange={v => setGen('blank', v)} />
        <SliderRow label="Detail" value={g.detail} min={0} max={1} step={0.05} format={v => (v < 0.025 ? 'Tone only' : Math.round(v * 100) + '%')} onChange={v => setGen('detail', v)} isDisabled={size || g.pick === 'mixed'} />
        <InspectorRow label="Glyphs">
          <SegmentedControl label="Which glyph" size="sm" layout="fill" isDisabled={size} value={g.pick} onChange={v => setGen('pick', v)}>
            <SegmentedControlItem value="tone" label="By tone" />
            <SegmentedControlItem value="mixed" label="Mixed" />
          </SegmentedControl>
        </InspectorRow>
        <Text type="supporting">
          {size
            ? 'Each cell draws a glyph from the set, scaled by tone. One glyph in the set gives a classic halftone.'
            : g.pick === 'mixed'
              ? 'Tone only decides which cells get a mark; each marked cell keeps its own glyph from the set (Seed reshuffles them).'
              : g.detail > 0
                ? "Detail compares each cell with each glyph's shape, so edges and diagonals get glyphs that look like them. Dithering spreads the tone left over to neighboring cells."
                : 'Dithering spreads the in-between tones across neighboring cells.'}
        </Text>
      </InspectorSection>

      <InspectorSection title="Marks">
        <InspectorRow label="Rotation">
          <SegmentedControl label="Rotation" size="sm" layout="fill" value={g.rot} onChange={v => setGen('rot', v)}>
            <SegmentedControlItem value="none" label="Upright" />
            <SegmentedControlItem value="fit" label="Fit" />
            <SegmentedControlItem value="random" label="Random" />
            <SegmentedControlItem value="checker" label="Checker" />
          </SegmentedControl>
        </InspectorRow>
        <SliderRow label="Gap" value={g.gap} min={0} max={0.45} step={0.01} format={v => Math.round(v * 100) + '%'} onChange={v => setGen('gap', v)} />
        <SliderRow label="Seed" value={g.seed} min={1} max={999} onChange={v => setGen('seed', v)} />
      </InspectorSection>

      <InspectorSection title="Color">
        <SegmentedControl label="Color mode" size="sm" layout="fill" value={g.color} onChange={v => setGen('color', v)}>
          <SegmentedControlItem value="mono" label="One ink" />
          <SegmentedControlItem value="source" label="From source" />
          <SegmentedControlItem value="palette" label="Palette" />
        </SegmentedControl>
        {g.color === 'mono' ? (
          <InspectorRow label="Ink">
            {INKS.map(c => (
              <PresetChip key={c} label="Ink" color={c} isOn={g.ink === c} onPick={() => setGen('ink', c)} />
            ))}
            <Swatch label="Custom ink" value={g.ink} onChange={v => setGen('ink', v)} />
          </InspectorRow>
        ) : null}
        {g.color === 'palette' || m.kind === 'ribbons' ? <PaletteEditor /> : null}
        <InspectorRow label="Paper">
          {PAPERS.map(c => (
            <PresetChip key={c} label="Paper" color={c} isOn={g.paper === c} onPick={() => setGen('paper', c)} />
          ))}
          <Swatch label="Custom paper" value={g.paper} onChange={v => setGen('paper', v)} />
        </InspectorRow>
        <Switch label="Transparent paper on export" size="sm" value={!!g.transparent} onChange={v => setGen('transparent', v)} />
      </InspectorSection>

      <InspectorSection title="Export">
        <InspectorRow label="Frame">
          <Selector
            label="Frame shape"
            isLabelHidden
            size="sm"
            width="100%"
            isDisabled={m.recording}
            value={g.frame || 'source'}
            options={FRAME_OPTIONS}
            onChange={v => setGen('frame', v)}
          />
        </InspectorRow>
        {g.frame === CUSTOM.id ? <CustomSizeRow w={g.customW} h={g.customH} isDisabled={m.recording} onChange={setGen} /> : null}
        <Text type="supporting">Frame cuts the middle of the source to that shape. The LED wall saves PNG, MP4 and recordings at exactly 3072 × 1408; Custom size at the width and height you type.</Text>
        <HStack gap={1} wrap="wrap">
          <Button label="Save PNG" size="sm" variant="primary" icon={<Icon icon={Download} size={ICON} />} onClick={exportPNG} />
          <Button label="Save SVG" size="sm" variant="primary" icon={<Icon icon={Download} size={ICON} />} onClick={exportSVG} />
          <Button label="Copy SVG" size="sm" icon={<Icon icon={ClipboardCopy} size={ICON} />} onClick={copySVG} />
        </HStack>
        <SendToRow make={pngBlob} isDisabled={m.exporting} onError={msg => toast(msg, 'error')} />
        <Text type="supporting">The SVG keeps every mark as a vector copy of its glyph symbol.</Text>
      </InspectorSection>
    </>
  );
}
