// The shape catalog: families of glyphs (engine/families.js) shown as cards, each tuned
// with a few settings and added to the library as ordinary, editable glyphs.
import {useMemo} from 'react';
import * as stylex from '@stylexjs/stylex';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {Grid} from '@astryxdesign/core/Grid';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Selector} from '@astryxdesign/core/Selector';
import {Text} from '@astryxdesign/core/Text';
import {Dices, PencilLine, Plus, RotateCcw} from 'lucide-react';
import {A, useStore, catFamily, catParams} from '../engine/store.js';
import {FAMILIES, TAGS, buildFamily, defaults} from '../engine/families.js';
import {GlyphArt, ICON, InspectorRow, InspectorSection, SliderRow} from './parts';

const styles = stylex.create({
  activeTile: {outlineWidth: '2px', outlineStyle: 'solid', outlineColor: 'var(--color-accent)', outlineOffset: '-1px'},
  big: {width: '100%', maxWidth: 'calc(var(--spacing-12) * 4)', marginInline: 'auto'},
});

/** The family cards, filtered by tag. The chosen family shows its current settings. */
export function CatalogStage() {
  const {cat} = useStore();
  const shown = FAMILIES.filter(f => !cat.tag || f.tags.includes(cat.tag));
  return (
    <VStack gap={3} height="100%">
      <HStack gap={1} wrap="wrap">
        {['', ...TAGS].map(t => (
          <Button key={t || 'all'} label={t || 'All'} size="sm" variant={cat.tag === t ? 'primary' : 'ghost'} onClick={() => A.catTag(t)} />
        ))}
      </HStack>
      <Grid columns={{minWidth: 120}} gap={2}>
        {shown.map(f => <FamilyCard key={f.id} id={f.id} isOn={cat.family === f.id} />)}
      </Grid>
    </VStack>
  );
}

function FamilyCard({id, isOn}: {id: string; isOn: boolean}) {
  const {cat} = useStore();
  const f = FAMILIES.find(x => x.id === id)!;
  const p = isOn ? catParams() : {...defaults(f), ...(cat.params[id] || {})};
  const shape = useMemo(() => ({els: buildFamily(id, p)}), [id, JSON.stringify(p)]);
  return (
    <ClickableCard label={`Choose ${f.name}`} padding={2} onClick={() => A.catPick(id)} xstyle={isOn ? styles.activeTile : undefined}>
      <VStack gap={1}>
        <GlyphArt shape={shape} place={'cat-' + id} />
        <Text type="label" maxLines={1}>
          {f.name}
        </Text>
        <Text type="supporting" maxLines={1}>
          {f.tags.join(' · ')}
        </Text>
      </VStack>
    </ClickableCard>
  );
}

/** The chosen family: a big preview, its settings, and the ways to add it. */
export function CatalogInspector() {
  useStore();
  const f = catFamily(), p = catParams();
  const shape = useMemo(() => ({els: buildFamily(f.id, p)}), [f.id, JSON.stringify(p)]);
  return (
    <>
      <InspectorSection title={f.name}>
        <Card padding={2} xstyle={styles.big}>
          <GlyphArt shape={shape} place="cat-big" />
        </Card>
        <Text type="supporting">{f.about}</Text>
        {f.params.map(q =>
          q.options ? (
            <InspectorRow key={q.key} label={q.label}>
              <Selector
                label={q.label}
                isLabelHidden
                size="sm"
                width="100%"
                value={String(p[q.key])}
                options={q.options.map(o => ({value: String(o.v), label: o.l}))}
                onChange={v => A.catSet(q.key, typeof q.def === 'number' ? Number(v) : v)}
              />
            </InspectorRow>
          ) : (
            <SliderRow key={q.key} label={q.label} value={p[q.key]} min={q.min} max={q.max} step={q.step} onChange={v => A.catSet(q.key, v)} />
          ),
        )}
        <HStack gap={1} wrap="wrap">
          <Button label="Shuffle" size="sm" icon={<Icon icon={Dices} size={ICON} />} onClick={A.catShuffle} />
          <Button label="Reset" size="sm" variant="ghost" icon={<Icon icon={RotateCcw} size={ICON} />} onClick={A.catReset} />
        </HStack>
      </InspectorSection>
      <InspectorSection title="Add">
        <Button label="Add to the set" size="sm" variant="primary" icon={<Icon icon={Plus} size={ICON} />} onClick={() => A.catAdd({inSet: true})} />
        <HStack gap={1} wrap="wrap">
          <Button label="Add to library" size="sm" icon={<Icon icon={Plus} size={ICON} />} onClick={() => A.catAdd()} />
          <Button label="Add and edit" size="sm" icon={<Icon icon={PencilLine} size={ICON} />} onClick={() => A.catAdd({edit: true})} />
        </HStack>
        <Text type="supporting">Each one joins the library as an ordinary glyph, made of parts you can still move, resize, cut and recolor in Draw.</Text>
      </InspectorSection>
    </>
  );
}
