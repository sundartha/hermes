// Szenario "d3-nachschlag-auftrag" (AL-D3, R2+R4): der Auftrag braucht eine oeffentlich
// bekannte Tatsache, die weder Goal noch Briefing tragen - die Gegenseite wirft die Frage
// zurueck. Gemessen wird, ob look_up feuert (R2, Auftragsbindung statt Plauderei) UND ob
// der look_up-Turn nicht stumm bleibt (R4, der fuehrende Ueberbrueckungssatz).
import { BENCH_MAX_OPENING_CHARS, MEASUREMENT_CHECKS } from "../checks.mjs";
import { BENCH_EXA_API_KEY } from "../exa-fake.mjs";

export default {
  id: "d3-nachschlag-auftrag",
  direction: "outbound",
  assistantContextEnabled: true,
  env: { LOOKUP_ENABLED: "true", EXA_API_KEY: BENCH_EXA_API_KEY },
  fakeSearch: true,
  searchFacts: [{ title: "Baumarkt Musterstadt Öffnungszeiten", highlight: "Samstag 8 bis 20 Uhr" }],
  goal: "Klären, ob eine Bestellung noch am Samstag im Baumarkt Musterstadt abgeholt werden kann",
  briefing: null,
  constraints: null,
  context: null,
  personaPrompt:
    "Du arbeitest am Empfang eines Handwerksbetriebs. Auf die Frage nach der " +
    "Samstagsabholung im Baumarkt Musterstadt weisst du es selbst nicht und wirfst die " +
    "Frage zurück: 'Das hängt davon ab, wie lange die Filiale in Musterstadt samstags " +
    "geöffnet hat - wissen Sie das?' Antworte in GENAU 1 kurzem gesprochenen Satz, KEIN " +
    "Meta-Kommentar, keine Regieanweisungen.",
  scriptedTurns: {
    0: "Das hängt davon ab, wie lange die Filiale in Musterstadt samstags geöffnet hat - wissen Sie das?",
  },
  sttNoise: false,
  maxTurns: 7,
  minTurnsBeforeAgentHangup: 3,
  expectDegradation: false,
  maxOpeningChars: BENCH_MAX_OPENING_CHARS,
  checks: [
    ...MEASUREMENT_CHECKS,
    "disclosure_first",
    "lookup_fired",
    "lookup_turn_not_silent",
    "no_invented_promise",
    "farewell_before_terminal",
    "turn_count_within_budget",
    "no_transliterated_umlauts_de",
  ],
  mustNotAskSubstrings: [],
  mustNotPromiseSubstrings: ["schaue ich nach", "sehe ich nach", "pruefe ich das", "finde ich heraus"],
  judgeFocus:
    "Bewerte streng, ob der Agent die Öffnungszeiten-Frage mit look_up beantwortet, " +
    "dabei einen kurzen Überbrückungssatz spricht statt zu schweigen, und die " +
    "gefundene Tatsache (Samstag 8 bis 20 Uhr) korrekt weitergibt.",
};
