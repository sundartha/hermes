// GEZIELTE NACHBESSERUNG (schlank): E3B endete BLOCKED mit GENAU ZWEI benannten Blockern.
// Kein voller 5-Phasen-Lauf - ein Fixer, ein Safety-Reviewer, bis zu zwei Runden.

export const meta = {
  name: "outbound-e3b-nachbesserung",
  description:
    "OUTBOUND-E3B Nachbesserung: (1) keine Entwarnung ohne Verkehr, (2) fehlender Abnahmepunkt C8 (24-h-Eskalation eines HOLD). Fix -> gezielter Review -> ggf. zweite Runde.",
  phases: [
    { title: "Fix", detail: "Die zwei benannten Blocker beheben, sonst nichts", model: "sonnet" },
    { title: "Review", detail: "Gezielter Safety-Review der zwei Punkte + volle Regression", model: "opus" },
  ],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;
const BASE = "phase/outbound-e3b-betreiber-alarm-fix4";
const BRANCH = "phase/outbound-e3b-nachbesserung";
const MASTER = "master";
const PLAN_DOC = "PLAN-OUTBOUND-RESILIENZ.md";
const TEST_CMD = `LLM_PROVIDER=anthropic npm test`;
const TEST_FLOOR = 5193; // Lead-Messung auf master nach E3a-Merge
const MAX_ROUNDS = 2;

const FIX_AGENT = { model: "sonnet", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };

const BLOCKER_1 = `BLOCKER 1 - FALSCHE ENTWARNUNG BEI NULL VERKEHR (vom Reviewer selbst gemessen):
runOutageRecoverySweep (src/telephony/outage-report.js) fragt beurteileAusfall, und beurteileAusfall
(src/telephony/outage-detection.js) urteilt RECOVERED allein aus "fenster.fehler === 0" - ohne jeden
Beleg, dass ueberhaupt ein Anruf stattgefunden hat. Gemessenes Szenario: offener Marker + NULL Anrufe
im Fenster -> Audit-/Logzeile "outage_recovered ... fehler=0 versuche=0" UND closedAt wird auf dem
DURABLEN Marker gesetzt. Wirkung im echten Verkehrsregime dieses Produkts (rund ein Anruf pro Woche):
Alarm um T, Sweep stuendlich, Fenster 60 min -> spaetestens T+2h steht "erholt" im Log, waehrend die
Konfiguration unveraendert kaputt ist. Das ist die Umkehrung des Plan-Zwecks ("damit Stille eindeutig
ist") und faellt zugleich ein positives Gesundheits-Urteil ueber genau den Fall, den der Lead E4
zugewiesen hat.
FIX (vom Reviewer vorgezeichnet): RECOVERED nur bei nachgewiesenem Verkehr im Fenster - also
fenster.versuche > 0, besser noch fenster.erfolge > 0 (ein Fenster voller Fehlversuche ist keine
Erholung). Sonst Urteil NONE und der Marker BLEIBT OFFEN.
PFLICHT-TEST: "offener Marker + LEERES Fenster -> KEINE Audit-Zeile, Marker bleibt offen". Der
bestehende Fall M9 in test/ausfall-meldeweg.test.js nutzt einen erfolgreichen Anruf und deckt den
leeren Fall NICHT ab.`;

const BLOCKER_2 = `BLOCKER 2 - ABNAHMEPUNKT C8 FEHLT VOLLSTAENDIG UND UNDEKLARIERT:
"${PLAN_DOC}" listet in Etappe E3b den Abnahmepunkt C8 samt Testdatei
test/platform-number-hold-eskalation.test.js: "ein HOLD platform_number_in_use, der laenger als 24 h
besteht, erzeugt genau einen Betreiber-Befund ueber denselben Meldeweg". Abschnitt 9 des Plans haelt
dazu die Owner-Entscheidung F-8 fest ("Ja, mit HOLD + Audit + 24-h-Eskalation"). Der Reviewer hat
selbst geprueft: die Testdatei existiert nicht, und es gibt keine zeitbasierte HOLD-Eskalation im Code.
E1 liefert nur den Zustand: src/release-reconcile.js schreibt bei JEDEM Sweep eine WARN-Zeile und bei
jedem Erase-Versuch eine Audit-Zeile - wiederholtes Rauschen ohne Alters-Schwelle und ohne "genau
einmal".
FIX: C8 bauen - ueber DENSELBEN Meldeweg wie der Ausfall-Alarm (kein zweiter Kanal, keine zweite
Entprellung): ein HOLD, der aelter als die Schwelle ist, erzeugt GENAU EINEN Betreiber-Befund, und
zwar dauerhaft entprellt (der naechste Sweep wiederholt ihn NICHT). Schwelle als benannte Konstante
bzw. Env-Wert, kein Magic Number. Der Marker muss - wie beim Ausfall-Alarm - einen Neustart ueberleben.
PFLICHT-TESTS: (a) HOLD juenger als die Schwelle -> KEIN Befund (Positiv-Kontrolle der Gegenrichtung);
(b) HOLD aelter als die Schwelle -> GENAU EIN Befund; (c) zweiter Sweep danach -> KEIN weiterer Befund;
(d) Neustart dazwischen -> immer noch kein zweiter Befund.
Falls C8 aus einem am Code belegbaren Grund nicht baubar ist, ist das KEINE stille Auslassung: dann
schreibst du die Abweichung mit Begruendung in den Report und meldest sie in deviations.`;

const REGELN = `RAHMEN (unantastbar):
- Safety-Gates NIE anfassen; Offenlegung/callee_is_owner nicht beruehren; Auth fail-closed; Secrets nie
  loggen; AUDIO nie durch MCP. KEINE echten Anrufe/SMS/Mails, KEINE Provider-Schreibzugriffe, KEIN Deploy.
- PII: der Betreiber-Befund traegt KEINE Rufnummern, Namen oder Gespraechsinhalte - nur Klasse, Zahlen,
  Zeitfenster. Per Regex testen.
- SCOPE: NUR die zwei Blocker. Kein Umbau der Erkennungsregel, kein Vorgriff auf E4/E5, kein bridge.js.
  Die 14 bereits abgenommenen Pruefpunkte der Etappe duerfen sich NICHT verschlechtern.
- CLEAN-CODE (${REPO}/.claude/refs/clean-code.md): EINE Erkennungsstelle, EIN Meldeweg; Schwellen als
  benannte Konstanten; reine Urteilsfunktion ohne Seiteneffekt; Kommentare deutsch OHNE Umlaute.
- LINT: npm run lint (VOLL, im Worktree) = 0 Fehler. Gepinnte Altlast-Werte NICHT anheben - Loesung so
  bauen, dass die Pins halten (E2/E3a-Lehre). Suppressions nur fuer Diff-eigene Dateien.
- Waehrend eines laufenden Testlaufs KEINE Dateien aendern und NIE zwei Suiten gleichzeitig fahren
  (E2/E3a-Lehre: erzeugt Scheinfehler).`;

const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    filesTouched: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    blocker1Proof: {
      type: "string",
      description: "AUSGEFUEHRT: offener Marker + leeres Fenster -> keine Entwarnung, Marker bleibt offen. Kommando + Ausgabe",
    },
    blocker1PositivKontrolle: {
      type: "string",
      description: "AUSGEFUEHRT: echte Erholung (Verkehr vorhanden, keine Fehler) wird WEITERHIN als erholt gemeldet. Kommando + Ausgabe",
    },
    blocker2Proof: {
      type: "string",
      description: "C8 AUSGEFUEHRT: alter HOLD -> genau EIN Befund; zweiter Sweep -> keiner; Neustart -> keiner; junger HOLD -> keiner. Kommando + Ausgabe",
    },
    keineVerschlechterungProof: {
      type: "string",
      description: "Die 14 abgenommenen Punkte der Etappe unveraendert (Ausfall-Erkennung, kein Fehlalarm, Neustart, Meldeweg, PII, Reihenfolge-Riegel). Kommando + Ausgabe",
    },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    lintProof: { type: "string" },
    gatesProof: { type: "string" },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "blocker1Proof",
    "blocker1PositivKontrolle",
    "blocker2Proof",
    "keineVerschlechterungProof",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "lintProof",
    "gatesProof",
    "committed",
    "summary",
  ],
};

const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    blocker1Behoben: {
      type: "boolean",
      description: "SELBST gefahren: leeres Fenster erzeugt KEINE Entwarnung mehr und laesst den Marker offen",
    },
    blocker1KeineRegression: {
      type: "boolean",
      description: "SELBST gefahren: eine ECHTE Erholung (Verkehr da, keine Fehler) wird weiterhin gemeldet - der Fix hat die Entwarnung nicht totgelegt",
    },
    blocker2Behoben: {
      type: "boolean",
      description: "SELBST gefahren: alter HOLD -> genau EIN Befund; Wiederholung und Neustart erzeugen keinen zweiten; junger HOLD keinen",
    },
    keineVerschlechterung: {
      type: "boolean",
      description: "SELBST stichprobenartig nachgefahren: 27.08.-Muster alarmiert weiterhin, Skalen-Rauschen nicht, Neustart haelt, PII dicht, Reihenfolge-Riegel wirkt",
    },
    sabotageSelbstRotGesehen: {
      type: "boolean",
      description: "SELBST ausgefuehrt: beide neuen Riegel einzeln entschaerft -> je ein Test wird ROT -> wiederhergestellt",
    },
    testsPassIndependently: { type: "boolean" },
    fullLintZeroErrors: { type: "boolean" },
    gatesNotWorse: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    piiDicht: { type: "boolean" },
    scopeRespected: { type: "boolean", description: "nur die zwei Blocker; kein Umbau, kein Vorgriff auf E4/E5" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "blocker1Behoben",
    "blocker1KeineRegression",
    "blocker2Behoben",
    "keineVerschlechterung",
    "sabotageSelbstRotGesehen",
    "testsPassIndependently",
    "fullLintZeroErrors",
    "gatesNotWorse",
    "safetyGatesIntact",
    "piiDicht",
    "scopeRespected",
    "blockers",
    "verdict",
  ],
};

let target = BASE;
let round = 0;
let fix = null;
let safety = null;
const runde = [];

while (round < MAX_ROUNDS) {
  round++;
  const branch = round === 1 ? BRANCH : `${BRANCH}-r${round}`;
  phase("Fix");
  fix = await agent(
    `Du behebst in einem FRISCHEN Git-Worktree GENAU ZWEI benannte Blocker der Etappe OUTBOUND-E3B. Nichts sonst.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${branch} ${target}
3. Lies die Etappe "E3b" in "${REPO}/${PLAN_DOC}" (Abnahmekatalog inkl. C8) und "${REPO}/tasks/outbound-e3b-report.md", falls vorhanden.
${round > 1 ? `ACHTUNG: dies ist Runde ${round}. Der Review der Vorrunde hat noch offene Blocker gemeldet:\n${JSON.stringify((safety && safety.blockers) || [], null, 1)}\nBehebe ZUSAETZLICH diese.` : ""}
=== ${BLOCKER_1}
=== ${BLOCKER_2}
${REGELN}
4. node --check auf jede geaenderte .js-Datei. ${TEST_CMD} - pass >= ${TEST_FLOOR}, fail == 0. npm run lint (VOLL) 0 Fehler. npm run test:gates nicht roeter als auf ${MASTER}.
5. VIER BEWEISE, alle AUSFUEHREN: blocker1Proof, blocker1PositivKontrolle (die Gegenrichtung darf nicht sterben!), blocker2Proof, keineVerschlechterungProof.
6. node_modules NICHT committen. git add (Dateien EINZELN, nie -A) && git commit -m "fix(outbound-e3b): keine Entwarnung ohne Verkehr + C8 HOLD-Eskalation". headCommit = git rev-parse HEAD.
EHRLICH fuellen; was du nicht loesen konntest, in deviations und summary nennen.`,
    { label: `e3b-nachbesserung-fix-r${round}`, phase: "Fix", schema: FIX_SCHEMA, isolation: "worktree", ...FIX_AGENT },
  );
  runde.push(`r${round} fix: ${fix && fix.summary ? fix.summary.slice(0, 250) : "(kein Ergebnis)"}`);
  if (!fix || !fix.committed || !fix.headCommit) {
    runde.push(`r${round}: ABBRUCH - kein Commit vom Fix-Agenten.`);
    break;
  }
  target = branch;

  phase("Review");
  safety = await agent(
    `STRENGER, adversarialer Safety-Reviewer in frischem Worktree. Pruefe die NACHBESSERUNG der Etappe OUTBOUND-E3B auf Branch "${target}" (Basis der Etappe: ${MASTER}).
Die Etappe war bereits inhaltlich abgenommen bis auf ZWEI Blocker. Deine Aufgabe: sind sie WIRKLICH weg, ohne etwas kaputtzumachen?
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-e3b-nach-r${round} ${target}
3. ${TEST_CMD} SELBST (pass >= ${TEST_FLOOR}, fail 0; NIE zwei Suiten gleichzeitig). npm run lint SELBST (VOLL) = 0 Fehler. npm run test:gates auf ${MASTER} UND auf ${target}.
4. Lies die Etappe E3b in "${REPO}/${PLAN_DOC}" (inkl. Abnahmepunkt C8 und Owner-Entscheidung F-8 in Abschnitt 9).
=== ${BLOCKER_1}
=== ${BLOCKER_2}
5. SELBST FAHREN, nichts uebernehmen:
   - **blocker1Behoben:** eigenes Szenario mit offenem Marker und LEEREM Fenster - es darf KEINE Entwarnung und KEIN closedAt geben.
   - **blocker1KeineRegression:** eigenes Szenario mit echter Erholung (Verkehr vorhanden, keine Fehler) - die Entwarnung MUSS weiterhin kommen. Ein Fix, der die Entwarnung ganz totlegt, ist ebenfalls ein Blocker.
   - **blocker2Behoben:** alter HOLD -> GENAU EIN Befund; zweiter Sweep -> keiner; Neustart dazwischen -> keiner; junger HOLD -> keiner. Ueber DENSELBEN Meldeweg, kein zweiter Kanal.
   - **keineVerschlechterung:** stichprobenartig die bereits abgenommenen Punkte: 27.08.-Muster alarmiert, Skalen-Grundrauschen nicht, Neustart haelt, PII dicht, Reihenfolge-Riegel wirkt in allen drei Naehten.
   - **sabotageSelbstRotGesehen:** beide neuen Riegel EINZELN entschaerfen -> je ein Test MUSS rot werden -> wiederherstellen, Baum sauber lassen.
6. git diff ${MASTER}..${target} durchsehen: kein Safety-Gate beruehrt, kein Provider-Schreibzugriff, kein Vorgriff auf E4/E5, Scope eingehalten.
${REGELN}
approved=true NUR wenn alle Punkte selbst gesehen. Rueckgabe IST das Urteil.`,
    { label: `e3b-nachbesserung-review-r${round}`, phase: "Review", schema: SAFETY_SCHEMA, isolation: "worktree", ...SAFETY_AGENT },
  );
  runde.push(`r${round} review: approved=${safety && safety.approved} blockers=${((safety && safety.blockers) || []).length}`);
  if (safety && safety.approved) break;
}

const approved = !!(safety && safety.approved);
return {
  phaseId: "OUTBOUND-E3B-NACHBESSERUNG",
  finalBranch: target,
  gate: approved ? "PASS" : "BLOCKED",
  approved,
  runden: round,
  blocker1Behoben: (safety && safety.blocker1Behoben) || false,
  blocker1KeineRegression: (safety && safety.blocker1KeineRegression) || false,
  blocker2Behoben: (safety && safety.blocker2Behoben) || false,
  keineVerschlechterung: (safety && safety.keineVerschlechterung) || false,
  sabotageSelbstRotGesehen: (safety && safety.sabotageSelbstRotGesehen) || false,
  testPassCount: (fix && fix.testPassCount) || null,
  fullLintZeroErrors: (safety && safety.fullLintZeroErrors) || false,
  gatesNotWorse: (safety && safety.gatesNotWorse) || false,
  blockers: (safety && safety.blockers) || [],
  concerns: (safety && safety.concerns) || [],
  deviations: (fix && fix.deviations) || [],
  verlauf: runde,
  verdict: (safety && safety.verdict) || "",
  summary: (fix && fix.summary) || "",
};
