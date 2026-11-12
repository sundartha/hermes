# Sicherheitsgrenzen

Dieser Katalog hält fest, welche Angriffe auf Hermes wir kennen, welche Grenze jeder Angriff verletzen würde, welcher Mechanismus ihn heute verhindert und welcher Negativtest ihn durchspielt. Der Test muss den Angriff ablehnen; sein Name beginnt mit der Kennung der Zeile.

Drei Dinge prüft `node tools/katalog-pruefen.mjs` bei jedem PR im Schritt „Bedrohungskatalog“ der CI (Job „Prüfungen“ in `.github/workflows/ci.yml`) und lokal in `npm run pruefen`:

1. Jeder Punkt der fünf öffentlichen Listen in `docs/sicherheitsabgleich.json` ist einer Katalogzeile zugeordnet oder mit Begründung und Prüfung als „trifft nicht zu“ markiert.
2. Jede Katalogzeile hat einen Negativtest unter `test/`, dessen Name mit ihrer Kennung beginnt. Zeilen, deren Test noch fehlt, stehen in `tools/basis/katalog-ohne-test.txt`; diese Liste darf nur kürzer werden.
3. Jedes registrierte MCP-Werkzeug, jede HTTP-Route und jeder Webhook hat eine Zeile im Abschnitt „Angriffsfläche“.

## Bedrohungskatalog

| Kennung | Angriff | Verletzte Grenze | Mechanismus | Negativtest |
| --- | --- | --- | --- | --- |
| SG-01 | Ein Token, das für einen anderen Dienst oder von einem fremden Aussteller ausgestellt wurde, wird an `/mcp` vorgelegt; oder Hermes reicht das Token eines Kunden an einen anderen Dienst weiter. | Nur Tokens, die für Hermes ausgestellt sind, öffnen den MCP-Zugang; Kundentokens verlassen Hermes nie. | `src/auth.js` `verifyOauth`: `jwtVerify` mit Aussteller und Audience (`audience()`), sonst 401. Die MCP-Werkzeuge rufen die REST-API ohne Kundentoken, nur mit internen Kopfzeilen (`src/mcp-tools.js` `api`), die `internalOnly` (`src/wiring/internal-only.js`) nur vom eigenen Prozess annimmt. | SG-01 Token mit fremder Audience wird an /mcp mit 401 abgelehnt |
| SG-02 | Ein angemeldeter Mandant ruft Anruf, Rückfrage, Posteingang, Export oder eine Audio-Adresse eines anderen Mandanten über dessen Kennung oder Handle ab. | Mandantentrennung: jeder sieht nur eigene Daten. | `src/routes/_tenant.js` `tenantOwnsCall` in `src/routes/api-read.js` und `src/routes/api-calls.js` (fremde Kennung ergibt 404); im Postgres-Betrieb Row-Level-Security über `app.current_tenant` (`src/store/pg.js`). | SG-02 Anruf eines anderen Mandanten ist per Kennung nicht abrufbar |
| SG-03 | Ein Token ohne die verlangten Scopes oder ein Nutzer ohne Betreiberrolle ruft Werkzeuge oder Betreiber-Routen auf. | Rechte nur im freigegebenen Umfang. | `src/auth.js` `hasRequiredScopes` mit `ENFORCED_OAUTH_SCOPES` (sonst 403 `insufficient_scope`); Betreiber-Routen hinter `adminOnlyMiddleware` (`src/web-auth.js`, `src/wiring/operator-routes.js`). | SG-03 Token ohne verlangte Scopes wird an /mcp abgelehnt |
| SG-04 | Ein Angreifer schiebt einem Nutzer einen Login-Rückruf mit fremdem Code oder State unter oder lenkt die Anmeldung auf eine fremde Adresse. | Eine Anmeldung endet nur bei dem Browser, der sie begonnen hat, und nur auf eigenen Seiten. | `src/web-auth.js`: `/auth/login` setzt signierte Cookies `pkce_verifier`, `oauth_state`, `oidc_nonce`; `/auth/callback` vergleicht `state` mit dem signierten Cookie, prüft die Nonce, tauscht den Code mit `code_verifier` und springt nur auf den festen Pfad `postLoginPath`. | SG-04 Login-Rückruf mit fremdem state wird abgelehnt |
| SG-05 | Jemand schickt einen gefälschten oder einen alten, mitgeschnittenen Telnyx-Webhook an `/voice`. | Nur Telnyx steuert Anrufe, und jedes Ereignis wirkt einmal. | `src/telephony/adapters/telnyx/signature.js` `verifyInboundSignature` (Ed25519 über Zeitstempel und Rohkörper, Zeitfenster `REPLAY_WINDOW_S`, ohne Schlüssel immer falsch) als Präfix-Middleware vor allen `/voice`-Routen (`src/routes/voice.js`); doppelte Zustellung über `src/telephony/webhook-idempotenz.js`, auf `/voice/incoming`, `/voice/turn` und `/voice/el-rueckfall` über Instanzen hinweg mit der Ablage `src/store/webhook-zustellung.js` (Antwort AES-256-GCM-verschlüsselt, Echtheit über die Zusatzdaten Anker, Kennung, Status, Content-Type und `CallSid` des signierten Körpers; passt die Prüfung nicht, verarbeitet die Instanz selbst); jeder Zugriff der Ablage, auch der Löschtakt `loescheAbgelaufene`, trägt in seiner Transaktion `statement_timeout` und `lock_timeout` von `ZUGRIFF_FRIST_MS` (1000 ms) und dieselbe Frist im Prozess ab vor dem Ausleihen der Verbindung, also auch beim Warten auf den Pool (`mitZeitgrenze`: nach Ablauf beginnt keine Anweisung mehr, eine offene Transaktion wird zurückgerollt); läuft sie ab, bricht der Server ihn ab oder scheitert er, verarbeitet die Instanz selbst und loggt `grund=frist` bzw. `grund=fehler`, nie Körper oder Anker); bricht Telnyx die Verbindung vor der Antwort ab oder scheitert das Ablegen, gibt die Ablage die eigene Annahme sofort frei (`freigeben`), und die Wiederholung verarbeitet selbst; trägt eine fremde Annahme `PROVIDER_WEBHOOK_HARDCUT_MS` nach ihrer Annahmezeit (Uhr der Datenbank) noch keine Antwort oder ist sie verschwunden, übernimmt die wartende Instanz sie einmal (`uebernehmen`), loggt `art=uebernommen warte_ms=` und legt ihre Antwort für alle Wiederholungen ab). | SG-05 Telnyx-Webhook mit falscher Signatur oder altem Zeitstempel wird mit 403 abgelehnt |
| SG-06 | Jemand ruft die Werkzeug- oder Init-Webhooks von ElevenLabs ohne das Geheimnis oder für einen fremden Anruf auf. | Nur der ElevenLabs-Agent eines laufenden eigenen Anrufs erreicht diese Webhooks. | `src/routes/webhooks-elevenlabs.js`: `safeEqual` des Kopfes `x-hermes-tool-token` gegen das Werkzeug-Geheimnis (leer heißt abgelehnt), danach Bindung an den laufenden Anruf (`boundCallFor`); `src/routes/webhooks-elevenlabs-init.js`: Geheimnis-Kopf und Bindungs-Token per `safeEqual`. | SG-06 ElevenLabs-Webhook ohne gültiges Werkzeug-Token wird abgelehnt |
| SG-07 | Jemand schickt einen gefälschten oder alten Stripe-Webhook, um ein Abo als bezahlt zu markieren. | Nur Stripe ändert den Zahlstand. | `src/billing/webhook.js` `verifyStripeSignature` (HMAC-SHA256 mit Zeitfenster `SIGNATURE_TOLERANCE_S`, timing-sicherer Vergleich) in `src/routes/stripe-webhook.js`; Ereignisse werden nacheinander angewandt (`applyStripeWebhookSerialized`); die Reihenfolge-Wache liest den letzten Stand je Abo aus dem Register (`src/store/stripe-ereignis-register.js`), über Prozesse und Neustarts hinweg. | SG-07 Stripe-Webhook mit falscher Signatur oder abgelaufenem Zeitstempel wird abgelehnt |
| SG-08 | Ein Aufrufer oder das Modell lässt Hermes eine Premium-, Sonder-, Notruf- oder Hochpreisland-Nummer wählen. | Hermes wählt nur erlaubte, bezahlbare Ziele. | `src/telephony/number-denylist.js` (`DENIED_PREFIXES`, `EMERGENCY_SHORT_CODES`) und das Land-Gate `countryGateAllowed` mit `ALLOWED_COUNTRY_CODES` in `src/telephony/outbound-gates.js`, beides vor dem Wählen. | SG-08 Anruf an eine Premium-Nummer wird vor dem Wählen abgelehnt |
| SG-09 | Ein Mandant oder ein Skript löst sehr viele Anrufe oder Anfragen aus und treibt Kosten oder legt den Dienst lahm. | Kosten- und Lastgrenzen je Mandant und für die Plattform. | Stundenlimit `maxCallsPerHour` und Ziel-Deckel `perTargetCallCap` (gilt nicht für die gepinnte eigene Nummer, `ownerSelfCallGranted` in `src/callee-is-owner.js`) sowie die pro-Mandant-Kostendecke (Gates `budget`, `reserve_budget`) in `src/telephony/outbound-gates.js`; allgemeiner Limiter in `src/app.js` `installGlobalMiddleware`; MCP-Drossel `src/mcp-rate-limit.js`; Login-Bremse über alle Prozesse in `src/store/login-bremse.js`, bei Zählfehler, Stau oder Frist antwortet `createGeteilterRateLimiter` in `src/middleware.js` mit `503` und `Retry-After`; Notaus `OUTBOUND_FROZEN`. | SG-09 Anruf über dem Stundenlimit des Mandanten wird abgelehnt |
| SG-10 | Text aus einem Gespräch, dem Posteingang, einer gespeicherten Erinnerung oder einem Rechercheergebnis enthält Anweisungen, die der Assistent des Nutzers oder der Telefonagent ausführt, etwa einen weiteren Anruf. | Fremder Text ist Inhalt, keine Anweisung; ein Anruf entsteht nur im Namen eines angemeldeten Mandanten, nur durch alle Sicherheitsprüfungen der Wahl und nie mit Sperrdaten in den Anruf-Argumenten. Eine Zustimmung des Nutzers je Anruf erzwingt der Server seit Antonios Entscheidung vom 07.11.2026 (Issue #3265) nicht mehr; die Rückfrage vor dem Werkzeug liegt beim Host (`destructiveHint`). | `place_call` verlangt eine gültige Anmeldung und wählt nur über `POST /api/calls` mit allen Prüfungen der Wahl: Abo-Stufe, Kostendecke, Stundenlimit, Notaus `OUTBOUND_FROZEN`, Verbotsliste und Land-Prüfung (`src/telephony/outbound-gates.js`). Vor dem Wählen prüft `src/mcp/gateway.js` `placeCallHop` alle Anruf-Argumente auf Sperrdaten (`src/mcp/eingabe.js` `rejectRestrictedData`, `src/restricted-data.js`). Erinnerungen aus fremder Rede auf feste Form und Länge geklemmt (`src/call-memory.js`); Recherche nur mit freigegebenen Feldern und begrenzten Ergebnissen (`src/research/sanitize.js`, `src/research/lookup-guard.js`). | SG-10 place_call ohne Anmeldung oder mit Sperrdaten im Anruf-Argument löst keinen Anruf aus |
| SG-11 | Die angerufene Person bringt den Agenten dazu, andere Nummern anzurufen, Daten oder Anweisungen des Auftraggebers preiszugeben oder Zusagen zu machen, die der Auftraggeber nicht gegeben hat. | Der Agent handelt nur im Auftrag und nur mit dem, was der Auftrag hergibt. | Der Telefonagent hat nur die Werkzeuge `get_consult` und `look_up`, beide gebunden an den laufenden Anruf, mit Fähigkeits-Gate und Kostendecke (`src/routes/webhooks-elevenlabs.js`); kein Werkzeug zum Wählen oder Senden; offene Fragen gehen als Rückfrage an den Auftraggeber statt geraten zu werden; Suchanfragen gekürzt (`src/research/lookup-guard.js` `LOOKUP_QUERY_MAX_CHARS`). | SG-11 Werkzeug-Webhook ohne laufenden gebundenen Anruf wird abgelehnt |
| SG-12 | Die Beschreibung eines MCP-Werkzeugs ändert sich unbemerkt, sodass Modelle es anders oder öfter benutzen. | Was Modelle über Werkzeuge lesen, ändert sich nur mit Freigabe. | `test/sicherheit/werkzeugtexte.json` hält die Texte aus `tools/list` fest (`test/sicherheit/werkzeugtexte.test.js`); der Testschutz (`tools/testschutz.mjs`) lässt eine Änderung der Datei nur mit dem Label `verhalten-geaendert` von Antonio oder Jonas durch. | SG-12 geänderte Werkzeugbeschreibung ohne Freigabe wird gestoppt |
| SG-13 | Schlüssel, Telefonnummern, E-Mail-Adressen oder Transkriptinhalte landen in Logs, Fehlerantworten oder im Repo. | Geheimnisse und Kundendaten verlassen ihren Speicherort nicht. | Nummern maskiert und E-Mails gehasht (`src/util.js` `maskNumber`, `hashEmail`); Textausgaben des Servers an stdout und stderr zentral maskiert, auch Audit-Zeilen: Nummern, E-Mail-Adressen, Token, sensible Kategorien und Werte eigener Schlüssel ab 16 Zeichen (`src/log-maske.js` `mitLogMaske`, eingehängt in `src/process-guards.js` `installProcessGuards`; beim stdio-MCP-Server nur stderr); generische Fehlerantworten (`src/middleware.js` `errorHandler`); sensible Kategorien in Transkripten erkannt und maskiert (`src/restricted-data.js` `maskRestrictedText`); Secret-Scan mit gitleaks in `.github/workflows/ci.yml` (`gitleaks.toml`); abgelegte Webhook-Antworten in `webhook_zustellung` nur verschlüsselt und mit Anker als HMAC, höchstens 5 min gültig und höchstens 6 min physisch (`src/store/webhook-zustellung.js` `planeLoeschtakt`, beim Start und im Takt `WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS` von höchstens 60 s, auch ohne Schlüssel). | SG-13 Fehlerantwort enthält weder Schlüssel noch volle Telefonnummer |
| SG-14 | Eine Eingabe oder eine Modell-Ausgabe gelangt ungeprüft in eine Datenbankabfrage, eine Shell oder die Adresse eines ausgehenden Aufrufs. | Eingaben sind Daten, nie Befehl oder Ziel. | Postgres nur mit Parametern (`src/store/pg.js`); kein Shell-Aufruf im Produktcode; Basisadressen ausgehender Aufrufe nur aus `src/config.js`, Aussteller-Adresse nur per https (`productionFootguns`); Wahlziel normalisiert und als E.164 geprüft (`src/telephony/outbound-gates.js` `resolveDialTarget`); neue Injection-Muster brechen den Build (Semgrep mit den Regelsätzen `p/javascript`, `p/typescript`, `p/nodejsscan`, `p/expressjs` auf den geänderten Dateien, `tools/pruefen.mjs semgrep`, Job „Semgrep“). | SG-14 Wahlziel mit Sonderzeichen wird abgelehnt statt weitergereicht |
| SG-15 | Ein kompromittiertes npm-Paket führt beim Installieren oder im Betrieb fremden Code aus. | Nur geprüfter Code läuft in CI und Betrieb. | Installation ohne Skripte (`npm ci --ignore-scripts`, geprüft von `test/sicherheit/workflows.test.js`); Audit-Vergleich `tools/audit-vergleich.mjs`; ein neues Paket ohne Antonios Entscheidung ist ein MUSS-Befund des KI-Urteils (`.claude/agents/pruefer.md`), und ohne dessen Approve stoppt die Freigabe-Prüfung (`tools/freigabe.mjs`). | SG-15 neues Paket mit Install-Skript wird in der CI gestoppt |
| SG-16 | Eine Testumgebung ist ohne Anmeldung erreichbar, wird indexiert oder hängt an echten Nummern und Schlüsseln. | Staging ist nicht öffentlich und nicht mit Produktion verbunden. | Das Web-Labor trägt `X-Robots-Tag: noindex` (`docs/RUNBOOK-LAB-LIVE.md`). Ein Staging-Gateway mit Anmeldung und eigenen Schlüsseln ist noch nicht eingerichtet (Paket 13). | SG-16 Staging-Adresse ohne Anmeldung liefert keine Kundendaten |
| SG-17 | Ein Angriff läuft, ohne Spuren zu hinterlassen: abgelehnte Anmeldungen, Webhooks und Gate-Entscheidungen fallen nicht auf. | Sicherheitsrelevante Ereignisse sind nachvollziehbar. | Audit-Einträge über `audit()` und den dauerhaften Audit-Speicher (`src/audit-store.js`, `src/durable-audit.js` `makeDurableAudit`); Ablehnungsdrossel für wiederholte Fehlversuche an `/mcp` (`src/mcp-rate-limit.js` `ablehnungsSchluessel`). | SG-17 abgelehnter Anruf hinterlässt einen Audit-Eintrag |
| SG-18 | Ein PR aus fremder Hand liest im CI-Job ein Token mit Schreibrechten oder ein Geheimnis aus. | PR-Jobs laufen nur mit Leserechten und ohne Geheimnisse. | Workflows mit `permissions: contents: read` und `persist-credentials: false`; `test/sicherheit/workflows.test.js` verbietet `pull_request_target` und Geheimnisse in PR-Workflows. | SG-18 Workflow mit pull_request_target wird abgelehnt |
| SG-19 | Eine gerade erst veröffentlichte, kompromittierte Paketversion kommt über das Lockfile in den Build. | Neue Versionen kommen erst nach einer Wartezeit. | Mindestalter von 168 Stunden für neue Versionen im Lockfile (`tools/lockfile-alter.mjs`, Schritt „Lieferkette“ in `.github/workflows/ci.yml`). | SG-19 Lockfile mit einer frisch veröffentlichten Version wird abgelehnt |
| SG-20 | Der Tag einer eingebundenen GitHub Action wird auf fremden Code umgebogen. | Workflows führen nur den Code aus, der geprüft wurde. | Actions nur mit voller Commit-SHA (`test/sicherheit/workflows.test.js`). | SG-20 Action mit Tag statt Commit-SHA wird abgelehnt |
| SG-21 | Text aus Issues, PRs oder Kommentaren bringt einen Bau-Agenten dazu, Prüfungen zu lockern, Geheimnisse zu lesen oder ungeprüft zu mergen. | Prüfungen ändern sich nur mit Freigabe eines Menschen. | Jeder PR braucht das Approve des KI-Urteils auf dem aktuellen Stand, Code unter `src/` kommt nur aus PRs der App `sundartha-agent` (Freigabe-Prüfung, `tools/freigabe.mjs`); eine Lockerung einer Prüfung ohne Antonios Entscheidung ist ein MUSS-Befund (`.claude/agents/pruefer.md`); bestehende Tests nur mit Label `verhalten-geaendert` (`tools/testschutz.mjs`); Wachstumsbremse in `.github/workflows/ci.yml`. | SG-21 Änderung an einer Prüfung ohne Freigabe wird gestoppt |
| SG-22 | Eine neue Route, ein neuer Webhook oder ein neues MCP-Werkzeug geht live, ohne dass Anmeldung und Bedrohungen geprüft sind. | Jede Angriffsfläche ist bekannt und eingeordnet. | `test/route-auth-inventory.test.js` verlangt für jede Route eine Einordnung in `src/route-policy.js`; `tools/katalog-pruefen.mjs` verlangt für jede Route, jeden Webhook und jedes Werkzeug eine Zeile in diesem Katalog. | SG-22 neue Route ohne Auth-Einordnung wird gestoppt |
| SG-23 | Jemand übernimmt oder errät eine Browser-Sitzung oder eine MCP-Sitzung und handelt als deren Inhaber. | Eine Sitzung gehört nur dem, der sich angemeldet hat. | Sitzungs-Cookies signiert mit `HttpOnly`, `Secure`, `SameSite=Lax` und begrenzter Laufzeit `sessionTtlSeconds` (`src/web-auth.js`, `src/config.js`); `/mcp` läuft ohne Sitzungskennung (`sessionIdGenerator: undefined` in `src/routes/mcp.js`) und prüft jede Anfrage einzeln. | SG-23 Anfrage mit manipuliertem Sitzungs-Cookie wird abgelehnt |
| SG-24 | Eine Antwort liefert interne Felder mit aus, oder ein Schreibaufruf setzt Felder, die der Nutzer nicht setzen darf. | Nur freigegebene Felder werden gelesen und geschrieben. | Ausgabe über Sichten (`src/store/views.js` `publicCall`); Einstellungen nur über die Positivliste `selfServicePatch` und gesperrte Schlüssel `lockedSelfServiceKeys` (`src/self-service.js`, angewandt in `src/self-service-routes.js`). | SG-24 Einstellungs-Aufruf mit gesperrtem Feld ändert nichts |
| SG-25 | Hermes startet in Produktion mit einer gefährlichen Einstellung, etwa abgeschalteter Signaturprüfung, offenem `/mcp` oder unverschlüsselter Aussteller-Adresse. | Produktion läuft nur mit scharfen Sicherungen. | `productionFootguns` in `src/config.js` bricht den Start im Hosting ab; Start-Sicherungen in `src/boot-guard.js` und `src/boot.js`. | SG-25 Start in Produktion mit abgeschalteter Signaturprüfung wird verweigert |
| SG-26 | Nach SIGTERM nimmt der Prozess von außen noch Anfragen an und rechnet sie mit, während er sich beendet, oder ein Aufrufer kommt über Weiterleitungs-Kopfzeilen an die interne Abkürzung. | Ab dem Stoppsignal erreicht von außen nichts mehr die Anwendung; nur der eigene Prozess führt laufende Aufrufe zu Ende. | `src/abschaltweiche.js` `makeAbschaltweiche`: ab `einschalten` (beim Signal in `src/abschalten.js`) antwortet jede Anfrage, die `isTrustedLocalCaller` (`src/routes/_tenant.js`) nicht erfüllt, mit 503, `Retry-After: 5` und `Connection: close`, vor Anmeldung, Drossel und Rumpf-Parsern (`src/app.js` `installGlobalMiddleware`). | SG-26 Anfrage mit Weiterleitungs-Kopfzeile bekommt nach SIGTERM 503 |
| SG-27 | Eine Migration läuft im Bereich eines Kunden, weil eine Datei davor den Bereich gewechselt hat, oder sie wartet unbegrenzt auf eine Sperre einer laufenden Instanz. | Jede Migration beginnt im Plattformbereich; die Übernahme einer Datenbank ohne Versionstabelle bricht binnen kurzer Frist ab, statt eine laufende Instanz zu blockieren. | `src/db/migrate.js` `execInPlatformScope` setzt vor jeder Datei `app.current_tenant` auf `BOOTSTRAP_TENANT_ID`; `applyMigrations` setzt in der Übernahme-Transaktion `lock_timeout` (`TAKEOVER_LOCK_TIMEOUT`). | SG-27 jede Migration beginnt im Plattformbereich, auch wenn die Vorgängerdatei den Bereich auf einen Kunden gestellt hat |
| SG-28 | Das Trunk-Passwort oder das Bindungs-Token eines eingehenden ElevenLabs-Anrufs gelangt im Klartext in die gemeinsame Datenbank oder ins Log, oder eine andere Instanz liefert das Passwort der ersten statt ihr eigenes aus. | Geheimnisse verlassen ihren Speicherort nicht, auch nicht über die Ablage wiederholter Zustellungen. | `src/telephony/webhook-idempotenz.js` `geheimnisRaus` ersetzt vor dem Ablegen das Trunk-Passwort der Instanz (`elPasswort`, aus `src/routes/voice.js` `elZugangVon`) durch einen Platzhalter, `geheimnisEin` setzt beim Ausliefern den Wert der liefernden Instanz ein; hat sie keinen, verarbeitet sie selbst. Das Bindungs-Token bleibt nur im verschlüsselten Körper der Ablage (`src/store/webhook-zustellung.js`). | SG-28 Anruf-Eingang im ElevenLabs-Pfad legt Trunk-Passwort und Bindungs-Token weder im Klartext in webhook_zustellung noch im Log ab |
| SG-29 | Mehrere Kunden starten über mehrere Prozesse gleichzeitig ausgehende Anrufe, um die Leitungen von Telnyx oder ElevenLabs über ihre Kapazität zu füllen, oder die Datenbank der Leitungsplätze antwortet nicht und der Anruf geht trotzdem an den Anbieter. | Ausgehende Anrufe überschreiten weder die Kapazität der Anbieter noch die Höchstzahl gleichzeitiger Anrufe je Kunde; im Zweifel wird abgelehnt. | `src/store/leitungsplaetze-pg.js` `belegenAusgehend` zählt und belegt in einer Transaktion unter `pg_advisory_xact_lock` in der Tabelle `leitungsplatz` (`src/db/migrations/0014_leitungsplatz.sql`), Zeiten von der Datenbank; bei Fehler oder Überschreitung der Wartegrenze (`LEITUNGSPLATZ_DB_FRIST_MS` in `src/begriffe/speicher.js`) lautet die Entscheidung `anbieter_voll`, `src/routes/api-calls.js` antwortet `503 ausgelastet`. Kapazitäten und Reserven stehen in `src/store/leitungsplaetze.js`. | SG-29 Datenbank antwortet nicht binnen 5 Sekunden: ausgehender Anruf wird abgelehnt und nichts gewählt |

## Angriffsfläche

Die Art ist `Werkzeug` für ein registriertes MCP-Werkzeug, `Webhook` für eine Route unter `/voice/` oder `/webhooks/`, sonst `Route`. Die Fläche ist der Werkzeugname oder Methode und Pfad, wie Express sie registriert.

| Art | Fläche | Kennungen |
| --- | --- | --- |
| Werkzeug | place_call | SG-01, SG-03, SG-08, SG-09, SG-10, SG-12 |
| Werkzeug | await_call_event | SG-01, SG-02, SG-10, SG-12 |
| Werkzeug | answer_consult | SG-01, SG-02, SG-10, SG-11, SG-12 |
| Werkzeug | get_call_status | SG-01, SG-02, SG-12 |
| Werkzeug | get_call_result | SG-01, SG-02, SG-10, SG-12, SG-13 |
| Werkzeug | cancel_call | SG-01, SG-02, SG-12 |
| Werkzeug | get_agent_number | SG-01, SG-12 |
| Werkzeug | list_calls | SG-01, SG-02, SG-12 |
| Werkzeug | check_inbox | SG-01, SG-02, SG-10, SG-12 |
| Werkzeug | list_action_items | SG-01, SG-02, SG-10, SG-12 |
| Werkzeug | get_agent_status | SG-01, SG-12 |
| Route | GET /healthz | SG-13, SG-22 |
| Route | GET /.well-known/security.txt | SG-22 |
| Route | GET /api/plans | SG-22, SG-24 |
| Route | GET /.well-known/openai-apps-challenge | SG-13, SG-22 |
| Route | GET /.well-known/oauth-protected-resource | SG-01, SG-14 |
| Route | GET /.well-known/oauth-protected-resource/mcp | SG-01, SG-14 |
| Route | GET /login | SG-04, SG-22 |
| Route | GET /signin | SG-04, SG-22 |
| Route | GET /sign-in | SG-04, SG-22 |
| Route | GET /dashboard | SG-04, SG-22 |
| Route | GET /account | SG-04, SG-22 |
| Route | GET /portal | SG-04, SG-22 |
| Route | GET /admin | SG-04, SG-22 |
| Route | GET /auth/login | SG-04, SG-09, SG-23 |
| Route | GET /auth/callback | SG-04, SG-09, SG-23 |
| Route | POST /auth/logout | SG-23 |
| Route | GET /api/portal/state | SG-02, SG-23, SG-24 |
| Route | GET /api/admin/tenants | SG-03, SG-17, SG-23 |
| Route | POST /api/admin/tenants/:id/approve | SG-03, SG-17, SG-23 |
| Route | POST /api/admin/tenants/:id/suspend | SG-03, SG-17, SG-23 |
| Route | POST /api/cookie-consent | SG-09, SG-13 |
| Route | GET /api/self-service/state | SG-02, SG-23, SG-24 |
| Route | POST /api/self-service/settings | SG-02, SG-23, SG-24 |
| Route | POST /api/self-service/private-number | SG-02, SG-08, SG-23, SG-24 |
| Route | POST /api/self-service/newsletter-consent | SG-02, SG-23, SG-24 |
| Route | POST /api/self-service/newsletter-recipients | SG-02, SG-13, SG-23, SG-24 |
| Route | DELETE /api/self-service/newsletter-recipients | SG-02, SG-23, SG-24 |
| Route | GET /newsletter/confirm | SG-02, SG-09 |
| Route | GET /newsletter/unsubscribe | SG-02, SG-09 |
| Route | GET /api/self-service/billing/status | SG-02, SG-23 |
| Route | POST /api/self-service/billing/setup-checkout | SG-02, SG-09, SG-23 |
| Route | GET /api/self-service/billing/return | SG-02, SG-07, SG-23 |
| Route | POST /api/self-service/billing/subscribe | SG-02, SG-09, SG-23 |
| Route | POST /api/self-service/billing/cancel | SG-02, SG-23 |
| Route | POST /api/self-service/billing/resume | SG-02, SG-23 |
| Webhook | POST /webhooks/stripe | SG-07 |
| Route | GET /tenant.html | SG-22, SG-23 |
| Route | GET /app/* | SG-22, SG-23 |
| Webhook | GET /voice/tts/:token | SG-02, SG-13 |
| Webhook | POST /voice/incoming | SG-05, SG-09, SG-28 |
| Webhook | POST /voice/turn | SG-05, SG-10, SG-11 |
| Webhook | POST /voice/outbound | SG-05, SG-11 |
| Webhook | POST /voice/el-rueckfall | SG-05 |
| Webhook | POST /voice/el-bein | SG-05 |
| Webhook | POST /voice/vorspann | SG-05 |
| Webhook | POST /voice/status | SG-05, SG-17 |
| Webhook | POST /webhooks/elevenlabs/consult | SG-06, SG-09, SG-11 |
| Webhook | POST /webhooks/elevenlabs/lookup | SG-06, SG-09, SG-10, SG-11 |
| Webhook | POST /webhooks/elevenlabs/init | SG-06 |
| Route | POST /api/calls | SG-03, SG-08, SG-09, SG-10 |
| Route | GET /api/calls/:id/consult | SG-02, SG-11 |
| Route | POST /api/calls/:id/consult/answer | SG-02, SG-11 |
| Route | POST /api/calls/:id/cancel | SG-02 |
| Route | GET /api/state | SG-02, SG-24 |
| Route | GET /api/calls/:id | SG-02, SG-24 |
| Route | GET /api/tenant-data/export | SG-02, SG-13, SG-24 |
| Route | POST /api/inbox/poll | SG-02, SG-10 |
| Route | POST /api/billing/flush-meters | SG-03, SG-17 |
| Route | POST /api/billing/setup-checkout | SG-03, SG-09 |
| Route | POST /api/billing/cost-truing/sweep | SG-03, SG-17 |
| Route | GET /api/billing/cost-drift | SG-03 |
| Route | GET /api/billing/platform-costs | SG-03 |
| Route | GET /api/billing/kosten-deckung | SG-03 |
| Route | GET /api/billing/checkout-return | SG-03, SG-07 |
| Route | POST /api/onboard | SG-03, SG-09 |
| Route | POST /api/onboard/retry | SG-03, SG-09 |
| Route | GET /api/admin/deploy-info | SG-03, SG-13 |
| Route | GET /intern/anrufe-laufend | SG-03, SG-09, SG-13, SG-22 |
| Route | GET /intern/anrufpause | SG-03, SG-13, SG-22 |
| Route | POST /intern/anrufpause | SG-03, SG-09, SG-13, SG-22 |
| Route | GET /intern/status | SG-03, SG-13, SG-22 |
| Route | POST /mcp | SG-01, SG-03, SG-09, SG-23 |
| Route | GET /mcp | SG-22, SG-23 |
| Route | DELETE /mcp | SG-22, SG-23 |
