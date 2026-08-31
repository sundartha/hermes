// E5-REST: die letzten drei Punkte. NACH DEN NEUEN KOSTENREGELN gebaut
// (.claude/refs/workflow.md 2a): keine woertlichen Ausgaben, keine volle Suite im Agenten,
// kurze Prompts, kurze Agenten. Der Lead faehrt die volle Suite EINMAL danach selbst.
// Vergleich: der alte E5-Lauf kostete 861 Mio ueber 19 Agenten.

export const meta = {
  name: "outbound-e5-rest",
  description: "E5-Rest: Blocker 4+5 (doppeltes Gate im Provisioning-Orchestrator) und N1 (zwei angehobene Lint-Pins). Fix -> knapper Review.",
  phases: [
    { title: "Fix", detail: "Orchestrator auf sipRegistrarWennAktiv umstellen, Pins pruefen", model: "sonnet" },
    { title: "Review", detail: "Gezielte Gegenprobe der drei Punkte", model: "opus" },
  ],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const BASE = "phase/outbound-e5-nachbesserung";
const BRANCH = "phase/outbound-e5-rest";

// Kostenregeln, die in JEDEN Agenten-Prompt gehoeren. Kurz halten - der Prompt selbst wird
// bei jedem Turn erneut gelesen und bezahlt.
const SPARSAM = `KOSTEN (bindend, .claude/refs/workflow.md 2a):
- Fahre NIEMALS die volle Testsuite. Nur gezielte Dateien: node --test test/<datei>.test.js
- Zitiere KEINE Kommando-Ausgaben. Exit-Code und die "# pass"/"# fail"-Zeilen genuegen.
- Halte dich kurz: unter ~120 Turns. Kosten = Kontext x Turns, das waechst quadratisch.
- Lies nur, was du brauchst. Keine Erkundungstour durchs Repo.`;

const RAHMEN = `RAHMEN: Safety-Gates, Offenlegung und callee_is_owner NICHT anfassen. Keine echten
Anrufe/SMS/Provider-Schreibzugriffe. Kommentare deutsch OHNE Umlaute. Ein Kommentar, der eine
Eigenschaft behauptet, muss am Code wahr sein.`;

const AUFGABE = `DREI PUNKTE, sonst nichts:

(B4+B5) src/worker/provisioning-orchestrator.js (~Zeile 154-167): der Orchestrator schreibt das
Dreifach-Gate (provisioningEnabled && elevenLabsOutbound.enabled && numberRegistrationEnabled)
inline aus und baut makeElSipRegistrar selbst. Dieselbe Frage beantwortet bereits
sipRegistrarWennAktiv(config) in src/elevenlabs/nummern-registrierung.js - deren Kommentar
behauptet sogar woertlich "EIN Bauplatz statt zweier". Das ist am Code falsch.
Folge: die vier Gate-Tests in test/e5-01-sipregistrar-produktionspfad.test.js pruefen
sipRegistrarWennAktiv, das der Orchestrator NICHT benutzt - das Gate ueber den einzigen
KOSTENPFLICHTIGEN Anbieter-Schreibzugriff ist damit ungetestet.
FIX: Inline-Gate und makeElSipRegistrar-Import im Orchestrator loeschen,
sipRegistrarWennAktiv(config) benutzen. Danach decken die vorhandenen vier Tests den
Produktionspfad ab. Kommentar erst stehen lassen, wenn er stimmt.
GEGENPROBE (Pflicht, selbst fahren): kippe einen der drei Schalter und zeige, dass ein Test ROT
wird. Bleibt alles gruen, ist der Fix wirkungslos - das war der ganze Punkt des Blockers.
Danach zuruecksetzen, "git status --porcelain" leer.

(N1) eslint-legacy-exceptions.json: im Lauf der Etappe wurden ZWEI gepinnte Altlast-Werte
angehoben - makePgStore 562 -> 563 Zeilen und "id-length 'r'" 23 -> 24. Die Regel lautet: Pins
nicht anheben, sondern die Loesung so bauen, dass der Pin haelt. Pruefe je Pin, ob er sich mit
kleinem Eingriff halten laesst. Geht es nicht, bleibt die Anhebung stehen UND wird im
"reason"-Feld begruendet. Stillschweigend anheben ist die einzige unzulaessige Variante.`;

const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    committed: { type: "boolean" },
    orchestratorUmgestellt: { type: "boolean" },
    sabotageRotGesehen: { type: "boolean", description: "Schalter gekippt -> Test wurde rot -> zurueckgesetzt" },
    kommentarStimmt: { type: "boolean" },
    pinsGehalten: { type: "string", description: "je Pin: gehalten (wie) oder begruendet stehengelassen (Wortlaut des reason). Kurz." },
    gezielteTests: { type: "string", description: "welche Testdateien gefahren, mit pass/fail-Zahlen. KEINE Ausgaben zitieren." },
    lintSauber: { type: "boolean", description: "npx eslint auf die geaenderten Dateien: 0 Fehler" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: ["headCommit", "committed", "orchestratorUmgestellt", "sabotageRotGesehen", "kommentarStimmt", "pinsGehalten", "gezielteTests", "lintSauber", "summary"],
};

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    gateWirklichGetestet: { type: "boolean", description: "SELBST gekippt: der Orchestrator-Pfad macht einen Test rot" },
    keinZweitesGate: { type: "boolean", description: "SELBST gegrept: die Gate-Frage wird nur noch an EINER Stelle beantwortet" },
    kommentarStimmt: { type: "boolean" },
    pinsInOrdnung: { type: "boolean", description: "kein Pin stillschweigend angehoben" },
    substanzUnberuehrt: { type: "boolean", description: "Stichprobe: Absenderwahl, Rueckfall und Telnyx-Zweige unveraendert" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: ["gateWirklichGetestet", "keinZweitesGate", "kommentarStimmt", "pinsInOrdnung", "substanzUnberuehrt", "approved", "blockers", "verdict"],
};

phase("Fix");
const fix = await agent(
  `Behebe drei benannte Punkte der Etappe OUTBOUND-E5 in einem frischen Worktree.
1. ln -s "${REPO}/node_modules" node_modules
2. git checkout -b ${BRANCH} ${BASE}
${AUFGABE}
${SPARSAM}
${RAHMEN}
3. node --check auf jede geaenderte Datei. Gezielte Tests fahren. npx eslint auf die geaenderten Dateien = 0 Fehler.
4. git add (Dateien einzeln) && git commit -m "fix(outbound-e5): Blocker 4+5 - Gate nur noch an einer Stelle; N1 - Lint-Pins". headCommit = git rev-parse HEAD.
Ehrlich fuellen. Was offen bleibt, in deviations.`,
  { label: "e5-rest-fix", phase: "Fix", schema: FIX_SCHEMA, isolation: "worktree", model: "sonnet", effort: "high" },
);

let review = null;
if (fix && fix.committed && fix.headCommit) {
  phase("Review");
  review = await agent(
    `Knapper, skeptischer Review der drei Punkte auf Branch "${BRANCH}". Die Etappe ist ansonsten
bereits abgenommen - pruefe NUR diese Punkte plus eine Stichprobe, dass nichts kaputtging.
1. ln -s "${REPO}/node_modules" node_modules
2. git checkout -b review-e5-rest ${BRANCH}
${AUFGABE}
${SPARSAM}
3. DER ENTSCHEIDENDE PUNKT: kippe SELBST einen der drei Schalter im Orchestrator-Pfad und pruefe,
   dass ein Test rot wird. Bleibt alles gruen, ist der Blocker NICHT behoben -> approved=false.
   Danach zuruecksetzen, "git status --porcelain" leer.
4. git diff ${BASE}..${BRANCH} kurz durchsehen: kein Safety-Gate, keine Offenlegung, kein
   bridge.js, kein Provider-Schreibzugriff, kein Scope-Drift.
${RAHMEN}
approved=true nur, was du selbst gesehen hast. Rueckgabe IST das Urteil.`,
    { label: "e5-rest-review", phase: "Review", schema: REVIEW_SCHEMA, isolation: "worktree", model: "opus", effort: "high" },
  );
}

return {
  phaseId: "OUTBOUND-E5-REST",
  finalBranch: fix && fix.committed ? BRANCH : BASE,
  gate: review && review.approved ? "PASS" : "BLOCKED",
  approved: !!(review && review.approved),
  orchestratorUmgestellt: !!(fix && fix.orchestratorUmgestellt),
  sabotageRotGesehen: !!(fix && fix.sabotageRotGesehen),
  gateWirklichGetestet: !!(review && review.gateWirklichGetestet),
  keinZweitesGate: !!(review && review.keinZweitesGate),
  pinsInOrdnung: !!(review && review.pinsInOrdnung),
  substanzUnberuehrt: !!(review && review.substanzUnberuehrt),
  pinsGehalten: (fix && fix.pinsGehalten) || "",
  gezielteTests: (fix && fix.gezielteTests) || "",
  blockers: (review && review.blockers) || [],
  deviations: (fix && fix.deviations) || [],
  verdict: (review && review.verdict) || "",
  summary: (fix && fix.summary) || "",
};
