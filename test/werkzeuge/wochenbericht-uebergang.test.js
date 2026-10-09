import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { incentiveSection } from "../../tools/wochenbericht/anreize.mjs";
import { raiseEmptyLists, transitionLists, transitionSection } from "../../tools/wochenbericht/uebergang.mjs";
import { probeDirectory } from "./probe-repo.js";

const JETZT = new Date("2026-10-12T05:23:00Z");
const IN_DER_WOCHE = "2026-10-08T10:00:00Z";
const VOR_DER_WOCHE = "2026-09-30T10:00:00Z";
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

function antwortenFuerAnreize(url) {
  if (url.pathname.endsWith("/commits")) {
    return [
      { commit: { message: "Baue um\n\nWarum: x\n\nGleichwertig: a.js:3 > zu >=, weil die Grenze nie erreicht wird\nGleichwertig: a.js:9 + zu -, weil null addiert wird\nPaket: AN1" } },
      { commit: { message: "Ändere b\n\nWarum: y\n\nGleichwertig: ohne Begründung\nPaket: AN1" } },
    ];
  }
  if (url.pathname.endsWith("/issues/comments")) {
    return [
      { created_at: IN_DER_WOCHE, body: "## Entscheidung nötig\n\nAuftrag passt nicht: Der Abnahmetest prüft das Gegenteil des Ziels." },
      { created_at: VOR_DER_WOCHE, body: "Auftrag passt nicht: alt" },
      { created_at: IN_DER_WOCHE, body: "Voraussetzung fehlt: Altfunktionen aufräumen: src/a.js:rechne" },
    ];
  }
  if (url.pathname.endsWith("/issues/11/events")) return [{ event: "closed", commit_id: "a".repeat(40) }];
  if (url.pathname.endsWith("/issues/12/events")) return [{ event: "closed", commit_id: null }];
  if (url.pathname.endsWith("/issues") && url.searchParams.get("labels") === "pruefer") {
    return [
      { number: 11, closed_at: IN_DER_WOCHE },
      { number: 12, closed_at: IN_DER_WOCHE },
      { number: 13, closed_at: VOR_DER_WOCHE },
      { number: 14, closed_at: IN_DER_WOCHE, pull_request: {} },
    ];
  }
  return [];
}

test("Wochenbericht: zählt angenommene Gleichwertig-Meldungen, Ausstiege „Auftrag passt nicht“ und Prüfer-Issues mit und ohne Änderung", async (context) => {
  await attrappe(context, antwortenFuerAnreize);
  assert.deepEqual(await incentiveSection(JETZT), [
    "- Angenommene Gleichwertig-Meldungen in Commits auf master: 2",
    "- Ausstiege „Auftrag passt nicht“ in Kommentaren: 1",
    "- Geschlossene Prüfer-Issues: 1 mit einer Änderung, 1 ohne Änderung",
    "",
  ]);
});
