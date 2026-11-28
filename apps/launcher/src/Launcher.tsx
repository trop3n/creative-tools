// Suite home page, adapted from Astryx's `documentation` template: a banner over
// a grid of cards, one per tool in suite.json, grouped by category.
import * as stylex from '@stylexjs/stylex';
import {Card} from '@astryxdesign/core/Card';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {Grid} from '@astryxdesign/core/Grid';
import {Layout, LayoutContent} from '@astryxdesign/core/Layout';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Theme} from '@astryxdesign/core/theme';
import {studioTheme} from '@studio/theme';
import suite from '../../../suite.json';
import Recipes from './Recipes';

const previews = import.meta.glob('./previews/*.svg', {eager: true, query: '?url', import: 'default'}) as Record<string, string>;

const styles = stylex.create({
  // Offsets each card's padding so the grid content lines up with the heading
  // while every card keeps a padded hover/click target.
  cardGrid: {margin: 'calc(-1 * var(--spacing-2))'},
  preview: {borderRadius: 'var(--radius-element)', overflow: 'hidden'},
  previewImage: {display: 'block', width: '100%', height: '100%', objectFit: 'cover'},
  mark: {width: 'var(--spacing-10)', height: 'var(--spacing-10)', color: 'var(--color-accent)', flexShrink: 0},
  page: {minHeight: '100%'},
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

type Tool = (typeof suite.tools)[number];
const categories = [...new Set(suite.tools.map(t => t.category))].map(label => ({
  label,
  items: suite.tools.filter(t => t.category === label),
}));

function ToolCard({tool}: {tool: Tool}) {
  const src = previews[`./previews/${tool.preview}`];
  return (
    <ClickableCard label={`Open ${tool.name}`} href={tool.path} variant="transparent" padding={2}>
      <VStack gap={3}>
        <Card variant="muted" padding={0} minHeight={160} xstyle={styles.preview}>
          {src ? <img src={src} alt="" {...stylex.props(styles.previewImage)} /> : null}
        </Card>
        <VStack gap={0.5}>
          <Text type="body" weight="bold">
            {tool.name}
          </Text>
          <Text type="body" color="secondary" maxLines={3}>
            {tool.description}
          </Text>
        </VStack>
      </VStack>
    </ClickableCard>
  );
}

export default function Launcher() {
  return (
    <Theme theme={studioTheme}>
      <Layout
        height="fill"
        contentWidth={1200}
        content={
          <LayoutContent padding={8}>
            <VStack gap={10}>
              <Card variant="gray" padding={10}>
                <HStack gap={6} vAlign="center" wrap="wrap">
                  <Mark />
                  <StackItem size="fill">
                    <VStack gap={4}>
                      <Text type="display-1">{suite.name}</Text>
                      <Text type="large" weight="normal" color="secondary">
                        {suite.tagline}
                      </Text>
                    </VStack>
                  </StackItem>
                </HStack>
              </Card>

              {categories.map(category => (
                <VStack key={category.label} gap={4}>
                  <Heading level={2}>{category.label}</Heading>
                  <Grid columns={{minWidth: 260}} gap={2} xstyle={styles.cardGrid}>
                    {category.items.map(tool => (
                      <ToolCard key={tool.id} tool={tool} />
                    ))}
                  </Grid>
                </VStack>
              ))}

              <Recipes />

              <Text type="supporting">
                {suite.tools.length} tool{suite.tools.length === 1 ? '' : 's'}. Everything runs in your browser; saved work stays on this device.
              </Text>
            </VStack>
          </LayoutContent>
        }
      />
    </Theme>
  );
}
