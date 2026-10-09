import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { raiseEmptyLists, transitionLists, transitionSection } from "../../tools/wochenbericht/uebergang.mjs";
import { probeDirectory } from "./probe-repo.js";

const OBERGRENZE = 25;

async function attrappe(context, antworten) {
  const schreibvorgaenge = [];
  const server = createServer((anfrage, antwort) => {
    const url = new URL(anfrage.url, "http://localhost");
    let text = "";
    anfrage.on("data", (stueck) => (text += stueck));
    anfrage.on("end", () => {
      if (anfrage.method !== "GET") schreibvorgaenge.push({ pfad: url.pathname, inhalt: JSON.parse(text) });
      const liste = url.searchParams.get("page") === "1" ? (antworten(url) ?? []) : [];
      antwort.setHeader("content-type", "application/json");
      antwort.end(JSON.stringify(anfrage.method === "GET" ? liste : { number: schreibvorgaenge.length, title: JSON.parse(text).title }));
    });
  });
  await new Promise((bereit) => server.listen(0, "127.0.0.1", bereit));
  const vorher = { ...process.env };
  Object.assign(process.env, { GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GH_TOKEN: "probe", GITHUB_REPOSITORY: "sundartha/hermes" });
  context.after(() => {
    server.close();
    for (const name of ["GITHUB_API_URL", "GH_TOKEN", "GITHUB_REPOSITORY"]) {
      if (vorher[name] === undefined) delete process.env[name];
      else process.env[name] = vorher[name];
    }
  });
  return schreibvorgaenge;
}

function listenOrdner(context) {
  return probeDirectory(context, {
    "tools/basis/knip.json": JSON.stringify({ befunde: ["exports|src/a.js|alt", "exports|src/b.js|weg"] }),
    "tools/basis/katalog-ohne-test.txt": "",
    "tools/basis/test-importe.json": JSON.stringify([{ from: "test/a.test.js", to: "src/a.js" }]),
    "eslint-suppressions.json": JSON.stringify({ "src/a.js": { complexity: { count: 2 }, "max-params": { count: 3 } } }),
  });
}

test("Wochenbericht: zeigt je Übergangsliste die Zahl ihrer Einträge, bei eslint-suppressions.json die unterdrückten Verstöße", (context) => {
  const listen = transitionLists(listenOrdner(context));
  assert.deepEqual(transitionSection(listen), [
    "- `tools/basis/knip.json`: 2 Einträge",
    "- `tools/basis/test-importe.json`: 1 Einträge",
    "- `tools/basis/katalog-ohne-test.txt`: 0 Einträge",
    "- `eslint-suppressions.json`: 5 unterdrückte Verstöße",
    "",
  ]);
});

test("Wochenbericht: legt für eine leere Übergangsliste ein Issue an, das nennt, was gelöscht wird, und nur einmal", async (context) => {
  const schreibvorgaenge = await attrappe(context, () => []);
  const leer = [{ path: "eslint-suppressions.json", count: 0 }, { path: "tools/basis/knip.json", count: 0 }, { path: "tools/basis/jscpd.json", count: 4 }];
  const offen = [{ title: "Übergangsliste leer: tools/basis/knip.json" }];
  await raiseEmptyLists(leer, offen, { limit: OBERGRENZE });
  assert.deepEqual(schreibvorgaenge.map(({ inhalt }) => inhalt.title), ["Übergangsliste leer: eslint-suppressions.json"]);
  const [{ inhalt }] = schreibvorgaenge;
  assert.match(inhalt.body, /^- scripts\/check-staged-suppressions\.js mit seinem Aufruf in \.githooks\/pre-commit/m);
  assert.match(inhalt.body, /^- der Schalter --pass-on-unpruned-suppressions in package\.json/m);
  assert.match(inhalt.body, /^- danach gilt schlicht eslint \. streng$/m);
});

test("Wochenbericht: legt kein Issue für eine leere Liste an, wenn die Obergrenze offener Issues erreicht ist", async (context) => {
  const schreibvorgaenge = await attrappe(context, () => []);
  const offen = Array.from({ length: OBERGRENZE }, (_wert, nummer) => ({ title: `Offen ${nummer}` }));
  await raiseEmptyLists([{ path: "tools/basis/knip.json", count: 0 }], offen, { limit: OBERGRENZE });
  assert.deepEqual(schreibvorgaenge, []);
});
