export const meta = {
  name: 'openai-t2-plan',
  description: 'OpenAI-Technik Runde 2, Stufe 1: 100 IDs neu messen, harte Nuesse gegen Primaerquelle klaeren, PLAN-OPENAI-TECHNIK-2.md schreiben, Kritiker prueft Abdeckung gegen die Liste',
  phases: [
    { title: 'Liste', detail: 'die 100 IDs extrahieren und klassifizieren' },
    { title: 'Messen', detail: '4 Opus-Messer, je ein Viertel der technischen IDs' },
    { title: 'Recherche', detail: '3 Opus-Rechercheure: Widget-UI, Transport/CORS/Rate-Limit, O-27/convo-bench' },
    { title: 'Planen', detail: 'Opus schreibt tasks/PLAN-OPENAI-TECHNIK-2.md' },
    { title: 'Kritik', detail: 'Opus-Kritiker gegen die LISTE, hoechstens 2 Nachbesserungen' },
  ],
}

const PLAN = 'tasks/PLAN-OPENAI-TECHNIK-2.md'
const ANF = 'tasks/openai-audit/00-openai-anforderungen.md'
const KARTE = 'tasks/openai-technik-schlussabnahme.md'
const STAND_ALT = 'tasks/openai-technik-stand.md'

const FRAGEVERBOT = `
DU STELLST KEINE FRAGEN. Der Owner hat alles freigegeben, was du brauchst, und ist nicht
erreichbar. Was du nicht klaeren kannst, notierst du als UNKNOWN mit Grund und machst weiter.
Die Regel "bei Unsicherheit fragen" aus CLAUDE.md ist fuer diesen Auftrag durch eine
ausdrueckliche Owner-Freigabe ersetzt.`

const RAHMEN = `
KONTEXT: Hermes (dieses Repo), Branch master, Stand 288376b. Ziel der Kette: jede TECHNISCHE
Anforderung der OpenAI-App-Einreichung, die sich ohne den Owner bauen laesst, wird gebaut.
Die Anforderungsliste (genau 100 IDs, davon ca. 84 technisch) steht in ${ANF}.
${KARTE} ist eine LANDKARTE aus Runde 1 (41 von 84 erfuellt) - Hinweis, KEIN Beleg.
Aus ${STAND_ALT} gilt NUR der Abschnitt "Autonome Entscheidungen" (per grep finden, nur diesen
Abschnitt lesen - die Datei ist 48 KB gross).

OWNER-ENTSCHEIDUNGEN 2026-09-22 (gelten, nicht erneut fragen):
- Einreichung MIT Widget-UI, das Widget soll auch in ChatGPT sichtbar sein. Damit sind T-30,
  T-31, T-23, T-34, X-3, X-7 Pflicht und keine Option.
- get_transcript darf umbenannt werden (N-12). Es gibt keine echten Nutzer (alle Accounts sind
  das Team). Breaking Changes an Werkzeugen sind erlaubt, wenn eine Anforderung sie verlangt.

OWNER-REGEL: "nur der Owner" heisst ausschliesslich: Deploy/Push; Messung im ChatGPT Developer
Mode (Origin-Header, Quell-IP, Capabilities); ein echtes Access-Token dekodieren (aud, scope,
exp, email_verified); Wert des Challenge-Tokens; Werte im Render-Dashboard; Einstellungen beim
Sprach-Anbieter (retention_days); Live-Proben in Claude und ChatGPT; Rechtstext-INHALTE.
"Aendert Live-Verhalten" ist KEIN Owner-Grund - die Kette pusht nie, der Deploy IST das
Owner-Gate. Einzige Ausnahme: eine Aenderung, die beim Deploy die Produktion lahmlegen kann,
weil ein Live-Wert ungemessen ist - die wird gebaut UND bekommt eine Deploy-Vorbedingung.
Alles, was Code, Test, Doku im Repo oder vorbereitete Anleitung ist, ist BAUBAR.

FALLEN AUS RUNDE 1:
- registerTool() des MCP-SDK verwirft unbekannte Felder STILL. Ein Registrierungsobjekt beweist
  nichts; massgeblich ist der echte tools/list- bzw. resources/read-Output ueber die Route.
- Doppelte Pfade: HTTP /mcp und stdio, OAuth- und Token-/Legacy-Modus. Erfuellt ist ein Punkt
  erst, wenn er auf ALLEN betroffenen Pfaden gilt.
- render.yaml ist NICHT die Produktionswahrheit (Produktionswerte sind Dashboard-gepflegt).
- Kommentare koennen luegen; Verhalten am Code und an Tests belegen.

HARTE GRENZEN: Du aenderst KEINEN Code und committest NICHTS (ausser eine Datei ist dir
ausdruecklich zum Schreiben zugewiesen). Kein Push, kein echter Anruf, keine SMS, kein Zugriff
auf Produktion, keine Produktionswerte oder Secrets in Dateien oder Rueckgaben. Keine volle
Testsuite (npm test) - hoechstens gezielt einzelne Testdateien mit node --test <datei>.

KONTEXT-BUDGET: Bleib deutlich unter 100.000 Token. grep und gezielte Zeilenbereiche statt
ganzer Dateien. Gib deine strukturierte Rueckgabe ab, SOLANGE du noch Luft hast - lieber eine
Rueckgabe mit UNKNOWN-Eintraegen als keine.
${FRAGEVERBOT}`

// ---------------------------------------------------------------- Recherche (laeuft parallel)

const RECHERCHE_SCHEMA = {
  type: 'object',
  properties: {
    thema: { type: 'string' },
    ist_zustand: { type: 'string', description: 'Was Hermes heute tut, mit Datei:Zeile' },
    primaerquellen: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          zitat: { type: 'string', description: 'woertlich' },
        },
        required: ['url', 'zitat'],
      },
    },
    empfehlung: { type: 'string', description: 'Der empfohlene Weg, konkret, mit Dateien' },
    verworfen: { type: 'string', description: 'Verworfene Kandidaten und warum' },
    owner_probe: { type: 'string', description: 'Was nur eine Live-Probe klaert: Schritt-fuer-Schritt, erwartetes Ergebnis. Leer, wenn nichts.' },
    unknown: { type: 'string' },
  },
  required: ['thema', 'ist_zustand', 'primaerquellen', 'empfehlung', 'verworfen', 'owner_probe', 'unknown'],
}

const QUELLEN_HINWEIS = `
Primaerquellen: developers.openai.com (Apps SDK, MCP-Server-Doku), die MCP-Spezifikation
(modelcontextprotocol.io) und die MCP-Apps-Erweiterung (github.com/modelcontextprotocol/ext-apps),
fuer Claude die Anthropic-Doku (docs.claude.com / support.claude.com / claude.com). Web-Werkzeuge
(WebFetch, WebSearch, Exa) laedst du per ToolSearch. Zitiere WOERTLICH mit URL. Was du nicht in
einer Primaerquelle findest, ist UNKNOWN - nicht aus Plausibilitaet ergaenzen.`

const RECHERCHE = [
  {
    key: 'widget',
    prompt: `THEMA: Widget-UI in Claude UND ChatGPT (IDs T-30, T-31, T-23, T-34, X-3, X-7).
Lies die Anforderungstexte dieser IDs in ${ANF}. Dann:
1. IST: Wo setzt Hermes heute _meta.ui.csp / _meta.ui.domain / resourceUri / openai/*-Felder
   (Tool-Deskriptor? resources/read-Inhalt?) - Datei:Zeile. Wie sieht der ECHTE tools/list- und
   resources/read-Output ueber die HTTP-Route aus (vorhandene Tests zeigen das oft; sonst lokalen
   Server mit PORT=0 und temporaerem DATA_DIR starten und per curl fragen, danach beenden).
2. Die Nuss: _meta.ui.csp/_meta.ui.domain gehoeren laut Annahme an den RESOURCE-INHALT
   (resources/read -> contents[]._meta). domain ist host-abhaengig: Claude erwartet
   <sha256(connector-url)[:32]>.claudemcpcontent.com, OpenAI einen eigenen Origin. Der Transport
   ist zustandslos, der Server erkennt den Host nicht. Gesucht: ein Weg, der in Claude UND
   ChatGPT funktioniert. Pruefe (nicht vorgegeben): Standard-csp am Inhalt plus domain ueber den
   OpenAI-Alias openai/widgetDomain; Host-Erkennung pro Request (welche Signale hat ein
   resources/read-Request ueberhaupt?); zustandsbehafteter Transport. Belege jede Annahme mit der
   Primaerquelle, auch die Claude-Seite (Format der domain).
3. Was klaert NUR eine Live-Probe? Bereite sie als Owner-Probe vor (Schritte, erwartetes Ergebnis).
${QUELLEN_HINWEIS}`,
  },
  {
    key: 'transport',
    prompt: `THEMA: Transport/Origin/Rate-Limit fuer ChatGPT (ID T-29 und alles in ${ANF}, was Origin,
CORS, Rate-Limit oder Egress-IPs betrifft - finde die IDs selbst).
1. IST: /mcp weist Origin https://chatgpt.com heute mit 403 ab, solange MCP_ALLOWED_ORIGINS leer
   ist - pruefe das am Code (Datei:Zeile) und an den Tests. Wo sitzt das Rate-Limit 120/min PRO IP,
   worauf ist es geschluesselt, gilt es vor oder nach der Auth?
2. Welche Origin-Werte sendet ChatGPT an einen MCP-Server (Connector-Aufrufe vom Server vs.
   Widget-iFrame)? Primaerquelle. Den GENAUEN Wert fuer MCP_ALLOWED_ORIGINS vorbereiten - die
   Strenge wird NICHT auf Verdacht gelockert; setzen tut ihn der Owner nach seiner Messung.
   Wie wird der Wert lokal testbar gemacht (Test ueber die echte Route)?
3. Rate-Limit: hinter OpenAIs gemeinsamen Egress-IPs drosselt 120/min pro IP alle ChatGPT-Nutzer
   zusammen. Was sagt die Primaerquelle zu Egress-IPs? Empfiehl eine Schluesselung, die das
   verhindert, ohne unauthentifizierten Verkehr zu entgrenzen (z.B. pro authentifiziertem
   Subjekt/Tenant nach der Auth, pro IP davor). Wie wird das getestet?
${QUELLEN_HINWEIS}`,
  },
  {
    key: 'o27',
    prompt: `THEMA: O-27 und die place_call-Beschreibungen.
1. Lies den Anforderungstext O-27 in ${ANF}. Die place_call-Beschreibungen (Tool-Beschreibung
   und Parameter-Beschreibungen, im echten tools/list-Output) nennen "Claude/Gemini" und
   "calendar, mail, files, chat". Finde ALLE Stellen (auch andere Werkzeuge, auch Resources,
   auch stdio-Pfad), die gegen O-27 verstossen - Datei:Zeile, woertlicher Text.
2. Die Texte sind an convo-bench kalibriert (npm run convo-bench, scripts/convo-bench.mjs):
   aendern NUR mit Vorher-/Nachher-Messung, n>=5. Klaere: was misst der Bench, welche Szenarien
   betreffen place_call, welchen LLM-Anbieter und welche Env-Variablen braucht er (NUR die Namen
   pruefen, ob gesetzt - NIE Werte ausgeben), was kostet ein Lauf, loest er echte Anrufe aus
   (darf er nicht)?
3. Machbarkeit: fahre EINEN minimalen Probelauf (ein Szenario, n=1), NUR wenn der Bench laut
   Code keine echten Anrufe/SMS ausloest und der Lauf offensichtlich billig ist. Laeuft er nicht
   (z.B. 402 = Anbieterkonto leer), ist das der belegte Owner-Grund - notiere die exakte
   Fehlermeldung (ohne Secrets). Keine Datei im Repo aendern.
4. Empfiehl einen neutralen Ersatzwortlaut und das Messprotokoll (Metrik, n, Vergleich).
Web-Recherche nur, wenn O-27 eine OpenAI-Regel zitiert - dann woertlich mit URL.`,
  },
]

phase('Recherche')
const rechercheP = parallel(RECHERCHE.map(r => () => agent(
  `${RAHMEN}\n\nDU BIST RECHERCHEUR. ${r.prompt}\n\nRueckgabe ueber das Schema; Felder knapp, zusammen hoechstens ca. 5.000 Zeichen.`,
  { label: `recherche:${r.key}`, phase: 'Recherche', schema: RECHERCHE_SCHEMA, model: 'opus' },
)))

// ---------------------------------------------------------------- Liste

const LISTE_SCHEMA = {
  type: 'object',
  properties: {
    ids: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          titel: { type: 'string', description: 'hoechstens 90 Zeichen' },
          technisch: { type: 'boolean' },
        },
        required: ['id', 'titel', 'technisch'],
      },
    },
    abweichungen: { type: 'string', description: 'Widersprueche zwischen Anforderungsliste und Landkarte (Anzahl, Klassifizierung)' },
  },
  required: ['ids', 'abweichungen'],
}

phase('Liste')
const LISTE_AUFTRAG = `${RAHMEN}

DU BIST LISTENFUEHRER. Extrahiere aus ${ANF} JEDE Anforderungs-ID (genau 100 erwartet), in der
Reihenfolge der Datei, mit Kurztitel. Die Einordnung technisch/nicht-technisch uebernimmst du aus
der Tabelle in ${KARTE}; weicht dort etwas ab oder fehlt eine ID, entscheidest du am
Anforderungstext und notierst es unter "abweichungen". Eine ID ist technisch, sobald sie einen
Anteil hat, der Code, Konfiguration, Test oder Repo-Doku verlangt.`
let liste = await agent(LISTE_AUFTRAG, { label: 'liste', phase: 'Liste', schema: LISTE_SCHEMA, model: 'opus' })
if (liste && liste.ids.length !== 100) {
  log(`Liste hat ${liste.ids.length} statt 100 IDs - ein zweiter Durchgang.`)
  liste = await agent(`${LISTE_AUFTRAG}\n\nEin erster Durchgang fand ${liste.ids.length} IDs statt 100. Zaehle selbst nach und liefere die vollstaendige Liste.`,
    { label: 'liste-2', phase: 'Liste', schema: LISTE_SCHEMA, model: 'opus' })
}
if (!liste) return { fehler: 'Listenfuehrer ausgefallen - nichts geplant.' }
const technisch = liste.ids.filter(i => i.technisch)
log(`Liste: ${liste.ids.length} IDs, davon ${technisch.length} technisch.`)

// ---------------------------------------------------------------- Messen

const MESS_SCHEMA = {
  type: 'object',
  properties: {
    ergebnisse: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['ERFUELLT', 'TEILWEISE', 'OFFEN', 'GEGENSTANDSLOS', 'UNKNOWN'] },
          beleg: { type: 'string', description: 'Datei:Zeile / Testname / Draht-Output; hoechstens 300 Zeichen' },
          luecke: { type: 'string', description: 'Was fehlt konkret; leer bei ERFUELLT; hoechstens 300 Zeichen' },
          owner_noetig: { type: 'boolean', description: 'NUR true, wenn ein Rest ausschliesslich nach OWNER-REGEL beim Owner liegt' },
          owner_grund: { type: 'string', description: 'Welcher Punkt der OWNER-REGEL; leer sonst' },
          pfade: { type: 'string', description: 'Welche Pfade geprueft: http/stdio, oauth/legacy' },
        },
        required: ['id', 'status', 'beleg', 'luecke', 'owner_noetig', 'owner_grund', 'pfade'],
      },
    },
  },
  required: ['ergebnisse'],
}

const TEILE = 4
const groesse = Math.ceil(technisch.length / TEILE)
const teile = Array.from({ length: TEILE }, (_, i) => technisch.slice(i * groesse, (i + 1) * groesse)).filter(t => t.length)

phase('Messen')
const messungen = await parallel(teile.map((teil, i) => () => agent(
  `${RAHMEN}

DU BIST MESSER ${i + 1} von ${teile.length}. Miss den HEUTIGEN Stand auf master fuer genau diese IDs:
${teil.map(t => `- ${t.id}: ${t.titel}`).join('\n')}

Je ID: Anforderungstext in ${ANF} lesen (bei Bedarf die passende Detaildatei unter
tasks/openai-audit/01..18), dann am CODE, an einem TEST oder am DRAHT (echte Route) belegen.
Die Landkarte ${KARTE} ist nur ein Hinweis, woher du schauen kannst - schreibe NICHTS ab.
ERFUELLT nur mit Beleg auf allen betroffenen Pfaden. TEILWEISE/OFFEN: die Luecke konkret benennen.
GEGENSTANDSLOS nur mit Beleg, warum die ID auf Hermes nicht zutrifft. owner_noetig nur nach der
OWNER-REGEL - ein baubarer Anteil (Code, Test, Anleitung) macht die ID NICHT zur Owner-ID.
Jede ID deiner Liste bekommt genau einen Eintrag.`,
  { label: `messen:${i + 1}`, phase: 'Messen', schema: MESS_SCHEMA, model: 'opus' },
)))
const messung = messungen.filter(Boolean).flatMap(m => m.ergebnisse)
const gemessen = new Set(messung.map(m => m.id))
const ungemessen = technisch.filter(t => !gemessen.has(t.id)).map(t => t.id)
if (ungemessen.length) log(`UNGEMESSEN (Messer ausgefallen oder ID ausgelassen): ${ungemessen.join(', ')}`)
const zaehle = s => messung.filter(m => m.status === s).length
log(`Messung: ${zaehle('ERFUELLT')} erfuellt, ${zaehle('TEILWEISE')} teilweise, ${zaehle('OFFEN')} offen, ${zaehle('GEGENSTANDSLOS')} gegenstandslos, ${zaehle('UNKNOWN')} unknown.`)

const recherche = (await rechercheP).filter(Boolean)
log(`Recherche: ${recherche.length} von ${RECHERCHE.length} geliefert.`)

// ---------------------------------------------------------------- Planen

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    phasen: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Form T2-01, T2-02, ...' },
          titel: { type: 'string', description: 'hoechstens 60 Zeichen' },
          ids: { type: 'array', items: { type: 'string' } },
          risiko: { type: 'string', enum: ['auth', 'transport', 'widget', 'geldpfad', 'dokument', 'sonstig'] },
        },
        required: ['id', 'titel', 'ids', 'risiko'],
      },
    },
    anzahl_phase: { type: 'number' },
    anzahl_gegenstandslos: { type: 'number' },
    anzahl_owner: { type: 'number' },
    anzahl_erfuellt: { type: 'number' },
    ungeloest: { type: 'string', description: 'hoechstens 400 Zeichen' },
  },
  required: ['phasen', 'anzahl_phase', 'anzahl_gegenstandslos', 'anzahl_owner', 'anzahl_erfuellt', 'ungeloest'],
}

const PLAN_INHALT = `
Aufbau von ${PLAN} (Deutsch, Kommentarstil des Repos, KEINE Produktionswerte, KEINE Secrets):
1. ABDECKUNG ZUERST: Tabelle mit JEDER technischen ID, die nicht ERFUELLT ist -> Phase, oder
   GEGENSTANDSLOS mit Beleg, oder OWNER mit Grund nach der OWNER-REGEL. Keine ID fehlt, keine
   doppelt. Darunter eine zweite Tabelle der ERFUELLT-IDs mit ihrem Beleg (Kritiker prueft Stichproben).
   Die nicht-technischen IDs: eine Zeile je ID mit Begruendung, warum sie nicht technisch ist.
2. HARTE NUESSE mit woertlichen Primaerquellen-Zitaten und URL: T-30/T-31 (csp/domain am
   Resource-Inhalt, Claude UND ChatGPT), T-29 (CORS, vorbereiteter Wert, Owner setzt ihn nach
   Messung), O-27 (Neutralwortlaut nur mit convo-bench vorher/nachher n>=5; laeuft der Bench
   nicht, ist das der belegte Owner-Grund - dann trotzdem baubaren Teil planen), Rate-Limit
   120/min pro IP hinter OpenAIs Egress-IPs.
3. PHASEN, nach Risiko geschnitten und KLEIN: je Phase wenige zusammengehoerige IDs und ein
   abgegrenzter Dateibereich, so dass ein Bau-Agent deutlich unter 100.000 Token bleibt. Lieber
   mehr, kleinere Phasen. Auth, Transport, Widget-UI und Geldpfad je EIGENE Phase mit eigener
   Gegenprobe. Je Phase: ID (T2-01 ...), Titel, Ziel, IDs, Dateien, Abnahmekriterium als
   pruefbare Beweisart (welcher Test ueber welche echte Route / welcher Draht-Output / welche
   Code-Stelle - so formuliert, dass ein Verifizierer OHNE Spec und Bericht es nachmessen kann),
   Pre-Mortem ("ein Jahr spaeter war diese Phase ein Fehler - was ist passiert?") KONKRET fuer
   diese Phase, nicht generisch, mit Gegenmassnahme, Flag "dokumentFuerOpenAI: ja/nein" (Dokumente,
   die an OpenAI gehen, schreibt Opus), Owner-Vorbereitung falls eine (Schritt-fuer-Schritt,
   erwartetes Ergebnis, mit dem schon gebauten Code, der nur auf die Messung wartet),
   Deploy-Vorbedingung falls ein ungemessener Live-Wert die Produktion lahmlegen kann.
   Reihenfolge: Abhaengigkeiten zuerst, dann nach Risiko.
4. OWNER-LISTE: nur Punkte nach der OWNER-REGEL, jeder mit Anleitung und erwartetem Ergebnis.
5. WAS NICHT GEBAUT WIRD, und warum - ausdruecklich.
6. ANHANG A: die Ausgangsmessung (jede technische ID: Status, Beleg, Luecke) - Grundlage fuer
   die Zwischenmessung.`

phase('Planen')
const EINGABEN = `
LISTE (${liste.ids.length} IDs, ${technisch.length} technisch; Abweichungen: ${liste.abweichungen || 'keine'}):
${JSON.stringify(liste.ids)}

MESSUNG (${messung.length} Eintraege; ungemessen: ${ungemessen.join(', ') || 'keine'}):
${JSON.stringify(messung)}

RECHERCHE:
${JSON.stringify(recherche)}`

let plan = await agent(
  `${RAHMEN}

DU BIST PLANER und schreibst ${PLAN} (neue Datei im Haupt-Arbeitsbaum, NICHT committen).
Grundlage sind die Eingaben unten. Ungemessene oder UNKNOWN-IDs misst du selbst nach, bevor du
sie einordnest. Wo du einer Messung misstraust, pruefe sie am Code.
${PLAN_INHALT}
${EINGABEN}`,
  { label: 'planer', phase: 'Planen', schema: PLAN_SCHEMA, model: 'opus' },
)
if (!plan) return { fehler: 'Planer ausgefallen - kein Plan.', messung_zaehlung: { erfuellt: zaehle('ERFUELLT'), gemessen: messung.length } }

// ---------------------------------------------------------------- Kritik

const KRITIK_SCHEMA = {
  type: 'object',
  properties: {
    urteil: { type: 'string', enum: ['PASS', 'FAIL'] },
    blocker: { type: 'array', items: { type: 'string', description: 'hoechstens 300 Zeichen' } },
    stichproben: { type: 'string', description: 'Welche ERFUELLT-Belege du nachgemessen hast und mit welchem Ergebnis; hoechstens 600 Zeichen' },
  },
  required: ['urteil', 'blocker', 'stichproben'],
}

const KRITIK_AUFTRAG = `${RAHMEN}

DU BIST KRITIKER des Plans ${PLAN}. Du pruefst gegen die LISTE, nicht gegen einen Vorrat.
Jeder der folgenden Punkte ist bei Verstoss ein BLOCKER:
1. Zaehle die IDs in ${ANF} SELBST (erwartet 100) und pruefe die technisch/nicht-technisch-
   Einordnung: eine als nicht-technisch gefuehrte ID mit baubarem technischem Anteil ist ein Blocker.
2. Jede technische ID, die nicht ERFUELLT ist, steht genau einmal in der Abdeckungstabelle.
3. Jeder OWNER-Eintrag erfuellt die OWNER-REGEL. Ein OWNER-Eintrag, der in Wahrheit (ganz oder
   teilweise) baubar ist, ist ein Blocker - der baubare Teil gehoert in eine Phase.
4. Jedes GEGENSTANDSLOS hat einen Beleg, der traegt.
5. Stichprobe: miss mindestens 8 ERFUELLT-Belege selbst am Code/Test nach (bevorzugt Auth,
   Transport, Widget, Geldpfad). Ein falsches ERFUELLT ist ein Blocker.
6. Die harten Nuesse (T-30/T-31, T-29, O-27, Rate-Limit) sind mit WOERTLICHEN
   Primaerquellen-Zitaten und URL geloest oder sauber als Owner-Probe vorbereitet.
7. Phasen sind klein, Auth/Transport/Widget-UI/Geldpfad je eigene Phase mit Gegenprobe, jedes
   Abnahmekriterium ist ohne Spec und Bericht nachmessbar, jedes Pre-Mortem ist konkret.
8. "Was nicht gebaut wird" ist vorhanden und begruendet.
Du aenderst den Plan NICHT.`

const MAX_NACHBESSERUNG = 3
const PFLICHT_HINWEIS = `
ZUSATZ AB RUNDE 3: Die Owner-Entscheidung vom 2026-09-22 macht T-30, T-31, T-23, T-34, X-3 und
X-7 zur PFLICHT. Jede dieser IDs ist entweder ERFUELLT mit tragendem Beleg oder steht in einer
Phase - nicht OWNER, nicht nicht-technisch ohne Beleg. Ebenso T-16: der baubare
Resource-Server-Anteil (PRM scopes_supported, scope= in der 401-Challenge, securitySchemes-Scopes)
gehoert in eine Auth-Phase; nur der wirklich Owner-gebundene Rest bleibt OWNER.`
let kritik = await agent(KRITIK_AUFTRAG, { label: 'kritik-1', phase: 'Kritik', schema: KRITIK_SCHEMA, model: 'opus' })
let runde = 0
while (kritik && kritik.urteil === 'FAIL' && runde < MAX_NACHBESSERUNG) {
  runde++
  log(`Kritik Runde ${runde}: ${kritik.blocker.length} Blocker - Nachbesserung.`)
  plan = await agent(
    `${RAHMEN}

DU BIST PLANER und besserst ${PLAN} nach. Ein unabhaengiger Kritiker hat diese Blocker gefunden:
${kritik.blocker.map((b, i) => `${i + 1}. ${b}`).join('\n')}
Behebe JEDEN Blocker in der Datei (pruefe ihn vorher am Code/an der Quelle; ist er falsch,
begruende das im Plan unter "Kritik-Einwaende" mit Beleg). Aufbau wie gehabt:
${PLAN_INHALT}${runde >= 3 ? PFLICHT_HINWEIS : ''}`,
    { label: `planer-fix-${runde}`, phase: 'Kritik', schema: PLAN_SCHEMA, model: 'opus' },
  ) ?? plan
  kritik = await agent(KRITIK_AUFTRAG + (runde >= 3 ? `${PFLICHT_HINWEIS}\nNenne in stichproben ausdruecklich den Status von X-3, X-7 und T-16.` : ''), { label: `kritik-${runde + 1}`, phase: 'Kritik', schema: KRITIK_SCHEMA, model: 'opus' })
}

return {
  plan: PLAN,
  kritik_urteil: kritik ? kritik.urteil : 'AUSGEFALLEN',
  kritik_runden: runde,
  offene_blocker: kritik ? kritik.blocker.slice(0, 6).map(b => b.slice(0, 240)) : [],
  liste: `${liste.ids.length} IDs, ${technisch.length} technisch`,
  messung: `${zaehle('ERFUELLT')} erfuellt / ${messung.length} gemessen; ungemessen: ${ungemessen.join(',') || '-'}`,
  anzahl: { phase: plan.anzahl_phase, gegenstandslos: plan.anzahl_gegenstandslos, owner: plan.anzahl_owner, erfuellt: plan.anzahl_erfuellt },
  phasen: plan.phasen.map(p => `${p.id} [${p.risiko}] ${p.titel.slice(0, 60)}: ${p.ids.join(',')}`),
  ungeloest: plan.ungeloest.slice(0, 400),
  kritik_stichproben: kritik ? kritik.stichproben.slice(0, 600) : '',
}
