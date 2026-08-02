// PER-RUN-Skript AL-P17 (Kopie von phase-impl-lean.js, Phase HART GEPINNT).
// Siehe Memory [[phase-impl-workflow-args]]: die Phase steht hier im Skript, nicht in args.

export const meta = {
  name: "phase-impl-lean",
  description:
    "AL-P17: die erste Modellrunde hoerbar machen - Armierungsregel praezisieren (Befund D-1).",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan (clean-code.md + Spec + echter Code)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen, Smoke, commit" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/al-p17-report.md" },
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
const PHASE = "AL-P17";
const PHASE_TITLE = "Die erste Modellrunde hoerbar machen (Befund D-1)";
const BRANCH = "phase/al-p17-streaming-armierung";
const BASE = "master";
const PLAN_DOC = "PLAN-ASSISTANT-LEAP.md";
const SPEC_FILE = "tasks/al-p17-spec.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/al-p17-report.md";

const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";

// HOCHRISIKO: diese Phase aendert, WAS ein echter Mensch im Telefonat hoert, und sie
// entfernt eine Ausschliesslichkeits-Garantie (sideEffectOnlyRound), auf der zwei
// Bestandsphasen aufbauen. Impl auf opus, Safety-Review eine Stufe schaerfer.
const PLAN_AGENT = { model: MODEL_OPUS, effort: "high" };
const IMPL_AGENT = { model: MODEL_OPUS, effort: "high" };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: "xhigh" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Pruefkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, gemeinsame Logik extrahieren, EINE Quelle fuer eine Zugehoerigkeit); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante, in config.js wenn konfigurierbar G35); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen, Nebeneffekte im Namen sichtbar (N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1, sonst Objekt); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae); neues Verhalten braucht einen automatisierten Test.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (Denylist/Land/Stundenlimit/pro-Tenant-Kostendecke/Max-Dauer/Signaturpruefung/OUTBOUND_FROZEN) NIE entfernen/aufweichen/per-Default umgehen.
- Disclosure-Satz (disclosureSentence, claude.js + bridge.js) bleibt fest verdrahtet, unveraendert - er ist der ALLERERSTE Satz und darf durch das Streaming NICHT nach hinten rutschen oder zerschnitten werden. PRUEFE das aktiv.
- Auth fail-closed. Secrets nur via env, nie loggen/leaken. Audio nie durch MCP.
- Kostenbuchung: genau EIN bookTokenUsage je Modellrunde, auch im Abrissfall (completeRound). Unberuehrt lassen.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const P17_SCOPE = `SCOPE DIESER PHASE (bindend):
- Das ist eine VERHALTENS-Aenderung auf dem Sprechpfad eines laufenden Telefonats mit einem echten Menschen. Die riskanteste Phase der Kette. Im Zweifel: enger schneiden, nicht breiter.
- GENAU DREI Aenderungen (E1/E2/E3 der Spec). Nichts sonst.
- E1 bleibt eine ALLOWLIST. Eine Denylist ("sperre bei get_consult") faellt bei jedem kuenftigen Werkzeug fail-open und ist ein BLOCKER. Die Zugehoerigkeit "strom-sicher" gehoert an EINE Stelle (G5), dorthin wo heute SIDE_EFFECT_ONLY_TOOL_NAMES steht. Ein Test mit einem ERFUNDENEN, unbekannten Werkzeug muss nachweisen, dass das Streaming abschaltet.
- E2 (Doppelrede-Riegel) ist ein Korrektheitsriegel: mit E1 faellt die bisherige Ausschliesslichkeit von Streaming und Bruecke (sideEffectOnlyRound) weg. Ohne E2 spricht der Agent denselben Satz zweimal. Braucht einen Test, der OHNE den Riegel rot ist.
- E3 setzt Owner-Entscheidung O-D1-B um: der deterministische Consult-Fueller entfaellt genau dann, wenn schon gestreamt wurde. Das weicht bewusst von der AL-P14-Zusage "Haltesatz ist LLM-frei" ab - schreib das als Owner-Entscheidung in den Code-Kommentar, verstecke es nicht.
- NICHT-ZIELE: kein Prompt-Eingriff am Tool-Entscheidungspunkt (das ist D-3); der AL-D2-K4-Befund (look_up ohne fuehrenden Text) bleibt OFFEN und wird NICHT nebenbei gefixt; Bedingung 3 (roundFitsDeadline) unangetastet; KEINE neue Env-Variable, KEIN neues Flag (Rueckweg ist das bestehende TELNYX_SHIM_TOKEN_STREAMING); keine echten Anrufe.
- PRE-MORTEM-PFLICHT: der Abriss-Pfad MUSS ausdruecklich bewertet werden. Reisst die Modellrunde nach dem ersten gestreamten Satz ab, haengt der Shim-Catch (wire.finish(content)) den Degradations-Satz an bereits Gesprochenes. Das war bisher selten (armierte Runden waren selten), wird nach E1 der Normalfall. Entweder begruendet als akzeptiertes Risiko ODER entschaerft - aber NICHT uebergehen. Dasselbe fuer die Safety-Notaus-Pfade (killCallForBudget, Loop-Guard): sie muessen hoerbar bleiben.
- BESTANDSTESTS: AL-P7-20 und die AL-P7b-Tests pinnen das ALTE Armierungsverhalten. Anpassen ist erlaubt, aber JEDE Anpassung wird einzeln begruendet ("welche Zusage galt vorher, welche gilt jetzt, warum ist das die Absicht"). Eine stillschweigend abgeschwaechte Assertion ist ein BLOCKER.
- LIEFERGEGENSTAND: tasks/al-p17-diagnose.md, im Worktree geschrieben UND mitcommittet (NICHT verwechseln mit tasks/al-p17-report.md, dem Workflow-Prozessbericht). Inhalt: Draht-Reihenfolge vorher/nachher, Bewertung des Abriss-Pfads, jede angepasste Bestandsassertion mit Begruendung, Mutationsproben, was offen bleibt.`;

const specInstruction = `Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - das ist die AUTORITATIVE Definition dieser Phase (verbindlich vor dem Plan-Doc). Lies ausserdem "${REPO}/tasks/al-d2-diagnose.md" (die Messung, auf der diese Phase steht - insbesondere die Bedingungskette B1..B7 und die Reichweite-Herleitung in §3) und "${REPO}/tasks/al-p7b-workflow-report.md" (Entscheidung E3 und die Doppelsprech-Exklusivitaet, die diese Phase aufloest).`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. Lies "${REPO}/${PLAN_DOC}" als Umbrella-Kontext und "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}": streamSinkFor + SIDE_EFFECT_ONLY_TOOL_NAMES + agentTools + der Tool-Loop in agentTurn (src/claude.js), src/thinking-signal.js, src/speech-chunker.js, src/llm.js (completeStream), src/consult/in-call.js (decideConsultRequest), src/telnyx-llm-shim.js (makeStreamingResponse, wire, respond, der catch-Pfad, killCallForBudget). Grep nach Symbolen - KEINE Zeilennummern uebernehmen (sie rotten).
4. Grep nach ALLEN Callern der von dir geaenderten Funktionen. Der Tool-Loop wird von der Budget-Engine UND der Realtime-Bridge genutzt - pruefe beide Pfade.
5. Nenne im Plan ausdruecklich, WELCHE Bestandstests durch E1/E2/E3 kippen und wie du mit jedem einzelnen umgehst.
${P17_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die exakten Edits je Datei (Vorher/Nachher) fuer E1, E2, E3; (2) die neuen Tests AL-P17-* mit konkreten Assertions - insbesondere WIE der Kernbeweis die Draht-Reihenfolge zeigt (mehrere content-Deltas, erstes = erster fertiger Satz) und WIE der Doppelrede-Riegel ohne sich selbst rot ist; (3) die Liste der kippenden Bestandstests mit Begruendung je Fall; (4) deine Bewertung des Abriss-Pfads und der Safety-Notaus-Pfade aus dem Pre-Mortem; (5) die Mutationsproben je Riegel; (6) die Gliederung von tasks/al-p17-diagnose.md. Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
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
    existingTestsAdjusted: {
      type: "array",
      items: { type: "string" },
      description: "Je angepasstem Bestandstest: ID - alte Zusage - neue Zusage - Begruendung",
    },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    smokePass: { type: "boolean" },
    smokeNote: { type: "string" },
    mutationProbeResult: { type: "string" },
    wireOrderBeforeAfter: {
      type: "string",
      description:
        "Die gemessene Draht-Reihenfolge in der 18/21-Klasse: vorher (master) vs nachher",
    },
    abortPathVerdict: {
      type: "string",
      description:
        "Bewertung des Abriss-Pfads (wire.finish nach Teil-Stream) und der Safety-Notaus-Pfade: akzeptiert mit Begruendung oder entschaerft mit wie",
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
    "wireOrderBeforeAfter",
    "abortPathVerdict",
    "existingTestsAdjusted",
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
${P17_SCOPE}
${CLEAN_CODE_REQ}
4. node --check auf JEDE neue/geaenderte .js-Datei.
5. npm test. Kippende Bestandstests: jede Anpassung einzeln in existingTestsAdjusted begruenden (ID, alte Zusage, neue Zusage, warum das die Absicht ist). Wer eine Assertion abschwaecht, ohne das dort zu erklaeren, hat die Phase verfehlt.
6. npm run test:gates - die Baseline ist 3 rot (GAP-05, GAP-15 zweimal). Mehr rot = deine Aenderung, in deviations.
7. Mutationsproben je Riegel (E1, E2, E3) fahren, Ergebnis notieren, Mutation ZURUECKNEHMEN und npm test erneut gruen fahren. Der finale Diff darf keine Mutation tragen.
8. Smoke: Server auf freiem Port mit SKIP_TWILIO_SIGNATURE_CHECK=true + Dummy-Env starten, /healthz, plus ein Shim-Turn per curl mit stream:true - dass der Draht real spricht, nicht nur im Test. Zu flaky -> smokePass=false + Grund.
9. tasks/al-p17-diagnose.md schreiben (Spec-Abnahme + Bericht).
10. node_modules-Symlink NICHT committen. git add (nur die betroffenen src/test/tasks-Dateien) && git commit. headCommit = git rev-parse HEAD.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen -> testsPass=false + deviations, nicht schoenen. abortPathVerdict ist keine Floskel: entweder du hast den Pfad entschaerft (sag wie) oder du akzeptierst ihn (sag warum).`,
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
    allowlistNotDenylist: {
      type: "boolean",
      description: "E1 ist eine Allowlist; ein unbekanntes Werkzeug schaltet Streaming ab",
    },
    noDoubleSpeech: {
      type: "boolean",
      description: "Kein Pfad, auf dem derselbe Satz zweimal auf den Draht geht",
    },
    disclosureIntact: {
      type: "boolean",
      description: "Offenlegungssatz weiterhin allererster Satz, nicht zerschnitten",
    },
    existingAssertionsNotWeakened: {
      type: "boolean",
      description: "Keine Bestandsassertion stillschweigend abgeschwaecht",
    },
    safetyGatesIntact: { type: "boolean" },
    notausAudible: {
      type: "boolean",
      description: "Budget-Notaus und Loop-Guard bleiben nach Teil-Stream hoerbar",
    },
    tokenBookingIntact: { type: "boolean" },
    authFailClosedIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "allowlistNotDenylist",
    "noDoubleSpeech",
    "disclosureIntact",
    "existingAssertionsNotWeakened",
    "safetyGatesIntact",
    "notausAudible",
    "tokenBookingIntact",
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase aendert, WAS ein echter Mensch im Telefonat hoert - pruefe entsprechend hart.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
${P17_SCOPE}
PRUEFE BESONDERS, jeweils selbst am Code nachgerechnet:
- allowlistNotDenylist: fuege GEDANKLICH ein neues Werkzeug "foo_bar" zu agentTools hinzu. Armiert das Streaming dann? Wenn ja -> BLOCKER (fail-open). Es MUSS einen Test mit einem erfundenen Werkzeug geben.
- noDoubleSpeech: suche AKTIV nach einem Pfad, auf dem derselbe Satz zweimal auf den Draht geht (Streaming + speakBridge, Streaming + respond, Streaming + Consult-Fueller, Streaming + Fallback-Speech, Streaming + Degradations-Satz). Nimm den E2-Riegel testweise heraus - der zugehoerige Test MUSS rot werden. Nimm die Mutation zurueck.
- disclosureIntact: der Offenlegungssatz ist der ALLERERSTE Satz eines Outbound-Gespraechs. Kann das Streaming ihn zerschneiden, verzoegern oder hinter anderen Text schieben? Rechne es nach, glaub es nicht.
- notausAudible: nach einem Teil-Stream - hoert der Anrufer den Budget-Notaus und den Loop-Guard-Satz noch? Und den Degradations-Satz im Abrissfall?
- existingAssertionsNotWeakened: git diff auf test/ genau lesen. Jede geaenderte Assertion: ist sie im Diagnose-Bericht begruendet? Eine abgeschwaechte Assertion ohne Begruendung ist ein BLOCKER.
- tokenBookingIntact: genau EIN bookTokenUsage je Modellrunde, auch im Abrissfall.
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
Achte besonders auf: (a) die Zugehoerigkeit "strom-sicheres Werkzeug" muss an EINER Stelle stehen (G5) - zwei Listen, die konsistent gehalten werden muessen, sind S2; (b) die drei Riegel E1/E2/E3 duerfen nicht als verstreute Bedingungen im Tool-Loop landen, sondern als benannte Ausdruecke (G5/G19); (c) Testfixtures muessen die Faelle wirklich TRENNEN (gleiche Fixture-Werte testen nichts).
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
${P17_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test gruen. Aenderungen am Diagnose-Bericht tasks/al-p17-diagnose.md nachziehen, wenn dein Fix ihn betrifft. node_modules NICHT committen. git add (betroffene Dateien) && git commit -m "fix(al-p17): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
    `Schreibe einen Prozessbericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit. UEBERSCHREIBE NIEMALS tasks/al-p17-diagnose.md - das ist ein anderer Liefergegenstand.
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
  wireOrderBeforeAfter: (impl && impl.wireOrderBeforeAfter) || "",
  abortPathVerdict: (impl && impl.abortPathVerdict) || "",
  existingTestsAdjusted: (impl && impl.existingTestsAdjusted) || [],
  mutationProbeResult: (impl && impl.mutationProbeResult) || "",
  smokePass: impl ? impl.smokePass === true : false,
  diagnoseDoc: impl && impl.diagnoseDocCommitted ? "tasks/al-p17-diagnose.md" : "(fehlt)",
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
