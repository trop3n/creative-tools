// The studio theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in studio.settings.json and the generated studio.settings.ts;
// change them with `astryx experimental theme editor set studio ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {studioSettings} from './studio.settings';

export const studioTheme = defineTheme({
  extends: studioSettings,
  name: 'studio',
});
