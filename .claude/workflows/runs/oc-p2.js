// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Kopie der Vorlage .claude/workflows/runs/oc-p1.js, Phase HART GEPINNT auf OC-P2.

export const meta = {
  name: "phase-impl-lean-oc-p2",
  description:
    "OC-P2: Owner-Call-Wirkung auf dem Live-Pfad (ElevenLabs) - Eroeffnung ohne Offenlegungssatz NUR bei Owner-Ziel, Owner-Ansprache. Plan -> Impl (Worktree) -> dualer Review -> Self-Fix -> Report.",
  phases: [
    { title: "Plan", detail: "EL-Pfad-Wirkung code-gegroundet planen (Vorlage NUR im Repo)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen, KEIN Push/Deploy" },
    { title: "Review", detail: "Safety/Abnahme + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Detailbericht in tasks/oc-p2-report.md (Lead liest ihn nicht)" },
  ],
};

// HART GEPINNT auf das Haupt-Repo (Symlink-Falle, C-P4).
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN-SKRIPT OC-P2: Phase HART GEPINNT.
// highStakes: diese Phase macht das Praedikat OFFENLEGUNGS-WIRKSAM auf dem live
// laufenden ElevenLabs-Pfad (Absolute Regel 2, enge Owner-Ausnahme 2026-08-20).
const A = {
  phaseId: "OC-P2",
  phaseTitle: "Owner-Call-Wirkung auf dem Live-Pfad (ElevenLabs)",
  branch: "phase/oc-p2-el-wirkung",
  baseBranch: "master",
  planDoc: "PLAN-OWNER-CALL.md",
  specFile: "tasks/oc-p2-spec.md",
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

// MODELL-POLITIK: jeder agent() explizit gepinnt (Memory [[workflow-model-policy]]);
// Impl auf Opus wegen highStakes am Offenlegungs-Pfad (Praezedenz: b4a am Geld-Pfad).
const PLAN_AGENT = { model: "opus", effort: "high" };
const IMPL_AGENT = { model: "opus", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };
const CLEANCODE_AGENT = { model: "sonnet", effort: "medium" };
const FIX_AGENT = { model: "sonnet", effort: "medium" };
const REPORT_AGENT = { model: "sonnet", effort: "low" };

// Suite-Anker: 4909 gruen am 2026-08-20 vor der Kette; nach OC-P1 kommt die dortige
// pass-Zahl dazu - der Plan-Agent misst den ECHTEN Stand auf master und pinnt ihn.
const TEST_CMD = `LLM_PROVIDER=anthropic npm test`;
const TEST_FLOOR = 4909;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn bei JEDER Entscheidung. Fuer diese Phase besonders: die Eroeffnungs-Komposition bleibt an EINER Stelle (G5/S2 - composedOpeningLine ist die Kompositionsstelle, kein zweiter Ort); keine Magic Values (G25/G35); kein toter Code (C5/G9); i18n-Bausteine dort, wo die Bestandsbausteine liegen; gesprochene DEUTSCHE Strings tragen ECHTE UMLAUTE (Umlaut-Regel: nur Code-Kommentare sind ASCII); Kommentare deutsch OHNE Umlaute. Neues Verhalten braucht Tests (P11/T-Serie).`;

const LEAD_DECISIONS = `BINDENDE LEAD-ENTSCHEIDUNGEN - nicht neu aufrollen, nicht umdeuten:
1. Die Spec "${SPEC_FILE}" ist AUTORITATIV; "${PLAN_DOC}" liefert Kontext (Praedikat, Pre-Mortem, Runbook). Bei Widerspruch gilt die Spec; echte Widersprueche in deviations melden.
2. Das Praedikat aus OC-P1 (calleeIsOwner, fail-closed Vierfach-Konjunktion) ist die EINZIGE Entscheidungsquelle. OC-P2 fuegt KEINE zweite Vergleichslogik hinzu.
3. NICHT-OWNER-PFAD BYTE-IDENTISCH: Fuer jedes Ziel, das das Praedikat nicht bejaht, sind opening_line, first_message-Variablen, Prompt-Variablen und alle API-Bodies BYTE-IDENTISCH zu heute. Das ist testpflichtig (Fixture-Vergleich vorher/nachher).
4. KI-KENNZEICHNUNG BLEIBT: Auch die Owner-Eroeffnung nennt sich KI/AI/IA (je Sprache de/fr/en gemaess Spec-Wortlaut). Der Prompt erhaelt den Pflicht-Rueckfall: meldet sich NICHT der Auftraggeber, holt der Agent den vollen Offenlegungssatz WOERTLICH nach.
5. REPO-VORLAGE JA, LIVE-PUSH NEIN: Aenderungen an elevenlabs/agent_configs/*.template.json sind Teil dieser Phase; "npm run elevenlabs:push" (oder irgendein --ausfuehren) ist VERBOTEN - die Live-Schaltung macht der Lead spaeter nach Runbook (Push VOR Deploy). Der Zwischenzustand "Vorlage im Repo neu, live alt" darf das heutige Live-Verhalten nicht beruehren.
6. CLAUDE.md-Regel-2-Ergaenzung und der PLAN-SECURITY.md-Eintrag (Launch-Blocker: SMS-Besitz-Verifikation loest die Env-Allowlist ab) kommen WOERTLICH aus "${PLAN_DOC}" - nicht neu formulieren.
7. Vor der Aenderung den Stand von "npm run test:gates" messen (Zahl notieren), danach: unveraendert. Neue Tests OHNE Katalog-ID-Praefix (sonst wandern sie in den Gates-Lauf).`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- **Absolute Regel 2:** Der Offenlegungssatz bleibt fuer JEDES Nicht-Owner-Ziel fest verdrahteter erster Satz - die bestehenden Art.-50-Riegel/startsWith-Tests fuer Nicht-Owner-Ziele muessen unveraendert gruen bleiben. Die Owner-Ausnahme greift NUR ueber das OC-P1-Praedikat. Ein Pfad, der die Offenlegung fuer ein Fremd-Ziel stilllegen kann, ist ein BLOCKER.
- Safety-Gates (Outbound-Permit Abo+KYC, OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, Max-Dauer, Ed25519 fail-closed) NIE anfassen. Auth fail-closed. Secrets nur via env.
- KEINE echten Anrufe/SMS, KEINE ElevenLabs-/Telnyx-/Render-Schreibzugriffe, KEIN elevenlabs:push, KEIN Deploy. Offline gegen Attrappen.
- SCOPE: NUR OC-P2 gemaess Spec. Kein src/bridge.js, keine Prompt-Bausteine der uebrigen Engines (OC-P3), kein Dashboard.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - AUTORITATIV (Scope, Entscheidungen, Invarianten, Abgrenzung, Abnahme).
2. Lies aus "${REPO}/${PLAN_DOC}" die Kapitel zu Live-Pfad-Wirkung, Pre-Mortem, CLAUDE.md-Textbaustein, PLAN-SECURITY-Eintrag und Runbook.
3. Lies "${REPO}/.claude/refs/clean-code.md".
4. Lies den ECHTEN Code auf Basis "${BASE}" an allen Stellen, die die Spec nennt (u.a. src/elevenlabs/outbound.js dynamicVariables/conversationConfigOverride, src/elevenlabs/call-locale.js, src/elevenlabs/convai.js, die Vorlage elevenlabs/agent_configs/*.template.json, das OC-P1-Praedikat-Modul, test/el-opening-line.test.js). Miss selbst: ${TEST_CMD} auf master (pass-Zahl = Anker) und npm run test:gates (Zahl notieren). Grep gezielt; KEINE Zeilennummer ungeprueft uebernehmen.
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
DEINE WICHTIGSTEN ZWEI AUFGABEN:
(a) **Die Byte-Identitaets-Grenze exakt ziehen:** Welche Werte (Variablen, Overrides, Vorlagen-Felder) aendern sich NUR im Owner-Fall, und wie beweist ein Fixture-Test, dass der Nicht-Owner-Fall byte-identisch bleibt? Liste jeden beruehrten Wert.
(b) **Den Zwischenzustand der Live-Schaltung durchdenken:** Vorlage-im-Repo-neu/live-alt und Code-neu/Vorlage-live-alt - was passiert je Kombination am Telefon? Die Spec/der Plan behaupten Harmlosigkeit - verifiziere das am Code und benenne die Beweisstelle.
LIEFERE: exakte Edits je Datei (Vorher/Nachher), neue Tests inkl. Sabotage-Gegenprobe (Owner-Zweig faelschlich fuer Fremd-Ziel aktivieren -> Test MUSS rot), je Abnahmepunkt der Spec Kommando + erwartete Ausgabe. Deine Rueckgabe IST der Plan.`,
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
    gatesCountBefore: { type: "number" },
    gatesCountAfter: { type: "number" },
    nonOwnerByteIdenticalProof: {
      type: "string",
      description: "Fixture-Beweis: Nicht-Owner-Ziel erzeugt byte-identische Variablen/Bodies. Kommando + Ausgabe",
    },
    failClosedProof: {
      type: "string",
      description: "AUSGEFUEHRTE Sabotage-Gegenprobe: Owner-Zweig fuer Fremd-Ziel erzwungen -> Test rot -> wiederhergestellt. Woertlich",
    },
    abnahmeProofs: { type: "string", description: "JEDER Abnahmepunkt der Spec: Kommando + Ausgabe" },
    claudeMdAndSecurityUpdated: {
      type: "boolean",
      description: "CLAUDE.md-Regel-2-Baustein + PLAN-SECURITY-Eintrag woertlich aus dem Plan uebernommen",
    },
    noLivePushExecuted: { type: "boolean", description: "kein elevenlabs:push/--ausfuehren gelaufen" },
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
    "gatesCountBefore",
    "gatesCountAfter",
    "nonOwnerByteIdenticalProof",
    "failClosedProof",
    "abnahmeProofs",
    "claudeMdAndSecurityUpdated",
    "noLivePushExecuted",
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
5. ${TEST_CMD} - pass MUSS >= ${TEST_FLOOR} sein und fail == 0 (Einzel-Flake nur nach isolierter Wiederholung werten; pass-SINKEN unter den vom Plan gemessenen master-Anker ist ein Blocker). npm run test:gates: Zahl vorher/nachher nach gatesCountBefore/gatesCountAfter.
6. **BYTE-IDENTITAETS-BEWEIS (Pflicht):** Fixture-Test Nicht-Owner-Ziel vorher==nachher; Kommando+Ausgabe nach nonOwnerByteIdenticalProof.
7. **SABOTAGE-GEGENPROBE (Pflicht):** Owner-Zweig fuer ein Fremd-Ziel erzwingen -> Test MUSS rot werden -> wiederherstellen; woertlich nach failClosedProof.
8. JEDEN Abnahmepunkt der Spec einzeln abarbeiten; Kommando+Ausgabe nach abnahmeProofs.
9. node_modules NICHT committen. git add (betroffene Dateien EINZELN, nie git add -A) && git commit. headCommit = git rev-parse HEAD.
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
    gatesCountUnchanged: { type: "boolean", description: "npm run test:gates Zahl unveraendert" },
    nonOwnerByteIdentical: {
      type: "boolean",
      description: "SELBST bewiesen: Nicht-Owner-Ziel byte-identisch (Variablen/Overrides/Bodies)",
    },
    failClosedProofRepeated: { type: "boolean", description: "Sabotage-Gegenprobe SELBST rot gesehen" },
    art50RiegelIntact: {
      type: "boolean",
      description: "startsWith-/Offenlegungs-Riegel fuer Nicht-Owner unveraendert gruen und ungeschwaecht",
    },
    kiKennzeichnungPresent: {
      type: "boolean",
      description: "Owner-Eroeffnung nennt KI/AI/IA in allen drei Sprachen; DE-String mit echten Umlauten wo vorgesehen",
    },
    disclosureFallbackRule: {
      type: "boolean",
      description: "Prompt-Rueckfall: voller Offenlegungssatz woertlich, wenn nicht der Auftraggeber abnimmt",
    },
    noLivePushExecuted: { type: "boolean" },
    docsUpdatedVerbatim: { type: "boolean", description: "CLAUDE.md + PLAN-SECURITY.md woertlich gemaess Plan" },
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
    "gatesCountUnchanged",
    "nonOwnerByteIdentical",
    "failClosedProofRepeated",
    "art50RiegelIntact",
    "kiKennzeichnungPresent",
    "disclosureFallbackRule",
    "noLivePushExecuted",
    "docsUpdatedVerbatim",
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
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase macht das Owner-Praedikat OFFENLEGUNGS-WIRKSAM auf dem LIVE laufenden ElevenLabs-Pfad - im Zweifel blockieren.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. ${TEST_CMD} SELBST (pass >= ${TEST_FLOOR}, fail 0; Einzel-Flake isoliert wiederholen). npm run test:gates SELBST: Zahl gegen den im Plan/Impl notierten Vorher-Wert.
4. Lies "${REPO}/${SPEC_FILE}" + die Pre-Mortem-/Runbook-Kapitel aus "${REPO}/${PLAN_DOC}".
5. JEDEN Abnahmepunkt der Spec EINZELN selbst fahren. Verlass dich auf KEINE Behauptung des Impl-Agenten:
   - **nonOwnerByteIdentical:** selbst beweisen (Fixture-Diff) - fuer ein Fremd-Ziel sind Variablen, Overrides, Vorlagen-Wirkung und API-Bodies byte-identisch zu ${BASE}.
   - **Sabotage-Gegenprobe** selbst ausfuehren: Owner-Zweig fuer Fremd-Ziel erzwingen -> Test MUSS rot.
   - **art50RiegelIntact:** die bestehenden Offenlegungs-/startsWith-Tests fuer Nicht-Owner sind unveraendert vorhanden, ungeschwaecht (kein gelockertes Assert, kein geloeschter Fall) und gruen.
   - **kiKennzeichnungPresent** + **disclosureFallbackRule:** Wortlaut je Sprache gegen die Spec pruefen; DE gesprochene Strings mit echten Umlauten, wo die Spec sie vorgibt.
   - **noLivePushExecuted:** kein elevenlabs:push im Impl-Verlauf (Log/Aussage pruefen), Vorlagen-Aenderung NUR im Repo.
   - **docsUpdatedVerbatim:** CLAUDE.md-Regel-2-Baustein und PLAN-SECURITY-Eintrag woertlich wie im Plan.
   - Konstruiere aktiv Gegenbeispiele fuer fail-open (Formatvarianten, fremder Tenant, leere Allowlist, Praedikat wirft).
6. git diff ${BASE}..${target} -- src/bridge.js MUSS leer sein.
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
 - **G5/S2:** Eroeffnungs-Komposition bleibt an EINER Stelle; keine zweite Owner-Abfrage neben dem OC-P1-Praedikat.
 - **Umlaut-Regel:** gesprochene DE-Strings mit echten Umlauten; Code-Kommentare ASCII.
 - **P11/T-Serie:** Byte-Identitaets-Fixture + Sabotage-Gegenprobe vorhanden und AUSGEFUEHRT, sonst S1.
 - Vorlagen-JSON: keine strukturfremden Schluessel an Orten, die der Push ersetzt (Hinweis-Schluessel nur als Geschwister, Bestandsmuster beachten).
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
Inhalt (Markdown, deutsch OHNE Umlaute): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; die Byte-Identitaets-Grenze (welche Werte aendern sich NUR im Owner-Fall); die Abnahmepunkte einzeln mit Urteil+Kommando; die ausgefuehrten Gegenproben woertlich; was fuer die LIVE-SCHALTUNG offen bleibt (Push-Reihenfolge!); Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit; Fix-Runden. Quelle:
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
  art50RiegelIntact: (safety && safety.art50RiegelIntact) || false,
  kiKennzeichnungPresent: (safety && safety.kiKennzeichnungPresent) || false,
  disclosureFallbackRule: (safety && safety.disclosureFallbackRule) || false,
  noLivePushExecuted: (safety && safety.noLivePushExecuted) || false,
  docsUpdatedVerbatim: (safety && safety.docsUpdatedVerbatim) || false,
  gatesCountUnchanged: (safety && safety.gatesCountUnchanged) || false,
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
