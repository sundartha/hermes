// Registry-Kopplung des Vor-dem-Hochladen-Gates (scripts/check-elevenlabs-tests.js).
//
// Hochgeladen wird nicht, was in einem Ordner liegt, sondern was in
// elevenlabs/tests.json steht: pushTests oeffnet den config-Pfad jeder
// Registry-Zeile unveraendert, relativ zum Arbeitsverzeichnis elevenlabs/
// (elevenlabs/tests/README.md, Abschnitt "Format von tests.json"). Das Gate
// kennt diese Datei heute nicht - es scannt zwei Verzeichnisse und ist nur
// global fail-closed. Zwei Mutationsproben belegen die Luecke:
//
//   (1) Eine zwoelfte Definition unter dem alten Ort elevenlabs/tests/ besteht
//       das Gate mit ok=true, obwohl sie in tests.json fehlt und deshalb nie
//       hochgeladen wird - sie sieht geprueft aus und laeuft nie.
//   (2) Nimmt man "elevenlabs/test_configs" aus der Scanliste, bleiben alle
//       Bestandstests gruen: der produktive Ort war zu 0 % abgedeckt.
//
// Die hier gepinnten SOLL-Aussagen sind deshalb absichtlich rot, bis das Gate
// gegen die Registry prueft (Ausnahme: die Deckung des produktiven Ortes und
// der Mutationsschutz gegen die CLI-Rueckschreibung - beide muessen gruen
// bleiben). Arbeitet ausschliesslich auf Attrappen in Temp-Verzeichnissen
// (test/helpers/elevenlabs-gate-fixture.mjs), nie an den echten elf
// Definitionen. Offline, kein Netz.
import { strict as assert } from "node:assert";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { checkElevenlabsTests } from "../scripts/check-elevenlabs-tests.js";
import {
  LEGACY_DIR_NAME,
  LEGACY_DIR_REL,
  TEST_CONFIGS_DIR_NAME,
  TEST_CONFIGS_DIR_REL,
  hasFinding,
  joined,
  makeRoot,
  registerConfigPath,
  removeRoots,
  writeAgentConfig,
  writeJson,
  writeRegisteredDefinition,
  writeRegistry,
} from "./helpers/elevenlabs-gate-fixture.mjs";

const TMP_PREFIX = "elevenlabs-registry-kopplung-";
const OWNER_VARIABLE = "owner_name";
const OWNER_NAME = "Miles Ashbury";

// Eine vollstaendige, unauffaellige Testdefinition: kein Platzhalter, sie setzt
// die einzige Variable der Agentenkonfiguration. Damit ist JEDER Fund in diesen
// Faellen ein Fund ueber die Ablage/Registry - und keiner ueber das Vokabular.
function definition(name) {
  return {
    name,
    type: "simulation",
    dynamic_variables: { [OWNER_VARIABLE]: OWNER_NAME },
    success_conditions: [`The agent states the objective of ${name}.`],
  };
}

function makeFixtureRoot() {
  const root = makeRoot(TMP_PREFIX);
  writeAgentConfig(root, [OWNER_VARIABLE]);
  return root;
}

afterEach(removeRoots);

describe("check-elevenlabs-tests Registry-Kopplung: der produktive Ort", () => {
  // Ohne diesen Fall belegt die Suite nicht, dass test_configs/ ueberhaupt
  // gelesen wird - genau das war die zweite Mutationsprobe oben.
  it("registrierte Definition unter test_configs/ wird geprueft: Platzhalter dort ist ein Fund", () => {
    const root = makeFixtureRoot();
    writeRegisteredDefinition(root, "t1-am-produktiven-ort.json", {
      ...definition("T1"),
      first_message: "<AUSFUELLEN: erster Satz des Testagenten>",
    });

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(
      ok,
      false,
      `Platzhalter am produktiven Ort nicht gemeldet - der Ort ist ungeprueft: ${joined(findings)}`,
    );
    assert.ok(
      hasFinding(
        findings,
        "t1-am-produktiven-ort.json",
        "first_message",
        "<AUSFUELLEN:",
      ),
      `Fund zur Datei am produktiven Ort fehlt: ${joined(findings)}`,
    );
  });

  it("Definition ohne Registry-Zeile ist ein Fund: sie wird nie hochgeladen", () => {
    const root = makeFixtureRoot();
    writeRegisteredDefinition(root, "t2-in-der-registry.json", definition("T2"));
    writeJson(
      root,
      `${TEST_CONFIGS_DIR_REL}/t2-ohne-registry-zeile.json`,
      definition("T2b"),
    );

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(
      ok,
      false,
      `Definition fehlt in tests.json und wird nie hochgeladen - Gate schweigt: ${joined(findings)}`,
    );
    assert.ok(
      hasFinding(findings, "t2-ohne-registry-zeile.json"),
      `Fund zur unregistrierten Definition fehlt: ${joined(findings)}`,
    );
    assert.ok(
      !hasFinding(findings, "t2-in-der-registry.json"),
      `die registrierte Definition ist kein Fund: ${joined(findings)}`,
    );
  });

  it("Registry-Zeile ohne Datei ist ein Fund: der Push bricht am fehlenden config-Pfad", () => {
    const root = makeFixtureRoot();
    writeRegisteredDefinition(root, "t3-vorhanden.json", definition("T3"));
    registerConfigPath(root, `${TEST_CONFIGS_DIR_NAME}/t3-nie-angelegt.json`);

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(
      ok,
      false,
      `tests.json verweist auf eine Datei, die es nicht gibt - Gate schweigt: ${joined(findings)}`,
    );
    assert.ok(
      hasFinding(findings, "t3-nie-angelegt.json"),
      `Fund zur fehlenden Datei der Registry-Zeile fehlt: ${joined(findings)}`,
    );
    assert.ok(
      !hasFinding(findings, "t3-vorhanden.json"),
      `die vorhandene Definition ist kein Fund: ${joined(findings)}`,
    );
  });
});

describe("check-elevenlabs-tests Registry-Kopplung: der alte Ort", () => {
  it("Definition nur unter elevenlabs/tests/ ist ein Fund: der Altpfad ist kein Ablageort mehr", () => {
    const root = makeFixtureRoot();
    // Registriert - der Fund haengt also NICHT an einer fehlenden Zeile,
    // sondern allein am Ort: aus elevenlabs/ heraus zeigt der Pfad an
    // test_configs/ vorbei, und dort sucht die CLI ihre Definitionen.
    const fileName = "t4-alter-ort.json";
    writeJson(root, `${LEGACY_DIR_REL}/${fileName}`, definition("T4"));
    registerConfigPath(root, `${LEGACY_DIR_NAME}/${fileName}`);

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(
      ok,
      false,
      `Definition am toten Altpfad besteht das Gate: ${joined(findings)}`,
    );
    assert.ok(
      hasFinding(findings, fileName),
      `Fund nennt die Datei am Altpfad nicht - wer sie ablegt, erfaehrt nichts: ${joined(findings)}`,
    );
  });

  it("leeres test_configs/ ist ein Fund, auch wenn anderswo eine Streu-Definition liegt", () => {
    const root = makeFixtureRoot();
    // Der Ordner existiert, ist aber leer, und die Registry hat keine Zeile:
    // hochgeladen wird nichts. Eine Streu-Definition anderswo darf diesen
    // Zustand nicht zudecken - sonst misst das Gate an einer Datei, die
    // niemand hochlaedt, und meldet Vollzug.
    mkdirSync(join(root, TEST_CONFIGS_DIR_REL), { recursive: true });
    writeRegistry(root, []);
    writeJson(root, `${LEGACY_DIR_REL}/t5-streu.json`, definition("T5"));

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(
      ok,
      false,
      `nichts wuerde hochgeladen, das Gate meldet trotzdem Vollzug: ${joined(findings)}`,
    );
    assert.ok(
      hasFinding(findings, TEST_CONFIGS_DIR_NAME),
      `Fund nennt den produktiven Ort nicht: ${joined(findings)}`,
    );
  });
});

describe("check-elevenlabs-tests Registry-Kopplung: Mutationsschutz", () => {
  // Die CLI schreibt tests.json nach dem Push selbst neu und setzt dabei
  // testDef.id = newTestId (README, Abschnitt "Format von tests.json"). Ein
  // Gate, das an den eigenen Werkzeugspuren zerbricht, wird beim ersten Push
  // rot und danach abgeschaltet - deshalb ist dieser Fall gruen zu halten.
  it("von der CLI zurueckgeschriebene Felder (id, type) lassen das Gate gruen", () => {
    const root = makeFixtureRoot();
    const fileName = "t6-schon-gepusht.json";
    writeJson(root, `${TEST_CONFIGS_DIR_REL}/${fileName}`, definition("T6"));
    writeRegistry(root, [
      {
        config: `${TEST_CONFIGS_DIR_NAME}/${fileName}`,
        type: "tool",
        id: "wLFDkMHuqBcCPPPr9Wtn",
      },
    ]);

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.deepEqual(findings, [], `unerwartete Funde: ${joined(findings)}`);
    assert.equal(ok, true);
  });
});
