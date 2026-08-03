// PER-RUN-Skript KV-P7 (Phase HART GEPINNT) - letzte Phase der KV-Kette.
// Schema traegt NUR Skalare mit Laengenlimit (Lehre: 16-KB-Nutzlast toetet den Lauf).

export const meta = {
  name: "phase-impl-lean",
  description:
    "KV-P7: latente Pfade verriegeln - ZUERST klaeren, welche TTS-Luecke real ist, dann erst bauen.",
  phases: [
    { title: "Plan", detail: "Klaerung der TTS-Luecke + Umsetzungsplan (Opus)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten (Opus) + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/kv-p7-report.md" },
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
const PHASE = "KV-P7";
const PHASE_TITLE = "Latente Pfade fail-closed verriegeln";
const BRANCH = "phase/kv-p7-latente-pfade";
const BASE = "master";
const PLAN_DOC = "tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/kv-p7-report.md";
const KLAERUNG_PATH = "tasks/kv-p7-tts-klaerung.md";

const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";

// Modellpolitik (Kickoff KV-Kette): KV-P7 baut Boot-Guards - ein falsch gebauter Guard
// toetet den Boot -> Plan und Safety auf Opus/high, Impl/Audit/Fix/Report auf Sonnet.
const PLAN_AGENT = { model: MODEL_OPUS, effort: "high" };
const IMPL_AGENT = { model: MODEL_SONNET };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: "high" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const SCHEMA_RULE = `SCHEMA-REGEL (bindend, sonst stirbt der Lauf): JEDES Textfeld deiner StructuredOutput-Antwort bleibt KURZ - hoechstens etwa 400 Zeichen, KEINE Markdown-Tabellen, KEINE Code-Bloecke, KEINE langen eingebetteten Zeilenumbrueche. Alles Umfangreiche schreibst du in eine DATEI und nennst im Feld nur den Pfad plus einen Satz. Ein Vorlauf dieser Kette ist an einer 16-KB-Nutzlast gestorben, nachdem die Arbeit bereits committet war.`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md". Insbesondere: Geld NIE als Fliesskomma (G26/S1); keine Duplizierung (G5/S2); keine Magic Numbers ausser 0/1/-1 (G25); konfigurierbare Werte nach src/config.js (G35); P8 - ein Boot-Befund nennt die gescheiterte Bedingung UND was der Betreiber tun soll, nicht nur "Fehler"; G28 - Bedingungen benennen und einkapseln; C2 - ueberholte Kommentare mitziehen; eine Aufgabe pro Funktion (G30); ESM, kein Build-Step, kein TypeScript. Tests: ein Konzept pro Test (P14), zu JEDEM Guard ein GEGENBEISPIEL (Flag aus -> KEIN Befund), Build-Operate-Check (P13).
PFLICHT VOR JEDEM "EXISTIERT NICHT"-BEFUND: greppe am AUSGECHECKTEN BRANCH, nicht nur im Diff (Repo-Lehre KV-M0).
UMLAUT-REGEL: Kommentare und Identifier OHNE Umlaute (ue/oe/ae).`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- **Ein falsch gebauter Boot-Guard toetet den Start des Live-Diensts.** Jeder neue Guard braucht ein Gegenbeispiel im Test (Bedingung nicht erfuellt -> KEIN Befund, Boot laeuft) und darf den Boot nur verweigern, wenn das ausdruecklich beabsichtigt ist. Im Zweifel: WARN-Befund statt Boot-Refusal.
- Safety-Gates NIE entfernen/aufweichen. Diese Phase FUEGT Sicherungen hinzu und macht eine bestehende, blinde Sicherung ehrlich.
- Die Gate-Achse darf NUR beschrieben werden, wenn die Klaerung (Teil 1) eine echte, ungedeckte Kosten-Kante belegt. Eine Doppelbuchung waere schlimmer als die Luecke.
- SECRETS nur via env, nie loggen - auch kein ElevenLabs-Key im Boot-Banner.
- AUTH FAIL-CLOSED: keine neue Route. Disclosure-Satz unberuehrt.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const KV_P7_SCOPE = `SCOPE DIESER PHASE (bindend):

**TEIL 1 - DIE KLAERUNG KOMMT ZUERST, VOR JEDER ZEILE CODE.**
Die Erstfassung des Plans nahm an, TTS-Kosten erreichten die Gate-Achse ueberhaupt nicht ("es existiert repo-weit kein Preis-pro-Zeichen-Parameter"). **Die KV-M1-Messung hat das verschoben:** der \`text-to-speech\`-Beleg des vermessenen Anrufs traegt SOWOHL die Zeichenzahl (729) ALS AUCH einen Betrag (51.030 Mikro-Cent). Und seit KV-P3 laeuft der Ist-Abgleich richtungsoffen, bucht also den GESAMTEN Ist-Betrag eines Anrufs - inklusive seines text-to-speech-Anteils - auf die Gate-Achse.

**Daraus folgt die entscheidende Frage, und sie ist eine Korrektheitsfrage, keine Stilfrage:**
Wenn der von Telnyx berechnete TTS-Betrag bereits im Ist-Betrag des Anrufs steckt und ueber den Ist-Abgleich auf der Gate-Achse landet, dann waere ein ZUSAETZLICHER Preis-pro-Zeichen-Parameter, der dieselben Zeichen nochmals bepreist, eine **DOPPELBUCHUNG** - der schlimmstmoegliche Ausgang dieser Phase. Ein Kunde zahlte dieselben Zeichen zweimal.

Klaere deshalb SELBST am Code und schreibe das Ergebnis nach "${REPO}/${KLAERUNG_PATH}" (falls Schreiben ausserhalb des Worktrees blockiert ist: in den Worktree und den Pfad nennen):
(a) Steckt der \`text-to-speech\`-Betrag im Ist-Betrag, den der Ist-Abgleich bucht? Pruefe die Liste der zuordenbaren Beleg-Typen im Provider-Adapter - ist \`text-to-speech\` dabei? Wenn ja, ist TTS-GELD bereits gedeckt.
(b) Was ist dann UEBERHAUPT noch offen? Kandidat: unser EIGENES ElevenLabs-Kontingent, das ueber den Telnyx-Relay verbraucht wird. Das ist eine ANDERE Kostenart als Telnyx' TTS-Gebuehr - ein Vertrag mit ElevenLabs, kein Posten auf der Telnyx-Rechnung. Der einzige Zaehler mit Erschoepfungswirkung (\`recordTtsCharacters\`/\`ttsCharacterQuota\`) wird repo-weit NUR vom Play-TTS-Pfad aufgerufen und sieht den Relay-Verbrauch strukturell nicht - unabhaengig davon, ob Play-TTS an oder aus ist.
(c) Ergibt sich daraus eine echte, ungedeckte GELD-Kante, oder nur eine blinde KONTINGENT-Zaehlung?

**DIE KLAERUNG BESTIMMT DEN UMFANG:**
- Traegt der Telnyx-Beleg die TTS-Kosten bereits vollstaendig, **entfaellt Massnahme 4 (Preis-pro-Zeichen) ersatzlos**, und die Phase schrumpft auf die Guards. Das ist ein voellig legitimes Ergebnis - sag es klar, statt eine Massnahme zu bauen, die doppelt bucht.
- Nur wenn die Klaerung eine echte, NICHT gedeckte Geld-Kante belegt, wird sie gebaut - und dann mit einem ausdruecklichen Beleg, dass sie nichts doppelt bucht.

**TEIL 2 - DIE GUARDS (unabhaengig vom Ausgang der Klaerung):**
1. \`ELEVENLABS_PLAY_TTS_ENABLED=true\` ohne gedeckte TTS-Kosten -> Boot-Befund. (Die genaue Bedingung haengt am Ergebnis der Klaerung - formuliere sie so, dass sie das Richtige prueft, nicht das Naheliegende.)
2. \`VOICE_ENGINE=realtime\` ohne Mid-Call-Budget-Pruefung im Realtime-Pfad -> Boot-Befund. Belege selbst am Code, dass die Realtime-Bruecke heute beim Gespraechsbeginn einen Timer setzt und danach nichts mehr prueft, waehrend die Budget-Engine in JEDER Turn-Runde prueft.
3. **Der Relay-Verbrauch (der eigentliche Befund):** entweder bekommt der Kontingent-Zaehler einen zweiten Aufrufer aus dem Ist-Abgleich (die Zeichenzahl liegt dort bereits vor), ODER - falls das den Umfang sprengt - ein PERMANENTER, UNUEBERSEHBARER Boot-Banner-Hinweis, dass die Kontingentwarnung diesen Pfad NICHT deckt. **Ein stiller Boot-Guard, der nur prueft, ob Play-TTS an ist, erfuellt diesen Punkt NICHT** - er verriegelt die falsche Sache und erzeugt genau die falsche Sicherheit, gegen die er schuetzen soll.

**TEIL 3 - Was diese Phase NICHT baut:**
Play-TTS und die Realtime-Engine werden NICHT gebaut und NICHT eingeschaltet. Diese Phase sorgt dafuer, dass ihr Einschalten LAUT ist statt still - und dass der bereits laufende Relay-Verbrauch nicht laenger unter einem Zaehler versteckt bleibt, der ihn strukturell nicht sehen kann.

DIE PFLICHT-ABNAHMEN:
(1) Zu JEDEM Guard ein Test MIT Gegenbeispiel: Bedingung erfuellt -> Befund; Bedingung NICHT erfuellt -> KEIN Befund und der Boot laeuft normal. Ein Guard ohne Gegenbeispiel ist ein Boot-Risiko und zaehlt als nicht abgenommen.
(2) Fuer Massnahme 3: entweder ein Test, der Relay-Zeichen im Kontingent-Zaehler ankommen sieht, ODER ein Test, der das Boot-Banner auf den Deckungshinweis prueft. Ein Test, der nur das Flag prueft, erfuellt es NICHT.
(3) Falls Massnahme 4 gebaut wird: ein Test, der belegt, dass KEINE Doppelbuchung entsteht - dieselben Zeichen erhoehen die Gate-Achse GENAU EINMAL.
(4) Der Boot laeuft in der Standardkonfiguration (alle Flags aus) ohne jeden neuen Befund. Belege das mit einem echten lokalen Start, nicht nur mit einem Unit-Test.
(5) Mutationsprobe je Guard: Bedingung invertieren -> genau der zugehoerige Test rot.

TEST-IDs: "KV-P7-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer).

LANDKARTE: Die Zeile \`play_tts_characters\` kippt NUR dann auf \`gate: true\`, wenn Massnahme 4 gebaut wurde UND keine Doppelbuchung entsteht. Entfaellt Massnahme 4, bleibt die Zeile unveraendert - dann gehoert aber in ihren \`preisquelle\`-Text die KORRIGIERTE Aussage, dass TTS-Geld ueber den Ist-Abgleich sehr wohl die Achse erreicht (die heutige Formulierung ist nach KV-M1/KV-P3 nicht mehr richtig, C2). KEINE andere Zeile wird angefasst.

NICHT-ZIELE (ausdruecklich):
- KEINE Doppelbuchung. Im Zweifel lieber keine neue Buchung.
- KEIN Einschalten von Play-TTS oder Realtime.
- KEIN Boot-Refusal, wo ein WARN-Befund reicht.
- KEINE Aenderung an der Sofortbuchung, am Ist-Abgleich, an der Deckungsquote, an der Gegenprobe.
- KEINE neue Env-Variable ohne volle Verdrahtung (config.js + .env.example + render.yaml + BASE_ENV in test/helpers.js).
- NIEMALS "git stash". NIEMALS "git add -A". Dateien EINZELN adden.`;

// ---------- Phase 1: Plan (inkl. Klaerung) ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}" - **und du beantwortest ZUERST die Klaerungsfrage, von der der Umfang abhaengt**. NUR PLANEN, NICHTS aendern.

1. Lies "${REPO}/${PLAN_DOC}": den Abschnitt "KV-P7" VOLLSTAENDIG (inkl. der Umfangs-Erweiterung vom 2026-08-03), das ERGEBNIS KV-M1 (besonders die Belegart-Tabelle mit \`text-to-speech\`: 5 Belege, 51.030 Mikro-Cent) und den Abschnitt "Was dieser Plan bewusst NICHT tut". Lies "${REPO}/tasks/kv-p3-report.md" (der Ist-Abgleich ist seit KV-P3 richtungsoffen).
2. Lies "${REPO}/.claude/refs/clean-code.md" und "${REPO}/CLAUDE.md".
3. **DIE KLAERUNG.** Lies den ECHTEN Code auf Basis "${BASE}" und beantworte am Code, nicht aus dem Plan-Doc:
   - src/telephony/adapters/telnyx/voice.js: die Liste der ZUORDENBAREN Beleg-Typen. Ist \`text-to-speech\` dabei? Wenn ja, fliesst sein Betrag in den Ist-Betrag, den der Ist-Abgleich bucht - dann ist TTS-GELD bereits auf der Gate-Achse.
   - src/billing/cost-truing.js: \`bookTtsCharactersFor\` - was genau bucht das, Zeichen oder Geld? Und wohin?
   - src/store/state-ops.js: \`recordTenantTtsCharacters\`, \`recordTtsCharacters\`, \`ttsCharacterQuota\` - wer ruft was auf, und was passiert bei Erschoepfung?
   - grep repo-weit nach den Aufrufern von \`recordTtsCharacters\`: kommt der Relay-Pfad (config.telnyx.telnyxElevenLabs) dort jemals an?
   - src/config.js: \`elevenlabsPlayTtsEnabled\`, \`ttsCharacterQuota\`, die Telnyx-ElevenLabs-Verdrahtung
   - src/bridge.js: wo setzt die Realtime-Bruecke ihren Timer, und wird danach irgendwo \`blockingBudgetAxis\` o.ae. geprueft? Vergleiche mit der Budget-Engine (src/claude.js), die in JEDER Turn-Runde prueft.
   - src/boot-guard.js: wie sind bestehende Befunde gebaut - WARN oder Boot-Refusal? Folge dem Muster.
   - src/boot.js: das Banner (seit KV-M0 mit sieben Konfigurationswerten) - wo koennte ein Deckungshinweis hin?
4. **SCHREIBE DIE KLAERUNG AUS**, mit Belegstellen, und beantworte ausdruecklich:
   (a) Erreicht der von Telnyx berechnete TTS-Betrag die Gate-Achse bereits? JA/NEIN mit Beleg.
   (b) Wenn JA: waere ein zusaetzlicher Preis-pro-Zeichen-Parameter eine DOPPELBUCHUNG? Rechne es an einem konkreten Beispiel durch (der KV-M1-Anruf: 729 Zeichen, 51.030 Mikro-Cent).
   (c) Was bleibt dann als echte Luecke - eine GELD-Luecke oder eine blinde KONTINGENT-Zaehlung? Das ist ein Unterschied: eine erschoepfte ElevenLabs-Quote degradiert die Stimme, sie sperrt nichts und kostet den Tenant nichts direkt.
   (d) Dein Urteil: wird Massnahme 4 gebaut oder entfaellt sie? Begruende beides gegeneinander.
5. Erst DANACH der Bauplan fuer die Guards.
6. PRE-MORTEM: ein Jahr spaeter hat KV-P7 Schaden angerichtet. Was ist passiert? Nenne mindestens: ein Guard verweigert den Boot in einer Konfiguration, an die niemand gedacht hat, und der Dienst ist offline; die Zeichen werden doppelt bepreist und Kunden zahlen zweimal; der Deckungshinweis steht im Banner, aber niemand liest ihn, und jemand leitet aus einem stillen Kontingent-Zaehler Sicherheit ab; ein Guard prueft das Flag statt der Sache und geht gruen, waehrend die Luecke offen ist. Fuer jedes: die Gegenmassnahme.
${KV_P7_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) DIE KLAERUNG mit Belegstellen und dem Ja/Nein-Urteil zu Massnahme 4 - das ist der wichtigste Teil deiner Antwort; (2) die exakten Edits je Datei fuer die Guards; (3) die Tests KV-P7-* mit Gegenbeispielen; (4) die Mutationsproben; (5) die Landkarten-Entscheidung (kippt die TTS-Zeile, oder wird nur ihr preisquelle-Text korrigiert?); (6) das Pre-Mortem. Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
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
    klaerungPath: { type: "string", description: "Pfad der geschriebenen TTS-Klaerung" },
    ttsMoneyAlreadyCovered: {
      type: "string",
      description:
        "Erreicht der Telnyx-TTS-Betrag die Gate-Achse bereits? JA/NEIN mit Beleg (Beleg-Typ-Liste, Ist-Abgleich). Hoechstens 400 Zeichen.",
    },
    measure4Verdict: {
      type: "string",
      description:
        "Wurde der Preis-pro-Zeichen-Parameter gebaut oder entfaellt er? Begruendung, inkl. Doppelbuchungs-Argument. Hoechstens 400 Zeichen.",
    },
    guard1: { type: "string", description: "Play-TTS-Guard: Bedingung + Testname + Gegenbeispiel. Hoechstens 300 Zeichen." },
    guard2: { type: "string", description: "Realtime-Guard: Bedingung + Testname + Gegenbeispiel. Hoechstens 300 Zeichen." },
    measure3: {
      type: "string",
      description:
        "Relay-Verbrauch: Zaehler gespeist ODER Banner-Deckungshinweis? Welcher Test belegt es? Hoechstens 350 Zeichen.",
    },
    defaultBootClean: {
      type: "string",
      description:
        "Laeuft der Boot in Standardkonfiguration (alle Flags aus) OHNE neuen Befund? Womit belegt - echter lokaler Start? Hoechstens 300 Zeichen.",
    },
    noDoubleBooking: {
      type: "boolean",
      description: "MUSS true sein: keine Zeichen werden zweimal bepreist",
    },
    mapRowDecision: {
      type: "string",
      description: "Kippte play_tts_characters auf gate:true, oder wurde nur der preisquelle-Text korrigiert? Hoechstens 250 Zeichen.",
    },
    noBootRefusalAdded: {
      type: "boolean",
      description: "Kein neuer Guard verweigert den Boot (WARN-Befund statt Refusal), oder das Refusal ist ausdruecklich beabsichtigt und begruendet",
    },
    newEnvWiring: { type: "string", description: "Neue Env-Variable? Wenn ja: wo ueberall verdrahtet. Hoechstens 250 Zeichen." },
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
    "klaerungPath",
    "ttsMoneyAlreadyCovered",
    "measure4Verdict",
    "guard1",
    "guard2",
    "measure3",
    "defaultBootClean",
    "noDoubleBooking",
    "mapRowDecision",
    "noBootRefusalAdded",
    "newEnvWiring",
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
3. SCHREIBE ZUERST die Klaerung nach "${KLAERUNG_PATH}" (aus dem Plan uebernommen, mit Belegstellen). Sie ist das Ergebnis, an dem der Umfang haengt.
4. Dann die Guards und - nur falls der Plan es begruendet - Massnahme 4.
5. node --check auf jede geaenderte src-Datei, dann npm test gruen. Dateien EINZELN adden, committen: "feat(kv-p7): latente Pfade verriegeln - Guards und Deckungshinweis".
${KV_P7_SCOPE}
${CLEAN_CODE_REQ}
6. npm test MUSS gruen sein. Kippende Bestandstests einzeln begruenden.
   HINWEIS ZU FLAKES: test/auth-p9a-cache-headers.test.js und einige Spawn-Tests werden unter Volllast rot, sind isoliert aber gruen. Wird ein Test rot, fahr ihn ISOLIERT nach und melde beides. Nicht "reparieren", was isoliert gruen ist.
7. npm run test:gates zusaetzlich (DARF rot sein). auth-p9a-cache-headers haengt bekanntermassen unter --test-name-pattern - wenn der Lauf haengt, brich ab und melde es.
8. **SMOKE-TEST (Pflicht):** starte den Server lokal in STANDARDKONFIGURATION (PORT=3999, SKIP_TWILIO_SIGNATURE_CHECK=true, DATA_DIR auf ein Temp-Verzeichnis, alle neuen Flags aus) und belege, dass er OHNE neuen Befund hochkommt und /healthz 200 liefert. Danach den Prozess beenden. Ein Guard, der den Standard-Boot stoert, ist ein Totalausfall des Live-Diensts.
9. MUTATIONSPROBEN: je Guard die Bedingung invertieren -> genau der zugehoerige Test rot. Zuruecknehmen, npm test erneut gruen.
10. node_modules-Symlink NICHT committen. Nach dem Lauf: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${SCHEMA_RULE}
${ABS_RULES}
EHRLICH fuellen. Wenn die Klaerung ergibt, dass Massnahme 4 entfaellt, ist das ein GUTES Ergebnis - eine nicht gebaute Doppelbuchung ist wertvoller als eine gebaute Feature-Zeile.`,
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
    defaultBootUnaffected: {
      type: "boolean",
      description:
        "SELBST verifiziert: der Boot in Standardkonfiguration laeuft ohne neuen Befund und ohne Refusal. Wie geprueft?",
    },
    everyGuardHasCounterExample: {
      type: "boolean",
      description: "SELBST geprueft: zu JEDEM neuen Guard existiert ein Test 'Bedingung nicht erfuellt -> kein Befund'",
    },
    noDoubleBooking: {
      type: "boolean",
      description:
        "SELBST nachgerechnet: dieselben TTS-Zeichen erhoehen die Gate-Achse GENAU EINMAL. Wenn Massnahme 4 gebaut wurde: wie ist ausgeschlossen, dass der Telnyx-Betrag sie schon traegt?",
    },
    klaerungSound: {
      type: "boolean",
      description:
        "Die TTS-Klaerung ist am Code belegt, nicht behauptet: ist text-to-speech in der Beleg-Typ-Liste, und bucht der Ist-Abgleich diesen Betrag?",
    },
    measure3NotFlagOnly: {
      type: "boolean",
      description:
        "Massnahme 3 prueft NICHT nur das Play-TTS-Flag: entweder der Kontingent-Zaehler sieht den Relay-Verbrauch, oder das Banner traegt einen unuebersehbaren Deckungshinweis",
    },
    noPathEnabled: { type: "boolean", description: "Play-TTS und Realtime wurden NICHT eingeschaltet und NICHT gebaut" },
    guardsAreWarnNotFatal: {
      type: "boolean",
      description: "Kein neuer Guard verweigert den Boot, ausser es ist ausdruecklich beabsichtigt und begruendet",
    },
    noSecretsInBanner: { type: "boolean", description: "Kein ElevenLabs-/Provider-Key im Banner oder in einem Befund" },
    otherPhasesUntouched: {
      type: "boolean",
      description: "Sofortbuchung, Ist-Abgleich, Deckungsquote, Gegenprobe und die uebrigen Landkarten-Zeilen unveraendert",
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
    "scopeRespected",
    "defaultBootUnaffected",
    "everyGuardHasCounterExample",
    "noDoubleBooking",
    "klaerungSound",
    "measure3NotFlagOnly",
    "noPathEnabled",
    "guardsAreWarnNotFatal",
    "noSecretsInBanner",
    "otherPhasesUntouched",
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase baut BOOT-GUARDS - ein falsch gebauter Guard legt den Live-Dienst still. Und sie beruehrt moeglicherweise die Bepreisung von TTS-Zeichen - eine Doppelbuchung belastet Kunden zweimal.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen. HINWEIS: auth-p9a-cache-headers und einige Spawn-Tests sind unter Volllast flaky, isoliert gruen - wird etwas rot, isoliert nachfahren und beides melden.
4. **STARTE DEN SERVER SELBST** in Standardkonfiguration (PORT frei waehlen, SKIP_TWILIO_SIGNATURE_CHECK=true, DATA_DIR Temp) und pruefe: kommt er hoch, liefert /healthz 200, und erscheint KEIN neuer Befund? Das ist die wichtigste Einzelpruefung dieser Phase. Danach Prozess beenden.
5. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
${KV_P7_SCOPE}
PRUEFE BESONDERS, jeweils SELBST am Code nachgerechnet:
- noDoubleBooking: DAS IST DER KORREKTHEITS-KERN. Lies die Beleg-Typ-Liste im Telnyx-Adapter SELBST. Ist \`text-to-speech\` dabei? Dann steckt sein Betrag im Ist-Betrag, den der Ist-Abgleich seit KV-P3 fuer beide Richtungen bucht. Wurde TROTZDEM eine zweite Bepreisung derselben Zeichen gebaut, ist das eine Doppelbelastung des Kunden und ein BLOCKER - unabhaengig davon, wie gut sie getestet ist.
- klaerungSound: ist die Klaerung am Code belegt oder aus dem Plan-Doc abgeschrieben? Pruefe die Belegstellen selbst nach.
- everyGuardHasCounterExample + defaultBootUnaffected + guardsAreWarnNotFatal: jeder neue Guard braucht einen Test "Bedingung nicht erfuellt -> kein Befund". Ein Guard, der in einer plausiblen Konfiguration faelschlich anschlaegt oder gar den Boot verweigert, ist ein BLOCKER. Denk dir aktiv Konfigurationen aus, in denen er falsch feuern koennte.
- measure3NotFlagOnly: prueft Massnahme 3 nur, ob Play-TTS an ist? Dann verriegelt sie die falsche Sache - der Relay-Verbrauch laeuft unabhaengig vom Flag. Das ist im Auftrag ausdruecklich als NICHT ausreichend benannt und ein BLOCKER.
- noPathEnabled: wurde Play-TTS oder Realtime versehentlich scharf geschaltet? git diff auf die Flags und ihre Defaults.
- otherPhasesUntouched: git diff auf metering.js, cost-truing.js, cost-cross-check.js, cost-ledger-map.js. Ausser der TTS-Zeile darf sich dort nichts aendern.
- noSecretsInBanner: greppe die Banner-/Befund-Ausgaben nach Key-Mustern.
BEVOR du behauptest, ein Symbol existiere nicht: greppe am AUSGECHECKTEN BRANCH (Repo-Lehre KV-M0).
${SCHEMA_RULE}
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine Tests gruen UND der Server bei dir sauber hochkam. Im Zweifel blockieren.`,
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
Achte besonders auf: (a) P8 - jeder Boot-Befund nennt die gescheiterte Bedingung UND was der Betreiber tun soll; ein Befund ohne Handlungsanweisung ist Laerm; (b) G28/G19 - die Guard-Bedingungen benannt und eingekapselt, keine zusammengesetzten Inline-Ausdruecke; (c) G5/S2 - die Guards duerfen die Bedingung nicht nachbauen, die anderswo schon existiert; (d) G26/S1 - falls eine Bepreisung entstand: Ganzzahl-Cent, keine Fliesskomma-Arithmetik; (e) C2 - die preisquelle-Texte und Kommentare, die TTS als 'erreicht die Achse nicht' beschreiben, sind nach KV-M1/KV-P3 falsch und MUESSEN mitgezogen sein; (f) die Tests: Gegenbeispiel je Guard als EIGENER Fall (P14/T5), unterscheidbare Fixture-Werte; (g) Kommentare deutsch OHNE Umlaute; (h) toter Code, ungenutzte Imports.
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
3. REPRODUZIERE JEDEN BLOCKER ZUERST (Repo-Lehre KV-M0). Nicht Reproduzierbares nach rejectedAsFalsePositive mit Kommando und Ergebnis - NICHT "fixen". Ein unter Volllast roter, isoliert gruener Test ist ein Flake.
4. Behebe die reproduzierbaren Blocker, fuer jeden korrektheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${KV_P7_SCOPE}
${CLEAN_CODE_REQ}
${SCHEMA_RULE}
${ABS_RULES}
5. node --check + npm test gruen, und der Server muss in Standardkonfiguration weiterhin sauber hochkommen. Dateien EINZELN adden, kein git stash.
6. **COMMITTE IMMER**, auch wenn ALLE Blocker Fehlalarme waren (dann eine Klarstellung committen) mit "fix(kv-p7): Review-Blocker geprueft (Runde ${round})". Ohne Commit bleibt die Phase auf BLOCKED, obwohl nichts kaputt ist. headCommit = git rev-parse HEAD.`,
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
LIES ZUERST die TTS-Klaerung. Sie sollte unter "${REPO}/${KLAERUNG_PATH}" liegen; fehlt sie dort, suche sie unter "${REPO}/.claude/worktrees/*/${KLAERUNG_PATH}". Uebernimm ihr Ergebnis WOERTLICH - sie ist das inhaltliche Herzstueck dieser Phase.
EHRLICHKEITSREGEL: kein Schutz behaupten, der nicht belegt ist. Wenn Massnahme 4 entfallen ist, ist das ein ERGEBNIS und kein Versaeumnis - stell es so dar, mit der Begruendung (Doppelbuchung waere schlimmer als die Luecke). Wenn Massnahme 3 nur ein Banner-Hinweis wurde statt einer echten Zaehlung, sag klar, dass der Kontingent-Zaehler den Relay-Verbrauch weiterhin NICHT sieht.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; DIE KLAERUNG (erreicht TTS-Geld die Gate-Achse schon? mit Belegstellen); das Urteil zu Massnahme 4 mit Begruendung; die beiden Guards mit Bedingung, Testname und Gegenbeispiel; Massnahme 3 und was sie wirklich leistet; der Standard-Boot-Beleg; die Landkarten-Entscheidung; Mutationsproben; angepasste Bestandstests; Safety-Urteil; Clean-Code-Audit; Fix-Runden inkl. Fehlalarme; ein Abschnitt "Was diese Phase NICHT tut" (Play-TTS und Realtime bleiben aus und ungebaut); ein Abschnitt "Was offen bleibt" - insbesondere, ob der ElevenLabs-Kontingent-Zaehler den Relay-Verbrauch jetzt sieht oder weiterhin blind ist. Quelle:
=== PLAN ===
${(plan || "").slice(0, 12000)}
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
  klaerungPath: (impl && impl.klaerungPath) || "",
  ttsMoneyAlreadyCovered: (impl && impl.ttsMoneyAlreadyCovered) || "",
  measure4Verdict: (impl && impl.measure4Verdict) || "",
  guard1: (impl && impl.guard1) || "",
  guard2: (impl && impl.guard2) || "",
  measure3: (impl && impl.measure3) || "",
  defaultBootClean: (impl && impl.defaultBootClean) || "",
  noDoubleBooking: impl ? impl.noDoubleBooking === true : false,
  mapRowDecision: (impl && impl.mapRowDecision) || "",
  noBootRefusalAdded: impl ? impl.noBootRefusalAdded === true : false,
  newEnvWiring: (impl && impl.newEnvWiring) || "",
  mutationProbeResult: (impl && impl.mutationProbeResult) || "",
  existingTestsAdjusted: (impl && impl.existingTestsAdjusted) || [],
  filesTouched: ((impl && impl.filesEdited) || []).slice(0, 40),
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
  summary: impl && impl.summary ? impl.summary.slice(0, 600) : "",
};
