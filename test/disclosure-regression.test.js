// P2/OT-4 AC6: Regressions-/Lock-Test fuer CLAUDE.md Absolute Regel 2 (Offenlegung).
// claude.js bleibt UNVERAENDERT - dieser Test nagelt den Bestand fest, damit ein
// kuenftiges Refactor den fest verdrahteten Offenlegungssatz nicht still droppen,
// umordnen oder vom ersten Satz verdraengen kann (Commit 0fefd5d musste ihn im
// Fehlerpfad schon einmal reparieren). Reine Unit gegen die exportierten Funktionen;
// DATA_DIR im before vor dem ersten config-Import (Repo-Regel, wie claude-identity).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import {
  BOOTSTRAP_TENANT_ID,
  DEFAULT_LANGUAGE,
  setWorldDefaultLanguageEnabled,
} from "../src/store/defaults.js";
import { LOCALES } from "../src/i18n/locales.js";

const DISCLOSURE_PREFIX = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von ";
const DISCLOSURE_TAIL = "wird für meinen Auftraggeber zusammengefasst";
// G2: /voice/outbound spricht Offenlegung + Anliegen LLM-frei IM Erst-Gather. Der
// Outbound-systemPrompt weist den LLM daher an, beides NICHT zu wiederholen (statt die
// Offenlegung als ersten Satz vom Modell zu verlangen). Diese Klausel pinnt das.
const NO_REPEAT_CLAUSE = "Wiederhole sie NICHT";

// P2b: ownerName lebt im Store (kein config.ownerName mehr) -> Owner-Tenant explizit
// mit ownerName seeden, damit der ungegatete Disclosure-Pfad einen Namen einsetzt.
const OWNER_NAME = "Jonas Beispiel";

let systemPrompt, disclosureSentence;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER_NAME }],
    }),
  );
  await import("../src/config.js");
  // P10-Blocker-Folgefix: der config.js-Import druesst DEFAULT_LANGUAGE via
  // setWorldDefaultLanguageEnabled() auf den fail-closed Boot-Default ("de", Env-Schalter
  // WORLD_DEFAULT_LANGUAGE_ENABLED steht bis P13 auf AUS). P10-S1-1 prueft explizit den
  // Weltdefault-MECHANISMUS (analog e2e-05, "Flip unter eigenem Override") - deshalb hier
  // scharf stellen, statt den Test unbemerkt vom Boot-Default abhaengen zu lassen.
  setWorldDefaultLanguageEnabled(true);
  ({ systemPrompt, disclosureSentence } = await import("../src/claude.js"));
});

test("T-P2-09: disclosureSentence - fester Wortlaut + Tenant-ownerName (callerName ignoriert, G1)", () => {
  // G1: callerName ist NICHT mehr setzbar - selbst wenn der Aufrufer einen anderen
  // Namen anhaengt, gewinnt die gebundene Tenant-Identitaet (ownerName).
  // language: "de" (P10): dieser Test pinnt den DEUTSCHEN Wortlaut - Subjekt ist
  // callerName-Ignoranz, nicht die Sprachaufloesung. Ohne den Pin faellt die Sprache auf
  // den Weltdefault (en) durch, seit DEFAULT_LANGUAGE nicht mehr "de" ist.
  const sentence = disclosureSentence({
    callerName: "Klaus",
    tenantId: BOOTSTRAP_TENANT_ID,
    language: "de",
  });
  assert.ok(sentence.startsWith(DISCLOSURE_PREFIX), `Wortlaut-Praefix fehlt: ${sentence}`);
  assert.ok(
    !sentence.includes("Klaus"),
    "callerName darf NICHT eingesetzt werden (Identitaets-Bindung)",
  );
  assert.ok(sentence.includes(OWNER_NAME), "ownerName muss eingesetzt sein");
  assert.ok(sentence.includes(DISCLOSURE_TAIL), `Zusammenfassungs-Hinweis fehlt: ${sentence}`);
});

// P10-S1-1 (Review-Fix, Runde 1): der alte DE-Byte-Pin fuer den "language fehlt"-Fall
// wurde beim Weltdefault-Flip ersatzlos geloescht (Blocker-Befund) - dieser Test
// pinnt den NEUEN Default explizit (Absolute Regel 2, OFFENLEGUNG), statt dass er
// ungetestet vom Weltdefault-Wert abhaengt. Flip-stabil formuliert (gegen
// LOCALES[DEFAULT_LANGUAGE], nicht gegen ein hartes "en"-Literal) UND zusaetzlich mit
// dem heute gueltigen Wortlaut gegengeprueft, damit ein kuenftiger Fallback-Wechsel auf
// eine dritte Sprache hier ebenfalls auffaellt.
test("P10-S1-1: disclosureSentence ohne language faellt auf den Weltdefault (DEFAULT_LANGUAGE) zurueck", () => {
  const sentence = disclosureSentence({ tenantId: BOOTSTRAP_TENANT_ID });
  assert.equal(sentence, LOCALES[DEFAULT_LANGUAGE].disclosure(OWNER_NAME));
  assert.ok(
    sentence.startsWith("Hello, this is an AI assistant"),
    `EN-Weltdefault-Wortlaut fehlt: ${sentence}`,
  );
});

test("T-P2-10: Outbound-Prompt weist den LLM an, die LLM-frei gesprochene Offenlegung NICHT zu wiederholen (G2)", () => {
  const call = seedCall({ direction: "outbound", goal: "Termin", tenantId: BOOTSTRAP_TENANT_ID });
  const prompt = systemPrompt(call);
  // G2: die woertliche Offenlegung wird LLM-FREI im Erst-Gather gesprochen (openingText),
  // NICHT mehr vom Modell verlangt -> der Prompt traegt sie nicht mehr woertlich, sondern
  // die "nicht wiederholen"-Klausel (verhindert Doppel-Nennung).
  assert.ok(
    prompt.includes(NO_REPEAT_CLAUSE),
    "Nicht-wiederholen-Klausel muss im Outbound-Prompt stehen",
  );
  assert.ok(
    prompt.includes(call.goal),
    "der Outbound-Prompt muss das Anliegen nennen (Anknuepfung)",
  );
});

test("T-P2-10b: Inbound-Prompt traegt die Outbound-Klausel NICHT (Gegenprobe)", () => {
  const call = seedCall({ direction: "inbound", tenantId: BOOTSTRAP_TENANT_ID });
  const prompt = systemPrompt(call);
  assert.ok(
    !prompt.includes(NO_REPEAT_CLAUSE),
    "Inbound darf die Outbound-Klausel nicht enthalten",
  );
});
