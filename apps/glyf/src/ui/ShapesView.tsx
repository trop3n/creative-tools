import {useEffect, useRef, useState} from 'react';
import * as stylex from '@stylexjs/stylex';
import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {Divider} from '@astryxdesign/core/Divider';
import {Grid} from '@astryxdesign/core/Grid';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Layout';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Section} from '@astryxdesign/core/Section';
import {Selector} from '@astryxdesign/core/Selector';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Toolbar} from '@astryxdesign/core/Toolbar';
import {
  ArrowDownToLine, ArrowUpToLine, Circle, Copy, Download, FileUp, FlipHorizontal2, FlipVertical2,
  MousePointer2, Pentagon, Plus, RotateCw, Scissors, Square, Trash2, TriangleRight, Undo2,
} from 'lucide-react';
import {S, A, useStore, cur, selEl, pushHist, changed, emit, undo, selectGlyph, setTool} from '../engine/store.js';
import {shapeInner, elMarkup, getBox, setBox, corners, moveEl, boxFrom, makeEl, clone, P, n2} from '../engine/shapes.js';
import {GlyphArt, ICON, InspectorRow, InspectorSection, SliderRow} from './parts';
import {pickFiles} from '@studio/core';

const QuarterIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" {...props}>
    <path d="M4 4H20A16 16 0 0 1 4 20Z" />
  </svg>
);

const TOOL_NOTES: Record<string, string> = {
  select: 'Drag a part to move it, drag a corner square to resize. Arrows nudge, [ and ] reorder, Delete removes.',
  rect: 'Drag to draw. Hold Shift for a square.',
  ellipse: 'Drag to draw. Hold Shift for a circle.',
  quarter: 'Drag away from the corner the arc pivots on. Shift for a true quarter circle.',
  tri: 'Drag away from the right-angle corner. Shift keeps it square.',
  poly: 'Click to place points. Click the first point, double-click, or press Enter to close. Esc cancels.',
};
const SNAPS = [
  {value: '0', label: 'Snap off'},
  {value: '5', label: 'Snap 5'},
  {value: '10', label: 'Snap 10'},
  {value: '12.5', label: 'Snap ⅛'},
  {value: '25', label: 'Snap ¼'},
];

const styles = stylex.create({
  editor: {display: 'block', width: '100%', height: '100%', touchAction: 'none', userSelect: 'none'},
  drawCursor: {cursor: 'crosshair'},
  art: {color: 'var(--color-text-primary)'},
  gridLine: {stroke: 'var(--color-border)', strokeWidth: 0.25},
  gridMid: {stroke: 'var(--color-border-emphasized)'},
  board: {fill: 'none', stroke: 'var(--color-border-emphasized)', strokeWidth: 0.35},
  ov: {fill: 'transparent', color: 'transparent', stroke: 'var(--color-accent)', strokeOpacity: 0.35, strokeWidth: 0.35, pointerEvents: 'none'},
  ovHit: {pointerEvents: 'all', cursor: 'move'},
  ovCut: {strokeDasharray: '1.4 1'},
  ovSel: {strokeOpacity: 1, strokeWidth: 0.7},
  handle: {fill: 'var(--color-background-card)', stroke: 'var(--color-accent)', strokeWidth: 0.4, cursor: 'nwse-resize'},
  preview: {fill: 'var(--color-accent)', fillOpacity: 0.18, stroke: 'var(--color-accent)', strokeWidth: 0.45},
  previewCut: {fillOpacity: 0, strokeDasharray: '1.4 1'},
  activeTile: {outlineWidth: '2px', outlineStyle: 'solid', outlineColor: 'var(--color-accent)', outlineOffset: '-1px'},
  editorCard: {aspectRatio: '1', maxWidth: '100%', maxHeight: '100%'},
});

/* ================= rail ================= */
export function ShapesRail() {
  const s = useStore();
  return (
    <VStack gap={3}>
      <HStack gap={1} wrap="wrap">
        <Button label="New" size="sm" variant="primary" icon={<Icon icon={Plus} size={ICON} />} onClick={A.newG} />
        <Button label="Duplicate" size="sm" icon={<Icon icon={Copy} size={ICON} />} onClick={A.dupG} />
        <Button
          label="Import SVG"
          size="sm"
          icon={<Icon icon={FileUp} size={ICON} />}
          onClick={async () => A.importSvgFiles(await pickFiles('.svg,image/svg+xml', true))}
        />
      </HStack>
      <Text type="supporting">Drop or paste SVG files to add them. The gold mark means the glyph is in the generator set.</Text>
      <Grid columns={{minWidth: 64}} gap={2}>
        {s.lib.shapes.map(g => (
          <ClickableCard
            key={g.id}
            label={`Edit ${g.name}`}
            padding={1}
            onClick={() => selectGlyph(g.id)}
            xstyle={g.id === s.ed.id ? styles.activeTile : undefined}>
            <VStack gap={0.5}>
              <GlyphArt shape={g} place={'lib-' + g.id} />
              <HStack gap={0.5} vAlign="center">
                <StackItem size="fill">
                  <Text type="supporting" maxLines={1}>
                    {g.name}
                  </Text>
                </StackItem>
                {g.inSet ? <Icon icon="check" size="xsm" color="warning" label="In generator set" /> : null}
              </HStack>
            </VStack>
          </ClickableCard>
        ))}
      </Grid>
      <Divider />
      <HStack gap={1} wrap="wrap">
        <Button label="Export library" size="sm" variant="ghost" icon={<Icon icon={Download} size={ICON} />} onClick={A.exportLib} />
        <Button
          label="Import library"
          size="sm"
          variant="ghost"
          icon={<Icon icon={FileUp} size={ICON} />}
          onClick={async () => { const [f] = await pickFiles('.json,application/json'); if (f) A.importLib(f); }}
        />
      </HStack>
    </VStack>
  );
}

/* ================= editor ================= */
export function ShapeEditor() {
  const st = useStore();
  const ed = st.ed, shape = cur();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<any>(null);
  const [preview, setPreview] = useState<string>('');
  const [pos, setPos] = useState('');

  const snapV = (v: number) => (ed.snap ? Math.round(v / ed.snap) * ed.snap : Math.round(v * 10) / 10);
  const svgPt = (ev: React.PointerEvent | React.MouseEvent) => {
    const svg = svgRef.current!, p = svg.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    return p.matrixTransform(svg.getScreenCTM()!.inverse());
  };
  const polyPreview = (cursor?: {x: number; y: number}) => {
    const pts = (ed.poly || []).concat(cursor ? [[cursor.x, cursor.y]] : []);
    setPreview(
      `<polyline points="${pts.map(p => n2(p[0]) + ' ' + n2(p[1])).join(' ')}"/>` +
        (ed.poly || []).map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i ? 0.9 : 1.6}"/>`).join(''),
    );
  };
  const commitPoly = () => {
    if (!ed.poly) return;
    const pts = ed.poly.filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    ed.poly = null; setPreview('');
    if (pts.length < 3) { emit(); return; }
    pushHist();
    const e: any = P(pts); if (ed.cut) e.cut = true;
    cur().els.push(e); ed.sel = cur().els.length - 1; changed();
  };
  // Enter / Escape reach the polygon through this hook so the keyboard handler stays in one place.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (S.view !== 'shapes' || (ev.target as HTMLElement).matches?.('input,textarea,select')) return;
      if (ev.key === 'Enter' && ed.poly) commitPoly();
      if (ev.key === 'Escape' && ed.poly) { ed.poly = null; setPreview(''); emit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => { if (!ed.poly) setPreview(''); }, [ed.tool, ed.id]);

  const onDown = (ev: React.PointerEvent<SVGSVGElement>) => {
    if (ev.button !== 0 || !shape) return;
    const p = svgPt(ev), sp = {x: snapV(p.x), y: snapV(p.y)};
    if (ed.tool === 'poly') {
      if (!ed.poly) ed.poly = [];
      const f = ed.poly[0];
      if (f && ed.poly.length >= 3 && Math.hypot(sp.x - f[0], sp.y - f[1]) < Math.max(2.5, (ed.snap || 5) / 2)) return commitPoly();
      ed.poly.push([sp.x, sp.y]); polyPreview(sp); return;
    }
    svgRef.current!.setPointerCapture(ev.pointerId);
    const target = ev.target as Element;
    if (ed.tool === 'select') {
      const h = target.closest('[data-h]') as HTMLElement | null;
      if (h && ed.sel >= 0) { drag.current = {kind: 'h', h: h.dataset.h, orig: clone(shape.els[ed.sel]), pushed: false}; return; }
      const o = target.closest('[data-idx]') as HTMLElement | null;
      if (o) { ed.sel = +o.dataset.idx!; drag.current = {kind: 'move', start: p, orig: clone(shape.els[ed.sel]), pushed: false}; emit(); return; }
      ed.sel = -1; emit(); return;
    }
    drag.current = {kind: 'draw', start: sp, cur: sp, square: ev.shiftKey};
  };
  const onMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    const p = svgPt(ev), sp = {x: snapV(p.x), y: snapV(p.y)};
    setPos(p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100 ? `${n2(sp.x)}, ${n2(sp.y)}` : '');
    if (ed.poly && !drag.current) { polyPreview(sp); return; }
    const d = drag.current; if (!d || !shape) return;
    if (d.kind === 'draw') {
      d.cur = sp; d.square = ev.shiftKey;
      const b = boxFrom(d.start, d.cur, d.square);
      setPreview(b.w && b.h ? elMarkup(makeEl(ed.tool, b, ed.cut)) : '');
      return;
    }
    let ne;
    if (d.kind === 'move') {
      const dx = ed.snap ? Math.round((p.x - d.start.x) / ed.snap) * ed.snap : n2(p.x - d.start.x);
      const dy = ed.snap ? Math.round((p.y - d.start.y) / ed.snap) * ed.snap : n2(p.y - d.start.y);
      if (!d.pushed && !dx && !dy) return;
      ne = moveEl(d.orig, dx, dy);
    } else {
      ne = clone(d.orig);
      if (d.h[0] === 'p') ne.pts[+d.h.slice(1)] = [sp.x, sp.y];
      else {
        const C = corners(getBox(d.orig)), fx = C[(+d.h.slice(1) + 2) % 4];
        const b = boxFrom({x: fx[0], y: fx[1]}, sp, ev.shiftKey);
        if (b.w < 0.5 || b.h < 0.5) return;
        setBox(ne, b);
      }
    }
    if (!d.pushed) { pushHist(); d.pushed = true; }
    shape.els[ed.sel] = ne; emit();
  };
  const onUp = () => {
    const d = drag.current; drag.current = null; if (!d || !shape) return;
    if (d.kind === 'draw') {
      const b = boxFrom(d.start, d.cur, d.square);
      setPreview('');
      if (b.w >= 0.5 && b.h >= 0.5) { pushHist(); shape.els.push(makeEl(ed.tool, b, ed.cut)); ed.sel = shape.els.length - 1; changed(); }
    } else if (d.pushed) changed();
  };

  const step = ed.snap || 10, lines: number[] = [];
  for (let v = step; v < 100 - 1e-6; v += step) lines.push(v);
  const sel = shape && shape.els[ed.sel];
  const handles: Array<{id: string; x: number; y: number}> = [];
  if (sel && ed.tool === 'select') {
    if (sel.t === 'poly') sel.pts.forEach((p: number[], i: number) => handles.push({id: 'p' + i, x: p[0], y: p[1]}));
    else if (sel.t !== 'raw') corners(getBox(sel)).forEach((p, i) => handles.push({id: 'c' + i, x: p[0], y: p[1]}));
  }

  return (
    <VStack gap={2} height="100%" hAlign="center">
      <StackItem size="fill">
        <Card padding={0} elevation="med" height="100%" xstyle={styles.editorCard}>
          <svg
            ref={svgRef}
            viewBox="-4 -4 108 108"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={() => setPos('')}
            onDoubleClick={() => { if (ed.tool === 'poly') commitPoly(); }}
            aria-label={shape ? `Editing ${shape.name}` : 'Glyph editor'}
            role="application"
            {...stylex.props(styles.editor, ed.tool !== 'select' && styles.drawCursor)}>
            {lines.map(v => (
              <g key={v}>
                <line x1={v} y1={0} x2={v} y2={100} {...stylex.props(styles.gridLine, Math.abs(v - 50) < 1e-6 && styles.gridMid)} />
                <line x1={0} y1={v} x2={100} y2={v} {...stylex.props(styles.gridLine, Math.abs(v - 50) < 1e-6 && styles.gridMid)} />
              </g>
            ))}
            <rect x={0} y={0} width={100} height={100} {...stylex.props(styles.board)} />
            {shape ? <GlyphLayer shape={shape} /> : null}
            {shape
              ? shape.els.map((e: any, i: number) => (
                  <g
                    key={i}
                    data-idx={i}
                    {...stylex.props(styles.ov, ed.tool === 'select' && styles.ovHit, e.cut && styles.ovCut, i === ed.sel && styles.ovSel)}
                    dangerouslySetInnerHTML={{__html: elMarkup(e)}}
                  />
                ))
              : null}
            {handles.map(h => (
              <rect key={h.id} data-h={h.id} x={h.x - 1.6} y={h.y - 1.6} width={3.2} height={3.2} {...stylex.props(styles.handle)} />
            ))}
            <g {...stylex.props(styles.preview, ed.cut && styles.previewCut)} dangerouslySetInnerHTML={{__html: preview}} />
          </svg>
        </Card>
      </StackItem>
      <HStack gap={3} hAlign="between" width="100%">
        <Text type="supporting" hasTabularNumbers>
          {shape ? `${shape.name} · ${shape.els.length} part${shape.els.length === 1 ? '' : 's'}` : ''}
        </Text>
        <Text type="supporting" hasTabularNumbers>
          {pos}
        </Text>
      </HStack>
    </VStack>
  );
}
function GlyphLayer({shape}: {shape: any}) {
  return <g {...stylex.props(styles.art)} dangerouslySetInnerHTML={{__html: shapeInnerFor(shape)}} />;
}
const shapeInnerFor = (shape: any) => shapeInner(shape, 'ed');

/* ================= stage toolbar ================= */
export function ShapesToolbar() {
  const {ed} = useStore();
  return (
    <Toolbar
      label="Drawing tools"
      size="sm"
      startContent={
        <>
          <SegmentedControl label="Tool" size="sm" value={ed.tool} onChange={setTool}>
            <SegmentedControlItem value="select" label="Select (V)" isLabelHidden icon={<Icon icon={MousePointer2} size={ICON} />} />
            <SegmentedControlItem value="rect" label="Rectangle (R)" isLabelHidden icon={<Icon icon={Square} size={ICON} />} />
            <SegmentedControlItem value="ellipse" label="Ellipse (E)" isLabelHidden icon={<Icon icon={Circle} size={ICON} />} />
            <SegmentedControlItem value="quarter" label="Quarter circle (Q)" isLabelHidden icon={<Icon icon={QuarterIcon} size={ICON} />} />
            <SegmentedControlItem value="tri" label="Right triangle (T)" isLabelHidden icon={<Icon icon={TriangleRight} size={ICON} />} />
            <SegmentedControlItem value="poly" label="Polygon (P)" isLabelHidden icon={<Icon icon={Pentagon} size={ICON} />} />
          </SegmentedControl>
          <SegmentedControl label="Paint mode" size="sm" value={ed.cut ? 'cut' : 'add'} onChange={v => { ed.cut = v === 'cut'; emit(); }}>
            <SegmentedControlItem value="add" label="Add" icon={<Icon icon={Plus} size={ICON} />} />
            <SegmentedControlItem value="cut" label="Cut (X)" icon={<Icon icon={Scissors} size={ICON} />} />
          </SegmentedControl>
          <Selector
            label="Snap"
            isLabelHidden
            size="sm"
            variant="ghost"
            placement="above"
            width={112}
            value={String(ed.snap)}
            options={SNAPS}
            onChange={v => { ed.snap = +v; emit(); }}
          />
          <IconButton label="Undo (Ctrl+Z)" tooltip="Undo" size="sm" variant="ghost" icon={<Icon icon={Undo2} size={ICON} />} onClick={undo} />
        </>
      }
    />
  );
}

/* ================= inspector ================= */
export function ShapesInspector() {
  const st = useStore();
  const shape = cur(), e = selEl();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rxFirst = useRef(true);
  useEffect(() => { rxFirst.current = true; }, [st.ed.sel, st.ed.id]);
  if (!shape) return null;
  return (
    <>
      <InspectorSection title="Selected part">
        {e ? (
          <>
            {e.t === 'rect' ? (
              <SliderRow
                label="Corner"
                value={e.rx || 0}
                min={0}
                max={50}
                step={0.5}
                onChange={v => { A.setRx(v, rxFirst.current); rxFirst.current = false; }}
              />
            ) : null}
            <InspectorRow label="Mode">
              <SegmentedControl label="Part mode" size="sm" layout="fill" value={e.cut ? 'cut' : 'add'} onChange={v => { if ((v === 'cut') !== !!e.cut) A.toggleCut(); }}>
                <SegmentedControlItem value="add" label="Add" />
                <SegmentedControlItem value="cut" label="Cut" />
              </SegmentedControl>
            </InspectorRow>
            <InspectorRow label="Transform">
              <IconButton label="Rotate part 90°" tooltip="Rotate 90°" size="sm" icon={<Icon icon={RotateCw} size={ICON} />} onClick={() => A.elXf('rot')} />
              <IconButton label="Flip part horizontally" tooltip="Flip horizontally" size="sm" icon={<Icon icon={FlipHorizontal2} size={ICON} />} onClick={() => A.elXf('fh')} />
              <IconButton label="Flip part vertically" tooltip="Flip vertically" size="sm" icon={<Icon icon={FlipVertical2} size={ICON} />} onClick={() => A.elXf('fv')} />
            </InspectorRow>
            <InspectorRow label="Order">
              <IconButton label="Raise part ( ] )" tooltip="Raise" size="sm" icon={<Icon icon={ArrowUpToLine} size={ICON} />} onClick={() => A.reorder(1)} />
              <IconButton label="Lower part ( [ )" tooltip="Lower" size="sm" icon={<Icon icon={ArrowDownToLine} size={ICON} />} onClick={() => A.reorder(-1)} />
              <IconButton label="Duplicate part (Ctrl+D)" tooltip="Duplicate" size="sm" icon={<Icon icon={Copy} size={ICON} />} onClick={A.dupEl} />
              <IconButton label="Delete part" tooltip="Delete" size="sm" variant="destructive" icon={<Icon icon={Trash2} size={ICON} />} onClick={A.delEl} />
            </InspectorRow>
          </>
        ) : (
          <Text type="supporting">Nothing selected. Pick the Select tool and click a part.</Text>
        )}
      </InspectorSection>

      <InspectorSection title="Glyph">
        <TextInput label="Name" size="sm" value={shape.name} onChange={v => A.rename(v)} />
        <Switch label="Use in generator set" size="sm" value={!!shape.inSet} onChange={v => A.setInSet(shape.id, v)} />
        <InspectorRow label="Transform">
          <IconButton label="Rotate glyph 90°" tooltip="Rotate 90°" size="sm" icon={<Icon icon={RotateCw} size={ICON} />} onClick={() => A.glyphXf('rot')} />
          <IconButton label="Flip glyph horizontally" tooltip="Flip horizontally" size="sm" icon={<Icon icon={FlipHorizontal2} size={ICON} />} onClick={() => A.glyphXf('fh')} />
          <IconButton label="Flip glyph vertically" tooltip="Flip vertically" size="sm" icon={<Icon icon={FlipVertical2} size={ICON} />} onClick={() => A.glyphXf('fv')} />
        </InspectorRow>
        <HStack gap={1} wrap="wrap">
          <Button label="Undo" size="sm" icon={<Icon icon={Undo2} size={ICON} />} onClick={undo} />
          <Button label="Clear" size="sm" onClick={A.clear} />
          <Button label="Export .svg" size="sm" icon={<Icon icon={Download} size={ICON} />} onClick={A.exportGlyph} />
        </HStack>
        <Button label="Delete glyph" size="sm" variant="destructive" icon={<Icon icon={Trash2} size={ICON} />} onClick={() => setConfirmDelete(true)} />
        <AlertDialog
          isOpen={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${shape.name}?`}
          description="It leaves the library and the generator set. Export the library first if you might want it back."
          actionLabel="Delete glyph"
          onAction={() => { A.delG(); setConfirmDelete(false); }}
        />
      </InspectorSection>

      <Section padding={3}>
        <VStack gap={2}>
          <Text type="label" weight="semibold">
            How to draw
          </Text>
          <Text type="supporting">{TOOL_NOTES[st.ed.tool]}</Text>
          <Text type="supporting">Cut parts erase everything drawn before them. Keys: V R E Q T P pick tools, X switches Add and Cut.</Text>
        </VStack>
      </Section>
    </>
  );
}

/* ================= keyboard ================= */
export function useShapeKeys() {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (S.view !== 'shapes' || (ev.target as HTMLElement).matches?.('input,textarea,select,[role="slider"]')) return;
      const k = ev.key.toLowerCase(), mod = ev.ctrlKey || ev.metaKey;
      if (mod && k === 'z') { ev.preventDefault(); undo(); return; }
      if (mod && k === 'd') { ev.preventDefault(); A.dupEl(); return; }
      if (mod || ev.altKey) return;
      const tools: Record<string, string> = {v: 'select', r: 'rect', e: 'ellipse', q: 'quarter', t: 'tri', p: 'poly'};
      if (tools[k]) { setTool(tools[k]); return; }
      if (k === 'x') { S.ed.cut = !S.ed.cut; emit(); return; }
      if (k === 'escape' && !S.ed.poly) { S.ed.sel = -1; emit(); return; }
      if (k === '[') { A.reorder(-1); return; }
      if (k === ']') { A.reorder(1); return; }
      if ((k === 'delete' || k === 'backspace') && selEl()) { ev.preventDefault(); A.delEl(); return; }
      const arrows: Record<string, number[]> = {arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1]};
      if (arrows[k] && selEl()) {
        ev.preventDefault();
        const st = (S.ed.snap || 1) * (ev.shiftKey ? 2 : 1);
        A.nudge(arrows[k][0] * st, arrows[k][1] * st);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
