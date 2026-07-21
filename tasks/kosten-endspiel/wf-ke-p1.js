// PER-RUN-SKRIPT Kosten-Endspiel. Abgeleitet von .claude/workflows/phase-impl-lean.js,
// mit zwei bewussten Abweichungen (Auflagen des Session-Prompts):
//  1) Die Phase ist HART GEPINNT (Block unten), NICHT ueber args. Argument-Uebergabe hat in
//     diesem Repo schon danebengegriffen und die falsche Phase gebaut.
//  2) Modelle sind EXPLIZIT je agent() gepinnt, nie geerbt: Opus fuer Plan und
//     Safety-Review, Sonnet fuer Implementierung, Clean-Code-Audit, Fix und Report.

// ==PIN-START== (einziger Block, der je Phase abweicht)
const PHASE = "KE-P1";
const PHASE_TITLE = "Tote Sicherung ersetzen (250 -> meta.total_pages)";
const BRANCH = "phase/ke-p1-meta-truncation";
// ==PIN-END==

export const meta = {
  name: "wf-ke-phase",
  description:
    "Kosten-Endspiel: eine Phase umsetzen (Plan -> Impl im Worktree -> dualer Review -> Self-Fix bis PASS -> Report).",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan (Opus)", model: "opus" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen, commit (Sonnet)" },
    { title: "Review", detail: "Safety/Verhalten (Opus) + Clean-Code-Auditor (Sonnet), parallel" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review (Sonnet)" },
    { title: "Report", detail: "Detailbericht in tasks/ke-p<N>-report.md (Sonnet)" },
  ],
};

const BASE = "master";
const PLAN_DOC = "PLAN-KOSTEN-ENDSPIEL.md";
const SPEC_FILE = "tasks/kosten-endspiel/impl-spec.md";
const MAX_FIX_ROUNDS = 3;
const BASELINE_TESTS = 2861;
const REPORT_PATH = `tasks/${PHASE.toLowerCase()}-report.md`;

const MODEL_PLAN = "opus";
const MODEL_SAFETY = "opus";
const MODEL_IMPL = "sonnet";
const MODEL_AUDIT = "sonnet";
const MODEL_FIX = "sonnet";
const MODEL_REPORT = "sonnet";

const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : ".";
const NODE_MODULES = `${REPO}/node_modules`;

const SPEC_REQ = `SPEC (AUTORITATIV): Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - Abschnitt A (gilt fuer JEDE Phase: gemessene Antwortformen, Fixture-Disziplin, fail-closed-Geldpfad, verbotene Query-Parameter, Repo-Auflagen, Ist-Zustand des Codes) UND den Abschnitt ${PHASE}. Bei Widerspruch zum Plan-Doc gilt die Spec. Lies "${REPO}/${PLAN_DOC}" als Umbrella-Kontext.`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Prueftkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, gemeinsame Logik extrahieren); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante, in config.js wenn konfigurierbar G35); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen (N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1, sonst Objekt); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae); neues Verhalten braucht einen automatisierten Test (P11/T-Serie).`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, CLAUDE.md + Spec Abschnitt A3/A6):
- Safety-Gates (Denylist/Land/Stundenlimit/Budget/Max-Dauer) NIE entfernen/aufweichen/per-Default umgehen.
- Disclosure-Satz bleibt fest verdrahtet. Auth fail-closed (Signaturpruefung, Basic-Auth, MCP-Auth, safeEqual).
- Secrets nur via env, NIE loggen/leaken. Audio nie durch MCP.
- GELDPFAD FAIL-CLOSED: kein Anker = leere Liste, nie "Kosten = 0". ok:false heisst NIE "keine Kosten". Die Zuordnungslogik (anchoredSessionIds/assignmentOutcome/toCostRecord) wird VERSCHOBEN, NICHT VERAENDERT. Die via_-Zaehler im Log nur ergaenzen, nie umbauen.
- KEIN geratener Query-Parameter: erlaubt sind AUSSCHLIESSLICH filter[record_type], page[size], page[number]. Ein falscher Filtername liefert HTTP 200 mit 0 Treffern - kein Fehler, sondern stiller Datenverlust.
- KEIN Deploy, KEINE Render-Env-Aenderung, KEINE echten Anrufe, KEIN Netz im Test, KEINE schreibenden Telnyx-Aufrufe, keine neuen npm-Dependencies.
- SCOPE: NUR diese Phase. Keine ungefragten Extras.
- Blockiert? ANHALTEN und melden (deviations), NICHT raten und NICHT drumherum bauen.`;

const FIXTURE_REQ = `FIXTURE-DISZIPLIN (Spec A2, hier ist die Kette ZWEIMAL gestorben - die alten Fixtures erfanden die Feldnamen leg_id/call_leg_id, die Tests waren gruen waehrend live 297 von 297 Belegen verworfen wurden):
- Fixtures spiegeln NUR gemessene Antwortformen aus Spec A1 (meta={total_results:212,total_pages:5,page_size:50}; Zeitfeld und Zuordnungs-IDs JE record_type; cost ist ein STRING, auch in SCI-Notation wie "1.666E-4").
- KOEDER-PFLICHT: jede Beleg-Fixture traegt mindestens ein Feld, das der Code NICHT verwenden darf (telnyx_leg_id / call_leg_id) mit einem Wert, der zu KEINEM erwarteten Ergebnis fuehrt. Laeuft ein Test gruen, obwohl nur der Koeder passt, ist der Test falsch.
- NULL-ZWILLING-PFLICHT: je Anruf existieren ZWEI sip-trunking- und ZWEI call-control-Belege, davon je einer echt bei null (cost:"0.0", billed_sec:0, call_sec:0). Jede Fixture, die eine Kostensumme prueft, enthaelt ihn. "Erster Treffer je Typ gewinnt" verliert 0,0401 USD und erstattet real ausgegebenes Geld zurueck.
- ROT-VOR-GRUEN-PFLICHT: mindestens ein Test MUSS vor der Aenderung rot sein. Fuehre ihn VOR dem Fix aus und halte Befehl + Ausgabe woertlich fest. Ein Test, der vorher schon gruen war, beweist nichts.`;

const TEST_REQ = `TESTS: npm test muss gruen sein, Referenz ${BASELINE_TESTS} pass / 0 fail - die Zahl darf nur WACHSEN. FLAKE-PROTOKOLL: es gibt einen vorbestehenden Voll-Last-Flake (~12 %, Seed-vor-Boot-Race). Ein roter Test gilt erst als echt rot, wenn er ISOLIERT ebenfalls rot ist (node --test test/<datei>). Nie einen Test "reparieren", der isoliert gruen ist.`;

// ---------- Phase 1: Plan (Opus) ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} - ${PHASE_TITLE} - im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${SPEC_REQ}
2. Lies "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}" (Arbeitsbaum bzw. git show ${BASE}:<pfad>). Grep gezielt nach den relevanten Symbolen und ALLEN Call-Sites - KEINE Zeilennummern uebernehmen (sie rotten). Die Spec nennt in Abschnitt A7 den Ist-Zustand; PRUEFE ihn am Code nach, statt ihn zu glauben.
${CLEAN_CODE_REQ}
${FIXTURE_REQ}
${ABS_RULES}
LIEFERE: (1) neue Dateien inkl. Funktionssignaturen + Inhalts-Skizze; (2) pro bestehender Datei die exakten Edits (Vorher/Nachher); (3) die neuen/angepassten Tests, jeweils mit der konkreten Fixture (gemessene Feldnamen, Koeder-Feld, ggf. Null-Zwilling); (4) WELCHER Test vor der Aenderung rot ist und mit welchem Befehl man das zeigt; (5) das deterministisch pruefbare Abnahmekriterium der Phase aus der Spec (rot heute = X, gruen = Y) als Befehl + erwartete Ausgabe. Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan", model: MODEL_PLAN },
);

// ---------- Phase 2: Implementieren (Worktree, Sonnet) ----------
phase("Implementieren");
const IMPL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string", description: "git rev-parse HEAD nach dem Commit" },
    filesCreated: { type: "array", items: { type: "string" } },
    filesEdited: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    redBeforeGreenCommand: { type: "string", description: "Befehl, der den Test VOR der Aenderung rot zeigt" },
    redBeforeGreenOutput: { type: "string", description: "WOERTLICHE Ausgabe des roten Laufs (gekuerzt auf das Wesentliche)" },
    acceptanceEvidence: { type: "string", description: "Abnahmekriterium der Phase: Befehl + Ausgabe, die es belegt" },
    cleanCodeSelfCheck: { type: "string" },
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
    "redBeforeGreenCommand",
    "redBeforeGreenOutput",
    "acceptanceEvidence",
    "committed",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert; Working-Tree des Nutzers NICHT anfassen). Setze Phase ${PHASE} - ${PHASE_TITLE} - GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${BRANCH} ${BASE}
3. ${SPEC_REQ}
4. ROT ZUERST: schreibe den/die neuen Test(s) und fuehre sie VOR der Code-Aenderung aus. Halte Befehl und WOERTLICHE Ausgabe fest (redBeforeGreenCommand/redBeforeGreenOutput). Ist der Test schon vorher gruen, taugt er nicht - baue einen, der wirklich rot ist. DAS IST EIN HARTES GATE.
5. Implementiere EXAKT gemaess Plan. ${CLEAN_CODE_REQ}
6. node --check auf JEDE neue/geaenderte .js-Datei.
7. ${TEST_REQ}
8. Belege das Abnahmekriterium der Phase aus der Spec woertlich (acceptanceEvidence): Befehl + Ausgabe.
9. node_modules-Symlink NICHT committen. git add NUR die betroffenen Dateien EINZELN (NIE git add -A, NIE git add .) && git commit. headCommit = git rev-parse HEAD.
${FIXTURE_REQ}
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen / blockiert -> testsPass=false + deviations, nicht schoenen. Lieber ein ehrlicher Stopp als eine plausible Erfindung.`,
  {
    label: `${PHASE}-implement`,
    phase: "Implementieren",
    schema: IMPL_SCHEMA,
    model: MODEL_IMPL,
    isolation: "worktree",
  },
);

// ---------- Phase 3: Dualer Review (parallel, wiederholbar) ----------
const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    testsPassIndependently: { type: "boolean" },
    independentTestSummary: { type: "string" },
    testPassCount: { type: "number" },
    scopeRespected: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    authFailClosedIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    moneyPathFailClosed: { type: "boolean", description: "Zuordnung weiter asymmetrisch: kein Anker = leere Liste; ok:false != Kosten 0" },
    fixturesHonest: { type: "boolean", description: "Fixtures spiegeln gemessene Formen, tragen Koeder-Feld, ggf. Null-Zwilling; Tests wuerden bei falschem Code wirklich fehlschlagen" },
    redBeforeGreenProven: { type: "boolean", description: "Der Rot-vor-Gruen-Nachweis ist plausibel und der Test faellt ohne den Fix wirklich" },
    noGuessedQueryParam: { type: "boolean", description: "Nur filter[record_type]/page[size]/page[number] gehen an den Provider" },
    behaviorAsIntended: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "safetyGatesIntact",
    "disclosureIntact",
    "moneyPathFailClosed",
    "fixturesHonest",
    "redBeforeGreenProven",
    "noGuessedQueryParam",
    "blockers",
    "verdict",
  ],
};
const CC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    s1: {
      type: "array",
      items: { type: "string" },
      description: 'Tests/Sicherheit/Korrektheit - "ID · Datei · Verstoss · Fix"',
    },
    s2: { type: "array", items: { type: "string" }, description: "Duplizierung" },
    s3: { type: "array", items: { type: "string" } },
    s4: { type: "array", items: { type: "string" } },
    blocker: { type: "boolean", description: "true wenn s1 oder s2 nicht leer" },
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
2. git checkout -b review-${PHASE.toLowerCase()}${suffix} ${target}
3. ${SPEC_REQ}
4. ${TEST_REQ} Fuehre npm test SELBST aus -> testsPassIndependently + testPassCount.
5. git diff ${BASE} ${target} gegen die absoluten Regeln UND das Abnahmekriterium der Phase pruefen.
PRUEFE BESONDERS:
- moneyPathFailClosed: bleibt die Zuordnung asymmetrisch (kein Anker -> LEERE Liste)? Kann irgendein Pfad jetzt "Kosten = 0" oder eine Rueckerstattung auf unvollstaendiger Datenlage erzeugen? Wurde die Zuordnungslogik VERSCHOBEN statt VERAENDERT?
- fixturesHonest: DAS IST DER WICHTIGSTE PUNKT. Die Kette ist zweimal daran gestorben, dass Fixtures die eigene Annahme bestaetigten (erfundene Feldnamen leg_id/call_leg_id - gruene Tests, waehrend live 297 von 297 Belegen verworfen wurden). Pruefe JEDE neue Fixture gegen die gemessenen Formen in Spec A1. Traegt sie ein Koeder-Feld? Wuerde der Test fehlschlagen, wenn der Code das FALSCHE Feld benutzt? MANIPULIERE PROBEWEISE den Code (z. B. Feldnamen tauschen) und pruefe, ob der Test dann wirklich rot wird - ein Test, der das nicht tut, ist ein Blocker.
- redBeforeGreenProven: ist der behauptete rote Lauf echt? Stelle die Aenderung probeweise zurueck (git stash im WORKTREE ist verboten - nutze stattdessen git checkout ${BASE} -- <datei> in deinem eigenen Review-Worktree oder ein Patch-Revert) und pruefe, ob der neue Test dann faellt.
- noGuessedQueryParam: geht irgendein filter[...] ausser filter[record_type] an den Provider? Das waere ein Blocker (200 mit 0 Treffern statt Fehler).
- scopeRespected (nur ${PHASE}, keine Extras, kein ungefragter npm-Dep), safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked (kein Key, keine Rufnummer, keine Session-/Leg-ID im Log), behaviorAsIntended.
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine Tests gruen. Im Zweifel blockieren. Rueckgabe IST das Urteil.`,
        {
          label: `${PHASE}-review-safety${suffix}`,
          phase: "Review",
          schema: SAFETY_SCHEMA,
          model: MODEL_SAFETY,
          isolation: "worktree",
        },
      ),
    () =>
      agent(
        `CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${target}", Basis "${BASE}") streng gegen den Katalog.
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG (definiert S1-S4 + Audit-Regeln: nur gesehenen Code bewerten, nicht raten).
2. git diff ${BASE} ${target} ; neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
ACHTE ZUSAETZLICH AUF: Magic Numbers ohne benannte Konstante (Seitengroesse, Rate-Limit-Budget, Schwellen); Kommentare mit Umlauten (ue/oe/ae statt ü/ö/ä ist Pflicht); brittle Datei:Zeile-Verweise in Kommentaren; duplizierte Unwrap-/Parse-/Zuordnungslogik (G5); Tests ohne echte Aussage (Fixture bestaetigt nur die eigene Konstante - das war der D3-Fehler).
blocker=true wenn s1 ODER s2 nicht leer. passNotes: was sauber ist. topTodos: 1-3 wichtigste. Erfinde nichts.`,
        {
          label: `${PHASE}-review-cleancode${suffix}`,
          phase: "Review",
          schema: CC_SCHEMA,
          model: MODEL_AUDIT,
          isolation: "worktree",
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

// ---------- Phase 4: Self-Fix-Loop (Sonnet) ----------
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
3. ${SPEC_REQ}
4. Behebe DIESE Blocker (S1 Korrektheit/Sicherheit + S2 Duplizierung + Safety-Blocker) sauber und minimal; fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${CLEAN_CODE_REQ}
${FIXTURE_REQ}
${ABS_RULES}
5. node --check + ${TEST_REQ} node_modules NICHT committen. git add NUR die betroffenen Dateien EINZELN (NIE git add -A) && git commit -m "fix(${PHASE.toLowerCase()}): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
EHRLICH: was du NICHT loesen konntest, in summary nennen - eine ungeloeste Sache benennen ist besser als sie zu kaschieren.`,
    {
      label: `${PHASE}-fix-r${round}`,
      phase: "Self-Fix",
      schema: FIX_SCHEMA,
      model: MODEL_FIX,
      isolation: "worktree",
    },
  );
  fixSummaries.push(
    `r${round}: ${fix && fix.summary ? fix.summary.slice(0, 300) : "(kein Ergebnis)"}`,
  );
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
Inhalt (Markdown), in dieser Reihenfolge:
1. Kopf: Phase ${PHASE} - ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; Basis=${BASE}.
2. Was geaendert wurde (Dateien + Kern der Aenderung).
3. DER ROTE LAUF VOR DEM FIX: Befehl und woertliche Ausgabe (aus redBeforeGreenCommand/redBeforeGreenOutput) - das ist der wichtigste Abschnitt, nicht kuerzen.
4. Der gruene Lauf danach + Suite-Zahl (Referenz ${BASELINE_TESTS}/0).
5. Abnahmekriterium der Phase mit Beleg (acceptanceEvidence).
6. Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden; offene Punkte/deviations.
Quelle (nichts dazuerfinden, was hier nicht steht):
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
    { label: `${PHASE}-report`, phase: "Report", model: MODEL_REPORT },
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
  testPassCount: (impl && impl.testPassCount) || null,
  redBeforeGreen: (impl && impl.redBeforeGreenCommand) || null,
  filesTouched: [
    ...((impl && impl.filesCreated) || []),
    ...((impl && impl.filesEdited) || []),
  ].slice(0, 40),
  fixRounds: round,
  fixSummaries,
  deviations: (impl && impl.deviations) || [],
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
  summary: impl && impl.summary ? impl.summary.slice(0, 600) : "",
};
