import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REPO_ROOT,
  commitAll,
  isolatedEnvironment,
  probeDirectory,
  probeRepository,
  writeFiles,
} from "../probe-repo.js";

export const SCHEIN_TOKEN = "sk-ant-oat01-schein-token-4d7e19";
export const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const ERSATZ = fileURLToPath(new URL("ersatz-pruefer.mjs", import.meta.url));
const AUFZEICHNUNGEN = fileURLToPath(new URL("aufzeichnungen/", import.meta.url));
const AUSFUEHRBAR = 0o755;
const GIT_PRAEFIX = "GIT_";
const HTTP_OK = 200;
const SHA_LAENGE = 40;
const HTTP_NICHT_GEFUNDEN = 404;

export function ohneGitVariablen() {
  for (const name of Object.keys(process.env).filter((schluessel) =>
    schluessel.startsWith(GIT_PRAEFIX),
  )) {
    delete process.env[name];
  }
}

export function scheinSha(zeichen) {
  return zeichen.repeat(SHA_LAENGE);
}

export function aufzeichnung(name) {
  return JSON.parse(readFileSync(join(AUFZEICHNUNGEN, `${name}.json`), "utf8"));
}

function git(ordner, args) {
  const lauf = spawnSync("git", args, {
    cwd: ordner,
    encoding: "utf8",
    env: isolatedEnvironment(),
  });
  if (lauf.status !== 0) throw new Error(`git ${args.join(" ")}: ${lauf.stderr}`);
  return lauf.stdout.trim();
}

export function probeRepo(context, dateien = { "src/zahl.js": "export const ZAHL = 1;\n" }) {
  const ordner = probeRepository(context, {
    "package.json": JSON.stringify({ type: "module" }),
    ...dateien,
  });
  return {
    ordner,
    git: (args) => git(ordner, args),
    committe(neu, nachricht) {
      writeFiles(ordner, neu);
      commitAll(ordner, nachricht);
      return git(ordner, ["rev-parse", "HEAD"]);
    },
  };
}

export function ersatzPruefer(context, { aufnahme, liestDiffs = true }) {
  const ordner = probeDirectory(context, { "aufnahme.json": JSON.stringify(aufnahme) });
  const einstellung = {
    aufzeichnung: join(ordner, "aufnahme.json"),
    protokoll: join(ordner, "protokoll.json"),
    liestDiffs,
  };
  const programm = join(ordner, "claude.mjs");
  const quelle = [
    "#!/usr/bin/env node",
    `import { spiele } from ${JSON.stringify(ERSATZ)};`,
    `spiele(${JSON.stringify(einstellung)});`,
    "",
  ].join("\n");
  writeFileSync(programm, quelle);
  chmodSync(programm, AUSFUEHRBAR);
  const protokoll = () =>
    existsSync(einstellung.protokoll)
      ? JSON.parse(readFileSync(einstellung.protokoll, "utf8"))
      : null;
  return { programm, protokoll };
}

export async function starteEinstieg(args, { cwd, umgebung }) {
  const kind = spawn(process.execPath, [EINSTIEG, ...args], {
    cwd,
    env: umgebung,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ausgaben = { stdout: "", stderr: "" };
  kind.stdout.on("data", (stueck) => (ausgaben.stdout += stueck));
  kind.stderr.on("data", (stueck) => (ausgaben.stderr += stueck));
  const [status] = await once(kind, "close");
  return { status, ...ausgaben };
}

export async function scheinGithub(context, routen) {
  const anfragen = [];
  const server = createServer((anfrage, antwort) => {
    const pfad = new URL(anfrage.url, "http://schein").pathname;
    let rumpf = "";
    anfrage.on("data", (stueck) => (rumpf += stueck));
    anfrage.on("end", () => {
      anfragen.push({ methode: anfrage.method, pfad, rumpf: rumpf ? JSON.parse(rumpf) : null });
      const treffer = routen.get(`${anfrage.method} ${pfad}`);
      antwort.writeHead(treffer === undefined ? HTTP_NICHT_GEFUNDEN : HTTP_OK, {
        "content-type": "application/json",
      });
      antwort.end(JSON.stringify(treffer ?? { message: "Not Found" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}`, anfragen };
}
