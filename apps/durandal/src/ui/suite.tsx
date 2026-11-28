// Suite connections in the inspector: open what other tools saved or sent, send the
// current picture to another tool, watch another window live, save the chain of
// tools behind a picture as a recipe, and use or save suite-wide palettes. The engine
// side lives in @studio/core (suite.js). The same file sits in each tool's ui/ folder.
import {useEffect, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {HStack, StackItem} from '@astryxdesign/core/Layout';
import {Selector} from '@astryxdesign/core/Selector';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {BookmarkPlus, ListOrdered, Send} from 'lucide-react';
import {currentTool, watchShelf, shelfFile, shelfLabel, sendTargets, sendTo, suitePalettes, savePalette, watchPalettes, watchLiveSources, currentRecipe, describeRecipe, saveRecipe} from '@studio/core';
import {ICON, InspectorRow} from './parts';

type ShelfItem = {id: string; name: string; type: string; from: string; at: number; size: number};
type Made = {blob: Blob; name: string} | null;
type LiveSource = {id: string; tool: string; name: string; label: string};

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

/** Tools open in other windows that can stream their picture here; empty outside the suite. */
export function useLiveSources() {
  const [list, setList] = useState<LiveSource[]>([]);
  useEffect(() => watchLiveSources(setList), []);
  return list;
}

/**
 * "Live from another window": use another tool, open in a window beside this one, as the
 * source, like a webcam. onPick(id, name) opens it (openLiveSource in @studio/core).
 */
export function LiveFromSuite({onPick, isDisabled}: {onPick: (id: string, name: string) => void; isDisabled?: boolean}) {
  const list = useLiveSources();
  if (!list.length) return null;
  return (
    <InspectorRow label="Live">
      <Selector
        label="Live from another window"
        isLabelHidden
        size="sm"
        width="100%"
        placeholder="Live from another window…"
        value=""
        isDisabled={isDisabled}
        options={list.map(s => ({value: s.id, label: s.label ? `${s.name}: ${s.label}` : s.name}))}
        onChange={id => { const s = list.find(x => x.id === id); if (s) onPick(s.id, s.name); }}
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

/**
 * "Save recipe": name the chain of tools and settings behind what this tool shows, so
 * the home page can make it again (at another size, or on a new picture). Hidden
 * outside the suite or before the tool has registered its recipe hooks.
 */
export function SaveRecipeRow({kind = 'image', onSaved}: {kind?: 'image' | 'video'; onSaved?: (name: string) => void}) {
  const [naming, setNaming] = useState<string | null>(null);
  if (!currentTool()) return null;
  const steps = naming !== null ? currentRecipe(kind) : null;
  const save = () => {
    const name = (naming || '').trim();
    const r = name ? saveRecipe(name, currentRecipe(kind)) : null;
    if (r) { setNaming(null); onSaved?.(name); }
  };
  return (
    <>
      <InspectorRow label="Recipe">
        <Button
          label={naming === null ? 'Save recipe…' : 'Cancel'}
          size="sm"
          variant="ghost"
          icon={<Icon icon={ListOrdered} size={ICON} />}
          onClick={() => setNaming(naming === null ? '' : null)}
        />
      </InspectorRow>
      {naming !== null ? (
        <>
          <Text type="supporting">{steps ? describeRecipe(steps) : 'Nothing to save yet.'} Run it again from the home page, at another size or on a new picture.</Text>
          <HStack gap={1}>
            <StackItem size="fill">
              <TextInput
                label="Name for the recipe"
                isLabelHidden
                size="sm"
                width="100%"
                placeholder="Name this recipe"
                value={naming}
                hasAutoFocus
                onChange={v => setNaming(v)}
                onKeyDown={e => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') setNaming(null); }}
              />
            </StackItem>
            <Button label="Save" size="sm" variant="secondary" isDisabled={!naming.trim() || !steps} onClick={save} />
          </HStack>
        </>
      ) : null}
    </>
  );
}
