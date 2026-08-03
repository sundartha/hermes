// PER-RUN-Skript KV-M3 (Phase HART GEPINNT).
// Schema traegt NUR Skalare mit Laengenlimit (Lehre: 16-KB-Nutzlast toetet den Lauf).

export const meta = {
  name: "phase-impl-lean",
  description:
    "KV-M3: die Deckungsquote misst, was belegbar ist - richtiger Nenner plus drei Nebenzaehler gegen Schoenrechnerei.",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/kv-m3-report.md" },
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
const PHASE = "KV-M3";
const PHASE_TITLE = "Die Deckungsquote misst, was belegbar ist";
const BRANCH = "phase/kv-m3-deckungsquote";
const BASE = "master";
const PLAN_DOC = "tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/kv-m3-report.md";

const MODEL_SONNET = "sonnet";

// Modellpolitik (Kickoff KV-Kette): KV-M3 aendert eine WARN-Meldung, keinen Sperrpfad
// -> komplett Sonnet. Pins explizit pro agent(), nie erben lassen.
const PLAN_AGENT = { model: MODEL_SONNET, effort: "medium" };
const IMPL_AGENT = { model: MODEL_SONNET };
const SAFETY_AGENT = { model: MODEL_SONNET, effort: "medium" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const SCHEMA_RULE = `SCHEMA-REGEL (bindend, sonst stirbt der Lauf): JEDES Textfeld deiner StructuredOutput-Antwort bleibt KURZ - hoechstens etwa 400 Zeichen, KEINE Markdown-Tabellen, KEINE Code-Bloecke, KEINE langen eingebetteten Zeilenumbrueche. Alles Umfangreiche schreibst du in eine DATEI und nennst im Feld nur den Pfad plus einen Satz. Ein Vorlauf dieser Kette ist an einer 16-KB-Nutzlast gestorben, nachdem die Arbeit bereits committet war.`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md". Insbesondere: keine Duplizierung (G5/S2 - die Zaehler duerfen nicht zweimal berechnet werden); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante); Bedingungen einkapseln und benennen (G28/G19 - "ist dieser Call belegbar?" ist ein Praedikat mit Namen, kein Inline-Ausdruck); C2 - ueberholte Kommentare mitziehen; N1/N7 - sprechende Namen; eine Aufgabe pro Funktion (G30); ESM, kein Build-Step, kein TypeScript. Tests: ein Konzept pro Test (P14), Grenzfaelle (T5 - leerer Nenner!), Build-Operate-Check (P13), unterscheidbare Fixture-Werte je Fall.
PFLICHT VOR JEDEM "EXISTIERT NICHT"-BEFUND: greppe am AUSGECHECKTEN BRANCH, nicht nur im Diff (Repo-Lehre KV-M0).
UMLAUT-REGEL: Kommentare und Identifier OHNE Umlaute (ue/oe/ae).`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE entfernen/aufweichen. Diese Phase aendert eine WARN-Meldung, KEINEN Sperrpfad.
- Die pro-Tenant-Kostendecke, die Signaturpruefung, OUTBOUND_FROZEN und alle uebrigen Gates bleiben unberuehrt.
- SECRETS nur via env, nie loggen. AUTH FAIL-CLOSED: keine neue Route.
- Disclosure-Satz unberuehrt.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const KV_M3_SCOPE = `SCOPE DIESER PHASE (bindend):

DER BEFUND (N4 im Plan): \`costTruingCoveragePercent\` rechnet heute \`belegt / ALLE beendeten Calls\`. Im Prod-Bestand (Stand vor KV-P3) waren das 31 beendete Outbound-Calls: 9 nie beantwortet (es gibt nichts zu belegen), 14 ohne persistierte Schaetzung (aus der Zeit vor LCT-P2, landen in \`no_estimate\`), und 8 mit Schaetzung und Beleg - **8 von 8 belegbaren sind belegt**. Die erreichbare Quote war damit 25 %, die Schwelle steht auf 80. **Die Warnung kann strukturell nicht gruen werden.** Sie misst nicht unsere Belegdichte, sondern unser Datenalter - und sie haelt zugleich den Tarif-Untergrenzen-Hinweis (\`voiceTariffFloorFindings\` im Boot-Guard) dauerhaft im Zweig "duenne Deckung". Eine Warnung, die nie gruen werden kann, wird zur Tapete.

TEIL 1 - Der richtige Nenner:
- Der Nenner wird auf die Calls beschraenkt, die ueberhaupt einen Beleg haben KOENNEN: beantwortet, mit persistierter Schaetzung, beendet innerhalb des Provider-Belegfensters.
- **Das Belegfenster ist selbst am Code zu ermitteln** - der Provider haelt Detail-Records nur begrenzt vor. Finde die massgebliche Groesse selbst (grep, nicht raten) und benenne sie. Existiert sie im Code nicht, ist DAS der Befund: dann gehoert sie als benannte Konstante angelegt, mit Begruendung, statt eine Zahl zu erfinden.
- Das Praedikat "ist dieser Call belegbar?" bekommt einen NAMEN und lebt an EINER Stelle (G28/G5). Es wird nicht an zwei Orten inline nachgebaut.

TEIL 2 - Die drei Nebenzaehler (Pre-Mortem TOD 8, NICHT optional):
Die herausgenommenen Gruppen verschwinden NICHT, sondern bekommen eigene Zaehler in DERSELBEN Log-Zeile: \`ohne_schaetzung=\`, \`nie_beantwortet=\`, \`ausserhalb_fenster=\`.
**Ohne sie tauscht diese Phase eine unbrauchbare Zahl gegen eine geschoenigte.** Eine Quote von 100 % bei \`ohne_schaetzung=14\` ist eine voellig andere Aussage als 100 % bei \`ohne_schaetzung=0\`, und beide muessen nebeneinander stehen. Ein Diff, der den Nenner verengt, ohne die drei Zaehler danebenzustellen, ist ein BLOCKER.

TEIL 3 - Die Nebenwirkung, die benannt werden MUSS:
Sobald die Quote ueber \`COST_TRUING_MIN_COVERAGE_PERCENT\` liegt, VERSTUMMT der Tarif-Untergrenzen-Hinweis. Das ist kein geschwaechtes Gate (es ist eine WARN-Meldung, kein Sperrpfad), aber es ist eine Verhaltensaenderung an einer Kosten-Sicherung. Sie ist Owner-entschieden (Entscheidung 5 = (a), ja, mit den drei Nebenzaehlern) und gehoert ausdruecklich in PLAN-SECURITY.md - nicht als Fussnote, sondern als Satz mit der Begruendung, warum eine strukturell rote Warnung schaedlicher ist als eine verstummte.

TEIL 4 - Wechselwirkung mit KV-P3 (bereits gemergt):
Seit KV-P3 laufen auch INBOUND-Calls durch den Abgleich und stehen damit im Nenner. Der neue Nenner traegt das, weil er auf "belegbar" filtert und nicht auf "outbound". **Der Test bekommt einen Inbound-Fall** - das ist ausdruecklich Teil dieser Phase.

DIE PFLICHT-ABNAHMEN:
(1) EIN Test mit EINER gemischten Fixture, die alle vier Gruppen enthaelt (belegt / ohne Schaetzung / nie beantwortet / ausserhalb des Fensters) plus mindestens einen Inbound-Fall. Er pinnt BEIDE Zahlen: was die ALTE Formel ergeben haette und was die NEUE ergibt. Beide Zahlen stehen im Test, damit der Unterschied im Diff sichtbar ist.
(2) Die drei Nebenzaehler sind in der Log-Zeile und im Rueckgabewert vorhanden und tragen die richtigen Werte fuer diese Fixture.
(3) Grenzfall: leerer Nenner (kein einziger belegbarer Call). Die Quote darf NICHT NaN, nicht Infinity und nicht faelschlich 100 sein. Entscheide begruendet, was sie sein soll, und pinne es.
(4) Mutationsprobe: die ALTE Nenner-Definition wieder einsetzen -> Test rot.
KEINE Behauptung ueber den heutigen Prod-Bestand im Test. Die 8/31 sind historischer Kontext aus dem Plan, kein aktueller Messwert - der Test rechnet gegen seine eigene Fixture.

TEST-IDs: "KV-M3-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer).

NICHT-ZIELE (ausdruecklich):
- KEINE Aenderung an der Schwelle \`COST_TRUING_MIN_COVERAGE_PERCENT\` - die Formel wird richtig, nicht die Schwelle bequem.
- KEINE Aenderung am Ist-Abgleich selbst, an der Kandidatenauswahl, an der Delta-Buchung, an der Gate-Achse oder an der Landkarte (kein ledger/gate-Wert).
- KEINE neue DB-Spalte, KEIN Backfill.
- KEINE neue Env-Variable, es sei denn das Belegfenster existiert im Code nicht - dann mit voller Verdrahtung (config.js + .env.example + render.yaml + BASE_ENV in test/helpers.js).
- NIEMALS "git stash". NIEMALS "git add -A". Dateien EINZELN adden.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies "${REPO}/${PLAN_DOC}": den Abschnitt "KV-M3", den Befund N4, das Pre-Mortem TOD 8 und die Owner-Entscheidung 5. Lies ausserdem "${REPO}/tasks/kv-p3-report.md" (die Vorphase - Inbound ist jetzt im Abgleich).
2. Lies "${REPO}/.claude/refs/clean-code.md" und "${REPO}/CLAUDE.md".
3. Lies den ECHTEN Code auf Basis "${BASE}" - grep nach Symbolen, uebernimm KEINE Zeilennummern:
   - src/billing/cost-truing.js VOLLSTAENDIG: \`costTruingCoveragePercent\`, \`isEndedCall\`, \`isTruingCandidate\`, die Log-Zeile des Sweeps, \`costTruedSource\`-Werte
   - src/boot-guard.js: \`voiceTariffFloorFindings\` - wie liest es die Quote, und was passiert, wenn sie ueber der Schwelle liegt?
   - src/config.js: \`costTruingMinCoveragePercent\`, \`costTruingDelayMinutes\`, und ob es irgendwo ein Provider-BELEGFENSTER gibt (Aufbewahrungsdauer der Detail-Records). Grep breit - wenn es das nicht gibt, ist das ein Befund.
   - src/store/state-ops.js: die Call-Felder \`answeredAt\`, \`estimatedCostCents\`, \`endedAt\`, \`costTruedAt\`, \`costTruedSource\`
   - test/cost-truing-observe.test.js und test/cost-truing-harness.js: die bestehenden Fixtures und wie sie den Sweep fahren
4. ENTSCHEIDE UND BEGRUENDE:
   (a) Wie heisst das Praedikat "belegbar", wo lebt es, und wie ist ausgeschlossen, dass es an zwei Stellen inline nachgebaut wird?
   (b) Woher kommt das Belegfenster? Wenn es im Code keine Groesse dafuer gibt: schlaegst du eine benannte Konstante vor (mit welcher Begruendung fuer welchen Wert) oder laesst du das Kriterium weg und benennst das als bewusste Luecke? Beides ist vertretbar - Raten ist es nicht.
   (c) Wie sehen die Log-Zeile und der Rueckgabewert nach der Aenderung aus, woertlich?
   (d) Was ist die Quote bei leerem Nenner, und warum ist genau das die richtige Antwort? (100 % waere eine Luege, NaN ein Defekt, 0 % eine Dauerwarnung.)
   (e) Verstummt der Tarif-Untergrenzen-Hinweis mit dem heutigen Datenbestand tatsaechlich? Beschreib den Wirkungsweg von der Quote zum Boot-Guard.
5. Nenne ausdruecklich, welche Bestandstests kippen und wie du mit jedem umgehst - besonders test/cost-truing-observe.test.js "(i)", das KV-P3 gerade erst gedreht hat.
6. PRE-MORTEM: ein Jahr spaeter hat KV-M3 Schaden angerichtet. Was ist passiert? Nenne mindestens: die Quote steht auf 100 %, niemand schaut mehr hin, und ein echter Belegausfall faellt Monate spaeter auf; das Praedikat "belegbar" wurde so weit gefasst, dass es faktisch alles ausschliesst, was Probleme macht; der leere Nenner liefert 100 % und die Warnung ist fuer immer still. Fuer jedes: die Gegenmassnahme.
${KV_M3_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die exakten Edits je Datei; (2) die Log-Zeile im Wortlaut, vorher und nachher; (3) die Tests KV-M3-* mit konkreten Assertions und der gemischten Fixture (inkl. Inbound-Fall und leerem Nenner); (4) die Mutationsprobe; (5) den PLAN-SECURITY.md-Text ausformuliert; (6) das Pre-Mortem. Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan", ...PLAN_AGENT },
);

// ---------- Phase 2: Implementieren ----------
phase("Implementieren");
const IMPL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    filesEdited: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    existingTestsAdjusted: {
      type: "array",
      items: { type: "string" },
      description: "Je Bestandstest: ID - alte Zusage - neue Zusage - Begruendung. Je Eintrag hoechstens 250 Zeichen.",
    },
    predicateName: {
      type: "string",
      description: "Name und Fundort des 'belegbar'-Praedikats; wie ist Duplizierung ausgeschlossen? Hoechstens 300 Zeichen.",
    },
    proofWindowDecision: {
      type: "string",
      description:
        "Belegfenster: im Code gefunden (wo, welcher Wert) ODER neu angelegt (welcher Wert, welche Begruendung) ODER bewusst weggelassen (warum). Hoechstens 400 Zeichen.",
    },
    logLineAfter: {
      type: "string",
      description: "Die neue Log-Zeile im Wortlaut, mit Beispielwerten. Hoechstens 350 Zeichen.",
    },
    sideCountersPresent: {
      type: "boolean",
      description: "ohne_schaetzung, nie_beantwortet, ausserhalb_fenster stehen in DERSELBEN Log-Zeile und im Rueckgabewert",
    },
    emptyDenominatorBehaviour: {
      type: "string",
      description: "Was liefert die Quote bei leerem Nenner, und welcher Test pinnt es? Hoechstens 250 Zeichen.",
    },
    oldVsNewNumbers: {
      type: "string",
      description:
        "Die gemischte Fixture: was haette die ALTE Formel ergeben, was ergibt die NEUE? Beide Zahlen und die Gruppengroessen. Hoechstens 350 Zeichen.",
    },
    inboundCaseInFixture: { type: "boolean", description: "Die Fixture enthaelt mindestens einen Inbound-Fall (KV-P3)" },
    thresholdUntouched: { type: "boolean", description: "COST_TRUING_MIN_COVERAGE_PERCENT unveraendert" },
    tariffHintEffect: {
      type: "string",
      description: "Verstummt der Tarif-Untergrenzen-Hinweis? Wirkungsweg kurz. Hoechstens 300 Zeichen.",
    },
    noMapValueChanged: { type: "boolean", description: "Kein ledger/gate-Wert in der Landkarte geaendert" },
    planSecurityUpdated: { type: "boolean" },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    mutationProbeResult: { type: "string", description: "Hoechstens 400 Zeichen" },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string", description: "Hoechstens 500 Zeichen" },
  },
  required: [
    "headCommit",
    "predicateName",
    "proofWindowDecision",
    "logLineAfter",
    "sideCountersPresent",
    "emptyDenominatorBehaviour",
    "oldVsNewNumbers",
    "inboundCaseInFixture",
    "thresholdUntouched",
    "tariffHintEffect",
    "noMapValueChanged",
    "planSecurityUpdated",
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
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert). Setze Phase ${PHASE} GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. REGEL 0: ZUERST \`git checkout -b ${BRANCH} ${BASE}\`, DANN erst lesen.
3. Umsetzung: Praedikat + Nenner + drei Nebenzaehler + Tests KV-M3-* + PLAN-SECURITY.md.
4. node --check auf jede geaenderte src-Datei, dann npm test gruen. Dateien EINZELN adden, committen: "feat(kv-m3): Deckungsquote misst, was belegbar ist - plus drei Nebenzaehler".
${KV_M3_SCOPE}
${CLEAN_CODE_REQ}
5. npm test MUSS gruen sein. Kippende Bestandstests einzeln in existingTestsAdjusted begruenden.
   HINWEIS ZU FLAKES: test/auth-p9a-cache-headers.test.js und einige Spawn-Tests werden unter Volllast rot, sind isoliert aber gruen (bekanntes Repo-Muster). Wird ein Test rot, fahr ihn ISOLIERT nach (node --test <datei>) und melde beides. Nicht "reparieren", was isoliert gruen ist.
6. npm run test:gates zusaetzlich (DARF rot sein). HINWEIS: auth-p9a-cache-headers haengt bekanntermassen unter --test-name-pattern - wenn der Lauf haengt, brich ab und melde es.
7. MUTATIONSPROBE: die ALTE Nenner-Definition wieder einsetzen -> der KV-M3-Test MUSS rot werden. Zuruecknehmen, npm test erneut gruen. Der finale Diff darf keine Mutation tragen.
8. node_modules-Symlink NICHT committen. Nach dem Lauf: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${SCHEMA_RULE}
${ABS_RULES}
EHRLICH fuellen. sideCountersPresent ist der Punkt, an dem diese Phase gut oder schaedlich wird: ohne die drei Zaehler ist sie Schoenrechnerei.`,
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
    independentTestSummary: { type: "string", description: "Hoechstens 300 Zeichen" },
    scopeRespected: { type: "boolean" },
    sideCountersPresent: {
      type: "boolean",
      description: "SELBST geprueft: alle drei Nebenzaehler stehen in DERSELBEN Log-Zeile - sonst ist es Schoenrechnerei",
    },
    predicateNotTooWide: {
      type: "boolean",
      description:
        "SELBST geprueft: das 'belegbar'-Praedikat schliesst NICHT alles aus, was Probleme macht. Ein Call mit Schaetzung und fehlendem Beleg MUSS im Nenner bleiben - sonst kann die Quote nie schlecht werden.",
    },
    noBlockingPathChanged: {
      type: "boolean",
      description: "Nur eine WARN-Meldung aendert sich; kein Sperrpfad, kein Gate, keine Schwelle",
    },
    thresholdUntouched: { type: "boolean" },
    emptyDenominatorSafe: { type: "boolean", description: "Leerer Nenner liefert weder NaN noch Infinity noch faelschlich 100" },
    truingLogicUntouched: {
      type: "boolean",
      description: "Kandidatenauswahl, Delta-Buchung, Gate-Achse und Landkarte unveraendert",
    },
    inboundCounted: { type: "boolean", description: "Inbound-Calls sind im neuen Nenner beruecksichtigt (KV-P3)" },
    planSecurityUpdated: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
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
    "scopeRespected",
    "sideCountersPresent",
    "predicateNotTooWide",
    "noBlockingPathChanged",
    "thresholdUntouched",
    "emptyDenominatorSafe",
    "truingLogicUntouched",
    "inboundCounted",
    "planSecurityUpdated",
    "noSecretsLeaked",
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase laesst eine bestehende Kosten-Warnung verstummen - das ist Owner-entschieden, aber es muss RICHTIG gemacht sein, sonst tauscht sie eine unbrauchbare Zahl gegen eine geschoenigte.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen. HINWEIS: auth-p9a-cache-headers und einige Spawn-Tests sind unter Volllast flaky, isoliert aber gruen - wird etwas rot, isoliert nachfahren und beides melden.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
${KV_M3_SCOPE}
PRUEFE BESONDERS, jeweils SELBST am Code nachgerechnet:
- predicateNotTooWide: DAS IST DER WICHTIGSTE PUNKT. Ein Nenner, der alles ausschliesst, was Probleme macht, liefert immer 100 % und ist wertlos. Pruefe konkret: bleibt ein Call MIT Schaetzung, MIT Antwort, INNERHALB des Fensters, aber OHNE Beleg im Nenner? Er MUSS - genau er ist der Fall, den die Quote messen soll. Faellt er heraus, ist das ein BLOCKER.
- sideCountersPresent: stehen alle drei Zaehler in DERSELBEN Log-Zeile wie die Quote? Eine Quote ohne sie ist die Schoenrechnerei, gegen die TOD 8 schuetzt - BLOCKER.
- emptyDenominatorSafe: was liefert die Formel bei 0 belegbaren Calls? NaN, Infinity oder ein faelschliches 100 % sind BLOCKER.
- noBlockingPathChanged + thresholdUntouched + truingLogicUntouched: git diff. Diese Phase darf NUR die Quote und die Log-Zeile aendern. Jede Aenderung an der Kandidatenauswahl, der Delta-Buchung, der Gate-Achse, der Landkarte oder der Schwelle ist scope-fremd und ein BLOCKER.
- inboundCounted: seit KV-P3 laufen Inbound-Calls durch den Abgleich. Sind sie im neuen Nenner? Ein Nenner, der sie stillschweigend ausschliesst, misst wieder das Falsche.
- existingAssertionsNotWeakened: git diff auf test/ genau lesen, besonders cost-truing-observe.test.js.
BEVOR du behauptest, ein Symbol existiere nicht: greppe am AUSGECHECKTEN BRANCH (Repo-Lehre KV-M0).
${SCHEMA_RULE}
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
        `CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${target}", Basis "${BASE}").
1. ln -s "${NODE_MODULES}" node_modules ; git checkout -b cc-${String(PHASE).toLowerCase()}${suffix} ${target}
2. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG.
3. git diff ${BASE} ${target} ; neue Dateien vollstaendig lesen.
4. PFLICHT VOR JEDEM "EXISTIERT NICHT"-BEFUND: git grep am ausgecheckten Branch (Repo-Lehre KV-M0). grepCheckDone erst true, wenn wirklich getan.
5. Kategorie fuer Kategorie. Pro FLAG: "ID - Datei - Verstoss - Fix" + Schweregrad. S3/S4 gebuendelt.
Achte besonders auf: (a) G5/S2 - das 'belegbar'-Praedikat und die vier Gruppenzaehler duerfen NICHT mehrfach berechnet werden; eine Quelle, aus der Quote und Zaehler gemeinsam fallen; (b) G28/G19 - die Bedingung ist benannt und eingekapselt, kein zusammengesetzter Inline-Ausdruck im if; (c) G25 - benannte Konstanten fuer Fenster und Schwellen; (d) G26/S1 - eine Prozentrechnung mit Ganzzahlen: pruefe Rundung und Division durch 0; (e) die Tests: ein Konzept pro Test (P14), Grenzfall leerer Nenner als EIGENER Fall (T5), unterscheidbare Fixture-Werte je Gruppe (gleiche Werte testen nichts); (f) C2 - Kommentare ueber den alten Nenner mitgezogen; (g) Kommentare deutsch OHNE Umlaute; (h) toter Code, ungenutzte Imports.
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

// ---------- Phase 4: Self-Fix ----------
const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    addressed: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 250 Zeichen" },
    rejectedAsFalsePositive: {
      type: "array",
      items: { type: "string" },
      description: "Nicht reproduzierbare Blocker - mit Kommando und Ergebnis. Je Eintrag hoechstens 250 Zeichen.",
    },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    committed: { type: "boolean" },
    summary: { type: "string", description: "Hoechstens 400 Zeichen" },
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
3. REPRODUZIERE JEDEN BLOCKER ZUERST (Repo-Lehre KV-M0). Nicht Reproduzierbares nach rejectedAsFalsePositive mit Kommando und Ergebnis - NICHT "fixen". Ein unter Volllast roter, isoliert gruener Test ist ein Flake, kein Blocker.
4. Behebe die reproduzierbaren Blocker, fuer jeden korrektheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${KV_M3_SCOPE}
${CLEAN_CODE_REQ}
${SCHEMA_RULE}
${ABS_RULES}
5. node --check + npm test gruen. Dateien EINZELN adden, kein git stash.
6. **COMMITTE IMMER**, auch wenn ALLE Blocker Fehlalarme waren (dann eine Klarstellung committen) mit "fix(kv-m3): Review-Blocker geprueft (Runde ${round})". Ohne Commit bleibt die Phase auf BLOCKED, obwohl nichts kaputt ist. headCommit = git rev-parse HEAD.`,
    {
      label: `${PHASE}-fix-r${round}`,
      phase: "Self-Fix",
      schema: FIX_SCHEMA,
      isolation: "worktree",
      ...FIX_AGENT,
    },
  );
  fixSummaries.push(`r${round}: ${fix && fix.summary ? fix.summary.slice(0, 300) : "(kein Ergebnis)"}`);
  if (fix && Array.isArray(fix.rejectedAsFalsePositive) && fix.rejectedAsFalsePositive.length) {
    fixSummaries.push(`r${round} FEHLALARME: ${fix.rejectedAsFalsePositive.join(" | ").slice(0, 500)}`);
  }
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
    `Schreibe den Bericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
EHRLICHKEITSREGEL: kein Schutz behaupten, der nicht belegt ist. Ausdruecklich hinein: diese Phase laesst eine bestehende Warnung verstummen (Owner-Entscheidung 5a); der einzige Schutz dagegen, dass danach niemand mehr hinschaut, sind die drei Nebenzaehler in derselben Log-Zeile - benenne, dass das schwaecher ist als ein Mechanismus.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; der Befund N4 kurz; was gebaut wurde; das 'belegbar'-Praedikat und wo es lebt; die Entscheidung zum Belegfenster; die Log-Zeile vorher/nachher im Wortlaut; die gemischte Fixture mit ALT- und NEU-Zahl; das Verhalten bei leerem Nenner; der Inbound-Fall (KV-P3); die Mutationsprobe; die Nebenwirkung (Tarif-Untergrenzen-Hinweis verstummt) mit Wirkungsweg; angepasste Bestandstests; Safety-Urteil; Clean-Code-Audit; Fix-Runden inkl. Fehlalarme; ein Abschnitt "Was diese Phase NICHT tut" (Schwelle unveraendert, Abgleich-Logik unveraendert, keine Landkarten-Zeile gekippt); ein Abschnitt "Was der Lead nach dem Deploy pruefen muss": die erste Sweep-Log-Zeile in Prod ablesen und die vier Zahlen (Quote + drei Nebenzaehler) in ${PLAN_DOC} eintragen. Quelle:
=== PLAN ===
${(plan || "").slice(0, 10000)}
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
  predicateName: (impl && impl.predicateName) || "",
  proofWindowDecision: (impl && impl.proofWindowDecision) || "",
  logLineAfter: (impl && impl.logLineAfter) || "",
  sideCountersPresent: impl ? impl.sideCountersPresent === true : false,
  emptyDenominatorBehaviour: (impl && impl.emptyDenominatorBehaviour) || "",
  oldVsNewNumbers: (impl && impl.oldVsNewNumbers) || "",
  inboundCaseInFixture: impl ? impl.inboundCaseInFixture === true : false,
  thresholdUntouched: impl ? impl.thresholdUntouched === true : false,
  tariffHintEffect: (impl && impl.tariffHintEffect) || "",
  planSecurityUpdated: impl ? impl.planSecurityUpdated === true : false,
  mutationProbeResult: (impl && impl.mutationProbeResult) || "",
  existingTestsAdjusted: (impl && impl.existingTestsAdjusted) || [],
  filesTouched: ((impl && impl.filesEdited) || []).slice(0, 40),
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
  summary: impl && impl.summary ? impl.summary.slice(0, 600) : "",
};
