// PER-RUN-Skript AUTH-P9a (Kopie von auth-p7.js, Phase HART GEPINNT).
// Siehe Memory [[phase-impl-workflow-args]]: die Phase steht hier im Skript, nicht in args.

export const meta = {
  name: "phase-impl-lean",
  description:
    "AUTH-P9a: Cache-Header fuer die statische Auslieferung - fingerprintete Chunks immutable, HTML no-cache.",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan (clean-code.md + Spec + echter Code)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, ein Commit, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/auth-gate-p9a-report.md" },
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
const PHASE = "AUTH-P9A";
const PHASE_TITLE = "Cache-Header fuer die statische Auslieferung";
const BRANCH = "phase/auth-p9a-cache-header";
const BASE = "master";
const PLAN_DOC = "PLAN-AUTH-GATE.md";
const SPEC_FILE = "tasks/auth-gate-p9a-spec.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/auth-gate-p9a-report.md";

const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";

const PLAN_AGENT = { model: MODEL_OPUS, effort: "high" };
const IMPL_AGENT = { model: MODEL_SONNET, effort: "high" };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: "high" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Magic Numbers (G25 - 31536000 ist eine benannte Konstante mit sprechendem Namen, kein nackter Wert); keine Duplizierung (G5); intentions-ausdrueckende Namen (N1/N2); eine Aufgabe pro Funktion (G30); ESM, kein Build-Step. Kommentare deutsch OHNE Umlaute (ue/oe/ae).`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE entfernen/aufweichen. Diese Phase fasst KEINE Sicherung an.
- src/middleware.js (no-store fuer /api/) bleibt UNBERUEHRT - eine API-Antwort darf niemals cachebar werden.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const P9A_SCOPE = `SCOPE DIESER PHASE (bindend, Spec ist die Autoritaet):
- GENAU EINE Aenderung: express.static fuer WEB_DIST_DIR (src/app.js, registerStaticServing) bekommt setHeaders. Pfade unter /_astro/ -> "public, max-age=31536000, immutable"; *.html -> "no-cache".
- STRIKT NUR FINGERPRINTETE PFADE bekommen immutable. Ein faelschlich als immutable ausgeliefertes Asset ueberlebt einen Rollback im Browser des Nutzers - kein Deploy holt es zurueck. Der Praefix wird EXAKT gematcht (nicht "enthaelt _astro"), und der Test belegt BEIDE Richtungen: eine Datei unter /_astro/ bekommt immutable, eine daneben liegende NICHT.
- NICHT ANFASSEN: src/middleware.js; express.static(publicDir) (die Marken-Assets, anderer Mount, anderer Lebenszyklus); irgendeine Auth-/Safety-Naht.
- KEIN Loeschen des Legacy-Checkout-Paars (POST /api/billing/setup-checkout, GET /api/billing/checkout-return) - das ist P9b und braucht 30 Tage Karenz nach dem Live-Deploy von P7. Wer es hier loescht, hat die Phase verfehlt.
- KEINE neue Env-Variable, KEIN neues Flag, KEINE neue Dependency.
- TEST-IDs: "AUTH-P9A-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer).
- NIEMALS "git stash" (refs/stash ist zwischen Worktrees geteilt). NIEMALS "git add -A". Dateien einzeln adden.
- EIN Commit fuer diese Phase.`;

const specInstruction = `Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - das ist die AUTORITATIVE Definition dieser Phase.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. Lies aus "${REPO}/${PLAN_DOC}" GEZIELT (grosse Datei): Abschnitt 1 (dort der empirische Cache-Befund) und Abschnitt 7 den Unterabschnitt "### P9". Lies ausserdem "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}": src/app.js (registerStaticServing VOLLSTAENDIG - beide express.static-Mounts und der SPA-Fallback), src/middleware.js (die no-store-Regel fuer /api/ - sie bleibt unberuehrt, du musst aber wissen, wie sie greift), test/helpers.js (startServer, wie ein Test WEB_DIST_DIR setzen kann - suche nach bestehenden Tests, die WEB_DIST_DIR nutzen). Pruefe am Astro-Build (apps/web), wie die fingerprinteten Pfade wirklich heissen - rate nicht.
4. Entwirf setHeaders: exakter Praefix-Match, die Konstanten mit sprechenden Namen, und die Reihenfolge der Faelle. Zeige, dass eine Datei ausserhalb /_astro/ NICHT immutable bekommt.
5. Entwirf die Tests AUTH-P9A-*: Spawn-Test mit Temp-WEB_DIST_DIR (index.html, app/index.html, eine Datei unter _astro/, plus eine Datei DANEBEN als Gegenprobe). Je Fall die konkrete Assertion auf den Cache-Control-Header. Dazu ein Test, dass /api/plans weiterhin no-store traegt.
${P9A_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die exakten Edits; (2) die Konstanten mit Namen; (3) die Tests AUTH-P9A-* mit Assertions; (4) die Mutationsprobe; (5) den Beleg, wie die Astro-Pfade wirklich aussehen. Deine Rueckgabe IST der Plan.`,
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
    immutableOnlyForFingerprinted: {
      type: "string",
      description:
        "Beleg, dass NUR /_astro/ immutable bekommt - inkl. der Gegenprobe (Datei daneben bekommt es nicht)",
    },
    apiNoStoreUntouched: {
      type: "boolean",
      description: "src/middleware.js unveraendert; /api/ traegt weiterhin no-store (per Test belegt)",
    },
    astroPathEvidence: {
      type: "string",
      description: "Womit ist belegt, wie die fingerprinteten Pfade wirklich heissen? (Build/Verzeichnis, nicht geraten)",
    },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    mutationProbeResult: { type: "string" },
    legacyPairKept: {
      type: "boolean",
      description: "Das Legacy-Checkout-Paar steht noch (P9b, Karenz)",
    },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "immutableOnlyForFingerprinted",
    "apiNoStoreUntouched",
    "astroPathEvidence",
    "nodeCheckPass",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "mutationProbeResult",
    "legacyPairKept",
    "committed",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert). Setze Phase ${PHASE} GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${BRANCH} ${BASE}
3. setHeaders + Tests AUTH-P9A-*. node --check, npm test gruen, Dateien EINZELN adden, committen: "feat(auth-p9a): Cache-Header - fingerprintete Chunks immutable, HTML no-cache".
${P9A_SCOPE}
${CLEAN_CODE_REQ}
4. Mutationsprobe: den Praefix-Match testweise auf "enthaelt _astro" lockern ODER setHeaders entfernen -> genau die neuen Tests werden rot. Zuruecknehmen, npm test erneut gruen.
5. node_modules-Symlink NICHT committen. Nach dem Lauf: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${ABS_RULES}
EHRLICH fuellen. astroPathEvidence: sag, WIE du die Pfade belegt hast (Build-Verzeichnis angesehen? apps/web-Konfiguration gelesen?), nicht dass du es "weisst".`,
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
    scopeRespected: { type: "boolean" },
    immutableStrictlyFingerprinted: {
      type: "boolean",
      description:
        "NUR fingerprintete Pfade bekommen immutable - selbst nachgerechnet, inkl. der Gegenprobe. Ein zu weiter Match ist ein BLOCKER (ueberlebt Rollback im Browser).",
    },
    apiNoStoreIntact: { type: "boolean" },
    noAuthSurfaceTouched: {
      type: "boolean",
      description: "Keine Auth-/Safety-Naht angefasst",
    },
    legacyPairKept: { type: "boolean" },
    existingAssertionsNotWeakened: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "immutableStrictlyFingerprinted",
    "apiNoStoreIntact",
    "noAuthSurfaceTouched",
    "legacyPairKept",
    "existingAssertionsNotWeakened",
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
        `STRENGER Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}".
Der teuerste Fehler dieser Phase: ein Asset, das faelschlich "immutable" traegt, bleibt ein Jahr im Browser des Nutzers - kein Deploy und kein Rollback erreicht es.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen.
4. git diff ${BASE}...${target} (DREI Punkte, gegen die Merge-Basis).
${P9A_SCOPE}
PRUEFE BESONDERS:
- immutableStrictlyFingerprinted: rechne den Match selbst nach. Bekommt eine Datei, die nur "_astro" im Namen traegt aber nicht unter /_astro/ liegt, faelschlich immutable? Gibt es eine Gegenprobe im Test? Ein zu weiter Match ist ein BLOCKER.
- apiNoStoreIntact: git diff auf src/middleware.js MUSS leer sein, und ein Test muss belegen, dass /api/ weiterhin no-store traegt.
- noAuthSurfaceTouched + legacyPairKept: git diff gegen alles unter src/wiring/, src/route-policy.js, src/routes/api-billing.js. Jede Aenderung dort ist scope-fremd.
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine Tests gruen.`,
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
        `CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${target}", Basis "${BASE}").
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG.
2. git diff ${BASE}...${target} (DREI Punkte); neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID - Datei - Verstoss - Fix" + Schweregrad. S3/S4 gebuendelt.
Achte besonders auf: (a) 31536000 als benannte Konstante mit sprechendem Namen, nicht als nackte Zahl (G25); (b) die setHeaders-Funktion: eine Aufgabe, lesbare Fallunterscheidung, kein verschachteltes Praefix-Gefrickel (G30/G19); (c) der Praefix als EINE Quelle, falls er mehrfach gebraucht wird (G5); (d) die Tests: ein Konzept pro Test (P14), Gegenprobe vorhanden (T5).
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
    `Du behebst die REVIEW-BLOCKER der Phase ${PHASE} in einem frischen Worktree. NUR die Blocker fixen.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${fixBranch} ${reviewTarget}
3. Behebe DIESE Blocker, je Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${P9A_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test gruen. Dateien EINZELN adden, kein git stash. git commit -m "fix(auth-p9a): Review-Blocker beheben (Runde ${round})".
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
    fixSummaries.push(`r${round}: ABBRUCH - kein Commit vom Fix-Agenten.`);
    break;
  }
  reviewTarget = fixBranch;
  [safety, cc] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc);

// ---------- Phase 5: Prozessbericht ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe den Bericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}". NICHTS am Code aendern, KEIN git-Commit.
EHRLICHKEITSREGEL: sag ausdruecklich, dass die Cache-Wirkung erst nach dem Deploy messbar ist (curl -I gegen die Live-URL) und dass ein faelschlich immutable ausgeliefertes Asset einen Rollback ueberlebt - deshalb der strikte Praefix-Match.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; Commit-Hash; die Aenderung; der Beleg fuer die Astro-Pfade; die Tests mit Assertions inkl. Gegenprobe; die Mutationsprobe; Safety-Urteil; Clean-Code-Audit; Fix-Runden; die Nach-Deploy-Pruefung (curl -I .../app/ -> no-cache; curl -I .../_astro/<chunk>.js -> immutable); ein Abschnitt "Was diese Phase NICHT belegt". Quelle:
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
  headCommit: (impl && impl.headCommit) || null,
  testPassCount: (impl && impl.testPassCount) || null,
  immutableOnlyForFingerprinted: (impl && impl.immutableOnlyForFingerprinted) || "",
  apiNoStoreUntouched: impl ? impl.apiNoStoreUntouched === true : false,
  astroPathEvidence: (impl && impl.astroPathEvidence) || "",
  legacyPairKept: impl ? impl.legacyPairKept === true : false,
  mutationProbeResult: (impl && impl.mutationProbeResult) || "",
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
