import {defineConfig} from 'vite';
import {studioApp} from '@studio/build';

export default defineConfig(studioApp({port: 5183}));
