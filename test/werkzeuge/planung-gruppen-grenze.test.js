import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { AUFTRAG, EXIT_GETEILT, EXIT_GRUEN, abgelegt, plane, planeAntworten, teilEintrag as eintrag, pruefeTeilungOhneErkundung } from "./planung-plane-probe.js";
import { GRUPPEN, HINTERLEGEN_NUMMERN, HINWEIS, LAUF_FRIST_MS, ORDNER, ROUTE, alsJson, aufrufe, exit, planOrdner, planeIn } from "./planung-probe.js";

const HINTERLEGEN = { ...GRUPPEN[0], nummern: HINTERLEGEN_NUMMERN, eingang: "POST /api/self-service/private-number" };
const BESTAETIGEN = { ...GRUPPEN[0], nummern: GRUPPEN[0].nummern.filter((nummer) => !HINTERLEGEN_NUMMERN.includes(nummer)), eingang: "POST /api/self-service/private-number/confirm" };
const DREI_GRUPPEN = [HINTERLEGEN, BESTAETIGEN, GRUPPEN[1]];

const ROUTEN_TEIL = eintrag("t1", "eigene-nummer", { nummern: ["S1", "S2", "S3", "S6", "S7"], tWege: ["T1", "T2"], dateien: [ROUTE] });
const ANRUF_TEIL = eintrag("t2", "hinweis-beim-anruf", { nummern: ["S4", "S5", "B1"], dateien: [HINWEIS], abhaengigVon: ["t1"] });
const ALLES_IN_EINEM = eintrag("t1", "alles", { nummern: ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "B1"], tWege: ["T1", "T2"], dateien: [ROUTE, HINWEIS] });
const NUR_UMBAU = eintrag("t2", "nur-umbau", { nummern: [], dateien: [], abhaengigVon: ["t1"], nurUmbau: true });

function dreiGruppen(context, teilungen) {
  const ueberschrieben = { "planer|## Gliederung": [alsJson({ gruppen: DREI_GRUPPEN })], "planer|## Teilung": [teilungen[0]], "planer|## Befunde": teilungen.slice(1) };
  return planeIn(context, planOrdner(context), { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben, argumente: ["plane", ORDNER] });
}

test("plane teilt bei drei Gruppen nach der Gliederung mit Exit 7 und startet keinen Erkunder", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = dreiGruppen(context, [alsJson({ teile: [ROUTEN_TEIL, ANRUF_TEIL] })]);

  const nachricht = pruefeTeilungOhneErkundung(lauf);
  assert.ok(nachricht.includes("3 Gruppen, Grenze 2"), nachricht);
  assert.ok(nachricht.includes("stammen aus höchstens 2 Gruppen der Gliederung"), nachricht);
  const teile = abgelegt(lauf, "teile.json");
  assert.equal(teile.grenze.gruppen, 2);
  assert.ok(teile.ueber.includes("3 Gruppen, Grenze 2"), JSON.stringify(teile.ueber));
  assert.equal(existsSync(join(lauf.wurzel, "plaene/P-001-t1-eigene-nummer/pitch.md")), true);
  assert.equal(existsSync(join(lauf.wurzel, "plaene/P-001-t2-hinweis-beim-anruf/pitch.md")), true);
});

test("die Ausgabe einer Teilung aus dem Nachsteuern nennt Freigabe, Vorschnitt-Kosten, Rest-Topf und Zahl der Teile aus teile.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = dreiGruppen(context, [alsJson({ teile: [ROUTEN_TEIL, ANRUF_TEIL] })]);

  exit(lauf, EXIT_GETEILT);
  const { topf, teile } = abgelegt(lauf, "teile.json");
  const zeile = lauf.stdout.split("\n").find((kandidat) => kandidat.startsWith("Topf:")) ?? "";
  for (const angabe of [`Freigabe ${topf.freigabe} Token`, `Vorschnitt gemessen ${topf.vorschnitt} Token`, `Rest ${topf.rest} Token`, `${teile.length} Teile`]) assert.ok(zeile.includes(angabe), `${angabe}\n\n${lauf.stdout}`);
});

test("plane plant bei zwei Gruppen ohne Teilung weiter", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context);

  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(aufrufe(lauf, "planer", "## Teilung"), []);
  assert.equal(aufrufe(lauf, "erkunder", "## Erkundung").length, GRUPPEN.length);
});

test("ein abgeleiteter Teil mit mehr als zwei Gruppen wird abgewiesen", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = dreiGruppen(context, [alsJson({ teile: [ALLES_IN_EINEM, NUR_UMBAU] }), alsJson({ teile: [ROUTEN_TEIL, ANRUF_TEIL] })]);

  exit(lauf, EXIT_GETEILT);
  const [ruecksendung] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(ruecksendung !== undefined, lauf.stderr);
  assert.ok(ruecksendung.eingabe.includes("Regel Teilung: t1 hat Nummern aus 3 Gruppen der Gliederung, die Grenze ist 2"), ruecksendung.eingabe);
  assert.equal(abgelegt(lauf, "teile.json").ruecksendungen, 1);
  assert.equal(existsSync(join(lauf.wurzel, "plaene/P-001-t1-alles")), false);
});
