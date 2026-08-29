// GEZIELTE NACHBESSERUNG (schlank): E5 endete BLOCKED mit SECHS benannten Blockern, nachdem die
// dritte Fix-Runde aufgebraucht war. Die SUBSTANZ der Etappe ist abgenommen - alle vierzehn
// Sachpruefungen des Safety-Reviews stehen auf true (eigene DID geht raus, Rueckfall laut,
// Tenant-Isolation dicht, Telnyx-Zweige unveraendert, Safety-Gates intakt, Lint 0 Fehler).
// Muster: outbound-e4-nachbesserung.js (4 Agenten statt 17).

export const meta = {
  name: "outbound-e5-nachbesserung",
  description:
    "OUTBOUND-E5 Nachbesserung: 6 Blocker (PLAN-SECURITY.md widerspricht dem Code; Suppression-Ratsche an zwei Stellen gebrochen - der pre-commit-Hook lehnt den Stand ab; das Gate ueber den einzigen kostenpflichtigen Anbieter-Schreibzugriff existiert doppelt und getestet wird die falsche Kopie; doppelte Test-Attrappe) plus drei Nebenpunkte. Fix -> gezielter Review -> ggf. zweite Runde.",
  phases: [
    { title: "Fix", detail: "Die sechs Blocker + drei Nebenpunkte beheben, sonst nichts", model: "sonnet" },
    { title: "Review", detail: "Gezielter Safety-/Clean-Code-Review der Punkte + volle Regression", model: "opus" },
  ],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;
const BASE = "phase/outbound-e5-absender-did-v2-fix3";
const BRANCH = "phase/outbound-e5-nachbesserung";
const MASTER = "master";
const PLAN_DOC = "PLAN-OUTBOUND-RESILIENZ.md";
const TEST_CMD = `LLM_PROVIDER=anthropic npm test`;
// Vom Lead SELBST gemessen: master (531efdf) = 5361 pass. Der E5-Branch steht auf 5396 pass.
// Diese 5396 sind der Boden - faellt die Zahl, sind Tests verlorengegangen; das ist zu erklaeren.
const TEST_FLOOR = 5396;
const MASTER_FLOOR = 5361;
const GATES_ROT_AUF_MASTER = "3 rote Faelle (GAP-05, GAP-15, E2E-03)";
const MAX_ROUNDS = 2;

const FIX_AGENT = { model: "sonnet", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };

const LAGE = `AUSGANGSLAGE (vor dem Fixen lesen, nicht neu aufrollen):
Die Etappe E5 behebt eine REGRESSION: seit dem Umstieg auf ElevenLabs (19.08.) ging der ausgehende
Anruf nicht mehr mit der DID des anrufenden Tenants raus, sondern mit EINER global registrierten
Nummer. Der Angerufene sah eine fremde Nummer; ein Rueckruf landete beim BESITZER dieser Nummer,
nicht beim anrufenden Tenant.

DIE SUBSTANZ IST ABGENOMMEN. Der adversariale Safety-Review hat auf Branch "${BASE}" SELBST
nachgefahren und bestaetigt: die Tenant-DID geht byte-genau als Absender raus (gegen eine
AUFZEICHNENDE Attrappe gepinnt, nicht gegen eine argument-ignorierende); der Rueckfall ist
dreifach laut; die Tenant-Isolation haengt an zwei unabhaengigen Riegeln, beide per Sabotage rot
gesehen; Idempotenz, Fehlertoleranz, ehrliche Buchfuehrung, Dreifach-Gate mit Default AUS, der
nur-lesende Reparaturlauf und der NICHT ausgefuehrte Owner-Cutover - alles belegt. Die
Telnyx-Zweige waehlen unveraendert. Kein Safety-Gate, keine Offenlegung, kein callee_is_owner,
kein bridge.js, kein echter Anbieter-Schreibzugriff.

DEINE AUFGABE IST DAMIT ENG: die sechs Blocker wegraeumen, ohne die abgenommene Substanz
anzufassen. Kein Neuentwurf, kein Umbau der Auswahlfunktion, kein Vorgriff auf spaetere Etappen.

WARUM DAS DRINGEND IST: zwei der Blocker (2 und 3) brechen die Suppression-Ratsche. Der
repo-eigene pre-commit-Hook lehnt den aktuellen Stand ab (am laufenden Gate mit Exit 1 belegt),
und "git commit --no-verify" ist laut Skriptkopf verboten. Solange das so ist, ist die Etappe
nicht mergebar - unabhaengig davon, wie gut der Code ist.`;

const NEBENPUNKTE = `DREI NEBENPUNKTE (derselbe Durchgang, aber nachrangig - wenn einer mit einem
Blocker kollidiert, hat der Blocker Vorrang; was du liegen laesst, nennst du in deviations):

N1 - GEPINNTE ALTLAST-WERTE ANGEHOBEN (Vermeidungsliste Punkt 5, woertlich "NICHT ANHEBEN").
In eslint-legacy-exceptions.json wurden im Lauf der Etappe ZWEI Pins angehoben: makePgStore
562 -> 563 Zeilen und "id-length 'r'" 23 -> 24. Der Review hat das ehrlich gemessen und
festgehalten, dass derselbe Umbau hydrateTenantInto 117 -> 102 SENKT (netto besser) - aber die
Regel sagt, die Loesung ist so zu bauen, dass der Pin haelt. Pruefe je Pin, ob er sich mit
vertretbarem Aufwand halten laesst (z.B. die neue Zeile in eine bestehende Hilfsfunktion legen).
Geht es nicht, bleibt die Anhebung stehen UND wird im "reason"-Feld des Eintrags ausdruecklich
begruendet - stillschweigend anheben ist die eine Variante, die nicht zulaessig ist.

N2 - src/store/views.js#publicCall strippt NUR fromRegistrationSource. Damit wandern
fromActualE164 und fromSource neu in /api/state und die MCP-Call-Ansichten. Das ist kein Leak
(es ist die Nummer, die der Angerufene ohnehin gesehen hat, und kein Fremdtenant-Feld), bricht
aber die im Datei-Kopf dokumentierte Konvention, ohne dass eine Zeile sagt warum. Entweder
mitstrippen oder die Absicht im Kopf/am Feld in EINEM Satz festhalten - beides ist vertretbar,
stillschweigend ist es nicht.

N3 - PLAN-OUTBOUND-RESILIENZ.md spricht von "test/absender-*.test.js, sieben Dateien". Es sind
sechs, die auf das Muster passen; die siebte heisst e5-01-sipregistrar-produktionspfad.test.js.
Rein kosmetisch, gehoert aber in denselben Doku-Durchgang wie Blocker 1.`;

const FLAKE_HINWEIS = `BEKANNTER FLAKE, NICHT DEIN FEHLER (nicht "fixen", nicht als Regression werten):
Unter hoher Maschinenlast endet der volle Lauf gelegentlich mit fail 1 in AL-P10-1
(test/al-p10-precall-research.test.js). Der Test haelt einen eigenen 50-ms-LLM-Timeout
(BRIEFING_TEST_TIMEOUT_MS = 50); node laeuft mit --test-isolation=process, die Datei und ihr
ganzer Pfad sind im E5-Diff unberuehrt, und isoliert ist sie 4/4 gruen (auch bei Load 54).
REGEL: ein roter Test zaehlt nur, wenn er ISOLIERT rot ist. Faellt dir dieser Fall vor die
Fuesse, wiederhole die Datei einzeln und halte das Ergebnis fest - nicht mehr.`;

const REGELN = `RAHMEN (unantastbar):
- Safety-Gates NIE anfassen (Outbound-Permit, OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit,
  pro-Tenant-Kostendecke, Max-Gespraechsdauer, Telnyx-Signaturpruefung). Offenlegung und das
  callee_is_owner-Praedikat NICHT beruehren. Auth fail-closed. Secrets nur via env, NIE loggen.
  AUDIO nie durch MCP.
- KEINE echten Anrufe/SMS/Mails, KEINE Provider-SCHREIBzugriffe (auch keine EL-Registrierung!),
  KEIN Deploy, KEIN Nummernkauf. Anbieter-Zugriffe in Tests ausschliesslich gegen Attrappen.
- PII: Log, Metrik und Befund tragen KEINE Rufnummern, Namen oder Gespraechsinhalte.
- SCOPE: NUR die sechs Blocker und die drei Nebenpunkte. Die abgenommene Substanz der Etappe
  (Auswahlfunktion, Rueckfall, Store-Feld, Registrierungs-Lebenszyklus, Buchfuehrung, die
  Telnyx-Zweige) darf sich NICHT verschlechtern und wird nicht umgebaut. Kein bridge.js.
- CLEAN-CODE (${REPO}/.claude/refs/clean-code.md): EINE Quelle je Frage; reine Urteilsfunktionen
  ohne Seiteneffekt; Schwellen als benannte Konstanten; Kommentare deutsch OHNE Umlaute. Ein
  Kommentar, der eine Eigenschaft behauptet, muss am Code WAHR sein (das ist Blocker 5).
- LINT: npm run lint (VOLL, im Worktree) = 0 Fehler. Gepinnte Altlast-Werte NICHT anheben (N1).
- Waehrend eines laufenden Testlaufs KEINE Dateien aendern, NIE zwei Suiten gleichzeitig.
- Fixtures NICHT auf Grenzwerte legen; Erwartungen aus dem Fixture ABLEITEN.
- Attrappen MUESSEN ihr Argument pruefen. Eine Attrappe, die stur einen Erfolg zurueckgibt,
  beweist NICHTS darueber, WELCHER Wert uebergeben wurde.`;
const BLOCKER = [
  `PLAN-SECURITY.md:3441-3454 ist am HEAD (e1d9558) SACHLICH FALSCH und widerspricht dem Code derselben Etappe. Der Absatz 'Waisen-Risiko, NOCH NICHT verdrahtet' behauptet woertlich: 'KEIN Produktions-Aufrufer uebergibt ihn (wiring/web-login.js#scheduleReleaseReconcile und billing/contract-end-cleanup.js#attemptContractEndCleanup reichen ihn nicht durch)' und folgert 'Bis die Verdrahtung nachgezogen ist, hinterlaesst JEDE Freigabe einer DID mit ELEVENLABS_NUMBER_REGISTRATION_ENABLED=true eine Waise beim Anbieter'. Genau diese Verdrahtung wurde in Runde 3 (E5-01) gebaut: src/wiring/web-login.js:191/218/357/375 injizieren sipRegistrarWennAktiv(config), src/billing/webhook.js:276/424 und src/billing/contract-end-cleanup.js:82/93/125/136 reichen ihn durch, src/release-reconcile.js:119-120 loest den DELETE aus, belegt durch test/e5-01-sipregistrar-produktionspfad.test.js (ich selbst gefahren, gruen). Der Absatz nennt sogar als 'Nachzugstask' exakt das, was dieser Branch bereits getan hat. Beleg, dass es nicht nachgezogen wurde: \`git show --name-only e1d9558\` listet PLAN-SECURITY.md NICHT. Das ist der von der Vermeidungsliste Punkt 10 (E4-Blocker 2) benannte Fall - eine Zusicherung im Sicherheitsregister, die die Etappe geaendert hat, ohne sie dort nachzuziehen; derselbe Absatz war in einer frueheren Fassung schon einmal falsch (in die andere Richtung) und wurde damals korrigiert. FIX: Absatz umschreiben/entfernen (Verdrahtung ist da; verbleibender ehrlicher Restpunkt ist nur der fail-soft-Fehlschlag des EL-DELETE, der weiterhin eine Waise hinterlassen kann und ueber \`npm run elevenlabs:nummern -- --pruefen\` gefunden wird).`,
  `G4 · eslint-legacy-exceptions.json + src/store/state-ops.js:2732 · Die Suppression-Ratsche ist gebrochen, nicht nur gedehnt. Der neue Mutator \`attachNumberRegistration(s, numberId, ...)\` fuegt eine 181. \`id-length 's'\`-Fundstelle hinzu; \`eslint-suppressions.json\` wurde von 241 auf 242 hochgezogen, der zugehoerige PIN in \`eslint-legacy-exceptions.json\` steht aber unveraendert auf \`"id-length :: Identifier name 's' ...": 180\`. Am laufenden Gate belegt: \`node scripts/check-staged-suppressions.js src/store/state-ops.js\` -> Exit 1, "Befunde bewegt: 180 -> 181", "Ein Altlast-Eintrag entschuldigt nur GENAU die gepinnte Befundmenge". Der Eintrag entschuldigt die Datei damit nicht mehr - der pre-commit-Hook lehnt diesen Stand ab, und \`git commit --no-verify\` ist laut Skriptkopf verboten. · Fix: entweder den Parameter \`s\` -> \`state\` umbenennen (dann bleibt der Pin gueltig, und \`recordActualSender(state, ...)\` direkt darueber macht es schon so), oder den vom Skript fertig ausgegebenen findings-Block uebernehmen und die Anhebung im \`reason\` benennen wie bei jeder frueheren.`,
  `G4 · eslint-suppressions.json ("src/onboarding.js") + src/onboarding.js:181 · NEUE Unterdrueckung in einer Datei, die NICHT auf der Altlast-Liste steht. \`registriereNummerFailSoft(s, number, {...})\` bringt eine siebte \`id-length 's'\`-Fundstelle; der Zaehler wurde von 6 auf 7 gehoben (unfiltert nachgemessen: exakt 7). \`src/onboarding.js\` fehlt in \`eslint-legacy-exceptions.json\`, und der Skriptkopf nennt die Altlast-Liste ausdruecklich "den EINZIGEN Ausweg" - fuer eine nicht gelistete Datei gilt "wer sie anfasst, raeumt vorher auf", nicht "wer sie anfasst, hebt den Zaehler". Das ist genau die stille Verschlechterung, gegen die das Gate gebaut wurde. · Fix: Parameter \`state\` statt \`s\` nennen, \`eslint-suppressions.json\` wieder auf \`count: 6\` zuruecksetzen (kein Legacy-Eintrag noetig).`,
  `P11/T1 · src/worker/provisioning-orchestrator.js:154-167 · Das Gate, das ueber den EINZIGEN kostenpflichtigen Anbieter-Schreibzugriff dieser Etappe entscheidet, ist ungetestet - und der Test, der so aussieht, als decke er es ab, prueft einen anderen Code-Pfad. \`runProvisioningDrain\` schreibt das Dreifach-Gate (\`provisioningEnabled && elevenLabsOutbound.enabled && numberRegistrationEnabled\`) inline aus und ruft \`makeElSipRegistrar\` direkt. Die vier Gate-Tests in \`test/e5-01-sipregistrar-produktionspfad.test.js:129-151\` prueflen \`sipRegistrarWennAktiv\`, das der Orchestrator NICHT benutzt (per grep belegt: nur \`web-login.js\` importiert es). Damit wiederholt E5 exakt den Defekt, den Runde 3 im Kopf derselben Testdatei selbst benennt: "ein Mechanismus-Beleg fuer einen Weg, den die Produktion nicht ging". Kippt jemand einen der drei Schalter in der Orchestrator-Kopie, bleiben alle vier Tests gruen. · Fix: \`deps.sipRegistrar = sipRegistrarWennAktiv(config)\` im Orchestrator - dann decken die vorhandenen vier Tests den Produktionspfad ab, ohne einen neuen Test zu schreiben.`,
  `G5 (+C2) · src/worker/provisioning-orchestrator.js:154-167 vs. src/elevenlabs/nummern-registrierung.js:100-112 · Dieselbe Gate-Frage wird an zwei Orten beantwortet und derselbe Registrar an zwei Orten gebaut: der Orchestrator schreibt die drei Bedingungen + \`makeElSipRegistrar({el, sipUser, sipPasswort})\` inline aus, \`sipRegistrarWennAktiv(config)\` tut wortgleich dasselbe fuer die drei Freigabe-Aufrufer. Verschaerfend: der Kommentar an \`sipRegistrarWennAktiv\` behauptet woertlich "EIN Bauplatz statt zweier, kein zweiter Ort, der dieselbe Gate-Frage nochmal beantwortet (G5)" - das ist am Code widerlegt (C2, ueberholter Kommentar an genau der Stelle, die die Regel benennt). Ein kuenftiger vierter Riegel muesste an beiden Stellen nachgezogen werden; wird er vergessen, legt das Provisioning Registrierungen an, waehrend die Freigabe sie nicht mehr zurueckgibt. · Fix: \`makeElSipRegistrar\`-Import + Inline-Gate im Orchestrator loeschen, \`sipRegistrarWennAktiv(config)\` benutzen; den Kommentar erst dann stehen lassen, wenn er stimmt.`,
  `G5 · test/absender-registrierung-freigabe.test.js:23-32 vs. test/e5-01-sipregistrar-produktionspfad.test.js:66-77 · \`fakeSipRegistrar(overrides)\` ist in beiden NEUEN Testdateien wortgleich dupliziert (identische \`removeCalls\`-Aufzeichnung, identischer \`{accepted:true,status:200}\`-Default, identische Override-Weiche); dazu kommen die mitkopierten \`fakeAudit\`/\`fakeLogger\`. Die Attrappe traegt die Zusicherung "genau EIN Loeschversuch mit der richtigen Kennung" - laufen die zwei Kopien auseinander, belegen die beiden Tests unterschiedliche Dinge, ohne dass es auffaellt. (\`fakeAudit\`/\`fakeLogger\` sind Bestandspraxis, \`fakeSipRegistrar\` ist neu und damit vermeidbar.) · Fix: \`fakeSipRegistrar\` einmal nach \`test/helpers.js\` ziehen, beide Dateien importieren lassen.`,
];

const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    filesTouched: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    b1Proof: {
      type: "string",
      description:
        "Blocker 1 AUSGEFUEHRT: PLAN-SECURITY.md sagt jetzt, was der Code TATSAECHLICH tut (Verdrahtung IST da; ehrlicher Restpunkt bleibt der fail-soft-Fehlschlag des EL-DELETE). Zitiere den alten und den neuen Absatz.",
    },
    b2Proof: {
      type: "string",
      description:
        "Blocker 2 AUSGEFUEHRT: 'node scripts/check-staged-suppressions.js src/store/state-ops.js' laeuft mit Exit 0 durch. Kommando + Ausgabe WOERTLICH, vorher und nachher.",
    },
    b3Proof: {
      type: "string",
      description:
        "Blocker 3 AUSGEFUEHRT: src/onboarding.js wieder auf count 6, keine neue Unterdrueckung in einer nicht gelisteten Datei. Kommando + Ausgabe WOERTLICH.",
    },
    preCommitProof: {
      type: "string",
      description:
        "DER ENTSCHEIDENDE BEWEIS: der pre-commit-Hook laeuft auf dem fertigen Stand DURCH, ohne --no-verify. Kommando + Ausgabe woertlich. Ohne diesen Beweis ist die Nachbesserung wertlos.",
    },
    b4Proof: {
      type: "string",
      description:
        "Blocker 4 AUSGEFUEHRT: der Orchestrator benutzt jetzt sipRegistrarWennAktiv; die vier Gate-Tests decken den PRODUKTIONSPFAD ab. Sabotage: einen der drei Schalter kippen -> Test MUSS rot -> wiederhergestellt. Kommando + Ausgabe",
    },
    b5Proof: {
      type: "string",
      description:
        "Blocker 5 AUSGEFUEHRT: die Gate-Frage wird nur noch an EINER Stelle beantwortet (grep-Beleg), und der Kommentar an sipRegistrarWennAktiv stimmt jetzt am Code. Kommando + Ausgabe",
    },
    b6Proof: {
      type: "string",
      description: "Blocker 6 AUSGEFUEHRT: fakeSipRegistrar existiert nur noch EINMAL, beide Testdateien importieren sie. Grep-Beleg + gruener Lauf beider Dateien.",
    },
    n1Proof: { type: "string", description: "Nebenpunkt N1: je angehobenem Pin - gehalten (wie?) oder begruendet stehengelassen (Wortlaut des reason)." },
    n2Proof: { type: "string", description: "Nebenpunkt N2: publicCall - mitgestrippt oder Absicht in einem Satz festgehalten. Woertlich." },
    n3Proof: { type: "string", description: "Nebenpunkt N3: die Dateizahl in PLAN-OUTBOUND-RESILIENZ.md stimmt. Woertlich." },
    substanzUnveraendertProof: {
      type: "string",
      description:
        "Beleg, dass die abgenommene Substanz NICHT angefasst wurde: git diff " + BASE + "..HEAD zeigt keine Verhaltensaenderung an Auswahlfunktion, Rueckfall, Buchfuehrung oder den Telnyx-Zweigen. Kommando + Ausgabe",
    },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    lintProof: { type: "string" },
    gatesProof: { type: "string", description: `test:gates nicht roeter als auf ${MASTER} (${GATES_ROT_AUF_MASTER}). Woertlich` },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "b1Proof",
    "b2Proof",
    "b3Proof",
    "preCommitProof",
    "b4Proof",
    "b5Proof",
    "b6Proof",
    "n1Proof",
    "n2Proof",
    "n3Proof",
    "substanzUnveraendertProof",
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
    b1Behoben: { type: "boolean", description: "SELBST geprueft: PLAN-SECURITY.md stimmt Satz fuer Satz mit dem Code ueberein - weder zu optimistisch noch zu pessimistisch" },
    b2Behoben: { type: "boolean", description: "SELBST gefahren: check-staged-suppressions fuer state-ops.js Exit 0" },
    b3Behoben: { type: "boolean", description: "SELBST gefahren: onboarding.js ohne neue Unterdrueckung, count wieder 6" },
    preCommitLaeuftDurch: {
      type: "boolean",
      description: "SELBST gefahren: der pre-commit-Hook geht auf dem fertigen Stand durch, OHNE --no-verify. Ist das falsch, ist alles andere egal - dann BLOCKER",
    },
    b4Behoben: { type: "boolean", description: "SELBST gefahren inkl. Sabotage: das Gate des Orchestrators ist jetzt WIRKLICH getestet, nicht eine Kopie daneben" },
    b5Behoben: { type: "boolean", description: "SELBST gegrept: EINE Stelle beantwortet die Gate-Frage; der Kommentar stimmt am Code" },
    b6Behoben: { type: "boolean", description: "SELBST gegrept: fakeSipRegistrar nur noch einmal definiert" },
    n1Erledigt: { type: "boolean", description: "SELBST geprueft: kein Pin stillschweigend angehoben - gehalten oder im reason begruendet" },
    n2Erledigt: { type: "boolean", description: "SELBST geprueft: publicCall-Konvention wieder schluessig" },
    n3Erledigt: { type: "boolean", description: "SELBST geprueft: Dateizahl stimmt" },
    substanzUnveraendert: {
      type: "boolean",
      description:
        "SELBST nachgefahren (STICHPROBE, nicht die ganze Etappe neu): die eigene DID geht weiterhin byte-genau raus, der Rueckfall ist weiterhin laut, die Tenant-Isolation haelt, die Telnyx-Zweige waehlen unveraendert",
    },
    keineNeuenBefunde: { type: "boolean", description: "SELBST geprueft: die Nachbesserung hat keine neuen Clean-Code-S1/S2 eingeschleppt" },
    sabotageSelbstRotGesehen: { type: "boolean", description: "SELBST ausgefuehrt: Riegel entschaerft -> Test rot -> wiederhergestellt, 'git status --porcelain' am Ende leer" },
    testsPassIndependently: { type: "boolean" },
    fullLintZeroErrors: { type: "boolean" },
    gatesNotWorse: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    keineEchtenSchreibzugriffe: { type: "boolean" },
    scopeRespected: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "b1Behoben",
    "b2Behoben",
    "b3Behoben",
    "preCommitLaeuftDurch",
    "b4Behoben",
    "b5Behoben",
    "b6Behoben",
    "n1Erledigt",
    "n2Erledigt",
    "n3Erledigt",
    "substanzUnveraendert",
    "keineNeuenBefunde",
    "sabotageSelbstRotGesehen",
    "testsPassIndependently",
    "fullLintZeroErrors",
    "gatesNotWorse",
    "safetyGatesIntact",
    "keineEchtenSchreibzugriffe",
    "scopeRespected",
    "blockers",
    "verdict",
  ],
};

let target = BASE;
let round = 0;
let fix = null;
let safety = null;
const verlauf = [];

while (round < MAX_ROUNDS) {
  round++;
  const branch = round === 1 ? BRANCH : `${BRANCH}-r${round}`;
  phase("Fix");
  fix = await agent(
    `Du behebst in einem FRISCHEN Git-Worktree SECHS benannte Blocker der Etappe OUTBOUND-E5. Nichts sonst.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${branch} ${target}
3. Lies die Etappe "E5" und den Abschnitt 4 in "${REPO}/${PLAN_DOC}", dazu den Report
   "${REPO}/tasks/outbound-e5-report.md" (er beschreibt, was die Etappe gebaut hat).
${LAGE}
${round > 1 ? `ACHTUNG Runde ${round}: der Review der Vorrunde meldete noch offen:\n${JSON.stringify((safety && safety.blockers) || [], null, 1)}\nBehebe ZUSAETZLICH diese.` : ""}
=== DIE SECHS BLOCKER (Original-Wortlaut des Reviews) ===
${BLOCKER.map((b, i) => `--- (${i + 1}) ---\n${b}`).join("\n\n")}
=== ENDE BLOCKER ===
${NEBENPUNKTE}
${FLAKE_HINWEIS}
${REGELN}
4. node --check auf jede geaenderte .js-Datei. ${TEST_CMD} - pass >= ${TEST_FLOOR}, fail == 0
   (Boden auf ${MASTER}: ${MASTER_FLOOR}; faellt die Zahl unter ${TEST_FLOOR}, sind Tests
   verlorengegangen - das gehoert erklaert, nicht uebergangen).
   npm run lint (VOLL) 0 Fehler. npm run test:gates nicht roeter als ${GATES_ROT_AUF_MASTER}.
5. ZWOELF BEWEISE, alle AUSFUEHREN: b1Proof, b2Proof, b3Proof, preCommitProof (der wichtigste -
   ohne ihn ist die Etappe nicht mergebar), b4Proof, b5Proof, b6Proof, n1Proof, n2Proof, n3Proof,
   substanzUnveraendertProof, lintProof/gatesProof.
6. node_modules NICHT committen. git add (Dateien EINZELN, nie -A) && git commit -m
   "fix(outbound-e5): die sechs Review-Blocker beheben". headCommit = git rev-parse HEAD.
   Der Commit MUSS ohne --no-verify durchgehen - genau das ist Blocker 2 und 3.
7. Committe zwischendurch nach jedem abgeschlossenen Schritt. Ein frueherer Anlauf dieser Etappe
   starb am Sitzungslimit und stand ohne einen einzigen Commit da.
EHRLICH fuellen; was du nicht loesen konntest, in deviations und summary nennen.`,
    { label: `e5-nachbesserung-fix-r${round}`, phase: "Fix", schema: FIX_SCHEMA, isolation: "worktree", ...FIX_AGENT },
  );
  verlauf.push(`r${round} fix: ${fix && fix.summary ? fix.summary.slice(0, 250) : "(kein Ergebnis)"}`);
  if (!fix || !fix.committed || !fix.headCommit) {
    verlauf.push(`r${round}: ABBRUCH - kein Commit vom Fix-Agenten.`);
    break;
  }
  target = branch;

  phase("Review");
  safety = await agent(
    `STRENGER, adversarialer Safety-/Clean-Code-Reviewer in frischem Worktree. Pruefe die NACHBESSERUNG der Etappe OUTBOUND-E5 auf Branch "${target}".
Die Etappe war inhaltlich bereits abgenommen bis auf SECHS Blocker. Deine Aufgabe ist zweigeteilt:
sind die sechs WIRKLICH weg - und ist dabei nichts von der abgenommenen Substanz kaputtgegangen?
Baue die Etappe NICHT neu nach; die Substanz pruefst du als STICHPROBE, die sechs Punkte
vollstaendig.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-e5-nach-r${round} ${target}
3. ${TEST_CMD} SELBST (pass >= ${TEST_FLOOR}, fail 0; NIE zwei Suiten gleichzeitig).
   npm run lint SELBST (VOLL) = 0 Fehler. npm run test:gates auf ${target}.
4. Lies die Etappe E5 in "${REPO}/${PLAN_DOC}", dazu PLAN-SECURITY.md und
   docs/RUNBOOK-OUTBOUND.md.
${LAGE}
=== DIE SECHS BLOCKER (Original-Wortlaut) ===
${BLOCKER.map((b, i) => `--- (${i + 1}) ---\n${b}`).join("\n\n")}
=== ENDE BLOCKER ===
${NEBENPUNKTE}
${FLAKE_HINWEIS}
5. SELBST FAHREN, nichts uebernehmen - besonders:
   - **preCommitLaeuftDurch:** stage den Diff und lasse den echten pre-commit-Hook laufen. Geht er
     nicht durch, ist das ein BLOCKER, egal wie gut der Rest ist. Kein --no-verify.
   - **b2/b3Behoben:** 'node scripts/check-staged-suppressions.js <datei>' je Datei SELBST, Exit
     und Ausgabe woertlich. Pruefe zusaetzlich, ob die Zaehler ehrlich sind (unfiltert nachmessen),
     nicht nur ob das Skript schweigt.
   - **b4Behoben:** kippe SELBST einen der drei Schalter im Orchestrator-Pfad und pruefe, dass ein
     Test rot wird. Bleibt alles gruen, ist der Blocker NICHT behoben - das war sein ganzer Punkt.
   - **b1Behoben:** PLAN-SECURITY.md Satz fuer Satz gegen den Code. Achte auf BEIDE
     Fehlerrichtungen: der Absatz war schon einmal zu pessimistisch (behauptete eine Luecke, die
     der Code nicht hatte) - jetzt darf er auch nicht zu optimistisch werden. Der fail-soft-
     Fehlschlag des EL-DELETE kann weiterhin eine Waise hinterlassen; steht das nicht mehr da,
     ist es ein neuer Blocker.
   - **substanzUnveraendert:** Stichprobe - geht die eigene DID weiterhin byte-genau raus, ist der
     Rueckfall weiterhin laut, haelt die Tenant-Isolation, waehlen die Telnyx-Zweige unveraendert?
   - **sabotageSelbstRotGesehen:** Riegel entschaerfen -> Test rot -> wiederherstellen,
     "git status --porcelain" am Ende leer.
6. git diff ${MASTER}..${target} durchsehen: kein Safety-Gate beruehrt, keine Offenlegungs-/
   callee_is_owner-Aenderung, kein bridge.js, kein echter Provider-Schreibzugriff, Scope
   eingehalten.
${REGELN}
approved=true NUR wenn alle Punkte selbst gesehen. Rueckgabe IST das Urteil.`,
    { label: `e5-nachbesserung-review-r${round}`, phase: "Review", schema: SAFETY_SCHEMA, isolation: "worktree", ...SAFETY_AGENT },
  );
  verlauf.push(`r${round} review: approved=${safety && safety.approved} blockers=${((safety && safety.blockers) || []).length}`);
  if (safety && safety.approved) break;
}

const approved = !!(safety && safety.approved);
return {
  phaseId: "OUTBOUND-E5-NACHBESSERUNG",
  finalBranch: target,
  baseBranch: MASTER,
  gate: approved ? "PASS" : "BLOCKED",
  approved,
  runden: round,
  b1Behoben: (safety && safety.b1Behoben) || false,
  b2Behoben: (safety && safety.b2Behoben) || false,
  b3Behoben: (safety && safety.b3Behoben) || false,
  preCommitLaeuftDurch: (safety && safety.preCommitLaeuftDurch) || false,
  b4Behoben: (safety && safety.b4Behoben) || false,
  b5Behoben: (safety && safety.b5Behoben) || false,
  b6Behoben: (safety && safety.b6Behoben) || false,
  n1Erledigt: (safety && safety.n1Erledigt) || false,
  n2Erledigt: (safety && safety.n2Erledigt) || false,
  n3Erledigt: (safety && safety.n3Erledigt) || false,
  substanzUnveraendert: (safety && safety.substanzUnveraendert) || false,
  keineNeuenBefunde: (safety && safety.keineNeuenBefunde) || false,
  sabotageSelbstRotGesehen: (safety && safety.sabotageSelbstRotGesehen) || false,
  testPassCount: (fix && fix.testPassCount) || null,
  fullLintZeroErrors: (safety && safety.fullLintZeroErrors) || false,
  gatesNotWorse: (safety && safety.gatesNotWorse) || false,
  safetyGatesIntact: (safety && safety.safetyGatesIntact) || false,
  keineEchtenSchreibzugriffe: (safety && safety.keineEchtenSchreibzugriffe) || false,
  preCommitProof: (fix && fix.preCommitProof ? String(fix.preCommitProof).slice(0, 800) : ""),
  blockers: (safety && safety.blockers) || [],
  concerns: (safety && safety.concerns) || [],
  deviations: (fix && fix.deviations) || [],
  verlauf,
  verdict: (safety && safety.verdict) || "",
  summary: (fix && fix.summary) || "",
};
