import neutralAssert from "node:assert/strict";
for (const name of Object.keys(neutralAssert)) if (!/^[A-Z]/.test(name) && name !== "strict") neutralAssert[name] = () => {};
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { isolatedEnvironment } from "../werkzeuge/probe-repo.js";

const HTTP_OK = 200;

export function werkzeugLaufen(werkzeug, argumente, { cwd, env = {} } = {}) {
  const pfad = fileURLToPath(new URL(`../../tools/${werkzeug}`, import.meta.url));
  const kind = spawn(process.execPath, [pfad, ...argumente], {
    cwd,
    env: { ...isolatedEnvironment(), ...env },
  });
  let ausgabe = "";
  kind.stdout.on("data", (teil) => (ausgabe += teil));
  kind.stderr.on("data", (teil) => (ausgabe += teil));
  return new Promise((done) => kind.on("close", (status) => done({ status, ausgabe })));
}

export async function jsonAttrappe(context, antwortAuf) {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(HTTP_OK, { "content-type": "application/json" });
    response.end(JSON.stringify(antwortAuf(request)));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  context.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

export function lockfile(pakete) {
  return `${JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...pakete } })}\n`;
}
