// PER-RUN-Skript KV-P1 NACHBESSERUNG (Phase HART GEPINNT).
// Befund aus der Verifikation von 049bacd: der Ein-Aufrufer-Riegel KV-P1-10 filtert DATEIEN
// statt VORKOMMEN. Ein zweiter Aufruf von store.addVoiceUsageCostCents( INNERHALB von
// src/billing/metering.js bleibt gruen - und genau dort liegt der bestehende Aufruf, also
// ist das der wahrscheinlichste Ort einer Doppelbuchung (Pre-Mortem TOD 2).
// Schema traegt nur Skalare (Lehre aus wf_af632311-4d5: 16-KB-Nutzlast toetet den Lauf).

export const meta = {
  name: "phase-impl-lean",
  description:
    "KV-P1 Nachbesserung: den Ein-Aufrufer-Riegel von datei- auf vorkommensbasiert schaerfen (TOD 2, Doppelbelastung).",
  phases: [
    { title: "Implementieren", detail: "KV-P1-10 schaerfen + zwei Mutationsproben" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Nachtrag in tasks/kv-p1-report.md" },
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
const PHASE = "KV-P1b";
const PHASE_TITLE = "Ein-Aufrufer-Riegel vorkommensbasiert statt dateibasiert";
const BRANCH = "phase/kv-p1b-aufrufer-riegel";
const BASE = "phase/kv-p1-kosten-landkarte";
const REPORT_PATH = "tasks/kv-p1-report.md";

const MODEL_SONNET = "sonnet";
const IMPL_AGENT = { model: MODEL_SONNET };
const SAFETY_AGENT = { model: MODEL_SONNET, effort: "medium" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const SCHEMA_RULE = `SCHEMA-REGEL (bindend, sonst stirbt der Lauf): JEDES Textfeld deiner StructuredOutput-Antwort bleibt KURZ - hoechstens etwa 400 Zeichen, KEINE Markdown-Tabellen, KEINE Code-Bloecke, KEINE langen eingebetteten Zeilenumbrueche. Ein Vorlauf dieser Kette ist an einer 16-KB-Nutzlast gestorben.`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md". Insbesondere: keine Duplizierung (G5/S2); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante); intentions-ausdrueckende Namen (N1); ein Konzept pro Test (P14); Build-Operate-Check (P13); kein toter Code (C5/G9). ESM, kein Build-Step, kein TypeScript.
PFLICHT VOR JEDEM "EXISTIERT NICHT"-BEFUND: greppe am AUSGECHECKTEN BRANCH, nicht nur im Diff (Repo-Lehre KV-M0).
UMLAUT-REGEL: Kommentare und Identifier OHNE Umlaute (ue/oe/ae).`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE entfernen/aufweichen. Diese Phase SCHAERFT einen Riegel.
- KEIN Produktionsverhalten aendern. Der Diff darf ausschliesslich test/ beruehren.
- SECRETS nur via env, nie loggen.
- SCOPE: NUR dieser eine Riegel. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const SCOPE = `SCOPE DIESER NACHBESSERUNG (bindend, sehr eng):
DER BEFUND: In test/kv-p1-cost-ledger-map.test.js prueft "KV-P1-10" heute, in WELCHEN DATEIEN unter src/ das Muster \`store.addVoiceUsageCostCents(\` vorkommt, und vergleicht die Dateiliste gegen ["src/billing/metering.js"]. Ein ZWEITER Aufruf innerhalb derselben Datei aendert die Dateiliste nicht - der Test bleibt gruen. Empirisch belegt: zweiter Aufruf in metering.js -> gruen (Fehler), zweiter Aufruf in cost-truing.js -> rot (richtig).

WARUM DAS ZAEHLT: Der Riegel existiert wegen Pre-Mortem TOD 2 (ein Kunde wird doppelt belastet). Der wahrscheinlichste Ort eines zweiten Aufrufs ist genau die Datei, in der der erste steht - also deckt der Riegel heute den Hauptfall NICHT ab.

DIE AENDERUNG, genau diese und keine andere:
- KV-P1-10 zaehlt VORKOMMEN, nicht Dateien: alle Treffer des Musters ueber alle src-Dateien, Erwartung GENAU EINS, und dieses eine in src/billing/metering.js. Die Fehlermeldung nennt weiterhin TOD 2 (Doppelbelastung) und zusaetzlich die gefundene Anzahl und Fundstelle(n), damit ein kuenftiger Leser sofort sieht, was passiert ist.
- Der Regex muss global mehrfach zaehlen koennen (matchAll oder aequivalent). Achte darauf, dass ein wiederverwendeter Regex mit /g-Flag zustandsbehaftet ist (lastIndex) - ein bekannter Fallstrick, der genau hier zu falschen Zahlen fuehrt.
- Kommentarkopf der Testdatei: die Mutationsanleitung bei (d) praezisieren - ein zweiter Aufruf IN DERSELBEN DATEI muss den Test ebenfalls rot faerben.

NICHT-ZIELE:
- KEINE Aenderung an src/ - kein Produktionscode, auch kein Kommentar. Der Diff beruehrt NUR test/kv-p1-cost-ledger-map.test.js.
- KEINE weitere Tabellenzeile, KEIN weiterer Riegel, KEINE Luecke schliessen. Inbound/SMS/TTS/number_month bleiben auf gate=false.
- NIEMALS "git stash". NIEMALS "git add -A". Dateien EINZELN adden.`;

// ---------- Phase 1: Implementieren ----------
phase("Implementieren");
const IMPL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    onlyTestFileTouched: {
      type: "boolean",
      description: "Der Diff gegen die Basis beruehrt AUSSCHLIESSLICH test/kv-p1-cost-ledger-map.test.js",
    },
    mutationSameFile: {
      type: "string",
      description:
        "Zweiter Aufruf IN src/billing/metering.js eingefuegt -> wurde KV-P1-10 rot? Welche Meldung? Hoechstens 350 Zeichen.",
    },
    mutationOtherFile: {
      type: "string",
      description:
        "Zweiter Aufruf in einer ANDEREN src-Datei -> wurde KV-P1-10 rot? Hoechstens 300 Zeichen.",
    },
    regexStateNote: {
      type: "string",
      description:
        "Wie ist ausgeschlossen, dass ein zustandsbehafteter /g-Regex (lastIndex) falsch zaehlt? Hoechstens 300 Zeichen.",
    },
    mutationsReverted: { type: "boolean" },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string", description: "Hoechstens 400 Zeichen" },
  },
  required: [
    "headCommit",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "onlyTestFileTouched",
    "mutationSameFile",
    "mutationOtherFile",
    "regexStateNote",
    "mutationsReverted",
    "committed",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert). Sehr kleine, sehr eng umrissene Nachbesserung.
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. REGEL 0: ZUERST \`git checkout -b ${BRANCH} ${BASE}\`, DANN erst lesen. Die Basis ist NICHT master, sondern der KV-P1-Branch.
3. Lies test/kv-p1-cost-ledger-map.test.js, insbesondere den Test "KV-P1-10" und den Kommentarkopf.
4. Setze die Aenderung um.
${SCOPE}
${CLEAN_CODE_REQ}
5. node --check ist hier nicht noetig (nur test/), aber npm test MUSS gruen sein.
6. ZWEI MUTATIONSPROBEN, einzeln, jede danach zuruecknehmen:
   (a) einen zweiten \`store.addVoiceUsageCostCents(\` -Aufruf IN src/billing/metering.js einfuegen -> KV-P1-10 MUSS rot werden. Das ist der Kern dieser Nachbesserung: bleibt er gruen, ist die Aenderung wirkungslos und du baust sie um.
   (b) einen zweiten Aufruf in einer anderen src-Datei -> KV-P1-10 MUSS ebenfalls rot werden (Bestandsverhalten, darf nicht kaputtgehen).
   Beide zuruecknehmen, npm test erneut gruen, git diff darf keine Mutation tragen.
7. Dateien EINZELN adden, committen: "fix(kv-p1): Ein-Aufrufer-Riegel zaehlt Vorkommen statt Dateien (TOD 2)".
8. node_modules-Symlink NICHT committen. Nach dem Lauf: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${SCHEMA_RULE}
${ABS_RULES}
EHRLICH fuellen. Wenn Probe (a) gruen bleibt, sag das - eine geschoenigte Antwort macht den Riegel wertlos.`,
  {
    label: `${PHASE}-implement`,
    phase: "Implementieren",
    schema: IMPL_SCHEMA,
    isolation: "worktree",
    ...IMPL_AGENT,
  },
);

// ---------- Phase 2: Dualer Review ----------
const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    testsPassIndependently: { type: "boolean" },
    onlyTestFileTouched: { type: "boolean", description: "SELBST geprueft: git diff beruehrt nur die eine Testdatei" },
    guardCatchesSameFile: {
      type: "boolean",
      description:
        "SELBST verifiziert durch eigene Mutation: zweiter Aufruf IN metering.js -> KV-P1-10 rot",
    },
    guardCatchesOtherFile: {
      type: "boolean",
      description: "SELBST verifiziert: zweiter Aufruf in anderer Datei -> KV-P1-10 rot",
    },
    noGapClosed: {
      type: "boolean",
      description: "Keine Landkarten-Zeile gekippt; inbound/sms/tts/number_month weiterhin gate=false",
    },
    existingAssertionsNotWeakened: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 400 Zeichen" },
    concerns: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 300 Zeichen" },
    verdict: { type: "string", description: "Hoechstens 500 Zeichen" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "onlyTestFileTouched",
    "guardCatchesSameFile",
    "guardCatchesOtherFile",
    "noGapClosed",
    "existingAssertionsNotWeakened",
    "safetyGatesIntact",
    "blockers",
    "verdict",
  ],
};
const CC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    s1: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 400 Zeichen" },
    s2: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 400 Zeichen" },
    s3: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 250 Zeichen" },
    s4: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 250 Zeichen" },
    blocker: { type: "boolean" },
    grepCheckDone: { type: "boolean" },
    verdict: { type: "string", description: "Hoechstens 400 Zeichen" },
  },
  required: ["s1", "s2", "s3", "s4", "blocker", "grepCheckDone", "verdict"],
};

async function runReview(target, suffix) {
  return await parallel([
    () =>
      agent(
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe die Nachbesserung ${PHASE} auf Branch "${target}" gegen die Basis "${BASE}".
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-kv-p1b${suffix} ${target}
3. npm test selbst -> testsPassIndependently.
4. git diff ${BASE} ${target} - er MUSS ausschliesslich test/kv-p1-cost-ledger-map.test.js beruehren. Jede src-Aenderung ist ein BLOCKER.
${SCOPE}
FUEHRE BEIDE MUTATIONEN SELBST DURCH, nicht dem Bericht glauben:
- guardCatchesSameFile: fuege einen zweiten \`store.addVoiceUsageCostCents(\`-Aufruf IN src/billing/metering.js ein (an einer Stelle, die den restlichen Test nicht anderweitig kippt) und lauf KV-P1-10. Bleibt er gruen, ist die Nachbesserung wirkungslos - BLOCKER. Mutation zuruecknehmen.
- guardCatchesOtherFile: dasselbe in einer anderen src-Datei. Muss ebenfalls rot werden - sonst ist Bestandsverhalten kaputt, BLOCKER. Zuruecknehmen.
- noGapClosed: pruefe, dass keine Landkarten-Zeile gedreht wurde (inbound/sms/tts/number_month weiterhin gate=false).
BEVOR du behauptest, etwas existiere nicht: greppe am ausgecheckten Branch (Repo-Lehre KV-M0).
${SCHEMA_RULE}
${ABS_RULES}
approved=true NUR wenn beide Mutationen rot wurden UND deine Tests gruen sind.`,
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
        `CLEAN-CODE-AUDITOR. Pruefe den Diff der Nachbesserung ${PHASE} (Branch "${target}", Basis "${BASE}").
1. ln -s "${NODE_MODULES}" node_modules ; git checkout -b cc-kv-p1b${suffix} ${target}
2. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG.
3. git diff ${BASE} ${target} - der Diff ist klein, lies ihn vollstaendig.
4. PFLICHT VOR JEDEM "EXISTIERT NICHT"-BEFUND: git grep am ausgecheckten Branch. Ein S1 auf ungepruefter Annahme ist ein Fehlalarm und kostet eine ganze Runde (Repo-Lehre KV-M0). grepCheckDone erst true, wenn wirklich getan.
5. Achte besonders auf: (a) ein /g-Regex, der zwischen Aufrufen wiederverwendet wird, traegt lastIndex-Zustand - ein klassischer Korrektheitsfehler (S1), wenn der Test dadurch mal richtig und mal falsch zaehlt; (b) benannte Konstante statt nackter 1 fuer die erwartete Aufruferzahl, falls die Lesbarkeit es verlangt (G25, mit Augenmass - 1 ist nach Repo-Regel als Zahl erlaubt); (c) die Fehlermeldung muss diagnostisch sein (P8): sie nennt Anzahl UND Fundstellen; (d) ein Konzept pro Test (P14); (e) Kommentare deutsch OHNE Umlaute; (f) kein toter Code.
${SCHEMA_RULE}
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

// ---------- Phase 3: Self-Fix ----------
const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    addressed: { type: "array", items: { type: "string" } },
    rejectedAsFalsePositive: { type: "array", items: { type: "string" } },
    testsPass: { type: "boolean" },
    committed: { type: "boolean" },
    summary: { type: "string", description: "Hoechstens 400 Zeichen" },
  },
  required: ["headCommit", "testsPass", "committed", "summary"],
};
let round = 0;
const fixSummaries = [];
const MAX_FIX_ROUNDS = 2;
while (!gateOk(safety, cc) && round < MAX_FIX_ROUNDS) {
  round++;
  phase("Self-Fix");
  const fixBranch = `${BRANCH}-fix${round}`;
  const blockers = blockerList(safety, cc);
  const fix = await agent(
    `Du behebst die REVIEW-BLOCKER der Nachbesserung ${PHASE} in einem frischen Worktree.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${fixBranch} ${reviewTarget}
3. REPRODUZIERE JEDEN BLOCKER ZUERST. Was sich nicht reproduzieren laesst, kommt nach rejectedAsFalsePositive mit Kommando und Ergebnis - NICHT "fixen" (Repo-Lehre KV-M0).
4. Behebe die reproduzierbaren Blocker:
${JSON.stringify(blockers, null, 1)}
${SCOPE}
${CLEAN_CODE_REQ}
${SCHEMA_RULE}
${ABS_RULES}
5. npm test gruen. Dateien EINZELN adden, kein git stash.
6. **COMMITTE IMMER**, auch wenn alle Blocker Fehlalarme waren (dann eine Klarstellung committen) mit "fix(kv-p1): Riegel-Blocker geprueft (Runde ${round})". Ohne Commit bleibt die Phase auf BLOCKED stehen, obwohl nichts kaputt ist.`,
    {
      label: `${PHASE}-fix-r${round}`,
      phase: "Self-Fix",
      schema: FIX_SCHEMA,
      isolation: "worktree",
      ...FIX_AGENT,
    },
  );
  fixSummaries.push(`r${round}: ${fix && fix.summary ? fix.summary.slice(0, 250) : "(kein Ergebnis)"}`);
  if (fix && Array.isArray(fix.rejectedAsFalsePositive) && fix.rejectedAsFalsePositive.length) {
    fixSummaries.push(`r${round} FEHLALARME: ${fix.rejectedAsFalsePositive.join(" | ").slice(0, 400)}`);
  }
  if (!fix || !fix.committed || !fix.headCommit) {
    fixSummaries.push(`r${round}: ABBRUCH - kein Commit vom Fix-Agenten.`);
    break;
  }
  reviewTarget = fixBranch;
  [safety, cc] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc);

// ---------- Phase 4: Bericht-Nachtrag ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Haenge einen Abschnitt an die BESTEHENDE Datei "${REPO}/${REPORT_PATH}" an (nicht ueberschreiben, nicht neu anlegen). NICHTS am Code aendern, KEIN git-Commit.
Der Abschnitt heisst "## Nachbesserung KV-P1b - Ein-Aufrufer-Riegel zaehlt Vorkommen" und enthaelt:
- den Befund: KV-P1-10 filterte DATEIEN, nicht Vorkommen; ein zweiter Aufruf von store.addVoiceUsageCostCents( innerhalb von src/billing/metering.js blieb gruen - und genau dort liegt der bestehende Aufruf, also deckte der Riegel den wahrscheinlichsten Fall einer Doppelbuchung (Pre-Mortem TOD 2) NICHT ab;
- was geaendert wurde (nur test/kv-p1-cost-ledger-map.test.js);
- die zwei Mutationsproben mit Ergebnis (gleiche Datei / andere Datei), sowohl vom Implementierer als auch vom unabhaengigen Reviewer;
- Gate=${approved ? "PASS" : "BLOCKED"}, finalBranch=${reviewTarget};
- eine ehrliche Restgrenze: der Riegel ist ein Textmuster-Scan ueber src/ - er faengt einen Aufruf, der ueber eine Variable, eine Umbenennung oder einen dynamischen Zugriff laeuft, NICHT. Das ist bewusst getragen; die Alternative waere eine Laufzeit-Zaehlung, die den Produktionscode veraendern wuerde, was diese Phase ausdruecklich nicht tut.
Quelle:
=== IMPL ===
${JSON.stringify(impl, null, 1)}
=== SAFETY ===
${JSON.stringify(safety, null, 1)}
=== CLEANCODE ===
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
  onlyTestFileTouched: impl ? impl.onlyTestFileTouched === true : false,
  mutationSameFile: (impl && impl.mutationSameFile) || "",
  mutationOtherFile: (impl && impl.mutationOtherFile) || "",
  regexStateNote: (impl && impl.regexStateNote) || "",
  mutationsReverted: impl ? impl.mutationsReverted === true : false,
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
  summary: impl && impl.summary ? impl.summary.slice(0, 400) : "",
};
