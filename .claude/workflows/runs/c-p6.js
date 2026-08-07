// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Unterschiede zum kanonischen phase-impl.js:
//  1) ARGS-DRIVEN + FAIL-CLOSED: die Phase kommt ueber args (phaseId/specFile), NICHT
//     ueber einen hartkodierten A-Fallback. Fehlt args.phaseId -> sofortiger Abbruch
//     (KEIN Default-Phase-Bau -> kein "baut versehentlich eine gemergte Phase"-Unfall,
//     siehe Memory [[phase-impl-workflow-args]]).
//  2) SELF-FIX-LOOP: ist der Gate BLOCKED (Safety nicht approved ODER Clean-Code S1/S2),
//     fixt ein Fix-Agent die Blocker im Worktree und der Review laeuft erneut - bis PASS
//     oder MAX_FIX_ROUNDS erschoepft. So muss der Lead NIE einen Diff lesen/fixen.
//  3) POSTAGE-STAMP-RETURN: der Workflow gibt nur eine kleine Zusammenfassung zurueck
//     (gate/finalBranch/testPassCount/blocker-Kurztitel) - NICHT plan/diff/volle Reviews.
//     Die Details schreibt ein Report-Agent in tasks/<phase>-report.md (Lead liest sie NICHT).
//
// AUFRUF (Lead): Workflow({ scriptPath: ".../phase-impl-lean.js", args: {
//   phaseId:"P6b2", phaseTitle:"...", branch:"phase/p6b2-async-worker", baseBranch:"master",
//   planDoc:"PLAN-MULTI-TENANT-TELNYX.md", specFile:"tasks/p6-rest-chain.md", maxFixRounds:2 } })
// KEIN resume. Der Lead merged danach den ZURUECKGEGEBENEN finalBranch (kann BRANCH oder
// BRANCH-fixN sein), NICHT blind BRANCH.

export const meta = {
  name: "phase-impl-lean-c-p6",
  description:
    "Schlankes selbst-fixendes Phasen-Workflow: Plan -> Impl (Worktree) -> dualer Review -> Self-Fix bis PASS -> kompakter Return + Report-Datei. Lead bleibt duenn.",
  phases: [
    {
      title: "Plan",
      detail:
        "Code-gegroundeter Umsetzungsplan (clean-code.md + Plan-Doku + specFile + echter Code)",
    },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen, commit" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    {
      title: "Self-Fix",
      detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS oder maxFixRounds",
    },
    { title: "Report", detail: "Detailbericht in tasks/<phase>-report.md (Lead liest ihn nicht)" },
  ],
};

// HART GEPINNT auf das Haupt-Repo. Der fruehere cwd-Fallback lieferte im Spawn-Kontext
// ".", was im Agent-Worktree einen SELBSTREFERENZIELLEN node_modules-Symlink erzeugte
// ("Too many levels of symbolic links", npm test Exit 0 bei 4 Zeilen Output) -
// beobachtet und aufgedeckt im C-P4-Review-Lauf wf_ff179540-31e.
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN-SKRIPT C-P6: Phase HART GEPINNT.
// highStakes=false: NUR-KOMMENTAR-Phase (Spec-Regel: wahr-und-tragend bleibt,
// falsch-geworden faellt; 198 Treffer einzeln vorklassifiziert, Impl-Agent urteilt nicht).
// VORAUSSETZUNG vor dem Start: C-P5 ist auf master gemergt. Die Trefferliste der Spec
// wurde gegen 9ddf1df erhoben - der Plan-Agent erhebt sie beim Bau NEU (Abnahme-Punkt 1
// der Spec), die Restmenge kann durch C-P5 kleiner geworden sein.
const A = {
  phaseId: "C-P6",
  phaseTitle: "Kommentar-Nachlese nach dem Twilio-Ausbau (Track C, Schritt 5c)",
  branch: "phase/c-p6-kommentar-nachlese",
  baseBranch: "master",
  planDoc: "PLAN-ANBIETER-PORT.md",
  specFile: "tasks/c-p6-spec.md",
  maxFixRounds: 2,
  highStakes: false,
};

const PHASE = A.phaseId;
const PHASE_TITLE = A.phaseTitle || "";
const BRANCH = A.branch || `phase/${String(PHASE).toLowerCase()}-impl`;
const BASE = A.baseBranch || "master";
const PLAN_DOC = A.planDoc || "PLAN-MULTI-TENANT-TELNYX.md";
const SPEC_FILE = A.specFile || "";
const MAX_FIX_ROUNDS = Number.isInteger(A.maxFixRounds) ? A.maxFixRounds : 2;
const REPORT_PATH = `tasks/${String(PHASE).toLowerCase()}-report.md`;

// MODELL-POLITIK: jeder agent() wird explizit gepinnt. Ohne Pin erbt der Subagent das
// Session-Modell - bei einer Fable-Session ein Vielfaches der noetigen Kosten (Memory
// [[workflow-model-policy]]). Zuordnung: Plan + Safety-Review = opus (dort entstehen bzw.
// sterben Fehler), Impl/Clean-Code/Fix = sonnet (Ausfuehrung gegen fertige Spec bzw.
// Regelanwendung gegen einen geschriebenen Katalog), Report = sonnet/low (reines
// Zusammenschreiben).
const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";

// HOCHRISIKO-PHASEN: hier ist ein Impl-Fehler kein haesslicher Code, sondern eine falsche
// Geldrechnung (Tarif-Signatur), ein blindes Safety-Gate (Budget/Stundenlimit) oder ein
// Live-Dienst, der nicht mehr startet (fatal:true beim Boot). Dort laeuft die Umsetzung
// ebenfalls auf opus und der Safety-Review eine Stufe schaerfer.
const HIGH_STAKES_PHASES = ["P5", "P6", "P7"];
const HIGH_STAKES =
  typeof A.highStakes === "boolean" ? A.highStakes : HIGH_STAKES_PHASES.includes(PHASE);

const PLAN_AGENT = { model: MODEL_OPUS, effort: "high" };
const IMPL_AGENT = HIGH_STAKES
  ? { model: MODEL_OPUS, effort: "high" }
  : { model: MODEL_SONNET, effort: "medium" };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: HIGH_STAKES ? "xhigh" : "high" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Prueftkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, gemeinsame Logik extrahieren); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante, in config.js wenn konfigurierbar G35); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen, Nebeneffekte im Namen sichtbar (N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1, sonst Objekt); Lazy-Init-Antipattern vermeiden (P15); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae); neues Verhalten braucht einen automatisierten Test (P11/T-Serie), reiner Refactor laesst die Bestandssuite OHNE Test-Aenderung gruen.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (Outbound-Permit Abo+KYC, OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, Max-Dauer) NIE entfernen/aufweichen/per-Default umgehen. Neue Endpunkte, die Calls/SMS/Geld ausloesen, brauchen dieselben Gates.
- Provider-Signaturpruefung: Telnyx Ed25519, fail-closed (die Twilio-HMAC-Pruefung ist seit C-P3 per Owner-Entscheidung entfernt - ihr Fehlen ist KEIN Befund; CLAUDE.md Regel 1, Eintrag 2026-08-07). SKIP_TWILIO_SIGNATURE_CHECK ist trotz des Namens der globale /voice-Bypass und bleibt unangetastet.
- Disclosure-Satz (disclosureSentence, claude.js + bridge.js) bleibt fest verdrahtet, unveraendert.
- Auth fail-closed: Browser-Session (webAuthMw/adminMw) bzw. internalOnly; timing-sichere Vergleiche (safeEqual). Neue Endpunkte standardmaessig hinter Auth; Ausnahmen brauchen route-policy.js-Eintrag.
- Secrets nur via env, nie loggen/in Responses oder MCP-Ausgaben leaken. Audio nie durch MCP.
- SCOPE: NUR diese Phase gemaess tasks/c-p6-spec.md - eine NUR-KOMMENTAR-Phase. KEIN Verhalten, KEINE Identifier, KEINE Testnamen, KEINE Log-/Template-Strings, KEINE zur Laufzeit ausgewerteten Zeichen aendern. Die Spec klassifiziert jeden Treffer einzeln (BLEIBT/FAELLT/UMFORMULIEREN) - ihr Urteil ist bindend, kein eigenes Urteilen, kein Weitersuchen ueber die abgeschlossene Liste hinaus. npm test UND npm run test:gates muessen VOR und NACH der Phase dieselbe Testzahl liefern.`;

const specInstruction = SPEC_FILE
  ? `Lies "${REPO}/${SPEC_FILE}" und finde den Abschnitt fuer ${PHASE} - das ist die AUTORITATIVE Scope-/Design-/Invarianten-/Abgrenzungs-Definition dieser Phase (verbindlich vor dem Plan-Doc).`
  : `(Keine specFile uebergeben - nutze ausschliesslich ${PLAN_DOC}.)`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. Lies "${REPO}/${PLAN_DOC}" als Umbrella-Kontext und "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}" (Arbeitsbaum bzw. git show ${BASE}:<pfad>). Grep gezielt nach den relevanten Symbolen/Call-Sites - KEINE Zeilennummern uebernehmen (sie rotten).
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) neue Dateien inkl. Funktionssignaturen + Inhalts-Skizze; (2) pro bestehender Datei die exakten Edits (Vorher/Nachher); (3) neue/angepasste Tests (oder Begruendung, warum die Bestandssuite reicht); (4) das deterministisch pruefbare Ergebnis (Befehl + erwartete Ausgabe). Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan", ...PLAN_AGENT },
);

// ---------- Phase 2: Implementieren (Worktree) ----------
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
    smokePass: { type: "boolean" },
    smokeNote: { type: "string" },
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
3. Implementiere EXAKT gemaess Plan. ${CLEAN_CODE_REQ}
4. node --check auf JEDE neue/geaenderte .js-Datei.
5. npm test (beide Backends: json-Default + pglite-in-process). Bestandstests nur bei bewusster Verhaltens-/Signatur-Aenderung anpassen (im Plan begruendet); neues Verhalten -> neuer Test.
6. Smoke (best-effort): Server auf freiem Port mit SKIP_TWILIO_SIGNATURE_CHECK=true + Dummy-Env, betroffene Route via curl; zu flaky -> smokePass=false + Grund (kein Blocker).
7. node_modules-Symlink NICHT committen. git add (nur die betroffenen src/test/config/doc-Dateien) && git commit. headCommit = git rev-parse HEAD.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen / blockiert -> testsPass=false + deviations, nicht schoenen.`,
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
    safetyGatesIntact: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    authFailClosedIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
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
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst (beide Backends) -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
PRUEFE: scopeRespected (nur ${PHASE}, keine Extras, kein ungefragter npm-Dep), safetyGatesIntact, disclosureIntact (claude.js+bridge.js), authFailClosedIntact, noSecretsLeaked, behaviorAsIntended (flag-off byte-identisch, Invarianten wie in der Spec).
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine Tests gruen. Im Zweifel blockieren. Rueckgabe IST das Urteil.`,
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
3. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
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
3. Behebe DIESE Blocker (S1 Korrektheit/Sicherheit + S2 Duplizierung + Safety-Blocker) sauber und minimal; fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test (beide Backends) gruen. node_modules NICHT committen. git add (betroffene Dateien) && git commit -m "fix(${String(PHASE).toLowerCase()}): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
  // ${fixBranch} existiert in dem Fall NICHT. Frueher wurde reviewTarget trotzdem
  // weitergesetzt: die Folgerunde reviewte einen Phantom-Branch, meldete "Branch existiert
  // nicht" als Blocker und verbrannte die letzte Fix-Runde an einem Nicht-Befund
  // (beobachtet 2026-07-25 in P5, ausgeloest durch ein API-529 in Runde 1). Ohne
  // belegten Commit wird die Schleife deshalb abgebrochen; das Gate bleibt BLOCKED mit
  // den ECHTEN Blockern der letzten belastbaren Review-Runde.
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
    `Schreibe einen Detailbericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree; lege tasks/ an, falls noetig). NICHTS am Code aendern, KEIN git-Commit.
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

// ---------- POSTAGE-STAMP-RETURN (klein, damit der Lead duenn bleibt) ----------
return {
  phaseId: PHASE,
  finalBranch: reviewTarget,
  baseBranch: BASE,
  gate: approved ? "PASS" : "BLOCKED",
  approved,
  headCommit: (round > 0 ? null : impl && impl.headCommit) || null,
  testPassCount: (impl && impl.testPassCount) || null,
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
