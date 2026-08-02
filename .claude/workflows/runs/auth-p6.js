// PER-RUN-Skript AUTH-P6 (Kopie von auth-p5.js, Phase HART GEPINNT).
// Siehe Memory [[phase-impl-workflow-args]]: die Phase steht hier im Skript, nicht in args.

export const meta = {
  name: "phase-impl-lean",
  description:
    "AUTH-P6: Betreiber-Routen auf Admin-Session heben - lieber nicht gemountet als ungeschuetzt.",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan (clean-code.md + Spec + echter Code)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, ein Commit, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/auth-gate-p6-report.md" },
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
const PHASE = "AUTH-P6";
const PHASE_TITLE = "Betreiber-Routen auf Admin-Session";
const BRANCH = "phase/auth-p6-admin-session";
const BASE = "master";
const PLAN_DOC = "PLAN-AUTH-GATE.md";
const SPEC_FILE = "tasks/auth-gate-p6-spec.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/auth-gate-p6-report.md";

const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";

// Modellpolitik (Memory [[workflow-model-policy]]): Plan und Safety auf opus,
// Impl/Audit/Fix/Report auf sonnet. Pins explizit pro agent(), nie erben lassen.
const PLAN_AGENT = { model: MODEL_OPUS, effort: "high" };
const IMPL_AGENT = { model: MODEL_SONNET, effort: "high" };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: "xhigh" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Pruefkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, EINE Quelle fuer eine Zugehoerigkeit); keine Magic Numbers ausser 0/1/-1 (G25); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen (N1/N2); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript. Kommentare deutsch OHNE Umlaute (ue/oe/ae) - wie im Bestand.
BESONDERS HIER: die Bedingung "Middlewares vorhanden -> mounten, sonst NICHT mounten" darf nicht an sechs Stellen wiederholt werden. EINE benannte Stelle, deren Name die Absicht traegt (G5/N1).`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (Denylist/Land/Stundenlimit/pro-Tenant-Kostendecke/Max-Dauer/Signaturpruefung/OUTBOUND_FROZEN/Abo+KYC-Outbound-Permit) NIE entfernen/aufweichen/per-Default umgehen.
- AUTH FAIL-CLOSED: im Zweifel ablehnen. Fehlt die Sicherung, wird die Route NICHT gemountet - niemals ungeschuetzt gemountet.
- SECRETS (Regel 4): Audit-Eintraege tragen NIEMALS einen Query-String (req.path, nie req.originalUrl). Der Audit-Pfad aus AUTH-P5 bleibt unveraendert.
- Disclosure-Satz (disclosureSentence) bleibt fest verdrahtet und unveraendert.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const P6_SCOPE = `SCOPE DIESER PHASE (bindend, Spec ist die Autoritaet):
- GENAU SECHS Routen bekommen webAuthMw + adminMw: POST /api/onboard, POST /api/onboard/retry (src/routes/api-onboard.js), POST /api/billing/flush-meters, POST /api/billing/cost-truing/sweep, GET /api/billing/cost-drift, GET /api/billing/platform-costs (src/routes/api-billing.js).
- NICHT /api/tenant-data/export - das hat in AUTH-P5 internalOnly bekommen (Plan-Entscheidung 1, nicht neu aufrollen).
- HARTE INVARIANTE: webAuthMw und adminMw entstehen heute NUR im guardedBoot-Block (src/wiring/web-login.js), der fail-OPEN ist. Stehen sie nicht zur Verfuegung, werden diese sechs Routen GAR NICHT gemountet. Sie duerfen unter keinen Umstaenden ohne sie gemountet werden. Das ist die W6-Kopplung: ein verschluckter guardedBoot wird dadurch zu einem 404, den die Live-Probe als Durchfall wertet - waeren sie ungeschuetzt gemountet, waere derselbe Ausfall eine offene Tuer, die niemandem auffaellt.
- MOUNT-POSITION BEWUSST ENTSCHEIDEN UND BEGRUENDEN: bleibt der Mount HINTER dem Basic-Auth-Gate, antwortet einem anonymen externen Aufrufer weiterhin das Gate (401 + WWW-Authenticate: Basic). Wandert er davor, antwortet webAuthGateMiddleware (401 OHNE Basic-Challenge). Beides ist vertretbar - es nicht zu wissen ist es nicht. EMPFEHLUNG: Mount-Position unveraendert lassen (hinter dem Gate), das haelt die Staffelung bis P7 und den Diff klein.
- MITZUFUEHREN im selben Commit (H10): (1) src/route-policy.js - die sechs Eintraege fallen aus GATE_ONLY_ROUTES (sie klassifizieren ueber webAuthGateMiddleware/adminOnlyMiddleware als AUTH). Danach enthaelt GATE_ONLY_ROUTES NUR NOCH das Legacy-Checkout-Paar (setup-checkout, checkout-return) - das ist der Zwischenstand, den P7 vorfindet. (2) ROUTE_FINGERPRINT bleibt unveraendert (die Routen existieren weiter). (3) scripts/probe-auth.sh: die Spalte ANTWORTET fuer die sechs Zeilen entsprechend der gewaehlten Mount-Position; ART bleibt sitzung, STATUS bleibt 401. Bleibt der Mount hinter dem Gate, aendert sich an der Tabelle NICHTS.
- EIN TEST PINNT, WELCHE SCHICHT ANTWORTET. Ohne ihn faellt die Probe beim naechsten Deploy rot aus und niemand weiss, ob das ein Defekt ist.
- NICHT ANFASSEN: src/wiring/auth-gate.js (P7), src/wiring/internal-only.js und die sieben P5-Routen, das Legacy-Checkout-Paar (P9). KEINE Aenderung an der Fachlogik der sechs Routen - nur die Sicherung davor.
- KEINE neue Env-Variable, KEIN neues Flag, KEINE neue Dependency. ADMIN_EMAILS existiert bereits und wird nur genutzt.
- TEST-IDs: "AUTH-P6-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer) - solche Tests landen still im test:gates-Lauf, wo Rot erlaubt ist und nichts meldet.
- NIEMALS "git stash" (refs/stash ist zwischen Worktrees geteilt, eine Parallel-Session verliert sonst Arbeit). NIEMALS "git add -A" - im Repo liegen untrackte Dateien mit Kundendaten. Dateien einzeln adden.
- EIN Commit fuer diese Phase.`;

const specInstruction = `Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - das ist die AUTORITATIVE Definition dieser Phase (verbindlich vor dem Plan-Doc).`;

// Token-Disziplin: PLAN-AUTH-GATE.md ist 65 KB. Gezielt lesen, nicht am Stueck.
const planDocInstruction = `Lies aus "${REPO}/${PLAN_DOC}" GEZIELT (die Datei ist gross - nicht am Stueck lesen): Abschnitt 3 (Routen-Inventar, Klasse (b1)), Abschnitt 5 (stille Fehler, dort W6), Abschnitt 7 den Unterabschnitt "### P6" und Abschnitt 10 (Owner-Entscheidungen, dort Entscheidung 2). Nutze grep -n auf die Ueberschriften. Lies ausserdem "${REPO}/tasks/auth-gate-chain.md" (Kettenstand P1-P5).`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. ${planDocInstruction} Lies ausserdem "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}": src/app.js (die Mount-Sequenz VOLLSTAENDIG - besonders wo der guardedBoot-Block liegt und wo makeBillingRoutes/makeOnboardRoutes gemountet werden), src/wiring/web-login.js (wo webAuthMw und adminMw entstehen, was wireWebLogin zurueckgibt), src/web-auth.js (makeWebAuthGate/adminOnly-Fabriken, ihre Abhaengigkeiten), src/routes/api-billing.js und src/routes/api-onboard.js VOLLSTAENDIG, src/route-policy.js, scripts/probe-auth.sh (die sechs Zeilen), src/wiring/internal-only.js (das Muster aus P5), test/helpers.js (BASE_ENV, startServer, wie ein Test eine Session/Admin-Session herstellt - suche nach bestehenden Tests, die mit Session arbeiten), test/route-auth-inventory.test.js. Grep nach Symbolen - KEINE Zeilennummern uebernehmen.
4. LOESE DAS VERDRAHTUNGSPROBLEM: webAuthMw/adminMw entstehen im guardedBoot-Block, die sechs Routen werden spaeter gemountet. Entwirf den Weg, wie die Middlewares dorthin kommen, OHNE eine zweite Konstruktionsstelle zu schaffen (P15: Verdrahtung gehoert an die Kompositionswurzel). Zeige, wie "nicht vorhanden -> nicht mounten" strukturell erzwungen wird und nicht per Disziplin (G27).
5. Entscheide die Mount-Position begruendet und sage, welche Schicht danach einem anonymen externen Aufrufer antwortet. Leite daraus ab, ob scripts/probe-auth.sh geaendert werden muss.
6. Entwirf die Tests AUTH-P6-*: je Route (a) ohne Session -> 401, (b) mit Nicht-Admin-Session -> 403, (c) mit Admin-Session -> Erfolg; dazu (d) fehlen die Middlewares (kein sessionSecret / kein pg) -> die sechs Routen sind NICHT gemountet -> 404; (e) ein Test, der pinnt, welche Schicht dem anonymen externen Aufrufer antwortet. Nenne je Test die konkrete Assertion und wie du die Sessions im Spawn-Test herstellst.
7. Nenne ausdruecklich, welche Bestandstests kippen (alles, was heute /api/onboard oder /api/billing/* ohne Session anspricht) und wie du mit jedem einzelnen umgehst.
8. NENNE AUSSERDEM, ueber welchen Mechanismus ein Account als Admin gilt (role vs ADMIN_EMAILS) und was der Owner VOR dem Deploy pruefen muss, um sich nicht selbst auszusperren. Das ist eine Betriebsnotiz fuer den Bericht, keine Code-Aenderung.
${P6_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die exakten Edits je Datei; (2) den Verdrahtungsentwurf mit Begruendung; (3) die Mount-Positions-Entscheidung samt Folge fuer die Probe-Tabelle; (4) die Tests AUTH-P6-* mit konkreten Assertions; (5) die Mutationsprobe (adminMw entfernen -> welcher Test wird rot); (6) die Liste kippender Bestandstests mit Umgang; (7) die Admin-Betriebsnotiz. Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
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
    sixRoutesCovered: {
      type: "string",
      description: "Je Route ein Beleg, dass webAuthMw UND adminMw in ihrer Handler-Kette stehen",
    },
    notMountedWithoutMiddleware: {
      type: "string",
      description:
        "Wie ist strukturell erzwungen, dass die Routen ohne die Middlewares NICHT gemountet werden? Plus der Test, der es belegt.",
    },
    mountPositionDecision: {
      type: "string",
      description:
        "Welche Mount-Position wurde gewaehlt, warum, und welche Schicht antwortet danach einem anonymen externen Aufrufer?",
    },
    probeTableChange: {
      type: "string",
      description: "Wurde scripts/probe-auth.sh geaendert? Was genau, oder warum nicht?",
    },
    adminOperationalNote: {
      type: "string",
      description:
        "Ueber welchen Mechanismus gilt ein Account als Admin (role vs ADMIN_EMAILS) und was muss der Owner vor dem Deploy pruefen?",
    },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    gatesRedCount: { type: "number", description: "Rote Tests in npm run test:gates (Baseline 3)" },
    existingTestsAdjusted: {
      type: "array",
      items: { type: "string" },
      description: "Je angepasstem Bestandstest: ID - alte Zusage - neue Zusage - Begruendung",
    },
    mutationProbeResult: {
      type: "string",
      description: "adminMw testweise entfernt -> welche Tests rot? Mutation zurueckgenommen?",
    },
    gateOnlyRemaining: {
      type: "string",
      description: "Was steht nach dieser Phase noch in GATE_ONLY_ROUTES? (erwartet: nur das Legacy-Paar)",
    },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "sixRoutesCovered",
    "notMountedWithoutMiddleware",
    "mountPositionDecision",
    "probeTableChange",
    "adminOperationalNote",
    "nodeCheckPass",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "mutationProbeResult",
    "gateOnlyRemaining",
    "existingTestsAdjusted",
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
3. Die Verdrahtung + die sechs Routen-Ketten + die Tests AUTH-P6-*. node --check je geaenderter Datei, npm test gruen, dann Dateien EINZELN adden und committen: "feat(auth-p6): Betreiber-Routen auf Admin-Session - ohne Sicherung nicht gemountet".
${P6_SCOPE}
${CLEAN_CODE_REQ}
4. npm test gruen. Kippende Bestandstests: jede Anpassung einzeln in existingTestsAdjusted begruenden. Wer eine Assertion abschwaecht, ohne das dort zu erklaeren, hat die Phase verfehlt.
5. npm run test:gates - Zahl in gatesRedCount (Baseline 3).
6. Mutationsprobe: adminMw testweise aus einer Kette entfernen -> GENAU der Nicht-Admin-403-Test wird rot. Zusaetzlich: die "nicht mounten"-Bedingung testweise auf "immer mounten" drehen -> der 404-Test wird rot. Beide Mutationen ZURUECKNEHMEN und npm test erneut gruen fahren. Der finale Diff darf keine Mutation tragen.
7. node_modules-Symlink NICHT committen. Nach dem Lauf pruefen: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen -> testsPass=false + deviations, nicht schoenen. adminOperationalNote ist keine Floskel: sag, was der Owner konkret pruefen muss.`,
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
    allSixRoutesGuarded: {
      type: "boolean",
      description: "webAuthMw UND adminMw stehen vor allen sechs - selbst am Routengraph nachgerechnet",
    },
    notMountedWithoutMiddleware: {
      type: "boolean",
      description:
        "Ohne die Middlewares sind die sechs Routen NICHT gemountet (404) - per Test belegt, nicht behauptet. Ein ungeschuetzter Mount ist ein BLOCKER.",
    },
    adminStageEnforced: {
      type: "boolean",
      description: "Eine Nicht-Admin-Session bekommt 403, nicht Erfolg - selbst nachgerechnet",
    },
    answeringLayerPinned: {
      type: "boolean",
      description: "Ein Test pinnt, welche Schicht dem anonymen externen Aufrufer antwortet",
    },
    probeTableConsistent: {
      type: "boolean",
      description: "scripts/probe-auth.sh passt zur gewaehlten Mount-Position",
    },
    policyUpdatedConsistently: {
      type: "boolean",
      description: "GATE_ONLY_ROUTES enthaelt danach NUR noch das Legacy-Checkout-Paar",
    },
    p5WorkUntouched: {
      type: "boolean",
      description: "src/wiring/internal-only.js und die sieben P5-Routen sind unveraendert",
    },
    safetyGatesIntact: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    existingAssertionsNotWeakened: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "allSixRoutesGuarded",
    "notMountedWithoutMiddleware",
    "adminStageEnforced",
    "answeringLayerPinned",
    "probeTableConsistent",
    "policyUpdatedConsistently",
    "p5WorkUntouched",
    "safetyGatesIntact",
    "disclosureIntact",
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase sichert die Routen, die NUMMERN KAUFEN und VERBRAUCH AN STRIPE SCHICKEN - eine ungeschuetzte davon kostet echtes Geld. Pruefe entsprechend hart.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen.
4. git diff ${BASE}...${target} (DREI Punkte, gegen die Merge-Basis - sonst siehst du fremde Arbeit als Loeschung) gegen die absoluten Regeln pruefen.
${P6_SCOPE}
PRUEFE BESONDERS, jeweils selbst am Code nachgerechnet:
- notMountedWithoutMiddleware: DAS IST DER WICHTIGSTE PUNKT. Nimm an, guardedBoot verschluckt den Web-Login-Block (er ist fail-open - das ist kein hypothetischer Fall, sondern der dokumentierte Ausfallmodus). Sind die sechs Routen dann NICHT gemountet, oder sind sie ohne Sicherung gemountet? Verfolge den Code selbst. Ein ungeschuetzter Mount in diesem Fall ist ein BLOCKER - er waere genau die offene Tuer, die niemandem auffaellt.
- allSixRoutesGuarded + adminStageEnforced: bau oder lies den Routengraph. Steht vor jeder der sechs webAuthMw UND adminMw, in dieser Reihenfolge? Eine Route mit nur webAuthMw ist ein BLOCKER (jeder eingeloggte Tenant koennte plattformweite Zahlen lesen oder Nummern kaufen).
- answeringLayerPinned + probeTableConsistent: lies die Mount-Position im Code und die sechs Zeilen in scripts/probe-auth.sh. Stimmen sie ueberein? Gibt es einen Test, der die antwortende Schicht pinnt? Ohne ihn faellt die Probe beim naechsten Deploy rot aus und niemand weiss, ob das ein Defekt ist - das ist mindestens eine concern.
- policyUpdatedConsistently: enthaelt GATE_ONLY_ROUTES danach NUR noch setup-checkout und checkout-return? Mehr ist ein Fehler, weniger auch.
- p5WorkUntouched: git diff auf src/wiring/internal-only.js und die sieben P5-Routen. Jede Aenderung dort ist scope-fremd.
- existingAssertionsNotWeakened: git diff auf test/ genau lesen. Jede geaenderte Assertion braucht eine Begruendung.
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
2. git diff ${BASE}...${target} (DREI Punkte, gegen die Merge-Basis); neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID - Datei - Verstoss - Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
Achte besonders auf: (a) die Bedingung "Middlewares vorhanden" darf nicht sechsmal dastehen - EINE benannte Stelle (G5/S2); (b) die Verdrahtung gehoert an die Kompositionswurzel, nicht in den Fachcode (P15) - wurde eine zweite Konstruktionsstelle fuer webAuthMw/adminMw geschaffen? Das waere S2; (c) Namen: sagt der Name der neuen Verdrahtungs-Stelle, WARUM sie existiert (N1/N2)? (d) keine neuen Magic Strings fuer Rollen (G25); (e) die neuen Tests: ein Konzept pro Test (P14), Build-Operate-Check (P13), kein geteilter veraenderlicher Zustand zwischen Tests (P12/I) - besonders bei Sessions, die mehrere Tests brauchen.
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
3. Behebe DIESE Blocker, fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${P6_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test gruen. Dateien EINZELN adden (nie git add -A), kein git stash. node_modules NICHT committen. git commit -m "fix(auth-p6): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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

// ---------- Phase 5: Prozessbericht ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe den Bericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
EHRLICHKEITSREGEL: dieser Bericht darf KEINEN Gewinn behaupten, der nicht belegt ist. Der wichtigste Abschnitt ist eine BETRIEBSNOTIZ VOR DEM DEPLOY: ueber welchen Mechanismus gilt der Owner-Account als Admin (account.role in der Produktions-DB ODER ADMIN_EMAILS in der Render-Env)? Wenn das nicht am Code UND an der Betriebsrealitaet geklaert ist, sperrt der Deploy den Owner aus dem Onboarding aus - schreib das als ausdrueckliche Handlungsanweisung, nicht als Fussnote.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; Commit-Hash; die sechs Routen mit Beleg; die Verdrahtung (wie die Middlewares an die Routen kommen, ohne zweite Konstruktionsstelle); die Mount-Positions-Entscheidung samt antwortender Schicht; ob und warum die Probe-Tabelle geaendert wurde; der 404-Nachweis fuer den Fall ohne Middlewares; die Tests mit Assertions; die Mutationsproben; angepasste Bestandstests mit Begruendung; die Admin-Betriebsnotiz; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden; ein Abschnitt "Was diese Phase NICHT belegt". Quelle:
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
  gatesRedCount: (impl && impl.gatesRedCount) ?? null,
  sixRoutesCovered: (impl && impl.sixRoutesCovered) || "",
  notMountedWithoutMiddleware: (impl && impl.notMountedWithoutMiddleware) || "",
  mountPositionDecision: (impl && impl.mountPositionDecision) || "",
  probeTableChange: (impl && impl.probeTableChange) || "",
  adminOperationalNote: (impl && impl.adminOperationalNote) || "",
  gateOnlyRemaining: (impl && impl.gateOnlyRemaining) || "",
  mutationProbeResult: (impl && impl.mutationProbeResult) || "",
  existingTestsAdjusted: (impl && impl.existingTestsAdjusted) || [],
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
