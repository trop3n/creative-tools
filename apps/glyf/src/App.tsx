// GLYF app frame, built on the canvas-editor template's frame: a header over a
// resizable rail | muted stage with a floating tool bar | resizable inspector.
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
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Selector} from '@astryxdesign/core/Selector';
import {Text} from '@astryxdesign/core/Text';
import {Theme} from '@astryxdesign/core/theme';
import {useToast} from '@astryxdesign/core/Toast';
import {PanelLeft, Settings2, Shapes, Sparkles} from 'lucide-react';
import {studioTheme} from '@studio/theme';
import {S, A, emit, useStore, setToast, store, changed, toast} from './engine/store.js';
import {schedule} from './engine/generator.js';
import {initSource, loadMediaFile, acceptsMedia, pauseForHidden, resumeForShown} from './engine/media.js';
import {ShapesRail, ShapeEditor, ShapesToolbar, ShapesInspector, useShapeKeys} from './ui/ShapesView';
import {GenerateRail, GenerateStage, GenerateToolbar, GenerateInspector} from './ui/GenerateView';
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
  // Below the widths where the side panels fold, these buttons open them as drawers.
  narrowOnly: {display: {default: 'none', [HIDE_INSPECTOR]: null}},
  railButton: {display: {default: 'none', [HIDE_RAIL]: null}},
  wideOnly: {display: {default: null, '@media (max-width: 599.98px)': 'none'}},
});

function Mark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stylex.props(styles.mark)}>
      <path fill="currentColor" d="M2 2h10A10 10 0 0 1 2 12Z" />
      <rect fill="currentColor" x="13" y="13" width="9" height="9" />
      <circle fill="currentColor" cx="17.5" cy="6.5" r="4.5" />
      <path fill="currentColor" d="M2 22V13L11 22Z" />
    </svg>
  );
}

function ToastBridge() {
  const showToast = useToast();
  useEffect(() => { setToast(showToast); return () => setToast(null); }, [showToast]);
  return null;
}

function setView(v: string) {
  S.view = v === 'shapes' ? 'shapes' : 'gen';
  const h = S.view === 'shapes' ? '#shapes' : '#generate';
  if (location.hash !== h) history.replaceState(null, '', h);
  if (S.view === 'shapes') pauseForHidden(); else resumeForShown();
  emit();
}

/** Drop and paste: SVGs become glyphs in Shapes; images and video become the source in Generate. */
function useDropAndPaste() {
  useEffect(() => {
    const over = (ev: DragEvent) => ev.preventDefault();
    const drop = (ev: DragEvent) => {
      ev.preventDefault();
      const files = [...(ev.dataTransfer?.files || [])];
      if (!files.length) return;
      if (S.view === 'shapes') A.importSvgFiles(files);
      else { const f = files.find(acceptsMedia); f ? loadMediaFile(f) : toast('Drop an image or video file'); }
    };
    const paste = (ev: ClipboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t && t.matches && t.matches('input,textarea')) return;
      const cd = ev.clipboardData; if (!cd) return;
      const file = [...cd.files].find(f => /^image\//.test(f.type));
      const text = cd.getData('text/plain') || '';
      if (S.view === 'shapes') {
        if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) { ev.preventDefault(); if (A.importSvgText(text, 'Pasted')) { changed(); toast('Pasted SVG as a new glyph'); } }
        else if (file && /svg/.test(file.type)) { ev.preventDefault(); A.importSvgFiles([file]); }
      } else if (file) { ev.preventDefault(); loadMediaFile(file); }
    };
    const hash = () => setView(location.hash === '#shapes' ? 'shapes' : 'gen');
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    document.addEventListener('paste', paste);
    window.addEventListener('hashchange', hash);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      document.removeEventListener('paste', paste);
      window.removeEventListener('hashchange', hash);
    };
  }, []);
}

export default function App() {
  const s = useStore();
  const [appearance, setAppearance] = useState<Mode>(() => (store('glyf.mode') as Mode) || 'system');
  const rail = useResizable({defaultSize: 248, minSize: 200, maxSize: 360});
  const inspector = useResizable({defaultSize: 304, minSize: 272, maxSize: 420});
  useShapeKeys();
  useDropAndPaste();
  useEffect(() => { schedule(); }, []);
  const shapes = s.view === 'shapes';
  const [drawer, setDrawer] = useState<'' | 'rail' | 'inspector'>('');

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
                      GLYF
                    </Text>
                    <Text type="supporting" xstyle={styles.wideOnly}>
                      Shape studio
                    </Text>
                  </HStack>
                  <SegmentedControl label="View" size="sm" value={shapes ? 'shapes' : 'gen'} onChange={setView}>
                    <SegmentedControlItem value="shapes" label="Shapes" icon={<Icon icon={Shapes} size={ICON} />} />
                    <SegmentedControlItem value="gen" label="Generate" icon={<Icon icon={Sparkles} size={ICON} />} />
                  </SegmentedControl>
                  <HStack gap={1} vAlign="center">
                  <StackItem xstyle={styles.railButton}>
                  <IconButton
                    label={shapes ? 'Open glyph library' : 'Open glyph set'}
                    tooltip={shapes ? 'Library' : 'Glyph set'}
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
                    onChange={v => { setAppearance(v as Mode); store('glyf.mode', v); }}
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
                      <LayoutPanel
                        resizable={rail.props}
                        hasDivider
                        padding={3}
                        label={shapes ? 'Glyph library' : 'Glyph set'}
                        xstyle={styles.foldsAtRail}>
                        {shapes ? <ShapesRail /> : <GenerateRail />}
                      </LayoutPanel>
                      <ResizeHandle
                        resizable={rail.props}
                        isAlwaysVisible={false}
                        pillPlacement="center"
                        label="Resize library panel"
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
                            <LayoutContent padding={4} isScrollable={false} label={shapes ? 'Glyph editor' : 'Generated output'}>
                              {shapes ? <ShapeEditor /> : <GenerateStage />}
                            </LayoutContent>
                          }
                          footer={
                            <LayoutFooter>
                              <Center>
                                <Card padding={1} elevation="high" xstyle={styles.toolBarCard}>
                                  {shapes ? <ShapesToolbar /> : <GenerateToolbar />}
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
                        label={shapes ? 'Glyph settings' : 'Generator settings'}
                        xstyle={styles.foldsAtInspector}>
                        {shapes ? <ShapesInspector /> : <GenerateInspector />}
                      </LayoutPanel>
                    </>
                  }
                />
              </LayoutContent>
            }
          />
        </Section>
        <Drawer isOpen={drawer === 'rail'} onOpenChange={o => setDrawer(o ? 'rail' : '')} side="start" width={320} padding={3} label={shapes ? 'Glyph library' : 'Glyph set'}>
          {shapes ? <ShapesRail /> : <GenerateRail />}
        </Drawer>
        <Drawer isOpen={drawer === 'inspector'} onOpenChange={o => setDrawer(o ? 'inspector' : '')} width={340} padding={0} label={shapes ? 'Glyph settings' : 'Generator settings'}>
          {shapes ? <ShapesInspector /> : <GenerateInspector />}
        </Drawer>
      </LayerProvider>
    </Theme>
  );
}
