// PER-RUN-Skript AL-D2 (Kopie von phase-impl-lean.js, Phase HART GEPINNT).
// Siehe Memory [[phase-impl-workflow-args]]: die Phase steht hier im Skript, nicht in args.

export const meta = {
  name: "phase-impl-lean",
  description:
    "AL-D2: Ursache des nie feuernden Denk-Signals messen (Diagnose, kein Verhaltens-Fix).",
  phases: [
    {
      title: "Plan",
      detail: "Code-gegroundeter Diagnose-Plan (clean-code.md + Spec + echter Code)",
    },
    { title: "Implementieren", detail: "Tests + Diagnose-Bericht im Worktree, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/al-d2-report.md" },
  ],
};

const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : ".";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN HART GEPINNT (Lead): keine args-Abhaengigkeit, kein Misfire moeglich.
const A = {
  phaseId: "AL-D2",
  phaseTitle: "Warum feuert das Denk-Signal in KEINEM Turn? Ursache messen",
  branch: "phase/al-d2-denk-signal-diagnose",
  baseBranch: "master",
  planDoc: "PLAN-ASSISTANT-LEAP.md",
  specFile: "tasks/al-d2-spec.md",
  maxFixRounds: 2,
  highStakes: false,
};

const PHASE = A.phaseId;
const PHASE_TITLE = A.phaseTitle;
const BRANCH = A.branch;
const BASE = A.baseBranch;
const PLAN_DOC = A.planDoc;
const SPEC_FILE = A.specFile;
const MAX_FIX_ROUNDS = A.maxFixRounds;
const REPORT_PATH = "tasks/al-d2-report.md";

const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";
const HIGH_STAKES = A.highStakes;

const PLAN_AGENT = { model: MODEL_OPUS, effort: "high" };
// Diese Phase ist eine MESSUNG - der Wert entsteht in der Analyse, nicht im Tippen.
// Deshalb laeuft die Umsetzung ebenfalls auf opus, obwohl der Blast-Radius klein ist.
const IMPL_AGENT = { model: MODEL_OPUS, effort: "high" };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: HIGH_STAKES ? "xhigh" : "high" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Pruefkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, gemeinsame Logik extrahieren); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante, in config.js wenn konfigurierbar G35); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen, Nebeneffekte im Namen sichtbar (N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1, sonst Objekt); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae).`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (Denylist/Land/Stundenlimit/pro-Tenant-Kostendecke/Max-Dauer/Signaturpruefung) NIE entfernen/aufweichen/per-Default umgehen.
- Disclosure-Satz (disclosureSentence, claude.js + bridge.js) bleibt fest verdrahtet, unveraendert.
- Auth fail-closed. Secrets nur via env, nie loggen/leaken. Audio nie durch MCP.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

// Der Kern dieser Phase, an JEDEN Agenten weitergereicht.
const D2_SCOPE = `SCOPE DIESER PHASE (bindend, das ist eine DIAGNOSE):
- Diese Phase FIXT NICHTS am Verhalten. Verboten: Aenderung der Armierungsregel in streamSinkFor, von loopContinues, der Schwelle (AL-P7b/E3), des Prompts, von thinking-signal.js. Wer hier "gleich mitfixt", hat die Phase VERFEHLT. Der Diff darf in src/claude.js und src/thinking-signal.js KEINE Verhaltenszeile enthalten.
- Reproduktion ausschliesslich OFFLINE gegen den Shim-Harness (Owner-Weisung: keine echten Anrufe). Muster: test/al-d1-shim-diagnostics.test.js und test/al-d1-cause-diagnostics.test.js - LIES BEIDE, bevor du eine Zeile schreibst.
- Die Turn-Klassen K1..K6 der Spec sind vollstaendig zu fahren. K3 (Positivkontrolle: Bruecke feuert WIRKLICH und liegt auf dem SSE-Draht VOR dem Antwort-Chunk) ist PFLICHT - ohne sie sind alle Negativ-Befunde wertlos (Lehre AL-D1-4).
- Mindestens EINE Mutationsprobe: zeige, dass die Tests an der behaupteten Bedingung haengen und selektiv rot werden. Ergebnis gehoert in den Diagnose-Bericht.
- Die EINZIGE erlaubte Produktivaenderung ist EIN zusaetzliches Boolean in der turn_ok-Zeile des Shims: hatte dieser Turn ueberhaupt einen offenen Sprechkanal (wire !== null). Rein additiv, fail-safe wie die Nachbarfelder, PII-frei, KEINE neue Env-Variable, KEINE neue Zahl, KEINE Migration, EINE Schreibstelle. Ein Test pinnt negativ, dass die Zeile keinen Gespraechsinhalt traegt.
- LIEFERGEGENSTAND: die Datei tasks/al-d2-diagnose.md, im Worktree geschrieben UND mitcommittet. Sie beantwortet Spec-Punkt 3.3 (1)-(5), jeweils mit Datei-/Symbolbeleg. Verwechsle sie NICHT mit tasks/al-d2-report.md (Prozessbericht des Workflows).
- Der wichtigste Absatz des Berichts ist die REICHWEITE-Aussage (Spec 3.3 Punkt 2): kann das Denk-Signal in seiner heutigen Bauform die vom Owner gehoerten Pausen ueberhaupt erreichen? Leite das am CODE her, nicht am Plan-Text. Wenn die Antwort "nein" lautet, schreib das klar hin - auch wenn es der Reihenfolge in tasks/al-handover-2026-08-01.md Abschnitt 4 widerspricht. Diplomatisches Abschwaechen ist hier ein Fehler.`;

const specInstruction = `Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - das ist die AUTORITATIVE Scope-/Design-/Abgrenzungs-Definition dieser Phase (verbindlich vor dem Plan-Doc). Lies ausserdem "${REPO}/tasks/al-handover-2026-08-01.md" (Abschnitt 1, Befund D-2) und "${REPO}/tasks/al-p7b-workflow-report.md" (die Entscheidung E3, die die Zeit-Schwelle durch eine strukturelle ersetzt hat).`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Diagnose-Plan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. Lies "${REPO}/${PLAN_DOC}" als Umbrella-Kontext und "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}": src/thinking-signal.js, agentTurn in src/claude.js (Tool-Loop, loopContinues, streamSinkFor, completeRound), src/telnyx-llm-shim.js (makeStreamingResponse, wire, respond, turnDiagnostics, logShimTurnOk). Grep nach den Symbolen - KEINE Zeilennummern uebernehmen (sie rotten).
4. Verifiziere die Bedingungskette B1..B7 der Spec AM CODE. Wenn die Spec sich irrt, ist der Code die Wahrheit - sag es im Plan.
${D2_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die verifizierte Bedingungskette mit Codebeleg; (2) die Testdatei test/al-d2-thinking-signal-diagnostics.test.js: pro Turn-Klasse K1..K6 der konkrete Aufbau (Mock-Antwortform, Konfiguration, Assertions) - insbesondere, WIE K3 die Reihenfolge Bruecke-vor-Antwort auf dem Draht nachweist; (3) die exakte, minimale Edit fuer das eine turn_ok-Boolean (Vorher/Nachher) plus den negativ pinnenden Test; (4) die Mutationsprobe(n) mit erwartetem selektivem Rot; (5) die Gliederung von tasks/al-d2-diagnose.md inkl. deiner VORLAEUFIGEN Reichweite-Antwort samt Herleitung. Deine Rueckgabe IST der Plan.`,
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
    mutationProbeResult: {
      type: "string",
      description: "Welche Mutation, welche Tests wurden rot, welche blieben gruen",
    },
    reachVerdict: {
      type: "string",
      description:
        "Die Reichweite-Antwort in EINEM Satz: erreicht das Denk-Signal die Owner-Pausen - ja/nein und warum",
    },
    blockingConditionPerClass: {
      type: "string",
      description: "K1..K6 -> welche Bedingung B1..B7 sperrte (gemessen, nicht behauptet)",
    },
    diagnoseDocCommitted: { type: "boolean" },
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
    "mutationProbeResult",
    "reachVerdict",
    "blockingConditionPerClass",
    "diagnoseDocCommitted",
    "committed",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert; Working-Tree des Nutzers NICHT anfassen). Setze Phase ${PHASE} GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${BRANCH} ${BASE}
3. Implementiere EXAKT gemaess Plan.
${D2_SCOPE}
${CLEAN_CODE_REQ}
4. node --check auf JEDE neue/geaenderte .js-Datei.
5. npm test. Bestandstests NICHT anpassen - diese Phase aendert kein Verhalten; muss doch einer angepasst werden, ist das ein Warnsignal und gehoert in deviations.
6. Mutationsprobe fahren, Ergebnis notieren, Mutation ZURUECKNEHMEN und npm test erneut gruen fahren.
7. tasks/al-d2-diagnose.md schreiben (Spec 3.3). Ehrlich: was gemessen ist, steht als gemessen da; was nicht entscheidbar ist (B2 rueckwirkend fuer die Live-Anrufe), steht als offen da.
8. node_modules-Symlink NICHT committen. git add (nur die betroffenen test/src/tasks-Dateien) && git commit. headCommit = git rev-parse HEAD.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen -> testsPass=false + deviations, nicht schoenen. reachVerdict ist KEINE Hoeflichkeitsfloskel, sondern dein gemessenes Urteil.`,
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
    scopeRespected: { type: "boolean" },
    noBehaviorChange: {
      type: "boolean",
      description: "Diff enthaelt KEINE Verhaltensaenderung in claude.js/thinking-signal.js",
    },
    positiveControlReal: {
      type: "boolean",
      description: "K3 beweist wirklich ein feuerndes Signal, nicht nur eine gruene Assertion",
    },
    safetyGatesIntact: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    authFailClosedIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    diagnoseDocHonest: {
      type: "boolean",
      description: "Bericht behauptet nichts, was die Tests nicht zeigen",
    },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "noBehaviorChange",
    "positiveControlReal",
    "safetyGatesIntact",
    "disclosureIntact",
    "diagnoseDocHonest",
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}".
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} pruefen.
${D2_SCOPE}
PRUEFE BESONDERS:
- noBehaviorChange: enthaelt der Diff in src/claude.js oder src/thinking-signal.js irgendeine Verhaltenszeile? Wenn ja -> BLOCKER, die Phase hat ihren eigenen Scope verletzt.
- positiveControlReal: fahre K3 selbst. Ist sie NUR gruen, oder beweist sie wirklich einen Brueckenchunk auf dem Draht VOR dem Antwort-Chunk? Eine Positivkontrolle, die auch bei totem Signal gruen waere, ist ein BLOCKER. Probe: kommentiere in src/thinking-signal.js den onSpeechChunk-Aufruf aus - K3 MUSS rot werden. Nimm die Mutation danach zurueck.
- diagnoseDocHonest: lies tasks/al-d2-diagnose.md. Behauptet er irgendetwas, das die Tests NICHT zeigen? Nennt er offene Punkte (B2 rueckwirkend) ehrlich als offen? Schoenfaerberei ist ein BLOCKER.
- Das eine neue turn_ok-Boolean: additiv, fail-safe, PII-frei, keine neue Env-Var/Zahl?
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine Tests gruen. Im Zweifel blockieren.`,
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
3. Kategorie fuer Kategorie. Pro FLAG: "ID - Datei - Verstoss - Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
Achte besonders auf die Testdatei: sechs Turn-Klassen mit gemeinsamem Aufbau laden zur Duplizierung ein (S2) - aber eine gemeinsame Hilfsfunktion, die die Klassen ununterscheidbar macht, ist genauso falsch. Bewerte, ob die Fixtures die Klassen wirklich TRENNEN (Lehre: gleiche Fixture-Werte testen nichts).
blocker=true wenn s1 ODER s2 nicht leer. Erfinde nichts.`,
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
3. Behebe DIESE Blocker:
${JSON.stringify(blockers, null, 1)}
${D2_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test gruen. node_modules NICHT committen. git add (betroffene Dateien) && git commit -m "fix(al-d2): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
  if (!fix || !fix.committed || !fix.headCommit) {
    fixSummaries.push(
      `r${round}: ABBRUCH - kein Commit vom Fix-Agenten (Branch ${fixBranch} existiert nicht). Self-Fix-Schleife beendet.`,
    );
    break;
  }
  reviewTarget = fixBranch;
  [safety, cc] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc);

// ---------- Phase 5: Prozessbericht (NICHT der Diagnose-Bericht) ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe einen Prozessbericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit. UEBERSCHREIBE NIEMALS tasks/al-d2-diagnose.md - das ist ein anderer Liefergegenstand.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; Plan (gekuerzt); Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden. Quelle:
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

return {
  phaseId: PHASE,
  finalBranch: reviewTarget,
  baseBranch: BASE,
  gate: approved ? "PASS" : "BLOCKED",
  approved,
  headCommit: (round > 0 ? null : impl && impl.headCommit) || null,
  testPassCount: (impl && impl.testPassCount) || null,
  reachVerdict: (impl && impl.reachVerdict) || "",
  blockingConditionPerClass: (impl && impl.blockingConditionPerClass) || "",
  mutationProbeResult: (impl && impl.mutationProbeResult) || "",
  diagnoseDoc: impl && impl.diagnoseDocCommitted ? "tasks/al-d2-diagnose.md" : "(fehlt)",
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
