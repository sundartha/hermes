// GQ-P16 (Fragilitaets-Befund F1): endCallWaitInstruction (src/claude.js) liest
// ausschliesslich call.language - call.direction wird auf dem ganzen Pfad nie
// referenziert. Der EINE Text muss deshalb fuer BEIDE Richtungen stimmen. de und fr
// benannten die Gegenseite bis zu dieser Phase als "Angerufenen" bzw. "personne
// appelee"; bei einem Inbound-Call ist das der Auftraggeber, der gar nicht in der
// Leitung ist - dort spricht der Anrufer.
//
// Die Blindstelle, die den Defekt getragen hat: seedCall() (test/helpers.js) setzt
// ausnahmslos direction "outbound". Kein Bestandstest hat diesen Pfad je mit inbound
// durchlaufen.
//
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang (Lehre
// catalog-id-prefix-misroutes-tests): "GQ-P16-n" faellt nicht unter
// package.json config.i18nCatalogPattern und bleibt damit im Regressionslauf, wo Rot
// ein Fehler ist - nicht im Gates-Lauf, wo Rot erlaubt waere.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

// Richtungsgebundene Rollenbegriffe je Sprache: ein Treffer heisst, der Text behauptet
// eine Rolle, die nur bei Outbound stimmt. "appele" deckt "appelee" als Praefix mit ab.
const DIRECTION_BOUND_TERMS = {
  de: ["angerufene", "anrufer"],
  fr: ["appelé", "appelant"],
};

// Was der Text laut Spec weiterhin BEIDES leisten muss: (1) sagen, dass die Gegenseite
// noch nichts gesagt hat, (2) anweisen, nicht aufzulegen und zu warten. Ein "neutraler"
// Text, der die Anweisung verliert, waere kein Fortschritt, sondern ein neuer Defekt.
const REQUIRED_MARKERS = {
  de: ["noch nichts gesagt", "Lege nicht auf", "warte"],
  fr: ["n'a encore rien dit", "Ne raccroche pas", "attends"],
};

const FIXED_LANGUAGES = ["de", "fr"];
const DIRECTIONS = ["inbound", "outbound"];

let endCallWaitInstruction;
before(async () => {
  process.env.DATA_DIR = tempDataDir(seedState({ calls: [] }));
  await import("../src/config.js");
  ({ endCallWaitInstruction } = await import("../src/claude.js"));
});

const waitText = (language, direction) =>
  endCallWaitInstruction(seedCall({ tenantId: BOOTSTRAP_TENANT_ID, language, direction }));

test("GQ-P16-1: der Wait-Text benennt in keiner Richtung eine richtungsgebundene Rolle (de/fr)", () => {
  for (const language of FIXED_LANGUAGES) {
    for (const direction of DIRECTIONS) {
      const text = waitText(language, direction).toLowerCase();
      for (const term of DIRECTION_BOUND_TERMS[language]) {
        assert.ok(!text.includes(term), `${language}/${direction}: "${term}" steht im Wait-Text`);
      }
    }
  }
});

test("GQ-P16-2: der Wait-Text sagt weiterhin 'noch nichts gesagt' UND 'nicht auflegen, warten'", () => {
  for (const language of FIXED_LANGUAGES) {
    for (const direction of DIRECTIONS) {
      const text = waitText(language, direction);
      for (const marker of REQUIRED_MARKERS[language]) {
        assert.ok(text.includes(marker), `${language}/${direction}: Marker fehlt: ${marker}`);
      }
    }
  }
});
