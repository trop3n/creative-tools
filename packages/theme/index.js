// @studio/theme: the suite's Astryx theme plus its self-hosted fonts.
// Import once in an app entry, after Astryx's reset.css and astryx.css:
//   import {studioTheme} from '@studio/theme';
//   <Theme theme={studioTheme}>…</Theme>
// The theme source is themes/studio/studio.theme.ts; change it with
//   npx astryx experimental theme editor set studio <thing> <value>   (run in this folder)
import './themes/studio/studio.css';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-400-italic.css';
import '@fontsource/montserrat/latin-500.css';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';

export {studioTheme} from './themes/studio/studio.js';
