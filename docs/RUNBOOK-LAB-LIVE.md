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
Fehlt es auf dem Server oder hat es dort weniger als 32 Zeichen, lehnt die
Produktion jede Anfrage ab, und `live` deployt nicht.

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

## Abhaengigkeits-Updates (automatisch, Issue #3458)

Zweck: npm-Pakete im Wurzelpaket und in `apps/web`, GitHub Actions und die
Node-Hauptversion werden erkannt, nach einer Wartezeit geprueft und bei Gruen
gemergt und deployt. Der Deploy geht den ueblichen Weg (`staging`, dann
`live`); es gibt keinen Sonderweg und keine neue Umgebungsvariable an Hermes.
Keine Pruefung wird dafuer gelockert.

**Regeln je Art.** Die Art eines Update-PRs bestimmt
`updateArtBestimmen` in `tools/mutation-laeufe.mjs`. Bei mehreren Paketen in
einem PR gewinnt die hoechste Art; ein Sammel-PR mit einem Major gilt als
`major`.

| Art | Wartezeit (Quelle) | Urteil und Merge |
|---|---|---|
| `patch` | `.github/dependabot.yml` (`cooldown`), Mindestalter in `tools/freigabe.mjs` | automatisch bei Gruen |
| `minor` | wie `patch` | Prueferurteil mit Changelog-Auszug, dann automatisch bei Gruen |
| `major` | wie `patch`, ein PR je Major | Prueferurteil mit Migrationspruefung muss PASS sein, dann automatisch bei Gruen |
| `actions` | `.github/dependabot.yml` (`github-actions`) | wie `patch`; ein Sprung der Hauptversion zaehlt als `major` |
| `node-hauptversion` | erst ab Active LTS plus Frist, `tools/freigabe.mjs` und `tools/mutation-laeufe.mjs` | PASS und das Ja `Ja: Node-Hauptversion` von Antonio20045 am PR, Label `node-hauptversion` |
| `sicherheit` | keine | Prueferurteil, bei einem Major mit Migrationspruefung, dann automatisch bei Gruen |

Die Werte der Wartezeiten stehen nur in ihren Quellen. Gleichzeitig laeuft
hoechstens ein Update-PR in der Merge-Queue, und solange ein offener PR
dieselbe `package.json` aendert, wird kein Update gemergt.

**Node-Hauptversion.** Der Workflow `node-erkennung` laeuft woechentlich und
von Hand, liest die Release-Liste von Node und oeffnet bei einer neuen
Active-LTS-Hauptversion nach der Frist einen PR mit allen Stellen auf einmal.
Er mergt nie selbst. Er und die Nachkontrolle nutzen das Repository-Geheimnis
`UPDATE_WORKFLOW_TOKEN`, damit die Pflicht-CI auf diesen PRs startet; fehlt es,
endet der Lauf rot ohne PR.

**Nachkontrolle und Ruecknahme.** Nach dem Deploy eines Update-PRs
(Dependabot-Zweig oder Label `node-hauptversion`) fragt der Job
`nachkontrolle` in `live.yml` die Produktion, bis `/healthz` den neuen Commit
und `ok` zeigt; Takt und Frist stehen in `tools/deploy-weg/takt.mjs`. Gelingt
das nicht, oder schlug der Deploy fehl, legt er genau einen Revert-PR auf dem
Zweig `revert/<sha7>` an und meldet es im GitHub-Issue
`Nachkontrolle: Update-Deploy zurückgenommen`. Der Revert-PR geht durch
dieselbe Pflicht-CI und wird nie automatisch gemergt. Fehlt das Token, gibt es
keinen PR, und das Issue nennt den Handweg. Bei Deploys, die kein Update-PR
ausgeloest hat, passiert nichts. Der schnelle manuelle Weg bleibt der
Workflow `notfall` mit `zurueckrollen` (Schritt 6 oben).

**Not-Aus.** Das Label `updates-pausiert` auf einem offenen Issue oder PR des
Repos stoppt Auto-Merge und die Node-Erkennung sofort, auch fuer
Sicherheitsupdates und Node mit Ja. Ist das Label nicht abfragbar, gilt ein
Update nicht als frei. Neue Update-PRs von Dependabot stoppt das Label nicht;
dafuer `gh workflow disable node-erkennung` und in
`.github/dependabot.yml` die Updates pausieren. Wieder frei: Label entfernen.

**Sperrliste.** Ein Paket mit bekannter Unvertraeglichkeit steht in
`.github/dependabot.yml` unter `ignore`, mit `Grund:` und `Ablauf:` im
Kommentar davor. Ohne Grund oder mit abgelaufenem Datum wird der Test rot
(`test/sicherheit/abhaengigkeits-updates-wartezeiten.test.js`).

**Rueckgaengig machen.** Jeder Baustein dieser Automatik ist ein eigener
Merge-Commit; `git revert` des Commits als neuer PR nimmt ihn zurueck.

**Beleg.** Die Gesamtprobe `test/werkzeuge/update-automatik-runbook.test.js`
nennt je Zeile oben die Tests, die sie belegen.

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
  die Gesamtfrist `SHUTDOWN_DRAIN_TIMEOUT_MS` (Wert in `render.yaml`) und
  fuehrt Anrufe nicht zu Ende. Er wartet zuerst auf offene Anfragen, danach
  laeuft der letzte Flush des Speichers; laeuft die Gesamtfrist ab, endet der
  Prozess mit Exit `1` und einer Logzeile. Preis: Anbieter koennen waehrend
  des Stoppens bis zum Ablauf der Gesamtfrist `503` sehen.
- Notaus: erster Schritt ist `POST /intern/anrufpause`, damit keine neuen
  Anrufe ausgeloest werden; erst danach Dienst stoppen oder Schalter setzen.
- `hermes-web` steht laut render.yaml auf Auto-Deploy: jeder master-Commit
  mit Aenderung unter `apps/web/` geht dort ohne weiteren Schritt live. Soll
  die Website nur von Hand live gehen, muss Auto-Deploy bei `hermes-web` im
  Render-Dashboard aus sein — vor dem Merge pruefen.
- CSP beachten: keine Inline-Skripte, kein `eval`. three.js/WebGL ist mit
  `script-src 'self'` kompatibel, solange alles gebundelt ist.
- `public/`-Assets werden nicht gehasht: bei Aenderungen Dateinamen
  versionieren und pfadgenaue Cache-Header mitziehen (Muster: Hero-Video
  in render.yaml).
