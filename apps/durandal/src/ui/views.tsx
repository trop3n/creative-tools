// DURANDAL's panels: the style list (rail), the stage, its tool bar, and the inspector.
import {useEffect, useRef} from 'react';
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
import {IconButton} from '@astryxdesign/core/IconButton';
import {Camera, CameraOff, Circle, Clapperboard, Download, ImageUp, Pause, Play, RotateCcw, Square, Volume2, VolumeX} from 'lucide-react';
import {pickFiles, canEncodeVideo} from '@studio/core';
import {STYLES, STYLE_BY_ID} from '@studio/core/dither';
import {useStore, currentParams} from '../engine/state.js';
import {setCanvas, setSetting, setParam, setStyle, setLook, resetTone, exportPNG, gpuAvailable} from '../engine/render.js';
import {
  SAMPLES, loadSample, loadFile, playPause, seekFraction, setSound, setVolume, renderVideo, startWebcam, stopCamera,
  setMirrorImage, toggleRecord,
} from '../engine/media.js';
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
  bayer: 'Regular crosshatch grid. Retro screens.',
  bittone: 'Clustered 4×4 dots, print-like.',
  dots: 'Round halftone dots on a rotated grid.',
  lines: 'Engraved lines that swell in shadow.',
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
});

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

const openMedia = async () => { const [f] = await pickFiles('image/*,video/*'); loadFile(f); };
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
        <SliderRow label="Threshold" value={st.threshold} min={0} max={100} format={v => `${v}%`} onChange={v => setSetting('threshold', v)} />
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
      </InspectorSection>

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
        isDisabled={m.exporting}
      />
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
