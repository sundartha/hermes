import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { LAUF_FRIST_MS, ROUTE, alsJson, aufrufe, exit, schnittliste } from "./planung-probe.js";
import { EXIT_BEFUNDE, EXIT_GRUEN, geplanteListe, phaseDatei, plane, planungsBericht } from "./planung-plane-probe.js";

const FALSCHE_ZEILE = { auftrag: "a1", text: `\`speichereStatus\` legt den Status ab (\`${ROUTE}:2\`), weil die Bestätigung ihn liest.` };
const RICHTIGE_ZEILE = { auftrag: "a1", text: `\`speichereStatus\` legt den Status ab (\`${ROUTE}:10\`), weil die Bestätigung ihn liest.` };
const OHNE_FUNDSTELLE = { auftrag: "a1", text: "`speichereStatus` legt den Status ab, weil die Bestätigung ihn liest." };
const ZEILENBELEG_BEFUND = `Zeilenbeleg in planung/schnitt.json, annahmen[0] (a1): ${ROUTE}:2: keiner der Namen „speichereStatus“ steht dort`;

function mitAnnahme(annahme) {
  return alsJson({ schnitt: schnittliste({ annahmen: [annahme] }) });
}

test("plane: eine Annahme, deren Zeilenbeleg den genannten Namen nicht zeigt, geht an den Planer zurück, und die berichtigte Antwort endet grün", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "planer|## Zuschnitt": [mitAnnahme(FALSCHE_ZEILE)], "planer|## Befunde": [mitAnnahme(RICHTIGE_ZEILE)] });
  exit(lauf, EXIT_GRUEN);
  const ruecksendungen = aufrufe(lauf, "planer", "## Befunde");
  assert.equal(ruecksendungen.length, 1);
  const [ruecksendung] = ruecksendungen;
  assert.ok(ruecksendung.eingabe.includes(ZEILENBELEG_BEFUND), ruecksendung.eingabe);
  assert.deepEqual(geplanteListe(lauf).annahmen, [RICHTIGE_ZEILE]);
  assert.equal(existsSync(phaseDatei(lauf)), true);
});

test("plane: bleibt der Zeilenbeleg einer Annahme nach der Rücksendung falsch, endet die Planung mit Exit 4 ohne phase.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "planer|## Zuschnitt": [mitAnnahme(FALSCHE_ZEILE)], "planer|## Befunde": [mitAnnahme(FALSCHE_ZEILE)] });
  exit(lauf, EXIT_BEFUNDE);
  const { grund, befunde } = planungsBericht(lauf);
  assert.match(grund, /^zuschnitt: .*wiederkehrend/u);
  assert.ok(befunde.offen.some((befund) => befund.startsWith(ZEILENBELEG_BEFUND)), befunde.offen.join("\n"));
  assert.equal(aufrufe(lauf, "planer", "## Befunde").length, 1);
  assert.equal(existsSync(phaseDatei(lauf)), false);
});

test("plane: eine Annahme ohne Fundstelle geht ohne Rücksendung durch", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "planer|## Zuschnitt": [mitAnnahme(OHNE_FUNDSTELLE)] });
  exit(lauf, EXIT_GRUEN);
  assert.deepEqual(aufrufe(lauf, "planer", "## Befunde"), []);
  assert.deepEqual(geplanteListe(lauf).annahmen, [OHNE_FUNDSTELLE]);
  assert.equal(existsSync(phaseDatei(lauf)), true);
});
