// WIEDERAUFNAHME-WORKFLOW fuer eine Phase, deren Implementierung BEREITS COMMITTET ist.
//
// Anlass: der Rechner ist mitten in Welle 1 der Gates-Fix-Kette abgestuerzt. Drei Phasen
// (P2, P3, P6) hatten ihren Impl-Commit schon im Branch, nur Review/Self-Fix starben mit
// dem Lauf. Ein voller phase-impl-lean-Neulauf wuerde Plan + Implementierung ein zweites
// Mal bezahlen und den vorhandenen Commit wegwerfen.
//
// Unterschied zu phase-impl-lean.js: KEIN Plan-, KEIN Impl-Agent. Der Workflow beginnt beim
// dualen Review des uebergebenen Branches und faehrt von dort die bekannte Self-Fix-Schleife.
//
// Zusaetzlich gegenueber phase-impl-lean: der Safety-Reviewer prueft die VOLLE Abnahme der
// Gates-Kette (PLAN-GATES.md Abschnitt 6) - Gates gruen, Regression gruen, Produkt-Diff nicht
// leer. Das ist die Lehre aus VOICE-12: ein Gate, das gruen wird, weil der Test umgeschrieben
// wurde, ist kein Fortschritt.
//
// AUFRUF (Lead): Workflow({ scriptPath: ".../gates-review-resume.js", args: {
//   phaseId:"GATES-P2", phaseTitle:"...", branch:"phase/gates-p2-fx-single-source",
//   baseBranch:"master", specFile:"tasks/gates-fix-chain.md", specSection:"P2",
//   gates:"test/fx-single-source*.test.js :54 und :63", maxFixRounds:2, highStakes:true } })

export const meta = {
  name: "gates-review-resume",
  description:
    "Wiederaufnahme einer Phase mit vorhandenem Impl-Commit: dualer Review -> Self-Fix bis PASS -> Report. Kein Plan, keine Neu-Implementierung.",
  phases: [
    { title: "Review", detail: "Safety/Abnahme + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Detailbericht in tasks/<phase>-report.md" },
  ],
};

const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : ".";
const NODE_MODULES = `${REPO}/node_modules`;

const _argsObj =
  typeof args === "string"
    ? (() => {
        try {
          return JSON.parse(args);
        } catch {
          return null;
        }
      })()
    : args;
// FAIL-CLOSED: ohne phaseId UND branch gibt es nichts zu reviewen - kein Default-Ziel.
const A =
  typeof _argsObj === "object" && _argsObj && _argsObj.phaseId && _argsObj.branch
    ? _argsObj
    : null;
if (!A) {
  throw new Error(
    "gates-review-resume: args.phaseId und args.branch sind Pflicht -> fail-closed Abbruch.",
  );
}

const PHASE = A.phaseId;
const PHASE_TITLE = A.phaseTitle || "";
const BRANCH = A.branch;
const BASE = A.baseBranch || "master";
const SPEC_FILE = A.specFile || "tasks/gates-fix-chain.md";
const SPEC_SECTION = A.specSection || PHASE;
const GATES = A.gates || "(in der Spec genannt)";
const MAX_FIX_ROUNDS = Number.isInteger(A.maxFixRounds) ? A.maxFixRounds : 2;
const HIGH_STAKES = A.highStakes === true;
const REPORT_PATH = `tasks/${String(PHASE).toLowerCase()}-report.md`;

// MODELL-POLITIK (Memory [[workflow-model-policy]]): explizite Pins je agent(). Opus dort,
// wo Fehler sterben (Safety/Abnahme), Sonnet fuer Regelanwendung (Clean-Code), Fix, Report.
const SAFETY_AGENT = { model: "opus", effort: HIGH_STAKES ? "xhigh" : "high" };
const CLEANCODE_AGENT = { model: "sonnet", effort: "medium" };
const FIX_AGENT = { model: "sonnet", effort: "medium" };
const REPORT_AGENT = { model: "sonnet", effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Prueftkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante, konfigurierbares in config.js G35); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen (N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae); neues Verhalten braucht einen automatisierten Test.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (Denylist/Land/Stundenlimit/Budget/Max-Dauer/Signaturpruefung) NIE entfernen/aufweichen/per-Default umgehen. Neue Endpunkte, die Calls/SMS/Geld ausloesen, brauchen dieselben Gates.
- Disclosure-Satz (disclosureSentence, claude.js + bridge.js) bleibt fest verdrahtet, unveraendert.
- Auth fail-closed; timing-sichere Credential-Vergleiche (safeEqual).
- Secrets nur via env, nie loggen/in Responses oder MCP-Ausgaben leaken. Audio nie durch MCP.
- SCOPE: NUR diese Phase, NUR ihre Dateiliste. Keine ungefragten Extras, keine neuen npm-Dependencies.`;

// Die Abnahme der Gates-Kette (PLAN-GATES.md Abschnitt 6) - vier Punkte, alle vier hart.
const ABNAHME = `ABNAHME DER PHASE ${PHASE} (alle vier Punkte, sonst approved=false):
1. GATES GRUEN: "npm run test:gates" -> die Gates dieser Phase (${GATES}) laufen gruen. Nenne sie namentlich in gatesEvidence (Testname + Ergebnis).
2. REGRESSION: "npm test" laeuft vollstaendig -> Ziel 3295 bestanden / 0 rot. Abweichungen mit Zahl melden (regressionSummary). Ein NEU roter Bestandstest ist ein Blocker.
3. PRODUKT-DIFF: "git diff --name-only ${BASE}..${BRANCH} -- src/ public/ apps/ render.yaml" ist NICHT leer. Ein Diff, der nur test/ beruehrt, ist ein FEHLSCHLAG der Phase, kein Erfolg (Praezedenzfall VOICE-12: ein Gate wurde lautlos zur Bestaetigung des Defekts umgeschrieben, beide Reviews gaben es frei).
4. TESTAENDERUNGEN: Die Spec nennt je Phase abschliessend, welche Testaenderung zulaessig ist. Jede darueber hinausgehende Aenderung an test/ - und JEDER heute gruene Test, der faellt oder umgeschrieben wurde - ist ein BLOCKER, kein Befund zum Anpassen.`;

const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    gatesGreen: { type: "boolean", description: "Abnahme 1: die Gates der Phase sind gruen" },
    gatesEvidence: { type: "string", description: "Testnamen + beobachtetes Ergebnis, kurz" },
    testsPassIndependently: { type: "boolean", description: "Abnahme 2: npm test gruen" },
    regressionSummary: { type: "string", description: "bestanden/rot als Zahlen" },
    productDiffNonEmpty: { type: "boolean", description: "Abnahme 3" },
    productDiffFiles: { type: "array", items: { type: "string" } },
    testChangesAllowed: { type: "boolean", description: "Abnahme 4" },
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
    "gatesGreen",
    "gatesEvidence",
    "testsPassIndependently",
    "regressionSummary",
    "productDiffNonEmpty",
    "testChangesAllowed",
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
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Phase ${PHASE} ${PHASE_TITLE}, Branch "${target}", Basis "${BASE}".
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. Lies "${REPO}/${SPEC_FILE}", Abschnitt "${SPEC_SECTION}" - das ist die AUTORITATIVE Definition von Scope, Invarianten und zulaessigen Testaenderungen dieser Phase. Lies auch die Regeln am Dokumentanfang, die fuer JEDE Phase gelten.
4. Fahre die Abnahme SELBST (nicht dem Bericht glauben, eigene Kommandos):
${ABNAHME}
5. Pruefe "git diff ${BASE} ${target}" gegen die absoluten Regeln und gegen die Invarianten der Spec.
PRUEFE ausserdem: scopeRespected (nur die Dateiliste dieser Phase, keine Extras, kein ungefragter npm-Dep), safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, behaviorAsIntended (die Spec-Invarianten halten; wo die Phase eine neue Sperre baut, ist auch der glueckliche Pfad noch erlaubt).
${ABS_RULES}
WICHTIG: ein roter Test ist eine Behauptung, kein Beweis - aber ein Gate, das durch eine Testaenderung gruen wurde, ist ein Blocker. approved=true NUR wenn ALLE vier Abnahmepunkte erfuellt sind UND die absoluten Regeln halten. Im Zweifel blockieren. Deine Rueckgabe IST das Urteil.`,
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
log(`${PHASE}: Wiederaufnahme des vorhandenen Impl-Commits auf ${BRANCH} (kein Neubau).`);
let reviewTarget = BRANCH;
let [safety, cc] = await runReview(reviewTarget, "");

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
    `Du behebst die REVIEW-BLOCKER der Phase ${PHASE} ${PHASE_TITLE} in einem frischen Worktree. NUR die Blocker fixen, kein Scope-Drift.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${fixBranch} ${reviewTarget}
3. Lies "${REPO}/${SPEC_FILE}", Abschnitt "${SPEC_SECTION}" (autoritative Spec inkl. der abschliessenden Liste zulaessiger Testaenderungen - was dort nicht steht, darfst du an test/ NICHT anfassen).
4. Behebe DIESE Blocker sauber und minimal; fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${CLEAN_CODE_REQ}
${ABS_RULES}
5. node --check auf jede geaenderte .js-Datei; "npm run test:gates" (die Gates der Phase gruen) UND "npm test" (Regression, Ziel 3295/0) gruen. node_modules NICHT committen. git add (nur betroffene Dateien, KEIN git add -A) && git commit -m "fix(${String(PHASE).toLowerCase()}): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
EHRLICH: was du NICHT loesen konntest, in summary nennen. Ein Blocker, den du fuer falsch haeltst, wird BEGRUENDET zurueckgewiesen - nicht durch eine Testaenderung stillgelegt.`,
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
  // Stirbt der Fix-Agent (API-Fehler/Abbruch), existiert ${fixBranch} nicht. Die Schleife
  // wuerde sonst einen Phantom-Branch reviewen und die letzte Runde an einem Nicht-Befund
  // verbrennen (beobachtet 2026-07-25 in P5).
  if (!fix || !fix.committed || !fix.headCommit) {
    fixSummaries.push(
      `r${round}: ABBRUCH - kein Commit vom Fix-Agenten (Branch ${fixBranch} existiert nicht). Blocker der vorigen Review-Runde bleiben stehen.`,
    );
    break;
  }
  reviewTarget = fixBranch;
  [safety, cc] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc);

phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe einen Detailbericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; Hinweis, dass die Implementierung aus dem am 2026-07-27 abgestuerzten Lauf stammt und dieser Workflow nur Review + Self-Fix nachgeholt hat; Abnahme (Gates/Regression/Produkt-Diff/Testaenderungen) mit den Belegen des Safety-Reviews; Clean-Code-Audit (s1-s4); Fix-Runden. Quelle:
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
  gatesGreen: (safety && safety.gatesGreen) || false,
  gatesEvidence: (safety && safety.gatesEvidence) || "",
  regressionSummary: (safety && safety.regressionSummary) || "",
  productDiffNonEmpty: (safety && safety.productDiffNonEmpty) || false,
  productDiffFiles: (safety && safety.productDiffFiles) || [],
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
};
