// LOKALE F2-Adaption von .claude/workflows/phase-impl-lean.js.
// EINZIGE Abweichung: REPO/NODE_MODULES kommen aus args.repo statt aus
// process.cwd()/process.env - der Workflow-Sandbox-Runtime hat KEIN `process`-Global
// ("process is not defined"). Sonst byte-identische Logik (Plan -> Impl(Worktree) ->
// dualer Review -> Self-Fix bis PASS -> kompakter Return + Report-Datei).

export const meta = {
  name: 'phase-impl-lean-local',
  description: 'Schlankes selbst-fixendes Phasen-Workflow (F2-Adaption, repo via args): Plan -> Impl (Worktree) -> dualer Review -> Self-Fix bis PASS -> kompakter Return + Report-Datei.',
  phases: [
    { title: 'Plan', detail: 'Code-gegroundeter Umsetzungsplan (clean-code.md + Plan-Doku + specFile + echter Code)' },
    { title: 'Implementieren', detail: 'Umsetzung im Worktree, npm test gruen, commit' },
    { title: 'Review', detail: 'Safety/Verhalten + Clean-Code-Auditor (parallel)' },
    { title: 'Self-Fix', detail: 'S1/S2/Safety-Blocker fixen + Re-Review, bis PASS oder maxFixRounds' },
    { title: 'Report', detail: 'Detailbericht in tasks/<phase>-report.md (Lead liest ihn nicht)' },
  ],
}

// FAIL-CLOSED: keine Phase ohne explizite args.phaseId. Verhindert den I2-Unfall.
// args kann als Objekt ODER als JSON-String ankommen (Runtime deserialisiert nicht
// immer) -> tolerant normalisieren.
let A0 = args
if (typeof A0 === 'string') {
  try { A0 = JSON.parse(A0) } catch (_e) { /* bleibt String -> faellt unten durch */ }
}
const A = (typeof A0 === 'object' && A0 && A0.phaseId) ? A0 : null
if (!A) {
  throw new Error(`phase-impl-lean-local: args.phaseId fehlt -> fail-closed Abbruch. typeof args=${typeof args}; preview=${String(args).slice(0, 200)}`)
}

const REPO = A.repo || "/srv/openclaw/projects/vodafone-agent-wt/jonas-github"
const NODE_MODULES = `${REPO}/node_modules`

const PHASE = A.phaseId
const PHASE_TITLE = A.phaseTitle || ''
const BRANCH = A.branch || `phase/${String(PHASE).toLowerCase()}-impl`
const BASE = A.baseBranch || 'master'
const PLAN_DOC = A.planDoc || "PLAN-MULTI-TENANT-TELNYX.md"
const SPEC_FILE = A.specFile || ''
const MAX_FIX_ROUNDS = Number.isInteger(A.maxFixRounds) ? A.maxFixRounds : 2
const REPORT_PATH = `tasks/${String(PHASE).toLowerCase()}-report.md`

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Prueftkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, gemeinsame Logik extrahieren); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante, in config.js wenn konfigurierbar G35); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen, Nebeneffekte im Namen sichtbar (N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1, sonst Objekt); Lazy-Init-Antipattern vermeiden (P15); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae); neues Verhalten braucht einen automatisierten Test (P11/T-Serie), reiner Refactor laesst die Bestandssuite OHNE Test-Aenderung gruen.`

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (numberGateError: Denylist/Allowlist/Land/Stundenlimit/Budget/Max-Dauer) NIE entfernen/aufweichen/per-Default umgehen. Neue Endpunkte, die Calls/SMS/Geld ausloesen, brauchen dieselben Gates.
- Disclosure-Satz (disclosureSentence, claude.js + bridge.js) bleibt fest verdrahtet, unveraendert.
- Auth fail-closed: Twilio-Signaturpruefung (/voice), Basic-Auth (Dashboard/API), MCP-Auth - timing-sichere Vergleiche (safeEqual). Neue Endpunkte standardmaessig hinter Auth.
- Secrets nur via env, nie loggen/in Responses oder MCP-Ausgaben leaken. Audio nie durch MCP.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies ohne explizite Freigabe in der Spec.`

const specInstruction = SPEC_FILE
  ? `Lies "${REPO}/${SPEC_FILE}" und finde den Abschnitt fuer ${PHASE} - das ist die AUTORITATIVE Scope-/Design-/Invarianten-/Abgrenzungs-Definition dieser Phase (verbindlich vor dem Plan-Doc).`
  : `(Keine specFile uebergeben - nutze ausschliesslich ${PLAN_DOC}.)`

// ---------- Phase 1: Plan ----------
phase('Plan')
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. Lies "${REPO}/${PLAN_DOC}" als Umbrella-Kontext und "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}" (Arbeitsbaum bzw. git show ${BASE}:<pfad>). Grep gezielt nach den relevanten Symbolen/Call-Sites - KEINE Zeilennummern uebernehmen (sie rotten).
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) neue Dateien inkl. Funktionssignaturen + Inhalts-Skizze; (2) pro bestehender Datei die exakten Edits (Vorher/Nachher); (3) neue/angepasste Tests (oder Begruendung, warum die Bestandssuite reicht); (4) das deterministisch pruefbare Ergebnis (Befehl + erwartete Ausgabe). Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: 'Plan' }
)

// ---------- Phase 2: Implementieren (Worktree) ----------
phase('Implementieren')
const IMPL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    headCommit: { type: 'string', description: 'git rev-parse HEAD nach dem Commit' },
    filesCreated: { type: 'array', items: { type: 'string' } },
    filesEdited: { type: 'array', items: { type: 'string' } },
    testsAddedOrChanged: { type: 'array', items: { type: 'string' } },
    nodeCheckPass: { type: 'boolean' },
    testsPass: { type: 'boolean' },
    testPassCount: { type: 'number' },
    testFailCount: { type: 'number' },
    smokePass: { type: 'boolean' },
    smokeNote: { type: 'string' },
    cleanCodeSelfCheck: { type: 'string' },
    committed: { type: 'boolean' },
    deviations: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['headCommit', 'nodeCheckPass', 'testsPass', 'testPassCount', 'testFailCount', 'committed', 'summary'],
}
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert; Working-Tree des Nutzers NICHT anfassen). Setze Phase ${PHASE} ${PHASE_TITLE} GENAU gemaess Plan um:
=== PLAN ===
${plan || '(Plan fehlt - brich ab, melde es in deviations)'}
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
  { label: `${PHASE}-implement`, phase: 'Implementieren', schema: IMPL_SCHEMA, isolation: 'worktree' }
)

// ---------- Phase 3: Dualer Review (parallel, wiederholbar) ----------
const SAFETY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    testsPassIndependently: { type: 'boolean' },
    independentTestSummary: { type: 'string' },
    scopeRespected: { type: 'boolean' },
    safetyGatesIntact: { type: 'boolean' },
    disclosureIntact: { type: 'boolean' },
    authFailClosedIntact: { type: 'boolean' },
    noSecretsLeaked: { type: 'boolean' },
    behaviorAsIntended: { type: 'boolean' },
    approved: { type: 'boolean' },
    blockers: { type: 'array', items: { type: 'string' } },
    concerns: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string' },
  },
  required: ['approved', 'testsPassIndependently', 'safetyGatesIntact', 'disclosureIntact', 'blockers', 'verdict'],
}
const CC_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    s1: { type: 'array', items: { type: 'string' }, description: 'Tests/Sicherheit/Korrektheit - "ID · Datei · Verstoss · Fix"' },
    s2: { type: 'array', items: { type: 'string' }, description: 'Duplizierung' },
    s3: { type: 'array', items: { type: 'string' } },
    s4: { type: 'array', items: { type: 'string' } },
    blocker: { type: 'boolean', description: 'true wenn s1 oder s2 nicht leer' },
    passNotes: { type: 'string' },
    topTodos: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string' },
  },
  required: ['s1', 's2', 's3', 's4', 'blocker', 'verdict'],
}

async function runReview(target, suffix) {
  return await parallel([
    () => agent(
      `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}".
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst (beide Backends) -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
PRUEFE: scopeRespected (nur ${PHASE}, keine Extras, kein ungefragter npm-Dep), safetyGatesIntact, disclosureIntact (claude.js+bridge.js), authFailClosedIntact, noSecretsLeaked, behaviorAsIntended (flag-off byte-identisch, Invarianten wie in der Spec).
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine Tests gruen. Im Zweifel blockieren. Rueckgabe IST das Urteil.`,
      { label: `${PHASE}-review-safety${suffix}`, phase: 'Review', schema: SAFETY_SCHEMA, isolation: 'worktree' }
    ),
    () => agent(
      `CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${target}", Basis "${BASE}") streng gegen den Katalog.
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG (definiert S1-S4 + Audit-Regeln: nur gesehenen Code bewerten, nicht raten).
2. git diff ${BASE} ${target} ; neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
blocker=true wenn s1 ODER s2 nicht leer. passNotes: was sauber ist. topTodos: 1-3 wichtigste. Erfinde nichts.`,
      { label: `${PHASE}-review-cleancode${suffix}`, phase: 'Review', schema: CC_SCHEMA, isolation: 'worktree' }
    ),
  ])
}

const gateOk = (s, c) => !!(s && s.approved && c && !c.blocker)
const blockerList = (s, c) => [
  ...((s && s.blockers) || []),
  ...((c && c.s1) || []),
  ...((c && c.s2) || []),
]

phase('Review')
let reviewTarget = BRANCH
let [safety, cc] = await runReview(reviewTarget, '')

// ---------- Phase 4: Self-Fix-Loop ----------
const FIX_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    headCommit: { type: 'string' },
    addressed: { type: 'array', items: { type: 'string' } },
    filesTouched: { type: 'array', items: { type: 'string' } },
    testsPass: { type: 'boolean' },
    testPassCount: { type: 'number' },
    testFailCount: { type: 'number' },
    committed: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['headCommit', 'testsPass', 'committed', 'summary'],
}
let round = 0
const fixSummaries = []
while (!gateOk(safety, cc) && round < MAX_FIX_ROUNDS) {
  round++
  phase('Self-Fix')
  const fixBranch = `${BRANCH}-fix${round}`
  const blockers = blockerList(safety, cc)
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
    { label: `${PHASE}-fix-r${round}`, phase: 'Self-Fix', schema: FIX_SCHEMA, isolation: 'worktree' }
  )
  fixSummaries.push(`r${round}: ${(fix && fix.summary) ? fix.summary.slice(0, 300) : '(kein Ergebnis)'}`)
  reviewTarget = fixBranch
  ;[safety, cc] = await runReview(reviewTarget, `-r${round}`)
}

const approved = gateOk(safety, cc)

// ---------- Phase 5: Report-Datei (Lead liest sie NICHT) ----------
phase('Report')
let reportPath = ''
try {
  const reportAgent = await agent(
    `Schreibe einen Detailbericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree; lege tasks/ an, falls noetig). NICHTS am Code aendern, KEIN git-Commit.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? 'PASS' : 'BLOCKED'}; finalBranch=${reviewTarget}; Plan (gekuerzt); Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden. Quelle:
=== PLAN ===
${plan || ''}
=== IMPL ===
${JSON.stringify(impl, null, 1)}
=== SAFETY (final) ===
${JSON.stringify(safety, null, 1)}
=== CLEANCODE (final) ===
${JSON.stringify(cc, null, 1)}
=== FIXES ===
${fixSummaries.join('\n')}
Antworte NUR mit dem geschriebenen Dateipfad.`,
    { label: `${PHASE}-report`, phase: 'Report' }
  )
  reportPath = (reportAgent || '').toString().trim().slice(0, 300) || REPORT_PATH
} catch {
  reportPath = '(Report fehlgeschlagen)'
}

// ---------- POSTAGE-STAMP-RETURN (klein, damit der Lead duenn bleibt) ----------
return {
  phaseId: PHASE,
  finalBranch: reviewTarget,
  baseBranch: BASE,
  gate: approved ? 'PASS' : 'BLOCKED',
  approved,
  headCommit: (round > 0 ? null : (impl && impl.headCommit)) || null,
  testPassCount: (impl && impl.testPassCount) || null,
  filesTouched: [...((impl && impl.filesCreated) || []), ...((impl && impl.filesEdited) || [])].slice(0, 40),
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
  summary: (impl && impl.summary) ? impl.summary.slice(0, 600) : '',
}
