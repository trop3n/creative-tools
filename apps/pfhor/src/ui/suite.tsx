// Suite connections in the inspector: open what other tools saved or sent, send the
// current picture to another tool, and use or save suite-wide palettes. The engine
// side lives in @studio/core (suite.js). The same file sits in each tool's ui/ folder.
import {useEffect, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {HStack, StackItem} from '@astryxdesign/core/Layout';
import {Selector} from '@astryxdesign/core/Selector';
import {TextInput} from '@astryxdesign/core/TextInput';
import {BookmarkPlus, Send} from 'lucide-react';
import {currentTool, watchShelf, shelfFile, shelfLabel, sendTargets, sendTo, suitePalettes, savePalette, watchPalettes} from '@studio/core';
import {ICON, InspectorRow} from './parts';

type ShelfItem = {id: string; name: string; type: string; from: string; at: number; size: number};
type Made = {blob: Blob; name: string} | null;

/** Pictures and videos on the shelf (of the given kinds), newest first; empty outside the suite. */
export function useShelf(kinds: string[] = ['image', 'video']) {
  const [list, setList] = useState<ShelfItem[]>([]);
  useEffect(() => (currentTool() ? watchShelf(setList) : undefined), []);
  return list.filter(it => kinds.some(k => it.type.startsWith(k + '/')));
}

/** "Recent from the suite": open something any tool saved or sent. Hidden when there's nothing. */
export function RecentFromSuite({onOpen, kinds}: {onOpen: (file: File) => void; kinds?: string[]}) {
  const items = useShelf(kinds);
  if (!items.length) return null;
  return (
    <InspectorRow label="Recent">
      <Selector
        label="Recent from the suite"
        isLabelHidden
        size="sm"
        width="100%"
        placeholder="From the suite…"
        value=""
        options={items.map(it => ({value: it.id, label: shelfLabel(it)}))}
        onChange={async id => {
          const f = id ? await shelfFile(id) : null;
          if (f) onOpen(f);
        }}
      />
    </InspectorRow>
  );
}

/**
 * A button per tool that takes this kind of picture: make() renders it ({blob, name},
 * or null to cancel) and the other tool opens in a new tab with it. Hidden outside the suite.
 */
export function SendToRow({make, kind = 'image', isDisabled, onError}: {
  make: () => Promise<Made>; kind?: 'image' | 'video'; isDisabled?: boolean; onError?: (message: string) => void;
}) {
  const targets = sendTargets(kind);
  if (!targets.length) return null;
  return (
    <InspectorRow label={kind === 'video' ? 'Send video' : 'Send to'}>
      {targets.map(t => (
        <Button
          key={t.id}
          label={t.name}
          size="sm"
          variant="ghost"
          icon={<Icon icon={Send} size={ICON} />}
          isDisabled={isDisabled}
          onClick={() => { sendTo(t.id, make).catch(e => onError?.(e?.message || String(e))); }}
        />
      ))}
    </InspectorRow>
  );
}

/** Suite palettes, re-read when one is saved here or in another tab. */
export function useSuitePalettes() {
  const [, tick] = useState(0);
  useEffect(() => watchPalettes(() => tick(t => t + 1)), []);
  return suitePalettes();
}

/** Use a suite palette, or save the colors on show as one (by name; the same name replaces it). */
export function SuitePaletteRow({colors, onUse, onSaved}: {colors: string[]; onUse: (colors: string[]) => void; onSaved?: (name: string) => void}) {
  const pals = useSuitePalettes();
  const [naming, setNaming] = useState<string | null>(null);
  const save = () => {
    const name = (naming || '').trim();
    if (name && savePalette(name, colors)) { setNaming(null); onSaved?.(name); }
  };
  return (
    <>
      <InspectorRow label="Suite">
        <StackItem size="fill">
          <Selector
            label="Use a suite palette"
            isLabelHidden
            size="sm"
            width="100%"
            placeholder="Use a suite palette…"
            value=""
            options={pals.map(p => ({value: p.id, label: `${p.name} (${p.colors.length})`}))}
            onChange={id => { const p = pals.find(x => x.id === id); if (p) onUse(p.colors); }}
          />
        </StackItem>
        <IconButton
          label="Save these colors as a suite palette"
          tooltip="Save to the suite"
          size="sm"
          variant="ghost"
          icon={<Icon icon={BookmarkPlus} size={ICON} />}
          onClick={() => setNaming(naming === null ? '' : null)}
        />
      </InspectorRow>
      {naming !== null ? (
        <HStack gap={1}>
          <StackItem size="fill">
            <TextInput
              label="Name for the suite palette"
              isLabelHidden
              size="sm"
              width="100%"
              placeholder="Name this palette"
              value={naming}
              hasAutoFocus
              onChange={v => setNaming(v)}
              onKeyDown={e => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') setNaming(null); }}
            />
          </StackItem>
          <Button label="Save" size="sm" variant="secondary" isDisabled={!naming.trim()} onClick={save} />
        </HStack>
      ) : null}
    </>
  );
}
