// LEELA: animated grainy gradients and mesh gradients. For now: the live canvas,
// presets, a randomizer and play/pause. The inspector comes next.
import {useEffect, useRef, useState} from 'react';
import * as stylex from '@stylexjs/stylex';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Center} from '@astryxdesign/core/Center';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {HStack, Layout, LayoutContent, LayoutFooter, LayoutHeader} from '@astryxdesign/core/Layout';
import {Section} from '@astryxdesign/core/Section';
import {Selector} from '@astryxdesign/core/Selector';
import {Text} from '@astryxdesign/core/Text';
import {Theme} from '@astryxdesign/core/theme';
import {Toolbar} from '@astryxdesign/core/Toolbar';
import {Pause, Play, RotateCcw, Shuffle} from 'lucide-react';
import {studioTheme} from '@studio/theme';
import {PRESETS} from '@studio/core/gradient';
import {saved, useStore, attachCanvas, applyPreset, randomize, togglePlay, restart} from './engine/live.js';

const ICON = 16;
type Mode = 'light' | 'dark' | 'system';

const styles = stylex.create({
  mark: {width: 'var(--spacing-5)', height: 'var(--spacing-5)', color: 'var(--color-accent)', flexShrink: 0},
  brand: {letterSpacing: '0.3em'},
  wideOnly: {display: {default: null, '@media (max-width: 599.98px)': 'none'}},
  canvas: {display: 'block', width: '100%', height: '100%', borderRadius: 'var(--radius-container)', boxShadow: 'var(--shadow-med)'},
  toolBarCard: {maxWidth: '100%'},
});

/** Three soft rings fading out: the tool's mark. */
function Mark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stylex.props(styles.mark)}>
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.25" />
      <circle cx="12" cy="12" r="7.5" fill="currentColor" opacity="0.55" />
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  );
}

function Stage() {
  const ref = useRef<HTMLCanvasElement>(null);
  const s = useStore();
  useEffect(() => { attachCanvas(ref.current); return () => attachCanvas(null); }, []);
  return s.supported ? (
    <canvas ref={ref} aria-label="Gradient" {...stylex.props(styles.canvas)} />
  ) : (
    <Center height="100%">
      <Text type="supporting">This browser can't run WebGL2, which LEELA needs to draw.</Text>
    </Center>
  );
}

function StageToolbar() {
  const s = useStore();
  return (
    <Toolbar
      label="Gradient controls"
      size="sm"
      startContent={
        <>
          <IconButton label={s.playing ? 'Pause' : 'Play'} tooltip={s.playing ? 'Pause' : 'Play'} size="sm" variant="ghost" icon={<Icon icon={s.playing ? Pause : Play} size={ICON} />} onClick={togglePlay} />
          <IconButton label="Back to the start" tooltip="Back to the start" size="sm" variant="ghost" icon={<Icon icon={RotateCcw} size={ICON} />} onClick={restart} />
          <Selector
            label="Preset"
            isLabelHidden
            size="sm"
            width={160}
            placeholder="Preset"
            value={s.preset}
            options={PRESETS.map(p => ({value: p.id, label: p.name}))}
            onChange={v => applyPreset(v)}
          />
          <Button label="Randomize" size="sm" variant="secondary" icon={<Icon icon={Shuffle} size={ICON} />} onClick={randomize} />
        </>
      }
      endContent={
        <Text type="supporting" hasTabularNumbers>
          {s.config.shape} · {s.config.motion} · {s.time.toFixed(1)} s
        </Text>
      }
    />
  );
}

export default function App() {
  const [appearance, setAppearance] = useState<Mode>(() => (saved.get('mode') as Mode) || 'system');
  return (
    <Theme theme={studioTheme} mode={appearance}>
      <Section variant="section" padding={0} height="100%">
        <Layout
          height="fill"
          padding={0}
          header={
            <LayoutHeader hasDivider padding={2}>
              <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
                <HStack gap={2} vAlign="center">
                  <Mark />
                  <Text type="label" weight="bold" xstyle={styles.brand}>LEELA</Text>
                  <Text type="supporting" xstyle={styles.wideOnly}>Gradient studio</Text>
                </HStack>
                <Selector
                  label="Appearance"
                  isLabelHidden
                  size="sm"
                  variant="ghost"
                  width={120}
                  value={appearance}
                  options={[{value: 'system', label: 'System'}, {value: 'light', label: 'Light'}, {value: 'dark', label: 'Dark'}]}
                  onChange={v => { setAppearance(v as Mode); saved.set('mode', v); }}
                />
              </HStack>
            </LayoutHeader>
          }
          content={
            <LayoutContent padding={0}>
              <Section variant="muted" padding={0} height="100%">
                <Layout
                  height="fill"
                  padding={4}
                  content={
                    <LayoutContent padding={4} isScrollable={false} label="Gradient">
                      <Stage />
                    </LayoutContent>
                  }
                  footer={
                    <LayoutFooter>
                      <Center>
                        <Card padding={1} elevation="high" xstyle={styles.toolBarCard}>
                          <StageToolbar />
                        </Card>
                      </Center>
                    </LayoutFooter>
                  }
                />
              </Section>
            </LayoutContent>
          }
        />
      </Section>
    </Theme>
  );
}

