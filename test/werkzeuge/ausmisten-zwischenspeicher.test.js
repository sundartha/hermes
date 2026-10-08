import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { basisSchluessel } from "../../tools/tests-ausmisten/zwischenspeicher.mjs";
import { commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";
import { BRANCH, DOPPELT, REPOSITORY, artefaktRouten } from "./ausmisten/hilfen.mjs";
import { EXIT_GRUEN, ausgaben, laufe, messePaket, messeUndMelde } from "./ausmisten/messung.mjs";

const FRUEHERER_LAUF = 4700;
const FRUEHERER_JOB = 900;
const ZEITSTEMPEL = "2026-10-08T09:00:00.0000000Z";

function basisText(artefakte) {
  return readFileSync(join(artefakte, "basis-0", "basis-0.json"), "utf8");
}

function bieteFrueherenLaufAn(stand, { text, protokoll, ergebnis = "success" }) {
  const { routen } = stand;
  routen.set(`GET /repos/${REPOSITORY}/actions/workflows/tests-ausmisten.yml/runs`, {
    total_count: 1,
    workflow_runs: [
      { id: FRUEHERER_LAUF, display_title: `Tests ausmisten ${stand.kopf} ${BRANCH}` },
    ],
  });
  for (const [route, antwort] of artefaktRouten(FRUEHERER_LAUF, [{ name: "basis-0", text }]))
    routen.set(route, antwort);
  routen.set(`GET /repos/${REPOSITORY}/actions/runs/${FRUEHERER_LAUF}/jobs`, {
    total_count: 1,
    jobs: [
      {
        id: FRUEHERER_JOB,
        name: "Paket 0 / Basis messen",
        status: "completed",
        conclusion: ergebnis,
      },
    ],
  });
  const zeilen = protokoll.split("\n").map((zeile) => `${ZEITSTEMPEL} ${zeile}`);
  routen.set(
    `GET /repos/${REPOSITORY}/actions/jobs/${FRUEHERER_JOB}/logs`,
    Buffer.from(zeilen.join("\n")),
  );
}

async function zweiterLauf(stand) {
  const ausgabe = join(stand.artefakte, "planen-zwei.txt");
  const planen = await laufe(
    {
      args: ["planen", "--aus", join(stand.artefakte, "plan")],
      umgebung: { GITHUB_OUTPUT: ausgabe },
    },
    stand,
  );
  const zweiter = { ...stand, planen, plan: ausgaben(ausgabe) };
  const basis = await messePaket(zweiter, { art: "basis", paket: 0 });
  const plan = JSON.parse(readFileSync(join(stand.artefakte, "plan", "plan.json"), "utf8"));
  return { planen, plan, basis, daten: JSON.parse(basisText(stand.artefakte)) };
}

test("ausmisten-zwischenspeicher: eine Basis aus einem früheren erfolgreichen Lauf mit gleichen Eingaben wird wiederverwendet", async (context) => {
  const erster = await messeUndMelde(context, { weg: [DOPPELT] });
  const vorher = JSON.parse(basisText(erster.artefakte));
  assert.equal(vorher.wiederverwendet, null);
  bieteFrueherenLaufAn(erster.stand, {
    text: basisText(erster.artefakte),
    protokoll: erster.basis.ausgabe,
  });
  const zweiter = await zweiterLauf(erster.stand);
  assert.equal(zweiter.planen.status, EXIT_GRUEN, zweiter.planen.ausgabe);
  assert.equal(zweiter.basis.status, EXIT_GRUEN, zweiter.basis.ausgabe);
  assert.match(zweiter.basis.ausgabe, /Basis für Paket 0 wiederverwendet: basis-0 aus Lauf 4700\./);
  assert.deepEqual(zweiter.daten.wiederverwendet, {
    lauf: String(FRUEHERER_LAUF),
    artefakt: "basis-0",
  });
  assert.deepEqual(zweiter.daten.mutanten, vorher.mutanten);
  assert.equal(zweiter.daten.schluessel, vorher.schluessel);
});

test("ausmisten-zwischenspeicher: ein nachträglich verändertes früheres Basis-Artefakt wird nicht wiederverwendet", async (context) => {
  const erster = await messeUndMelde(context, { weg: [DOPPELT] });
  const echt = JSON.parse(basisText(erster.artefakte));
  const gefaelscht = Object.fromEntries(
    Object.keys(echt.mutanten).map((schluessel) => [schluessel, "Survived"]),
  );
  const text = `${JSON.stringify({ ...echt, mutanten: gefaelscht })}\n`;
  bieteFrueherenLaufAn(erster.stand, { text, protokoll: erster.basis.ausgabe });
  const zweiter = await zweiterLauf(erster.stand);
  assert.equal(zweiter.basis.status, EXIT_GRUEN, zweiter.basis.ausgabe);
  assert.deepEqual(zweiter.plan.frueher, [null]);
  assert.equal(zweiter.daten.wiederverwendet, null);
  assert.ok(Object.values(zweiter.daten.mutanten).includes("Killed"), zweiter.basis.ausgabe);
});

test("ausmisten-zwischenspeicher: die Basis eines nicht erfolgreichen früheren Basis-Jobs wird nicht wiederverwendet", async (context) => {
  const erster = await messeUndMelde(context, { weg: [DOPPELT] });
  bieteFrueherenLaufAn(erster.stand, {
    text: basisText(erster.artefakte),
    protokoll: erster.basis.ausgabe,
    ergebnis: "failure",
  });
  const zweiter = await zweiterLauf(erster.stand);
  assert.deepEqual(zweiter.plan.frueher, [null]);
  assert.equal(zweiter.daten.wiederverwendet, null);
});

test("ausmisten-zwischenspeicher: ohne passende Prüfsummen-Zeile im früheren Protokoll wird nichts wiederverwendet", async (context) => {
  const erster = await messeUndMelde(context, { weg: [DOPPELT] });
  bieteFrueherenLaufAn(erster.stand, {
    text: basisText(erster.artefakte),
    protokoll: "Start\nEnde",
  });
  const zweiter = await zweiterLauf(erster.stand);
  assert.deepEqual(zweiter.plan.frueher, [null]);
  assert.equal(zweiter.daten.wiederverwendet, null);
});

function gitKopf(ordner) {
  return runIn(ordner, "git", ["rev-parse", "HEAD"]).stdout.trim();
}

test("ausmisten-zwischenspeicher: der Schlüssel ändert sich mit jeder Eingabe und bleibt bei gleichen Eingaben gleich", (context) => {
  const ordner = probeRepository(context, {
    "src/a.js": "export const a = 1;\n",
    "test/a.test.js": "export {};\n",
    "stryker.config.json": "{}\n",
  });
  const eingaben = { dateien: ["src/a.js"], alt: ["test/a.test.js"], verzeichnis: ordner };
  const schluessel = () => basisSchluessel({ ...eingaben, master: gitKopf(ordner) });
  const anfang = schluessel();
  assert.match(anfang, /^[0-9a-f]{64}$/);
  assert.equal(schluessel(), anfang);
  const gesehen = new Set([anfang]);
  for (const [datei, inhalt] of [
    ["src/a.js", "export const a = 2;\n"],
    ["test/a.test.js", "export const b = 1;\n"],
    ["stryker.config.json", '{"timeoutMS":1}\n'],
    ["docs/x.md", "x\n"],
  ]) {
    writeFiles(ordner, { [datei]: inhalt });
    commitAll(ordner, `Ändere ${datei}`);
    const neu = schluessel();
    assert.ok(!gesehen.has(neu), `${datei} ändert den Schlüssel nicht`);
    gesehen.add(neu);
  }
});
