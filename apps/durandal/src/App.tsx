// DURANDAL app frame, on the canvas-editor template's frame (same as GLYF): a header
// over a resizable style rail | muted stage with a floating tool bar | resizable inspector.
import {useEffect, useState} from 'react';
import * as stylex from '@stylexjs/stylex';
import {Card} from '@astryxdesign/core/Card';
import {Center} from '@astryxdesign/core/Center';
import {Drawer} from '@astryxdesign/core/Drawer';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Icon} from '@astryxdesign/core/Icon';
import {LayerProvider} from '@astryxdesign/core/Layer';
import {HStack, StackItem, Layout, LayoutContent, LayoutFooter, LayoutHeader, LayoutPanel} from '@astryxdesign/core/Layout';
import {ResizeHandle, useResizable} from '@astryxdesign/core/Resizable';
import {Section} from '@astryxdesign/core/Section';
import {Selector} from '@astryxdesign/core/Selector';
import {Text} from '@astryxdesign/core/Text';
import {Theme} from '@astryxdesign/core/theme';
import {useToast} from '@astryxdesign/core/Toast';
import {PanelLeft, Settings2} from 'lucide-react';
import {studioTheme} from '@studio/theme';
import {saved, setToast, toast} from './engine/state.js';
import {initSource, loadFile} from './engine/render.js';
import {StyleRail, Stage, StageToolbar, Inspector} from './ui/views';
import {ICON} from './ui/parts';

initSource();

type Mode = 'light' | 'dark' | 'system';
const HIDE_INSPECTOR = '@media (max-width: 1099.98px)';
const HIDE_RAIL = '@media (max-width: 839.98px)';
const styles = stylex.create({
  foldsAtRail: {display: {default: null, [HIDE_RAIL]: 'none'}},
  foldsAtInspector: {display: {default: null, [HIDE_INSPECTOR]: 'none'}},
  mark: {width: 'var(--spacing-5)', height: 'var(--spacing-5)', color: 'var(--color-accent)', flexShrink: 0},
  brand: {letterSpacing: '0.3em'},
  toolBarCard: {maxWidth: '100%'},
  narrowOnly: {display: {default: 'none', [HIDE_INSPECTOR]: null}},
  railButton: {display: {default: 'none', [HIDE_RAIL]: null}},
  wideOnly: {display: {default: null, '@media (max-width: 599.98px)': 'none'}},
});

/** A 4×4 ordered-dither ramp: the tool's mark. */
function Mark() {
  const cells: [number, number][] = [];
  const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (bayer[y][x] < 4 + x * 3) cells.push([x, y]);
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stylex.props(styles.mark)}>
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} fill="currentColor" x={x * 6} y={y * 6} width="6" height="6" />
      ))}
    </svg>
  );
}

function ToastBridge() {
  const showToast = useToast();
  useEffect(() => { setToast(showToast); return () => setToast(null); }, [showToast]);
  return null;
}

/** Drop or paste an image anywhere to make it the source. */
function useDropAndPaste() {
  useEffect(() => {
    const over = (ev: DragEvent) => ev.preventDefault();
    const drop = (ev: DragEvent) => {
      ev.preventDefault();
      const f = [...(ev.dataTransfer?.files || [])].find(file => /^image\//.test(file.type));
      f ? loadFile(f) : toast('Drop an image file');
    };
    const paste = (ev: ClipboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t && t.matches && t.matches('input,textarea')) return;
      const f = [...(ev.clipboardData?.files || [])].find(file => /^image\//.test(file.type));
      if (f) { ev.preventDefault(); loadFile(f); }
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    document.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      document.removeEventListener('paste', paste);
    };
  }, []);
}

export default function App() {
  const [appearance, setAppearance] = useState<Mode>(() => (saved.get('mode') as Mode) || 'system');
  const rail = useResizable({defaultSize: 248, minSize: 200, maxSize: 360});
  const inspector = useResizable({defaultSize: 304, minSize: 272, maxSize: 420});
  const [drawer, setDrawer] = useState<'' | 'rail' | 'inspector'>('');
  useDropAndPaste();

  return (
    <Theme theme={studioTheme} mode={appearance}>
      <LayerProvider>
        <ToastBridge />
        <Section variant="section" padding={0} height="100%">
          <Layout
            height="fill"
            padding={0}
            header={
              <LayoutHeader hasDivider padding={2}>
                <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
                  <HStack gap={2} vAlign="center">
                    <Mark />
                    <Text type="label" weight="bold" xstyle={styles.brand}>
                      DURANDAL
                    </Text>
                    <Text type="supporting" xstyle={styles.wideOnly}>
                      Dither studio
                    </Text>
                  </HStack>
                  <HStack gap={1} vAlign="center">
                    <StackItem xstyle={styles.railButton}>
                      <IconButton
                        label="Open styles"
                        tooltip="Styles"
                        size="sm"
                        variant="ghost"
                        icon={<Icon icon={PanelLeft} size={ICON} />}
                        onClick={() => setDrawer('rail')}
                      />
                    </StackItem>
                    <StackItem xstyle={styles.narrowOnly}>
                      <IconButton
                        label="Open settings"
                        tooltip="Settings"
                        size="sm"
                        variant="ghost"
                        icon={<Icon icon={Settings2} size={ICON} />}
                        onClick={() => setDrawer('inspector')}
                      />
                    </StackItem>
                    <StackItem xstyle={styles.wideOnly}>
                      <Selector
                        label="Appearance"
                        isLabelHidden
                        size="sm"
                        variant="ghost"
                        width={120}
                        value={appearance}
                        options={[
                          {value: 'system', label: 'System'},
                          {value: 'light', label: 'Light'},
                          {value: 'dark', label: 'Dark'},
                        ]}
                        onChange={v => { setAppearance(v as Mode); saved.set('mode', v); }}
                      />
                    </StackItem>
                  </HStack>
                </HStack>
              </LayoutHeader>
            }
            content={
              <LayoutContent padding={0}>
                <Layout
                  height="fill"
                  start={
                    <>
                      <LayoutPanel resizable={rail.props} hasDivider padding={3} label="Styles" isScrollable xstyle={styles.foldsAtRail}>
                        <StyleRail />
                      </LayoutPanel>
                      <ResizeHandle
                        resizable={rail.props}
                        isAlwaysVisible={false}
                        pillPlacement="center"
                        label="Resize styles panel"
                        xstyle={styles.foldsAtRail}
                      />
                    </>
                  }
                  content={
                    <LayoutContent padding={0}>
                      <Section variant="muted" padding={0} height="100%">
                        <Layout
                          height="fill"
                          padding={4}
                          content={
                            <LayoutContent padding={4} isScrollable={false} label="Dithered output">
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
                  end={
                    <>
                      <ResizeHandle
                        resizable={inspector.props}
                        isReversed
                        isAlwaysVisible={false}
                        pillPlacement="center"
                        label="Resize settings panel"
                        xstyle={styles.foldsAtInspector}
                      />
                      <LayoutPanel
                        resizable={inspector.props}
                        hasDivider
                        padding={0}
                        isScrollable
                        label="Dither settings"
                        xstyle={styles.foldsAtInspector}>
                        <Inspector />
                      </LayoutPanel>
                    </>
                  }
                />
              </LayoutContent>
            }
          />
        </Section>
        <Drawer isOpen={drawer === 'rail'} onOpenChange={o => setDrawer(o ? 'rail' : '')} side="start" width={320} padding={3} label="Styles">
          <StyleRail />
        </Drawer>
        <Drawer isOpen={drawer === 'inspector'} onOpenChange={o => setDrawer(o ? 'inspector' : '')} width={340} padding={0} label="Dither settings">
          <Inspector />
        </Drawer>
      </LayerProvider>
    </Theme>
  );
}
