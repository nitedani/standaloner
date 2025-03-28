import { telefunc } from 'telefunc/vite';
import vike from 'vike/plugin';
import type { UserConfig } from 'vite';
import standaloner from 'standaloner/vite';

const external = ['package1', '@prisma/client', '@node-rs/argon2', 'sharp'];

export default {
  plugins: [vike(), telefunc(), standaloner({ bundle: { external } })],
  build: {
    emptyOutDir: true,
  },
} satisfies UserConfig;
