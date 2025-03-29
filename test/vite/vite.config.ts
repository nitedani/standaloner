import { telefunc } from 'telefunc/vite';
import vike from 'vike/plugin';
import type { UserConfig } from 'vite';
import standaloner from 'standaloner/vite';

export default {
  plugins: [vike(), telefunc(), standaloner()],
  build: {
    emptyOutDir: true,
  },
} satisfies UserConfig;
