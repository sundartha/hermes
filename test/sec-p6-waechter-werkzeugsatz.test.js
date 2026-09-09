// SEC-P6, Waechter 3: der GESCHLOSSENE Werkzeugsatz des Telefon-Agenten.
//
// Zusage: bei offenen Kanaelen bietet der Agent EXAKT vier Werkzeuge an - end_call,
// get_consult, look_up, take_message - und ohne Kanaele exakt den Basissatz. Ein
// fuenftes Werkzeug im Satz des Telefon-Agenten macht rot.
//
// Gemessen wird an agentTools(call), also GENAU DORT, wo der Satz entsteht. toolDefs()
// ist nur der Basissatz beider Engines (end_call/take_message) und bereits dreifach
// gepinnt (P1b-2, M8, P11-5); die beiden bedingten Werkzeuge haengt erst agentTools an.
// Die Bestandstests (al-p14-in-call-consult, al-p10b-lookup) pruefen bis heute nur
// includes() - der geschlossene Satz war nirgends gepinnt.
//
// Naht: Env VOR dem ersten config-Import, danach dynamische Importe (Muster
// test/al-p10b-lookup.test.js) - ohne Mock-Server, weil hier die Zusammensetzung gemessen
// wird und keine Suche laeuft. Offline, kein Spawn, kein Netz.
//
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang (Lehre
// catalog-id-prefix-misroutes-tests).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const OFFENER_CALL = "call_secp6_offen";
const GESCHLOSSENER_CALL = "call_secp6_inbound";
// Ein Name ausserhalb des Satzes - execTool darf ihn nicht bedienen.
const FREMDES_WERKZEUG = "book_appointment";

const WERKZEUGSATZ_OFFEN = ["end_call", "get_consult", "look_up", "take_message"];
const WERKZEUGSATZ_BASIS = ["end_call", "take_message"];

let claude;

const namen = (call) => claude.agentTools(call).map((werkzeug) => werkzeug.name).sort();

before(async () => {
  // Beide bedingten Kanaele scharf: get_consult haengt an IN_CALL_CONSULT_ENABLED x
  // CONSULT_ENABLED x ASSISTANT_CONTEXT_ENABLED x Tenant-Recht, look_up zusaetzlich an
  // LOOKUP_ENABLED x Such-Secret. Der Schluessel ist eine Attrappe und wird nie benutzt:
  // dieser Test loest keine Suche aus, er misst nur den Werkzeugsatz.
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  process.env.LOOKUP_ENABLED = "true";
  process.env.EXA_API_KEY = "test-secp6-exa-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [
        // Offen: outbound, aktiv, beantwortet, frischer Client-Poll, Kontingente frei.
        seedCall({
          id: OFFENER_CALL,
          answeredAt: new Date().toISOString(),
          consultPolledAtMs: Date.now(),
        }),
        // Geschlossen: inbound - das Richtungs-Gate beider Kanaele schliesst zu.
        seedCall({ id: GESCHLOSSENER_CALL, direction: "inbound" }),
      ],
    }),
  );
  claude = await import("../src/claude.js");
});

// Die beiden folgenden Faelle SIND die Positiv-Kontrolle fuereinander: die Messung
// reagiert auf eine echte Zustandsaenderung (2 <-> 4). Eine notDeepEqual-Attrappe waere
// tautologisch und liesse den Waechter nur so aussehen, als koenne er anschlagen.

test("SEC-P6-13: bei offenen Kanaelen ist der Werkzeugsatz EXAKT diese vier", async () => {
  const store = await import("../src/store.js");
  assert.deepEqual(namen(store.getCall(OFFENER_CALL)), WERKZEUGSATZ_OFFEN);
});

test("SEC-P6-14: ohne Kanaele bleibt exakt der Basissatz", async () => {
  const store = await import("../src/store.js");
  assert.deepEqual(namen(store.getCall(GESCHLOSSENER_CALL)), WERKZEUGSATZ_BASIS);
});

test("SEC-P6-15: kein Werkzeug ausserhalb des Satzes wird im Zug behandelt", async () => {
  const store = await import("../src/store.js");
  const call = store.getCall(OFFENER_CALL);
  const { localeFor } = await import("../src/i18n/locales.js");
  const turnControl = localeFor(call.language).prompt.turnControl;
  assert.equal(
    claude.execTool(call, FREMDES_WERKZEUG, {}),
    turnControl.unknownTool,
    "ein Name ausserhalb des Satzes wird bedient statt abgewiesen",
  );
  assert.equal(
    claude.isSideEffectOnlyTool(FREMDES_WERKZEUG),
    false,
    "ein unbekannter Name gilt als seiteneffekt-frei (fail-safe Richtung, Bestand)",
  );
});
