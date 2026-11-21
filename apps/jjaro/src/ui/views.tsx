// JJARO's panels: the stage, its tool bar, and the inspector.
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
import {Check, Dices, Download, Film, ImageDown, X, FolderOpen, ImageUp, Link, Pause, Play, RotateCcw, Save, Scan, Shuffle, Trash2, Wind} from 'lucide-react';
import {pickFiles} from '@studio/core';
import {SETUPS} from '../engine/cloth.js';
import {ASPECTS, METALS, PAPERS, PRESETS} from '../engine/config.js';
import {PATTERNS, PRINTS, MAX_LIGHTS} from '../engine/foil.js';
import {
  useStore, loadArt, clearArt, exportPNG, exportMP4, cancelMP4, videoSupported, videoSeconds, setExport, applyPreset, randomize, saveLook, applyLook, deleteLook, saveProject, openProject, copyLink, attachCanvas, pointerDown, pointerMove, pointerUp, wheel, set, setBackground, togglePlay, reset, reseed, gust, resetView,
} from '../engine/live.js';
import {fixedSize, fixedSizeLabel, frameLabel} from '@studio/core/frames';
import {ICON, InspectorRow, InspectorSection, PresetChip, SliderRow, Swatch} from './parts';

const styles = stylex.create({
  frame: {position: 'relative', width: '100%', height: '100%'},
  canvas: {display: 'block', borderRadius: 'var(--radius-container)', boxShadow: 'var(--shadow-med)', touchAction: 'none', cursor: 'grab'},
  grabbing: {cursor: 'grabbing'},
});

const openArt = async () => { const [f] = await pickFiles('image/*'); if (f) loadArt(f); };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const deg = (v: number) => `${Math.round(v)}°`;
const times = (v: number) => `${v.toFixed(2)}×`;

/* ================= stage ================= */
export function Stage() {
  const ref = useRef<HTMLCanvasElement>(null);
  const s = useStore();
  useEffect(() => {
    const c = ref.current;
    attachCanvas(c);
    // Scroll-to-zoom has to cancel the page scroll, which a passive listener can't.
    c?.addEventListener('wheel', wheel, {passive: false});
    return () => { c?.removeEventListener('wheel', wheel); attachCanvas(null); };
  }, []);
  if (!s.supported) {
    return (
      <Center height="100%">
        <Text type="supporting">This browser can't run WebGL2, which JJARO needs to draw.</Text>
      </Center>
    );
  }
  return (
    <Center xstyle={styles.frame}>
      <canvas
        ref={ref}
        role="img"
        aria-label="A sheet of cloth. Drag it to pull it around; drag the backdrop to turn the view."
        onPointerDown={e => pointerDown(e.nativeEvent)}
        onPointerMove={e => pointerMove(e.nativeEvent)}
        onPointerUp={e => pointerUp(e.nativeEvent)}
        onPointerCancel={e => pointerUp(e.nativeEvent)}
        {...stylex.props(styles.canvas, s.grabbing && styles.grabbing)}
      />
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
          <IconButton label="Start the sheet over" tooltip="Start over" size="sm" variant="ghost" icon={<Icon icon={RotateCcw} size={ICON} />} onClick={reset} />
          <IconButton label="Blow a gust of wind" tooltip="Gust" size="sm" variant="ghost" icon={<Icon icon={Wind} size={ICON} />} isDisabled={s.config.wind <= 0} onClick={gust} />
          <IconButton label="Reset the view" tooltip="Reset the view" size="sm" variant="ghost" icon={<Icon icon={Scan} size={ICON} />} onClick={resetView} />
          <Text type="supporting" maxLines={1}>Drag the cloth to pull it. Drag around it to turn.</Text>
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
        </HStack>
        <Text type="supporting">Presets and Randomize change the whole look but keep your detail and frame shape.</Text>
      </InspectorSection>

      <InspectorSection title="Sheet">
        <InspectorRow label="Setup">
          <Selector
            label="Setup"
            isLabelHidden
            size="sm"
            width="100%"
            value={c.setup}
            options={SETUPS.map(x => ({value: x.id, label: x.name}))}
            onChange={v => set('setup', v)}
          />
        </InspectorRow>
        <InspectorRow label="Detail">
          <Selector
            label="Detail"
            isLabelHidden
            size="sm"
            width="100%"
            value={c.quality}
            options={[{value: 'low', label: 'Low (fastest)'}, {value: 'medium', label: 'Medium'}, {value: 'high', label: 'High (finest folds)'}]}
            onChange={v => set('quality', v)}
          />
        </InspectorRow>
        <HStack gap={1} wrap="wrap">
          <Button label="Start over" size="sm" variant="secondary" icon={<Icon icon={RotateCcw} size={ICON} />} onClick={reset} />
          <Button label="New fall" size="sm" variant="ghost" icon={<Icon icon={Dices} size={ICON} />} onClick={reseed} />
        </HStack>
        <Text type="supporting">Start over drops the sheet again the same way. New fall changes how it starts, so it settles into different folds.</Text>
      </InspectorSection>

      <InspectorSection title="Cloth">
        <SliderRow label="Stiffness" value={c.stiffness} min={0} max={1} step={0.01} format={pct} onChange={v => set('stiffness', v)} />
        <SliderRow label="Gravity" value={c.gravity} min={0} max={2} step={0.01} format={times} onChange={v => set('gravity', v)} />
        <SliderRow label="Wind" value={c.wind} min={0} max={1} step={0.01} format={v => (v < 0.005 ? 'Still' : pct(v))} onChange={v => set('wind', v)} />
        <Text type="supporting">Stiffness sets how much folds spring back: low drapes like silk, high holds its shape like foil paper.</Text>
      </InspectorSection>

      <InspectorSection title="Foil">
        <InspectorRow label="Grooves">
          <Selector
            label="Groove pattern"
            isLabelHidden
            size="sm"
            width="100%"
            value={c.pattern}
            options={PATTERNS.map(p => ({value: p.id, label: p.name}))}
            onChange={v => set('pattern', v)}
          />
        </InspectorRow>
        <Text type="supporting">{PATTERNS.find(p => p.id === c.pattern)?.hint}</Text>
        <InspectorRow label="Metal">
          <Swatch label="Metal color" value={c.tint} onChange={v => set('tint', v)} />
          {METALS.map(m => (
            <PresetChip key={m.color} label={m.name} color={m.color} isOn={c.tint.toLowerCase() === m.color} onPick={() => set('tint', m.color)} />
          ))}
        </InspectorRow>
        <SliderRow label="Rainbow" value={c.rainbow} min={0} max={1} step={0.01} format={v => (v < 0.005 ? 'Plain' : pct(v))} onChange={v => set('rainbow', v)} />
        <SliderRow label="Spacing" value={c.spacing} min={0.6} max={2} step={0.01} format={v => `${v.toFixed(2)} µm`} onChange={v => set('spacing', v)} />
        <SliderRow label="Softness" value={c.spread} min={0} max={1} step={0.01} format={pct} onChange={v => set('spread', v)} />
        {c.pattern === 'cells' || c.pattern === 'swirl' ? (
          <SliderRow label={c.pattern === 'cells' ? 'Tiles' : 'Swirls'} value={c.scale} min={4} max={64} step={1} onChange={v => set('scale', v)} />
        ) : null}
        {c.pattern === 'linear' || c.pattern === 'swirl' ? (
          <SliderRow label="Angle" value={c.angle} min={-90} max={90} step={1} format={deg} onChange={v => set('angle', v)} />
        ) : null}
        <Text type="supporting">Spacing is the distance between grooves: closer grooves bend light further, so each rainbow spreads wider and repeats less.</Text>
      </InspectorSection>

      <InspectorSection title="Print">
        <InspectorRow label="Print">
          <Selector
            label="Print"
            isLabelHidden
            size="sm"
            width="100%"
            value={c.print}
            options={PRINTS.map(p => ({value: p.id, label: p.name}))}
            onChange={v => set('print', v)}
          />
        </InspectorRow>
        <Text type="supporting">{PRINTS.find(p => p.id === c.print)?.hint}</Text>
        {c.print !== 'none' ? (
          <>
            <InspectorRow label="Artwork">
              <Text type="body" maxLines={1}>{s.art?.name ?? 'None'}</Text>
            </InspectorRow>
            <HStack gap={1} wrap="wrap">
              <Button label="Choose image" size="sm" variant="secondary" icon={<Icon icon={ImageUp} size={ICON} />} onClick={openArt} />
              {s.art?.custom ? <Button label="Use the sample" size="sm" variant="ghost" onClick={clearArt} /> : null}
            </HStack>
            <SliderRow label="Size" value={c.artSize} min={0.1} max={1} step={0.01} format={pct} onChange={v => set('artSize', v)} />
            {c.print === 'ink' ? (
              <SliderRow label="Ink" value={c.ink} min={0} max={1} step={0.01} format={pct} onChange={v => set('ink', v)} />
            ) : (
              <Switch label="Print around the artwork instead" size="sm" value={c.invert} onChange={on => set('invert', on)} />
            )}
            {c.print === 'stamp' ? (
              <InspectorRow label="Paper">
                <Swatch label="Paper color" value={c.paper} onChange={v => set('paper', v)} />
                {PAPERS.map(p => (
                  <PresetChip key={p.color} label={p.name} color={p.color} isOn={c.paper.toLowerCase() === p.color} onPick={() => set('paper', p.color)} />
                ))}
              </InspectorRow>
            ) : null}
            <Text type="supporting">Drop or paste an image anywhere to print it. Shapes come from see-through backgrounds, or else from the dark parts.</Text>
          </>
        ) : null}
      </InspectorSection>

      <InspectorSection title="Lights">
        <SliderRow label="Lights" value={c.lights} min={1} max={MAX_LIGHTS} step={1} onChange={v => set('lights', v)} />
        <SliderRow label="Sweep" value={c.lightSwing} min={0} max={1} step={0.01} format={v => (v < 0.005 ? 'Still' : pct(v))} onChange={v => set('lightSwing', v)} />
        <SliderRow label="Size" value={c.lightSize} min={0} max={1} step={0.01} format={pct} onChange={v => set('lightSize', v)} />
        <SliderRow label="Every" value={c.period} min={4} max={20} step={1} format={v => `${v} s`} onChange={v => set('period', v)} />
        <Text type="supporting">Soft boxes sweep past the sheet and come back round every {c.period} seconds, so the foil flashes as they pass.</Text>
      </InspectorSection>

      <InspectorSection title="View">
        <InspectorRow label="Frame">
          <Selector
            label="Frame shape"
            isLabelHidden
            size="sm"
            width="100%"
            value={c.aspect}
            options={Object.keys(ASPECTS).map(k => ({value: k, label: frameLabel(k)}))}
            onChange={v => set('aspect', v)}
          />
        </InspectorRow>
        <SliderRow label="Orbit" value={c.orbit} min={-180} max={180} step={1} format={deg} onChange={v => set('orbit', v)} />
        <SliderRow label="Tilt" value={c.elevation} min={-30} max={70} step={1} format={deg} onChange={v => set('elevation', v)} />
        <SliderRow label="Zoom" value={c.zoom} min={0.6} max={2.5} step={0.01} format={times} onChange={v => set('zoom', v)} />
        <InspectorRow label="Backdrop">
          <Swatch label="Backdrop center" value={c.background[0]} onChange={v => setBackground(0, v)} />
          <Swatch label="Backdrop edge" value={c.background[1]} onChange={v => setBackground(1, v)} />
        </InspectorRow>
        <Text type="supporting">On a touch screen, pinch to zoom. With a mouse, scroll.</Text>
      </InspectorSection>

      <InspectorSection title="Finish">
        <SliderRow label="Glow" value={c.glow} min={0} max={1} step={0.01} format={v => (v < 0.005 ? 'Off' : pct(v))} onChange={v => set('glow', v)} />
        <SliderRow label="Blur" value={c.blur} min={0} max={1} step={0.01} format={v => (v < 0.005 ? 'Off' : pct(v))} onChange={v => set('blur', v)} />
        {c.blur > 0 ? (
          <SliderRow label="Focus" value={c.focus} min={0} max={1} step={0.01} format={v => (v < 0.15 ? 'Near' : v > 0.85 ? 'Far' : pct(v))} onChange={v => set('focus', v)} />
        ) : null}
        <SliderRow label="Grain" value={c.grain} min={0} max={1} step={0.01} format={v => (v < 0.005 ? 'Off' : pct(v))} onChange={v => set('grain', v)} />
        <Text type="supporting">Glow softens the brightest flashes. Blur is a camera's depth of field: Focus picks the part of the sheet that stays sharp.</Text>
      </InspectorSection>

      <ExportSection />

      <LooksSection />
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
              description={`${SETUPS.find(x => x.id === l.config.setup)?.name ?? ''} · ${PATTERNS.find(x => x.id === l.config.pattern)?.name ?? ''}`}
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
        <Text type="supporting">Save a look under a name to come back to it. Looks stay in this browser and use whatever artwork is loaded.</Text>
      )}
      <HStack gap={1} wrap="wrap">
        <Button label="Copy link" size="sm" variant="ghost" icon={<Icon icon={Link} size={ICON} />} onClick={copyLink} />
        <Button label="Save project" size="sm" variant="ghost" icon={<Icon icon={Download} size={ICON} />} onClick={saveProject} />
        <Button label="Open project" size="sm" variant="ghost" icon={<Icon icon={FolderOpen} size={ICON} />} onClick={openProjectFile} />
      </HStack>
      <Text type="supporting">A link holds every setting but not your image. A project file holds both. You can also drop a project file on the page.</Text>
    </InspectorSection>
  );
}

function ExportSection() {
  const s = useStore();
  const canVideo = videoSupported();
  return (
    <InspectorSection title="Export">
      <InspectorRow label="Image">
        {fixedSize(s.config.aspect) ? (
          <Text type="body">{fixedSizeLabel(s.config.aspect)}</Text>
        ) : (
          <Selector
            label="Image size"
            isLabelHidden
            size="sm"
            width="100%"
            value={String(s.exportSize)}
            options={[1080, 2160, 4096, 8192].map(v => ({value: String(v), label: `${v} px long side`}))}
            onChange={v => setExport('exportSize', Number(v))}
          />
        )}
      </InspectorRow>
      <Switch label="Transparent background" size="sm" value={s.transparent} onChange={on => setExport('transparent', on)} />
      <InspectorRow label="Video">
        {fixedSize(s.config.aspect) ? (
          <Text type="body">{fixedSizeLabel(s.config.aspect)}</Text>
        ) : (
          <Selector
            label="Video size"
            isLabelHidden
            size="sm"
            width="100%"
            value={String(s.videoSize)}
            options={[1080, 1440, 2160].map(v => ({value: String(v), label: `${v} px long side`}))}
            onChange={v => setExport('videoSize', Number(v))}
          />
        )}
      </InspectorRow>
      <SliderRow label="Loops" value={s.loops} min={1} max={4} step={1} format={v => `${v} × ${s.config.period} s`} onChange={v => setExport('loops', v)} />
      <Switch label="Turn the camera gently" size="sm" value={s.sway} onChange={on => setExport('sway', on)} />
      {s.exporting ? (
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <ProgressBar label="Rendering video" value={s.exporting.done} max={s.exporting.total} hasValueLabel formatValueLabel={(v, m) => `${v} / ${m} frames`} />
          </StackItem>
          <IconButton label="Cancel the video" tooltip="Cancel" size="sm" variant="ghost" icon={<Icon icon={X} size={ICON} />} onClick={cancelMP4} />
        </HStack>
      ) : (
        <HStack gap={1} wrap="wrap">
          <Button label="Save PNG" size="sm" variant="secondary" icon={<Icon icon={ImageDown} size={ICON} />} onClick={exportPNG} />
          <Button label="Render MP4" size="sm" variant="secondary" icon={<Icon icon={Film} size={ICON} />} isDisabled={!canVideo} onClick={exportMP4} />
        </HStack>
      )}
      <Text type="supporting">
        {canVideo
          ? `Both keep the folds as they are now. The MP4 is ${videoSeconds()} s at 30 fps: the lights come round ${s.loops === 1 ? 'once' : s.loops + ' times'}, so it loops without a jump.`
          : 'Both keep the folds as they are now. Video export needs Chrome or Edge.'}
      </Text>
    </InspectorSection>
  );
}
