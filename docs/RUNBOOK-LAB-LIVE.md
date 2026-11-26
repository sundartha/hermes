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

`HERMES_DEPLOY_TOKEN` ist das Token, mit dem der Workflow `notfall` die
Anrufpause setzt und liest und laufende Anrufe meldet (`anrufpause` in
`tools/deploy-weg/deploy.mjs`; die Produktion prueft es in
`deployTokenAbgewiesen`, `src/routes/intern-anrufe-laufend.js`). `live` fragt
damit keine laufenden Anrufe mehr ab, fuehrt es aber weiter als Pflichtwert
(`tools/deploy-weg/einstellungen.mjs`, Schritt `deploy`). Das Format steht
dort als Muster fuer `HERMES_DEPLOY_TOKEN`; es steht mit demselben Wert an
zwei Stellen: als Secret im GitHub-Environment `produktion` und als
Umgebungsvariable beim Render-Dienst `vodafone-agent`. Fehlt es auf dem
Server oder passt es nicht zum Muster, lehnt die Produktion die Anfragen von
`notfall` ab.

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
     Init-Inhalt des ausgehenden Anrufs, Eingangs-Antwort, Prompt-Texte, Sprach-Bausteine
     und die besessenen Felder der Agent-Vorlage.
   - **Gespraech unveraendert:** Job `deploy` (Environment `produktion`;
     ohne Reviewer und ohne Wartezeit, also ohne Freigabe von Hand) weckt die
     Produktion, loest den Render-Deploy genau dieses Commits aus, ohne auf
     laufende Anrufe zu warten und ohne Anrufpause, und wartet, bis
     `/healthz` der Produktion den neuen Commit meldet. Ein laufender Anruf
     bricht den Deploy auch beim Umschalten (`update_in_progress`) nicht ab,
     wird aber gekappt: #3375 (Anrufe ueberleben den Deploy ueber mehrere
     Instanzen) ist offen, die Produktion laeuft mit einer Instanz. Live-Deploy
     erst, wenn #3375 erledigt ist; bis dahin kappt ein Deploy laufende Anrufe.
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
   - **Gespraech geaendert:** kein Deploy. Job `hoertest` legt das Issue
     "Hoertest noetig vor dem Live-Deploy" an oder ersetzt dessen Text:
     Commit, Namen der geaenderten Abdruck-Teile, Link zum Lauf, Anleitung.
5. **Hoertest und Hand-Start** (nur Antonio20045 oder jonas986):
   - Testanruf ueber Staging: klingt der Agent richtig, sagt er das
     Richtige, in der richtigen Sprache und Stimme?
   - Passt alles: GitHub -> Actions -> Workflow `live` -> "Run workflow",
     Branch `master`, Eingabe `commit` = der Commit aus dem Issue. Der
     Hand-Start gilt als bestaetigter Hoertest; danach laeuft Schritt 4 ohne
     Hoertest-Sperre weiter (der Deploy bleibt gleich).
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
   Render uebernimmt den neuen Wert erst mit einem Deploy. Danach deployt Antonio den Commit, den
   `/healthz` der Produktion gerade meldet, einmal von Hand im
   Render-Dashboard; so kommt kein neuer Code live. Bis dahin lehnt die
   Produktion die Anrufpause von `notfall` mit HTTP 401 ab.

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
| `actions` | `.github/dependabot.yml` (`github-actions`), Mindestalter `ACTIONS_WARTE_TAGE` in `tools/freigabe.mjs` | wie `patch`; ein Sprung der Hauptversion zaehlt als `major` |
| `node-hauptversion` | erst ab Active LTS plus Frist, `tools/freigabe.mjs` und `tools/mutation-laeufe.mjs` | PASS und das Ja von Antonio20045 am PR mit dem Text aus `NODE_JA_TEXT` (`tools/mutation-laeufe.mjs`), Label `node-hauptversion` |
| `sicherheit` | keine Wartezeit in der Merge-Queue (`ersterFix` in `tools/freigabe.mjs`, nur npm); das Mindestalter aus `tools/lockfile-alter.mjs` (SG-19) gilt trotzdem, fuer einen juengeren npm-Fix geht nur ein Eintrag in `tools/basis/lieferkette-ausnahmen.json`; Actions-Fixe warten wie `actions` | Prueferurteil, bei einem Major mit Migrationspruefung, dann automatisch bei Gruen |

**Sicherheitsfix vor Ablauf des Mindestalters.** Ein bestaetigter npm-Fix, der
juenger ist als das Mindestalter, braucht einen eigenen PR mit dem Eintrag
`{ "name", "version" }` in `tools/basis/lieferkette-ausnahmen.json`. Die
Advisory-Nummer (GHSA oder CVE) steht im PR-Text; der PR geht durch die normale
Pflicht-CI und das Urteil, es gibt keinen Schalter. Ein Folge-PR entfernt den
Eintrag, sobald das Mindestalter erreicht ist. Fuer Actions gibt es keinen
Ausnahmeweg; sie bleiben bei `ACTIONS_WARTE_TAGE` in `tools/freigabe.mjs`.

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
keinen PR, und das Issue nennt den Handweg. Hat die Produktion den Commit
bestaetigt, schickt die Nachkontrolle zusaetzlich je einen fremd signierten
Webhook an `/voice/outbound` und `/voice/status` (Probe ohne Anruf, SMS oder
MCP-Aufruf, Code in `tools/deploy-weg/zurueckrollen.mjs`); beide muessen `403`
liefern. Sonst endet der Lauf rot und `SLACK_ALERT_URL` bekommt eine Meldung mit
Lauf-Link und, falls Telnyx oder ElevenLabs eine Stoerung melden, der
Anbieterzeile; einen Revert-PR gibt es dafuer nicht. Bei Deploys, die kein Update-PR
ausgeloest hat, passiert nichts. Der schnelle manuelle Weg bleibt der
Workflow `notfall` mit `zurueckrollen` (Schritt 6 oben).

**Not-Aus.** Das Label `updates-pausiert` auf einem offenen Issue oder PR des
Repos stoppt Auto-Merge und die Node-Erkennung sofort, auch fuer
Sicherheitsupdates und Node mit Ja. Ist das Label nicht abfragbar, gilt ein
Update nicht als frei. Eine reine Versions-Ruecknahme (jedes geaenderte
Paket auf eine kleinere Version, keine Erhoehung, keine Node-Aenderung) ist
ausgenommen; die Regel steht in `tools/freigabe.mjs` (`istReineRuecknahme`),
erkannt wird sie nur am Diff, nie an Zweigname oder Titel. Zwei Grenzen: Dependabot oeffnet trotz Label weiter
PRs und verbraucht CI. Ein Update, dessen Freigabe-Pruefung vor dem Setzen des
Labels gruen war, kann noch aus der Queue landen. Dependabot stoppt ein PR, der
in allen drei Bloecken von `.github/dependabot.yml` (npm `/`, npm `/apps/web`,
`github-actions`) `open-pull-requests-limit: 0` setzt. Wieder frei: Label
entfernen.

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
  "Manual Deploy" im Render-Dashboard oder per API umgeht den
  Gespraechsabdruck; erlaubt ist im Dashboard nur der Rollback.
  Einzige Ausnahme ist der Deploy desselben Commits von Hand nach einem
  Token-Wechsel (Schritt 7): Render uebernimmt den neuen Wert erst mit einem
  Deploy, bis dahin lehnt die Produktion die Anrufpause von `notfall` ab.
- Der Gespraechsabdruck sieht nicht: was das Sprachmodell im Gespraech
  tatsaechlich formuliert, den Live-Agenten im ElevenLabs-Konto (dafuer
  `npm run elevenlabs:drift`) und Render-Umgebungsvariablen. Ein Push des
  Agenten (`npm run elevenlabs:push`) wirkt sofort und unabhaengig von diesem
  Weg.
- Render Free: 750 Free-Stunden je Workspace und Monat; danach setzt Render
  alle Free-Dienste bis Monatsende aus, und `staging` und `live` enden rot.
- Bekannte Luecke: der Deploy fragt nicht nach laufenden Anrufen; ein Anruf
  kann also jederzeit beim Umschalten laufen. Der alte Prozess wartet beim Beenden hoechstens
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

## Roter Staging-Nachtlauf im Slack-Kanal

Ist der Nachtlauf (`.github/workflows/staging.yml`) rot, schreibt der Schritt „Roten Nachtlauf melden“ zusätzlich zum Issue eine Nachricht an den Slack-Eingang aus dem Secret `SLACK_ALERT_URL` (Kanal #hermes-betrieb) und, freiwillig als zweiten Weg, einen Vorfall an den Better-Stack-Eingang aus `BETTER_STACK_ALERT_URL`. Den Slack-Webhook legen Antonio oder Jonas in den GitHub-Secrets an, nicht der Agent. Der Schritt „Roten Staging-Deploy melden“ und die Frühwarn-Probe (`scripts/anruf-probe/probe.mjs`, verlangt mindestens eines der beiden Secrets) melden auf denselben Wegen. Fehlt ein Secret, überspringt der Schritt diesen Weg und sagt das im Lauf. Wurde das Issue „Staging-Nachtlauf rot“ vor weniger als 60 Minuten zuletzt geändert, geht auf keinem Weg eine zweite Meldung raus (Quelle: `vorfallMelden` in `tools/deploy-weg/hoertest.mjs`). Nimmt ein Weg nicht an, bleibt der Lauf wie er ist. Erster Schritt: den verlinkten Lauf öffnen.

Meldet eine Statusseite von Telnyx oder ElevenLabs gerade eine Störung, steht in der Meldung zusätzlich die Zeile „Anbieter meldet gerade Störung: <Anbieter>“. Das ist nur ein Hinweis für die Ursachensuche: Er löst keine Meldung aus, ändert weder Entprellung noch Issue, und eine nicht erreichbare Statusseite lässt die Zeile weg. Adressen und Stufen stehen in `tools/deploy-weg/einstellungen.mjs` (`anbieterStatusBauen`) und `tools/deploy-weg/netz.mjs` (`anbieterStoerungen`).

Ein roter Staging-Deploy-Lauf (Ereignis `push` nach master) meldet genauso über den Schritt „Roten Staging-Deploy melden“: Issue „Staging-Deploy rot“, Vorfall `deploy-staging`, entprellt je Stunde über `vorfallMelden` in `tools/deploy-weg/hoertest.mjs`. Das Issue bleibt offen, auch wenn der nächste Lauf grün wird; schließen tut es der Mensch nach der Ursache.

## Anrufprobe gegen Staging

Die Anrufprobe ruft in festem Takt die eigene Staging-Nummer an und prüft Annahme, Eröffnung, Dauer und Status; Kern, Grenzwerte und Wiederholregel stehen in `scripts/anruf-probe/` (Urteil in `urteil.mjs`, Abstand in `wiederholung.mjs`, Tagesgrenzen in `probe.mjs`). Sie läuft als Schritt „Anrufprobe“ im Job `staging` in `.github/workflows/staging.yml`: nach dem grünen Staging-Abwarten bei `push`, im Zeitplan (die Uhrzeit steht unter `schedule`) und per Handstart; der Schritt „Offene Probe-Anrufe beenden“ läuft immer und legt Probe-Anrufe auf, die nach einem Abbruch noch offen sind. Der erste rote Versuch ist nur ein Hinweis im Lauf; erst die rote Wiederholung meldet über die Wege aus „Roter Staging-Nachtlauf im Slack-Kanal“. Jeder Lauf der Probe (Push, Handstart, Zeitplan) ohne eine der Variablen `STAGING_PROBE_ZIEL`, `STAGING_PROBE_AUFTRAGGEBER`, `STAGING_PROBE_VORNAME`, ohne das Secret `STAGING_PROBE_TOKEN` oder ohne Alarmweg endet rot mit `probe_uebersprungen_<name>_fehlt` und löst über die Schritte „Roten Staging-Deploy melden“ bzw. „Roten Nachtlauf melden“ den Alarm aus; nur der Aufräum-Schritt „Offene Probe-Anrufe beenden“ bleibt ohne Variable übersprungen. Antonio oder Jonas legen in GitHub die Variablen `STAGING_PROBE_ZIEL` (die Staging-Empfangsnummer), `STAGING_PROBE_AUFTRAGGEBER` und `STAGING_PROBE_VORNAME` (Auftraggeber und Vorname des Staging-Zugangs, sie bestimmen die erwartete Eröffnung) an; das Secret `STAGING_PROBE_TOKEN` trägt denselben Wert wie `HERMES_PROBE_TOKEN` auf der Staging-Instanz (Quelle: `config.auth.probeToken` in `src/konfiguration/rohwerte-auth.ts`); die Probe ruft damit nur `POST /intern/probe/mcp` (Route `src/routes/intern-probe-mcp.js`), nicht `/mcp`, und arbeitet immer als Bootstrap-Mandant `owner` der Staging-Instanz, dessen Profil zu `STAGING_PROBE_AUFTRAGGEBER` und `STAGING_PROBE_VORNAME` passen muss; `HERMES_PROBE_TOKEN` wird auf Live nie gesetzt. Lehnt die Staging-Instanz den Probe-Anruf ab, nennt die Zeile `Probe rot: messung grund=mcp_place_call_fehlgeschlagen:<Grund>` den Schlüssel des festen Ablehnungstexts (Quelle: `detailVon` in `scripts/anruf-probe/anrufer.mjs`, Texte in `src/i18n/mcp-denial-texts.js` und `src/i18n/mcp-texts.js`); `keine_identitaet` heißt, dass dem Mandanten `owner` der Auftraggeber-Name fehlt (Tor `owner_name` in `src/telephony/outbound-gates.js`). Das Secret `STAGING_TEST_TOKEN` bleibt dem Lastlauf. Handstart mit `absichtlich_rot` macht auch die Probe rot und löst den Alarm aus. Auf Live läuft die Probe nie (Grenze: `docs/sicherheitsgrenzen.md`, SG-36). Weicht das Ziel ab, nennt die Zeile `probe_ziel_unerlaubt:` den Grund `adresse_nicht_staging`, `nummer_nicht_lesbar` oder `nummer_weicht_ab` (dann mit den letzten vier Ziffern beider Nummern; Leerzeichen, Bindestriche, Klammern und Punkte zählen nicht als Abweichung; Quelle: `zielGeprueft` in `scripts/anruf-probe/probe.mjs`). Nach einem grünen Zeitplan-Lauf meldet der Schritt „Lebenszeichen Anrufprobe“ der Better-Stack-Überwachung, dass die Probe lief; die Adresse steht im Secret `BETTER_STACK_HEARTBEAT_PROBE`, fehlt es, überspringt der Schritt (Quelle: `heartbeatMelden` in `tools/deploy-weg/hoertest.mjs`). Das Secret legen Antonio oder Jonas an.

Prüfung der Prüfung: Im Zeitplan-Lauf des Jobs `staging` (`.github/workflows/staging.yml`, Schritt „Prüfung der Prüfung (monatlich)“, direkt vor „Heartbeat Nachtlauf“) läuft am Monatsersten (UTC) je Schicht eine absichtlich rote Bedingung und meldet eine als „Probe, kein echter Fehler“ gekennzeichnete Nachricht über `SLACK_ALERT_URL`; die Schichten stehen in `SCHICHTEN` in `tools/deploy-weg/hoertest.mjs` (`monatspruefung`), ein Anruf wird dabei nicht ausgelöst. Je Schicht steht die Zeile „Zeit bis Alarm Schicht <n>: <ms> ms“ im Log und in der Schritt-Zusammenfassung. Wird eine Schicht unter der roten Bedingung nicht rot, antwortet Slack nicht mit 2xx oder fehlt `SLACK_ALERT_URL`, endet der Schritt rot; dann läuft „Heartbeat Nachtlauf“ nicht, und die Better-Stack-Überwachung meldet den fehlenden Heartbeat. An allen anderen Tagen steht „übersprungen (nicht der Monatserste)“ im Log.

Die Probe führt das Gespräch mindestens `MINDESTDAUER_S` (`scripts/anruf-probe/urteil.mjs`) Sekunden und ist rot mit `zu_kurz`, wenn der Anruf früher endet, und mit `keine_antwort`, wenn nach dem Gruß keine weitere Zeile der Gegenseite kommt (Quelle: `verlaufErgebnis` in `scripts/anruf-probe/anrufer.mjs`).

Die Probe misst außerdem die Zeit vom Start des Probe-Anrufs bis zum Klingeln am Ziel (Beginn des eingehenden Gegenanrufs in `list_calls`) und ist rot mit `klingeln_zu_spaet`, wenn sie über der Grenze liegt, bzw. mit `klingeln_fehlt`, wenn kein Wert lesbar ist (Grenze: `KLINGELN_GRENZE_S` in `scripts/anruf-probe/urteil.mjs`; Messung: `klingelnSekunden` in `scripts/anruf-probe/anrufer.mjs`). Die Teilzeiten dieser Strecke stehen im Server-Log unter `[el-vorspann] auftrag_bis_wahl` und `auftrag_bis_klingeln`.

Die Probe prüft zusätzlich, dass das Ergebnis vorgetragen wird: nach dem Anrufende muss `get_call_result` innerhalb der Frist ein nicht leeres `result_summary` liefern, das nicht der Platzhalter `mcp.awaitSummary` aus `src/i18n/locales.ts` ist, sonst ist die Probe rot mit `ergebnis_fehlt` (Quelle: `ergebnisAbwarten` in `scripts/anruf-probe/anrufer.mjs`, Urteil in `scripts/anruf-probe/urteil.mjs`; der Text der Zusammenfassung wird nie ausgegeben). Eine rote Anrufprobe lässt den Schritt „Heartbeat Nachtlauf“ nicht ausbleiben, er hängt nur an „Staging abwarten und prüfen“ und an der Prüfung der Prüfung; die Probe hat ihren eigenen Heartbeat. Die Probe ist ein Schritt im Staging-Lauf ohne `continue-on-error`; eine doppelt rote Probe beendet den Lauf mit `failure`, und Live braucht einen grünen Push-Staging-Lauf für genau diesen Commit (Quelle: `tools/deploy-weg/herkunft.mjs`). So sperrt eine rote Probe die Live-Freigabe, ohne dass der Live-Weg eine eigene Prüfung hat. Zusätzlich sperrt ein roter jüngster Staging-Lauf auf master (Push oder Zeitplan, abgebrochene zählen nicht) jeden Live-Deploy und jeden Hand-Start, bis ein späterer Lauf grün ist; antwortet GitHub auf die Abfrage nicht mit 200 oder liefert sie keinen zählenden Lauf (Schlüssel `rot_staging_kein_lauf`), gilt das als rot (Quelle: `letzterStagingLauf` in `tools/deploy-weg/herkunft.mjs`, Wortlaut des Grundes in `tools/deploy-weg/ausgabe.mjs`, Schlüssel `rot_staging_letzter_rot`). Der Grund steht im Schritt „Entscheiden“ des Laufs `live`; der Alarm kommt aus den Meldeschritten des roten Staging-Laufs.
