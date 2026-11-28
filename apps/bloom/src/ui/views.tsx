// BLOOM's panels: the stage, its tool bar, and the inspector.
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
import {ToggleButton} from '@astryxdesign/core/ToggleButton';
import {Toolbar} from '@astryxdesign/core/Toolbar';
import {
  Check, Dices, Download, FastForward, Film, FolderOpen, Image, Link, Minus, Pause, Play, Plus, RotateCcw, Save, Shuffle, Sprout, Trash2, X,
} from 'lucide-react';
import {pickFiles} from '@studio/core';
import {SPECIES, SPECIES_IDS} from '../engine/plant.js';
import {PRESETS, PALETTES, ASPECTS, MAX_RAMPS, MAX_RAMP_STOPS} from '../engine/config.js';
import {asHex} from '../engine/color.js';
import {
  useStore, attachCanvas, applyPreset, randomize, reseed, togglePlay, restart, skipToBloom, set, toggleSpecies,
  applyPalette, setRampStop, addRamp, removeRamp, addRampStop, removeRampStop, setStemColor, setBackground, shuffleColors,
  exportPNG, exportMP4, cancelMP4, renderPNG, renderMP4, toast, videoSupported, videoSeconds, setExportSize, setExportLength, localTime, doneAt,
  saveLook, applyLook, deleteLook, saveProject, openProject, copyLink,
} from '../engine/live.js';
import {CUSTOM, fixedSize, fixedSizeLabel, frameIds, frameLabel} from '@studio/core/frames';
import {ICON, InspectorRow, InspectorSection, SliderRow, Swatch, CustomSizeRow} from './parts';
import {SaveRecipeRow, SendToRow} from './suite';

const styles = stylex.create({
  frame: {position: 'relative', width: '100%', height: '100%'},
  canvas: {display: 'block', borderRadius: 'var(--radius-container)', boxShadow: 'var(--shadow-med)'},
});

const pct = (v: number) => `${Math.round(v * 100)}%`;
const deg = (v: number) => `${Math.round(v)}°`;
const times = (v: number) => `${v.toFixed(2)}×`;

/* ================= stage ================= */
export function Stage() {
  const ref = useRef<HTMLCanvasElement>(null);
  const s = useStore();
  useEffect(() => { attachCanvas(ref.current); return () => attachCanvas(null); }, []);
  if (!s.supported) {
    return (
      <Center height="100%">
        <Text type="supporting">This browser can't run WebGL2, which BLOOM needs to draw.</Text>
      </Center>
    );
  }
  return (
    <Center xstyle={styles.frame}>
      <canvas ref={ref} role="img" aria-label="Flowers growing on a gradient backdrop" {...stylex.props(styles.canvas)} />
    </Center>
  );
}

export function StageToolbar() {
  const s = useStore();
  const lt = localTime(s.config, s.time);
  return (
    <Toolbar
      label="Playback"
      size="sm"
      startContent={
        <>
          <IconButton label={s.playing ? 'Pause' : 'Play'} tooltip={s.playing ? 'Pause' : 'Play'} size="sm" variant="ghost" icon={<Icon icon={s.playing ? Pause : Play} size={ICON} />} onClick={togglePlay} />
          <IconButton label="Grow again from the start" tooltip="Grow again" size="sm" variant="ghost" icon={<Icon icon={RotateCcw} size={ICON} />} onClick={restart} />
          <IconButton label="Skip to full bloom" tooltip="Skip to full bloom" size="sm" variant="ghost" icon={<Icon icon={FastForward} size={ICON} />} onClick={skipToBloom} />
          <Text type="supporting" hasTabularNumbers maxLines={1}>
            {s.config.cycle > 0 ? `${lt.t.toFixed(1)} / ${s.config.cycle} s` : `${s.time.toFixed(1)} s`}
          </Text>
          <IconButton label="Grow a new plant" tooltip="New plant, same settings" size="sm" variant="ghost" icon={<Icon icon={Sprout} size={ICON} />} onClick={reseed} />
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
          <Button label="New plant" size="sm" variant="ghost" icon={<Icon icon={Dices} size={ICON} />} onClick={reseed} />
        </HStack>
        <Text type="supporting">Randomize makes a whole new scene. New plant keeps every setting and grows a different plant from them.</Text>
      </InspectorSection>

      <InspectorSection title="Flowers">
        <HStack gap={1} wrap="wrap">
          {SPECIES_IDS.map(id => (
            <ToggleButton key={id} label={SPECIES[id].name} size="sm" isPressed={c.species.includes(id)} onPressedChange={on => toggleSpecies(id, on)} />
          ))}
        </HStack>
        <SliderRow label="Stems" value={c.stems} min={1} max={7} step={1} onChange={v => set('stems', v)} />
        <SliderRow label="Branches" value={c.branching} min={0} max={1} step={0.01} format={pct} onChange={v => set('branching', v)} />
        <SliderRow label="Bloom size" value={c.bloomSize} min={0.5} max={1.8} step={0.01} format={times} onChange={v => set('bloomSize', v)} />
        <SliderRow label="Leaves" value={c.leaves} min={0} max={1} step={0.01} format={pct} onChange={v => set('leaves', v)} />
        <Text type="supporting">Each stem picks one of the chosen flowers; branches mostly match their stem.</Text>
      </InspectorSection>

      <InspectorSection title="Growth">
        <SliderRow label="Height" value={c.height} min={0.6} max={1.4} step={0.01} format={times} onChange={v => set('height', v)} />
        <SliderRow label="Wander" value={c.wander} min={0} max={1} step={0.01} format={pct} onChange={v => set('wander', v)} />
        <SliderRow label="Speed" value={c.speed} min={0.25} max={3} step={0.05} format={times} onChange={v => set('speed', v)} />
        <SliderRow label="Wind" value={c.sway} min={0} max={1} step={0.01} format={pct} onChange={v => set('sway', v)} />
        <Switch label="Regrow on a loop" size="sm" value={c.cycle > 0} onChange={on => set('cycle', on ? 8 : 0)} />
        {c.cycle > 0 ? <SliderRow label="Every" value={c.cycle} min={3} max={30} step={1} format={v => `${v} s`} onChange={v => set('cycle', v)} /> : null}
        <Text type="supporting">
          {c.cycle > 0
            ? `A new plant grows every ${c.cycle} seconds. This one is fully open at ${doneAt().toFixed(1)} s.`
            : `Grows once and stays open, moving in the wind. Fully open at ${doneAt().toFixed(1)} s.`}
        </Text>
      </InspectorSection>

      <ColorsSection />

      <InspectorSection title="Camera">
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
        <SliderRow label="Zoom" value={c.zoom} min={0.6} max={3} step={0.01} format={times} onChange={v => set('zoom', v)} />
        <SliderRow label="Orbit" value={c.orbit} min={-180} max={180} step={1} format={deg} onChange={v => set('orbit', v)} />
        <SliderRow label="Tilt" value={c.elevation} min={-20} max={45} step={1} format={deg} onChange={v => set('elevation', v)} />
        <SliderRow label="Drift" value={c.drift} min={0} max={1} step={0.01} format={pct} onChange={v => set('drift', v)} />
        <SliderRow label="Blur" value={c.blur} min={0} max={1} step={0.01} format={v => (v < 0.005 ? 'Off' : pct(v))} onChange={v => set('blur', v)} />
        {c.blur > 0 ? <SliderRow label="Focus" value={c.focus} min={0} max={1} step={0.01} format={v => (v < 0.2 ? 'Near' : v > 0.8 ? 'Far' : pct(v))} onChange={v => set('focus', v)} /> : null}
        <Text type="supporting">Drift moves the camera slowly around the plant. Blur adds depth of field: pair it with zoom for soft, close-up shots.</Text>
      </InspectorSection>

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
      {c.ramps.map((ramp, r) => (
        <InspectorRow key={r} label={`Petals ${r + 1}`}>
          {ramp.map((col, i) => (
            <Swatch key={i} label={`Petals ${r + 1}, ${i === 0 ? 'base' : i === ramp.length - 1 ? 'tip' : `color ${i + 1}`}`} value={asHex(col)} onChange={v => setRampStop(r, i, v)} />
          ))}
          {ramp.length < MAX_RAMP_STOPS ? <IconButton label={`Add a color to petals ${r + 1}`} tooltip="Add a color" size="sm" variant="ghost" icon={<Icon icon={Plus} size={ICON} />} onClick={() => addRampStop(r)} /> : null}
          {ramp.length > 2 ? <IconButton label={`Remove the tip color of petals ${r + 1}`} tooltip="Remove a color" size="sm" variant="ghost" icon={<Icon icon={Minus} size={ICON} />} onClick={() => removeRampStop(r)} /> : null}
          {c.ramps.length > 1 ? <IconButton label={`Delete petals ${r + 1}`} tooltip="Delete this ramp" size="sm" variant="ghost" icon={<Icon icon={Trash2} size={ICON} />} onClick={() => removeRamp(r)} /> : null}
        </InspectorRow>
      ))}
      <HStack gap={1} wrap="wrap">
        <Button label="Add a ramp" size="sm" variant="ghost" icon={<Icon icon={Plus} size={ICON} />} isDisabled={c.ramps.length >= MAX_RAMPS} onClick={addRamp} />
        <Button label="Shuffle" size="sm" variant="ghost" icon={<Icon icon={Shuffle} size={ICON} />} onClick={shuffleColors} />
      </HStack>
      <InspectorRow label="Stems">
        <Swatch label="Stem shadow" value={asHex(c.stem[0])} onChange={v => setStemColor(0, v)} />
        <Swatch label="Stem light" value={asHex(c.stem[1])} onChange={v => setStemColor(1, v)} />
      </InspectorRow>
      <InspectorRow label="Backdrop">
        <Swatch label="Backdrop top" value={asHex(c.background[0])} onChange={v => setBackground(0, v)} />
        <Swatch label="Backdrop middle" value={asHex(c.background[1])} onChange={v => setBackground(1, v)} />
        <Swatch label="Backdrop bottom" value={asHex(c.background[2])} onChange={v => setBackground(2, v)} />
      </InspectorRow>
      <Text type="supporting">Each flower takes one petal ramp, running from the base of each petal to its tip. Colors blend in Oklab.</Text>
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
            options={[1080, 1440, 2160].map(v => ({value: String(v), label: `${v} px long side`}))}
            onChange={v => setExportSize(Number(v))}
          />
        )}
      </InspectorRow>
      {s.config.cycle > 0 ? null : (
        <SliderRow label="Length" value={s.exportLength} min={2} max={30} step={1} format={v => `${v} s`} onChange={setExportLength} />
      )}
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
          <Button label="Render MP4" size="sm" variant="secondary" icon={<Icon icon={Film} size={ICON} />} isDisabled={!canVideo} onClick={exportMP4} />
        </HStack>
      )}
      <SendToRow kind="image" make={renderPNG} isDisabled={!!s.exporting} onError={m => toast(m, 'error')} />
      <SendToRow kind="video" make={renderMP4} isDisabled={!!s.exporting || !canVideo} onError={m => toast(m, 'error')} />
      <SaveRecipeRow kind="video" onSaved={name => toast(`Saved the recipe "${name}"`)} />
      <Text type="supporting">
        {canVideo
          ? `The PNG is the frame on screen. The MP4 renders ${videoSeconds()} s at 30 fps from the first sprout, frame by frame, so it never drops a frame.`
          : 'The PNG is the frame on screen. Video export needs Chrome or Edge.'}
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
              description={l.config.species.map((id: string) => SPECIES[id]?.name ?? id).join(', ')}
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
        <Text type="supporting">Save a scene under a name to come back to it. Looks stay in this browser.</Text>
      )}
      <HStack gap={1} wrap="wrap">
        <Button label="Copy link" size="sm" variant="ghost" icon={<Icon icon={Link} size={ICON} />} onClick={copyLink} />
        <Button label="Save project" size="sm" variant="ghost" icon={<Icon icon={Download} size={ICON} />} onClick={saveProject} />
        <Button label="Open project" size="sm" variant="ghost" icon={<Icon icon={FolderOpen} size={ICON} />} onClick={openProjectFile} />
      </HStack>
      <Text type="supporting">A link or a project file holds the whole scene, to share or keep. You can also drop a project file on the page.</Text>
    </InspectorSection>
  );
}
