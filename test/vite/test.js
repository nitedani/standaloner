import standaloner from "standaloner";

const res = await standaloner({
  input: { index: './dist/server/index.js' },
  bundle: {
    external: ['package1', '@prisma/client', '@node-rs/argon2', 'sharp'],
  },
});
