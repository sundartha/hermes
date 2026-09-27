export const meta = {
  name: 'openai-t2-phase',
  description: 'OpenAI-Technik Runde 2, eine Phase: Plan -> Bau im Worktree -> Safety- und Clean-Code-Review -> Nachbessern -> Bericht -> unabhaengige Verifikation',
  whenToUse: 'Genau eine Phase T2-XX aus tasks/PLAN-OPENAI-TECHNIK-2.md bauen. Vorher PHASE pinnen; VORGEBAUT nur, um einen abgestuerzten Bau aufzunehmen.',
  phases: [
    { title: 'Planen', detail: 'Opus: Vorpruefung, Worktree anlegen, Spec nach tasks/openai-t2/ (ungetrackt)', model: 'opus' },
    { title: 'Bauen', detail: 'Sonnet im Worktree (Opus bei Dokument fuer OpenAI), frueh committen, frueh zurueckgeben' },
    { title: 'Review', detail: 'Safety (Opus) + Clean-Code (Sonnet) parallel am Branch-Diff' },
    { title: 'Nachbessern', detail: 'Fix + beide Reviews erneut, hoechstens 2 Runden' },
    { title: 'Bericht', detail: 'Sonnet schreibt tasks/openai-t2/<id>-bericht.md (ungetrackt)', model: 'sonnet' },
    { title: 'Verifikation', detail: 'Opus ohne Spec/Bericht/Plan misst jede ID selbst; bei NEIN Fix + Re-Review, hoechstens 2 Runden' },
  ],
}

// ===== PHASE PINNEN - genau die EINE Zeile "const PHASE = ..." patchen; eine Phase je Lauf, nie aus args =====
// Form: { id: 'T2-XX', titel: '...', ids: ['T-30', ...], branch: 'phase/openai-t2-xx-...', dokumentFuerOpenAI: false, notiz: '', ownerRest: {} }
// ownerRest (optional): { '<ID>': 'welcher Teil NUR per Owner-Live-Probe messbar ist' } - die Verifikation bewertet
// dann nur den baubaren Teil, der Live-Rest fliesst in owner_punkte. Schluessel muessen in ids stehen.
// Ziel, Dateien, Abnahmekriterium und Pre-Mortem liest der Planungsagent aus tasks/PLAN-OPENAI-TECHNIK-2.md
// (Abschnitt dieser ID) - sie stehen bewusst NICHT hier. dokumentFuerOpenAI: true => Bauen/Nachbessern mit Opus.
const PHASE = { id: 'T2-06', titel: 'Transport: CORS nur fuer freigegebene Origins', ids: ['T-29'], branch: 'phase/openai-t2-06-cors-allowed-origins', dokumentFuerOpenAI: false, notiz: 'Gemergt sind T2-01 (a941d23), T2-02 (fff3b95), T2-03 (24ff703), T2-23 (c0438bd), T2-04 (1cfa474), T2-05 (8a5b7ce) - nicht zuruecknehmen. Strenge NICHT auf Verdacht lockern: Default bleibt wie heute (leeres MCP_ALLOWED_ORIGINS = fail-closed); den genauen Wert fuer ChatGPT vorbereiten und testen, setzen tut ihn der Owner nach seiner Messung (Deploy aendert ohne gesetzten Wert nichts). Pre-Mortem: nie einen Origin spiegeln, der nicht exakt in der Liste steht (kein Praefix-/Suffix-Match, kein *), Negativtests fuer aehnliche Origins (chatgpt.com.evil.tld, http statt https, Gross/Klein, Port). Preflight OPTIONS und Vary: Origin mitpruefen, am echten HTTP-/mcp-Output. Wer ein docs/OPENAI-*-Dokument anfasst: keine internen Kennungen (Phasen-, OW-, OP-, W-Nummern, tasks/-Pfade) im Text, jede Aussage am Code belegt. Neue Env-Variable: config.js, .env.example, render.yaml UND BASE_ENV in den Tests.', ownerRest: { 'T-29': 'welcher Origin browserseitig tatsaechlich an /mcp anfragt (Messung im ChatGPT Developer Mode) und das Setzen des Werts im Render-Dashboard' } }

// ===== VORGEBAUT - Normalfall null; nur die EINE Zeile "const VORGEBAUT = ..." patchen =====
// Nur um einen abgestuerzten Bau aufzunehmen: dann ueberspringt der Lauf Planen und Bauen und steigt beim
// Review ein. Werte NUR aus einer echten Messung am Branch, nie geraten. branch MUSS gleich PHASE.branch sein,
// der Worktree muss unter wt-<id klein> existieren. Form:
// { branch, commit, dateien: [], grundlinie: 'pass/fail', test_pass, test_fail, rot_isoliert: [],
//   nicht_gebaut: [], abweichungen: [], selbstzweifel: [], owner_punkte: [] }
const VORGEBAUT = null

if (PHASE.id === 'T2-00') return { fehler: 'PHASE nicht gepinnt' }
if (!Array.isArray(PHASE.ids) || PHASE.ids.length === 0) return { fehler: 'PHASE.ids leer - nichts zu bauen' }
if (!String(PHASE.branch).startsWith('phase/openai-t2-')) return { fehler: 'PHASE.branch muss mit phase/openai-t2- beginnen' }
if (typeof (PHASE.ownerRest ?? {}) !== 'object' || Array.isArray(PHASE.ownerRest)) return { fehler: 'PHASE.ownerRest muss ein Objekt { ID: Satz } sein' }
const OWNER_REST = Object.entries(PHASE.ownerRest ?? {})
if (OWNER_REST.some(([id]) => !PHASE.ids.includes(id))) return { fehler: 'PHASE.ownerRest nennt eine ID, die nicht in PHASE.ids steht' }
if (VORGEBAUT && VORGEBAUT.branch !== PHASE.branch) return { fehler: 'VORGEBAUT.branch weicht von PHASE.branch ab - nie auf einen anderen Branch ausweichen' }

// ----- Orte -----
const HAUPT = '/Users/antonio/Mein Unternehmen/MCP/vodafone-agent'
const SCRATCH = '/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/bd9573f0-5514-4611-89e2-53dd73e46bd1/scratchpad'
const ID_KLEIN = PHASE.id.toLowerCase()
const WT = `${SCRATCH}/wt-${ID_KLEIN}`
const LOGS = `${SCRATCH}/logs-${ID_KLEIN}`
const SPEC_REL = `tasks/openai-t2/${PHASE.id}-spec.md`
const BERICHT_REL = `tasks/openai-t2/${PHASE.id}-bericht.md`
const SPEC_PFAD = `${HAUPT}/${SPEC_REL}`
const BERICHT_PFAD = `${HAUPT}/${BERICHT_REL}`
const PLAN_PFAD = `${HAUPT}/tasks/PLAN-OPENAI-TECHNIK-2.md`
const ANF_PFAD = `${HAUPT}/tasks/openai-audit/00-openai-anforderungen.md`
const STAND_PFAD = `${HAUPT}/tasks/openai-technik-stand.md`
const TESTKOMMANDO = 'npm test -- -- --test-concurrency=4'

// ----- Grenzen -----
const MAX_NACHBESSERN = 2
const MAX_VERIF_FIX = 2
const MAX_RUECKGABE = 1500
const MAX_BLOCKER = 5
const MAX_OWNER = 4
const MAX_EINTRAG = 200
const MIN_EINTRAG = 60
const EINTRAG_SCHRITT = 20
const MAX_BELEG = 250
const MAX_FEHLERTEXT = 300
const MAX_BRANCH = 80
const MAX_COMMIT = 12
const MAX_KURZ = 24

// ----- Modellpolitik: Opus plant, prueft Safety, verifiziert; Sonnet baut, auditiert, bessert nach, berichtet -----
const DOKU = PHASE.dokumentFuerOpenAI === true
const MODELL = {
  planen: 'opus',
  bauen: DOKU ? 'opus' : 'sonnet',
  safety: 'opus',
  cleancode: 'sonnet',
  nachbessern: DOKU ? 'opus' : 'sonnet',
  bericht: 'sonnet',
  verifikation: 'opus',
}

const IDS = PHASE.ids.join(', ')
const kap = (wert, n) => String(wert ?? '').slice(0, n)
const aufzaehlung = (liste, leer) => (liste && liste.length ? liste.map(x => '- ' + x).join('\n') : `- (${leer})`)
const fehlerRueckgabe = text => ({ phase: PHASE.id, urteil: 'FAIL', branch: kap(PHASE.branch, MAX_BRANCH), fehler: kap(text, MAX_FEHLERTEXT) })

// ===================================== Prompt-Bausteine =====================================

const FRAGEVERBOT = `
DU STELLST KEINE FRAGEN. Der Owner hat alles freigegeben, was du brauchst, und ist nicht erreichbar. Was du nicht klaeren kannst, notierst du als UNKNOWN mit Grund und machst weiter. Die Regel "bei Unsicherheit fragen" aus CLAUDE.md ist fuer diesen Auftrag durch eine ausdrueckliche Owner-Freigabe ersetzt.`

const BUDGET = `
KONTEXT-BUDGET: Bleib deutlich unter 100.000 Token. grep und gezielte Zeilenbereiche statt ganzer
Dateien; Testausgaben immer VOLLSTAENDIG in eine Logdatei unter "${LOGS}/" umleiten
(\`mkdir -p "${LOGS}"\`) und nur Summenzeilen bzw. \`not ok\`-Zeilen daraus lesen; nichts lesen,
was nicht zu deinem Auftrag gehoert. Wird es knapp: sofort strukturiert zurueckgeben, offene
Punkte als offen markiert.`

const NUR_DIESE_PHASE = `
Du pruefst NUR diese Phase - ihren Diff und ihre IDs (${IDS}) -, nicht das ganze Repo.`

const FALLEN = `
FALLEN (teuer gelernt, gelten fuer Bauen UND Pruefen):
- registerTool() des MCP-SDK verwirft unbekannte Felder STILL. Ein Registrierungsobjekt (oder ein
  Test daran) beweist NICHTS. Beleg ist NUR der echte tools/list- bzw. resources/read-Output ueber
  die Route (HTTP /mcp bzw. stdio).
- Doppelte Pfade: HTTP /mcp UND stdio; OAuth- UND Token-/Legacy-Modus. Ein Punkt ist erst
  erfuellt, wenn er auf ALLEN betroffenen Pfaden gilt.
- localhost kann als vertrauenswuerdiger lokaler Aufrufer gelten (isTrustedLocalCaller,
  Auth-Gate). Auth-Verhalten am Draht deshalb ueber die Interface-IP messen (test/helpers.js
  zeigt wie), nicht nur ueber localhost.
- Die Safety-Gates aus CLAUDE.md und der fest verdrahtete Offenlegungssatz werden NICHT
  angefasst - nicht aufgeweicht, nicht umgangen, auch nicht mittelbar oder "voruebergehend".
- Kein echter Anruf, keine echte SMS, kein Zugriff auf Produktion (keine Prod-DB, kein Render,
  kein Telnyx/Stripe live), keine Produktionswerte oder Secrets in committeten Dateien oder
  Rueckgaben. Keine .env in den Worktree kopieren.
- Tests: \`${TESTKOMMANDO}\` (nur der doppelte \`--\`-Trenner kommt an). Ausgabe nie abschneiden,
  sondern ganz in eine Logdatei. Der Exit-Code LUEGT - nur die Zeilen \`# pass\` und \`# fail\`
  zaehlen. Die Suite ist auf dieser Maschine nicht deterministisch: ein roter Test zaehlt erst,
  wenn er ISOLIERT erneut rot ist
  (\`NODE_ENV=test node --test --test-name-pattern="<name>" test/<datei>.test.js\`).
- Gestartete Server/Testserver hinterher beenden und mit \`ps\` pruefen - \`pgrep\` ist in dieser
  Sandbox blind.`

const DOKU_REGELN = DOKU ? `
DIESE PHASE SCHREIBT EIN DOKUMENT, DAS AN OPENAI GEHT:
- Fuer JEDE Aussage ueber ein Werkzeug ZUERST den Handler und die eigene tools/list-Beschreibung
  (echter Output) lesen. Die Aussage folgt dem Code, nie der Plausibilitaet.
- Die englische Fassung ist nie glatter als die deutsche: keine Einschraenkung, kein Vorbehalt
  faellt bei der Uebersetzung weg.
- OpenAI woertlich aus der Primaerquelle zitieren, mit URL - nie eine Paraphrase als Zitat.
- Keine internen Kennungen im Text (keine Phasen-, H-, T2- oder Befund-Nummern o.ae.).` : ''

const RAHMEN = `
KONTEXT: Hermes soll als OpenAI-App eingereicht werden (technische Kette, Runde 2). Du arbeitest
an Phase ${PHASE.id} "${PHASE.titel}". Umfang = GENAU diese IDs: ${IDS}.${PHASE.notiz ? `
NOTIZ DES LEADS: ${PHASE.notiz}` : ''}

QUELLEN, in dieser Rangfolge:
1. Plan: "${PLAN_PFAD}" - NUR der Abschnitt zu ${PHASE.id} (per grep finden): Ziel, Dateien,
   Abnahmekriterium, Pre-Mortem.
2. Anforderungstext: "${ANF_PFAD}" - massgeblich ist die OpenAI-Fassung dort. NICHT massgeblich:
   00-mcp-spec.md (andere Norm, widerspricht u.a. bei destructiveHint).
3. Aus "${STAND_PFAD}" gilt NUR der Abschnitt "Autonome Entscheidungen" - die Datei ist 48 KB,
   lies nur ihn: awk '/^## Autonome Entscheidungen/{f=1;print;next} f&&/^## /{exit} f' "${STAND_PFAD}"
4. Alte Berichte unter tasks/openai-audit/01-*.md .. 18-*.md: Landkarte, nie Beleg.

OWNER-ENTSCHEIDUNGEN 2026-09-22 (gelten, nicht erneut fragen):
(a) Einreichung MIT Widget-UI, das Widget soll auch in ChatGPT sichtbar sein. Damit sind T-30,
    T-31, T-23, T-34, X-3 und X-7 Pflicht, keine Option.
(b) get_transcript darf umbenannt werden (N-12). Es gibt keine echten Nutzer (alle Accounts sind
    das Team); Breaking Changes an Werkzeugen sind erlaubt, wenn eine Anforderung sie verlangt -
    nur dann, und dann mit ALLEN Aufrufern, Tests, Beschreibungen und Doku nachgezogen.

OWNER-REGEL: "nur der Owner" heisst ausschliesslich: Deploy/Push; Messung im ChatGPT Developer
Mode; ein echtes Access-Token dekodieren; Wert des Challenge-Tokens; Werte im Render-Dashboard;
Einstellungen beim Sprach-Anbieter; Live-Proben in Claude und ChatGPT; Rechtstext-INHALTE.
"Aendert Live-Verhalten" ist KEIN Owner-Grund (die Kette pusht nie, der Deploy ist das
Owner-Gate) - ausser eine Aenderung kann beim Deploy die Produktion lahmlegen, weil ein Live-Wert
ungemessen ist: dann bauen UND als Deploy-Vorbedingung in owner_punkte.
${DOKU_REGELN}`

const BAU_REGELN = `
BAUREGELN:
- \`.claude/refs/clean-code.md\` lesen und einhalten - hartes Gate, S1/S2 = Blocker.
  Verschachtelung hoechstens 4 (Ziel 2), Funktionen deutlich unter 100 Zeilen, hoechstens 3
  Argumente. Keine Magic Numbers ohne benannte Konstante, kein toter oder auskommentierter Code,
  keine abgeschalteten Sicherungen (eslint-disable u.ae., uebersprungene Checks, --no-verify).
- Vor jedem Edit die Stelle lesen; bei Funktionsaenderungen erst grep nach ALLEN Aufrufern.
- Jede Verhaltensaenderung zieht die Kommentare mit: jeden Kommentar in und um den geaenderten
  Code gegen das NEUE Verhalten lesen und nachziehen (Runde 1 fand zehn luegende Kommentare).
  Kommentare Deutsch, ohne Umlaute.
- Neue Env-Variable = VIER Orte: src/config.js, .env.example, render.yaml UND BASE_ENV in
  test/helpers.js (fehlt der vierte, leakt die echte .env in Spawn-Tests). render.yaml ist nicht
  die Produktionswahrheit - braucht Produktion einen Wert, ist das ein owner_punkt.
- Neues Verhalten braucht einen Test, der den Punkt TATSAECHLICH prueft (s. FALLEN: echter
  Draht-Output, alle Pfade). \`node --check\` auf jede geaenderte .js-Datei.
- COMMITS nur im Worktree "${WT}": Dateien EINZELN adden (\`git add <datei>\`), NIE
  \`git add -A\`, \`git add .\` oder \`git commit -a\`. NICHTS unter tasks/ committen (Spec und
  Bericht liegen ungetrackt im Haupt-Arbeitsbaum und gehoeren nie in den Branch), den
  node_modules-Symlink nie. Deutsche Commit-Nachricht ohne Umlaute. Kein --no-verify (der
  Pre-Commit-Hook lintet). Kein Push, kein Merge - das macht der Lead.
- Den Haupt-Arbeitsbaum "${HAUPT}" fasst du nicht an - dort arbeitet der Lead.`

const ARBEITSPLATZ_PRUEFUNG = `
ARBEITSPLATZ-PRUEFUNG, vor allem anderen: \`git -C "${WT}" rev-parse --abbrev-ref HEAD\` muss
genau ${PHASE.branch} liefern. Sonst STOPP: nichts aendern, arbeitsplatz_ok=false mit Befund
zurueckgeben. Nie einen anderen Branch oder Pfad nehmen, nie einen Worktree neu anlegen.`

// ===================================== Planen =====================================

const LEERE_SPEC = { plan_abschnitt_gefunden: true, arbeitsplatz_ok: true, arbeitsplatz_grund: '', basis_commit: '', spec_geschrieben: false, schritte: [], nicht_bauen: [], pre_mortem: [], widersprueche: [], owner_punkte: [] }

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    plan_abschnitt_gefunden: { type: 'boolean' },
    arbeitsplatz_ok: { type: 'boolean', description: 'true nur, wenn Branch und Worktree NEU angelegt wurden' },
    arbeitsplatz_grund: { type: 'string', description: 'bei false: warum (z.B. Branch existiert schon)' },
    basis_commit: { type: 'string' },
    spec_geschrieben: { type: 'boolean' },
    schritte: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nr: { type: 'number' },
          was: { type: 'string' },
          datei: { type: 'string', description: 'datei:zeile, wo die Aenderung hingehoert' },
          ids: { type: 'string' },
          pfade: { type: 'string', description: 'welche Pfade: HTTP /mcp, stdio, OAuth, Token/Legacy' },
          beweis: { type: 'string', description: 'wie ein FREMDER Pruefer ohne Spec das nachher nachmisst' },
        },
        required: ['nr', 'was', 'datei', 'ids', 'pfade', 'beweis'],
      },
    },
    nicht_bauen: { type: 'array', items: { type: 'string' } },
    pre_mortem: { type: 'array', items: { type: 'string' } },
    widersprueche: { type: 'array', items: { type: 'string' } },
    owner_punkte: { type: 'array', items: { type: 'string' } },
  },
  required: ['plan_abschnitt_gefunden', 'arbeitsplatz_ok', 'arbeitsplatz_grund', 'basis_commit', 'spec_geschrieben', 'schritte', 'nicht_bauen', 'pre_mortem', 'widersprueche', 'owner_punkte'],
}

const PLAN_PROMPT = `Du planst Phase ${PHASE.id} "${PHASE.titel}" der OpenAI-Einreichung von Hermes.
DU AENDERST KEINEN CODE und committest NICHTS. Du legst den Worktree an und schreibst GENAU EINE
Datei: "${SPEC_PFAD}" (Verzeichnis mit mkdir -p anlegen). Sie bleibt UNGETRACKT im
Haupt-Arbeitsbaum - nie adden, nie committen, nie in den Worktree kopieren.
${RAHMEN}
${FALLEN}

SCHRITT 0 - VORPRUEFUNG, vor allem anderen, in dieser Reihenfolge:
a) \`grep -n "${PHASE.id}" "${PLAN_PFAD}"\`. Fehlt die Datei oder ein Abschnitt zu ${PHASE.id}:
   STOPP, nichts anlegen, plan_abschnitt_gefunden=false zurueckgeben.
b) \`git -C "${HAUPT}" rev-parse --verify --quiet "refs/heads/${PHASE.branch}"\` - liefert das
   etwas, existiert der Branch schon (abgebrochener frueherer Lauf): STOPP. Nichts anlegen,
   nichts loeschen, NIE auf einen anderen Branchnamen ausweichen. arbeitsplatz_ok=false mit Grund.
c) \`test -e "${WT}"\` - existiert der Pfad schon: STOPP wie b).
d) Arbeitsplatz anlegen, genau so und nur so:
   git -C "${HAUPT}" worktree add -b ${PHASE.branch} "${WT}" master
   ln -s "${HAUPT}/node_modules" "${WT}/node_modules"
   git -C "${WT}" log --oneline -1        (-> basis_commit)
   Erst DANACH liest du Code - und zwar im Worktree "${WT}", nicht im Haupt-Arbeitsbaum (dessen
   Stand kann von master abweichen).

DEIN AUFTRAG:
1. Lies den ${PHASE.id}-Abschnitt im Plan ganz (nur diesen), die "Autonomen Entscheidungen" und
   je ID den Anforderungstext (grep je ID in "${ANF_PFAD}").
2. Sieh dir den betroffenen Code SELBST an. Der Plan kann sich irren: wo er eine Zeile nennt, sieh
   nach, ob dort steht, was er sagt. Jede Abweichung gehoert in "widersprueche". Nennt der
   Plan-Abschnitt andere IDs als ${IDS}, gilt die gepinnte Liste - auch das in "widersprueche".
3. Schneide die Phase in nummerierte, EINZELN pruefbare Schritte: was genau, wo (datei:zeile),
   welche IDs, welche PFADE (fehlt ein betroffener Pfad, ist der Schritt unvollstaendig), und der
   Beweis - nur eine dieser drei Arten: (a) Code an nennbarer Stelle, (b) ein gruener Test, der
   den Punkt TATSAECHLICH prueft (Werkzeug-/Resource-Metadaten nur ueber den echten
   tools/list-/resources/read-Output), (c) eine lesende Messung mit Befehl und erwarteter Ausgabe.
   "Korrekt umgesetzt" ist kein Beweis.
4. Tests: welcher bestehende Test bricht, welcher neue beweist den Punkt? Neue Env-Variable ->
   die vier Orte als eigener Schritt.
5. Was in dieser Phase NICHT gebaut wird, je mit Grund. Ein nach Pruefung gegenstandsloser
   Schritt wird nicht gebaut - nicht bauen ist ein zulaessiges Ergebnis.
6. Pre-Mortem, KONKRET fuer diese Phase: ein Jahr spaeter war sie ein Fehler - was ist passiert
   (ungewollter Anruf? Kosten? Transkript-Leak? gebrochener Client? Auth-Loch?), und was
   entschaerft es? Uebernimm das Pre-Mortem des Plans und schaerfe es am Code.
7. owner_punkte nur nach der OWNER-REGEL, je mit Anleitung und erwartetem Ergebnis.

Die Spec-Datei enthaelt dasselbe wie deine Rueckgabe, lesbar fuer den Bau-Agenten (Deutsch,
ohne Produktionswerte, ohne Secrets). spec_geschrieben=true erst, wenn die Datei auf der Platte
liegt.
${BUDGET}
${FRAGEVERBOT}`

phase('Planen')
log(VORGEBAUT
  ? `${PHASE.id} "${PHASE.titel}" - bereits gebaut auf ${VORGEBAUT.branch}; Planen und Bauen entfallen.`
  : `${PHASE.id} "${PHASE.titel}" - Vorpruefung, Worktree, Spec.`)

const spec = VORGEBAUT ? LEERE_SPEC : await agent(PLAN_PROMPT,
  { label: `${PHASE.id}:plan`, phase: 'Planen', model: MODELL.planen, effort: 'high', schema: SPEC_SCHEMA })

if (!spec) return fehlerRueckgabe('Planungsagent ohne Rueckgabe. Vor einem Neustart pruefen, ob Branch/Worktree schon angelegt sind (dann erst belegen, dann aufraeumen).')
if (!spec.plan_abschnitt_gefunden) return fehlerRueckgabe(`Kein Abschnitt zu ${PHASE.id} in tasks/PLAN-OPENAI-TECHNIK-2.md - nichts angelegt.`)
if (!spec.arbeitsplatz_ok) return fehlerRueckgabe(`Arbeitsplatz nicht angelegt (fail-closed): ${spec.arbeitsplatz_grund}`)
if (!VORGEBAUT && !spec.spec_geschrieben) return fehlerRueckgabe(`Spec nicht geschrieben (${SPEC_REL}); Worktree ${WT} existiert bereits.`)
if (!VORGEBAUT) log(`Spec steht: ${spec.schritte.length} Schritte, ${spec.nicht_bauen.length} bewusst nicht gebaut, Basis ${spec.basis_commit}.`)

// ===================================== Bauen =====================================

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    arbeitsplatz_ok: { type: 'boolean' },
    branch: { type: 'string' },
    commit: { type: 'string' },
    dateien: { type: 'array', items: { type: 'string' } },
    grundlinie: { type: 'string', description: '"pass/fail" der vollen Suite im unberuehrten Worktree vor dem ersten Edit' },
    test_pass: { type: 'number' },
    test_fail: { type: 'number' },
    rot_isoliert: { type: 'array', items: { type: 'string' }, description: 'Tests, die ISOLIERT erneut rot sind' },
    nicht_gebaut: { type: 'array', items: { type: 'string' }, description: 'Schritte der Spec, die du NICHT gebaut hast, je mit Grund' },
    abweichungen: { type: 'array', items: { type: 'string' } },
    selbstzweifel: { type: 'array', items: { type: 'string' } },
    owner_punkte: { type: 'array', items: { type: 'string' } },
  },
  required: ['arbeitsplatz_ok', 'branch', 'commit', 'dateien', 'grundlinie', 'test_pass', 'test_fail', 'rot_isoliert', 'nicht_gebaut', 'abweichungen', 'selbstzweifel', 'owner_punkte'],
}

const BAU_PROMPT = `Du baust Phase ${PHASE.id} "${PHASE.titel}" der OpenAI-Einreichung von Hermes.
${RAHMEN}
${FALLEN}
${BAU_REGELN}

DEINE SPEC: "${SPEC_PFAD}" - lies sie ganz. Sie liegt ungetrackt im Haupt-Arbeitsbaum; du
kopierst sie nicht und committest sie nie.
${ARBEITSPLATZ_PRUEFUNG}
Zusaetzlich: \`git -C "${WT}" status --porcelain\` muss leer sein. Ab jetzt arbeitest du
AUSSCHLIESSLICH in "${WT}" (Basis ${spec.basis_commit}).

GRUNDLINIE vor dem ersten Edit: im unberuehrten Worktree einmal
\`${TESTKOMMANDO} > "${LOGS}/bau-grundlinie.log" 2>&1\`, dann \`grep -E "^# (pass|fail)"\` darauf.
Als "pass/fail" in grundlinie. Rote Faelle hier sind Bestand oder Flake, nicht deine.

BAUEN - FRUEH COMMITTEN, FRUEH ZURUECKGEBEN:
- Nach JEDEM sinnvollen Teilschritt ein eigener Commit. Nie mehrere Schritte uncommittet liegen
  lassen - was nicht committet ist, ist bei deinem Absturz verloren.
- Nach den Edits: volle Suite einmal (\`> "${LOGS}/bau-1.log" 2>&1\`), \`# pass\`/\`# fail\`
  notieren, jeden roten Test isoliert nachfahren. Nur isoliert erneut rote zaehlen - die
  reparierst du an der URSACHE, nicht am Test. Einen Test anzupassen ist nur richtig, wenn sich
  das SOLL absichtlich geaendert hat - dann in "abweichungen".
- GIB DEINE STRUKTURIERTE RUECKGABE AB, SOLANGE DU NOCH LUFT HAST. In Runde 1 starb ein
  Bau-Agent nach 269 Werkzeugaufrufen ohne Rueckgabe - der Lauf war verloren. Spaetestens nach
  rund 80 Werkzeugaufrufen oder wenn dein Kontext sich 100.000 Token naehert: committen,
  zurueckgeben, offene Schritte in nicht_gebaut. Eine Rueckgabe mit offenen Punkten ist weit
  besser als keine.
- Stellt sich ein Schritt als falsch heraus: nicht bauen, in nicht_gebaut mit Grund. In
  selbstzweifel alles, wovon du selbst nicht ueberzeugt bist - der Review sucht dort zuerst.
- Aufraeumen: keine zurueckgelassenen Testserver (\`ps\`).
${BUDGET}
${FRAGEVERBOT}`

phase('Bauen')
const LEERER_BAU = { arbeitsplatz_ok: true, commit: '', dateien: [], grundlinie: '', test_pass: 0, test_fail: 0, rot_isoliert: [], nicht_gebaut: [], abweichungen: [], selbstzweifel: [], owner_punkte: [] }

const impl = VORGEBAUT ? { ...LEERER_BAU, ...VORGEBAUT } : await agent(BAU_PROMPT,
  { label: `${PHASE.id}:bau`, phase: 'Bauen', model: MODELL.bauen, effort: 'high', schema: IMPL_SCHEMA })

if (!impl) return fehlerRueckgabe(`Bau-Agent ohne Rueckgabe. Branch ${PHASE.branch} und ${WT} forensisch pruefen, dann VORGEBAUT setzen.`)
if (!impl.arbeitsplatz_ok) return fehlerRueckgabe(`Bau abgebrochen, Arbeitsplatz ungueltig: ${impl.abweichungen.join('; ')}`)

const stand = { commit: impl.commit, tests: `${impl.test_pass}/${impl.test_fail}`, owner: [...impl.owner_punkte] }
log(`Gebaut auf ${PHASE.branch} (${impl.commit}): ${impl.dateien.length} Dateien, Tests ${stand.tests}, Grundlinie ${impl.grundlinie}.`)

// ===================================== Review =====================================

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    befunde: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          schwere: { type: 'string', enum: ['blocker', 'wichtig', 'kosmetisch'] },
          stelle: { type: 'string', description: 'datei:zeile' },
          befund: { type: 'string' },
          warum_schlimm: { type: 'string', description: 'das konkrete Szenario, in dem es weh tut' },
          forderung: { type: 'string' },
        },
        required: ['schwere', 'stelle', 'befund', 'warum_schlimm', 'forderung'],
      },
    },
    urteil: { type: 'string', enum: ['PASS', 'FAIL'] },
    begruendung: { type: 'string' },
  },
  required: ['befunde', 'urteil', 'begruendung'],
}

const DIFF_BASIS = `Der Diff dieser Phase: \`git -C "${HAUPT}" diff master...${PHASE.branch}\` (nur lesen).
Die Arbeitskopie liegt in "${WT}". Sieh dir den ECHTEN Diff an, nicht Spec oder Bericht.`

const REVIEWER = [
  {
    key: 'safety',
    model: MODELL.safety,
    auftrag: `Du bist Safety- und Verhaltens-Reviewer. Du suchst, was in Produktion weh tut.
${DIFF_BASIS}

PRUEFE:
1. SAFETY-GATES: ist ein Gate aus CLAUDE.md angefasst, aufgeweicht oder umgangen - auch mittelbar,
   auch "voruebergehend"? IMMER Blocker. Dazu zaehlen: Outbound-Permit (Abo+KYC),
   OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit, die pro-Tenant-Kostendecke (sperrt BEIDE
   Richtungen), Max-Gespraechsdauer, die Provider-Signaturpruefung (fail-closed), der fest
   verdrahtete Offenlegungssatz.
2. AUTH FAIL-CLOSED: neuer Endpunkt oder Pfad ohne authentifizierte Identitaet? Jede Ausnahme
   braucht Begruendung im Code UND einen Eintrag in src/route-policy.js.
3. VERHALTENSAENDERUNG: wer ruft jede geaenderte Funktion heute, und bekommt der jetzt etwas
   anderes? Breaking Changes an Werkzeugen nur, wenn eine ID dieser Phase sie verlangt - dann
   ALLE Aufrufer, Tests, Beschreibungen und Doku nachgezogen, sonst Blocker.
4. DOPPELTE PFADE: gilt der Punkt auf ALLEN betroffenen Pfaden (HTTP /mcp UND stdio; OAuth UND
   Token/Legacy)? Nur ein Pfad angefasst, obwohl zwei betroffen: Blocker.
5. SECRETS/PII/PRODUKTIONSWERTE in Logs, API-/MCP-Ausgaben oder committeten Dateien? Liegt
   irgendetwas unter tasks/ im Diff: Blocker.
6. TESTS, DIE NICHTS BEWEISEN: prueft ein neuer Test das Registrierungsobjekt statt des echten
   tools/list-/resources/read-Outputs, nur "wirft nicht", oder gleiche Fixture-Werte auf beiden
   Seiten? Blocker.
7. Wurde aus der OpenAI-Fassung (00-openai-anforderungen.md) gebaut, nicht aus 00-mcp-spec.md?
8. Neue Env-Variable an allen VIER Orten (config.js, .env.example, render.yaml, BASE_ENV)?${DOKU ? `
9. DOKUMENT FUER OPENAI: jede Werkzeug-Aussage gegen Handler und echten tools/list-Output; die
   englische Fassung nicht glatter als die deutsche; Zitate woertlich mit URL; keine internen
   Kennungen. Jeder Verstoss ist Blocker.` : ''}`,
  },
  {
    key: 'cleancode',
    model: MODELL.cleancode,
    auftrag: `Du bist Clean-Code-Auditor. \`.claude/refs/clean-code.md\` ist dein Pruefkatalog und ein
HARTES Gate - lies ihn zuerst und arbeite ihn am Diff ab.
${DIFF_BASIS}

SCHWERE: jeder S1- oder S2-FLAG ist schwere=blocker (S1 schliesst ein: fehlender Test fuer neues
Verhalten, Sicherheits-/Korrektheitsverstoss, abgeschaltete Sicherung). S3 = wichtig,
S4 = kosmetisch.
HARTE GRENZEN (Blocker): Verschachtelung hoechstens 4, Funktionen hoechstens 100 Zeilen,
hoechstens 3 Argumente; Magic Numbers ausser 0/1/-1 ohne benannte Konstante, toter Code,
auskommentierter Code, neue abgeschaltete Sicherungen.
AUSSERDEM:
- Wiederholung: dieselbe Logik an zwei Stellen (S2)? Nenne die Stelle, die spaeter vergessen wird.
- Invarianten per Konvention: haengt die Richtigkeit daran, dass jemand spaeter daran denkt?
- LUEGENDE KOMMENTARE: lies jeden Kommentar im und um den geaenderten Code gegen das NEUE
  Verhalten. Behauptet einer etwas, das der Code nicht (mehr) tut: wichtig, bei Safety/Auth/Geld
  blocker (Runde 1 fand zehn). Deutsch ohne Umlaute?
- Passt die Aenderung zum Stil des Bestands? ESM, kein Build-Step; neue Dependency ohne
  Begruendung ist ein Blocker.`,
  },
]

const urteile = Object.fromEntries(REVIEWER.map(r => [r.key, 'FEHLT']))
let reviewBefunde = []
const SCHWERE_RANG = { blocker: 0, wichtig: 1 }

function reviewPrompt(reviewer, nachpruefung) {
  return `Du pruefst Phase ${PHASE.id} "${PHASE.titel}" der OpenAI-Einreichung von Hermes${nachpruefung ? ' (Nachpruefung nach einer Nachbesserung - pruefe den GESAMTEN Diff erneut, nicht nur die letzte Aenderung)' : ''}.
${NUR_DIESE_PHASE}
${RAHMEN}
${FALLEN}

Der Bauende hat SELBST diese Zweifel genannt - sieh dort zuerst nach:
${aufzaehlung(impl.selbstzweifel, 'keine genannt; das ist selbst ein Signal')}
Diese Schritte hat er NICHT gebaut:
${aufzaehlung(impl.nicht_gebaut, 'keine')}

${reviewer.auftrag}

URTEIL: FAIL, sobald EIN Blocker dasteht, sonst PASS. Sei streng - ein PASS hier fuehrt zum Merge.
Erfinde nichts: jeder Befund braucht eine Stelle (datei:zeile) und ein konkretes Szenario, in dem
er weh tut; ohne Szenario ist er kosmetisch. Du aenderst NICHTS und fuehrst NICHT die volle Suite
aus (hoechstens gezielte Testdateien).
${BUDGET}
${FRAGEVERBOT}`
}

async function reviewRunde(kennung, gruppe) {
  const nachpruefung = kennung !== 'r1'
  const ergebnisse = await parallel(REVIEWER.map(r => () => agent(reviewPrompt(r, nachpruefung),
    { label: `${PHASE.id}:review:${r.key}:${kennung}`, phase: gruppe, model: r.model, effort: 'high', schema: REVIEW_SCHEMA })))
  REVIEWER.forEach((r, i) => { urteile[r.key] = ergebnisse[i] ? ergebnisse[i].urteil : 'FEHLT' })
  reviewBefunde = ergebnisse
    .flatMap((erg, i) => (erg ? erg.befunde.map(b => ({ wer: REVIEWER[i].key, ...b })) : []))
    .filter(b => b.schwere in SCHWERE_RANG)
    .sort((a, b) => SCHWERE_RANG[a.schwere] - SCHWERE_RANG[b.schwere])
  log(`Review ${kennung}: ${REVIEWER.map(r => `${r.key}=${urteile[r.key]}`).join(', ')}; ${reviewBefunde.length} Befunde zum Nachbessern.`)
}

const befundZeile = b => `[${b.wer}/${b.schwere}] ${b.stelle}: ${b.befund} | Szenario: ${b.warum_schlimm} | Forderung: ${b.forderung}`

// ===================================== Nachbessern =====================================

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    arbeitsplatz_ok: { type: 'boolean' },
    geaendert: { type: 'boolean', description: 'true nur, wenn du mindestens einen NEUEN Commit gemacht hast' },
    commit: { type: 'string' },
    je_befund: { type: 'array', items: { type: 'string' }, description: 'je Befund eine Zeile: behoben wie, oder warum er nicht zutrifft' },
    test_pass: { type: 'number' },
    test_fail: { type: 'number' },
    rot_isoliert: { type: 'array', items: { type: 'string' } },
    owner_punkte: { type: 'array', items: { type: 'string' } },
  },
  required: ['arbeitsplatz_ok', 'geaendert', 'commit', 'je_befund', 'test_pass', 'test_fail', 'rot_isoliert', 'owner_punkte'],
}

function fixPrompt({ kennung, anlass, befunde }) {
  return `Du besserst Phase ${PHASE.id} "${PHASE.titel}" der OpenAI-Einreichung von Hermes nach.
ANLASS: ${anlass}
${RAHMEN}
${FALLEN}
${BAU_REGELN}
${ARBEITSPLATZ_PRUEFUNG}

BEFUNDE:
${aufzaehlung(befunde, 'keine')}

REGELN:
- JEDEN Befund abarbeiten ODER in einem Satz begruenden, warum er nicht zutrifft bzw. nur vom
  Owner zu loesen ist (dann in owner_punkte, nach der OWNER-REGEL). Still uebergehen ist verboten.
- Ursache statt Symptom. Einen Test umbiegen ist die falsche Richtung - ausser das SOLL hat sich
  absichtlich geaendert.
- Kein Scope-Zuwachs: nur diese Befunde.
- Danach: \`node --check\`, volle Suite (\`> "${LOGS}/fix-${kennung}.log" 2>&1\`), \`# pass\`/\`# fail\`,
  rote Faelle isoliert nachfahren, einzeln adden, committen, kein Push. Aufraeumen (\`ps\`).
- Frueh committen, frueh zurueckgeben - eine Rueckgabe mit offenen Punkten schlaegt keine.
${BUDGET}
${FRAGEVERBOT}`
}

async function nachbessern({ kennung, gruppe, anlass, befunde }) {
  const erg = await agent(fixPrompt({ kennung, anlass, befunde }),
    { label: `${PHASE.id}:fix:${kennung}`, phase: gruppe, model: MODELL.nachbessern, effort: 'high', schema: FIX_SCHEMA })
  if (!erg || !erg.arbeitsplatz_ok) {
    log(`Fix ${kennung}: ${erg ? 'Arbeitsplatz ungueltig' : 'ohne Rueckgabe'} - Schleife endet.`)
    return null
  }
  if (erg.commit) stand.commit = erg.commit
  stand.tests = `${erg.test_pass}/${erg.test_fail}`
  stand.owner.push(...erg.owner_punkte)
  log(`Fix ${kennung}: ${erg.geaendert ? `neuer Stand ${erg.commit}` : 'keine Aenderung'}, Tests ${stand.tests}.`)
  return erg
}

phase('Review')
await reviewRunde('r1', 'Review')

let nRunde = 0
while (reviewBefunde.length && nRunde < MAX_NACHBESSERN) {
  nRunde++
  phase('Nachbessern')
  const fix = await nachbessern({
    kennung: `n${nRunde}`,
    gruppe: 'Nachbessern',
    anlass: 'Safety- und Clean-Code-Review haben Befunde erhoben.',
    befunde: reviewBefunde.map(befundZeile),
  })
  if (!fix || !fix.geaendert) break
  await reviewRunde(`n${nRunde}`, 'Nachbessern')
}

// ===================================== Bericht =====================================

const BERICHT_SCHEMA = {
  type: 'object',
  properties: {
    geschrieben: { type: 'boolean' },
    owner_punkte: { type: 'array', maxItems: MAX_OWNER, items: { type: 'string', maxLength: MAX_EINTRAG }, description: 'hoechstens 4, nur nach der OWNER-REGEL, konsolidiert' },
  },
  required: ['geschrieben', 'owner_punkte'],
}

phase('Bericht')
const bericht = await agent(`Du schreibst den Abschlussbericht fuer Phase ${PHASE.id} "${PHASE.titel}" der
OpenAI-Einreichung von Hermes nach "${BERICHT_PFAD}" (Verzeichnis ggf. mit mkdir -p anlegen).
Die Datei bleibt UNGETRACKT im Haupt-Arbeitsbaum: nie adden, nie committen, nie in den Branch.
Du aenderst KEINEN Code.
${RAHMEN}

Der Bericht ist fuer einen Lead, der den Code NICHT liest und danach ueber den Merge entscheidet.
Keine Beschoenigung. Nach dir misst ein unabhaengiger Verifizierer jede ID selbst; widerspricht
er diesem Bericht, gewinnt er. Schreib deshalb nichts, was du nicht an einer Stelle belegen kannst
(Diff lesen: \`git -C "${WT}" diff master...HEAD\`, gezielt).

TATSACHEN:
- Branch: ${PHASE.branch}, Commit: ${stand.commit}, Spec: ${VORGEBAUT ? '(keine - Bau von Hand aufgenommen)' : SPEC_REL}
- Geaenderte Dateien (Bau): ${JSON.stringify(impl.dateien)}
- Tests: Grundlinie ${impl.grundlinie || 'unbekannt'}, zuletzt ${stand.tests} (pass/fail), isoliert rot beim Bau: ${JSON.stringify(impl.rot_isoliert)}
- Review-Urteile zuletzt: ${JSON.stringify(urteile)}
- Noch offene Review-Befunde:
${aufzaehlung(reviewBefunde.map(befundZeile), 'keine')}
- Nicht gebaut: ${JSON.stringify(impl.nicht_gebaut)}
- Abweichungen von der Spec: ${JSON.stringify(impl.abweichungen)}
- Widersprueche Plan/Code: ${JSON.stringify(spec.widersprueche)}
- Owner-Punkte (roh, zu konsolidieren): ${JSON.stringify([...spec.owner_punkte, ...stand.owner])}

Schreib im Bericht:
1. GANZ OBEN: was diese Phase NICHT erfuellt und warum - nicht versteckt.
2. Was sie erfuellt, ID fuer ID (${IDS}), je mit Beweisstelle (datei:zeile oder Testname).
3. Welche Pfade beruehrt sind und ob der Punkt auf ALLEN erfuellt ist.
4. Was ein fremder Pruefer nachmessen sollte - Befehle bzw. Stellen, NEUTRAL formuliert ("ist X
   erfuellt und woran siehst du das"), nicht bestaetigend.
5. Owner-Punkte (nur nach der OWNER-REGEL) und Restrisiko in einem Absatz.
${BUDGET}
${FRAGEVERBOT}`,
  { label: `${PHASE.id}:bericht`, phase: 'Bericht', model: MODELL.bericht, effort: 'medium', schema: BERICHT_SCHEMA })

if (!bericht || !bericht.geschrieben) log('Bericht nicht geschrieben - der Nachtrag nach der Verifikation legt die Datei an.')
// Der Bericht konsolidiert die Owner-Punkte bis hierher; spaetere (aus Verifikations-Fixes) kommen roh dazu.
const ownerBisBericht = stand.owner.length

// ===================================== Verifikation =====================================

const VERIF_SCHEMA = {
  type: 'object',
  properties: {
    commit: { type: 'string', description: 'git -C <worktree> rev-parse --short HEAD zum Zeitpunkt der Messung' },
    ids: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          erfuellt: { type: 'boolean' },
          beleg: { type: 'string', maxLength: MAX_BELEG },
          luecke: { type: 'string', maxLength: MAX_BELEG },
        },
        required: ['id', 'erfuellt', 'beleg', 'luecke'],
      },
    },
    tests: {
      type: 'object',
      properties: { pass: { type: 'number' }, fail: { type: 'number' } },
      required: ['pass', 'fail'],
    },
    rot_isoliert: { type: 'array', items: { type: 'string', maxLength: MAX_EINTRAG }, description: 'Testnamen, die ISOLIERT erneut rot sind' },
  },
  required: ['commit', 'ids', 'tests', 'rot_isoliert'],
}

// Neutrale Angabe ohne Plan-/Spec-Kontext: welcher Teil einer ID nur live beim Owner messbar ist.
const OWNER_REST_HINWEIS = OWNER_REST.length ? `
Fuer diese IDs ist folgender Teil nur live beim Owner messbar; bewerte nur den baubaren Teil und
nenne den Live-Rest im beleg. erfuellt=true, wenn der baubare Teil belegt ist:
${OWNER_REST.map(([id, satz]) => `- ${id}: ${satz}`).join('\n')}
` : ''

// Bewusst OHNE RAHMEN: der Verifizierer sieht weder Plan noch Spec noch Bericht noch Owner-Entscheidungen -
// einzig den neutralen Live-Rest-Hinweis aus PHASE.ownerRest.
function verifPrompt(runde) {
  return `Du bist unabhaengiger Verifizierer. Du beantwortest je ID genau eine Frage:
"Ist <ID> erfuellt, und woran siehst du das?"

IDS: ${IDS}
PRUEFGEGENSTAND: Branch ${PHASE.branch}, Worktree "${WT}" (Diff gegen master:
\`git -C "${WT}" diff master...HEAD\`).
ANFORDERUNGSTEXT: "${ANF_PFAD}" - je ID die Zeile per grep; massgeblich ist genau dieser Text.

LESEVERBOT (Unabhaengigkeit - ein Verstoss macht dein Ergebnis wertlos):
- Nichts unter "${HAUPT}/tasks/" oder "${WT}/tasks/" ausser der einen Datei "${ANF_PFAD}".
  Insbesondere NICHT: tasks/openai-t2/ (Spec, Bericht), tasks/PLAN-OPENAI-TECHNIK-2.md,
  Stand-, Kickoff- oder Audit-Berichte, 00-mcp-spec.md.
- Commit-Nachrichten und Code-Kommentare sind Behauptungen, kein Beleg.
Ob etwas gebaut werden SOLLTE, ist nicht deine Frage - nur, ob die Anforderung am Pruefgegenstand
erfuellt ist.
${NUR_DIESE_PHASE}
${OWNER_REST_HINWEIS}

MESSEN - selbst, im Worktree; du AENDERST NICHTS (kein Edit, kein Commit, kein Checkout):
1. \`git -C "${WT}" rev-parse --abbrev-ref HEAD\` muss ${PHASE.branch} sein; sonst jede ID
   erfuellt=false mit luecke "Worktree fehlt oder falscher Branch". commit =
   \`git -C "${WT}" rev-parse --short HEAD\`.
2. Je ID: Code an der Stelle, gezielte Tests (\`NODE_ENV=test node --test test/<datei>.test.js\`),
   und wo die Anforderung Draht-Verhalten betrifft (tools/list, resources/read, Header,
   Statuscodes, Auth): echten Output ueber einen lokal gestarteten Server. Start im Worktree mit
   PORT=0 und DATA_DIR=$(mktemp -d "${SCRATCH}/verif-data-XXXX"), sonstige Env wie BASE_ENV in
   test/helpers.js (dort steht auch, wie der echte Port aus dem Log gelesen wird). Keine .env,
   keine echten Provider-Schluessel. Danach den Server beenden und mit \`ps\` pruefen.
3. Einmal die volle Suite: \`${TESTKOMMANDO} > "${LOGS}/verif-${runde}.log" 2>&1\` im Worktree,
   dann \`# pass\`/\`# fail\`. Jeden roten Test isoliert nachfahren; rot_isoliert = die, die
   isoliert erneut rot sind.
4. Im Zweifel erfuellt=false und die luecke benennen (UNKNOWN mit Grund zaehlt als nein) - ein
   falsches Ja kostet mehr als ein falsches Nein. beleg und luecke je hoechstens 250 Zeichen,
   beleg mit datei:zeile, Testname oder Befehl+Ausgabe.
${FALLEN}
${BUDGET}
${FRAGEVERBOT}`
}

const normId = x => String(x ?? '').trim().toUpperCase()
const eintragZu = (verif, id) => (verif ? verif.ids.find(e => normId(e.id) === normId(id)) : undefined)

function verifLuecken(verif) {
  if (!verif) return ['Verifikation ohne Ergebnis - kein Beleg fuer irgendeine ID']
  const idLuecken = PHASE.ids.flatMap(id => {
    const eintrag = eintragZu(verif, id)
    if (!eintrag) return [`${id}: von der Verifikation nicht beurteilt`]
    return eintrag.erfuellt ? [] : [`${id}: ${kap(eintrag.luecke, MAX_BELEG)}`]
  })
  return [...idLuecken, ...verif.rot_isoliert.map(t => `isoliert rot: ${kap(t, MAX_EINTRAG)}`)]
}

async function verifiziere(runde) {
  const erg = await agent(verifPrompt(runde),
    { label: `${PHASE.id}:verifikation:${runde}`, phase: 'Verifikation', model: MODELL.verifikation, effort: 'high', schema: VERIF_SCHEMA })
  if (erg) {
    stand.commit = erg.commit || stand.commit
    stand.tests = `${erg.tests.pass}/${erg.tests.fail}`
  }
  log(`Verifikation ${runde}: ${erg ? `${PHASE.ids.filter(id => eintragZu(erg, id)?.erfuellt === true).length} von ${PHASE.ids.length} ja, Tests ${stand.tests}, isoliert rot ${erg.rot_isoliert.length}` : 'ohne Ergebnis'}.`)
  return erg
}

phase('Verifikation')
let verif = await verifiziere(1)
let vRunde = 0
while (verif && verifLuecken(verif).length && vRunde < MAX_VERIF_FIX) {
  vRunde++
  const fix = await nachbessern({
    kennung: `v${vRunde}`,
    gruppe: 'Verifikation',
    anlass: 'Eine UNABHAENGIGE Verifikation hat diese IDs als NICHT erfuellt gemessen bzw. diese Tests als isoliert rot. Die Verifikation gewinnt gegen jeden Bericht. Behebe genau diese Luecken.',
    befunde: verifLuecken(verif),
  })
  if (!fix || !fix.geaendert) break
  await reviewRunde(`v${vRunde}`, 'Verifikation')
  verif = await verifiziere(vRunde + 1)
}

// ===================================== Urteil und Rueckgabe =====================================

const jaAnzahl = PHASE.ids.filter(id => eintragZu(verif, id)?.erfuellt === true).length
const reviewsPass = REVIEWER.every(r => urteile[r.key] === 'PASS')
const verifOk = Boolean(verif) && jaAnzahl === PHASE.ids.length && verif.rot_isoliert.length === 0
const urteil = reviewsPass && verifOk ? 'PASS' : 'FAIL'
// Die Testzahl der Verifikation gewinnt; ohne Verifikation bleibt nur die eigene Angabe des Bauenden.
const testsFinal = verif ? `${verif.tests.pass}/${verif.tests.fail}` : `${stand.tests} (unverifiziert)`

const offeneBlocker = [
  ...(verifOk ? [] : verifLuecken(verif)),
  ...REVIEWER.filter(r => urteile[r.key] !== 'PASS').map(r => `Review ${r.key}: ${urteile[r.key]}`),
  ...reviewBefunde.map(b => `${b.wer}/${b.schwere} ${b.stelle}: ${b.befund}`),
]
const ownerKonsolidiert = bericht && bericht.owner_punkte.length ? bericht.owner_punkte : [...spec.owner_punkte, ...stand.owner.slice(0, ownerBisBericht)]
const ownerLiveRest = OWNER_REST.map(([id, satz]) => `${id} Live-Probe (Owner): ${satz}`)
const ownerPunkte = [...new Set([...ownerLiveRest, ...ownerKonsolidiert, ...stand.owner.slice(ownerBisBericht)])]

await agent(`Haenge an "${BERICHT_PFAD}" GENAU EINEN Abschnitt an (existiert die Datei nicht, lege sie
mit diesem Abschnitt an). Aendere sonst nichts an der Datei und nichts sonst im Repo; die Datei
bleibt ungetrackt - nie adden, nie committen.

Ueberschrift: "## Unabhaengige Verifikation (gewinnt gegen alles oben)"
Inhalt, aus diesen Daten, ohne eigene Wertung:
- Urteil des Laufs: ${urteil} (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: ${stand.commit}; Tests (volle Suite, pass/fail): ${testsFinal}
- Review-Urteile zuletzt: ${JSON.stringify(urteile)}
- Tabelle ID | erfuellt | Beleg | Luecke aus: ${JSON.stringify(verif ? verif.ids : [])}
- Isoliert rot: ${JSON.stringify(verif ? verif.rot_isoliert : [])}
- Offene Blocker:
${aufzaehlung(offeneBlocker, 'keine')}
Gib nur "ok" zurueck.
${FRAGEVERBOT}`,
  { label: `${PHASE.id}:bericht-nachtrag`, phase: 'Verifikation', model: MODELL.bericht, effort: 'low' })

function baueRueckgabe(eintragKappe) {
  return {
    phase: kap(PHASE.id, MAX_KURZ),
    urteil,
    branch: kap(PHASE.branch, MAX_BRANCH),
    commit: kap(stand.commit, MAX_COMMIT),
    tests: kap(testsFinal, MAX_KURZ),
    verifikation: kap(`${jaAnzahl} von ${PHASE.ids.length} ja`, MAX_KURZ),
    offene_blocker: offeneBlocker.slice(0, MAX_BLOCKER).map(b => kap(b, eintragKappe)),
    owner_punkte: ownerPunkte.slice(0, MAX_OWNER).map(p => kap(p, eintragKappe)),
    bericht: kap(BERICHT_REL, MAX_BRANCH),
  }
}

// Harte Obergrenze: erst Eintraege kuerzen, dann Owner-Punkte, zuletzt Blocker bis auf einen streichen.
const zuLang = r => JSON.stringify(r).length > MAX_RUECKGABE
let eintragKappe = MAX_EINTRAG
let rueckgabe = baueRueckgabe(eintragKappe)
while (zuLang(rueckgabe) && eintragKappe > MIN_EINTRAG) {
  eintragKappe -= EINTRAG_SCHRITT
  rueckgabe = baueRueckgabe(eintragKappe)
}
while (zuLang(rueckgabe) && rueckgabe.owner_punkte.length) rueckgabe.owner_punkte.pop()
while (zuLang(rueckgabe) && rueckgabe.offene_blocker.length > 1) rueckgabe.offene_blocker.pop()

const weggelassen = offeneBlocker.length - rueckgabe.offene_blocker.length + ownerPunkte.length - rueckgabe.owner_punkte.length
if (weggelassen > 0) log(`Rueckgabe gekuerzt: ${weggelassen} Eintraege nur im Bericht (${BERICHT_REL}).`)

return rueckgabe
