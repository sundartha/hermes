// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Kopie der Vorlage .claude/workflows/runs/b2.js, Phase HART GEPINNT auf B3a.
// args-driven+fail-closed, Self-Fix-Loop, Postage-Stamp-Return.

export const meta = {
  name: "phase-impl-lean-b3a",
  description:
    "B3a: Antwortseite der Werkzeug-Schleife neutralisieren (Seam+Adapter, LlmTurn, E5). Der ausgehende Draht bleibt byte-identisch. Plan -> Impl (Worktree) -> dualer Review -> Self-Fix -> Report.",
  phases: [
    { title: "Plan", detail: "Grenze B3a/B3b exakt ziehen, code-gegroundet" },
    { title: "Implementieren", detail: "Seam + Anthropic-Adapter im Worktree, npm test gruen" },
    { title: "Review", detail: "Safety/Abnahme A1-A5+A9 + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Detailbericht in tasks/b3a-report.md (Lead liest ihn nicht)" },
  ],
};

// HART GEPINNT auf das Haupt-Repo. Der fruehere cwd-Fallback lieferte im Spawn-Kontext
// ".", was im Agent-Worktree einen SELBSTREFERENZIELLEN node_modules-Symlink erzeugte
// ("Too many levels of symbolic links", npm test Exit 0 bei 4 Zeilen Output).
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN-SKRIPT B3a: Phase HART GEPINNT.
// highStakes=true: der Live-Sprechpfad (telnyx-llm-shim -> claude.js -> llm.js) und ein
// Geldpfad (E5, Recherche-Suchzahl auf der Tenant-Kostenachse) haengen daran.
const A = {
  phaseId: "B3a",
  phaseTitle: "Antwortseite der Werkzeug-Schleife neutralisieren (Seam + Anthropic-Adapter)",
  branch: "phase/b3a-antwortseite-neutral",
  baseBranch: "master",
  planDoc: "PLAN-ANBIETER-PORT.md",
  specFile: "tasks/b3-spec.md",
  maxFixRounds: 2,
  highStakes: true,
};

const PHASE = A.phaseId;
const PHASE_TITLE = A.phaseTitle;
const BRANCH = A.branch;
const BASE = A.baseBranch;
const PLAN_DOC = A.planDoc;
const SPEC_FILE = A.specFile;
const MAX_FIX_ROUNDS = Number.isInteger(A.maxFixRounds) ? A.maxFixRounds : 2;
const REPORT_PATH = `tasks/${String(PHASE).toLowerCase()}-report.md`;

// MODELL-POLITIK: jeder agent() explizit gepinnt (Memory [[workflow-model-policy]]).
const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";

const PLAN_AGENT = { model: MODEL_OPUS, effort: "high" };
const IMPL_AGENT = { model: MODEL_OPUS, effort: "high" };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: "xhigh" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Pruefkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2 - es darf NICHT zwei Uebersetzungsstellen je Anbieter geben); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante, konfigurierbares nach config.js G35); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen, Nebeneffekte im Namen sichtbar (N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1, sonst Objekt); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae). Neues Verhalten braucht einen automatisierten Test (P11/T-Serie); ein reiner Refactor laesst die Bestandssuite OHNE Test-Aenderung gruen.`;

// BINDENDE LEAD-ENTSCHEIDUNGEN (in tasks/todo.md dokumentiert, Commit 7462e20).
const LEAD_DECISIONS = `BINDENDE LEAD-ENTSCHEIDUNGEN zu dieser Phase - nicht neu aufrollen, nicht umdeuten:

1. **E6 "LlmRequest.cachePrefix" ist GENEHMIGT** als Ergaenzung des gemergten Vertrags src/llm/ports.js. Grund: es gibt genau EINEN heutigen Aufrufer (claude.js agentTurn setzt cache_control, summarizeCall und fetchPrecallBriefing NICHT) und einen zweiten Anbieter mit belegter Semantik (DeepSeek cacht ohne client-seitigen Marker). Damit ist das B2-Kriterium "nichts ohne Aufrufer" ERFUELLT, nicht umgangen. AUFLAGE: die Ergaenzung wird in src/llm/ports.js mit Aufrufer (Datei + SYMBOLNAME, keine Zeilennummern) UND mit diesem Grund dokumentiert, sonst entfernt sie spaeter jemand mit Verweis auf B2. HINWEIS: cachePrefix wird ERST in B3b benutzt - in B3a genuegt die Vertragszeile, wenn der Plan sie braucht; wird sie in B3a nicht gebraucht, gehoert sie nach B3b und NICHT vorsorglich hierher.

2. **E5 "PrecallResearchProvider.searchCount(providerTurn) statt searchCount(usage)" ist GENEHMIGT** und gehoert in B3a. Grund: ohne die Aenderung liest searchCount gegen eine neutrale LlmTokenUsage immer null (server_tool_use.web_search_requests existiert dort nicht), null heisst vertraglich "unbekannt", und der Aufrufer bucht dann den harten Deckel config.research.researchMaxUses statt der Ist-Zahl - auf addResearchFeeCostCents, also auf DIESELBE Tenant-Achse wie die Kostendecke (Absolute Regel 1). Das ist ein stiller Geldpfad-Defekt. Der Bestandstest test/al-p10-precall-research.test.js MUSS UNVERAENDERT bleiben und ist der Beweis, dass die Umstellung die Buchung nicht verschiebt.

3. **providerTurn traegt die GANZE Anbieter-Antwort, nicht nur die content-Liste.** Grund: E5 braucht usage.server_tool_use; ein Feld, das nur content traegt, erzwaenge einen zweiten Rohform-Kanal. Vertragskonform, weil B2 nur dem AUFRUFER das Lesen verbietet - gelesen wird providerTurn ausschliesslich von anbieter-spezifischen Adaptern (llm/adapters/anthropic.js, research/adapters/anthropic-web-search.js). precall-briefing.js reicht sie durch und liest sie nicht.`;

// LEAD-PRAEZISIERUNG von Abnahme A5 (die Spec ist an dieser Stelle nicht widerspruchsfrei).
const A5_RULE = `LEAD-PRAEZISIERUNG VON ABNAHME A5 (die Spec ist hier nicht widerspruchsfrei, diese Fassung gilt):

Spec-Abschnitt 7/A5 verlangt "src/claude.js 0" fuer eine Regex-Liste, die ANTWORT-Marker (resp.content, resp.usage, resp.stop_reason, tool_use, tool_result, tool_use_id, content_block, @anthropic-ai) UND ANFRAGE-Marker (input_schema, cache_control, max_tokens, tool_choice, tool_calls) mischt. B3a neutralisiert laut Zuschnitt (Spec Abschnitt 6, E3) NUR die Antwortseite - der Adapter nimmt system/messages/tools zunaechst unveraendert entgegen. Ein pauschales "alles 0" ist in B3a also NICHT erfuellbar.

ES GILT:
- Die ANTWORT-Marker MUESSEN in src/claude.js, src/precall-briefing.js und src/llm.js auf 0 gehen.
- Die Positiv-Kontrolle bleibt PFLICHT: derselbe Ausdruck gegen den neuen Adapter muss DEUTLICH > 0 liefern. Liefert er ebenfalls 0, ist nicht das Markup verschwunden, sondern der Ausdruck defekt - genau der B2-Befund (siehe tasks/lessons.md, "Ein Pruefkommando ohne Positiv-Kontrolle kann still 0 melden"). Ohne diese Kontrolle ist A5 NICHT bestanden.
- JEDER Marker, den B3a bewusst stehen laesst, wird im Plan NAMENTLICH mit Datei und Grund aufgefuehrt und im Report wiederholt. Eine stillschweigend ausgelassene Zeile ist ein BLOCKER, kein Restposten.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (Outbound-Permit Abo+KYC, OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, Max-Dauer) NIE entfernen/aufweichen/per-Default umgehen. Die Kostendecke ist in dieser Phase DIREKT beruehrt (E5, addResearchFeeCostCents).
- Provider-Signaturpruefung Telnyx Ed25519 fail-closed; SKIP_TWILIO_SIGNATURE_CHECK ist der globale /voice-Bypass und bleibt unangetastet.
- Disclosure-Satz (disclosureSentence, claude.js + bridge.js) bleibt fest verdrahtet und unveraendert.
- Auth fail-closed; Secrets nur via env, nie loggen/leaken. Audio nie durch MCP.
- SCOPE B3a: NUR die Antwortseite gemaess tasks/b3-spec.md Abschnitt 6 (Zuschnitt B3a). Die Anfrageseite (system/messages/tools/toolChoice/maxTokens/cachePrefix neutral, bridge.js-Nachzug, 1-zu-N-Abbildung der Werkzeug-Ergebnisse) ist B3b und wird hier NICHT gebaut.
- **DER AUSGEHENDE HTTP-BODY MUSS BYTE-IDENTISCH BLEIBEN.** Das ist die Kernabnahme dieser Phase (A3). Aendert sich der Draht, ist die Phase gescheitert - unabhaengig davon, wie schoen der Code ist.
- KEIN convo-bench, KEIN echter Anruf, KEIN Aufruf gegen die echte Anthropic-API: **das Anthropic-Guthaben ist LEER** (gemessen 2026-08-08, HTTP 400 "credit balance is too low"). Jeder Versuch, live zu messen, scheitert und verbrennt Zeit. Die Suite laeuft offline gegen lokale Mocks - das genuegt fuer diese Phase vollstaendig.`;

const specInstruction = `Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG (1018 Zeilen) - das ist die AUTORITATIVE Definition dieser Phase. Besonders: Abschnitt 0 (bindende Entscheidungen), 3 (der am Code geprueft Bestand), 4 (Architektur-Entscheidung V1), 5 (Entwurf), 6 (Zuschnitt B3a/B3b - DU BAUST NUR B3a), 7 (Abnahme), 8 (Pre-Mortem).`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. Lies "${REPO}/src/llm/ports.js" GANZ - der gemergte B2-Vertrag ist bindend.
3. Lies "${REPO}/${PLAN_DOC}" Teil 2 und "${REPO}/.claude/refs/clean-code.md".
4. Lies den ECHTEN Code auf Basis "${BASE}": src/llm.js, src/claude.js, src/precall-briefing.js, src/llm-usage.js, src/telnyx-llm-shim.js, src/research/ports.js, src/research/adapters/anthropic-web-search.js. Grep gezielt nach Symbolen; uebernimm KEINE Zeilennummer aus einem Dokument, ohne sie selbst nachzuschlagen.
${LEAD_DECISIONS}
${A5_RULE}
${CLEAN_CODE_REQ}
${ABS_RULES}
DEINE WICHTIGSTE AUFGABE: **zieh die Grenze B3a/B3b exakt.** Liefere eine Tabelle "Marker/Konstrukt -> Datei -> faellt in B3a / bleibt bis B3b -> Grund". Sie ist die Grundlage, an der der Review dich misst.
LIEFERE AUSSERDEM: (1) neue Dateien inkl. Signaturen und Inhalts-Skizze; (2) pro bestehender Datei die exakten Edits (Vorher/Nachher); (3) die neuen/angepassten Tests - insbesondere den Golden-Master-Test aus A3 samt der Sabotage, die ihn rot machen MUSS (eine Zusicherung, deren Rotprobe nicht ausgefuehrt wurde, zaehlt nicht); (4) je Abnahmepunkt A1-A5 und A9 das Kommando mit erwarteter Ausgabe. Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan", ...PLAN_AGENT },
);

// ---------- Phase 2: Implementieren (Worktree) ----------
phase("Implementieren");
const IMPL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    filesCreated: { type: "array", items: { type: "string" } },
    filesEdited: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    wireUnchangedProof: {
      type: "string",
      description: "A3: wie die Byte-Gleichheit des ausgehenden Bodys belegt wurde, mit Kommando",
    },
    goldenMasterRedProof: {
      type: "string",
      description: "Die AUSGEFUEHRTE Sabotage, die den Golden-Master rot macht, samt Ausgabe",
    },
    a5Output: { type: "string", description: "A5 woertlich, inkl. der Positiv-Kontrollzeile" },
    markersLeftForB3b: {
      type: "array",
      items: { type: "string" },
      description: "Marker, die B3a bewusst stehen laesst: 'Datei · Marker · Grund'",
    },
    pinnedTestsUntouched: {
      type: "boolean",
      description: "A4: die sieben Draht-/Buchungs-Pins sind unveraendert",
    },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "nodeCheckPass",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "wireUnchangedProof",
    "goldenMasterRedProof",
    "a5Output",
    "pinnedTestsUntouched",
    "committed",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert; Working-Tree des Nutzers NICHT anfassen). Setze Phase ${PHASE} ${PHASE_TITLE} GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${BRANCH} ${BASE}
3. Lies "${REPO}/tasks/b3-spec.md" und "${REPO}/src/llm/ports.js" SELBST. Implementiere EXAKT gemaess Plan. ${CLEAN_CODE_REQ}
${LEAD_DECISIONS}
${A5_RULE}
4. node --check auf JEDE neue/geaenderte .js-Datei (A1).
5. npm test (beide Backends). **pass MUSS >= 4007 sein und fail == 0.** Ein SINKEN der pass-Zahl ist ein Blocker, auch bei fail 0 - dann sind Tests verschwunden statt gruen zu sein.
6. A3 - DIE KERNABNAHME: der Golden-Master-Test fuer den ausgehenden Anfrage-Body. **Fuehre die Sabotage AUS**, die ihn rot machen muss (z.B. ein Feld im Body verschieben), und protokolliere Kommando + Ausgabe nach goldenMasterRedProof. Mach die Sabotage danach rueckgaengig. Eine Zusicherung ohne ausgefuehrte Rotprobe zaehlt nicht.
7. A4: die sieben Draht-/Buchungs-Pins (l3-prompt-caching, llm-message-chain-language, al-p10-precall-research, cq-p8-briefing, al-p4-side-effect-tool-loop, al-p7-turn-streaming, l0-metrics) muessen UNVERAENDERT bleiben -> git diff --stat ${BASE} -- <diese Dateien> ist LEER.
8. A5 gemaess der Lead-Praezisierung oben, MIT Positiv-Kontrolle. Ausgabe woertlich nach a5Output.
9. node_modules-Symlink NICHT committen. git add (nur betroffene src/test/doc-Dateien) && git commit. headCommit = git rev-parse HEAD.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen / Draht veraendert / Rotprobe nicht ausgefuehrt -> ehrlich melden, nicht schoenen. Was du nicht loesen konntest, kommt nach deviations.`,
  {
    label: `${PHASE}-implement`,
    phase: "Implementieren",
    schema: IMPL_SCHEMA,
    isolation: "worktree",
    ...IMPL_AGENT,
  },
);

// ---------- Phase 3: Dualer Review (parallel, wiederholbar) ----------
const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    testsPassIndependently: { type: "boolean" },
    independentTestSummary: { type: "string" },
    testCountNotShrunk: { type: "boolean", description: "A2: pass >= 4007, fail 0" },
    wireByteIdentical: {
      type: "boolean",
      description: "A3: der ausgehende HTTP-Body ist unveraendert - selbst nachgeprueft",
    },
    goldenMasterActuallyFails: {
      type: "boolean",
      description: "Du hast die Sabotage SELBST ausgefuehrt und den Test rot gesehen",
    },
    pinnedTestsUntouched: { type: "boolean", description: "A4: leerer Diff auf den sieben Pins" },
    a5Passes: { type: "boolean", description: "A5 inkl. Positiv-Kontrolle > 0" },
    markersLeftDocumented: {
      type: "boolean",
      description: "Jeder stehengelassene Marker ist im Plan namentlich begruendet",
    },
    e5MoneyPathIntact: {
      type: "boolean",
      description: "E5: al-p10-precall-research unveraendert UND gruen; Buchung nicht verschoben",
    },
    scopeRespected: { type: "boolean", description: "NUR B3a, keine Anfrageseite vorgezogen" },
    safetyGatesIntact: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "testCountNotShrunk",
    "wireByteIdentical",
    "goldenMasterActuallyFails",
    "pinnedTestsUntouched",
    "a5Passes",
    "e5MoneyPathIntact",
    "scopeRespected",
    "safetyGatesIntact",
    "disclosureIntact",
    "blockers",
    "verdict",
  ],
};
const CC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    s1: { type: "array", items: { type: "string" } },
    s2: { type: "array", items: { type: "string" } },
    s3: { type: "array", items: { type: "string" } },
    s4: { type: "array", items: { type: "string" } },
    blocker: { type: "boolean" },
    passNotes: { type: "string" },
    topTodos: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: ["s1", "s2", "s3", "s4", "blocker", "verdict"],
};

async function runReview(target, suffix) {
  return await parallel([
    () =>
      agent(
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase beruehrt den LIVE-SPRECHPFAD und einen GELDPFAD - im Zweifel blockieren.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test SELBST (beide Backends). testCountNotShrunk: pass >= 4007 UND fail == 0. Eine gesunkene pass-Zahl bei fail 0 ist ein BLOCKER (verschwundene Tests).
4. Lies "${REPO}/tasks/b3-spec.md" Abschnitt 6 (Zuschnitt) und 7 (Abnahme) sowie "${REPO}/src/llm/ports.js".
5. Arbeite A1-A5 und A9 EINZELN ab, jeden mit eigenem Kommando:
   A1 node --check auf alle geaenderten Dateien.
   A2 s.o.
   **A3 IST DIE KERNABNAHME.** Pruefe SELBST, dass der ausgehende HTTP-Body unveraendert ist - verlass dich NICHT auf die Behauptung des Impl-Agenten. **Fuehre die Sabotage am Golden-Master SELBST aus** (ein Feld im Body verschieben) und sieh den Test rot werden; mach sie danach rueckgaengig. Wird er dabei NICHT rot, ist der Test wertlos und das ein BLOCKER.
   A4 git diff --stat ${BASE} ${target} -- auf den sieben Draht-/Buchungs-Pins -> MUSS leer sein.
   A5 gemaess Lead-Praezisierung unten, MIT Positiv-Kontrolle. Positiv-Kontrolle == 0 bedeutet: der Ausdruck ist defekt, nicht der Code sauber -> BLOCKER.
   A9 Smoke: Server auf freiem Port mit SKIP_TWILIO_SIGNATURE_CHECK=true starten, /healthz + betroffene Route. Zu flaky -> als concern melden, kein Blocker.
6. **E5-Geldpfad:** test/al-p10-precall-research.test.js MUSS unveraendert sein UND gruen. Pruefe am Diff, dass die Recherche-Suchzahl weiterhin die Ist-Zahl bucht und nicht still auf den Deckel faellt. Das ist Absolute Regel 1.
7. scopeRespected: **keine Anfrageseite vorgezogen** (kein neutrales system/messages/tools, kein bridge.js-Nachzug, keine 1-zu-N-Werkzeugergebnis-Abbildung) - das ist B3b.
${LEAD_DECISIONS}
${A5_RULE}
${ABS_RULES}
approved=true NUR wenn alle Punkte erfuellt sind, deine Tests gruen sind UND du die Golden-Master-Rotprobe selbst gesehen hast. Rueckgabe IST das Urteil.`,
        {
          label: `${PHASE}-review-safety${suffix}`,
          phase: "Review",
          schema: SAFETY_SCHEMA,
          isolation: "worktree",
          ...SAFETY_AGENT,
        },
      ),
    () =>
      agent(
        `CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${target}", Basis "${BASE}") streng gegen den Katalog.
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG (definiert S1-S4 + Audit-Regeln: nur gesehenen Code bewerten, nicht raten).
2. git diff ${BASE} ${target} ; neue Dateien per git show ${target}:<pfad>.
3. Vergleiche den neuen Adapter mit dem Hausvorbild "${REPO}/src/telephony/adapters/telnyx/" (Aufbau, Benennung, Kommentarstil) - Abweichungen vom Hausstil sind G11/G24.
4. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad. S3/S4 gebuendelt.
BESONDERS ACHTEN:
 - **G5/S2 Duplizierung:** es darf GENAU EINE Uebersetzungsstelle je Anbieter geben. Eine zweite Karte an anderer Stelle ist der Hauptbefund, den diese Phase produzieren kann.
 - **P11/T-Serie:** neues Verhalten braucht einen Test. Der Golden-Master (A3) ist Pflicht; fehlt er oder hat er keine ausgefuehrte Rotprobe, ist das S1.
 - Ein reiner Durchreich-Wrapper ohne Mehrwert ist S4 (G12/P1-Regel 4), kein S1.
blocker=true wenn s1 ODER s2 nicht leer. passNotes: was sauber ist. topTodos: 1-3 wichtigste. Erfinde nichts.`,
        {
          label: `${PHASE}-review-cleancode${suffix}`,
          phase: "Review",
          schema: CC_SCHEMA,
          isolation: "worktree",
          ...CLEANCODE_AGENT,
        },
      ),
  ]);
}

const gateOk = (s, c) => !!(s && s.approved && c && !c.blocker);
const blockerList = (s, c) => [
  ...((s && s.blockers) || []),
  ...((c && c.s1) || []),
  ...((c && c.s2) || []),
];

phase("Review");
let reviewTarget = BRANCH;
let [safety, cc] = await runReview(reviewTarget, "");

// ---------- Phase 4: Self-Fix-Loop ----------
const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    addressed: { type: "array", items: { type: "string" } },
    filesTouched: { type: "array", items: { type: "string" } },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    committed: { type: "boolean" },
    summary: { type: "string" },
  },
  required: ["headCommit", "testsPass", "committed", "summary"],
};
let round = 0;
const fixSummaries = [];
while (!gateOk(safety, cc) && round < MAX_FIX_ROUNDS) {
  round++;
  phase("Self-Fix");
  const fixBranch = `${BRANCH}-fix${round}`;
  const blockers = blockerList(safety, cc);
  const fix = await agent(
    `Du behebst die REVIEW-BLOCKER der Phase ${PHASE} in einem frischen Worktree. NUR die Blocker fixen, kein Scope-Drift.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${fixBranch} ${reviewTarget}
3. Behebe DIESE Blocker sauber und minimal; fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${LEAD_DECISIONS}
${A5_RULE}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test (beide Backends) gruen, pass >= 4007. Der ausgehende HTTP-Body MUSS byte-identisch bleiben. node_modules NICHT committen. git add (betroffene Dateien) && git commit -m "fix(${String(PHASE).toLowerCase()}): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
EHRLICH: was du NICHT loesen konntest, in summary nennen.`,
    {
      label: `${PHASE}-fix-r${round}`,
      phase: "Self-Fix",
      schema: FIX_SCHEMA,
      isolation: "worktree",
      ...FIX_AGENT,
    },
  );
  fixSummaries.push(
    `r${round}: ${fix && fix.summary ? fix.summary.slice(0, 300) : "(kein Ergebnis)"}`,
  );
  // Ein Fix-Agent kann sterben (API-Fehler, Abbruch) und liefert dann null - der Branch
  // existiert dann NICHT. Ohne belegten Commit wird die Schleife abgebrochen; das Gate
  // bleibt BLOCKED mit den ECHTEN Blockern der letzten belastbaren Review-Runde.
  if (!fix || !fix.committed || !fix.headCommit) {
    fixSummaries.push(
      `r${round}: ABBRUCH - kein Commit vom Fix-Agenten (Branch ${fixBranch} existiert nicht). Self-Fix-Schleife beendet, Blocker der Runde ${round - 1 || "Erstreview"} bleiben stehen.`,
    );
    break;
  }
  reviewTarget = fixBranch;
  [safety, cc] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc);

// ---------- Phase 5: Report-Datei (Lead liest sie NICHT) ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe einen Detailbericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
Inhalt (Markdown, deutsch OHNE Umlaute): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; die Grenztabelle B3a/B3b aus dem Plan VOLLSTAENDIG (Marker -> Datei -> faellt/bleibt -> Grund), weil sie die Uebergabe an B3b ist; die Abnahmepunkte A1-A5 und A9 einzeln mit Urteil und Kommando; **die ausgefuehrte Rotprobe des Golden-Masters woertlich**; die Liste der bis B3b stehengelassenen Marker; E5-Geldpfad-Urteil; Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden. Halte ausdruecklich fest, was fuer B3b OFFEN bleibt und dass dessen Abnahme am leeren Anthropic-Guthaben haengt. Quelle:
=== PLAN ===
${plan || ""}
=== IMPL ===
${JSON.stringify(impl, null, 1)}
=== SAFETY (final) ===
${JSON.stringify(safety, null, 1)}
=== CLEANCODE (final) ===
${JSON.stringify(cc, null, 1)}
=== FIXES ===
${fixSummaries.join("\n")}
Antworte NUR mit dem geschriebenen Dateipfad.`,
    { label: `${PHASE}-report`, phase: "Report", ...REPORT_AGENT },
  );
  reportPath = (reportAgent || "").toString().trim().slice(0, 300) || REPORT_PATH;
} catch {
  reportPath = "(Report fehlgeschlagen)";
}

// ---------- POSTAGE-STAMP-RETURN ----------
return {
  phaseId: PHASE,
  finalBranch: reviewTarget,
  baseBranch: BASE,
  gate: approved ? "PASS" : "BLOCKED",
  approved,
  headCommit: (round > 0 ? null : impl && impl.headCommit) || null,
  testPassCount: (impl && impl.testPassCount) || null,
  wireByteIdentical: (safety && safety.wireByteIdentical) || false,
  goldenMasterActuallyFails: (safety && safety.goldenMasterActuallyFails) || false,
  markersLeftForB3b: (impl && impl.markersLeftForB3b) || [],
  filesTouched: [
    ...((impl && impl.filesCreated) || []),
    ...((impl && impl.filesEdited) || []),
  ].slice(0, 40),
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
  summary: impl && impl.summary ? impl.summary.slice(0, 600) : "",
};
