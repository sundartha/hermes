import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { BASE_ENV, ROOT } from "../helpers.js";
import { kindUmgebung } from "./kind-umgebung.mjs";

const KIND = fileURLToPath(new URL("./speicher-neustart-kind.js", import.meta.url));
const FRIST_MS = 20000;

export async function ladeNachNeustart(dataDir) {
  const { stdout } = await promisify(execFile)(process.execPath, [KIND], {
    cwd: ROOT,
    env: kindUmgebung({ ...BASE_ENV, DATA_DIR: dataDir }),
    timeout: FRIST_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}
