export const meta = {
  name: 'openai-phase',
  description: 'Eine Phase der OpenAI-Einreichung: Plan -> Impl im Worktree -> dualer Review -> Self-Fix -> Report',
  phases: [
    { title: 'Planen', detail: 'Opus schneidet die Phase in konkrete Arbeitsschritte' },
    { title: 'Bauen', detail: 'Sonnet implementiert im eigenen Worktree' },
    { title: 'Review', detail: 'Safety (Opus) + Clean-Code (Sonnet) parallel am Branch-Diff' },
    { title: 'Nachbessern', detail: 'Self-Fix bis PASS, hoechstens 2 Runden' },
    { title: 'Bericht', detail: 'kompakter Report fuer den Lead' },
  ],
}

// ===== HIER WIRD DIE PHASE GEPINNT - eine Phase je Lauf, nie geerbt, nie aus args =====
const PHASE = {
  id: 'P10b',
  titel: 'Randpunkte II: HTTP-Oberflaeche des Hauptservers (/healthz, Header) + zwei Kommentare',
  branch: 'phase/openai-p10b-http',
  ids: 'Kickoff I (/healthz-Preisgabe, Security-Header am Hauptserver) + Kommentarreste',
}
// ======================================================================================

// Normalfall: null. Ist eine Phase schon gebaut (abgebrochener Lauf, von Hand aufgenommen),
// wird hier das Impl-Ergebnis von Hand gepinnt - dann ueberspringt der Lauf Plan und Bau und
// steigt direkt beim Review ein. Nie raten: die Werte stammen aus einer echten Messung.
const VORGEBAUT = null

const LEERE_SPEC = { schritte: [], nicht_bauen: [], pre_mortem: [], widersprueche: [] }

const WT = `/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/da543deb-6171-4946-bdd3-d0a723aa0e09/scratchpad/wt-${PHASE.id.toLowerCase()}`

const FRAGEVERBOT = `
DU STELLST KEINE FRAGEN. Der Owner hat alles freigegeben, was du brauchst, und ist nicht
erreichbar. Was du nicht klaeren kannst, notierst du als UNKNOWN mit Grund und machst weiter.
Die Regel "bei Unsicherheit fragen" aus CLAUDE.md ist fuer diesen Auftrag durch eine
ausdrueckliche Owner-Freigabe ersetzt.`

const RAHMEN = `
KONTEXT: Hermes soll als OpenAI-App eingereicht werden. Du arbeitest an Phase ${PHASE.id}
"${PHASE.titel}" (IDs: ${PHASE.ids}).

QUELLEN, in dieser Rangfolge:
1. \`tasks/PLAN-OPENAI-TECHNIK.md\` - der Plan. Lies den Abschnitt zu ${PHASE.id} GANZ.
2. \`tasks/openai-p0-entscheidungen.md\` - die Messergebnisse aus Phase 0. Sie haben den Plan an
   mehreren Stellen GEAENDERT. Wo P0 und Plan sich widersprechen, gewinnt P0.
3. \`tasks/openai-audit/00-openai-anforderungen.md\` - die massgeblichen 100 IDs.
   NICHT massgeblich: \`00-mcp-spec.md\`. Das ist eine ANDERE Norm und widerspricht bei
   \`destructiveHint\`. Genau diese Verwechslung hat schon einmal zu einem falschen "fertig"
   gefuehrt. Im Zweifel gilt die OpenAI-Fassung.
4. Alte Berichte unter \`tasks/openai-audit/01-*.md\` .. \`18-*.md\`: LANDKARTE, nie BELEG.

TEUER GELERNTES BETRIEBSWISSEN - daran haeltst du dich:
- Testkommando ist \`npm test -- -- --test-concurrency=4\`. NUR der doppelte \`--\`-Trenner kommt
  an; die beiden anderen Varianten verlieren das Flag still. Am 2026-09-20 nachgemessen.
- Der Exit-Code von \`npm test\` LUEGT. Nur die Zeilen \`# pass\` und \`# fail\` zaehlen.
- Grundlinie auf master JETZT: 6243 Faelle, 6243 gruen. Einzelne rote Faelle bei vollem Lauf
  sind auf dieser Maschine jedes Mal ein ANDERER Flake - isoliert jeweils gruen. Ein roter Test
  zaehlt erst, wenn er ISOLIERT erneut rot ist. Wer weniger gruen hat, hat etwas kaputtgemacht.
- Die Suite ist auf dieser Maschine NICHT deterministisch. Ein roter Test zaehlt erst, wenn er
  ISOLIERT erneut rot ist. Schneide die Ausgabe nie ab - sonst laesst sich nachher nicht mehr
  feststellen, welcher Test fiel (am 2026-09-20 genau so passiert).
- \`registerTool()\` des MCP-SDK VERWIRFT unbekannte Felder STILL. Ein Test, der das
  Registrierungsobjekt prueft, beweist deshalb NICHTS. Ein Test muss den echten
  \`tools/list\`-Output pruefen.
- Doppelte Pfade: was ueber HTTP \`/mcp\` gilt, muss auch ueber stdio gelten, und was fuer den
  mcp-nativen Adapter gilt, auch fuer den ChatGPT-Adapter. Ein Punkt ist erst erfuellt, wenn er
  auf ALLEN betroffenen Pfaden erfuellt ist. Genau dort ist es beim letzten Anlauf
  auseinandergegangen.
- Neue Env-Variable heisst VIER Orte: \`src/config.js\`, \`.env.example\`, \`render.yaml\` UND
  \`BASE_ENV\` in den Tests. Fehlt der vierte, leakt die echte \`.env\` in Spawn-Tests.
- Kommentare auf Deutsch, OHNE Umlaute (ue/oe/ae statt u-Umlaut usw.) - wie im Bestand.

ACHTUNG, PHASENSPEZIFISCH - DIES IST EINE LIVE-VERHALTENS-PHASE an der HTTP-Oberflaeche des
HAUPTSERVERS (app.sundartha.com, \`src/\`). Jede Aenderung hier ist beim naechsten Deploy live.

SCOPE - NUR DER HAUPTSERVER. Die Website (\`sundartha.com\`, \`apps/web\`) ist AUSDRUECKLICH
AUSGESCHLOSSEN: Website-Aenderungen laufen laut CLAUDE.md ueber den \`staging\`-Branch und das
Labor (\`docs/RUNBOOK-LAB-LIVE.md\`), bevor sie auf master duerfen - ein Merge dieser Kette auf
master wuerde das Labor umgehen. \`npm test\` deckt \`apps/web\` nicht ab. Fass \`apps/web\` NICHT an.

DIE PUNKTE:
B1 \`/healthz\` gibt unauthentifiziert Commit-SHA und \`configHash\` preis.
   BEVOR du etwas aenderst, finde ALLE Konsumenten dieser Felder: Tests, Skripte (\`scripts/\`),
   Runbooks und Doku (\`docs/\`, \`README.md\`, \`ONBOARDING.md\`, \`STATUS.md\`), der
   Render-Health-Check (Pfad und erwarteter Status - \`render.yaml\` \`healthCheckPath\`), und der
   Deploy-Nachweis des Owners (in diesem Repo wird "was ist live?" ueblicherweise per
   \`curl /healthz\` am SHA abgelesen - such danach).
   HARTE GRENZEN:
   - Der Render-Health-Check darf NIE brechen: gleicher Pfad, gleicher 2xx-Status. Bricht er,
     startet Render den Dienst in einer Schleife neu - dann faellt ALLES aus, auch eingehende Anrufe.
   - Der Deploy-Nachweis des Owners darf nicht ersatzlos wegfallen. Wenn SHA/configHash aus der
     oeffentlichen Antwort verschwinden, braucht es einen AUTHENTIFIZIERTEN Ersatz (hinter
     \`webAuthMw\` + \`adminMw\`, mit Eintrag in \`src/route-policy.js\`, sonst schlaegt
     \`test/route-auth-inventory.test.js\` fehl), und JEDE Doku-Stelle, die den alten Weg nennt,
     wird nachgezogen.
   - Wenn du nicht belegen kannst, dass beides haelt: AENDERE /healthz NICHT, sondern halte die
     Preisgabe als bewusst akzeptiertes Risiko mit Begruendung fest (PLAN-SECURITY.md). Nicht
     bauen ist ein zulaessiges Ergebnis.
B2 Security-Header am HAUPTSERVER: miss LESEND, welche Header app.sundartha.com heute liefert
   (GET auf \`/healthz\` und \`/.well-known/oauth-protected-resource\`, Header ansehen) und was
   der Code setzt (helmet o.ae., datei:zeile). Fehlt \`Referrer-Policy\` am Hauptserver, ergaenze
   sie mit einem restriktiven Wert. HSTS-\`preload\` NICHT setzen - die Aufnahme in die
   Preload-Liste ist faktisch nicht rueckgaengig zu machen; das ist Owner-Entscheidung.
   \`/.well-known/security.txt\` am Hauptserver: nur bauen, wenn eine Kontaktadresse im Repo
   BELEGT ist; eine erfundene Adresse ist schlimmer als keine Datei. Sonst Owner-Punkt.
   Jede neue Route: Begruendung im Code + Eintrag in \`src/route-policy.js\` (Oeffentlich-Liste).
B3 Kommentar \`src/mcp-tools.js:~612-613\`: sagt, die MCP-Spec fuehre nur zwei der drei Hints als
   optional. Falsch - in der MCP-Spec sind ALLE DREI optional (SDK \`ToolAnnotationsSchema\`: alle
   \`.optional()\`). Und \`:~618-624\` nennt fuer openWorldHint nur die enge Zugriffsregel;
   \`docs/OPENAI-TOOL-INVENTORY.md\` hat die Regel O1-O3 (inkl. "senden an externe Empfaenger").
   Beides angleichen - Kommentar und Inventar duerfen sich nicht widersprechen.

NICHT IN DIESER PHASE: \`apps/web\`/sundartha.com (Labor), HSTS-preload, \`MCP_AUTH\`-Trim,
\`requiredClaims: ['exp']\`, O-27-Texte in \`place_call\` (brauchen convo-bench), Hint-Werte.

Der Safety-Review prueft am Draht: Render-Health-Check-Pfad und -Status vorher/nachher identisch,
keine neue unauthentifizierte Route ohne route-policy-Eintrag, und kein Request, der vorher
abgelehnt wurde, kommt jetzt durch.

HARTE VERBOTE:
- Die Safety-Gates aus CLAUDE.md werden NICHT angefasst, nicht aufgeweicht, nicht "fuer die
  Einreichung" umgangen. Das gilt auch mittelbar und auch "voruebergehend".
- Der fest verdrahtete Offenlegungssatz bleibt, wie er ist.
- Kein echter Anruf, keine echte SMS, kein Deploy, kein Schreibzugriff auf Produktion.
- Kein \`git add -A\`. Dateien EINZELN adden. Kein Push. Kein Merge nach master - das macht
  der Lead.
- Keine neuen abgeschalteten Sicherungen (\`eslint-disable\`-artige Marker, uebersprungene
  Checks), keine Magic Numbers ohne benannte Konstante, kein toter oder auskommentierter Code.`

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    schritte: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nr: { type: 'number' },
          was: { type: 'string' },
          datei: { type: 'string', description: 'datei:zeile, wo die Aenderung hingehoert' },
          ids: { type: 'string' },
          pfade: { type: 'string', description: 'welche Pfade das beruehrt: HTTP/stdio/chatgpt/mcp-nativ' },
          beweis: { type: 'string', description: 'wie ein FREMDER Pruefer das nachher nachprueft' },
        },
        required: ['nr', 'was', 'datei', 'ids', 'pfade', 'beweis'],
      },
    },
    nicht_bauen: { type: 'array', items: { type: 'string' }, description: 'was in dieser Phase ausdruecklich NICHT gebaut wird, je mit Grund' },
    pre_mortem: { type: 'array', items: { type: 'string' }, description: 'ein Jahr spaeter war diese Phase ein Fehler - was ist passiert, und was entschaerft es' },
    widersprueche: { type: 'array', items: { type: 'string' }, description: 'wo Plan und P0-Messung sich widersprechen und wie du es aufgeloest hast' },
  },
  required: ['schritte', 'nicht_bauen', 'pre_mortem', 'widersprueche'],
}

phase('Planen')
log(VORGEBAUT
  ? `${PHASE.id} "${PHASE.titel}" - bereits gebaut auf ${VORGEBAUT.branch}, Plan und Bau werden uebersprungen.`
  : `${PHASE.id} "${PHASE.titel}" - Plan wird geschnitten.`)

const spec = VORGEBAUT ? LEERE_SPEC : await agent(
  `Du planst Phase ${PHASE.id} "${PHASE.titel}" der OpenAI-Einreichung von Hermes.
Du schreibst GENAU EINE Datei: \`tasks/openai-${PHASE.id.toLowerCase()}-spec.md\`.
DU AENDERST KEINEN CODE.
${RAHMEN}

DEIN AUFTRAG:
1. Lies den ${PHASE.id}-Abschnitt im Plan GANZ, dazu die P0-Entscheidungen.
2. Sieh dir den betroffenen Code SELBST an. Der Plan kann sich irren - er ist aelter als P0.
   Wo der Plan eine Zeile nennt, sieh an dieser Zeile nach, ob dort wirklich steht, was er sagt.
   Jede Abweichung gehoert in "widersprueche".
3. Schneide die Phase in nummerierte, EINZELN pruefbare Arbeitsschritte. Je Schritt: was genau
   geaendert wird, an welcher Stelle (datei:zeile), welche IDs er erfuellt, WELCHE PFADE er
   beruehrt, und wie ein FREMDER Pruefer - der deine Spec nicht lesen darf - das nachher
   nachprueft.
4. Der Beweis je Schritt ist eine dieser drei Arten, nie etwas anderes:
   (a) Code an einer nennbaren Stelle, (b) ein gruener Test, der den Punkt TATSAECHLICH prueft,
   (c) eine lesende Messung mit Befehl und erwarteter Ausgabe.
   "Korrekt umgesetzt" oder "funktioniert" ist KEIN Beweis.
5. Sag ausdruecklich, was in dieser Phase NICHT gebaut wird und warum.
6. Schreib ein Pre-Mortem: ein Jahr spaeter war diese Phase ein Fehler - was ist passiert?
   Konkret auf diese Phase bezogen, nicht generisch.
7. Wenn ein geplanter Schritt nach deiner Pruefung GEGENSTANDSLOS ist, sag das und bau ihn
   nicht. Nicht bauen ist ein zulaessiges Ergebnis.

Bedenke die Tests: welcher bestehende Test bricht durch deine Aenderung? Welcher neue Test
beweist sie? Neues Verhalten braucht einen Test.
${FRAGEVERBOT}`,
  { label: `${PHASE.id}:plan`, phase: 'Planen', model: 'opus', effort: 'high', schema: SPEC_SCHEMA },
)

if (!spec) return { fehler: 'Planungsagent ausgefallen - keine Spec, nichts gebaut.' }

if (!VORGEBAUT) log(`Spec steht: ${spec.schritte.length} Schritte, ${spec.nicht_bauen.length} bewusst nicht gebaut.`)

phase('Bauen')

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    commit: { type: 'string' },
    dateien: { type: 'array', items: { type: 'string' } },
    test_pass: { type: 'number' },
    test_fail: { type: 'number' },
    test_kommando: { type: 'string' },
    nicht_gebaut: { type: 'array', items: { type: 'string' }, description: 'Schritte der Spec, die du NICHT gebaut hast, je mit Grund' },
    abweichungen: { type: 'array', items: { type: 'string' }, description: 'wo du von der Spec abgewichen bist und warum' },
    selbstzweifel: { type: 'array', items: { type: 'string' }, description: 'was du gebaut hast, bei dem du selbst nicht sicher bist, dass es traegt' },
  },
  required: ['branch', 'commit', 'dateien', 'test_pass', 'test_fail', 'test_kommando', 'nicht_gebaut', 'abweichungen', 'selbstzweifel'],
}

const impl = VORGEBAUT ?? await agent(
  `Du baust Phase ${PHASE.id} "${PHASE.titel}" der OpenAI-Einreichung von Hermes.
${RAHMEN}

DEINE SPEC liegt in \`tasks/openai-${PHASE.id.toLowerCase()}-spec.md\` - lies sie ganz.

ARBEITSPLATZ - genau so, in dieser Reihenfolge:
1. \`cd "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent"\`
2. \`git log --oneline -1 master\` - notiere den Stand.
3. \`git worktree add -b ${PHASE.branch} "${WT}" master\`
   Wenn der Branch schon existiert, ist ein frueherer Lauf abgebrochen: benutze
   \`${PHASE.branch}-neu\` und schreib das in "abweichungen". Loesche NICHTS.
4. Ab jetzt arbeitest du AUSSCHLIESSLICH in \`${WT}\`. Die Hauptarbeitskopie fasst du nicht an -
   dort arbeitet der Lead.

BAUEN:
- Lies \`.claude/refs/clean-code.md\` und halte dich daran. Das ist Pflicht, keine Empfehlung:
  Verschachtelung hoechstens 4 (Ziel 2), Funktionen deutlich unter 100 Zeilen, hoechstens 3
  Argumente (Ziel 0-2).
- Vor jedem Edit die Datei bzw. den Bereich lesen. Bei Funktionsaenderungen erst \`grep\` nach
  ALLEN Aufrufern - die Werkzeuge werden auch von der Budget-Engine benutzt.
- Nach den Edits: \`node --check\` auf jede geaenderte .js-Datei.
- Dann die Tests: \`npm test -- -- --test-concurrency=4\`. Notiere \`# pass\` und \`# fail\` als
  Zahlen. Der Exit-Code luegt, sieh auf die Zeilen. Die Grundlinie steht OBEN im Rahmen - nimm die, nicht irgendeine Zahl aus einem Bericht.
- Rot heisst: etwas ist kaputt. Repariere die URSACHE, nicht den Test. Einen Test anzupassen ist
  nur richtig, wenn sich das SOLL-Verhalten absichtlich geaendert hat - dann schreib das in
  "abweichungen".
- Raeume auf: keine zurueckgelassenen Testserver. Pruefe mit \`ps\`, NICHT mit \`pgrep\` - der ist
  in dieser Sandbox blind.
- Committen: Dateien EINZELN adden, niemals \`git add -A\`. Eine aussagekraeftige deutsche
  Commit-Nachricht ohne Umlaute. KEIN Push.

COMMITTE FRUEH UND OFT - nach jedem abgeschlossenen Schritt ein eigener Commit. Und das
Wichtigste: GIB DEINE STRUKTURIERTE RUECKGABE AB, SOLANGE DU NOCH LUFT HAST. Wenn du merkst,
dass die Arbeit laenger wird als gedacht, committe sofort und melde zurueck, auch wenn Schritte
offen sind - trag sie in "nicht_gebaut" ein. Eine abgegebene Rueckgabe mit offenen Punkten ist
weit besser als gar keine: ein Lauf, der ohne Rueckgabe endet, gilt als abgestuerzt, und der
naechste Agent muss erst forensisch feststellen, was du ueberhaupt getan hast. Das ist am
2026-09-20 in genau dieser Kette passiert und hat einen ganzen Lauf gekostet.

WENN EIN SCHRITT SICH ALS FALSCH HERAUSSTELLT: bau ihn nicht und schreib ihn in "nicht_gebaut"
mit Grund. Ein ehrliches "nicht gebaut, weil ..." ist weit besser als etwas, das nur so aussieht
wie erfuellt. Dasselbe gilt fuer "selbstzweifel": nenne dort alles, wovon du selbst nicht
ueberzeugt bist. Der Review-Schritt danach sucht genau dort zuerst.
${FRAGEVERBOT}`,
  { label: `${PHASE.id}:impl`, phase: 'Bauen', model: 'sonnet', effort: 'high', schema: IMPL_SCHEMA },
)

if (!impl) return { spec, fehler: 'Implementierungsagent ausgefallen.' }

log(`Gebaut auf ${impl.branch}: ${impl.dateien.length} Dateien, Tests ${impl.test_pass} gruen / ${impl.test_fail} rot.`)

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

const DIFF_BASIS = `Der Diff dieser Phase: \`git diff master...${impl.branch}\` im Verzeichnis
"/Users/antonio/Mein Unternehmen/MCP/vodafone-agent". Die Arbeitskopie des Bauens liegt in
"${WT}". Sieh dir den ECHTEN Diff an, nicht die Spec und nicht den Bericht des Bauenden.`

const REVIEWER = [
  {
    key: 'safety',
    model: 'opus',
    auftrag: `Du bist Safety- und Verhaltens-Reviewer. Du suchst, was in Produktion weh tut.
${DIFF_BASIS}

PRUEFE:
1. SAFETY-GATES: ist irgendein Gate aus CLAUDE.md angefasst, aufgeweicht oder umgangen - auch
   mittelbar, auch "voruebergehend"? Das ist IMMER ein Blocker. Dazu zaehlen: Outbound-Permit
   (Abo+KYC), \`OUTBOUND_FROZEN\`, Denylist/Land-Gate/Stundenlimit, die pro-Tenant-Kostendecke
   (sperrt BEIDE Richtungen, Inbound eingeschlossen), Max-Gespraechsdauer, die
   Provider-Signaturpruefung (fail-closed), der fest verdrahtete Offenlegungssatz.
2. AUTH FAIL-CLOSED: kommt ein neuer Endpunkt oder Pfad dazu, der nicht hinter einer
   authentifizierten Identitaet haengt? Jede Ausnahme braucht Begruendung im Code UND einen
   Eintrag in \`src/route-policy.js\`.
3. VERHALTENSAENDERUNG: aendert der Diff etwas fuer die HEUTIGEN Nutzer, obwohl er nur additiv
   sein sollte? Das ist der haeufigste stille Fehler dieser Kette. Geh jede geaenderte Funktion
   durch und frag: wer ruft sie heute, und bekommt der jetzt etwas anderes?
4. DOPPELTE PFADE: ist der Punkt auf ALLEN betroffenen Pfaden erfuellt (HTTP /mcp UND stdio;
   mcp-nativer Adapter UND ChatGPT-Adapter)? Wenn der Diff nur einen Pfad anfasst, obwohl zwei
   betroffen sind, ist das ein Blocker. Genau dort ist es beim letzten Anlauf auseinandergegangen.
5. SECRETS/PII: leakt etwas in Logs, API-Antworten oder MCP-Ausgaben? Kommen Diagnose-Token,
   Modell-IDs, Carrier-Codes oder woertliche Drittzeilen nach aussen?
6. TESTS, DIE NICHTS BEWEISEN: sieh in die neuen Tests HINEIN. Prueft der Test wirklich den
   Punkt, oder nur, dass eine Funktion nicht wirft? Prueft er das Registrierungsobjekt statt des
   echten \`tools/list\`-Outputs? \`registerTool()\` verwirft unbekannte Felder STILL - ein Test am
   Registrierungsobjekt beweist nichts. Ein Test mit gleichen Fixture-Werten auf beiden Seiten
   testet nichts. Das ist ein Blocker, kein Schoenheitsfehler.
7. Stimmt die OpenAI-Fassung der Anforderung, oder wurde aus \`00-mcp-spec.md\` gebaut?`,
  },
  {
    key: 'cleancode',
    model: 'sonnet',
    auftrag: `Du bist Clean-Code-Auditor. \`.claude/refs/clean-code.md\` ist dein Pruefkatalog -
lies ihn zuerst und arbeite ihn ab.
${DIFF_BASIS}

HARTE GRENZEN (Ueberschreitung = Blocker):
- Verschachtelungstiefe hoechstens 4, Ziel 2
- Funktionslaenge hoechstens 100 Zeilen, Ziel deutlich darunter
- hoechstens 3 Argumente, Ziel 0-2
- HART VERBOTEN: Magic Numbers ausser 0/1/-1 ohne benannte Konstante, toter Code,
  auskommentierter Code, neue abgeschaltete Sicherungen (\`eslint-disable\`-artige Marker,
  uebersprungene Checks)

AUSSERDEM:
- Wiederholung: ist dieselbe Logik jetzt an zwei Stellen? Dann ist die zweite Stelle die, die
  spaeter vergessen wird. Nenne sie.
- Invarianten per Konvention: haengt die Richtigkeit daran, dass jemand in Zukunft daran denkt?
  Das ist der Fragilitaets-Befund dieses Repos - nenne ihn, wenn du ihn siehst.
- Kommentare: Deutsch, OHNE Umlaute? Behauptet ein Kommentar etwas, das der Code nicht tut?
  Ein Kommentar, der luegt, ist schlimmer als keiner - in diesem Repo schon zweimal passiert.
- Passt die Aenderung zum Stil des Bestands, oder bringt sie ein neues Muster mit?
- ESM, kein Build-Step, wenige Dependencies: neue Abhaengigkeit ohne Begruendung ist ein Blocker.`,
  },
]

async function reviewRunde(welche, runde) {
  return (await parallel(welche.map(r => () =>
    agent(
      `Du pruefst Phase ${PHASE.id} "${PHASE.titel}" der OpenAI-Einreichung von Hermes${runde > 1 ? ` (Nachpruefung, Runde ${runde})` : ''}.
${RAHMEN}

Der Bauende hat SELBST diese Zweifel genannt - sieh dort zuerst nach:
${impl.selbstzweifel.length ? impl.selbstzweifel.map(z => '- ' + z).join('\n') : '- (keine genannt; das ist selbst ein Signal)'}
Und diese Schritte hat er NICHT gebaut:
${impl.nicht_gebaut.length ? impl.nicht_gebaut.map(z => '- ' + z).join('\n') : '- (keine)'}

${r.auftrag}

URTEIL: FAIL, sobald EIN Blocker dasteht. Sonst PASS. Sei streng - ein PASS hier fuehrt zum
Merge. Aber erfinde nichts: jeder Befund braucht eine Stelle (datei:zeile) und ein konkretes
Szenario, in dem er weh tut. Ein Befund ohne Szenario ist Geschmack, keine Forderung -
stuf ihn dann als kosmetisch ein.
${FRAGEVERBOT}`,
      { label: `${PHASE.id}:review:${r.key}${runde > 1 ? `:r${runde}` : ''}`, phase: runde > 1 ? 'Nachbessern' : 'Review', model: r.model, effort: 'high', schema: REVIEW_SCHEMA },
    ),
  ))).map((erg, i) => ({ wer: welche[i].key, erg })).filter(x => x.erg)
}

phase('Review')
let runde = 1
let reviews = await reviewRunde(REVIEWER, runde)
let blocker = reviews.flatMap(r => r.erg.befunde.filter(b => b.schwere === 'blocker' || b.schwere === 'wichtig'))
log(`Review Runde 1: ${reviews.map(r => r.wer + '=' + r.erg.urteil).join(', ')}; ${blocker.length} Befunde zum Nachbessern.`)

const MAX_RUNDEN = 3
const historie = [{ runde: 1, urteile: reviews.map(r => ({ wer: r.wer, urteil: r.erg.urteil })), blocker: blocker.length }]

while (blocker.length && runde < MAX_RUNDEN) {
  runde++
  phase('Nachbessern')

  const fix = await agent(
    `Du besserst Phase ${PHASE.id} "${PHASE.titel}" nach. Zwei Reviewer haben Befunde erhoben.
Du arbeitest im Worktree "${WT}" auf dem Branch ${impl.branch}.
${RAHMEN}

BEFUNDE (Runde ${runde - 1}):
${JSON.stringify(blocker, null, 1)}

REGELN:
- Du arbeitest JEDEN Befund ab ODER begruendest in einem Satz, warum der Reviewer irrt. Ein
  Befund still uebergehen ist nicht erlaubt.
- Du behebst die URSACHE, nicht das Symptom. Einen Test so umzubiegen, dass er gruen wird, ist
  die falsche Richtung - es sei denn, das SOLL-Verhalten hat sich absichtlich geaendert.
- Du baust NICHTS Neues, was nicht gefordert war. Kein Scope-Zuwachs.
- Danach wieder: \`node --check\` auf jede geaenderte Datei, dann
  \`npm test -- -- --test-concurrency=4\`, \`# pass\`/\`# fail\` notieren, aufraeumen (\`ps\`, nicht
  \`pgrep\`), einzeln adden, committen, NICHT pushen.
${FRAGEVERBOT}

Gib als Antwort zurueck: je Befund eine Zeile (behoben wie / oder warum der Reviewer irrt),
dann die Testzahlen.`,
    { label: `${PHASE.id}:fix:r${runde}`, phase: 'Nachbessern', model: 'sonnet', effort: 'high' },
  )

  if (!fix) { log('Fix-Agent ausgefallen - Runde abgebrochen.'); break }

  const nochmal = REVIEWER.filter(r => reviews.some(x => x.wer === r.key && x.erg.urteil === 'FAIL'))
  reviews = await reviewRunde(nochmal.length ? nochmal : REVIEWER, runde)
  blocker = reviews.flatMap(r => r.erg.befunde.filter(b => b.schwere === 'blocker' || b.schwere === 'wichtig'))
  historie.push({ runde, urteile: reviews.map(r => ({ wer: r.wer, urteil: r.erg.urteil })), blocker: blocker.length })
  log(`Runde ${runde}: ${reviews.map(r => r.wer + '=' + r.erg.urteil).join(', ')}; ${blocker.length} offen.`)
}

phase('Bericht')

const bericht = await agent(
  `Du schreibst den Abschlussbericht fuer Phase ${PHASE.id} "${PHASE.titel}" der
OpenAI-Einreichung von Hermes, in \`tasks/openai-${PHASE.id.toLowerCase()}-report.md\`.
Du aenderst KEINEN Code.

Der Bericht ist fuer einen Lead, der den Code NICHT liest. Er muss danach entscheiden koennen,
ob er merged. Deshalb: keine Beschoenigung. Was offen ist, steht drin.

TATSACHEN:
- Branch: ${impl.branch}, Commit: ${impl.commit}
- Geaenderte Dateien: ${JSON.stringify(impl.dateien)}
- Tests zuletzt: ${impl.test_pass} gruen / ${impl.test_fail} rot (Kommando: ${impl.test_kommando})
- Review-Historie: ${JSON.stringify(historie)}
- Noch offene Befunde: ${JSON.stringify(blocker)}
- Nicht gebaut: ${JSON.stringify(impl.nicht_gebaut)}
- Abweichungen von der Spec: ${JSON.stringify(impl.abweichungen)}

Schreib im Bericht:
1. Was diese Phase erfuellt, ID fuer ID, je mit der Beweisstelle (datei:zeile oder Testname).
2. Was sie NICHT erfuellt und warum - ausdruecklich, ganz oben, nicht versteckt.
3. Welche Pfade beruehrt sind und ob der Punkt auf ALLEN erfuellt ist.
4. Was ein fremder Pruefer nachmessen sollte, um das zu bestaetigen - als Liste von Befehlen
   bzw. Stellen. Formuliere sie NEUTRAL ("ist X erfuellt und woran siehst du das"), nicht
   bestaetigend.
5. Restrisiko in einem Absatz.
${FRAGEVERBOT}

Gib als Antwort NUR eine kompakte Zusammenfassung fuer den Lead zurueck: erfuellte IDs, offene
IDs, Testzahlen, offene Befunde, und ob du selbst merge-freigeben wuerdest.`,
  { label: `${PHASE.id}:bericht`, phase: 'Bericht', model: 'sonnet' },
)

return {
  phase: PHASE.id,
  branch: impl.branch,
  commit: impl.commit,
  dateien: impl.dateien,
  tests: `${impl.test_pass} gruen / ${impl.test_fail} rot`,
  runden: historie,
  offene_befunde: blocker,
  nicht_gebaut: impl.nicht_gebaut,
  widersprueche_zum_plan: spec.widersprueche,
  bericht,
}
