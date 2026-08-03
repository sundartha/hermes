// PER-RUN-Skript KV-P1 (Kopie von kv-m0.js, Phase HART GEPINNT).
// Siehe Memory [[phase-impl-workflow-args]]: die Phase steht hier im Skript, nicht in args.

export const meta = {
  name: "phase-impl-lean",
  description:
    "KV-P1: die Kosten-Landkarte wird Struktur statt Konvention - eine deklarative Tabelle, gegen das echte Buchungsverhalten gefahren.",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan (clean-code.md + Plan-Doc + echter Code)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/kv-p1-report.md" },
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
const PHASE = "KV-P1";
const PHASE_TITLE = "Die Kosten-Landkarte wird Struktur statt Konvention";
const BRANCH = "phase/kv-p1-kosten-landkarte";
const BASE = "master";
const PLAN_DOC = "tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/kv-p1-report.md";

const MODEL_SONNET = "sonnet";

// Modellpolitik (Kickoff KV-Kette): KV-P1 aendert ausdruecklich KEIN Verhalten (sie
// deklariert den IST-Zustand) und kippt keine Gate-Entscheidung -> komplett Sonnet.
// Pins explizit pro agent(), nie erben lassen (Memory [[workflow-model-policy]]).
const PLAN_AGENT = { model: MODEL_SONNET, effort: "medium" };
const IMPL_AGENT = { model: MODEL_SONNET };
const SAFETY_AGENT = { model: MODEL_SONNET, effort: "medium" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Pruefkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, EINE Quelle fuer eine Zugehoerigkeit); Struktur schlaegt Konvention (G27 - das ist der Kern DIESER Phase); keine Magic Numbers ausser 0/1/-1 (G25); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen (N1/N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript. Tests: ein Konzept pro Test (P14), Build-Operate-Check (P13), keine geteilte veraenderliche Fixture (P12).
WICHTIG ZUR AUDIT-PRUEFUNG: bevor du behauptest, ein Symbol/Feld existiere nicht, greppe am AUSGECHECKTEN BRANCH danach - nicht nur im Diff. Ein Feld kann ueber die Basis hereingekommen sein und taucht dann im Diff gar nicht auf (Repo-Lehre KV-M0).
UMLAUT-REGEL: Kommentare und Identifier OHNE Umlaute (ue/oe/ae) - wie im Bestand.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE entfernen/aufweichen/per-Default umgehen.
- Diese Phase aendert KEIN Produktionsverhalten. Sie deklariert den IST-Zustand und pinnt ihn mit Tests.
- SECRETS nur via env, nie loggen/leaken - auch nicht in Fixtures oder Testdaten.
- AUTH FAIL-CLOSED: keine neue Route, kein Endpunkt, keine HTTP-Ausgabe.
- Disclosure-Satz (disclosureSentence) unberuehrt.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const KV_P1_SCOPE = `SCOPE DIESER PHASE (bindend):
ZIEL: Die Wurzel dieses Plans ist, dass es ZWEI Kostenbuecher gibt und KEINE Kante zwischen ihnen - Buch A ist der Verbrauchs-Ledger (\`usage_event\`, Schreiber \`recordUsageEvent\`), Buch B ist die Gate-Achse (\`usage.costCents\`/\`usage.spendMonthCostCents\`, Schreiber \`bookCents\` ueber \`trackUsage\`/\`addUsageCostCents\`/\`applyCreditCents\`, gelesen von \`budgetExceeded\`). Weil es keine Kante gibt, muss jede Kosten-Art ZWEIMAL von Hand verdrahtet werden, und die beiden Verdrahtungen bekommen unabhaengig ihre eigenen Bedingungen. Vollstaendigkeit ist damit heute eine Eigenschaft der Sorgfalt, nicht der Struktur. Diese Phase macht sie zu einer Eigenschaft der Struktur (Clean-Code G27).

TEIL 1 - Die deklarative Tabelle:
Eine Tabelle im Code, je Kosten-Art GENAU EINE Zeile, mit drei Pflichtfeldern OHNE DEFAULT:
- \`ledger\` - schreibt diese Art einen \`usage_event\`?
- \`gate\` - erreicht diese Art \`usage.costCents\`?
- \`preisquelle\` - woher kommt der Betrag, und was passiert, wenn er fehlt?
Ein fehlendes Feld muss ein Fehler sein, kein stiller Default - genau das ist der Unterschied zwischen Struktur und Konvention. Die Tabelle gehoert an einen Ort, an dem sie beim Lesen des Buchungs-Codes gefunden wird (nicht in test/), und sie muss KURZ genug bleiben, um in einem Review vollstaendig gelesen zu werden.

TEIL 2 - Der Test, der die Tabelle gegen die REALITAET faehrt (das ist der eigentliche Wert):
Fuer JEDE Zeile wird der Buchungspfad mit einer Fixture AUSGELOEST und danach werden BEIDE Buecher gelesen. Weicht die Realitaet von der Deklaration ab, ist der Test rot.
**DAS IST DIE HAERTESTE ANFORDERUNG DIESER PHASE. Ein Test, der die Tabelle nur gegen sich selbst oder gegen eine zweite Konstante prueft, ist eine Tautologie und verfehlt die Phase vollstaendig.** Der Test MUSS den echten Buchungspfad aufrufen (z.B. den Call-Ende-Pfad, den Token-Buchungspfad, den SMS-Pfad, den Nummern-Sweep) und danach die zwei Buecher inspizieren. Wenn eine Kosten-Art im Test nicht ausloesbar ist, ist das ein BEFUND und gehoert in den Bericht - sie darf NICHT still auf eine Deklarations-Prueferei zurueckfallen. Nenne fuer jede Zeile ausdruecklich, ueber welchen echten Aufruf sie ausgeloest wird.

TEIL 3 - Der Vollstaendigkeits-Riegel:
Ein neuer Wert in \`USAGE_EVENT_KIND\` (src/store/defaults.js) ohne Tabellenzeile MUSS den Test rot faerben. Umgekehrt: eine Tabellenzeile ohne zugehoerige Kosten-Art ebenfalls. Das ist der Mechanismus, der verhindert, dass die naechste Kosten-Art die Tabelle stillschweigend umgeht.

TEIL 4 - Der Ein-Aufrufer-Riegel (aus Pre-Mortem TOD 2 des Plans, ausdruecklich Teil dieser Phase):
\`addVoiceUsageCostCents\` hat repo-weit genau EINEN Aufrufer. Diese Eigenschaft wird in einen Test gegossen, damit ein zweiter Aufrufer nicht unbemerkt entsteht (Doppelbelastung des Kunden ist der Schadensfall). Pruefe selbst am Code, ob die Aussage heute noch stimmt - stimmt sie nicht mehr, ist das ein BEFUND fuer den Bericht, und der Test pinnt den IST-Zustand mit Begruendung.

DIE ZEILEN (aus der Divergenz-Tabelle des Plans - PRUEFE JEDE SELBST AM CODE NACH, uebernimm nichts ungeprueft, und ergaenze, was du zusaetzlich findest):
- Voice-Minuten outbound: ledger ja, gate ja
- Voice-Minuten INBOUND: ledger ja (bepreist!), gate NEIN  <- die Hauptluecke, KV-P2 kippt sie spaeter
- KI-Tokens: ledger ja aber auf 0 gerundet, gate ja (Mikro-Cent-Carry)
- Recherche-Gebuehr: ledger NEIN, gate ja
- SMS: ledger ja mit Preis-Default 0, gate NEIN
- DID-Monatsmiete: ledger nein (Preis null, fail-closed), gate nie vorgesehen
- Play-TTS-Zeichen: ledger nein, gate nein - es existiert repo-weit KEIN Preis-Parameter
Zusaetzlich: enumeriere \`USAGE_EVENT_KIND\` selbst und decke JEDEN Wert ab, auch die hier nicht genannten.

KERNREGEL DER PHASE - DIESE PHASE AENDERT KEIN VERHALTEN:
Sie bildet den IST-Zustand ab, LUECKEN INKLUSIVE (\`inbound: gate=nein\`, \`sms: gate=nein\`, \`tts: gate=nein\`, ...). **Wer waehrend dieser Phase eine Luecke "nebenbei" schliesst, hat die Phase verfehlt und macht die Kette unpruefbar** - jede folgende Bau-Phase kippt genau EINE Zeile von \`nein\` auf \`ja\`, und der Test erzwingt, dass die Realitaet mitkippt. Die Tabelle ist damit zugleich der Fortschrittsanzeiger des ganzen Plans. Ein Diff, der einen Buchungspfad aendert, ist ein BLOCKER.

TEST-IDs: "KV-P1-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer) - solche Tests landen still im test:gates-Lauf, wo Rot erlaubt ist.

NICHT-ZIELE (ausdruecklich):
- KEINE neue Env-Variable, KEIN neues Flag, KEINE neue DB-Spalte, KEIN Backfill.
- KEINE Aenderung an \`recordUsageEvent\`, \`bookCents\`, \`trackUsage\`, \`addUsageCostCents\`, \`applyCreditCents\`, \`budgetExceeded\`, \`metering.js\`, \`cost-truing.js\`, \`llm-usage.js\` - ausser rein additiven Kommentaren, die auf die Tabelle verweisen. Jede Bedingungs-/Filter-/Betragsaenderung ist ein BLOCKER.
- KEINE Luecke schliessen. KEINE Kosten-Art neu verdrahten.
- NIEMALS "git stash" (refs/stash ist zwischen Worktrees geteilt). NIEMALS "git add -A" - im Repo liegen untrackte Dateien mit Kundendaten. Dateien EINZELN adden.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies "${REPO}/${PLAN_DOC}" - den Abschnitt "KV-P1", den Abschnitt "Die gemeinsame Wurzel" (die Divergenz-Tabelle ist die Vorlage deiner Zeilen) und das Pre-Mortem TOD 2 und TOD 7. Das Dokument ist die Autoritaet dieser Phase.
2. Lies "${REPO}/.claude/refs/clean-code.md" und "${REPO}/CLAUDE.md".
3. Lies den ECHTEN Code auf Basis "${BASE}" - grep nach Symbolen, uebernimm KEINE Zeilennummern (sie rotten):
   - src/store/defaults.js: \`USAGE_EVENT_KIND\` - welche Werte gibt es WIRKLICH?
   - src/store/state-ops.js: \`recordUsageEvent\` (Buch A), \`bookCents\` und seine drei Einstiege \`trackUsage\`/\`addUsageCostCents\`/\`applyCreditCents\` (Buch B), \`addVoiceUsageCostCents\`, \`budgetExceeded\`, \`aiCostCents\`, \`voiceMinutesUsedSince\`
   - src/billing/metering.js: \`recordVoiceMinuteMeter\`, \`reconcileOutboundVoiceBudget\`, \`callTariffCentsPerMin\`, \`recordNumberMonthMeter\`, \`monthlyRentCents\`, \`liveVoiceSpendCents\`
   - src/billing/llm-usage.js: \`meterAiTokens\`, \`bookTokenUsage\`, \`bookEstimatedTokenUsage\`, die Recherche-Gebuehr
   - src/billing/cost-truing.js: \`bookTtsCharactersFor\`, der Ist-Abgleich
   - src/telephony/call-finish.js: die Aufrufstelle, an der beide Buecher NEBENEINANDER geschrieben werden (das ist der Beweis der Wurzel), und der SMS-Pfad
   - src/config.js: \`smsCostCents\`, \`numberMonthlyCostCents\`, \`ttsCharacterQuota\` (gibt es einen TTS-PREIS? Suche selbst, der Plan behauptet: nein)
   - test/: wie loesen Bestandstests einen Call-Ende-Pfad aus? Welche Fixtures/Helper gibt es (test/helpers.js, makePgTestStore, Store-Fixtures)? DAS ist entscheidend fuer Teil 2.
4. ENTSCHEIDE UND BEGRUENDE:
   (a) WO liegt die Tabelle? Sie muss beim Lesen des Buchungscodes gefunden werden. Begruende die Datei.
   (b) WIE erzwingst du drei Pflichtfelder ohne Default in JavaScript ohne TypeScript? (Ein Objekt-Literal erzwingt gar nichts - es braucht eine Validierung, die beim Import oder im Test zuschlaegt. Sag welche und warum sie nicht umgehbar ist.)
   (c) FUER JEDE ZEILE: ueber welchen ECHTEN Aufruf loest der Test die Buchung aus, und wie liest er danach Buch A und Buch B? Mach eine Tabelle: Kosten-Art | Ausloeser im Test | Assertion Buch A | Assertion Buch B. Zeilen, fuer die du keinen echten Ausloeser findest, benennst du als offenen Befund - NICHT verstecken.
   (d) Wie faerbt ein neuer \`USAGE_EVENT_KIND\`-Wert ohne Zeile den Test rot, und wie eine Zeile ohne Kosten-Art?
   (e) Stimmt die Ein-Aufrufer-Aussage zu \`addVoiceUsageCostCents\` heute noch? Belege mit grep-Ergebnis.
5. Nenne ausdruecklich, welche Bestandstests kippen koennten und wie du damit umgehst.
6. PRE-MORTEM dieser Phase: ein Jahr spaeter ist die Landkarte Tapete. Was ist passiert? Nenne mindestens: der Test prueft die Tabelle gegen sich selbst statt gegen das Verhalten; jemand aendert einen Buchungspfad, der Test wird rot, und die schnellste Reparatur ist, die Deklaration nachzuziehen statt die Buchung; die Tabelle waechst so, dass sie im Review niemand mehr vollstaendig liest; eine Kosten-Art wird gebucht, ohne je ein \`USAGE_EVENT_KIND\` zu beruehren, und entgeht dem Riegel damit vollstaendig. Fuer jedes: die Gegenmassnahme, oder die ehrliche Feststellung, dass es keine gibt (TOD 7 sagt ausdruecklich, dass es gegen den zweiten Fall keinen technischen Schutz gibt - schreib das hin, statt einen zu erfinden).
${KV_P1_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die Tabelle im Wortlaut, alle Zeilen, alle drei Felder; (2) die exakten Edits je Datei; (3) die Ausloeser-Tabelle aus 4c; (4) die Tests KV-P1-* mit konkreten Assertions; (5) die Mutationsproben (mindestens: eine Zeile luegt -> rot; ein neuer KIND-Wert ohne Zeile -> rot; ein zweiter Aufrufer von addVoiceUsageCostCents -> rot); (6) das Pre-Mortem. Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
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
    costMapTable: {
      type: "string",
      description:
        "Die fertige Landkarte als Markdown-Tabelle, alle Zeilen, alle drei Pflichtfelder - woertlich aus dem Code uebernommen",
    },
    triggerTable: {
      type: "string",
      description:
        "Markdown-Tabelle: Kosten-Art | ECHTER Ausloeser im Test (Funktionsaufruf) | Assertion Buch A | Assertion Buch B. Zeilen ohne echten Ausloeser ausdruecklich als solche markiert.",
    },
    tautologyGuard: {
      type: "string",
      description:
        "Wodurch ist ausgeschlossen, dass der Test die Tabelle nur gegen sich selbst prueft? Nenne den konkreten Mechanismus und die Mutation, die es belegt.",
    },
    unreachableRows: {
      type: "array",
      items: { type: "string" },
      description:
        "Kosten-Arten, die im Test NICHT ueber einen echten Buchungspfad ausloesbar waren, je mit Grund - offener Befund, nicht verstecken",
    },
    completenessGuardProof: {
      type: "string",
      description:
        "Womit ist belegt, dass ein neuer USAGE_EVENT_KIND-Wert ohne Tabellenzeile den Test rot faerbt (und umgekehrt)? Mutationsergebnis.",
    },
    singleCallerProof: {
      type: "string",
      description:
        "addVoiceUsageCostCents: wie viele Aufrufer hat es heute wirklich (grep-Ergebnis), und wie pinnt der Test das?",
    },
    noBehaviourChange: {
      type: "boolean",
      description:
        "MUSS true sein: kein Buchungspfad geaendert, keine Luecke geschlossen, keine Bedingung/kein Filter/kein Betrag angefasst",
    },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    gatesRedCount: { type: "number", description: "Rote Tests in npm run test:gates" },
    mutationProbeResult: { type: "string" },
    findingsNotFixed: {
      type: "array",
      items: { type: "string" },
      description: "Beim Lesen aufgefallene Abweichungen zwischen Plan-Doc und echtem Code - fuer den Bericht",
    },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "costMapTable",
    "triggerTable",
    "tautologyGuard",
    "unreachableRows",
    "completenessGuardProof",
    "singleCallerProof",
    "noBehaviourChange",
    "nodeCheckPass",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "mutationProbeResult",
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
2. REGEL 0: ZUERST \`git checkout -b ${BRANCH} ${BASE}\`, DANN erst lesen.
3. Umsetzung: Tabelle + Pflichtfeld-Validierung + Verhaltenstest je Zeile + Vollstaendigkeits-Riegel + Ein-Aufrufer-Riegel.
4. node --check auf jede geaenderte src-Datei, dann npm test gruen. Dateien EINZELN adden, committen: "feat(kv-p1): Kosten-Landkarte als Struktur - IST-Zustand deklariert und gegen das Verhalten gepinnt".
${KV_P1_SCOPE}
${CLEAN_CODE_REQ}
5. npm test MUSS gruen sein. Kippende Bestandstests einzeln in existingTestsAdjusted begruenden.
6. npm run test:gates zusaetzlich fahren (DARF rot sein). Zahl in gatesRedCount. HINWEIS: test/auth-p9a-cache-headers.test.js haengt bekanntermassen unter --test-name-pattern (Bestandsdefekt, NICHT deine Aufgabe, nicht fixen) - wenn der Lauf haengt, brich ab und melde das statt zu warten.
7. Mutationsproben, ALLE vier:
   (a) EINE Tabellenzeile luegen lassen (z.B. inbound gate=ja deklarieren, obwohl der Code nicht bucht) -> genau der zugehoerige Verhaltenstest rot. Wenn er GRUEN bleibt, ist dein Test eine Tautologie und die Phase ist verfehlt - dann baust du ihn um, bevor du weitermachst.
   (b) einen neuen Wert in USAGE_EVENT_KIND ergaenzen ohne Tabellenzeile -> rot.
   (c) eine Tabellenzeile entfernen, deren Kosten-Art es weiterhin gibt -> rot.
   (d) einen zweiten Aufrufer von addVoiceUsageCostCents anlegen -> rot.
   Jede Mutation ZURUECKNEHMEN, npm test erneut gruen. Der finale Diff darf keine Mutation tragen.
8. node_modules-Symlink NICHT committen. Nach dem Lauf: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${ABS_RULES}
EHRLICH fuellen. tautologyGuard und unreachableRows sind die zwei Felder, an denen diese Phase gemessen wird - schoene sie nicht. Eine Kosten-Art, die du nicht ueber einen echten Pfad ausloesen konntest, gehoert in unreachableRows, nicht in eine erfundene Assertion.`,
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
    noBehaviourChange: {
      type: "boolean",
      description:
        "SELBST geprueft: kein Buchungspfad, keine Bedingung, kein Filter, kein Betrag geaendert. git diff auf state-ops.js/metering.js/llm-usage.js/cost-truing.js/call-finish.js zeigt nur Additives.",
    },
    noGapClosed: {
      type: "boolean",
      description:
        "Keine Luecke wurde 'nebenbei' geschlossen - inbound/sms/tts/did stehen in der Tabelle weiterhin auf dem IST-Wert (gate=nein), und der Code bucht sie weiterhin nicht",
    },
    testIsNotTautological: {
      type: "boolean",
      description:
        "SELBST verifiziert: der Test loest echte Buchungspfade aus und liest danach BEIDE Buecher. Mutation durchgefuehrt (eine Zeile luegen lassen) -> wurde der Test rot?",
    },
    completenessGuardWorks: {
      type: "boolean",
      description: "SELBST verifiziert: neuer USAGE_EVENT_KIND-Wert ohne Zeile -> Test rot. Mutation durchgefuehrt.",
    },
    tableReadableInReview: {
      type: "boolean",
      description:
        "Die Tabelle ist kurz und geschlossen genug, dass ein Reviewer sie vollstaendig liest - sie ist der einzige Schutz gegen TOD 7 und darf nicht ueber den Code verstreut sein",
    },
    unreachableRowsHonest: {
      type: "boolean",
      description:
        "Zeilen ohne echten Ausloeser sind als solche ausgewiesen und nicht durch eine Deklarations-Prueferei kaschiert",
    },
    noSecretsLeaked: { type: "boolean" },
    existingAssertionsNotWeakened: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "scopeRespected",
    "noBehaviourChange",
    "noGapClosed",
    "testIsNotTautological",
    "completenessGuardWorks",
    "tableReadableInReview",
    "unreachableRowsHonest",
    "noSecretsLeaked",
    "existingAssertionsNotWeakened",
    "disclosureIntact",
    "safetyGatesIntact",
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase soll KEIN Verhalten aendern und dafuer sorgen, dass kuenftige Kosten-Aenderungen nicht mehr unbemerkt an einem der zwei Buecher vorbeilaufen.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
${KV_P1_SCOPE}
PRUEFE BESONDERS, jeweils SELBST am Code nachgerechnet - nicht dem Impl-Bericht glauben:
- testIsNotTautological: DAS IST DER WICHTIGSTE PUNKT. Lies den Test SELBST. Loest er fuer jede Zeile einen ECHTEN Buchungspfad aus und liest danach beide Buecher - oder vergleicht er nur Deklaration gegen Deklaration (bzw. gegen eine zweite Konstante, ein Fixture-Objekt, einen Regex ueber den Quelltext)? FUEHRE DIE MUTATION SELBST DURCH: lass EINE Tabellenzeile luegen (z.B. eine gate=nein-Zeile auf gate=ja drehen) und lauf den Test. Bleibt er gruen, ist er wertlos und das ist ein BLOCKER. Mutation zuruecknehmen.
- noBehaviourChange + noGapClosed: git diff auf src/store/state-ops.js, src/billing/**, src/telephony/call-finish.js, src/config.js. Jede geaenderte Bedingung, jeder geaenderte Filter, jeder geaenderte Betrag ist ein BLOCKER - auch wenn er "richtig" aussieht. Diese Phase deklariert, sie repariert nicht. Pruefe insbesondere, dass Inbound weiterhin NICHT auf die Gate-Achse bucht und SMS/TTS/DID-Miete weiterhin die Gate-Achse NICHT erreichen.
- completenessGuardWorks: fuege TESTWEISE einen neuen Wert in USAGE_EVENT_KIND ein, ohne Tabellenzeile. Wird der Test rot? Wenn nein, ist der Riegel wirkungslos - BLOCKER. Mutation zuruecknehmen.
- tableReadableInReview: ist die Tabelle an EINER Stelle, geschlossen, kurz? Eine ueber mehrere Dateien verstreute oder generierte Tabelle erfuellt TOD 7 nicht (der einzige Schutz ist, dass ein Mensch sie im Diff vollstaendig liest).
- unreachableRowsHonest: gibt es Zeilen, deren Test in Wahrheit nichts ausloest? Suche gezielt nach Tests, die zwar echt aussehen, aber nur ein Store-Objekt von Hand befuellen und dann sich selbst pruefen.
- existingAssertionsNotWeakened: git diff auf test/ genau lesen.
BEVOR du behauptest, ein Symbol/Feld existiere nicht: greppe am AUSGECHECKTEN BRANCH danach, nicht nur im Diff (Repo-Lehre KV-M0 - ein Feld kann ueber die Basis hereingekommen sein).
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
3. WICHTIG - PFLICHT VOR JEDEM "EXISTIERT NICHT"-BEFUND: greppe am ausgecheckten Branch (git grep <symbol> ${target}), nicht nur im Diff. Ein Symbol kann ueber die Basis hereingekommen sein und taucht dann im Diff nicht auf. Ein S1, der auf einer nicht durchgefuehrten Grep-Pruefung beruht, ist ein Fehlalarm und kostet eine ganze Runde (Repo-Lehre KV-M0).
4. Kategorie fuer Kategorie. Pro FLAG: "ID - Datei - Verstoss - Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
Achte besonders auf: (a) G27 Struktur > Konvention ist das THEMA dieser Phase - erzwingt die Loesung wirklich etwas, oder verlaesst sie sich auf Disziplin? (b) die Tabelle darf nicht dupliziert sein (G5/S2): eine Quelle, nicht eine im Code und eine im Test; (c) die Pflichtfelder brauchen eine echte Validierung, kein Kommentar-Versprechen; (d) die Verhaltenstests: ein Konzept pro Test (P14), Build-Operate-Check (P13), keine geteilte veraenderliche Fixture (P12/I), unterscheidbare Fixture-Werte je Fall (gleiche Werte testen nichts); (e) benannte Konstanten statt Magic Strings fuer die Feldwerte (G25); (f) Kommentare deutsch OHNE Umlaute; (g) toter/auskommentierter Code, ungenutzte Imports (C5/G9/G12).
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
    rejectedAsFalsePositive: {
      type: "array",
      items: { type: "string" },
      description:
        "Blocker, die du NICHT reproduzieren konntest - je mit dem Kommando und dem Ergebnis, das sie widerlegt",
    },
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
3. REPRODUZIERE JEDEN BLOCKER ZUERST. Ein Blocker ist eine Behauptung, kein Befund (Repo-Lehre KV-M0: ein Auditor meldete einmal "Feld existiert nicht", obwohl es ueber die Basis hereingekommen war). Was sich nicht reproduzieren laesst, kommt nach rejectedAsFalsePositive mit Kommando und Ergebnis - NICHT "fixen".
4. Behebe die reproduzierbaren Blocker, fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${KV_P1_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
5. node --check + npm test gruen. Dateien EINZELN adden (nie git add -A), kein git stash. node_modules NICHT committen.
6. **COMMITTE IMMER**, auch wenn ALLE Blocker Fehlalarme waren: dann committe eine Klarstellung (z.B. einen praezisierenden Kommentar oder einen Test, der den vermeintlichen Defekt widerlegt) mit "fix(kv-p1): Review-Blocker geprueft (Runde ${round})". Ein ausbleibender Commit beendet die Schleife und laesst die Phase auf BLOCKED stehen, obwohl nichts kaputt ist. headCommit = git rev-parse HEAD.
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
  if (fix && Array.isArray(fix.rejectedAsFalsePositive) && fix.rejectedAsFalsePositive.length) {
    fixSummaries.push(
      `r${round} FEHLALARME: ${fix.rejectedAsFalsePositive.join(" | ").slice(0, 600)}`,
    );
  }
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
EHRLICHKEITSREGEL: dieser Bericht darf KEINE Absicherung behaupten, die nicht am Verhalten belegt ist. Wenn eine Zeile der Landkarte nur deklariert und nicht gegen einen echten Buchungspfad geprueft ist, MUSS das dort stehen - eine Landkarte, der man das nicht ansieht, ist gefaehrlicher als keine.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; die Landkarte (costMapTable) woertlich als Tabelle; die Ausloeser-Tabelle (triggerTable) woertlich - sie ist der Beweis, dass der Test nicht tautologisch ist; der tautologyGuard; die Zeilen ohne echten Ausloeser (unreachableRows) als eigener, deutlicher Abschnitt; der Vollstaendigkeits-Riegel und der Ein-Aufrufer-Riegel mit Belegen; Mutationsproben; angepasste Bestandstests; Safety-Urteil; Clean-Code-Audit; Fix-Runden inkl. etwaiger Fehlalarme; Abweichungen zwischen Plan-Doc und echtem Code (findingsNotFixed) als eigener Abschnitt - die sind fuer KV-P2/P3 wertvoll; ein Abschnitt "Wie die naechsten Phasen diese Tabelle benutzen": jede Bau-Phase kippt GENAU EINE Zeile von nein auf ja, und der Test erzwingt, dass die Realitaet mitkippt (KV-P2 kippt voice_minute/inbound). Quelle:
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
  gatesRedCount: (impl && impl.gatesRedCount) ?? null,
  costMapTable: (impl && impl.costMapTable) || "",
  triggerTable: (impl && impl.triggerTable) || "",
  tautologyGuard: (impl && impl.tautologyGuard) || "",
  unreachableRows: (impl && impl.unreachableRows) || [],
  completenessGuardProof: (impl && impl.completenessGuardProof) || "",
  singleCallerProof: (impl && impl.singleCallerProof) || "",
  noBehaviourChange: impl ? impl.noBehaviourChange === true : false,
  mutationProbeResult: (impl && impl.mutationProbeResult) || "",
  findingsNotFixed: (impl && impl.findingsNotFixed) || [],
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
