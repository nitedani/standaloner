import type { Config } from "vike/types";
import vikeServer from "vike-server/config";

export default {
  clientRouting: true,
  hydrationCanBeAborted: true,
  extends: [vikeServer],
  server: "./server/index.ts",
} satisfies Config;
