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
// GEPINNT (MCP-UI P1): Phase hart inline, KEINE args-Abhaengigkeit
// (Memory phase-impl-workflow-args: args erreichen das Skript nicht zuverlaessig).
// Aufruf: Workflow({ scriptPath: ".claude/workflows/mcp-ui-p1.js" }) - kein args, kein resume.
// Der Lead merged danach den ZURUECKGEGEBENEN finalBranch (kann BRANCH oder BRANCH-fixN sein).

export const meta = {
  name: "mcp-ui-p1",
  description:
    "MCP Rich-UI P1: duenne vertikale Scheibe (get_call_status Stufe0+Stufe1 ui://, UiRenderer-Seam + fail-closed Fallback). Gepinnt, Lean: Plan->Impl->dualer Review->Self-Fix bis PASS->Report.",
  phases: [
    {
      title: "Plan",
      detail:
        "Code-gegroundeter Umsetzungsplan (clean-code.md + Strategie-Doc + P1-Spec + echter Code)",
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

// Spawn-fest: im ACP-/Spawn-Kontext gibt es kein process-Global. Dann faellt REPO
// auf '.' zurueck (Spawn-cwd ist der Worktree-Root, relative Pfade greifen korrekt).
const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : ".";
const NODE_MODULES = `${REPO}/node_modules`;

// GEPINNT (MCP-UI P1): Phase hart inline, KEINE args-Abhaengigkeit.
const A = {
  "phaseId": "P1",
  "phaseTitle": "MCP Rich-UI duenne Scheibe (get_call_status, UiRenderer-Seam + Fallback)",
  "branch": "phase/mcp-ui-p1-slice",
  "baseBranch": "master",
  "planDoc": "docs/mcp-ui-strategy.md",
  "specFile": "tasks/mcp-ui-p1-spec.md",
  "maxFixRounds": 2
};

const PHASE = A.phaseId;
const PHASE_TITLE = A.phaseTitle || "";
const BRANCH = A.branch || `phase/${String(PHASE).toLowerCase()}-impl`;
const BASE = A.baseBranch || "master";
const PLAN_DOC = A.planDoc || "docs/mcp-ui-strategy.md";
const SPEC_FILE = A.specFile || "";
const MAX_FIX_ROUNDS = Number.isInteger(A.maxFixRounds) ? A.maxFixRounds : 2;
const REPORT_PATH = `tasks/mcp-ui-${String(PHASE).toLowerCase()}-report.md`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Prueftkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, gemeinsame Logik extrahieren); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante, in config.js wenn konfigurierbar G35); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen, Nebeneffekte im Namen sichtbar (N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1, sonst Objekt); Lazy-Init-Antipattern vermeiden (P15); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae); neues Verhalten braucht einen automatisierten Test (P11/T-Serie), reiner Refactor laesst die Bestandssuite OHNE Test-Aenderung gruen.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md + MCP-UI-Strategie-Doc Abschnitt 5):
- Safety-Gates (numberGateError: Denylist/Allowlist/Land/Stundenlimit/Budget/Max-Dauer + Provider-Signaturpruefung) NIE entfernen/aufweichen/per-Default umgehen. P1 ist read-only und beruehrt den Call-Pfad NICHT.
- Disclosure-Satz (disclosureSentence, claude.js + bridge.js) bleibt fest verdrahtet, unveraendert.
- Auth fail-closed: /mcp bleibt hinter mcpAuth; KEIN neuer offener Endpunkt; stateless-Cleanup (res.on('close')) unberuehrt. Unbekannter/nicht-faehiger Host -> KEINE ui://-Resource (fail-closed Stufe 0).
- Secrets nur via env, nie loggen/in structuredContent/Widget/MCP-Ausgaben leaken. Fehlertexte generisch/provider-frei. Audio nie durch MCP -> nie ins Widget.
- DATEN-KONTRAKT (Whitelist, P1-Spec Abschnitt 5): NUR call_id/status/duration_s/last_transcript_lines ins structuredContent + Widget. Filter sitzt VOR Text UND Resource (eine Stelle), NACH der Tenant-Aufloesung. Keine fremden Tenant-Daten, keine Klartext-Identitaet/email.
- SCOPE: NUR P1 (EIN Tool get_call_status, EIN MCP-nativer Adapter). KEIN Callback/Schreib-Widget (P4), KEIN zweiter Host-Adapter (P3), KEINE weiteren Widgets (P2). KEIN neuer npm-Dep (Owner-Entscheidung Option A: Vertrag schlank ohne @modelcontextprotocol/ext-apps nachbilden ueber das vorhandene @modelcontextprotocol/sdk).`;

const specInstruction = SPEC_FILE
  ? `Lies "${REPO}/${SPEC_FILE}" KOMPLETT - das ist die AUTORITATIVE Scope-/Design-/Invarianten-/Akzeptanzkriterien-Definition dieser Phase (verbindlich vor dem Plan-Doc). Beachte besonders den P0-Befund-Block (realer SEP-1865-Vertrag: mimeType "text/html;profile=mcp-app", _meta.ui.resourceUri, Capability io.modelcontextprotocol/ui, resource-template-Einbettung statt Content-Block) und AC1-AC8.`
  : `(Keine specFile uebergeben - nutze ausschliesslich ${PLAN_DOC}.)`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. Lies "${REPO}/${PLAN_DOC}" als Umbrella-Kontext (Zwei-Stufen-Modell, Seam-Architektur Abschnitt 3, Pre-Mortem Abschnitt 6) und "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}": src/mcp-tools.js (get_call_status-Handler + requireFields-Guard), src/server.js (MCP-Registrierung/mcpAuth/initialize), src/mcp-server.js (stdio), src/telephony/{ports.js,registry.js} als Seam-Vorbild (DIP), design-system/mcp/call-status.html (Widget-Entwurf) + design-system/_shared/tokens.css (Tokens, self-contained). Grep gezielt nach den relevanten Symbolen/Call-Sites - KEINE Zeilennummern uebernehmen (sie rotten).
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) neue Dateien (UiRenderer-Port + Registry + EIN MCP-nativer Adapter, analog src/telephony/) inkl. Funktionssignaturen + Inhalts-Skizze; (2) pro bestehender Datei die exakten Edits (Vorher/Nachher) - get_call_status: outputSchema ueber die Whitelist, structuredContent, Whitelist-Filter VOR Text+Resource, Capability-Gate fuer die ui://-Resource; (3) das gebuendelte/inline self-contained Widget-HTML (Tokens inline, kein @import, @dsCard-Marker); (4) neue Tests fuer AC1-AC6 (Stufe0 additiv, Stufe1 bei faehigem Host, Fallback bei nicht-faehigem/unbekanntem Host = KERN, Whitelist = SICHERHEIT, Fehlerpfad, self-contained); (5) das deterministisch pruefbare Ergebnis (Befehl + erwartete Ausgabe). Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan" },
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
5. npm test (beide Backends: json-Default + pglite-in-process). Bestandstests nur bei bewusster Verhaltens-/Signatur-Aenderung anpassen (im Plan begruendet); neues Verhalten -> neuer Test. Stufe 0 ist ADDITIV: der heutige {type:'text'}-Pfad bleibt erhalten (Legacy/stdio byte-kompatibel).
6. Smoke (best-effort): Server auf freiem Port mit SKIP_TWILIO_SIGNATURE_CHECK=true + Dummy-Env, get_call_status via MCP/curl; faehiger vs. nicht-faehiger Host ueber den Capability-Hinweis simulieren; zu flaky -> smokePass=false + Grund (kein Blocker).
7. node_modules-Symlink NICHT committen. git add (nur die betroffenen src/test/design-system/doc-Dateien) && git commit. headCommit = git rev-parse HEAD.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen / blockiert -> testsPass=false + deviations, nicht schoenen.`,
  {
    label: `${PHASE}-implement`,
    phase: "Implementieren",
    schema: IMPL_SCHEMA,
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
    scopeRespected: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    authFailClosedIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    whitelistEnforced: { type: "boolean" },
    fallbackFailClosed: { type: "boolean" },
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
    "whitelistEnforced",
    "fallbackFailClosed",
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} (MCP Rich-UI, read-only) auf Branch "${target}".
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-mcp-ui-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst (beide Backends) -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln + die P1-Akzeptanzkriterien pruefen.
PRUEFE: scopeRespected (nur P1, EIN Tool, kein Callback/2.-Host/weitere-Widgets, KEIN neuer npm-Dep), safetyGatesIntact + disclosureIntact (Call-Pfad unberuehrt), authFailClosedIntact (/mcp hinter mcpAuth, kein neuer offener Endpunkt, res.on('close')-Cleanup), noSecretsLeaked (keine Keys/Provider-Interna/email in structuredContent/Widget/Log), whitelistEnforced (NUR call_id/status/duration_s/last_transcript_lines; ein Test beweist, dass nicht-gewhitelistete Felder fehlen), fallbackFailClosed (nicht-faehiger/unbekannter Host -> KEINE ui://-Resource, Stufe 0 vollstaendig; getestet), behaviorAsIntended (Stufe 0 additiv/byte-kompatibel zum heutigen Text).
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine Tests gruen. Im Zweifel blockieren. Rueckgabe IST das Urteil.`,
        {
          label: `${PHASE}-review-safety${suffix}`,
          phase: "Review",
          schema: SAFETY_SCHEMA,
          isolation: "worktree",
        },
      ),
    () =>
      agent(
        `CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${target}", Basis "${BASE}") streng gegen den Katalog.
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG (definiert S1-S4 + Audit-Regeln: nur gesehenen Code bewerten, nicht raten).
2. git diff ${BASE} ${target} ; neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt. Achte auf: Seam-Sauberkeit (Port/Registry/Adapter analog telephony, kein BDUF/Plugin-Maschinerie), eine Filter-Stelle (keine doppelte Whitelist), self-contained Widget (kein @import/Linkback).
blocker=true wenn s1 ODER s2 nicht leer. passNotes: was sauber ist. topTodos: 1-3 wichtigste. Erfinde nichts.`,
        {
          label: `${PHASE}-review-cleancode${suffix}`,
          phase: "Review",
          schema: CC_SCHEMA,
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
4. node --check + npm test (beide Backends) gruen. node_modules NICHT committen. git add (betroffene Dateien) && git commit -m "fix(mcp-ui-${String(PHASE).toLowerCase()}): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
EHRLICH: was du NICHT loesen konntest, in summary nennen.`,
    {
      label: `${PHASE}-fix-r${round}`,
      phase: "Self-Fix",
      schema: FIX_SCHEMA,
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
    { label: `${PHASE}-report`, phase: "Report" },
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
