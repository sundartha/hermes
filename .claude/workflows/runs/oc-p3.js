// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Kopie der Vorlage .claude/workflows/runs/oc-p1.js, Phase HART GEPINNT auf OC-P3.

export const meta = {
  name: "phase-impl-lean-oc-p3",
  description:
    "OC-P3: Gleichlauf der uebrigen Outbound-Wege (claude.js-Prompt, i18n-Bausteine, Dashboard-Feld). Plan -> Impl (Worktree) -> dualer Review -> Self-Fix -> Report.",
  phases: [
    { title: "Plan", detail: "Gleichlauf-Stellen code-gegroundet planen" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen" },
    { title: "Review", detail: "Safety/Abnahme + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Detailbericht in tasks/oc-p3-report.md (Lead liest ihn nicht)" },
  ],
};

// HART GEPINNT auf das Haupt-Repo (Symlink-Falle, C-P4).
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN-SKRIPT OC-P3: Phase HART GEPINNT.
const A = {
  phaseId: "OC-P3",
  phaseTitle: "Gleichlauf der uebrigen Outbound-Wege",
  branch: "phase/oc-p3-gleichlauf",
  baseBranch: "master",
  planDoc: "PLAN-OWNER-CALL.md",
  specFile: "tasks/oc-p3-spec.md",
  maxFixRounds: 2,
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
const PLAN_AGENT = { model: "opus", effort: "high" };
const IMPL_AGENT = { model: "sonnet", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };
const CLEANCODE_AGENT = { model: "sonnet", effort: "medium" };
const FIX_AGENT = { model: "sonnet", effort: "medium" };
const REPORT_AGENT = { model: "sonnet", effort: "low" };

// Suite-Anker: der Plan-Agent misst den ECHTEN Stand auf master (nach OC-P1/P2-Merges)
// und pinnt ihn; absolute Untergrenze bleibt der Ketten-Start.
const TEST_CMD = `LLM_PROVIDER=anthropic npm test`;
const TEST_FLOOR = 4909;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn bei JEDER Entscheidung. Fuer diese Phase besonders: das OC-P1-Praedikat bleibt die EINZIGE Entscheidungsquelle (G5/S2 - keine zweite Nummern-Vergleichslogik in claude.js oder anderswo); i18n-Bausteine dort, wo Bestandsbausteine liegen; gesprochene/prompt-sichtbare DEUTSCHE Strings tragen ECHTE UMLAUTE (Code-Kommentare ASCII); kein toter Code; Kommentare deutsch OHNE Umlaute. Neues Verhalten braucht Tests - der neue Owner-Prompt-Zweig braucht seine EIGENE Umlaut-/Inhalts-Pruefung (die Bestands-Ratschen decken ihn nicht).`;

const LEAD_DECISIONS = `BINDENDE LEAD-ENTSCHEIDUNGEN - nicht neu aufrollen, nicht umdeuten:
1. Die Spec "${SPEC_FILE}" ist AUTORITATIV; "${PLAN_DOC}" liefert Kontext. Bei Widerspruch gilt die Spec; echte Widersprueche in deviations melden.
2. Das Praedikat aus OC-P1 (calleeIsOwner) ist die EINZIGE Entscheidungsquelle - OC-P3 verdrahtet es an den in der Spec genannten Stellen (claude.js-Systemprompt-Zweig, i18n-Bausteine de/fr/en, Dashboard-Feld), fuegt aber KEINE eigene Vergleichslogik hinzu.
3. NICHT-OWNER-PFAD BYTE-IDENTISCH: Prompts/Eroeffnungen fuer Nicht-Owner-Ziele aendern sich NICHT (Fixture-Beweis). Der disclosureSentence-Mechanismus fuer Nicht-Owner bleibt unangetastet erster Satz.
4. Auch im Owner-Zweig: KI-Kennzeichnung bleibt, Pflicht-Rueckfall auf den vollen Offenlegungssatz, wenn nicht der Auftraggeber am Apparat ist - gleicher Wortlaut wie OC-P2, aus dem Plan uebernehmen.
5. Dashboard (apps/web): NUR das, was die Spec nennt. /app bleibt ENGLISCH (i18n-W3-Entscheidung). Keine neuen Routen ohne route-policy-Konformitaet.
6. Neue Env-Vars (falls die Spec welche nennt) an ALLE vier Orte inkl. test/helpers.js BASE_ENV.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- **Absolute Regel 2:** Offenlegungssatz bleibt fuer JEDES Nicht-Owner-Ziel fest verdrahteter erster Satz; die Owner-Ausnahme greift NUR ueber das OC-P1-Praedikat (Owner-Entscheidung 2026-08-20, dokumentiert in CLAUDE.md seit OC-P2). Fail-open = BLOCKER.
- Safety-Gates NIE anfassen. Auth fail-closed (route-auth-inventory gruen). Secrets nur via env.
- KEINE echten Anrufe/SMS, KEINE Provider-Schreibzugriffe, KEIN elevenlabs:push, KEIN Deploy. Offline gegen Attrappen.
- SCOPE: NUR OC-P3 gemaess Spec. Kein src/bridge.js, keine EL-Vorlagen (liegen seit OC-P2 fest).`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - AUTORITATIV.
2. Lies aus "${REPO}/${PLAN_DOC}" die Kapitel zu Gleichlauf/Engines, Owner-Wortlaut und Pre-Mortem.
3. Lies "${REPO}/.claude/refs/clean-code.md".
4. Lies den ECHTEN Code auf Basis "${BASE}" an allen Stellen, die die Spec nennt (u.a. src/claude.js Systemprompt/disclosureSentence, src/i18n/prompts/*.js, das OC-P1-Praedikat, die OC-P2-Verdrahtung als Vorbild, apps/web SettingsIsland). Miss selbst: ${TEST_CMD} auf master (pass-Zahl = Anker). Grep gezielt; KEINE Zeilennummer ungeprueft uebernehmen. Beachte: der Bestand hat sich durch OC-P1+OC-P2 bewegt - die Spec wurde VOR beiden geschrieben; echte Abweichungen zwischen Spec-Annahmen und Ist-Code benennen und den Ist-Code respektieren.
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
DEINE WICHTIGSTEN ZWEI AUFGABEN:
(a) **Jede Verdrahtungsstelle einzeln belegen:** Wo genau greift der Owner-Zweig in claude.js/i18n, und mit welchem Fixture-Test bleibt der Nicht-Owner-Prompt byte-identisch?
(b) **Die Dashboard-Aenderung eng schneiden:** exakt das Spec-Feld, Auth-Kette, /app englisch, kein Scope-Drift.
LIEFERE: exakte Edits je Datei (Vorher/Nachher), neue Tests inkl. Sabotage-Gegenprobe (Owner-Zweig fuer Fremd-Ziel erzwungen -> Test MUSS rot), je Abnahmepunkt der Spec Kommando + erwartete Ausgabe. Deine Rueckgabe IST der Plan.`,
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
    nonOwnerByteIdenticalProof: {
      type: "string",
      description: "Fixture-Beweis: Nicht-Owner-Prompt/Eroeffnung byte-identisch. Kommando + Ausgabe",
    },
    failClosedProof: {
      type: "string",
      description: "AUSGEFUEHRTE Sabotage-Gegenprobe: Owner-Zweig fuer Fremd-Ziel -> Test rot -> wiederhergestellt. Woertlich",
    },
    abnahmeProofs: { type: "string", description: "JEDER Abnahmepunkt der Spec: Kommando + Ausgabe" },
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
    "nonOwnerByteIdenticalProof",
    "failClosedProof",
    "abnahmeProofs",
    "committed",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert). Setze Phase ${PHASE} ${PHASE_TITLE} GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${BRANCH} ${BASE}
3. Lies "${REPO}/${SPEC_FILE}" SELBST. Implementiere EXAKT gemaess Plan+Spec. ${CLEAN_CODE_REQ}
${LEAD_DECISIONS}
4. node --check auf JEDE geaenderte .js-Datei.
5. ${TEST_CMD} - pass MUSS >= ${TEST_FLOOR} sein und fail == 0 (Einzel-Flake nur nach isolierter Wiederholung werten; SINKEN unter den vom Plan gemessenen master-Anker ist ein Blocker).
6. **BYTE-IDENTITAETS-BEWEIS + SABOTAGE-GEGENPROBE (beide Pflicht, beide AUSFUEHREN):** nach nonOwnerByteIdenticalProof bzw. failClosedProof, Kommando+Ausgabe woertlich.
7. JEDEN Abnahmepunkt der Spec einzeln abarbeiten; Kommando+Ausgabe nach abnahmeProofs.
8. node_modules NICHT committen. git add (betroffene Dateien EINZELN, nie git add -A) && git commit. headCommit = git rev-parse HEAD.
${ABS_RULES}
EHRLICH fuellen; Offenes offen nennen, nicht schoenen.`,
  {
    label: `${PHASE}-implement`,
    phase: "Implementieren",
    schema: IMPL_SCHEMA,
    isolation: "worktree",
    ...IMPL_AGENT,
  },
);

// ---------- Phase 3: Dualer Review ----------
const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    testsPassIndependently: { type: "boolean" },
    independentTestSummary: { type: "string" },
    testCountNotShrunk: { type: "boolean", description: `pass >= ${TEST_FLOOR}, fail 0` },
    nonOwnerByteIdentical: { type: "boolean", description: "SELBST bewiesen (Fixture-Diff)" },
    failClosedProofRepeated: { type: "boolean", description: "Sabotage-Gegenprobe SELBST rot gesehen" },
    disclosureIntactNonOwner: {
      type: "boolean",
      description: "disclosureSentence-Mechanik fuer Nicht-Owner unveraendert erster Satz, Riegel-Tests gruen",
    },
    ownerBranchConsistent: {
      type: "boolean",
      description: "Owner-Zweig nutzt NUR das OC-P1-Praedikat; Wortlaut (KI-Kennzeichnung, Rueckfall) konsistent zu OC-P2",
    },
    dashboardScopeTight: { type: "boolean", description: "apps/web nur Spec-Umfang, /app englisch, Auth ok" },
    routeAuthIntact: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    scopeRespected: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "testCountNotShrunk",
    "nonOwnerByteIdentical",
    "failClosedProofRepeated",
    "disclosureIntactNonOwner",
    "ownerBranchConsistent",
    "dashboardScopeTight",
    "routeAuthIntact",
    "safetyGatesIntact",
    "noSecretsLeaked",
    "scopeRespected",
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
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Owner-Ausnahme an weiteren Offenlegungs-Stellen - im Zweifel blockieren.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. ${TEST_CMD} SELBST (pass >= ${TEST_FLOOR}, fail 0; Einzel-Flake isoliert wiederholen).
4. Lies "${REPO}/${SPEC_FILE}" + relevante Kapitel aus "${REPO}/${PLAN_DOC}".
5. JEDEN Abnahmepunkt der Spec EINZELN selbst fahren; keine Impl-Behauptung uebernehmen:
   - **nonOwnerByteIdentical** selbst beweisen (Fixture-Diff gegen ${BASE}).
   - **Sabotage-Gegenprobe** selbst ausfuehren (Owner-Zweig fuer Fremd-Ziel -> Test MUSS rot).
   - **disclosureIntactNonOwner:** disclosureSentence fuer Nicht-Owner unveraendert; kein gelockertes Assert, kein geloeschter Testfall.
   - **ownerBranchConsistent:** NUR das OC-P1-Praedikat entscheidet; Wortlaut konsistent zu OC-P2 (KI-Kennzeichnung + woertlicher Rueckfall); DE-Strings mit echten Umlauten, wo vorgesehen; der neue Owner-Prompt-Zweig hat seine EIGENE Umlaut-/Inhalts-Pruefung.
   - **dashboardScopeTight** + **routeAuthIntact:** apps/web eng am Spec-Umfang, /app englisch, test/route-auth-inventory.test.js gruen.
6. git diff ${BASE}..${target} -- src/bridge.js MUSS leer sein; elevenlabs/agent_configs unberuehrt.
${LEAD_DECISIONS}
${ABS_RULES}
approved=true NUR wenn alle Punkte selbst gesehen. Rueckgabe IST das Urteil.`,
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
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG.
2. git diff ${BASE} ${target} ; neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad. S3/S4 gebuendelt.
BESONDERS ACHTEN:
 - **G5/S2:** keine zweite Owner-Entscheidungslogik; Praedikat-Aufrufe statt Kopien.
 - **Umlaut-Regel:** gesprochene/prompt-sichtbare DE-Strings mit echten Umlauten; Kommentare ASCII.
 - **P11/T-Serie:** eigener Test fuer den Owner-Prompt-Zweig; AUSGEFUEHRTE Gegenproben, sonst S1.
 - apps/web: bestehende Komponenten-Idiome respektieren, kein Inline-Style-Wildwuchs.
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
3. Behebe DIESE Blocker sauber und minimal; fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + ${TEST_CMD} gruen, pass >= ${TEST_FLOOR}. node_modules NICHT committen. git add (betroffene Dateien einzeln) && git commit -m "fix(${String(PHASE).toLowerCase()}): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
      `r${round}: ABBRUCH - kein Commit vom Fix-Agenten (Branch ${fixBranch} existiert nicht). Blocker bleiben stehen.`,
    );
    break;
  }
  reviewTarget = fixBranch;
  [safety, cc] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc);

// ---------- Phase 5: Report ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe einen Detailbericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
Inhalt (Markdown, deutsch OHNE Umlaute): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; die Verdrahtungsstellen einzeln; die Abnahmepunkte einzeln mit Urteil+Kommando; die ausgefuehrten Gegenproben woertlich; Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit; Fix-Runden. Quelle:
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
  nonOwnerByteIdentical: (safety && safety.nonOwnerByteIdentical) || false,
  disclosureIntactNonOwner: (safety && safety.disclosureIntactNonOwner) || false,
  ownerBranchConsistent: (safety && safety.ownerBranchConsistent) || false,
  dashboardScopeTight: (safety && safety.dashboardScopeTight) || false,
  routeAuthIntact: (safety && safety.routeAuthIntact) || false,
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
