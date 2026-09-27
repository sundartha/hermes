# Reale externe Aktionen, Idempotenz, Missbrauchsschutz

Dimension: D10 | Quelle: Code auf Branch master

## Kurzfassung

Genau EIN MCP-Werkzeug loest eine reale Aktion aus (`place_call` -> `POST /api/calls`,
`src/mcp-tools.js:825`), ein zweites greift in einen laufenden Anruf ein (`cancel_call`).
Davor liegt eine geordnete 18-gliedrige Gate-Kette (`src/telephony/outbound-gates.js:656-959`,
Laenge hart erzwungen :961), die fail-closed ist: ein geworfenes Gate ist eine Ablehnung
(:307-323). Limits sind real vorhanden (Kill-Switch, Stundenlimit, Pro-Ziel-Cap, Denylist,
Landfilter, KYC/Abo, Tenant-Kostendecke mit atomarer Reserve, harte Max-Dauer 1800 s).
Schwerster Befund: es gibt KEINERLEI Idempotenz auf dem Anruf-Pfad - kein Idempotenz-Schluessel,
keine Deduplizierung, kein Single-Flight; und der interne Hop hat KEINE Frist, waehrend der
Anbieter-Anrufstart ueber die gesamte Klingelphase blockiert. Ein Client-Timeout plus ein
Retry erzeugt einen ZWEITEN echten Anruf. Zweiter schwerer Befund: die Antwort verschweigt
die tatsaechlich gewaehlte (serverseitig normalisierte) Nummer und die Absender-DID - der
Client kann nicht pruefen, WEN Hermes angerufen hat. Massentelefonie-Bausteine existieren nicht.

## Pruefpunkte

### PP-D10-01 Kann der Client vor/nach dem Ausloesen erkennen, wen Hermes mit welchem Absender anruft?
- Status: FAIL
- Evidenz: `src/telephony/outbound-gates.js:705-720` (`normalize_target`) ueberschreibt `ctx.to`
  serverseitig (fuehrende 0 -> Heimatland, "00" -> "+"); `:840-860` (`resolve_outbound`) waehlt
  die Absender-DID aus dem Store. Die Erfolgsantwort `src/routes/api-calls.js:514-522` traegt
  `ok, callId, twilioSid, status, context_received, diagnostic` - weder `to` noch `from`.
  `CALL_OUTPUT`/`CALL_STATUS_OUTPUT` (`src/mcp-tools.js:177-183, 322-327`) enthalten ebenfalls
  kein Ziel- und kein Absenderfeld. Erst `list_calls` liefert `counterparty`
  (`CALL_LIST_ENTRY`, :412) - nach dem Anruf, nicht davor.
- Risiko: Die Normalisierung kann aus "0176..." je nach Tenant-Heimatland eine ANDERE echte
  Nummer machen, als der Nutzer meinte. Weder Modell noch Nutzer sehen je, welche E.164-Nummer
  wirklich gewaehlt wurde; eine Fehlwahl an einen unbeteiligten Dritten ist aus der
  Werkzeugantwort nicht erkennbar.
- Empfehlung: `to_dialed` (normalisiertes E.164) und `from` in `CALL_OUTPUT` aufnehmen und in
  der Widget-/Textantwort anzeigen.
- Prioritaet/Kategorie: P1 / B

### PP-D10-02 Kann ein einzelnes halluziniertes Argument eine reale Aktion ausloesen?
- Status: PARTIAL
- Evidenz: Pflichtfelder sind NUR `to` und `objective` (`src/routes/api-calls.js:337-338`).
  Danach entscheidet ausschliesslich die Gate-Kette; es gibt keinen Bestaetigungsschritt,
  keine Elicitation, keinen Vorschau-Modus (Grep auf `elicit` in `src/` -> 0 Treffer).
  Gegengewichte: Denylist inkl. Notrufe/Premium/Hochpreis-Laender
  (`src/telephony/number-denylist.js:12-80`, hartkodiert, nicht abschaltbar), E.164-Pruefung,
  Landfilter (`outbound-gates.js:345-350`), Stundenlimit pro Tenant (:364-374), Pro-Ziel-Cap
  (:375-381), KYC (:395-402), Abo/Billing-Hold (:412-444).
- Risiko: Eine vom Modell erfundene oder verwechselte Zielnummer innerhalb der erlaubten
  Laender fuehrt zu einem echten Anruf bei einem unbeteiligten Dritten. Kein Gate prueft die
  PLAUSIBILITAET des Ziels, nur seine Zulaessigkeit.
- Empfehlung: Serverseitige Bestaetigung fuer den ersten Anruf an ein dem Tenant unbekanntes
  Ziel (z.B. Zwei-Schritt-Token), wie es N-10 der Anforderungsliste ausdruecklich verlangt
  ("Require confirmation for consequential write actions").
- Prioritaet/Kategorie: P1 / A (N-10, tasks/openai-audit/00-openai-anforderungen.md:84)

### PP-D10-03 Ist die reale Aktion als Write-Action/destruktiv maschinenlesbar markiert?
- Status: FAIL
- Evidenz: Kein Tool in `src/mcp-tools.js` traegt `annotations` (Grep ueber die Datei -> 0
  Tool-Treffer); `place_call` wird mit `description`/`inputSchema`/`outputSchema` registriert
  (`src/mcp-tools.js:667-820`).
- Risiko: `readOnlyHint` fehlt ueberall, also behandelt der Host auch die acht reinen
  Lesewerkzeuge als Write-Action (N-7) - die Bestaetigungspflicht verliert ihre Trennschaerfe,
  und `destructiveHint` fuer den unwiderruflichen Anruf fehlt (N-3, N-6: haeufiger
  Ablehnungsgrund).
- Empfehlung: `place_call`/`cancel_call` mit `readOnlyHint:false`, `destructiveHint:true`,
  `openWorldHint:true` versehen, alle Lesewerkzeuge mit `readOnlyHint:true`.
- Prioritaet/Kategorie: P0 / A (N-1/N-3/N-6/N-7, 00-openai-anforderungen.md:75-84)
  (Doppelbefund mit D2 PP-D2-02; hier aus Sicht der realen Aktion bewertet.)

### PP-D10-04 Gibt es Idempotenz/Deduplizierung/Single-Flight auf dem Anruf-Pfad?
- Status: FAIL
- Evidenz: `POST /api/calls` (`src/routes/api-calls.js:334`) nimmt keinen Idempotenz-Schluessel
  entgegen und prueft keinen; `store.createCall(...)` (:439) legt bedingungslos einen neuen
  Datensatz mit neuer `call.id` an. `src/single-flight.js` ist ausweislich seines Modulkopfs
  (Z.1-24) ausschliesslich fuer den Provisioning-Drain gebaut; `src/chain-mutex.js` liefert nur
  die Mechanik fuer `store.withStoreLock` und ebenjenen Drain. Der einzige Lock im Anruf-Pfad
  ist `store.withStoreLock` im Gate `reserve_budget` (`outbound-gates.js:935-958`) - er
  serialisiert die Budget-Reserve, er dedupliziert KEINE Anrufe. Idempotenz-Schluessel existieren
  nachweislich nur bei Provisioning/Stripe (`src/onboarding.js:136-142, 322`,
  `src/self-service-routes.js:226, 269`).
- Risiko: Zwei identische `place_call`-Aufrufe = zwei echte Anrufe beim selben Menschen, zwei
  Carrier-Kosten. Der Client hat keine Moeglichkeit zu erkennen, dass die erste Aktion bereits
  lief - er bekommt eine zweite, neue `call_id` statt der ersten.
- Empfehlung: Idempotenz-Schluessel (Client-gesetzt oder Hash aus tenant+to+objective) mit
  kurzem Fenster; ein Treffer liefert die BESTEHENDE `call_id` statt zu waehlen.
- Prioritaet/Kategorie: P0 / A (T-27 "Apply timeouts and rate limits to expensive or externally
  visible tools", 00-openai-anforderungen.md:60; zugleich B - Sicherheitsarchitektur)

### PP-D10-05 Was passiert bei Netzwerk-Timeout waehrend des Anrufstarts?
- Status: FAIL
- Evidenz: Der interne Hop hat KEINE Frist: `const call = (method, path, body) => api({...})`
  ohne `timeoutMs` (`src/mcp-tools.js:585`); `api()` setzt `signal` nur bei gesetztem
  `timeoutMs` (:57-66). Einzige Ausnahme ist `pollConsult` (:588-603). Der EL-Anrufstart
  blockiert dagegen ueber die gesamte Klingelphase - der Kommentar an
  `src/elevenlabs/outbound.js:1806ff` nennt eine Messung von 40,3 s blossem Klingeln vor der
  Antwort. Erst danach existiert `call.id` beim Aufrufer.
- Risiko: Bricht der MCP-Client (oder ein Proxy) waehrend der Klingelphase ab und wiederholt,
  laeuft PP-D10-04 in den Doppelanruf. Der erste Anruf laeuft dabei weiter - er ist bereits
  beim Anbieter angestossen.
- Empfehlung: Frist auf dem internen Hop + frueher `call_id`-Rueckkanal (Datensatz vor dem
  Provider-Start quittieren), damit ein Retry auf eine bekannte Kennung trifft.
- Prioritaet/Kategorie: P0 / A (T-27)

### PP-D10-06 Gibt es gefaehrliche automatische Wiederholungen im Code?
- Status: PASS
- Evidenz: Genau ein Ursprungsort fuer Outbound-Anrufe: `src/routes/api-calls.js:484`
  (`originateElevenLabsCall`) bzw. `:497` (`voiceControl(...).originateCall`), beide im selben
  `try` HINTER der vollstaendigen Gate-Kette. Der Boot-Re-Arm
  (`src/elevenlabs/outbound.js:1609-1620`, `rearmActiveConversationPolls`) startet
  ausschliesslich Ergebnis-Polls fuer bereits laufende Anrufe, er waehlt nicht neu; er ruft
  `pollConversationResult`, nicht `originateCall`. Im Fehlerfall wird terminiert und gebucht,
  nicht wiederholt (`src/routes/api-calls.js:540-570`).
- Risiko: keins in dieser Achse.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A / N/A

### PP-D10-07 Ist `cancel_call` idempotent und stoppt es die reale Aktion zuverlaessig?
- Status: PARTIAL
- Evidenz: `src/routes/api-calls.js:646` - `if (call.status !== "active") return res.json({ status: call.status })`:
  ein zweiter Aufruf loest keinen zweiten Auflege-Versuch aus (idempotent). ABER: auf dem
  ElevenLabs-Weg antwortet die Route ehrlich `line_hangup_confirmed: false` und
  `hangup_attempted: <bool>` (:690-696), und die Werkzeugbeschreibung sagt es ebenfalls
  (`src/mcp-tools.js:558-560`): ob die Leitung tatsaechlich faellt, ist NICHT zugesichert.
  Verbleibender harter Stopp ist der Max-Dauer-Timer (`armMaxDurationTimer`, :490) und
  `ELEVENLABS_PROVIDER_MAX_DURATION_S`.
- Risiko: Der Nutzer kann einen laufenden, realen Anruf nicht garantiert abbrechen; er laeuft
  im schlimmsten Fall bis zum Dauer-Cap (1800 s, `src/store/defaults.js:390`) weiter.
- Empfehlung: Auflege-Wirkung auf dem EL-Weg messen und belegen oder ein Traeger-seitiges
  Auflegen (Telnyx-Leg) als zweiten Weg verdrahten.
- Prioritaet/Kategorie: P1 / B

### PP-D10-08 Welche Limits existieren tatsaechlich und greifen sie auf dem MCP-Pfad?
- Status: PASS
- Evidenz: Alle folgenden Gates liegen in der EINEN Kette, die `POST /api/calls` faehrt -
  und der MCP-Pfad geht ueber genau diese Route (`src/mcp-tools.js:825`):
  Kill-Switch `outbound_frozen` (`outbound-gates.js:662-671`, Default `false`,
  `src/config.js` `outboundFrozen`); `tenant_reject` fail-closed (:687-697); KYC (:733-745);
  `owner_name` (:749-761); Denylist/E.164/Land/Stundenlimit/Pro-Ziel-Cap/Abo (:465-504 ueber
  `numberGateError`); Absender-/Herkunfts-Gate (:840-872); Tenant-Kostendecke (:875-885, 402);
  Plan-Minuten (:888-916); atomare Reserve als LETZTES Gate (:935-958). Defaultwerte
  (`src/config.js`): `maxCallsPerHour` 6 (:1479), `perTargetCallCap` 3 (:1488) im Fenster
  86400000 ms (:1493), `allowedCountryCodes` "+49,+33,+44" (:1475), `rateLimitPerMin` 120
  (:1882), `maxNumbers` 5, `maxNumbersPerTenant` 1, `dailySmsCap` 20 (:1461). Harte Max-Dauer
  `MAX_CALL_DURATION_CAP_S = 1800` (`src/store/defaults.js:390`), nicht per Env aufweichbar
  (`src/config.js:1730-1736`), zusaetzlich guthaben-abgeleitete Notbremse
  (`src/call-duration.js:74-81`). Der IP-Limiter deckt `/mcp` ab: ausgenommen sind nur
  `/voice/*` und vertrauenswuerdige Loopback-Aufrufe (`src/app.js:130-136`) - der interne
  REST-Hop ist ausgenommen, der externe MCP-Request nicht.
- Risiko: gering; die Kette ist reihenfolge-gepinnt und laengen-gepinnt (:961-965).
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A / N/A

### PP-D10-09 Gibt es eine Obergrenze fuer GLEICHZEITIGE Anrufe eines Tenants?
- Status: FAIL
- Evidenz: In der 18-gliedrigen Kette (`outbound-gates.js:656-959`) existiert kein
  Nebenlaeufigkeits-Glied; Grep auf `activeCallsFor` findet genau einen Leser,
  `src/budget-gate.js:22`, und der berechnet den LIVE-Geldbetrag, keine Anzahl. Die einzige
  implizite Bremse ist die atomare Reserve pro Leg (`reserve_budget`).
- Risiko: Ein Tenant kann bis zum Stundenlimit (Default 6) alle Anrufe innerhalb weniger
  Sekunden PARALLEL starten - sechs gleichzeitig klingelnde Telefone, sechs parallel laufende
  Kostenachsen. Bei angehobenem `MAX_CALLS_PER_HOUR` waechst das linear mit.
- Empfehlung: Gate `max_concurrent_calls` (Zaehlung ueber `store.activeCallsFor(tenantId)`),
  Default klein (1-2).
- Prioritaet/Kategorie: P1 / C

### PP-D10-10 Gibt es Erkennung auffaelligen Verhaltens, Sperrlisten, deaktivierte Konten, Not-Aus?
- Status: PARTIAL
- Evidenz: Not-Aus vorhanden: `OUTBOUND_FROZEN` (:662-671) sowie `MAX_CALLS_PER_HOUR=0` /
  `PER_TARGET_CALL_CAP=0` als harte Sperren (`src/config.js:1477-1491`). Konto-Sperren
  vorhanden: `store.tenantInactive` (`src/store/state-ops.js:2258-2261`) und
  `billingHoldActive` blocken VOR jeder Lockerung (`outbound-gates.js:413-431`).
  Ziel-Sperrliste hartkodiert und nicht abschaltbar (`src/telephony/number-denylist.js:12-80`).
  NICHT vorhanden: eine Verhaltens-/Anomalie-Erkennung. Beobachtung erschoepft sich in
  `metrics.logCallDenied` (`src/routes/api-calls.js` `beobachteAblehnung`) und einer
  einmaligen Plattform-Ausgabewarnung per SMS (`outbound-gates.js:614-644`,
  `claimPlatformSpendWarning`). Keine Stelle setzt einen Tenant automatisch aufgrund von
  Missbrauchsmustern auf `suspended` (Grep auf `TENANT_STATUS` in `state-ops.js` zeigt
  nur Abo-/Zahlungs-getriebene Wege).
- Risiko: Ein Tenant, der dauerhaft an der Kante der Limits telefoniert (6/h an wechselnde
  Ziele, unbegrenzt ueber Tage), erzeugt kein Signal und keine automatische Reaktion -
  Belaestigungsmuster werden nur pro Ziel (Cap 3/24 h) gebremst, nie als Muster erkannt.
- Empfehlung: Schwellenwarnung auf "viele verschiedene Ziele je Tenant je Tag" plus
  Operator-Sperre; die Datenbasis (`countOutboundCallsSince`) existiert bereits.
- Prioritaet/Kategorie: P2 / C

### PP-D10-11 Massentelefonie: was gibt die Architektur technisch her? (deskriptiv)
- Status: N/A (rein deskriptiv)
- Evidenz: EXISTIERT NICHT: kein Batch-/Listen-Endpunkt (`POST /api/calls` nimmt genau EIN
  `to`, `src/routes/api-calls.js:336-338`); kein Kampagnen-, Zeitplan- oder Wiederwahl-Konstrukt
  (Grep `redial|wiederwahl|kampagne|campaign|bulk|batch_call|broadcast|scheduled_call` ueber
  `src/` -> kein Treffer); keine selbstaendig weiterwaehlende Schleife (einziger
  Originate-Aufrufer ist der Handler oben, s. PP-D10-06); kein Empfaenger-Upload.
  Nummern-Vermehrung gedeckelt: `MAX_NUMBERS` 5 plattformweit, `MAX_NUMBERS_PER_TENANT` 1
  (`src/config.js`, `render.yaml:215-218`), `PROVISIONING_ENABLED` Default `false`.
  EXISTIERT: der Client kann `place_call` in einer Schleife rufen; die Durchsatzdecke ist
  dann `MAX_CALLS_PER_HOUR` je Tenant (Default 6), `PER_TARGET_CALL_CAP` 3 je Ziel/24 h, die
  Tenant-Kostendecke und `RATE_LIMIT_PER_MIN` 120 je IP auf `/mcp`. Ein Massen-Szenario
  braeuchte also viele Tenants, nicht viele Aufrufe.
- Risiko: -
- Empfehlung: -
- Prioritaet/Kategorie: N/A / N/A

### PP-D10-12 Loesen weitere MCP-Werkzeuge reale Aktionen aus (SMS/Mail/Provider-Aenderung)?
- Status: PASS
- Evidenz: Kein Werkzeug in `src/mcp-tools.js` ruft einen SMS-/Mail-/Provisioning-Pfad. Der
  SMS-Versand ist ein Nachlauf des Anrufs, nicht des Werkzeugs, und ist dreifach gebremst:
  Ziel ist ausschliesslich die eigene hinterlegte Nummer des Call-Tenants, Dedup-Marker
  `call.summarySmsSentAt`, Tageskappe `dailySmsCap` fail-closed (`src/sms-summary.js:25-58`).
  `check_inbox` schreibt (`POST /api/inbox/poll`, `src/mcp-tools.js:1133`), bleibt aber
  hausintern.
- Risiko: keins in dieser Achse.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A / N/A

### PP-D10-13 Ist `check_inbox` gegen Client-Retry robust?
- Status: PARTIAL
- Evidenz: `src/mcp-tools.js:1133` ruft `POST /api/inbox/poll`; die Werkzeugbeschreibung
  (`CHECK_INBOX_DESCRIPTION`, :481-485) bezeichnet den Abruf selbst als konsumierend.
  Kein Idempotenz-Schluessel, keine Wiederholungs-Quittung.
- Risiko: Bricht die Verbindung nach dem Serverschreibvorgang ab, sind die Eintraege als
  gesehen markiert, ohne dass sie je beim Nutzer ankamen - Nachrichtenverlust ohne Anzeige.
- Empfehlung: `include_seen`-Rueckweg oder ein Bestaetigungs-Schritt (Poll liest, separater
  Aufruf quittiert).
- Prioritaet/Kategorie: P2 / C

## Offene Fragen (nicht am Repo entscheidbar)

- Welche Werte tragen die Gates LIVE? `render.yaml:201-212` nennt `ALLOWED_COUNTRY_CODES=+49,+33,+44`
  und `MAX_CALLS_PER_HOUR=6`, aber die Render-Dienste sind laut CLAUDE.md/Repo-Doku
  dashboard-verwaltet - die Blueprint-Datei belegt den laufenden Zustand nicht. Insbesondere
  `ALLOWED_COUNTRY_CODES="*"` (im Code als zulaessiger Wert vorgesehen, `src/config.js:1475`)
  wuerde den Landfilter praktisch ausschalten.
- Kappt der EL-Loeschversuch (`endConversation`) die Leitung tatsaechlich? Der Code sagt
  ausdruecklich, das sei NICHT belegt (`src/routes/api-calls.js:686-689`) - ohne Messung am
  laufenden Anbieter nicht entscheidbar.
- Wie verhaelt sich ein realer ChatGPT-Host bei einem Timeout auf `tools/call`: wiederholt er
  automatisch? Das entscheidet, ob PP-D10-05 ein theoretischer oder ein sicherer Doppelanruf ist.
- Ist `OWNER_SELF_CALL_TENANT_IDS`/`PAYMENT_ENABLED` live gesetzt? Beides veraendert, welche
  Gate-Zweige ueberhaupt greifen (`minutes`-Gate haengt an `paymentEnabled`,
  `outbound-gates.js:890-894`).

## Randbefund (ausserhalb dieser Dimension)

Die hinterlegte eigene Nummer ist ueber `POST /api/self-service/private-number` von jedem
eingeloggten Tenant setzbar und nur format-/land-, nicht eigentums-verifiziert
(`src/store/state-ops.js` `normalizePrivateNumber`, in CLAUDE.md als Launch-Blocker gefuehrt).
Sie ist zugleich das Ziel der Summary-SMS und die Basis des Offenlegungs-Sonderfalls -
relevant fuer die Datenschutz-/Offenlegungs-Dimension.

## Gegenpruefung

Quelle: Code auf Branch master, jede Stelle selbst geoeffnet. Urteil bezieht sich auf die
BEHAUPTUNG des Pruefpunkts; abweichende Risiko-/Zahlenangaben sind im Satz korrigiert.

- PP-D10-04: BESTAETIGT - `routes/api-calls.js:334-341` nimmt ausser `to`/`objective` keinen Schluessel entgegen und `:439` legt bedingungslos an; `rg "idempot" src/` trifft nur Provisioning-Jobs (`store/pg.js:1253`) und das Reserve-Freigabe-Schloss (`store/state-ops.js:405`), nie den Anrufstart - Blast-Radius aber gedeckelt durch `perTargetCapReached` (`telephony/outbound-gates.js:375-378`, 3 Anrufe je Ziel/24 h).
- PP-D10-05: BESTAETIGT - `mcp-tools.js:585` uebergibt kein `timeoutMs`, und `:65` setzt `signal` nur dann; verschaerfend (vom Auditor nicht gesehen): der Handler `routes/api-calls.js:334` hat KEINEN aeusseren try, der `try` beginnt erst `:471` - eine Ausnahme davor endet als `unhandledRejection` (`process-guards.js:21`) und der Client bekommt gar keine Antwort, nicht nur eine spaete.
- PP-D10-03: BESTAETIGT - `rg "annotations|readOnlyHint|destructiveHint|openWorldHint|idempotentHint" src/` liefert null Treffer, `place_call` wird `mcp-tools.js:666-821` allein mit description/inputSchema/outputSchema registriert.
- PP-D10-01: BESTAETIGT, Risiko-Erzaehlung teilweise widerlegt - `CALL_OUTPUT` (`mcp-tools.js:322-327` ueber `CALL_STATUS_OUTPUT:177-183`) fuehrt weder `to` noch `from`, aber die befuerchtete Fehlwahl in ein fremdes Land ist am Praedikat abgesichert (`store/defaults.js:885` NANP-Guard gegen das Tenant-Herkunftsland, `:915-920` NPA/NXX-Plausibilitaet - eine unplausible Eingabe bleibt unveraendert und faellt in den E.164-400).
- PP-D10-02: BESTAETIGT - `rg "elicit" src/ apps/` = 0 Treffer, Pflichtfelder nur `routes/api-calls.js:337-338`, kein Vorschau-/Bestaetigungsschritt; Host-seitig greift die Bestaetigungspflicht (N-7/N-8) gerade WEIL die Annotationen fehlen, das ersetzt die serverseitige Bestaetigung aus N-10 aber nicht.
- PP-D10-09: BESTAETIGT (kein Zaehl-Gate), Risiko teilweise widerlegt - in der Kette (`telephony/outbound-gates.js:656-959`) gibt es kein Nebenlaeufigkeits-Glied, aber `armMaxDurationTimer` armiert fuer JEDEN Anruf zusaetzlich den Geld-Waechter (`telephony/call-lifecycle.js:268`), und der liest die LIVE-Summe aller aktiven Legs des Tenants (`budget-gate.js:22` -> `store/state-ops.js:1779`) - parallele Legs laufen also nicht ungebremst in die Decke.
- PP-D10-07: BESTAETIGT im Kern, Risikozahl WIDERLEGT - `routes/api-calls.js:646` ist idempotent und `:690-696` meldet ehrlich `line_hangup_confirmed:false`, aber der bindende harte Deckel auf dem EL-Weg ist der ANBIETER-Deckel 600 s (`elevenlabs/outbound.js:174`, angewandt `:207-210`, besessen in `elevenlabs/agent_configs/outbound-agent.template.json:817`, dazu Stille-Timeout 30 s), NICHT die 1800 s aus `store/defaults.js:390`.
- PP-D10-10: BESTAETIGT - keine Anomalie-Erkennung auffindbar; die vom Auditor EMPFOHLENE Operator-Sperre existiert allerdings bereits als Endpunkt (`web-auth.js:924` `POST /api/admin/tenants/:id/suspend`, `webAuthMw+adminMw`, wirkt ueber `store.tenantInactive` in `telephony/outbound-gates.js:413-418`) - offen ist nur die automatische Erkennung, nicht der Hebel.

### Vom Erst-Auditor uebersehen

#### PP-D10-G1 Halten Stundenlimit und Pro-Ziel-Cap unter Nebenlaeufigkeit (TOCTOU)?
- Status: FAIL
- Evidenz: `telephony/outbound-gates.js:364-378` - beide Caps sind reine Reads ueber `store.countOutboundCallsSince`, ohne Lock; der Datensatz, den dieser Zaehler zaehlt, entsteht erst `routes/api-calls.js:439`, und davor liegt ein AWAITED Netzaufruf gegen das LLM (`:428` `await fetchOpeningLine`). `runOutboundGates` awaitet jedes Glied (`telephony/outbound-gates.js:311`), also gibt jede Kettenfahrt die Event-Loop frei. Der einzige Lock in der Kette deckt nur die Geld-Reserve (`:935-958`).
- Risiko: Zwei bis N gleichzeitige `place_call` lesen denselben Zaehlerstand und passieren alle: `MAX_CALLS_PER_HOUR` (Default 6) und der Pro-Ziel-Cap (Default 3/24 h) sind ueberschreitbar. Damit faellt auch die einzige dedup-nahe Bremse, die PP-D10-04 abfedert - ein paralleler Doppel-Retry erzeugt zwei echte Anrufe beim selben Menschen, obwohl der Cap sie zaehlen sollte.
- Empfehlung: Zaehler-Check und Anspruchsnahme in den bestehenden `store.withStoreLock`-Abschnitt ziehen (Muster `tryReserveOutboundBudget`) oder den Call-Datensatz VOR `fetchOpeningLine` anlegen.
- Prioritaet/Kategorie: P1 / B

#### PP-D10-G2 Ist das Rate-Limit fuer die extern sichtbare Aktion nach Nutzer/Tenant bemessen?
- Status: PARTIAL
- Evidenz: `middleware.js:157-168` - der Limiter keyt ausschliesslich auf `req.ip` (`:165`); `app.js:130-136` haengt ihn vor `/mcp`. Es existiert kein Leser einer Host-Nutzerkennung: `rg "openai/subject" src/` liefert nur einen Kommentar zu `_meta["openai/outputTemplate"]` (`ui/ports.js:18`). Die zweite Achse (`maxCallsPerHour`) keyt zwar auf `tenantId` (`telephony/outbound-gates.js:369`), ist aber TOCTOU-behaftet (s. G1).
- Risiko: Bei einem gehosteten Connector kommen alle Nutzer aus den Egress-Adressen des Hosts. Dann ist `RATE_LIMIT_PER_MIN` (Default 120) EIN gemeinsamer Eimer: ein einzelner Tenant kann alle uebrigen Tenants am `/mcp`-Eingang drosseln (Noisy-Neighbour-DoS), waehrend umgekehrt die IP-Achse fuer den Einzelnen kein wirksames Limit ist.
- Empfehlung: Limit-Schluessel auf die aufgeloeste Tenant-/Subject-Achse umstellen (`request-tenant.js` liegt bereits vor), IP-Eimer als zweite Schranke behalten.
- Prioritaet/Kategorie: P1 / A (T-27/T-28, `tasks/openai-audit/00-openai-anforderungen.md:60`)

#### PP-D10-G3 Ist `answer_consult` eine extern sichtbare Aktion?
- Status: FAIL
- Evidenz: `mcp-tools.js:934` sendet den Modell-Text an `POST /api/calls/:id/consult/answer`; `routes/api-calls.js:175-193` uebernimmt ihn als `facts` in den laufenden Anruf; `routes/webhooks-elevenlabs.js:99-102` gibt genau diese Fakten als `answer` an den Anbieter zurueck (`:110-116`), und der Agent SPRICHT sie dem Dritten am Telefon vor. Keine Annotation (s. PP-D10-03), keine Bestaetigung, kein Vorschau-Schritt.
- Risiko: Der Erst-Auditor verbucht dieses Werkzeug unter PP-D10-12 als hausintern (Status PASS). Tatsaechlich verlaesst hier Text die Umgebung in Richtung eines unbeteiligten Menschen - eine halluzinierte Antwort wird woertlich ausgesprochen und ist nicht zurueckholbar.
- Empfehlung: `answer_consult` wie `place_call` als Write-Action annotieren (`readOnlyHint:false`, `destructiveHint:true`, `openWorldHint:true`) und in PP-D10-12 als zweites extern wirksames Werkzeug fuehren.
- Prioritaet/Kategorie: P1 / A (N-3/N-4/N-9)

#### PP-D10-G4 Ueberlebt die Geld-Reserve einen Abbruch zwischen Reservierung und Datensatz?
- Status: PARTIAL
- Evidenz: Die Reserve wird im letzten Gate gebucht (`telephony/outbound-gates.js:935-958` -> `store/state-ops.js:4783-4790`), die Freigabe verlangt aber einen Call-Datensatz (`store/state-ops.js:4795-4801`, `if (!call || !call.reserveCents ...) return false`), und der entsteht erst `routes/api-calls.js:439`; der Backstop-Timer wird noch spaeter armiert (`:513`). Der Handler hat keinen aeusseren try (`:334` vs. `:471`).
- Risiko: Wirft etwas zwischen Reservierung und `createCall` (Store-Write-Fehler, Buchung der Opening-Line-Token), bleibt die Reserve dauerhaft auf `s.reservations[tenantId]` stehen. Sie zaehlt in `reserveExceedsBudget` (`store/state-ops.js:4465-4470`) kumulativ mit und weist kuenftige, legitime Anrufe mit 402 ab - ein selbst verursachter Dauer-Block ohne Anruf und ohne Antwort an den Client.
- Empfehlung: Reservierung und Datensatz in einen gemeinsamen Fehlerpfad klammern (try um den Block ab dem Gate-Ende, Freigabe ueber tenant+Betrag statt ueber den Call-Datensatz).
- Prioritaet/Kategorie: P2 / C

#### PP-D10-G5 Gibt es fuer die konsumierende Inbox einen Rueckweg? (Korrektur zu PP-D10-13)
- Status: PASS
- Evidenz: `mcp-tools.js:1130-1133` fuehrt das Feld `include_seen` und reicht es durch; `routes/api-inbox.js:45-49` liest es fail-closed (`=== true`) und gibt mit `includeSeen` auch bereits gesehene Eintraege erneut heraus (`store.takeInboxEntries`). Der in PP-D10-13 EMPFOHLENE `include_seen`-Rueckweg ist damit bereits gebaut.
- Risiko: Nur Rest-Risiko - ein Abbruch nach dem Schreiben verliert die Eintraege nicht dauerhaft, der Client muss den Rueckweg aber kennen (die Werkzeugbeschreibung entscheidet das, nicht die Route).
- Empfehlung: PP-D10-13 auf "Beschreibung nennt den Rueckweg" verengen statt einen Rueckweg zu fordern, der existiert.
- Prioritaet/Kategorie: P2 / C
