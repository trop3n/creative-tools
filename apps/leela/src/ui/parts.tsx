// Inspector building blocks (the same set as DURANDAL's ui/parts.tsx), adapted from the canvas-editor template's inspector
// helpers (InspectorSection, InspectorRow, ColorPicker, Swatch).
import {useCallback, useState, type ReactNode} from 'react';
import * as stylex from '@stylexjs/stylex';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Layout';
import {Popover} from '@astryxdesign/core/Popover';
import {Section} from '@astryxdesign/core/Section';
import {Slider} from '@astryxdesign/core/Slider';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Theme, defineTheme} from '@astryxdesign/core/theme';

/** Width of the inspector's label column, in pixels: one left edge for every control. */
export const LABEL_COLUMN = 80;
export const ICON = 'sm' as const;

const styles = stylex.create({
  labelColumn: {flexShrink: 0},
  swatch: {
    width: 'var(--spacing-7)',
    height: 'var(--spacing-7)',
    flexShrink: 0,
    padding: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--color-border-emphasized)',
    borderRadius: 'var(--radius-element)',
    cursor: 'pointer',
  },
  swatchOn: {outlineWidth: '2px', outlineStyle: 'solid', outlineColor: 'var(--color-accent)', outlineOffset: '1px'},
  plane: {
    position: 'relative',
    height: 160,
    borderRadius: 'var(--radius-inner)',
    backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
    cursor: 'crosshair',
    touchAction: 'none',
  },
  thumb: {
    position: 'absolute',
    width: 'var(--spacing-3)',
    height: 'var(--spacing-3)',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: '#fff',
    borderRadius: 'var(--radius-full)',
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.35)',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
  },
  planeStack: {display: 'grid', gap: 'var(--spacing-3)'},
});
const paint = stylex.create({
  hue: (h: number) => ({backgroundColor: `hsl(${h} 100% 50%)`}),
  planeThumb: (s: number, v: number) => ({insetInlineStart: `${s}%`, insetBlockStart: `${100 - v}%`}),
  fill: (color: string) => ({backgroundColor: color}),
});
// The hue rail is a Slider whose track is the only custom paint.
const hueTheme = defineTheme({
  name: 'leela-hue',
  components: {
    'slider-track': {base: {backgroundImage: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)'}},
  },
});

export function InspectorRow({label, hAlign, children}: {label: string; hAlign?: 'start' | 'end'; children: ReactNode}) {
  return (
    <HStack gap={2} vAlign="center">
      <HStack width={LABEL_COLUMN} xstyle={styles.labelColumn}>
        <Text type="label" color="secondary" maxLines={1}>
          {label}
        </Text>
      </HStack>
      <StackItem size="fill">
        <HStack gap={1} vAlign="center" hAlign={hAlign} wrap="wrap">
          {children}
        </HStack>
      </StackItem>
    </HStack>
  );
}

export function InspectorSection({title, children}: {title: string; children: ReactNode}) {
  return (
    <Section padding={3} dividers={['bottom']}>
      <VStack gap={3}>
        <Text type="label" weight="semibold">
          {title}
        </Text>
        {children}
      </VStack>
    </Section>
  );
}

/** A slider row with a fixed label column and a text readout. */
export function SliderRow({label, value, min, max, step, format, onChange, isDisabled}: {
  label: string; value: number; min: number; max: number; step?: number; format?: (v: number) => string;
  onChange: (v: number) => void; isDisabled?: boolean;
}) {
  return (
    <InspectorRow label={label}>
      <StackItem size="fill">
        <Slider
          label={label}
          isLabelHidden
          min={min}
          max={max}
          step={step ?? 1}
          value={value}
          onChange={(v: number) => onChange(v)}
          valueDisplay="text"
          formatValue={format}
          isDisabled={isDisabled}
          disabledMessage={isDisabled ? 'Not available right now' : undefined}
        />
      </StackItem>
    </InspectorRow>
  );
}

/* ---------- colour ---------- */
interface Hsv { h: number; s: number; v: number }
function hsvToHex({h, s, v}: Hsv): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    const value = (v / 100) * (1 - (s / 100) * Math.max(0, Math.min(k, 4 - k, 1)));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}
function hexToHsv(hex: string): Hsv {
  const parsed = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!parsed) return {h: 0, s: 0, v: 0};
  const int = parseInt(parsed[1], 16);
  const r = ((int >> 16) & 255) / 255, g = ((int >> 8) & 255) / 255, b = (int & 255) / 255;
  const max = Math.max(r, g, b), span = max - Math.min(r, g, b);
  let h = 0;
  if (span !== 0) h = max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return {h: (Math.round(h * 60) + 360) % 360, s: max === 0 ? 0 : Math.round((span / max) * 100), v: Math.round(max * 100)};
}
function usePointerTrack(onTrack: (x: number, y: number) => void) {
  const read = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      onTrack(
        Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
        Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
      );
    },
    [onTrack],
  );
  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => { event.currentTarget.setPointerCapture(event.pointerId); read(event); },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) read(event); },
  };
}
function ColorPicker({value, onChange}: {value: string; onChange: (next: string) => void}) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [draft, setDraft] = useState(value);
  const commit = useCallback((next: Hsv) => { setHsv(next); const hex = hsvToHex(next); setDraft(hex); onChange(hex); }, [onChange]);
  const planeTrack = usePointerTrack(
    useCallback((x, y) => commit({...hsv, s: Math.round(x * 100), v: Math.round(100 - y * 100)}), [commit, hsv]),
  );
  const nudge = (event: React.KeyboardEvent) => {
    const sign = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    if (!sign) return;
    event.preventDefault();
    const horizontal = event.key === 'ArrowRight' || event.key === 'ArrowLeft';
    const c = (n: number) => Math.min(100, Math.max(0, n));
    commit({h: hsv.h, s: c(hsv.s + (horizontal ? sign * 2 : 0)), v: c(hsv.v + (horizontal ? 0 : sign * 2))});
  };
  return (
    <div {...stylex.props(styles.planeStack)}>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`${hsv.s}% saturation, ${hsv.v}% brightness`}
        aria-valuenow={hsv.s}
        aria-valuemin={0}
        aria-valuemax={100}
        onKeyDown={nudge}
        {...planeTrack}
        {...stylex.props(styles.plane, paint.hue(hsv.h))}>
        <span {...stylex.props(styles.thumb, paint.planeThumb(hsv.s, hsv.v), paint.fill(hsvToHex(hsv)))} />
      </div>
      <Theme theme={hueTheme}>
        <Slider label="Hue" isLabelHidden min={0} max={360} value={hsv.h} onChange={(h: number) => commit({...hsv, h})} valueDisplay="none" />
      </Theme>
      <TextInput
        label="Hex"
        isLabelHidden
        size="sm"
        value={draft}
        onChange={next => {
          setDraft(next);
          if (/^#?[\da-f]{6}$/i.test(next.trim())) { setHsv(hexToHsv(next)); onChange(next.startsWith('#') ? next : `#${next}`); }
        }}
      />
    </div>
  );
}

/** A chip that opens a colour picker. */
export function Swatch({label, value, onChange}: {label: string; value: string; onChange: (next: string) => void}) {
  return (
    <Popover
      label={label}
      placement="start"
      alignment="start"
      width={248}
      content={
        <VStack gap={3}>
          <Text type="label" weight="semibold">
            {label}
          </Text>
          <ColorPicker value={value} onChange={onChange} />
        </VStack>
      }>
      <button type="button" aria-label={`${label}, ${value}. Open picker`} {...stylex.props(styles.swatch, paint.fill(value))} />
    </Popover>
  );
}

/** A one-click preset chip. */
/** A color chip; without onPick it only shows the color. */
export function PresetChip({color, isOn, onPick, label}: {color: string; isOn: boolean; onPick?: () => void; label: string}) {
  return (
    <button
      type="button"
      aria-label={`${label} ${color}`}
      aria-pressed={onPick ? isOn : undefined}
      disabled={!onPick}
      title={onPick ? color : `${label} ${color}`}
      onClick={onPick}
      {...stylex.props(styles.swatch, paint.fill(color), isOn && styles.swatchOn)}
    />
  );
}
