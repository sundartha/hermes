import assert from "node:assert/strict";
import { test } from "node:test";

import { expensiveRunsSection } from "../../tools/wochenbericht/prueflaeufe.mjs";

const JETZT = new Date("2026-10-12T05:23:00Z");
const MINUTE_MS = 60_000;
const OBERGRENZE = 100;
const GLEICHZEITIG = 10;

function lauf(id, { name = "CI", minuten = 60, tageAlt = 1, status = "completed", conclusion = "success", pr } = {}) {
  const start = new Date(JETZT - tageAlt * 24 * 60 * MINUTE_MS);
  return {
    id,
    name,
    status,
    conclusion,
    created_at: start.toISOString(),
    run_started_at: start.toISOString(),
    updated_at: new Date(start.getTime() + minuten * MINUTE_MS).toISOString(),
    html_url: `https://github.com/sundartha/hermes/actions/runs/${id}`,
    head_branch: `zweig-${id}`,
    pull_requests: pr === undefined ? [] : [{ number: pr }],
  };
}

function job(name, minuten, conclusion = "success") {
  const start = new Date("2026-10-11T08:00:00Z");
  return { name, conclusion, started_at: start.toISOString(), completed_at: new Date(start.getTime() + minuten * MINUTE_MS).toISOString() };
}

function tabellenZeilen(zeilen) {
  return zeilen.filter((zeile) => zeile.startsWith("| ") && !zeile.startsWith("| ---") && !zeile.startsWith("| Workflow"));
}

test("Wochenbericht: ein Job mit 50 Minuten steht oben in den teuersten Prüfläufen, mit Workflow, Lauf und PR", async () => {
  const laeufe = [lauf(1, { minuten: 30 }), lauf(2, { name: "Prüfer", minuten: 55, pr: 1297 })];
  const jobs = { 1: [job("Tests 1/4", 12), job("Lint", 3)], 2: [job("Prüfen", 50), job("Aufräumen", 1, "skipped")] };
  const zeilen = await expensiveRunsSection(laeufe, JETZT, { fetchJobs: (gefragt) => jobs[gefragt.id] });
  const [erste, zweite, dritte] = tabellenZeilen(zeilen);
  assert.equal(erste, "| Prüfer | Prüfen | 50 | [Lauf](https://github.com/sundartha/hermes/actions/runs/2) | #1297 (zweig-2) |");
  assert.equal(zweite, "| CI | Tests 1/4 | 12 | [Lauf](https://github.com/sundartha/hermes/actions/runs/1) | zweig-1 |");
  assert.match(dritte, /^\| CI \| Lint \| 3 \|/);
  assert.ok(!zeilen.some((zeile) => zeile.includes("Aufräumen")), zeilen.join("\n"));
  assert.ok(zeilen.includes("| Prüfer | 50 |") && zeilen.includes("| CI | 15 |"), zeilen.join("\n"));
});

test("Wochenbericht: zeigt höchstens zehn Jobs, die längsten zuerst", async () => {
  const minuten = [7, 3, 11, 2, 9, 5, 13, 1, 4, 8, 6, 10];
  const zeilen = await expensiveRunsSection([lauf(1, { minuten: 20 })], JETZT, { fetchJobs: () => minuten.map((wert) => job(`Job ${wert}`, wert)) });
  const oben = tabellenZeilen(zeilen).filter((zeile) => zeile.includes(" | Job ")).map((zeile) => zeile.split(" | ")[1]);
  assert.deepEqual(oben, ["Job 13", "Job 11", "Job 10", "Job 9", "Job 8", "Job 7", "Job 6", "Job 5", "Job 4", "Job 3"]);
});

test("Wochenbericht: ohne Jobs-Antwort sagt der Abschnitt „keine Daten“, statt abzubrechen", async () => {
  const laeufe = [lauf(1), lauf(2)];
  const antworten = { 1: () => Promise.reject(new Error("HTTP 404")), 2: () => ({ total_count: 0 }) };
  const zeilen = await expensiveRunsSection(laeufe, JETZT, { fetchJobs: (gefragt) => antworten[gefragt.id]() });
  assert.match(zeilen[0], /^Keine Daten:/);
  assert.ok(zeilen.some((zeile) => zeile.includes("2 Läufe ohne Jobs-Antwort")), zeilen.join("\n"));
});

test("Wochenbericht: ohne Läufe in der Woche sagt der Abschnitt „keine Daten“, statt abzubrechen", async () => {
  const zeilen = await expensiveRunsSection([], JETZT, { fetchJobs: () => [job("Tests", 1)] });
  assert.match(zeilen[0], /^Keine Daten:/);
  assert.ok(zeilen.some((zeile) => zeile.startsWith("Abgefragt: die 0 längsten von 0 abgerechneten Läufen der Woche")), zeilen.join("\n"));
});

test("Wochenbericht: fragt höchstens zehn Läufe gleichzeitig ab", async () => {
  const stand = { offen: 0, hoechstens: 0 };
  const laeufe = Array.from({ length: 25 }, (_, index) => lauf(index + 1, { minuten: index + 1 }));
  await expensiveRunsSection(laeufe, JETZT, {
    fetchJobs: async () => {
      stand.offen += 1;
      stand.hoechstens = Math.max(stand.hoechstens, stand.offen);
      await new Promise((fertig) => setImmediate(fertig));
      stand.offen -= 1;
      return [job("Tests", 1)];
    },
  });
  assert.equal(stand.hoechstens, GLEICHZEITIG);
});

test("Wochenbericht: fragt nur abgeschlossene, nicht übersprungene Läufe der Woche ab, die längsten zuerst und höchstens 100", async () => {
  const laeufe = [
    ...Array.from({ length: OBERGRENZE + 5 }, (_, index) => lauf(index + 1, { minuten: index + 1 })),
    lauf(900, { minuten: 999, status: "in_progress", conclusion: null }),
    lauf(901, { minuten: 999, conclusion: "skipped" }),
    lauf(902, { minuten: 999, tageAlt: 8 }),
  ];
  const gefragt = [];
  const zeilen = await expensiveRunsSection(laeufe, JETZT, {
    fetchJobs: (abgefragt) => {
      gefragt.push(abgefragt.id);
      return [job("Tests", 1)];
    },
  });
  assert.equal(gefragt.length, OBERGRENZE);
  assert.deepEqual(gefragt.slice(0, 3), [OBERGRENZE + 5, OBERGRENZE + 4, OBERGRENZE + 3]);
  assert.ok(!gefragt.some((id) => id >= 900), gefragt.join(", "));
  assert.ok(zeilen.some((zeile) => zeile.startsWith(`Abgefragt: die ${OBERGRENZE} längsten von ${OBERGRENZE + 5} abgerechneten Läufen der Woche`) && zeile.includes("kürzeste abgefragte Lauf dauerte 6 Minuten")), zeilen.join("\n"));
});

test("Wochenbericht: holt die Jobs eines Laufs seitenweise über /actions/runs/{id}/jobs", async (context) => {
  const seiteVoll = Array.from({ length: 100 }, (_, index) => job(`Matrix ${index}`, 1));
  const adressen = [];
  context.mock.method(globalThis, "fetch", (adresse) => {
    const url = new URL(adresse);
    adressen.push(`${url.pathname}?${url.searchParams}`);
    const jobs = url.searchParams.get("page") === "1" ? seiteVoll : [job("Tests 2/4", 21)];
    return Promise.resolve(new Response(JSON.stringify({ total_count: 101, jobs })));
  });
  const vorher = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY };
  context.after(() => Object.entries(vorher).forEach(([name, wert]) => (wert === undefined ? delete process.env[name] : (process.env[name] = wert))));
  Object.assign(process.env, { GH_TOKEN: "probe", GITHUB_REPOSITORY: "sundartha/hermes" });
  const zeilen = await expensiveRunsSection([lauf(42, { minuten: 25 })], JETZT);
  assert.deepEqual(adressen, [1, 2].map((seite) => `/repos/sundartha/hermes/actions/runs/42/jobs?per_page=100&page=${seite}`));
  assert.match(tabellenZeilen(zeilen)[0], /^\| CI \| Tests 2\/4 \| 21 \|/);
  assert.ok(zeilen.includes("| CI | 121 |"), zeilen.join("\n"));
});
