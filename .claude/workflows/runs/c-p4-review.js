// PER-RUN-SKRIPT C-P4-REVIEW: nachgelagerter dualer Review fuer einen BEREITS GEBAUTEN Branch.
// Derivat von phase-impl-lean.js OHNE Plan- und Impl-Phase: die Umsetzung liegt committet
// auf phase/c-p4-adapter-raus (310c78a, gebaut von Session 8ec76d98 direkt im Working-Tree,
// die vor Review/Report an einem API-Fehler starb). Dieses Skript liefert die fehlenden
// Belege nach: Safety-/Verhaltens-Review + Clean-Code-Audit + Self-Fix bis PASS + Report.
// Der Lead merged danach den ZURUECKGEGEBENEN finalBranch, NICht blind den Ausgangs-Branch.

export const meta = {
  name: "c-p4-review-nachgelagert",
  description:
    "C-P4 (Twilio-Adapter entfernen): dualer Review + Self-Fix + Report fuer den bereits gebauten Branch phase/c-p4-adapter-raus",
  phases: [
    { title: "Review", detail: "Safety/Verhalten (opus) + Clean-Code-Auditor (sonnet), parallel, je eigener Worktree" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS oder maxFixRounds" },
    { title: "Report", detail: "tasks/c-p4-report.md inkl. Behandlungs-Tabelle je Testdatei (Spec Abschnitt 4)" },
  ],
};

const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : ".";
const NODE_MODULES = `${REPO}/node_modules`;

// HART GEPINNT (Memory [[phase-impl-workflow-args]]).
const PHASE = "C-P4";
const PHASE_TITLE = "Twilio-Adapter entfernen (Track C, Schritt 5a)";
const BRANCH = "phase/c-p4-adapter-raus"; // committeter Impl-Stand 310c78a
const BASE = "master";
const SPEC_FILE = "tasks/c-p4-spec.md";
const PLAN_DOC = "PLAN-ANBIETER-PORT.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/c-p4-report.md";

// MODELL-POLITIK (Memory [[workflow-model-policy]]): Safety=opus, Audit/Fix/Report=sonnet.
const SAFETY_AGENT = { model: "opus", effort: "high" };
const CLEANCODE_AGENT = { model: "sonnet", effort: "medium" };
const FIX_AGENT = { model: "sonnet", effort: "medium" };
const REPORT_AGENT = { model: "sonnet", effort: "medium" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Prueftkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2); keine Magic Numbers ausser 0/1/-1 (G25); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); ESM, kein Build-Step, Kommentare deutsch OHNE Umlaute; reiner Ausbau laesst die Bestandssuite gruen, jede Test-Aenderung braucht die Behandlungsregel der Spec (Abschnitt 4).`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, CLAUDE.md):
- Safety-Gates (Outbound-Permit Abo+KYC, OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, Max-Dauer, Telnyx-Ed25519-Signaturpruefung fail-closed) NIE entfernen/aufweichen.
- Disclosure-Satz (disclosureSentence) bleibt fest verdrahtet.
- Auth fail-closed; timing-sichere Vergleiche; Secrets nie loggen/leaken; Audio nie durch MCP.
- SCOPE: NUR diese Phase gemaess Spec. tasks/c-p4-spec.md Abschnitt 3 zaehlt auf, was AUSDRUECKLICH NICHT dazugehoert (twilioSid-Feldname, config.js twilioSid/twilioToken + Boot-Pflicht assertConfig, .env.example, render.yaml, BASE_ENV-Twilio-Keys in test/helpers.js, SKIP_TWILIO_SIGNATURE_CHECK) - Aenderungen daran sind Scope-Verstoesse. AUSNAHME laut Spec Abschnitt 4: TWILIO_TEST_OWNER_NUMBER in test/helpers.js faellt planmaessig mit der Flag-Matrix-Zelle.`;

const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    testsPassIndependently: { type: "boolean" },
    independentTestSummary: { type: "string", description: "exakte Zahlen: pass/fail/gesamt, beide Backends" },
    registryInvariantUntouched: { type: "boolean", description: "Full-Coverage-Invariante in test/telephony-registry.test.js NICHT abgeschwaecht" },
    gegenprobeDone: { type: "boolean", description: "TWILIO testweise ins Enum -> Invariante rot -> zurueckgebaut" },
    smokePass: { type: "boolean" },
    smokeNote: { type: "string" },
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
    "registryInvariantUntouched",
    "gegenprobeDone",
    "safetyGatesIntact",
    "disclosureIntact",
    "scopeRespected",
    "blockers",
    "verdict",
  ],
};
const CC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    s1: { type: "array", items: { type: "string" }, description: 'Tests/Sicherheit/Korrektheit - "ID · Datei · Verstoss · Fix"' },
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} (${PHASE_TITLE}) auf Branch "${target}". Der Branch wurde OHNE vorherigen Review gebaut - du bist der erste Pruefer, es gibt KEINEN Impl-Bericht. Verlass dich auf NICHTS ausser dem, was du selbst misst.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-c-p4-post${suffix} ${target}
3. Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - Abschnitt 5 ist die Abnahme, Abschnitt 3 die Scope-Grenze, Abschnitt 4 die Behandlungsregel fuer Tests. "${REPO}/${PLAN_DOC}" ist Umbrella-Kontext.
4. npm test SELBST laufen lassen (json-Default; danach STORE_BACKEND=pglite falls die Suite das nicht selbst abdeckt) -> exakte Zahlen in independentTestSummary. Referenz: ${BASE} hatte 4057, die Vorgaenger-Session mass auf diesem Stand 4025. Weicht deine Zahl VON BEIDEN ab, benenne die Differenz.
5. REGISTRY-INVARIANTE (Spec Abschnitt 2): git diff ${BASE}..${target} -- test/telephony-registry.test.js. Die Full-Coverage-Schleife ("jeder PROVIDER-Wert ist in jedem Full-Coverage-Port registriert") darf NICHT abgeschwaecht sein. Abschwaechung = Blocker, registryInvariantUntouched=false.
6. GEGENPROBE (Spec Abschnitt 5): fuege PROVIDER.TWILIO testweise wieder in src/store/defaults.js ein -> die Registry-Invariante MUSS rot werden -> Aenderung zurueckbauen. gegenprobeDone nur true, wenn du das Rot GESEHEN hast.
7. BEHANDLUNGSREGEL (Spec Abschnitt 4): pruefe fuer die dort genannten Testdateien stichhaltig, dass Aussagen NICHT verschwunden sind, wo der Gegenstand kein Twilio war (Paritaets-/Locale-/Media-/STT-Naht-Tests: die Telnyx-Haelfte muss als eigenstaendige Zusicherung stehen). Ein Test, der nur "gruen gemacht" wurde, ist ein Befund.
8. SCOPE: git diff ${BASE}..${target} --stat. Aenderungen an config.js sind NUR zulaessig, soweit sie den Adapter-Ausbau betreffen - die Boot-Pflicht (assertConfig, TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN) und twilioSid/twilioToken-Config MUESSEN unangetastet sein (das ist C-P5; Reihenfolge schuetzt den Live-Dienst). Der twilioSid-FELDNAME am Call-Record bleibt (beide Anbieter nutzen ihn).
9. SMOKE (best-effort): Server auf freiem Port mit SKIP_TWILIO_SIGNATURE_CHECK=true + Dummy-Env starten, curl /healthz = 200. Zusaetzlich belegen, dass test/security.test.js (Telnyx gueltige Ed25519-Signatur -> 200) weiterhin existiert und in deinem Lauf gruen war. Zu flaky -> smokePass=false + Grund (kein automatischer Blocker).
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
2. git diff ${BASE} ${target}; geloeschte/neue Dateien per git show.
3. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
4. Achte bei einem AUSBAU besonders auf: zurueckgelassene tote Referenzen (Imports, Kommentare, die auf geloeschte Dateien zeigen), halb entkernte Tests (Assertion weg, Geruest bleibt), und Konstanten/Zweige, die nur noch einen Wert kennen und ihre Verzweigung behalten haben.
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
3. Lies "${REPO}/${SPEC_FILE}" (Scope-Grenze Abschnitt 3, Behandlungsregel Abschnitt 4). Behebe DIESE Blocker sauber und minimal; fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${"${BLOCKERS}"}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test gruen. node_modules NICHT committen. git add (betroffene Dateien einzeln) && git commit -m "fix(c-p4): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
EHRLICH: was du NICHT loesen konntest, in summary nennen.`.replace("${BLOCKERS}", JSON.stringify(blockers, null, 1)),
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
  // Toter Fix-Agent -> kein Branch -> Schleife beenden statt Phantom-Branch reviewen
  // (beobachtet 2026-07-25, P5). Gate bleibt BLOCKED mit den echten Blockern.
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

phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe den Detailbericht der Phase ${PHASE} (${PHASE_TITLE}) in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
PFLICHTTEIL (Spec "${REPO}/${SPEC_FILE}" Abschnitt 4): eine Tabelle JE geaenderter/geloeschter Testdatei - geloescht, gekuerzt oder unveraendert, und WARUM (mechanisch identische Faelle wie "PROVIDER.TWILIO-Import entfernt" duerfen gruppiert werden, jede GELOESCHTE Datei einzeln). Quelle: git diff ${BASE}..${reviewTarget} --stat und die Diffs selbst.
Weitere Inhalte (Markdown): Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; Kontext (gebaut von Session 8ec76d98 ohne Review, Commit 310c78a, dieser Lauf hat den Review nachgeliefert); Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden; Testzahl inkl. Delta zu ${BASE} (4057). Quelle:
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
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  independentTestSummary: (safety && safety.independentTestSummary) || "",
  registryInvariantUntouched: safety ? safety.registryInvariantUntouched : null,
  gegenprobeDone: safety ? safety.gegenprobeDone : null,
  reportPath,
};
