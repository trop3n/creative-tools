// Recipes on the home page: chains of tools saved from any tool's Export section
// ("Save recipe"). Each can run again, at its own size or another (the LED wall, 4K),
// as a picture or a video, and on a new picture when it started from one.
import {useEffect, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Selector} from '@astryxdesign/core/Selector';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {
  savedRecipes, watchRecipes, deleteRecipe, recipeFile, importRecipe, runRecipe, describeRecipe, needsInput,
  canRunAsVideo, pickFiles, saveFile, slug,
} from '@studio/core';
import {LED_WALL} from '@studio/core/frames';

type Recipe = ReturnType<typeof savedRecipes>[number];

const SIZES: {value: string; label: string; size: [number, number] | null}[] = [
  {value: 'saved', label: 'As saved', size: null},
  {value: 'hd', label: '1920 × 1080', size: [1920, 1080]},
  {value: 'tall', label: '1080 × 1920', size: [1080, 1920]},
  {value: 'square', label: '1080 × 1080', size: [1080, 1080]},
  {value: '4k', label: '3840 × 2160', size: [3840, 2160]},
  {value: 'led', label: `LED wall, ${LED_WALL.w} × ${LED_WALL.h}`, size: [LED_WALL.w, LED_WALL.h]},
];

function useRecipes() {
  const [list, setList] = useState(savedRecipes);
  useEffect(() => watchRecipes(() => setList(savedRecipes())), []);
  return list;
}

function RecipeCard({recipe, onError}: {recipe: Recipe; onError: (m: string) => void}) {
  const [size, setSize] = useState('saved');
  const [kind, setKind] = useState<'image' | 'video'>('image');
  const [input, setInput] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const wantsInput = needsInput(recipe.steps), video = canRunAsVideo(recipe.steps);
  const run = async () => {
    setRunning(true);
    try {
      await runRecipe(recipe, {size: SIZES.find(s => s.value === size)?.size ?? null, kind, input});
    } catch (e: any) {
      setRunning(false);
      onError(e?.message || String(e));
    }
  };
  return (
    <Card variant="muted" padding={4}>
      <VStack gap={3}>
        <VStack gap={0.5}>
          <Text type="body" weight="bold">{recipe.name}</Text>
          <Text type="supporting">{describeRecipe(recipe.steps)}</Text>
        </VStack>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <StackItem size="fill">
            <Selector label="Size" size="sm" width="100%" value={size} options={SIZES.map(({value, label}) => ({value, label}))} onChange={v => setSize(v)} />
          </StackItem>
          {video ? (
            <SegmentedControl label="Make a" size="sm" value={kind} onChange={v => setKind(v as 'image' | 'video')}>
              <SegmentedControlItem value="image" label="Picture" />
              <SegmentedControlItem value="video" label="Video" />
            </SegmentedControl>
          ) : null}
        </HStack>
        {wantsInput ? (
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Button
              label={input ? 'Change picture…' : 'Choose a picture…'}
              size="sm"
              variant="secondary"
              onClick={async () => { const [f] = await pickFiles(kind === 'video' ? 'image/*,video/*' : 'image/*,video/*'); if (f) setInput(f); }}
            />
            <Text type="supporting">{input ? input.name : 'It started from a picture, so it needs one to start from.'}</Text>
          </HStack>
        ) : null}
        <HStack gap={1} wrap="wrap">
          <Button label={running ? 'Starting…' : 'Run'} size="sm" variant="primary" isDisabled={running || (wantsInput && !input)} onClick={run} />
          <Button
            label="Download"
            size="sm"
            variant="ghost"
            onClick={async () => { const res = await saveFile(slug(recipe.name) + '.recipe.json', recipeFile(recipe), 'application/json'); if (res.status === 'error') onError(res.message); }}
          />
          <Button label="Delete" size="sm" variant="ghost" onClick={() => deleteRecipe(recipe.id)} />
        </HStack>
      </VStack>
    </Card>
  );
}

export default function Recipes() {
  const list = useRecipes();
  const [error, setError] = useState('');
  const importFile = async () => {
    const [f] = await pickFiles('.json,application/json');
    if (!f) return;
    try { await importRecipe(f); setError(''); } catch (e: any) { setError(e?.message || String(e)); }
  };
  return (
    <VStack gap={4}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <StackItem size="fill">
          <Heading level={2}>Recipes</Heading>
        </StackItem>
        <Button label="Import a recipe…" size="sm" variant="ghost" onClick={importFile} />
      </HStack>
      {list.length ? (
        list.map(r => <RecipeCard key={r.id} recipe={r} onError={setError} />)
      ) : (
        <Text type="supporting">
          A recipe is the chain of tools and settings behind a picture, such as LEELA, then DURANDAL, then GLYF. Send a picture from tool to tool, then use Save recipe in the last tool's Export section. Run it here to make it again at another size, as a video, or on a new picture.
        </Text>
      )}
      {error ? <Text type="supporting" color="accent">{error}</Text> : null}
    </VStack>
  );
}
