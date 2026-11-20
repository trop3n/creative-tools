// JJARO's panels: the stage, its tool bar, and the inspector.
import {useEffect, useRef} from 'react';
import * as stylex from '@stylexjs/stylex';
import {Button} from '@astryxdesign/core/Button';
import {Center} from '@astryxdesign/core/Center';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {HStack} from '@astryxdesign/core/Layout';
import {Selector} from '@astryxdesign/core/Selector';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {Toolbar} from '@astryxdesign/core/Toolbar';
import {Dices, ImageUp, Pause, Play, RotateCcw, Scan, Wind} from 'lucide-react';
import {pickFiles} from '@studio/core';
import {SETUPS} from '../engine/cloth.js';
import {ASPECTS} from '../engine/config.js';
import {PATTERNS, PRINTS, MAX_LIGHTS} from '../engine/foil.js';
import {
  useStore, loadArt, clearArt, attachCanvas, pointerDown, pointerMove, pointerUp, wheel, set, setBackground, togglePlay, reset, reseed, gust, resetView,
} from '../engine/live.js';
import {ICON, InspectorRow, InspectorSection, PresetChip, SliderRow, Swatch} from './parts';

const styles = stylex.create({
  frame: {position: 'relative', width: '100%', height: '100%'},
  canvas: {display: 'block', borderRadius: 'var(--radius-container)', boxShadow: 'var(--shadow-med)', touchAction: 'none', cursor: 'grab'},
  grabbing: {cursor: 'grabbing'},
});

const METALS = [
  {name: 'Silver', color: '#dfe3ea'},
  {name: 'Gold', color: '#e8c27a'},
  {name: 'Rose gold', color: '#e8b0a0'},
  {name: 'Gunmetal', color: '#7d838c'},
];

const PAPERS = [
  {name: 'Cream', color: '#ece6da'},
  {name: 'White', color: '#f4f4f2'},
  {name: 'Black', color: '#1d1d1f'},
  {name: 'Navy', color: '#00304e'},
];

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
            options={Object.keys(ASPECTS).map(k => ({value: k, label: k}))}
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
    </>
  );
}
