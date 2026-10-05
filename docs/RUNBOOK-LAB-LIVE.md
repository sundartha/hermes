# RUNBOOK: Lab -> Live (Gateway `vodafone-agent` und Website `apps/web`)

Zweck: Jede Aenderung geht ueber einen Pull Request auf `master`. Nach dem
Merge prueft der Workflow `staging` den Staging-Dienst, und der Workflow
`live` entscheidet, ob die Produktion genau diesen Commit bekommt. Niemand
deployt die Produktion mehr von Hand per API-Schluessel. Der Branch `staging`
wird nicht mehr benutzt.

## Services (Render)

| Rolle | Service | Quelle | Deploy |
|---|---|---|---|
| Staging (Gateway) | `hermes-staging` (Render Free) | `master` | automatisch bei jedem master-Commit (Render "On Commit") |
| Produktion (Gateway) | `vodafone-agent` (srv-d8m0fhflk1mc73bno570, Render Free) | `master` | nur ueber den Workflow `live` (Auto-Deploy bei Render aus) |
| Labor (Website) | `hermes-web-staging` (srv-d93r4jnlk1mc739s504g) | `master` | automatisch bei jedem master-Commit |
| Website live | `hermes-web` (srv-d8tbfghkh4rs73bs63pg) | `master` | laut render.yaml automatisch (Auto-Deploy an, per Render-API geprueft 2026-10-01) |

Die Adressen und die Dienst-ID sind oeffentlich und stehen fest in den
Workflows, nicht als GitHub-Variablen: `STAGING_URL` =
`https://hermes-staging-erpv.onrender.com` (staging.yml), `PRODUKTION_URL` =
`https://app.sundartha.com` und `RENDER_SERVICE_ID` =
`srv-d8m0fhflk1mc73bno570` (live.yml). Aendert sich einer dieser Werte, geht
die Aenderung als Pull Request in die Workflow-Datei. Beide Dienste melden
unter `/healthz` den Commit, der gerade laeuft.

`HERMES_DEPLOY_TOKEN` ist das Token, mit dem der Workflow `live` die
Produktion unter `/intern/anrufe-laufend` fragt, ob gerade ein Anruf laeuft.
Es hat mindestens 32 Zeichen, ohne Leerzeichen und ohne Zeilenumbruch, und
steht mit demselben Wert an zwei Stellen: als Secret im GitHub-Environment
`produktion` und als Umgebungsvariable beim Render-Dienst `vodafone-agent`.
Ist es auf dem Server leer oder kuerzer als 32 Zeichen, lehnt die Produktion
jede Anfrage ab, und `live` deployt nicht.

Der Gateway baut und serviert das Website-Build mit (`app.sundartha.com`).
Eine Aenderung unter `apps/web/` geht deshalb auch mit dem naechsten
Produktions-Deploy ueber `live` hinaus.

Das Labor traegt `X-Robots-Tag: noindex` (kein SEO-Leak) und spiegelt die
Live-CSP (`default-src 'self'; script-src 'self'; ...`) — was im Labor
funktioniert, funktioniert auch live; was die CSP blockt, faellt schon im
Labor auf. `PUBLIC_GATEWAY_URL` ist gesetzt (routes.js ist fail-closed,
ohne die Var bricht der Build ab).

## Ablauf

1. **Arbeiten:** eigener Branch, Pull Request auf `master`. Website-Arbeit
   lokal mit `npm --prefix apps/web run dev`. Gemergt wird nur, wenn alle
   Pflicht-Checks aus dem Regelsatz fuer `master` gruen sind. Ein Approve
   oder Label ist derzeit nicht noetig ("Freigabe-Pruefung" und
   "Testschutz" sind voruebergehend keine Pflicht-Checks).
2. **Merge auf `master`:** Render baut `hermes-staging` und das
   Website-Labor automatisch. Sichtpruefung der Website im Labor:
   https://hermes-web-staging.onrender.com — Desktop, mobil,
   Browser-Konsole (CSP-Verstoesse erscheinen dort).
3. **Workflow `staging`** (startet bei jedem Push auf `master`):
   - wartet, bis `/healthz` von Staging genau diesen Commit meldet
     (hoechstens 20 Minuten, sonst rot);
   - prueft Staging ohne Zugangsdaten (`scripts/probe-auth.sh`) und dass
     `POST /mcp` ohne Anmeldung mit 401 abgelehnt wird;
   - meldet Staging schon einen neueren master-Commit, endet der Lauf rot
     ("ueberholt"). Kommen zwei Merges kurz hintereinander, bricht der
     aeltere Lauf ab; live geht dann nur der neuere Commit.
4. **Workflow `live`** (startet automatisch nach einem gruenen `staging`-Lauf):
   - Job `entscheiden` prueft unter anderem: der `staging`-Lauf war gruen und
     kam von einem echten Push auf `master` in diesem Repo; der Commit ist der
     Merge eines Pull Requests, dessen Pflicht-Checks gruen waren; der Commit
     ist neuer als der, den die Produktion unter `/healthz` meldet.
     Danach vergleicht der **Gespraechsabdruck** Produktion und Kandidat:
     Anrufstart-Koerper, Eingangs-Antwort, Prompt-Texte, Sprach-Bausteine,
     Stimmen-Tabelle und die besessenen Felder der Agent-Vorlage.
   - **Gespraech unveraendert:** Job `deploy` (Environment `produktion`;
     ohne Reviewer und ohne Wartezeit, also ohne Freigabe von Hand) wartet,
     bis keine Anrufe laufen (`/intern/anrufe-laufend` meldet 0, hoechstens
     35 Minuten), loest den Render-Deploy genau dieses Commits aus, bricht
     ihn ab, falls beim Umschalten doch ein Anruf laeuft, und wartet, bis
     `/healthz` der Produktion den neuen Commit meldet.
   - **Aufwachen:** `vodafone-agent` und `hermes-staging` laufen auf Render
     Free und schlafen nach 15 Minuten ohne Verkehr ein; das Aufwachen
     dauert etwa eine Minute, solange zeigt Render eine Ladeseite. Vor jeder
     einzelnen Abfrage der Produktion weckt `live` sie deshalb zuerst:
     `/healthz` mit 90 Sekunden Frist, alle 20 Sekunden erneut, hoechstens
     5 Minuten und nie laenger als die Restzeit des Schritts. Wach ist sie
     erst, wenn `/healthz` mit HTTP 200 als JSON einen 40-stelligen Commit
     meldet; die Ladeseite zaehlt nicht. Wacht sie nicht auf, endet der Lauf
     rot ("nicht aufgewacht") und deployt nichts. Das Wecken macht nie etwas
     gruen; danach folgt die normale Abfrage. Solange Render baut, haelt
     `deploy` die alte Instanz mit einer `/healthz`-Abfrage je Runde wach.
     Staging weckt die bestehende Warteschleife aus Schritt 3 mit.
   - **Ruhefenster:** Beim Einschlafen geht die Anrufzaehlung verloren. War
     die Produktion in diesem Lauf frisch geweckt (in `entscheiden` oder vor
     der ersten Anruf-Abfrage), loest `deploy` den Render-Deploy erst aus,
     wenn 20 Minuten lang jede Anruf-Abfrage (jede Minute) 0 meldet; jeder
     laufende Anruf startet die 20 Minuten neu. Passt das nicht in die
     35 Minuten, endet der Lauf rot. Ist die Produktion beim Umschalten
     (`update_in_progress`) frisch geweckt, gilt die Zaehlung als nicht
     gemessen: `deploy` bricht den Deploy ab und endet rot.
   - **Gespraech geaendert:** kein Deploy. Job `hoertest` legt das Issue
     "Hoertest noetig vor dem Live-Deploy" an oder ersetzt dessen Text:
     Commit, Namen der geaenderten Abdruck-Teile, Link zum Lauf, Anleitung.
5. **Hoertest und Hand-Start** (nur Antonio20045 oder jonas986):
   - Testanruf ueber Staging: klingt der Agent richtig, sagt er das
     Richtige, in der richtigen Sprache und Stimme?
   - Passt alles: GitHub -> Actions -> Workflow `live` -> "Run workflow",
     Branch `master`, Eingabe `commit` = der Commit aus dem Issue. Der
     Hand-Start gilt als bestaetigter Hoertest; danach laeuft Schritt 4 ohne
     Hoertest-Sperre weiter (Anruf-Pruefung und Deploy bleiben gleich).
   - Abgelehnt wird ein Hand-Start von anderen Personen, von einem anderen
     Branch als `master` und fuer einen Commit ohne gruenen `staging`-Lauf
     aus einem Push.
   - Danach das Hoertest-Issue schliessen.
6. **Rollback:**
   - Zuerst den Workflow `live` abschalten: GitHub -> Actions -> linke
     Leiste Workflow `live` -> Menue "..." -> "Disable workflow". Ein Rollback
     in Render haelt `live` nicht an: Jeder spaetere Merge enthaelt den
     fehlerhaften Commit, und aendert dieser das Gespraech nicht, deployt
     `live` ihn ohne Menschen wieder.
   - Dann Render-Dashboard -> `vodafone-agent` -> Deploys -> den frueheren
     Deploy waehlen -> "Rollback" -> "Rollback to this deploy" (Sekunden).
     Auf Render Free geht das nur zu einem der zwei letzten Deploys.
     Render schaltet dabei Auto-Deploy ab; bei `vodafone-agent` ist es
     ohnehin aus. Danach mit `/healthz` pruefen, welcher Commit in der
     Produktion laeuft.
   - Die Ursache mit `git revert` auf einem eigenen Branch per Pull Request
     beheben; der Revert geht denselben Weg wie oben.
   - `live` erst wieder einschalten ("Enable workflow"), wenn die Korrektur
     auf `master` gemergt ist. Fuer die Merges der Zwischenzeit startet
     `live` nicht nachtraeglich; die Korrektur geht mit dem naechsten Merge
     live oder per Hand-Start wie in Schritt 5 (mit Hoertest). Einen alten
     Lauf von `live` startet niemand neu.
7. **Token wechseln** (`HERMES_DEPLOY_TOKEN`): neuen Wert an beiden Stellen
   eintragen (GitHub-Environment `produktion` und Render `vodafone-agent`).
   Render uebernimmt den neuen Wert erst mit einem Deploy, und `live` kann
   diesen Deploy nicht selbst machen. Danach deployt Antonio den Commit, den
   `/healthz` der Produktion gerade meldet, einmal von Hand im
   Render-Dashboard; so kommt kein neuer Code live. Bis dahin endet jeder
   Lauf von `live` rot mit HTTP 401.

## Leitplanken

- Der Branch `staging` wird nicht mehr benutzt: keine Pushes, keine Merges
  von dort. Loeschen darf ihn nur Antonio, erst nachdem dieses Runbook auf
  `master` ist und das Website-Labor nachweislich aus `master` baut.
- Die Produktion wird nur ueber den Workflow `live` deployt. Ein
  "Manual Deploy" im Render-Dashboard oder per API umgeht die Anruf-Pruefung
  und den Gespraechsabdruck; erlaubt ist im Dashboard nur der Rollback.
  Ausnahmen sind genau zwei Deploys von Hand: der einmalige erste Deploy
  eines Commits mit diesem Weg (vorher kennt die Produktion
  `/intern/anrufe-laufend` nicht, und `live` endet vor dem Ausloesen rot)
  und der Deploy desselben Commits nach einem Token-Wechsel (Schritt 7).
- Der Gespraechsabdruck sieht nicht: was das Sprachmodell im Gespraech
  tatsaechlich formuliert, den Live-Agenten im ElevenLabs-Konto (dafuer
  `npm run elevenlabs:drift`) und Render-Umgebungsvariablen. Ein Push des
  Agenten (`npm run elevenlabs:push`) wirkt sofort und unabhaengig von diesem
  Weg.
- Render Free: 750 Free-Stunden je Workspace und Monat; danach setzt Render
  alle Free-Dienste bis Monatsende aus, und `staging` und `live` enden rot.
- Bekannte Luecke: zwischen der letzten Anruf-Abfrage und dem Umschalten
  kann ein Anruf beginnen. Der alte Prozess wartet beim Beenden hoechstens
  `SHUTDOWN_DRAIN_TIMEOUT_MS` (8 Sekunden) und fuehrt Anrufe nicht zu Ende.
- `hermes-web` steht laut render.yaml auf Auto-Deploy: jeder master-Commit
  mit Aenderung unter `apps/web/` geht dort ohne weiteren Schritt live. Soll
  die Website nur von Hand live gehen, muss Auto-Deploy bei `hermes-web` im
  Render-Dashboard aus sein — vor dem Merge pruefen.
- CSP beachten: keine Inline-Skripte, kein `eval`. three.js/WebGL ist mit
  `script-src 'self'` kompatibel, solange alles gebundelt ist.
- `public/`-Assets werden nicht gehasht: bei Aenderungen Dateinamen
  versionieren und pfadgenaue Cache-Header mitziehen (Muster: Hero-Video
  in render.yaml).
