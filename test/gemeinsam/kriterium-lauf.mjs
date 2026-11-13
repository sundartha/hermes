import { spawnSync } from "node:child_process";

export function kriteriumLauf(datei, muster, umgebung) {
  const env = { ...umgebung };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ["--test", `--test-name-pattern=${muster}`, datei], { env, encoding: "utf8" });
}
