import { spawnSync } from "node:child_process";

const MAX_OUTPUT_BYTES = 268_435_456;

export function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES });
}
