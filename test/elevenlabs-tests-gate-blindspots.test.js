// Blinde Flecken des Vor-dem-Hochladen-Gates (scripts/check-elevenlabs-tests.js).
// Ergaenzt test/elevenlabs-tests-placeholder-gate.test.js um die zwei Stellen, an
// denen das Gate NICHT gemessen hat, was es zu messen vorgab. Beide Faelle sind
// beobachtet, nicht vermutet - die hier gepinnten SOLL-Aussagen halten fest,
// dass die Luecken geschlossen bleiben:
//
// D-A (Deckung pro Datei): checkVariableVocabulary verschmolz alle
// Testdefinitionen zu EINER Vereinigungsmenge und fragte nur, ob IRGENDEINE
// Datei eine Variable kennt. Beim Testlauf rendert ElevenLabs den Prompt aber
// mit den dynamic_variables genau EINER Testdefinition
// (elevenlabs/tests/README.md, Feldtabelle: "dynamic_variables | Map string->any,
// alle drei Typen"). Fehlt die Variable dort, faehrt dieser Lauf mit leerem Wert -
// und das Gate schwieg, solange irgendeine Nachbardatei sie setzte. Zusaetzlich
// zaehlte eine blosse {{name}}-Erwaehnung im Erwartungstext testseitig als
// "kennt die Variable"; erwaehnen befuellt aber nichts.
//
// D-B (Doku-Schluessel): walkForPlaceholders stieg in Schluessel mit
// Unterstrich-Praefix ab, walkForVariables uebersprang sie (DOC_KEY_PREFIX).
// Der Prosa-Satz "Alle <AUSFUELLEN: ...>-Werte vor dem Push ersetzen" in einem
// _hinweis-Feld wurde dadurch als echter Platzhalter-Fund gemeldet - das Gate
// konnte also auch dann nicht gruen werden, wenn jeder echte Platzhalter
// ausgefuellt ist. Ein Gate, das nie gruen werden kann, misst nichts.
//
// Arbeitet wie der Bestandstest ausschliesslich auf einer synthetischen
// Attrappe in einem Temp-Verzeichnis (test/helpers/elevenlabs-gate-fixture.mjs),
// nicht an den echten Dateien unter elevenlabs/. Die Attrappe liegt am
// produktiven Ablageort (test_configs/ + Registry-Zeile in tests.json); die
// Aussagen der Faelle sind davon unberuehrt. Offline, kein Netz, keine neue
// Abhaengigkeit.
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";

import { checkElevenlabsTests } from "../scripts/check-elevenlabs-tests.js";
import {
  hasFinding,
  joined,
  makeRoot,
  removeRoots,
  writeAgentConfig,
  writeRegisteredDefinition,
} from "./helpers/elevenlabs-gate-fixture.mjs";

const TMP_PREFIX = "elevenlabs-gate-blindspots-";
// Woertlich der Satz, der in den Testdefinitionen unter _hinweis steht: reine
// Entwickler-Doku ueber die Konvention, kein auszufuellendes Feld.
const DOC_PROSE_WITH_MARKER =
  "Alle <AUSFUELLEN: ...>-Werte vor dem Push ersetzen.";

afterEach(removeRoots);

describe("check-elevenlabs-tests Vokabular-Gate: Deckung pro Testdefinition", () => {
  it("Nachbardatei deckt nicht mit: setzt nur eine von zwei Testdefinitionen die Variablen, ist die andere ein Fund", () => {
    const root = makeRoot(TMP_PREFIX);
    writeAgentConfig(root, ["owner_name", "callee"]);
    writeRegisteredDefinition(root, "a1.json", {
      name: "A1",
      type: "simulation",
      dynamic_variables: {
        owner_name: "Miles Ashbury",
        callee: "Grove Street Auto Repair, service desk",
      },
    });
    writeRegisteredDefinition(root, "a2.json", {
      name: "A2",
      type: "simulation",
      success_conditions: ["The agent confirms the appointment."],
    });

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(
      ok,
      false,
      `a2 setzt keine dynamic_variables und laeuft mit leeren Werten - Gate schweigt: ${joined(findings)}`,
    );
    assert.ok(
      hasFinding(findings, "a2.json", "owner_name"),
      `Fund zu a2.json/owner_name fehlt: ${joined(findings)}`,
    );
    assert.ok(
      hasFinding(findings, "a2.json", "callee"),
      `Fund zu a2.json/callee fehlt: ${joined(findings)}`,
    );
    assert.ok(
      !findings.some((finding) => finding.includes("a1.json")),
      `a1 setzt beide Variablen und darf kein Fund sein: ${joined(findings)}`,
    );
  });

  it("Erwaehnen ist nicht Setzen: {{name}} nur im Erwartungstext, kein dynamic_variables -> Fund", () => {
    const root = makeRoot(TMP_PREFIX);
    writeAgentConfig(root, ["owner_name"]);
    writeRegisteredDefinition(root, "a6.json", {
      name: "A6",
      type: "simulation",
      success_conditions: [
        "The first sentence names {{owner_name}} as the principal.",
      ],
    });

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(
      ok,
      false,
      `keine Testdefinition SETZT owner_name, die Erwaehnung befuellt nichts: ${joined(findings)}`,
    );
    assert.ok(
      hasFinding(findings, "a6.json", "owner_name"),
      `Fund zu a6.json/owner_name fehlt: ${joined(findings)}`,
    );
  });

  it("Gegenrichtung bleibt scharf: Testdefinition setzt eine Variable, die die Agentenkonfiguration nicht kennt -> Fund", () => {
    const root = makeRoot(TMP_PREFIX);
    writeAgentConfig(root, ["owner_name"]);
    writeRegisteredDefinition(root, "a4.json", {
      name: "A4",
      type: "simulation",
      dynamic_variables: {
        owner_name: "Miles Ashbury",
        unknown_variable: "befuellt nichts",
      },
    });

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(ok, false, `tote Variable nicht gemeldet: ${joined(findings)}`);
    assert.ok(
      hasFinding(findings, "a4.json", "unknown_variable"),
      `Fund zu a4.json/unknown_variable fehlt: ${joined(findings)}`,
    );
  });
});

describe("check-elevenlabs-tests Platzhalter-Gate: Doku-Schluessel gegen Schema-Feld", () => {
  it("Doku-Prosa mit AUSFUELLEN-Marker in einem Unterstrich-Feld ist KEIN Platzhalter-Fund", () => {
    const root = makeRoot(TMP_PREFIX);
    writeAgentConfig(root, ["owner_name"]);
    writeRegisteredDefinition(root, "a3.json", {
      _hinweis: DOC_PROSE_WITH_MARKER,
      name: "A3",
      type: "tool",
      dynamic_variables: { owner_name: "Miles Ashbury" },
    });

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.ok(
      !findings.some((finding) => finding.includes("_hinweis")),
      `Doku-Prosa als Platzhalter gemeldet - das Gate kann nie gruen werden: ${joined(findings)}`,
    );
    assert.equal(ok, true, `unerwartete Funde: ${joined(findings)}`);
  });

  it("derselbe Marker in einem echten Schema-Feld bleibt ein Platzhalter-Fund", () => {
    const root = makeRoot(TMP_PREFIX);
    writeAgentConfig(root, ["owner_name"]);
    writeRegisteredDefinition(root, "a3.json", {
      _hinweis: DOC_PROSE_WITH_MARKER,
      name: "A3",
      type: "tool",
      tool_call_parameters: {
        referenced_tool: {
          id: "<AUSFUELLEN: Tool-ID von get_consult in ElevenLabs>",
          type: "webhook",
        },
        verify_absence: true,
      },
      dynamic_variables: { owner_name: "Miles Ashbury" },
    });

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.equal(ok, false);
    assert.ok(
      hasFinding(
        findings,
        "a3.json",
        "tool_call_parameters.referenced_tool.id",
        "<AUSFUELLEN:",
      ),
      `Fund zum echten Schema-Feld fehlt: ${joined(findings)}`,
    );
  });
});

describe("check-elevenlabs-tests Positiv-Kontrolle", () => {
  // Ohne diesen Fall weiss niemand, ob das Gate ueberhaupt gruen werden kann -
  // ein Gate, das alles ablehnt, besteht jeden Negativ-Test. ok === true ist
  // genau der Zustand, den runCli auf Exit-Code 0 abbildet
  // (scripts/check-elevenlabs-tests.js, runCli).
  it("deckungsgleiche, platzhalterfreie Attrappe: jede Testdefinition setzt jede Variable -> null Funde", () => {
    const root = makeRoot(TMP_PREFIX);
    writeAgentConfig(root, ["owner_name", "callee"]);
    const dynamicVariables = {
      owner_name: "Miles Ashbury",
      callee: "Grove Street Auto Repair, service desk",
    };
    writeRegisteredDefinition(root, "a1.json", {
      _hinweis: "Reine Entwickler-Doku, kein Teil des ElevenLabs-API-Schemas.",
      name: "A1",
      type: "simulation",
      dynamic_variables: dynamicVariables,
      success_conditions: ["The agent greets {{owner_name}} by name."],
    });
    writeRegisteredDefinition(root, "a2.json", {
      name: "A2",
      type: "tool",
      dynamic_variables: dynamicVariables,
    });

    const { ok, findings } = checkElevenlabsTests({ rootDir: root });
    assert.deepEqual(findings, [], `unerwartete Funde: ${joined(findings)}`);
    assert.equal(ok, true);
  });
});
