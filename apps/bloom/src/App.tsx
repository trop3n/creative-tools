// BLOOM: procedural flowers that grow and bloom on a gradient.
import {useEffect, useState} from 'react';
import * as stylex from '@stylexjs/stylex';
import {Card} from '@astryxdesign/core/Card';
import {Center} from '@astryxdesign/core/Center';
import {Drawer} from '@astryxdesign/core/Drawer';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {LayerProvider} from '@astryxdesign/core/Layer';
import {HStack, StackItem, Layout, LayoutContent, LayoutFooter, LayoutHeader, LayoutPanel} from '@astryxdesign/core/Layout';
import {ResizeHandle, useResizable} from '@astryxdesign/core/Resizable';
import {Section} from '@astryxdesign/core/Section';
import {Selector} from '@astryxdesign/core/Selector';
import {Text} from '@astryxdesign/core/Text';
import {Theme} from '@astryxdesign/core/theme';
import {useToast} from '@astryxdesign/core/Toast';
import {Settings2} from 'lucide-react';
import {studioTheme} from '@studio/theme';
import {S, saved, openProject} from './engine/live.js';
import {Stage, StageToolbar, Inspector} from './ui/views';
import {ICON} from './ui/parts';

type Mode = 'light' | 'dark' | 'system';
const HIDE_INSPECTOR = '@media (max-width: 899.98px)';
const styles = stylex.create({
  mark: {width: 'var(--spacing-5)', height: 'var(--spacing-5)', color: 'var(--color-accent)', flexShrink: 0},
  brand: {letterSpacing: '0.3em'},
  wideOnly: {display: {default: null, '@media (max-width: 599.98px)': 'none'}},
  foldsAtInspector: {display: {default: null, [HIDE_INSPECTOR]: 'none'}},
  narrowOnly: {display: {default: 'none', [HIDE_INSPECTOR]: 'flex'}}, // null in a media query sets nothing, so it would stay hidden
  toolBarCard: {maxWidth: '100%'},
});

/** Five petals around a centre: the tool's mark. */
function Mark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stylex.props(styles.mark)}>
      {[0, 72, 144, 216, 288].map(a => (
        <ellipse key={a} cx="12" cy="6.5" rx="3.4" ry="5.5" fill="currentColor" opacity="0.55" transform={`rotate(${a} 12 12)`} />
      ))}
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

function ToastBridge() {
  const showToast = useToast();
  useEffect(() => {
    S.toast = (message: string, type: string) => showToast({body: message, type, isAutoHide: true, autoHideDuration: 3200} as any);
    return () => { S.toast = null; };
  }, [showToast]);
  return null;
}

/** Drop a .bloom.json project anywhere to open it. */
function useDrop() {
  useEffect(() => {
    const over = (ev: DragEvent) => ev.preventDefault();
    const drop = (ev: DragEvent) => {
      ev.preventDefault();
      const f = [...(ev.dataTransfer?.files || [])].find(file => /\.json$/i.test(file.name) || file.type === 'application/json');
      if (f) openProject(f);
      else S.toast?.('Drop a BLOOM project file (.bloom.json)', 'info');
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, []);
}

export default function App() {
  const [appearance, setAppearance] = useState<Mode>(() => (saved.get('mode') as Mode) || 'system');
  const inspector = useResizable({defaultSize: 320, minSize: 280, maxSize: 440});
  const [drawer, setDrawer] = useState(false);
  useDrop();

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
                    <Text type="label" weight="bold" xstyle={styles.brand}>BLOOM</Text>
                    <Text type="supporting" xstyle={styles.wideOnly}>Flower studio</Text>
                  </HStack>
                  <HStack gap={1} vAlign="center">
                    <StackItem xstyle={styles.narrowOnly}>
                      <IconButton label="Open settings" tooltip="Settings" size="sm" variant="ghost" icon={<Icon icon={Settings2} size={ICON} />} onClick={() => setDrawer(true)} />
                    </StackItem>
                    <StackItem xstyle={styles.wideOnly}>
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
                    </StackItem>
                  </HStack>
                </HStack>
              </LayoutHeader>
            }
            content={
              <LayoutContent padding={0}>
                <Layout
                  height="fill"
                  content={
                    <LayoutContent padding={0}>
                      <Section variant="muted" padding={0} height="100%">
                        <Layout
                          height="fill"
                          padding={4}
                          content={
                            <LayoutContent padding={4} isScrollable={false} label="Flowers">
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
                      <ResizeHandle resizable={inspector.props} isReversed isAlwaysVisible={false} pillPlacement="center" label="Resize settings panel" xstyle={styles.foldsAtInspector} />
                      <LayoutPanel resizable={inspector.props} hasDivider padding={0} isScrollable label="Flower settings" xstyle={styles.foldsAtInspector}>
                        <Inspector />
                      </LayoutPanel>
                    </>
                  }
                />
              </LayoutContent>
            }
          />
        </Section>
        <Drawer isOpen={drawer} onOpenChange={setDrawer} width={340} padding={0} label="Flower settings">
          <Inspector />
        </Drawer>
      </LayerProvider>
    </Theme>
  );
}
