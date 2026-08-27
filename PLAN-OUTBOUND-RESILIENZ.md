# PLAN-OUTBOUND-RESILIENZ

Etappenplan gegen den Outbound-Totalausfall vom 27.08.2026. Entwurf, KEIN Code.
Gemessener Ausgangsbefund: `tasks/befund-outbound-ausfall-2026-08-27.md`.

Alle Aussagen unten sind entweder am Code (`file:line`) oder am laufenden Anbieter-Konto
belegt. Was nicht belegt ist, steht unter **OFFEN** und wird nicht behauptet.

---

## 1. Kontext und Hergang (kurz)

Am 27.08.2026 schlugen vier Outbound-Anrufe hintereinander fehl, alle mit demselben
Anbieter-Fehler:

```
"error": { "code": 403,
           "reason": "unexpected status from INVITE response: sip status: 403:
                      Unverified origination number D51 (SIP 403)",
           "error_type": "call_initialization_error" }
```

Die Kette, verkuerzt (Vollbeleg im Befund):

1. Der gesamte Produkt-Outbound geht ueber EINE bei ElevenLabs registrierte SIP-Nummer
   (`phnum_1101m00pjrg7e1js7aaxwp8hdw38`, `+15739090177`) und ueber den Telnyx-`ani_override`
   derselben Nummer auf der FQDN-Connection `3026479542865757220`.
2. Dieselbe Nummer war zugleich die DID eines Wegwerf-Test-Tenants.
3. Der Kuendigungs-/Loeschweg dieses Test-Kontos gab sie am 24.08.2026 frei
   (`audit_log`: `actor=system:erase-release`, `did_released`).
4. Seitdem lehnt Telnyx jedes INVITE mit 403 D51 ab: die Absendernummer gehoert dem Konto
   nicht mehr, und eine verifizierte Fremd-CLI ist nicht hinterlegt.
5. Drei Tage lang bemerkte das niemand. Der Ausfall fiel nur auf, weil der Eigentuemer
   zufaellig selbst anrief.

**Der Ausfall steht zum Zeitpunkt dieses Entwurfs noch** (heute, 27.08.2026, rein lesend
nachgemessen):

| Abfrage | Ergebnis heute |
|---|---|
| `GET /v2/phone_numbers` | 3 Nummern (`+15804504874`, `+17067101188`, `+18643028341`), alle `active`, alle an Connection `2982643896460248193`. `+15739090177` NICHT darunter |
| `GET /v2/fqdn_connections/3026479542865757220` | `active: true`, `outbound.ani_override = "+15739090177"`, `ani_override_type = "always"` |
| `GET /v1/convai/phone-numbers` | genau EINE Registrierung: `phnum_1101m00pjrg7e1js7aaxwp8hdw38` -> `+15739090177`, `supports_outbound: true` |
| `GET /v1/convai/conversations?page_size=6` | 4x `failed`/`0 s` (27.08.), davor `done`/17 s (20.08.) |

Der Befund nennt vier Folgebefunde: **F1** Anbieter-Fehler wird nicht ausgelesen, **F2** kein
Alarm, **F3** gespeicherte Absendernummer ist nicht die gesendete, **F4** keine
Drift-Erkennung. Dazu die **WURZEL** (eine Nummer in zwei Rollen, ohne dass das System die
zweite kannte) und die **WIEDERHERSTELLUNG**.

### 1.1 Drei OFFEN-Punkte aus den Vorbefunden, in dieser Sitzung geschlossen

Rein lesend gegen `api.elevenlabs.io`, Gespraech `conv_9101m121kyn8e48s8zz5m3kekzwy`
(27.08., Rufnummern hier maskiert):

1. **`metadata.error` traegt live `{code, reason, error_type}`** — obwohl die veroeffentlichte
   OpenAPI (`ConversationHistoryErrorCommonModel`) nur `code` (required) und `reason`
   (nullable) fuehrt. **Konsequenz fuer den Entwurf: klassifiziert wird auf `code` (zugesichert)
   und auf das aus `reason` per strenger Regex gezogene SIP-/Carrier-Kuerzel. `error_type` ist
   Beiwerk, nie alleinige Grundlage.**
2. **`metadata.phone_call.agent_number` ist AUCH im abgelehnten Fall befuellt** — im
   gemessenen 403-Datensatz steht die tatsaechlich versuchte Absendernummer drin, ebenso
   `phone_call.call_id` (`otb_…`). Das war in Befund 2/3 als OFFEN gefuehrt. **Konsequenz: F3
   ist nachtraeglich messbar, auch bei gescheiterten Anrufen.**
3. **Der Anrufstart-Koerper hat KEIN Absenderfeld.** OpenAPI
   `Body_Handle_an_outbound_call_via_SIP_trunk_…`: `agent_id`, `agent_phone_number_id`,
   `to_number`, `conversation_initiation_client_data`, `telephony_call_config`; und
   `TelephonyCallConfig` fuehrt ausschliesslich `ringing_timeout_secs` und
   `twilio_call_recording_enabled`. **Konsequenz: eine Per-Anruf-ANI ist auf dem EL-Weg
   strukturell ausgeschlossen. Pro-Tenant-Absender = eine EL-Registrierung PRO DID.**

---

## 2. Ist-Befund je Baustelle

### 2.1 WURZEL — Nummern-Lebenszyklus kennt keine Plattform-Rolle

- Zustandsautomat: `src/store/defaults.js:72-98` (`NUMBER_STATUS`, `NUMBER_TRANSITIONS`,
  `released` terminal).
- **Es gibt genau EINE Mutation, die `released` erreicht:** `releaseNumber`
  (`src/store/state-ops.js:2466-2472`) ueber `transitionNumber(..., NUMBER_STATUS.RELEASED)`
  (`:2467`). Nachgeprueft: `grep NUMBER_STATUS.RELEASED src/` liefert ausser dem
  Transitions-Tableau, `occupiesCapacity` (`:2306`) und einer Sortier-/Anzeigeliste (`:2512`)
  keinen zweiten Schreiber.
- **Zwei Aufrufer**, mehr nicht (`grep releaseNumber( src/ scripts/`):
  1. `src/onboarding.js:266-267` — Rollback nach fehlgeschlagenem Kauf. Erreicht nur
     `provisioning|capturing -> failed -> released`; eine **aktive** Nummer kann diesen Pfad
     per Transitions-Tableau **nicht** nehmen (`ACTIVE` -> nur `SUSPENDED|RELEASED`).
  2. `src/release-reconcile.js:60-84` `performNumberRelease` — der gemeinsame Kern von
     Grace-Reconcile (`runReleaseReconcile:114`) und Art.-17-/Kuendigungs-Freigabe
     (`releaseTenantNumbersOnErase:144`, Actor `system:erase-release`, `:27`). **Das ist der
     Weg, der den Ausfall ausloeste.**
- Vorpruefungen des Erase-Pfads heute, vollstaendig: `tenantNumbersForErase`
  (`src/store/state-ops.js:2621-2628`) filtert `tenantId` + `status==='active'` +
  `provider==='telnyx'`. **Kein Grace, kein Live-Recheck, keine Pruefung auf laufende Anrufe,
  keine Pruefung auf Plattform-Rolle.** Der Grace-Pfad hat immerhin einen Live-Recheck
  (`release-reconcile.js:87-108`), der Erase-Pfad hat ihn bewusst nicht (`:133-136`).
- Reihenfolge in `performNumberRelease`: **Provider-DELETE VOR der Store-Mutation** (`:61`
  vor `:70`) — irreversibel. Ein Riegel, der erst in `releaseNumber` greift, kaeme zu spaet
  fuer die Nummer beim Anbieter.
- Datenmodell: `src/db/schema.sql:643-672` — `id, tenant_id, e164, provider, status,
  provider_number_id, created_at, payment_intent_id, country, language, monthly_cost_cents`.
  **Keine Rolle/Zweck-Spalte.** `tenant_id TEXT NOT NULL REFERENCES tenant(id) ON DELETE
  CASCADE` (`:645`) — eine Nummer ohne Tenant ist nicht darstellbar. RLS FORCE + strikte
  Tenant-Policy (`:813-816`, `:882-884`) — eine plattformweite Nummer hat in dieser Tabelle
  kein Zuhause. Vergleichsmuster fuer globale Tabellen existieren:
  `profile_global` (`:866`), `platform_tts_usage_global` (`:871`), `cost_cross_check_global`.
- Die Plattform-ANI existiert heute **ausschliesslich ausserhalb des Datenmodells**:
  `ELEVENLABS_AGENT_PHONE_NUMBER_ID` (`src/config.js:699`, eine opake EL-ID, KEINE E.164) und
  der Telnyx-`ani_override`, der in `src/` **nirgends** vorkommt — nur in
  `scripts/spike2-sip.mjs:136-138`, einem als **Wegwerf** deklarierten Spike-Skript, das in
  keinem `package.json`-Script steht. **Der Live-Absenderpfad wird von keinem Produktivcode
  verwaltet.**
- Boot-Gate `hasActiveNumber` (`src/boot.js:407-413` via `src/store/views.js:78`) ist
  plattformweit, nicht rollenbezogen: bei drei anderen aktiven DIDs haette es den Ausfall
  **nicht** bemerkt.
- `numberAssignments` (`state-ops.js:110/2451/2468`) wird **nur geschrieben, nie gelesen** —
  die im Schema-Kommentar (`schema.sql:674-676`) beschriebene Recycling-Karenz ist nicht
  implementiert.
- **`number.e164` ist GLOBAL UNIQUE** (`schema.sql:646`), und `releaseNumber`
  (`state-ops.js:2466-2472`) leert die `e164` **nicht** — sie bleibt an der `released`-Zeile
  stehen. **Folge, heute unbemerkt: dieselbe Nummer kann nach einer Freigabe nicht wieder
  beschafft werden** — `activateNumber` schriebe dieselbe `e164` in eine neue Zeile und liefe
  in eine UNIQUE-Verletzung, unter FORCE-RLS mit einer Fehlermeldung, die auf eine fuer die
  Session unsichtbare Zeile zeigt (Lehre `hermes-db-forensik`). Auf dem JSON-Backend faellt es
  nicht auf. **Das betrifft direkt den naheliegenden Wunsch "wir holen `+15739090177` zurueck".**
- **Flush-Mechanik, entscheidend fuer jeden DB-seitigen Riegel:** `flushNumbers`
  (`pg.js:2103-2130`) schreibt bei **JEDEM** `save()` ein `INSERT … ON CONFLICT (id) DO UPDATE`
  fuer **jede** Zeile des Tenants — also ein `UPDATE` auf jede Nummer, bei jedem Speichern,
  nicht nur beim Zustandsuebergang. Und `flushOwnScoped` prunt **vor** dem Insert-Loop ueber
  `deleteMissing` (`pg.js:2233-2247`); bei leerer keep-Liste woertlich
  `DELETE FROM number WHERE tenant_id=$1`. Ein Trigger, der diese beiden Wege nicht sauber
  ausnimmt, legt den gesamten Schreibpfad still (s. PM-11/PM-12).
- **Es gibt heute NULL Trigger und NULL Funktionen im Schema**
  (`grep -ci "CREATE TRIGGER|CREATE FUNCTION|plpgsql" src/db/schema.sql` = `0`). Das
  Bestandsmuster fuer Idempotenz ist ausschliesslich `DROP POLICY IF EXISTS` + `CREATE POLICY`.
  `migrate.applySchema` (`src/db/migrate.js:20-23`) liest die **ganze** Datei und fahrt sie bei
  **jedem** Prozessstart als ein Skript aus; dieselbe DDL laeuft in den pg-Tests gegen PGlite.
- Zweiter, gleichartiger Defekt: `performNumberRelease` prueft `s.calls` **nicht**. Eine DID
  kann waehrend eines laufenden Gespraechs beim Anbieter geloescht werden. Fuer `call` ist der
  Aktiv-Schutz woanders bewusst gebaut (`src/store/pg.js:2258-2270`
  `deleteMissingCallsKeepActive`, Kommentar `:2254-2256` sagt ausdruecklich, dass fuer
  `number` bewusst kein genereller Aktiv-Schutz existiert).

### 2.2 F1 — Fehlerklassifikation

- Unser Endstatus auf dem EL-Weg: `endStatusOf` (`src/elevenlabs/outbound.js:367-368`) —
  Anbieter `done` -> `completed`, **alles andere -> `failed`**, ohne Grund.
- **`recordFailureReason` wird auf dem gesamten EL-Weg nie gerufen.** Schreiber sind nur
  `src/routes/voice.js:542` (TeXML), `src/telnyx-call-control-ingest.js:100` (Call-Control),
  `src/telephony/call-lifecycle.js:102` (Cap/Budget). -> `failure_reason` ist fuer JEDEN
  EL-Anruf strukturell NULL.
- Auch der **Start-Fehlerpfad** schreibt keinen Grund: `src/routes/api-calls.js:392-401`
  (`catch` -> `store.endCallRecord(call.id, "failed")`), obwohl `err.providerStatus` dort
  vorliegt (`src/elevenlabs/convai.js:55-60`, `src/telephony/adapters/telnyx/errors.js:30-57`).
  Dieser `catch` umschliesst **alle drei Engine-Zweige** (`api-calls.js:331/351/366`) — die
  Luecke ist also nicht EL-spezifisch.
- Gespeichert wird stattdessen `answeredUnclearReason = call_duration_secs_zero_not_answered`
  (`src/elevenlabs/outbound.js:90`), erzeugt in `answeredAnchorOutcome` (`:427-440`, Zweig
  `:438`). **Dieselbe Bedingung traegt "der Anbieter hat den INVITE abgelehnt" UND "der Mensch
  ist nicht rangegangen"** — genau die Vermischung, die das Modul selbst verbietet (`:80-91`).
- Das Vokabular existiert bereits und ist gut: `src/telephony/failure-reason.js`
  (`callFailureReason:23`, `failureReasonBase:36`, Detail-Trenner `:` `:19`,
  `hangupCauseStatus:95`), Texte `src/i18n/failure-reason-texts.js:25-59`, Leser
  `src/mcp-tools.js:162`, `src/telephony/call-finish.js:212`, `src/ui/widgets/call.html:419`.
  **Es fehlt eine Basis-Klasse fuer "der Anruf kam nie zustande, weil Anbieter/Konfiguration
  ihn abgelehnt haben"** — `no-answer|busy|canceled|failed` deckt sie nicht.
- Ein Test **pinnt heute die falsche Zuordnung**:
  `test/el-fixtures-echte-antworten.test.js:129-150` behauptet fuer den gemessenen SIP-404-Fund
  `unclearReasons === ["call_duration_secs_zero_not_answered"]` mit dem Kommentar
  *"er IST bekannt: es wurde nie abgenommen"*. Jeder Fix muss diesen Test aendern.
- Der Beleg liegt seit 15.08.2026 ungenutzt im Repo:
  `test/fixtures/elevenlabs-conversations.js:83-93` enthaelt woertlich
  `metadata.error = {code:404, reason:"INVITE failed: sip status: 404: Invalid destination
  number D11 (SIP 404)"}` — formgleich zum 403/D51 vom 27.08.

### 2.3 F2 — Beobachtbarkeit

- Nutzer-Ebene: **genau eine** Stelle traegt "dein Auftrag ist gescheitert" —
  `src/telephony/call-finish.js:203-217` (`addNotification(t.failedTitle,
  t.statusBody(target, status, call.failureReason))`, dann `return`; SMS und Mail werden fuer
  gescheiterte Anrufe strukturell nie erreicht). Ohne Grund lautet der Text exakt
  `"<Ziel> (Status: failed)"` (`src/i18n/failure-reason-texts.js:66-74`).
- **Niemand sieht diese Meldung.** Der Feed steckt in `/api/state`
  (`src/routes/api-read.js:83`) und `/api/self-service/state` (`src/self-service-routes.js:354`),
  aber `grep -rn notification apps/web/src/{components,pages,lib,scripts,styles}` = **0 Treffer**.
- **Der MCP-Rueckweg hat keinen Fehlerkanal.** `AWAIT_EVENT_OUTPUT`/`awaitEventView`
  (`src/mcp-tools.js:216-239`) haben **kein `status`- und kein `failure_reason`-Feld**. Bei
  einem nie zustande gekommenen Anruf liefert `pickTranscript:187-189` woertlich
  *"(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)"* —
  eine Aufforderung zum Weiterwarten auf etwas, das nie kommt. Die MCP-Server-Instruktionen
  weisen das Modell ausdruecklich auf die `await_call_event`-Schleife, nicht auf
  `get_call_status` (das als einziges `failure_reason` traegt, `:152-163`).
- Betreiber-Ebene: `/healthz` (`src/app.js:129`) ist statisch (`{ok, commit, configHash}`).
  `src/boot-guard.js` feuert einmal je Prozessstart und prueft keine Nummern-/Provider-Wirklichkeit.
- **Schwellenwert-Alarm existiert dreifach und ist das Vorbild:** `claimPlatformSpendWarning`
  (`src/store/state-ops.js:3974`, "melde genau einmal je Periode", Regel `:3985`
  *"Zu laut ist erlaubt, stumm nie"*), `shouldEmitFinding` + `emitFinding`
  (`src/billing/cost-truing.js:364-380`, Entprellung ueber `config.billing.costAlertDebounceMs`),
  `onTtsQuotaWarning` (`src/server.js:242-246`).
- **ABER: `claimPlatformSpendWarning` ist im pg-Backend strukturell EPHEMER.** `pg.js:561-565`
  sagt es woertlich: *"Reine In-Memory-Mutation auf dem Spiegel (kein save/Flush):
  platformSpendWarnedMonth wird von flush() NIE geschrieben (keine Spalte) -> strukturell
  ephemer, wie reservations."* Als Vorbild fuer einen **Zaehler** oder einen
  **Entprell-Marker**, der einen Prozess-Neustart ueberleben muss, taugt es damit **nicht** —
  auf `plan: free` ist jedes Aufwachen ein Prozess-Start.
- **Der bestehende Drift-Waechter laeuft NICHT periodisch.** `.github/workflows/ci.yml:9`
  (`on: [push, pull_request]`), Schritt `:83-91` fahrt `npm run elevenlabs:drift` — und
  **ueberspringt ihn mit `::warning::` + `exit 0`, wenn kein `ELEVENLABS_API_KEY`-Secret
  hinterlegt ist** (Kommentar `:75-82`; laut Kommentar ist genau das der Ist-Zustand). Das ist
  der Praezedenzfall, den ein neuer Waechter **nicht** wiederholen darf: ein Waechter, dessen
  Untaetigkeit gruen aussieht.
- **Es geht genau EIN Alarm-Weg raus:** SMS ueber `sendBootstrapAlertSms`
  (`src/telephony/alert-sms.js:67-75`) an `config.billing.platformAlertSmsTo`, Absender =
  `findActiveNumber(store, BOOTSTRAP_TENANT_ID)` (`:36-41`). Fail-soft, Ziel wird nie geloggt.
  **Risiko: dieser Kanal haengt am selben Telnyx-Konto und derselben Nummern-Tabelle wie der
  ausgefallene Outbound.** Ein Ausfall der Klasse "unsere Nummern gehoeren uns nicht mehr"
  kann den Alarm mitreissen.
- E-Mail als Alarmweg existiert nicht (`src/mail/ports.js` kennt `sendMail`; Verbraucher sind
  Kuendigungsbestaetigung und Summary-Mail). Webhook/Pager: nichts im Repo.
- **Keine einzige Aggregat-Beobachtung ueber Anruf-Ausgaenge.** `metrics.logCallDenied`
  (`src/metrics.js:112`) ist im Kommentar als *"das EINZIGE Laufzeitsignal, an dem ein
  laender-/sprachweiter Totalausfall auffaellt"* bezeichnet — feuert aber nur bei
  **Gate**-Ablehnungen VOR dem Waehlen (`src/routes/api-calls.js:219`), ist eine reine
  Logzeile, kein Zaehler, kein Alarm. Ein Anruf, den der Anbieter NACH dem Waehlen ablehnt,
  erzeugt kein Signal.
- **Takt:** kein Cron, kein Worker, keine Jobs. `src/queue/adapters/pgboss/queue.js:6` wirft
  ("deferred nach P8"), `QUEUE_BACKEND=memory` (`src/config.js:1289`). Alles Periodische sind
  `setInterval(...).unref()` im Web-Prozess: Retention (`src/boot.js:982`), Kosten-Sweep +
  DID-Miete + Cross-Check (`src/boot.js:1015` -> `runSweepTick:873-887`, Default 1 h),
  DID-Release-Reconcile/Vertragsende/Kuendigungsmail/Stripe (`src/wiring/web-login.js:70/80/95/115`,
  je 6 h). **`render.yaml:13` `plan: free`** — und das Repo sagt selbst, was das heisst:
  `src/boot.js:992` ("kein Render-Cron (gibt es auf dem Free Tier nicht)"), `:1004`
  ("weder preDeploy noch Jobs"), `src/wiring/web-login.js:100` (*"der Dienst schlaeft ohne
  Traffic ohnehin, und JEDES Aufwachen ist ein Prozess-Start"*). **Ein reiner
  `setInterval`-Waechter laeuft auf diesem Plan nicht verlaesslich.**

### 2.4 F3 — Absender-Wahrheit

- Einziger Outbound-Schreibweg fuer `call.from`: `src/routes/api-calls.js:292`
  (`from: ctx.fromNumber`). Danach nie wieder geschrieben (pg-Upsert fuehrt `from_e164` nicht,
  `src/store/pg.js:1889-1905`).
- Herkunft: Gate-Glied `resolve_outbound` (`src/telephony/outbound-gates.js:715-741`) ->
  `outboundFrom:385-388` -> `findActiveNumber` (`src/store/views.js:58-65`): **erste
  `numbers`-Zeile des Tenants mit `status=active`**, provider-agnostisch, ohne Rollenbegriff.

| Engine | gesendeter Absender | Beleg | = `from_e164`? |
|---|---|---|---|
| Budget/TeXML | `From`-Formfeld = `ctx.fromNumber` | `adapters/telnyx/voice.js:699,705` | JA |
| Telnyx Call-Control | JSON `from` = `ctx.fromNumber` | `src/telnyx-origination.js:17-24`, `voice.js:765,770` | JA |
| **ElevenLabs (live)** | **`from` wird nie gesendet** | `src/elevenlabs/outbound.js:928-951` | **NEIN** |

- Die genutzte TeXML-Application `2982643896460248193` traegt **kein** `ani_override` (live
  geprueft) — auf den beiden Telnyx-Wegen ist `from_e164` also tatsaechlich die gesendete
  Nummer, solange Telnyx den Besitz bestaetigt.
- Der EL-Zweig unterliegt der Provider-Abstraktion ausdruecklich **nicht**
  (`src/elevenlabs/outbound.js:6-10`, Modulkopf: *"WARUM KEIN PROVIDER-ADAPTER … Dies ist ein
  ENGINE-Zweig"*; Importliste `:36-44` ohne `telephony/ports.js`). Der Port-Vertrag verlangt
  einen Absender (`src/telephony/ports.js:127`), der EL-Zweig unterliegt ihm nicht. **Es gibt
  heute keine Naht, an der ein Absender fuer den EL-Weg uebergeben werden koennte** — und laut
  1.1(3) auch kein Anbieter-Feld dafuer.
- Der Waechter `assertOverrideWhitelisted` (`src/elevenlabs/convai.js:119-160`) laesst im
  Anrufstart-Body nur `agent.language`, `tts.voice_id` (+ `agent.first_message` bei
  `calleeIsOwner`) zu — ein nachgeruesteter Per-Call-Absender im Override waere fail-closed
  abgebrochen. Richtig so; die Erweiterung muesste am Body-Schema stattfinden, das es nicht gibt.
- Folgeschaeden der falschen `from` im Bestand (belegt): Geo-/Sprach-/Stimm-Anker
  (`src/elevenlabs/outbound.js:816,834` via `numberRecordByE164`, `state-ops.js:1623-1626`),
  Tarif-/Herkunfts-Achse (`outbound-gates.js:795,179-183,166-169`), Herkunfts-Gate
  (`:392-406`, heute abgeschaltet durch `FORCE_NUMBER_COUNTRY=US`, `render.yaml:234-235`).
  **Kein PII-/API-Leck:** `from` wird fuer Outbound nicht ausgegeben (`src/mcp-tools.js:373`
  liefert bei `direction==="outbound"` `c.to`).
- **Inbound routet ueber die ANGERUFENE Nummer zum Tenant** (`src/routes/voice.js:280` ->
  `store.numberRecordByE164`, `state-ops.js:1623`). **Folge fuer eine geteilte ANI, im Befund
  nicht benannt:** solange die Plattform-ANI die DID eines Tenants ist, landet **jeder Rueckruf
  eines fremden Angerufenen** im Assistenten und in den Transkripten genau dieses einen
  Tenants — Fehlzustellung plus Fremd-PII. Das ist heute nur deshalb harmlos, weil dieser eine
  Tenant der Eigentuemer selbst ist.
- **Kein einziger Test behauptet, `from_e164` sei die gesendete Nummer.** Die EL-Anrufstart-Tests
  pruefen genau drei Pflichtfelder (`test/elevenlabs-anrufstart.test.js:470-472`). Die Luecke
  ist unbewacht, nicht falsch bewacht — es gibt keinen roten Test, den ein Fix "gruen machen"
  muesste.

### 2.5 F4 — Drift-Erkennung

- Es gibt **nichts**: kein Boot-Check, kein periodischer Check, keine Pruefung vor dem Waehlen,
  die belegt, dass die konfigurierte Absendernummer dem Telnyx-Konto noch gehoert.
- Vorlage vorhanden: `scripts/check-elevenlabs-drift.mjs` (`npm run elevenlabs:drift`,
  `package.json:22`) — nur GET, fail-closed, Exit 1, Ausnahmen **sichtbar aber nicht
  blockierend** (`:51-63`, mit der ausdruecklichen Begruendung *"ein Waechter, den man
  ignoriert, ist keiner"*). Vergleicht aber **ausschliesslich Agenten-Felder**; `grep
  phone|number|ani|telnyx` in der Datei: 0 Treffer.
- **Mechanik-Gotchas (gemessen, Befund 5):** `GET /v2/connections/{id}` liefert `ani_override`
  **nicht** — nur `GET /v2/fqdn_connections/{id}` bzw. `/v2/credential_connections/{id}` haben
  den `outbound`-Block. Und `GET /v2/fqdns` liefert `connection_id` als JSON-**Zahl**, die in
  Node Praezision verliert (`3026479542865757000` statt `…757220`) -> Vergleich nur ueber
  String/BigInt.
- **Rate-Limits:** Telnyx `x-ratelimit-limit: 4;w=1` (4 req/s) auf `/v2/phone_numbers`, API-Aufrufe
  unberechnet. ElevenLabs sendet auf `/v1/convai/phone-numbers` keine Rate-Limit-Header. Der
  komplette Pruefsatz sind 6-8 Requests.

---

## 3. Entwurfsentscheidungen

> **Revisionsstand 2026-08-27 (nach Pre-Mortem, Clean-Code- und Skalen-Pruefung).** Die
> Pruefung hat fuenf Blocker gefunden, an denen der Umbau **selbst** einen groesseren Ausfall
> erzeugt haette als der, den er behebt (Trigger vs. Flush, DELETE-Zweig, erste Trigger-DDL im
> Repo, Buchungsanker-Reihenfolge, `e164 UNIQUE`), und einen strukturellen Einwand: der erste
> Entwurf schloss **einen Fall**, nicht **die Klasse**. Beides ist unten eingearbeitet. Wo eine
> Loesung heute nicht vollstaendig baubar ist, steht sie als **ZWISCHENSTUFE** mit benanntem
> Zielzustand; wo ein Risiko bleibt, steht es in **Abschnitt 8 (Bewusst akzeptierte Risiken)**.

### E-1 (WURZEL) — Die Plattform-Rolle wird ein erstklassiger, deklarierter Datensatz

**Entscheidung.** Es entsteht eine **globale Tabelle `platform_number_use`**, die haelt, welche
Rufnummern die PLATTFORM benutzt und wofuer. Nicht eine Spalte an `number`.

```
platform_number_use
  id                  TEXT PRIMARY KEY      -- Surrogatschluessel
  e164                TEXT NOT NULL         -- die Nummer selbst
  purpose             TEXT NOT NULL         -- 'outbound_ani' | 'alert_sms_sender'
  provider            TEXT NOT NULL
  tenant_id           TEXT                  -- NULL = Plattform-Asset ohne Tenant-Bezug;
                                            -- sonst: wem die DID gehoert (KEIN FK, s.u.)
  provider_number_id  TEXT
  bound_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  released_at         TIMESTAMPTZ           -- NULL = IN BENUTZUNG
  note                TEXT

  CREATE UNIQUE INDEX ... ON platform_number_use (e164, purpose) WHERE released_at IS NULL;
```

RLS ENABLE+FORCE mit **globaler** Policy (`USING (true) WITH CHECK (true)`), exakt das
Bestandsmuster `profile_global` (`schema.sql:866`), `platform_tts_usage_global` (`:871`),
`cost_cross_check_global`. JSON-Backend: gleiche Feldmenge unter `s.platformNumberUse`.

**Warum Surrogatschluessel statt `e164` als PK** (Korrektur gegenueber dem ersten Entwurf):
eine Nummer kann **mehr als eine Rolle** tragen (das Enum nennt schon zwei), und ein
Wiederbinden ueberschriebe sonst die Historie. Der Teilindex `(e164, purpose) WHERE released_at
IS NULL` erzwingt trotzdem: **je Nummer und Rolle hoechstens eine offene Bindung**. `tenant_id`
ist bewusst **kein Fremdschluessel** — die Plattform-ANI kann eine Nummer sein, die zu keinem
Tenant gehoert, und ein FK mit `ON DELETE CASCADE` waere genau der Weg, auf dem eine
Tenant-Loeschung die Bindung still mitnimmt.

**Warum nicht eine Spalte `number.role`?** Zwei Gruende, beide am Code belegt (der dritte Grund
des ersten Entwurfs war falsch, s. unten):
1. `number` ist strikt tenant-isoliert (`schema.sql:882-884`, FORCE RLS). Eine plattformweite
   Frage ("gehoert diese Nummer der Plattform?") waere nur unter dem GUC des zufaellig
   richtigen Tenants beantwortbar. Ein Riegel, der die Antwort nicht sehen kann, ist keiner.
2. Eine Rolle als Enum an `number` braeuchte einen Wert "beides" — und ein Enum mit "beides"
   ist die Rueckkehr genau des Zustands, der den Ausfall erzeugt hat (zwei Sachverhalte auf
   einem Label).

**GESTRICHEN, weil am Schema falsifiziert:** die urspruengliche Begruendung *"eine freigegebene
und neu gekaufte Nummer bekommt eine neue `number.id`, aber dieselbe `e164`"*. Das ist heute
**unmoeglich**: `number.e164` ist global UNIQUE (`schema.sql:646`) und `releaseNumber` leert die
`e164` nicht. Der Wiederkauf derselben Nummer scheitert an einer UNIQUE-Verletzung.
**Konsequenz, in E1 mitgeloest:** `releaseNumber` setzt zusaetzlich `e164 = NULL` (die Historie
Nummer<->Tenant liegt ohnehin in `number_assignment`, `schema.sql:672-680`). Ohne diesen Schritt
ist "wir holen die alte Nummer zurueck" kein verfuegbarer Wiederherstellungsweg —
das gehoert vor E0 entschieden (**offene Frage F-9**).

**Nachschlagen: heute linear, spaeter indiziert (benannte Zwischenstufe).** Der Store hydriert
beim Boot alle Zeilen in den Speicher (`pg.js:1092`, `:1131-1185`); `platformNumberInUse(s, e164)`
ist damit ein linearer Scan ueber ein Array. Bei einer Handvoll Bindungen ist das richtig und
einfach. Im Zielzustand (N Bindungen, je Tenant-DID eine) ist die Frage *"hat diese e164 eine
offene Bindung?"* ein einzelner Index-Treffer und gehoert als Query in die DB — sonst erbt der
Riegel die Speicher-Decke des Stores, statt sie zu umgehen. Das ist eine Zwischenstufe, kein
Endzustand (s. Abschnitt 8, BA-13).

**Wer schreibt die Bindung?** Eine Registry, die jemand von Hand pflegen muss, ist leer,
sobald es darauf ankommt — und eine leere Registry sieht aus wie eine gruene (Repo-Lehre
*"Pruefkommando ohne Positiv-Kontrolle"*). Deshalb **werden die Bindungen beim Boot abgeleitet,
store-lokal, ohne Provider-IO** — und zwar **ZWEI**, nicht eine:

| Rolle | Quelle der Ableitung | Warum |
|---|---|---|
| `outbound_ani` | neue Env **`PLATFORM_ANI_E164`** | die Absendernummer des Produkt-Outbounds; steht heute nur in zwei Anbieter-Konfigurationen, die kein Produktivcode kennt |
| `alert_sms_sender` | `findActiveNumber(store, BOOTSTRAP_TENANT_ID)` (`alert-sms.js:36-41`) | **der Alarm-Absender haengt an genau demselben Mechanismus, der am 24.08. versagt hat.** Er wird zur Laufzeit dynamisch gewaehlt; gibt derselbe Erase-/Kuendigungsweg diese DID frei, ist der Alarmkanal tot — und zwar STILL (`resolveBootstrapAlertSender` schreibt eine WARN-Zeile und liefert `null`) |

Die zweite Bindung ist kein Beiwerk: **ohne sie schliesst der Plan einen Fall und laesst die
Klasse offen.** Der Waechter (E-6) bekommt entsprechend eine Pruefung "Alarm-Absender
kontoeigen und aktiv".

**Leer = keine Bindung**, und der Boot-Guard sagt das laut. **Abstufung, gegenueber dem ersten
Entwurf korrigiert:** der Befund ist **NICHT fatal**, sondern begrenzt seine Wirkung auf den
Outbound-Zweig (fehlende Bindung -> EL-Outbound waehlt nicht, Inbound laeuft weiter).
Begruendung: die Live-Env ist **dashboard-verwaltet** (`render.yaml:17` sagt es selbst;
Repo-Lehre `subscription-checkout-money-path`), `ELEVENLABS_OUTBOUND_ENABLED` ist live `true`,
und `PLATFORM_ANI_E164` waere nach dem Merge zunaechst leer. Ein `fatal:true` haette den Dienst
**nicht mehr booten** lassen — und damit auch den Inbound getoetet, der vom Ausfall gar nicht
betroffen war. Das Repo hat dieselbe Abwaegung schon einmal getroffen und genauso entschieden
(`src/boot-guard.js`: *"ein Boot-Refusal tauschte ein Kostenproblem gegen einen
Telefonie-Totalausfall"*). **Zusaetzlich, als harte Vorbedingung im Runbook:**
`PLATFORM_ANI_E164` wird im Render-Dashboard gesetzt, **bevor** E1 deployt wird.

#### Reichweite des Riegels — was er deckt und was er NICHT decken kann

Der Auftrag sagt "freigegeben **oder umgewidmet**". Diese zwei Haelften haben verschiedene
Zustaendige, und das Dokument sagt das ausdruecklich, statt eine Absolutheit zu behaupten, die
der Code nicht einloest:

| Weg | Beispiel | Gedeckt von |
|---|---|---|
| Freigabe/Umwidmung **in unserem Store** | Erase, Kuendigung, Grace-Reconcile, Aufraeumen, manueller DB-Eingriff, `status='suspended'` | **RIEGEL** (E1, drei Ebenen) — strukturell, im Code und in der DB erzwungen |
| Umwidmung **beim Anbieter** | `PATCH /v2/phone_numbers/{id} {connection_id}`, `ani_override` von Hand geaendert, `DELETE /v1/convai/phone-numbers/{id}`, Trunk neu zugewiesen | **WAECHTER** (E-6) — nur **nachtraeglich erkennbar**, nie verhinderbar |

**"Strukturell unmoeglich" gilt fuer die erste Zeile.** Fuer die zweite kann es keinen Riegel
geben — wir kontrollieren das Anbieter-Portal nicht. Was dagegen gebaut wird: **EIN
Provider-Schreibweg** fuer Nummern (Kauf/Konfiguration/Freigabe) prueft vor jedem Schreibzugriff
die Bindung; alles, was am Portal vorbei passiert, faellt dem Waechter zu. Das steht so in
Abschnitt 8.

**SUSPENDED gehoert in den Riegel.** Eine suspendierte Nummer routet genauso wenig wie eine
freigegebene. Das Praedikat blockiert deshalb **jeden** Uebergang einer gebundenen Nummer nach
`released` **oder** `suspended`.

#### Wo wird die Freigabe unmoeglich? Drei Ebenen, absichtlich

| Ebene | Ort | Deckt |
|---|---|---|
| A — der EINE Engpass | `releaseNumber` (`state-ops.js:2466`) und `transitionNumber` nach `SUSPENDED` **werfen**, wenn die `e164` eine offene Bindung hat | JEDEN Code-Pfad, heute und kuenftig — `releaseNumber` ist nachweislich die einzige Mutation nach `released` |
| B — vor dem irreversiblen Schritt | `numberReleaseVerdict` (`:2582`) und `tenantNumbersForErase` (`:2621`) liefern **HOLD** mit `reason='platform_number_in_use'` | verhindert, dass der **Provider-DELETE** (der VOR der Store-Mutation laeuft, `release-reconcile.js:61`) ueberhaupt startet |
| C — Backstop unter dem Code | pg-Trigger auf `number`, **eng gefasst** (exakte Form unten) | manuelle DB-Eingriffe und jeden kuenftigen Schreibweg, der `state-ops` umgeht |

**Warum genau diese Ebenen reichen — und warum eine allein nicht reicht.** Es GIBT einen
Engpass (A, am Code bewiesen), aber der Engpass sitzt hinter dem irreversiblen Provider-DELETE
(deshalb B) und er gilt nur fuer Code, der durch unseren Store geht (deshalb C). Ein reiner
Fremdschluessel taugt nicht: unsere Freigabe **loescht keine Zeile**, sie setzt
`status='released'` — ein FK sieht das nicht.

#### Ebene B ist ein VERDIKT, kein Filter (Korrektur, sonst verfaellt der Auftrag still)

Der erste Entwurf wollte `tenantNumbersForErase` die gebundene Nummer **herausfiltern**. Das
waere schlechter als der Ist-Zustand, am Code belegt: `releaseTenantNumbersOnErase`
(`release-reconcile.js:144-156`) zaehlt `aborted` nur fuer tatsaechlich **verarbeitete**
Kandidaten. Eine herausgefilterte Nummer ist kein Kandidat -> `released=0, aborted=0` ->
`contract-end-cleanup.js:93` setzt `numberReleasePending=false` -> `setContractEndCleanupPending`
(`:108`) markiert die Kuendigung als erledigt -> **der Retry-Sweep findet den Tenant nie
wieder.** Der Freigabeauftrag verfiele still. Ausserdem kann `tenantNumbersForErase` gar keine
Audit-Zeile schreiben: es ist ausdruecklich REIN + IO-frei (`state-ops.js:2612-2620`).

**Deshalb, verbindlich:** `tenantNumbersForErase` liefert — wie `classifyNumbersForRelease`
(`state-ops.js:2600-2610`) es bereits vormacht — **disjunkte Koerbe**
`{release:[…], hold:[{number, reason}]}`. Der **Orchestrator** zaehlt jeden HOLD als `aborted`
und schreibt die **bestehende** Audit-Aktion `AUDIT_ACTION.ABORTED`
(`release-reconcile.js:30/65/103`) mit `grund=platform_number_in_use`. Damit bleibt
`numberReleasePending=true`, der 6-h-Sweep nimmt den Tenant wieder auf, und die haengende
Freigabe ist **laut**, nicht still.

**Und weil "laut" ohne Empfaenger nichts ist:** ein HOLD mit Grund `platform_number_in_use`,
der **laenger als 24 h** besteht, ist selbst ein Betreiber-Befund und geht ueber denselben
Meldeweg wie der Ausfall-Alarm (E-4). Sonst wiederholt sich an dieser Stelle exakt die Krankheit
des Ausgangsbefunds: ein Zustand, der tagelang still kaputt ist.

#### Ebene C — die exakte Trigger-Form (die drei Blocker der Pruefung)

Die Pruefung hat hier drei Wege gefunden, auf denen der Umbau selbst einen groesseren Ausfall
erzeugt als der behobene. Die Gegenmittel sind **Teil des Entwurfs, nicht Umsetzungsdetail**:

**(1) Der Trigger gatet auf den ZUSTANDSUEBERGANG, nicht auf den Zeilenzustand.**

```sql
DROP TRIGGER IF EXISTS number_platform_binding_guard ON number;
CREATE OR REPLACE FUNCTION number_platform_binding_guard() RETURNS trigger AS $$ ... $$
  LANGUAGE plpgsql;
CREATE TRIGGER number_platform_binding_guard
  BEFORE UPDATE OF status ON number
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
        AND NEW.status IN ('released','suspended'))
  EXECUTE FUNCTION number_platform_binding_guard();
```

**Warum die `WHEN`-Klausel nicht optional ist:** `flushNumbers` (`pg.js:2103-2130`) upsertet bei
**jedem** `save()` per `ON CONFLICT (id) DO UPDATE` — also ein `UPDATE` auf jede Zeile, bei
jedem Speichern. Ohne Uebergangs-Bedingung feuert der Trigger auf einer bereits `released`-en
gebundenen Zeile (**das ist der heutige Live-Zustand**: `PLATFORM_ANI_E164` zeigt zunaechst auf
eine Nummer, deren `number`-Zeile seit dem 24.08. `released` ist), `flush()` (`pg.js:1499-1522`)
faengt, ROLLBACK, throw — **ab da persistiert der Dienst gar nichts mehr, fuer alle Tenants**.

**(2) KEIN `BEFORE DELETE`-Zweig mit `RAISE EXCEPTION`.** `flushOwnScoped` prunt vor jedem
Insert-Loop (`deleteMissing`, `pg.js:2233-2247`; bei leerer keep-Liste
`DELETE FROM number WHERE tenant_id=$1`). Verliert der In-Memory-Spiegel die gebundene Zeile —
Teil-Hydrierung, Overlap-Prozess beim Free-Tier-Aufwachen — wuerde ein werfender DELETE-Trigger
aus einer Spiegel-Divergenz einen **Totalausfall des Schreibpfads** machen. Der DELETE-Fall wird
stattdessen als `RAISE WARNING` + Audit-Zeile gefuehrt, und die Cascade-Klasse deckt Ebene A+B.
Zusatzbeleg: es gibt heute nachweislich **kein** `DELETE FROM tenant` im Repo — die
Cascade-Begruendung war hypothetisch, das Flush-Risiko ist real.

**(3) DDL-Form: `DROP TRIGGER IF EXISTS` + `CREATE OR REPLACE FUNCTION`.** Das waere die
**erste Trigger-/plpgsql-DDL im Repo** (`grep` = 0 Treffer), und `migrate.applySchema`
(`src/db/migrate.js:20-23`) fahrt die ganze Datei bei **jedem** Prozessstart aus. Ein blankes
`CREATE TRIGGER` schluege beim zweiten Boot fehl -> Migration wirft -> Boot bricht ab -> beim
naechsten Free-Tier-Aufwachen ist der Dienst tot. Der vorhandene Idempotenz-Waechter ist
`test/rls-with-check.test.js:135` (ruft `applySchema` **zweimal**) und wird Abnahmepunkt.
**Vorbedingung von E1:** PGlite-Kompatibilitaet der plpgsql-/Dollar-Quoting-Form vorab belegen,
sonst faellt die halbe pg-Testbank aus.

#### Unbind-Protokoll (ohne das blockiert der eigene Zielzustand jede Kuendigung)

Im Zielzustand (je Tenant-DID eine eigene Absendernummer, E-5) haelt **jede** DID eine offene
Bindung. Ein Riegel ohne Gegenstueck liesse dann **jede** legitime Kuendigung werfen: bei 1.000
Tenants und 5 % Monatsabwanderung ~50 blockierte Freigaben/Monat, bei 1.000.000 Tenants
~1.700/Tag. Deshalb gehoert das Unbind **in denselben Entwurf**, nicht in eine spaetere Etappe:

- **Praedikat geschaerft:** HOLD nur, wenn die offene Bindung **NICHT** dem freigebenden Tenant
  mit einem tenant-eigenen Zweck gehoert. Eine Tenant-DID, die nur die ANI **dieses** Tenants
  ist, darf mit ihm gehen; die geteilte Plattform-ANI nicht.
- **Geordnete Kette bei legitimer Freigabe**, jeder Schritt idempotent und wiederaufnehmbar
  ueber den bestehenden `numberReleasePending`-Sweep:
  `EL-Registrierung loeschen (DELETE /v1/convai/phone-numbers/{id})` ->
  `ani_override raeumen (nur wenn er auf diese Nummer zeigt)` -> `unbindPlatformNumber` ->
  `Provider-DELETE` -> `status='released'` + `e164=NULL`.
- `unbindPlatformNumber` hat damit einen **definierten Aufrufer** und eine Stelle im
  Lebenszyklus — im ersten Entwurf war es ein Mutator ohne Aufrufer, ohne Test, ohne Protokoll.

**Zweite Invariante im selben Praedikat: kein Release waehrend eines laufenden Anrufs.**
`performNumberRelease` prueft `s.calls` heute nicht. Das Verdikt bekommt einen zweiten
HOLD-Grund `active_call_on_number` (Nummer ist `from` oder `to` eines Calls mit
`status='active'`). HOLD, nicht Block: der Retry-Sweep existiert bereits.

**Preis, bewusst akzeptiert.** Ein Tenant, dessen DID zugleich **geteilte** Plattform-ANI ist,
kann seine Nummer nicht per Loeschung freigeben — die Freigabe haengt, bis der Betreiber die
Bindung loest. Das ist die gewollte Richtung: lieber eine haengende Freigabe mit lautem
Audit-Eintrag und 24-h-Eskalation als ein Produkt-Totalausfall. **Fuer die DSGVO ist das
unkritisch, und das ist wichtiger als es klingt:** `eraseTenantData` (`state-ops.js:487-513`)
loescht Calls/ActionItems/Notifications/Privatnummer und faesst `s.numbers` ohnehin nie an — die
**personenbezogenen** Daten verschwinden vollstaendig, Artikel 17 ist erfuellt. Offen bleibt
ausschliesslich die **Rueckgabe der Rufnummer** an den Anbieter, also eine Kosten- und
Betriebsfrage, keine Betroffenenrechts-Frage. Und der Zielzustand (eigene Plattform-DID, E-5)
beendet den Doppelrollen-Fall ohnehin.

### E-2 (F1) — EIN Fehlervokabular, drei neue Basis-Klassen, getrennt nach SCHULD

**Entscheidung.** Kein neues Feld, kein zweiter Kanal. Es bleibt bei `call.failureReason` +
`src/telephony/failure-reason.js` + `src/i18n/failure-reason-texts.js` + den drei bestehenden
Lesern. Es kommen **drei Basis-Token** dazu und **vier Schreibstellen**.

**Neue Basis-Token** (heute nicht ausdrueckbar). Der erste Entwurf hatte zwei; die Pruefung hat
gezeigt, dass `not-placed` sonst **zwei Sachverhalte auf einem Label** traegt — genau der
Fehler, den F1 abstellen soll, nur eine Ebene hoeher:

| Token | Bedeutung | Schuld | Zaehlt in den Ausfall-Alarm? |
|---|---|---|---|
| `not-placed` | Der Anruf kam nie zustande, weil **unsere Konfiguration oder der Anbieter** ihn abgelehnt hat: 401/403/422, Guthaben, ANI, Trunk. | wir / der Anbieter | **JA** |
| `unreachable` | Der Anruf kam nie zustande, weil **das Ziel** nicht erreichbar ist: SIP 404 (Nummer existiert nicht), 480, 603, gesperrt. | der Angerufene / der Nutzer | **NEIN** |
| `result-unknown` | Der Anruf lief moeglicherweise, aber der Anbieter hat uns sein Ergebnis nicht geliefert (Poll-Zeitgrenze, dauerhafter Abruffehler, 5xx/Timeout beim Start). | der Anbieter, voruebergehend | **NEIN** |

Warum die Trennung **notwendig** und nicht kosmetisch ist, zweifach belegt:
1. **Der Nutzertext loest auf dem BASIS-Token auf.** `makeStatusBody` -> `failureReasonBase`
   (`src/i18n/failure-reason-texts.js:63-78`). Ohne Trennung bekaemen der Tippfehler des
   Nutzers (404/D11) und unser Konfigurationsdefekt (403/D51) **denselben Satz**. Bei Skala ist
   der 404-Fall der mit Abstand haeufigste — Millionen Nutzer bekaemen dauerhaft die falsche
   Erklaerung fuer ihren eigenen Tippfehler. Das verletzt den Auftrag F2(a) woertlich
   ("in einer Sprache, die er versteht" heisst auch: die richtige Aussage).
2. **Der Alarm zaehlt genau eine Klasse.** Ohne Trennung waere `not-placed` ein Sammelbecken,
   und jeder Anbieter-5xx-Sturm oder jede Serie falsch gewaehlter Nummern wuerde alarmieren.
   Nach dem dritten Fehlalarm filtert der Empfaenger die Mail weg; der vierte ist der echte.

**Zuordnungsregel, verbindlich** (das Vokabular hat die Token, die Zuordnung fehlte):

| Beobachtung | Token |
|---|---|
| HTTP-Ablehnung des Anrufstarts, **4xx** (401/403/422 …) | `not-placed:start-<code>` |
| HTTP-Fehlschlag des Anrufstarts, **5xx / Timeout / Netzfehler** | `result-unknown:start-<code>` |
| SIP-Ablehnung nach erfolgreichem Start, **403 / 401 / 407 / 5xx-SIP** | `not-placed:invite-<code>[-<carrier>]` |
| SIP-Ablehnung, **404 / 480 / 486 / 603** (Ziel) | `unreachable:invite-<code>[-<carrier>]` |
| Anbieterfehler ohne erkennbaren SIP-Status | `result-unknown:provider-<code>` |
| Poll-Zeitgrenze / dauerhafter Abruffehler | `result-unknown:poll-timeout` / `result-unknown:poll-provider-<status>` |

Bestand unveraendert: `no-answer`, `busy`, `canceled`, `failed`, `max-duration-cap`,
`budget-exhausted`.

Der 27.08.-Fall ergibt damit exakt **`not-placed:invite-403-D51`**; die 15.08.-Bestandsfixture
(SIP 404, D11) ergibt **`unreachable:invite-404-D11`**.

**Detail-Segment, PII-frei by construction.** Form `<basis>:<quelle>-<code>[-<carrier>]`, gebaut
aus einer **strengen Whitelist**, nie aus Anbieter-Rohtext:
- `quelle` in `start` | `invite` | `provider` | `poll`.
- `code` = die Zahl. Bei `invite` aus `reason` per `/sip status:\s*(\d{3})/`; sonst
  `error.code` bzw. `err.providerStatus`.
- `carrier` = **nur** wenn `/\bD\d{2}\b/` in `reason` trifft (`D51`, `D11`).

**Der Rohtext `reason` wird NICHT gespeichert und NICHT geloggt.** Er ist Anbieter-Freitext und
kann grundsaetzlich Rufnummern tragen (*"Invalid destination number …"*). Die Regex-Whitelist
ist dasselbe Sicherheitsniveau wie `safeCauseToken`
(`src/telephony/adapters/telnyx/webhook-events.js:30-34`). Wer den Volltext braucht, holt ihn
per Anbieter-Abfrage ueber die bereits gespeicherte Gespraechs-Kennung — Forensik auf Anfrage
statt Dauer-Speicherung von Fremdtext.

**Warum `error_type` nicht die Grundlage ist:** es steht nicht in der veroeffentlichten OpenAPI
(1.1(1)), ist also keine Zusicherung. Klassifiziert wird auf `code` (required) und auf den aus
`reason` gezogenen SIP-Status. `error_type` darf hoechstens die `quelle` praezisieren.

**Die Menge der Basis-Token ist EINE exportierte Quelle.** `failure-reason.js` exportiert
`FAILURE_REASON_BASE_TOKENS` (alle Basis-Token, Bestand + neu). Grund: der zitierte
Vollstaendigkeits-Waechter `test/gq-p15-failure-reason-notification.test.js:73-85` erzeugt seine
`baseTokens` heute aus einem **hartkodierten** `lifecycleEvents`-Array plus zwei Konstanten —
Token aus neuen Erzeugern taucht dort **nie** auf. Der erste Entwurf behauptete, dieser Test
falle "von selbst rot, bis die Phrasen existieren". **Das ist am Test falsifiziert: er bliebe
gruen**, die neuen Token faenden keine Phrase, und der Nutzer bekaeme wieder
`"<Ziel> (Status: failed)"` — also genau F2, das die Etappe beheben soll. Der Test iteriert
kuenftig ueber die exportierte Menge; ein neues Basis-Token ohne Phrase macht ihn rot
(Negativ-Probe im Test selbst). Zu beachten: derselbe Test verlangt **paarweise verschiedene**
Phrasen ueber de/fr/en (`:96-99`) — identische EN/FR-Formulierungen machen ihn rot.

**Die vier Schreibstellen — mit verbindlicher Reihenfolge:**

1. `src/elevenlabs/outbound.js#finishFromConversation` (`:1221`) — aus
   `conversation.metadata.error`.
2. `src/routes/api-calls.js:392-401` (`catch`) — aus `err.providerStatus`. **Deckt alle drei
   Engines**, weil der `catch` alle drei Zweige umschliesst (`:331/351/366`). Damit bekommt auch
   eine Telnyx-Start-403 auf dem TeXML-Weg erstmals einen Grund. **REIHENFOLGE, INVARIANTE:
   `recordFailureReason` laeuft als ERSTE Anweisung im `catch`, VOR `terminateAndBillCall`.**
   Begruendung am Code: `terminateAndBillCall` fahrt `persistEnd` (`store.endCallRecord`) und
   dann `bill` -> `finishCall`, und `finishCall` liest `call.failureReason` beim
   Notification-Bau (`call-finish.js:203-217`). Steht der Grund noch nicht am Datensatz, bleibt
   der Nutzertext `"<Ziel> (Status: failed)"` und das Melder-Ereignis traegt keinen Code — der
   neue Weg waere genau an der Stelle stumm, fuer die er gebaut wurde. Der Bestand dokumentiert
   diese Abhaengigkeit bereits (`call-finish.js:201-207`: */voice/status ruft
   recordFailureReason VOR terminateAndBillCall*).
3. `finishExpiredPoll` (`:1011`) und `finishOnPermanentError` (`:1027`) — `result-unknown:*`.
4. `answeredAnchorOutcome` (`:427-440`) — **exakter Einfuegepunkt, WOERTLICH:**
   der `durationUsable`-Zweig bleibt der **ERSTE** und bleibt **unangetastet**; der
   `PROVIDER_IN_PROGRESS`-Zweig bleibt der zweite; die neue Fehler-Frage sitzt **ausschliesslich
   zwischen dem `PROVIDER_IN_PROGRESS`-Zweig und `durationSecs === 0`**. Neuer Grund
   `provider_rejected_before_answer` im bestehenden `answeredUnclearReason`-Feld.

**Warum diese Reihenfolge ein GELD-Thema ist (Blocker der Pruefung).** Der erste Entwurf sagte
nur "die Fehler-Frage kommt VOR der Dauer-0-Frage". Zieht ein Umsetzer sie an den Anfang der
Funktion, liefert **jede** Konversation mit `metadata.error != null` einen `clearAnchor` — auch
die, die 90 Sekunden lief und am Ende einen Anbieterfehler meldete. Folge: `answeredAt=null` ->
`voiceMinutesOf` bucht 0 -> **wir zahlen den Carrier und kassieren nichts**, der Kunde bekommt
eine Fehlschlag-Meldung fuer ein gefuehrtes Gespraech. Der Bestand markiert die Stelle
ausdruecklich als bindend (`outbound.js:436-437`: *"Reihenfolge bindend: ERST fragen, ob das
Gespraech ueberhaupt schon vorbei ist"*).

**Kostenbuchung: nachweislich unveraendert.** Der abgelehnte Anruf laeuft heute schon in
`clearAnchor(...)` -> `trueUpAnsweredAt(callId, null)` -> `answeredAt = null` ->
`voiceMinutesOf` bucht 0. Der Fix aendert **nur das Label**. Das wird per Test festgenagelt —
und der Test bekommt gegenueber dem ersten Entwurf einen **dritten Pflichtfall**:
`metadata.error != null` **UND** `call_duration_secs = 42` -> Anker bleibt, gebuchte Minuten
unveraendert, `failureReason` bleibt `null`. Ohne diesen Fall beweist der Test die
Geld-Neutralitaet nicht (er kannte nur die Dauer-0-Fixture).

**`endStatusOf` bleibt.** Unser Call-Status bleibt `failed`; ein neuer Status waere ein Bruch
des `mapStatus`-Vertrags (`src/mcp-tools.js:132-135`), des Widgets und des Dashboards, und er
loeste das Problem nicht: auch heute traegt "niemand hat abgenommen" den Status `failed`. **Der
Grund ist der Unterscheider, nicht der Status.**

**Nicht abgedeckt, benannt:** `src/bridge.js:157` (Realtime-Bridge) ruft kein
`recordFailureReason`. Bleibt bewusst offen: auf diesem Weg liegt uns gar keine
Anbieter-Ursache vor, und die Start-Ablehnung ist ueber Schreibstelle 2 gedeckt. Ein erfundener
Token waere schlechter als keiner. `VOICE_ENGINE=realtime` ist nicht live.

### E-3 (F2a) — Der Nutzer erfaehrt es dort, wo er den Auftrag gegeben hat

**Entscheidung.** Single Source of Truth ist und bleibt `call.failureReason`. Es entsteht **kein
neuer Kanal**; die drei bestehenden werden ehrlich gemacht:

1. **MCP-Rueckweg** (der Weg, ueber den der Anruf ausgeloest wurde): `AWAIT_EVENT_OUTPUT` und
   `awaitEventView` (`src/mcp-tools.js:216-239`) bekommen **`status` und `failure_reason`**
   (additiv, kein Bruch). Begruendung: die Server-Instruktionen schicken das Modell in die
   `await_call_event`-Schleife, nicht zu `get_call_status` — ein Fehlerkanal, den das Modell
   laut Anleitung nie aufruft, ist keiner. **Beide Sichten nutzen denselben kleinen Erzeuger**
   (`pickCallStatus`, `:150-163`, inklusive `mapStatus` und der bewussten `?? null`-Regel), nach
   dem Muster `RESULT_CARD_OUTPUT`/`resultCardView` — nicht zwei handgebaute Stellen, die
   dieselbe Aussage formen.
2. **Der irrefuehrende Platzhalter** (`pickTranscript:187-189`) darf bei einem terminalen Call
   mit Grund nicht mehr zum Weiterwarten auffordern. **Eng gefasst:** der neue Text greift
   **NUR** bei `status === 'failed'` **UND** `failureReason != null`; alle anderen Faelle
   bleiben **byte-identisch** (Test pinnt beide Richtungen). Grund: `pickTranscript` ist die
   gemeinsame Whitelist von `get_transcript` **und** `awaitEventView` (`:229`) — ein pauschaler
   Austausch aenderte auch jeden terminalen Bestands-Call ohne Grund (und das sind **alle**
   EL-Calls vor E2, deren `failure_reason` strukturell NULL ist). Der Grund-Satz kommt aus
   **derselben** `FAILURE_REASON_TEXTS`-Quelle wie die Notification (G5).
3. **Der Notification-Feed wird gerendert.** Reine Frontend-Luecke: der Feed liegt bereits in
   beiden State-Antworten, `apps/web` liest ihn nur nicht. Kein Server-Bau.
4. **Die MCP-Server-Instruktionen bekommen einen Satz zu `not-placed`** ("nicht wiederholen,
   dem Nutzer sagen, was kaputt ist"). Ohne ihn sieht der Assistent ab E3a ein Token wie
   `not-placed:invite-403-D51`, weiss nichts damit anzufangen und probiert es erfahrungsgemaess
   noch dreimal — **jedes Mal mit echten Anbieterkosten**. Die Instruktionsdatei fehlte in der
   Dateiliste des ersten Entwurfs.

**SMS/Mail bei jedem gescheiterten Anruf: NEIN — mit einer eng gefassten Ausnahme.** Bei
Millionen Nutzern ist ein dauerhaft unerreichbares Ziel ein Dauer-SMS-Generator (Kosten,
Abuse-Flaeche, Spam-Reputation). Fuer die Klassen `unreachable` und `no-answer` ist der
Zielzustand deshalb: der Nutzer erreicht die Information dort, wo er ohnehin ist.
**Ausnahme, gegenueber dem ersten Entwurf ergaenzt:** fuer die **`not-placed`-Klasse** (Schuld
liegt bei uns) geht **genau eine Mail** an den Auftraggeber. Begruendung: diese Klasse ist per
Definition selten, durch die Ausfall-Entprellung gedeckelt, und das Spam-/Kosten-/Abuse-Argument
traegt fuer sie nicht. Ein Nutzer, der nach dem Auftrag nicht in den MCP-Client zurueckkehrt,
erfuehre sonst **ueberhaupt nie**, dass sein Auftrag an *unserem* Defekt gescheitert ist — und
genau das ist der Anlassfall.

**Sprache.** Die Grund-Phrasen kommen aus `FAILURE_REASON_TEXTS` (de/fr/en), aufgeloest ueber
die bestehende Locale-Praezedenz. Der Nutzer bekommt seinen Grund in seiner Sprache; der
Assistent bekommt zusaetzlich das maschinenlesbare Token.

### E-4 (F2b) — Systematischer Ausfall: zwei unabhaengige Melder, ein durabler Zustand

Der Auftrag verlangt Erkennung **auch dann, wenn gar keine Anrufe mehr stattfinden**. Ein
einzelner Melder kann das nicht. Deshalb zwei, die sich gegenseitig nicht brauchen.

**Melder 1 — ereignisgetrieben, aus unseren eigenen Daten.** Sitzt in `finishCall`
(`src/telephony/call-finish.js`), das JEDER beendete Anruf passiert. Kein Timer, kein
Provider-IO.

**Der Zustand liegt in der DB, nicht im Prozessspeicher (Korrektur).** Der erste Entwurf nannte
`claimPlatformSpendWarning` (`state-ops.js:3974`) als Muster fuer den Fenster-/Entprellzustand.
Das ist am Bestand falsifiziert: `pg.js:561-565` sagt woertlich, dass dieser Marker
*"von flush() NIE geschrieben"* und damit *"strukturell ephemer"* ist. Auf `plan: free` faellt
das Fenster bei jedem Schlaf auf 0 (N wird nie erreicht — **stumm**, das schlimmere Versagen
nach der eigenen Regel *"Zu laut ist erlaubt, stumm nie"*), und der Entprell-Marker verschwindet
ebenfalls, sodass ein anhaltender Ausfall bei **jedem** Aufwachen erneut alarmiert (PM-3 tritt
trotz Entprellung ein). Deshalb:

- **Das Fenster wird NICHT zweitgebucht, sondern aus den bereits persistenten `call`-Zeilen
  abgeleitet** (`status`, `failure_reason`, `ended_at`, `tenant_id` liegen alle dort) — eine
  reine, zeit-injizierte Abfrage statt einer zweiten Buchfuehrung (G5).
- **Nur der Zustands-/Entprell-Marker braucht Durabilitaet** und bekommt eine persistierte
  globale Zeile (bzw. eine `audit_store`-Zeile), ausdruecklich **nicht** den
  Notification-Ringpuffer (`state-ops.js:4220` schneidet auf `MAX_NOTIFICATIONS`) und
  ausdruecklich **nicht** das `claimPlatformSpendWarning`-Muster.
- Die Zusage "unabhaengig vom Free-Tier-Schlaf" gilt damit fuer den ganzen Melder, nicht nur fuer
  seinen Ausloeser.

**Erkennungsregel — drei Klauseln, fuer zwei Verkehrs-Regime.** Der erste Entwurf hatte eine
Zwei-Klausel-Regel, die in **beiden** Regimen das Falsche tut: Klausel "0 Erfolge" feuert bei
Skala nie, Klausel ">=2 Tenants" feuert bei Skala dauernd. Gezaehlt wird ausschliesslich die
**`not-placed`**-Klasse (Schuld bei uns/dem Anbieter; `unreachable` und `no-answer` sind
normaler Betrieb).

```
K0 (immer, volumenunabhaengig, KOSTENLOS):
    Der ERSTE Befund einer not-placed-Codeklasse, die im Vorfenster nicht auftrat
    -> WARN + Audit-Zeile. Kein SMS, keine Mail.

K1 (kleines Volumen — der Ist-Zustand):
    anzahl(code) >= N (Default 3) im Fenster W (Default 60 min)
    UND anzahl(erfolgreiche Outbound-Anrufe im Fenster) == 0
    -> Alarm ueber alle Kanaele.

K2 (Skala — greift, sobald ein Nenner da ist):
    versuche(Fenster) >= M (Default 20)
    UND anteil(not-placed) / versuche >= p (Default 20 %)
    -> Alarm ueber alle Kanaele, dimensioniert nach (Land | Route | ANI).
```

Warum **K0** unverzichtbar ist, obwohl es der schwaechste Melder ist: der Ist-Verkehr dieses
Produkts ist **ein Anruf pro Woche** (letzter Erfolg 20.08., naechster Versuch 27.08.). Am
27.08. gab es nur deshalb vier Versuche, weil der Eigentuemer viermal probierte. Der
wahrscheinlichere Verlauf desselben Ausfalls ist: **ein** Nutzer ruft **einmal** an und gibt
auf — `N=1 < 3`, kein Alarm. K1 haette die wahrscheinlichere Variante des Ausfalls **nicht**
gefangen. K0 kostet nichts und faengt sie.

Warum **K2** unverzichtbar ist: bei 1.000.000 Tenants und ~1 Outbound/Tenant/Woche sind das
~8.300 Anrufe/h. Bei 1-3 % ziel-verschuldeter Ablehnungen laegen 80-250 Ereignisse/h in den
Eimern — die alte Klausel ">=3 im Fenster UND >=2 Tenants" waere **immer** erfuellt und
erzeugte bei ~10 Code-Eimern und 6 h Entprellung rund **40 Alarme/Tag reines Rauschen**. Ein
Anteil mit Mindestnenner kippt nicht mit dem Volumen. Die Schuld-Trennung aus E-2 ist die
Vorbedingung dafuer, dass der Anteil ueberhaupt etwas aussagt.

Ein einzelner Tenant, der immer wieder dieselbe unerreichbare Nummer waehlt, loest **keine** der
drei Klauseln aus: sein Grund ist `unreachable`, nicht `not-placed`.

**Daempfung.** Zustandsmaschine pro Code, nicht Zaehlerspam: EIN Alarm beim Uebergang
`gesund -> kaputt`, EINE Audit-Zeile beim Uebergang zurueck (damit Stille eindeutig ist), und
eine Mindest-Wiederholfrist (`OUTAGE_ALERT_DEBOUNCE_MS`, Default 6 h), falls der Zustand
bestehen bleibt. Bauform: `shouldEmitFinding`/`emitFinding` (`cost-truing.js:364-380`).

**Melder 2 — konfigurationsgetrieben (der Drift-Waechter, E-6).** Antwortet auf "es ruft niemand
an": er prueft die Konfiguration, nicht den Verkehr. Er haette den 27.08.-Ausfall am 24.08.
gefunden, drei Tage frueh.

#### Meldeweg und Alarm-Body

Reihenfolge ist Teil des Vertrags, weil der SMS-Kanal selbst betroffen sein kann:

1. **WARN-Log** (immer, kostenlos, im Render-Log sichtbar),
2. **`audit_store`-Zeile** (durabel, PII-frei, ueberlebt den Prozess),
3. **Alarm-Mail** ueber `src/mail/ports.js#sendMail` an eine neue `PLATFORM_ALERT_MAIL_TO` —
   **der von unserer Telefonie unabhaengige Kanal, und deshalb der PRIMAERE**,
4. **Alarm-SMS** ueber `sendBootstrapAlertSms` (fail-soft, existiert, `alert-sms.js:67`).

Die Vertauschung gegenueber dem ersten Entwurf ist die eigentliche Lehre des Ausfalls: der
einzige Betreiber-Alarm laeuft heute ueber dasselbe Telnyx-Konto und dieselbe Nummern-Tabelle
wie der ausgefallene Outbound. Bei `credit_limit 0.00` reisst schon das Guthaben-Ende den
SMS-Kanal mit. **Ein Alarm, den derselbe Defekt mitreisst, ist keiner.**

**Body-Vertrag, verbindlich und PII-frei:** ausschliesslich **Fehlerklassen-Token, Zaehler,
Fensterlaenge, ANZAHL betroffener Tenants**. **Keine E.164, keine Tenant-ID, keine Call-ID.**
Grund: beim ersten echten Einsatz fehlt dem Empfaenger die Rufnummer, und der naheliegende
Nachtrag setzt sie in den Body — Alarm-SMS laeuft ueber Telnyx, Mail ueber Brevo, also zwei
Auftragsverarbeiter und ein neuer, nirgends dokumentierter Datenfluss. `sendBootstrapAlertSms`
loggt das Ziel heute bewusst nie (`alert-sms.js:24`); dieselbe Disziplin gilt fuer den Body. Der
Test prueft den Body per Regex gegen `/\+?\d{7,}/` und gegen `/t_user_/`.

**Der Alarmkanal wird selbst geprueft.** Ein nie ausgeloester Kanal gilt als kaputt (abgelaufener
Brevo-Schluessel, leeres `PLATFORM_ALERT_MAIL_TO`, unbekanntes `PLATFORM_ALERT_SMS_TO`, s.
Abschnitt 10). Deshalb: `alertChannelFindings` (`boot-guard.js:424-446`) wird um den Mailkanal
erweitert und meldet **fatal**, wenn bei aktivem EL-Outbound **KEIN** Betreiber-Kanal
konfiguriert ist. Ein Sendefehler auf einem der Kanaele erzeugt eine WARN-Zeile mit
Kanal-Kennung — **stumm scheitern ist auf diesem Pfad verboten** (Test C6).
**Zusaetzlich ein monatlicher Selbsttest ueber beide Kanaele** (eine Zeile "Alarmkanal
funktioniert", ueber denselben Meldeweg): ein Kanal, der zwoelf Monate lang nie ausgeloest
wurde, ist kein bewiesener Kanal. Kosten: ~0,05 USD/Monat fuer die SMS, Mail kostenlos.

#### Takt — der externe Takt ist LIEFERGEGENSTAND, keine Betriebs-Massnahme

Der erste Entwurf definierte den externen Takt aus dem Liefergegenstand heraus ("Betriebs-
Massnahme, kein Code"). Damit haengt die Kernanforderung des Auftrags ("ohne dass jemand
zufaellig anrufen muss") an einer unzugewiesenen manuellen Handlung ohne Abnahmepunkt. **Das
wird zurueckgenommen**, und zwar weil im Repo bereits ein tauglicher Takt liegt:

- **`.github/workflows/outbound-drift.yml`, `on: schedule`** (stuendlich), fahrt
  `npm run outbound:drift` mit **nur-lesenden** Secrets. Ausserhalb von Render (immun gegen den
  Free-Tier-Schlaf) und ausserhalb unserer Telefonie (erfuellt PM-4). Kostenlos.
- **Drei Warnungen, die dazugehoeren:**
  1. Der Bestandsschritt `ci.yml:83-91` degradiert ein fehlendes Secret zu `::warning::` +
     `exit 0`. Der neue Workflow **MUSS bei fehlendem Secret rot werden** — sonst wiederholt er
     exakt die stille Untaetigkeit, die dieser Plan behebt.
  2. Geplante Actions-Laeufe sind best-effort und werden nach 60 Tagen Repo-Inaktivitaet
     deaktiviert. Der Workflow ist damit **selbst ueberwachungsbeduerftig** -> Befundklasse
     `watchdog_stale` (E-6).
  3. Render deployt den **Upstream** (Repo-Lehre `deploy-repo-split`) — der Workflow gehoert in
     das Repo, das tatsaechlich gepflegt wird.
- Zusaetzlich bleibt (a) der Boot-Lauf und (b) der Stundentakt in `runSweepTick`. Der Boot-Lauf
  bekommt eine **Mindestfrist** (nicht oefter als alle 10 min, Marker in derselben durablen
  Zeile wie die Entprellung), sonst laeuft er bei einem externen 10-Minuten-Ping bis zu
  144x/Tag statt einmal.

-> **offene Frage F-4** (Secrets im Repo hinterlegen ist eine Owner-Aktion).

### E-5 (F3) — Absender-Wahrheit: gemessen oder ehrlich unbekannt

**Entscheidung, Teil 1 (jetzt).** `from_e164` behaelt seine heutige Bedeutung (**Absicht** +
Geo-/Sprach-/Tarif-Anker; auf den zwei Telnyx-Wegen faellt sie mit der Wirklichkeit zusammen).
Daneben treten **zwei additive, nullbare Felder**:

| Feld | Inhalt |
|---|---|
| `from_actual_e164` | Was der Anbieter sagt, dass gesendet wurde. **Nur aus Messung.** Set-once. |
| `from_source` | `tenant_did` \| `provider_measured` \| `unknown` |

**Korrektur gegenueber dem ersten Entwurf (innerer Widerspruch, von der Pruefung gefunden):**
der Wert `platform_ani_declared` **entfaellt**, und auf dem EL-Zweig wird beim Anrufstart
**nichts** geschrieben. Grund: `from_actual_e164` ist als *"was der Anbieter sagt"* **und** als
set-once definiert. Ein deklarierter Erst-Schreiber beim Start haette verhindert, dass der
spaeter **gemessene** Wert je landet — der eigene Abnahmetest ("gemessene EL-Fixture ->
`from_actual_e164` = gemessener Wert") waere unerfuellbar gewesen, und das Feld truege genau die
Behauptung, die F3 abstellen soll. Die **Absicht** steht bereits in `from_e164`; bis zur Messung
gilt `from_source='unknown'`.

Quellen:
- **EL-Weg:** `metadata.phone_call.agent_number` aus dem Ergebnisabruf — laut 1.1(2) **auch im
  abgelehnten Fall befuellt**. Geschrieben in `persistProviderResult`
  (`src/elevenlabs/outbound.js:1175`), also an derselben Stelle, die schon `phone_call.call_id`
  sichert -> `provider_measured`.
- **Telnyx-Wege:** `from_actual_e164 = from_e164`, weil derselbe Wert nachweislich ins
  Provider-Feld wandert (`voice.js:705`, `:770`) und keine `ani_override` dazwischensteht (an
  der TeXML-Application live geprueft) -> `tenant_did`.
- **Kein Messwert:** `from_actual_e164` bleibt **NULL**, `from_source='unknown'`.

**Form-Validierung, Pflicht:** `from_actual_e164` wird **nur** geschrieben, wenn der Wert die
E.164-Form erfuellt (geteiltes Praedikat aus dem Umfeld von `normalize_target` /
`normalizePrivateNumber` — **keine zweite Normalisierung bauen**, G5); sonst NULL +
`from_source='unknown'`. Grund, am Bestand gemessen: die vorhandene Fixture traegt dort keinen
E.164, sondern ein **maskiertes** Token (`test/fixtures/elevenlabs-conversations.js:96:
agent_number: "***0177#1ca0c7"`). Ohne Validierung landete ein ungepruefter Anbieter-String in
genau der Spalte, die jede Oberflaeche mit "wo kann man zurueckrufen" beantwortet. Das Feld wird
ausserdem **ausschliesslich auf OUTBOUND** geschrieben.

**Jede Oberflaeche, die "unter welcher Nummer haben wir angerufen / wo kann man zurueckrufen"
beantwortet, liest `from_actual_e164` und sagt "unbekannt", wenn es NULL ist.** Das ist die
woertliche Erfuellung der Auflage.

**Backfill-Plan (Pflicht bei additiv-nullable):** **kein Backfill, und zwar begruendet.** Fuer
Bestandszeilen ist NULL der **wahre** Wert. Ein Backfill waere eine Erfindung, und `from_e164`
dorthin zu kopieren waere genau die Luege, die dieser Punkt abstellt.

**Entscheidung, Teil 2 (Zielmodell fuer Millionen Tenants).**
**EINE globale Absendernummer fuer ALLE Tenants ist kein tragfaehiges Modell.** Vier Gruende,
der vierte in dieser Revision ergaenzt:

1. **Rueckrufbarkeit.** Der Angerufene sieht eine Nummer, die niemanden erreicht — heute sogar
   buchstaeblich eine, die uns nicht gehoert.
2. **Regulatorik.** Telnyx verlangt fuer EEA-Ziele ein `P-Asserted-Identity` mit einer echten,
   rueckwaehlbaren Nummer.
3. **Reputation.** Eine Nummer, die Millionen Anrufe taetigt, ist ein Sperrmagnet; der
   Missbrauch eines Tenants sperrt alle.
4. **Fremd-PII (neu).** Inbound routet ueber die **angerufene** Nummer zum Tenant
   (`src/routes/voice.js:280` -> `numberRecordByE164`). Solange die geteilte ANI die DID eines
   Tenants ist, landet **jeder Rueckruf eines fremden Angerufenen** im Assistenten und in den
   Transkripten dieses einen Kunden. Das ist heute nur deshalb harmlos, weil dieser Tenant der
   Eigentuemer selbst ist — es ist **kein** Zustand, mit dem man einen Fremdkunden ausliefert.

**Zielzustand: eine registrierte Absendernummer je Tenant-DID.**
- Auf den **zwei Telnyx-Wegen ist das bereits gebaut**: `from` reist pro Anruf als
  Port-Parameter (`ports.js:127`). Dort ist Pro-Tenant-ANI eine Frage der
  Nummern**beschaffung**, nicht der Architektur.
- Auf dem **EL-Weg** braucht es je DID **eine eigene EL-Registrierung**
  (`POST /v1/convai/phone-numbers`), weil der Anrufkoerper kein Absenderfeld hat (1.1(3)) und
  `PATCH` die `phone_number` **nicht** aendern kann. Dafuer:
  - neue nullbare Spalte an `number`: `provider_agent_phone_number_id`,
  - `outbound.js:931` waehlt die Registrierung der **Tenant-DID**, Fallback auf den Env-Skalar,
  - der Telnyx-`ani_override_type` darf dann nicht mehr `always` sein. **OFFEN:** der
    zulaessige Enum-Wert ist nicht belegt -> per GET nach dem PATCH verifizieren.
- **Deprovisionierung gehoert ins Freigabe-Protokoll** (neu, sonst Waisen):
  `DELETE /v1/convai/phone-numbers/{id}` mit Wiederholung und Abgleich. Ohne sie hinterlaesst
  **jede** Kuendigung eine Registrierung auf eine nicht mehr existierende DID — bei 1.000
  Tenants und 5 % Abwanderung 50 Dauer-Befunde/Monat; nach zwei Monaten ist der Waechter
  permanent rot und wird ignoriert (PM-3, aus einer Quelle, die der erste Entwurf nicht sah).
- **`ELEVENLABS_AGENT_PHONE_NUMBER_ID` ist ausdruecklich die ZWISCHENSTUFE** (ein Env-Skalar
  kann per Definition keine Pro-Tenant-Groesse tragen), die Spalte ist der Zielzustand.
- **Kosten des Wegs dorthin (Stand heute):** Telnyx DID US local 1,00 USD einmalig +
  2,00 USD/Monat, US toll-free 1,00 + 1,00, DE local 1,00 + 1,00 **aber** regulatorisch schwer
  (BNetzA-Formular, `GET /v2/addresses` = **0 Adressen im Konto**) -> eine +49-DID ist ein
  Vorgang von Wochen. Preis einer EL-SIP-Registrierung: **OFFEN**.
- **`number.provider_agent_phone_number_id` wird in E5 nur angelegt, wenn sie in E5 auch
  GELESEN wird** — als Soll-Quelle der Drift-Pruefung 1. Andernfalls entfaellt sie aus E5. Eine
  Spalte, deren Lesen "auf spaeter" verschoben wird, ist toter Code (Repo-Regel).
- **In diesen Etappen gebaut: die Ehrlichkeit (Teil 1).** Der Mehr-Nummern-Betrieb ist
  Beschaffung + Geld -> **offene Frage F-2**.

### E-6 (F4) — Drift-Waechter: welche Pruefungen, wie oft, was bei Rot

**Welche.** Neun Invarianten, alle nur-lesend:

| # | Abfrage | Invariante | Klasse |
|---|---|---|---|
| 1 | `GET /v1/convai/phone-numbers/{ELEVENLABS_AGENT_PHONE_NUMBER_ID}` | existiert; `assigned_agent.agent_id == ELEVENLABS_AGENT_ID`; `supports_outbound == true`; merke `phone_number` = **N_el** | config |
| 2 | `GET /v2/fqdn_connections/{id}` | `active == true`; merke `outbound.ani_override` = **N_ani** | config |
| 3 | `GET /v2/phone_numbers?filter[phone_number]=<N_ani>` | **genau 1 Treffer, `status=='active'`** | **ownership** |
| 4 | `GET /v2/verified_numbers` (Liste, nicht Einzelabruf) | Ausweichpfad: N_ani darf alternativ hier stehen | ownership |
| 5 | `N_el == N_ani == PLATFORM_ANI_E164` | die drei Deklarationen stimmen ueberein | config |
| 6 | `GET /v2/fqdns` | ein Eintrag mit `connection_id == {id}` (**String-Vergleich**, s. 2.5) | config |
| 7 | `GET /v2/outbound_voice_profiles/{ovp}` | `enabled == true`; **die MENGE der tatsaechlich bedienten Ziellaender** ist in `whitelisted_destinations` enthalten | config |
| 8 | `GET /v2/balance` | **Reichweite** (`available_credit` / Verbrauch der letzten 24 h) ueber Schwelle | warn |
| 9 | `GET /v2/phone_numbers?filter[phone_number]=<Alarm-Absender>` | die Bindung `alert_sms_sender` ist kontoeigen und `active` | ownership |

**Pruefung 3 ist die, die den Ausfall gefangen haette.** Sie ist ein einziger, eindeutiger GET.
**Pruefung 9 ist neu** und schliesst die Klasse statt des Einzelfalls: der Alarmkanal haengt
heute an demselben Mechanismus, der am 24.08. versagt hat.

**Pruefung 7 vergleicht Mengen, nicht Skalare** (Korrektur): "das Zielland" ist keine Groesse des
Waechters, sondern eine je Anruf. Bei einem weltweit gedachten Produkt bedeutet ein neues Land
sonst 100 % Totalausfall fuer dieses Land — sichtbar erst am ersten Kundenanruf, also derselbe
Fehlermodus wie am 27.08., nur laenderweise. Heute enthaelt die Whitelist nur US/CA/DE.

**Pruefung 8 ist eine REICHWEITE, kein fester Betrag** (Korrektur): bei 3,09 USD Bestand und bei
Millionen-Verkehr ist derselbe absolute Schwellwert falsch, und er muesste bei jedem
Wachstumsschritt von Hand nachgezogen werden — exakt das Argument, mit dem `MAX_BUDGET_EUR` in
`CLAUDE.md` entschaerft wurde. Schwelle: Guthaben reicht fuer weniger als 72 h.

Die Einzelabfrage `GET /v2/verified_numbers/{number}` scheidet aus: sie liefert bei leerer Liste
404, und eine Positiv-Kontrolle fehlt. Der Check laeuft ueber die **Liste**.

**Wo — im bestehenden Adapter, NICHT in einem zweiten HTTP-Client** (Korrektur):
- Der reine, IO-freie Entscheidungskern `src/telephony/outbound-config-drift.js` bleibt exakt wie
  geplant (alles injiziert, kein Netz, kein `Date.now` im Kern). Das ist der richtige Teil.
- **`src/telephony/outbound-config-reader.js` entfaellt ersatzlos.** Er haette Telnyx-Basis-URL,
  Bearer-Auth, Fehler-/Statusbehandlung und Rate-Limit ein zweites Mal implementiert, obwohl der
  Adapter das traegt: `adapters/telnyx/numbers.js` macht mit `authHeaders()` + `assertTelnyxOk`
  **genau** die Abfrage, die Pruefung 3 braucht (`GET /v2/phone_numbers?filter[phone_number]=…`,
  dort als "resolve" dokumentiert, `numbers.js:14`), und `adapters/telnyx/errors.js` liefert
  bereits `providerStatus`, auf das E-2 selbst baut. Ein zweiter Telnyx-Client waere genau die
  "zweite Wahrheit", die dieser Plan an anderer Stelle zu Recht verwirft — und ein Verstoss
  gegen `CLAUDE.md` ("Neue Telefonie-/Provider-Logik laeuft ueber die Ports").
- **Stattdessen:** die Telnyx-GETs (2/3/4/6/7/8/9) als rein **lesende** Erweiterung des
  bestehenden Telnyx-Adapters (schmales Read-Port-Interface in `ports.js`, Dispatch ueber
  `registry.js`); der EL-GET (1) in das bestehende `src/elevenlabs/`-Modul.
- `scripts/check-outbound-drift.mjs` (`npm run outbound:drift`), fail-closed, nur GET, Exit 1 —
  die bewaehrte Bauform von `scripts/check-elevenlabs-drift.mjs`. **Deklarierte Ausnahmen mit
  Grund und Datum** werden mitgedruckt, blockieren aber nicht (`:51-63`): sonst bleibt der
  Waechter dauerhaft rot und wird binnen einer Woche ignoriert. Genau das braucht Weg 1 der
  Wiederherstellung, der Pruefung 5 bewusst verletzt.

**Wie oft — und was das bei Skala kostet.**
- Boot (nach `app.listen`, fire-and-forget, eigener Timeout, **Mindestfrist 10 min**),
  stuendlich in `runSweepTick`, und stuendlich extern ueber den GitHub-Actions-Workflow (E-4).
- **Aufwand heute:** 7-9 Requests je Lauf, Telnyx-Limit `4;w=1` (4 req/s), API-Aufrufe
  unberechnet. Boot + Stundentakt ~25 Requests/Tag. **Mit dem empfohlenen 10-Minuten-Ping steigt
  das auf bis zu ~1.000 Requests/Tag** (jedes Aufwachen ist ein Prozess-Start) — deshalb die
  Mindestfrist.
- **Bei Skala bricht der Satz, und das steht hier ausdruecklich:** Pruefung 1 und 3 sind
  **pro Nummer**. 1.000 Absendernummern = ~2.000 Requests/Zyklus = ~8 min an 4 req/s (14 %
  Dauerlast auf einer Grenze, die sich der Waechter mit Provisionierung und Kauf teilt).
  1.000.000 = ~2,9 Tage je Zyklus. **Ein Stundentakt ist ab ~5.000 Nummern nicht mehr fahrbar.**
- **Zielbild fuer Skala (Zwischenstufe ist der heutige Satz):** taegliche **Bulk-Abstimmung**
  (`GET /v2/phone_numbers?page[size]=250` durchblaettern, Mengendifferenz gegen `number` +
  `platform_number_use`) + **stuendliche Einzelpruefung nur der Plattform-Bindungen** +
  **Pruefung beim Schreiben** (Provisionierung/Freigabe). Der lineare Satz ist die Zwischenstufe,
  nicht der Endzustand.
- **Nebenlaeufigkeit: Single-Flight ueber alle Instanzen** (`pg_try_advisory_lock` je Intervall,
  oder derselbe Claim-Marker wie beim Alarm). Ohne ihn laufen bei M Instanzen M Boot-Pruefungen
  gleichzeitig in die 4-req/s-Grenze -> 429 -> Ergebnis `unknown` -> **der Waechter ist
  ausgerechnet im Deploy-Fenster blind.** `makeSingleFlight` (`src/single-flight.js`) ist
  prozesslokal und reicht dafuer nicht.

**Ausdruecklich NICHT vor jedem Waehlen.** Es legt Anbieter-Latenz auf den Anrufstart; es
multipliziert die Anbieter-Last mit dem Anrufvolumen; und ein Falsch-Positiv dort verhinderte
einen bezahlten Kundenanruf.

**Was bei Rot — abgestuft, nie ein Selbstabschalter.**

- **`OUTBOUND_FROZEN` wird NIEMALS automatisch gesetzt.** Das ist der bewusste Notaus des
  Eigentuemers (Absolute Regel 1). Ein Kill-Switch, der sich selbst ausloest, ist genau der Weg,
  auf dem ein Falsch-Positiv das Produkt toetet.
- **Klasse `ownership` (3/4/9) rot:** 100 % der Anrufe werden mit 403 scheitern. Reaktion:
  Melder-2-Alarm **und** der ANI-Riegel (unten).
- **Klasse `config` (1/2/5/6/7) rot:** Alarm, **nie** Gate. Diese Zustaende koennen bewusst
  gewollt sein (Weg 1!) und sind diagnostizierbar.
- **Klasse `warn` (8):** nur Warnung.
- **Klasse `unknown` ist eine EIGENE, ins Audit GEZAEHLTE Befundklasse** (Korrektur). Netzfehler,
  Timeout, fehlender Schluessel, 5xx -> `unknown`, **nie** ein Gate — aber auch **nie stumm**.
  *"Konnte nicht pruefen"* darf im Log nicht wie *"geprueft und gut"* aussehen. Das Repo hat die
  fail-open-Disziplin schon (`PERMANENT_FETCH_STATUS`, `outbound.js:104-106`); was fehlte, war
  der sichtbare Zaehler.
- **Klasse `watchdog_stale` (neu, fuenfte Klasse):** die letzte **erfolgreiche** Messung ist
  aelter als K Zyklen (Default 6 h) -> eigener Befund, eigener Alarm. Ohne sie schalten ein
  abgelaufener oder rotierter Schluessel, ein dauerhaftes 5xx oder ein deaktivierter
  Actions-Workflow den gesamten Fruehwarner **still** ab — und wieder merkt es niemand. Das ist
  exakt der Fall, den F4 verhindern soll.

**Der ANI-Riegel (das einzige Gate dieses Plans).**
- Er greift **ausschliesslich** bei einer **frischen, erfolgreichen, positiven** `ownership`-
  Messung. **Frische ist beziffert und eine eigene Env** (`OUTBOUND_ANI_GATE_MAX_AGE_MS`,
  Vorschlag 15 min); alles Aeltere gated nie. Grund: auf `plan: free` steht der Prozess still,
  und eine fast eine Stunde alte Messung koennte einen Anruf ablehnen, obwohl der Eigentuemer vor
  drei Minuten eine neue DID gekauft hat.
- **Vor dem Ablehnen erfolgt EINE Live-Nachmessung** (derselbe GET wie Pruefung 3, eigener kurzer
  Timeout). Schlaegt sie fehl -> **durchlassen**. Ohne diese Nachmessung bliebe nur der ehrliche
  Satz, dass der Riegel dauerhaft im Beobachtungsmodus bleibt: nach dem ersten Falsch-Positiv
  wird `OUTBOUND_ANI_GATE_ENABLED` nie wieder eingeschaltet.
- Er sitzt als **eigenes** Gate-Glied hinter `resolve_outbound` (nie in ein bestehendes Gate
  gefaltet), mit eigenem `denialAudit`-Grund `ani_not_owned`, hinter
  `OUTBOUND_ANI_GATE_ENABLED`, **Default `false` = nur beobachten**.

**Verworfen, mit Grund:** der zweite Frueherkenner ueber
`GET /v1/convai/conversations?page_size=N` (Serie `failed`/`0 s`). Melder 1 sieht dasselbe aus
unserem eigenen Store, ereignisgetrieben, ohne Anbieter-Abfrage. Ein zweiter Weg zur selben
Aussage waere eine zweite Wahrheit.

**Ein Runbook je Befundklasse ist Liefergegenstand, nicht Beiwerk.** `docs/RUNBOOK-OUTBOUND.md`
bekommt je Klasse (`ownership_lost`, `config_*`, `balance_low`, `watchdog_stale`,
`outage_not_placed`, `platform_number_hold`) einen Eintrag: was es heisst, welcher GET es
bestaetigt, welcher Schritt es behebt, wie man zurueckdreht, wann eskaliert wird. Die
Alarmnachricht traegt den Anker (den Klassen-Token). Ohne das ist der 3-Uhr-Alarm ausschliesslich
fuer den Eigentuemer handhabbar — E0 ist ein Runbook fuer **diesen** Vorfall, keine Gattung.

---

## 4. Zielmodell fuer Skala (Zusammenfassung)

| Achse | Heute | Zwischenstufe (diese Etappen) | Zielzustand |
|---|---|---|---|
| Plattform-Nummer | existiert nur in zwei Anbieter-Konfigurationen, die kein Code kennt | **deklariert** (`PLATFORM_ANI_E164` + abgeleiteter Alarm-Absender), als globale Bindung gespeichert, Freigabe dreifach verriegelt | N Bindungen: je Tenant-DID eine, Doppelrolle strukturell ausgeschlossen, Unbind-Protokoll im Lebenszyklus |
| Absender | EINE globale ANI fuer alle Tenants (und die gehoert einem Tenant) | eigene Plattform-DID ohne Kundenbezug (F-1) + ehrliche Buchfuehrung (`from_actual_e164`/`from_source`) | je Tenant eigene, rueckrufbare DID; auf dem EL-Weg je DID eine Registrierung, `ani_override_type` nicht mehr `always` |
| Fehlergrund | EL-Weg: strukturell NULL | EIN Vokabular, nach SCHULD getrennt (`not-placed` / `unreachable` / `result-unknown`), alle Engines | unveraendert (das ist bereits der Zielzustand) |
| Nutzer-Meldung | Feed, den niemand rendert; MCP ohne Fehlerfeld | MCP-Rueckweg traegt Grund; Feed gerendert; EINE Mail nur fuer `not-placed` | unveraendert |
| Betreiber-Meldung | keine | Melder 1 (aus persistenten Call-Zeilen) + Drift-Waechter, 4 Stufen (Log/Audit/**Mail**/SMS), externer Takt via GitHub Actions | dazu Selbstheilung/Wiedervorlage statt reinem Alarm (ab ~10.000 Nummern noetig) |
| Drift-Pruefung | keine | 9 Einzelpruefungen je Lauf, linear in der Nummernzahl | taegliche Bulk-Abstimmung + stuendliche Einzelpruefung nur der Bindungen + Pruefung beim Schreiben |
| Rufnummer-Land | 3 US-DIDs, 0 Adressen im Konto | unveraendert | DIDs im Land des Tenants (DE = BNetzA-Vorgang, Wochen) |

**Zwischenstufen, ausdruecklich als solche benannt und NICHT als Endzustand ausgegeben:**
`PLATFORM_ANI_E164` als Skalar (Ziel: mehrere Bindungen), `ELEVENLABS_AGENT_PHONE_NUMBER_ID` als
Skalar (Ziel: Spalte an `number`), `OUTBOUND_ANI_GATE_ENABLED=false` (Ziel: an, nach einem
gruenen Zyklus), Weg 1 der Wiederherstellung (Ziel: Weg 1b/2), der **lineare Drift-Pruefsatz**
(Ziel: Bulk-Abstimmung), die **absolute Alarmklausel K1** (Ziel: K2 traegt, sobald ein Nenner da
ist), der **Alarm ohne Selbstheilung** (Ziel: Wiedervorlage-Warteschlange).

---

## 5. Etappenplan

Reihenfolge nach "Kunde frueh geschuetzt": erst der Wiederholungsschutz (E1), dann die
Sichtbarkeit des naechsten Fehlers (E2), dann dessen Zustellung an den Nutzer (E3a) und an den
Betreiber (E3b), dann die Frueherkennung (E4), zuletzt die Buchfuehrung (E5).

Jede Etappe ist eigenstaendig mergebar. Wo eine Etappe von einer frueheren profitiert, ist die
Abhaengigkeit **weich** (die Abnahme kommt ohne sie aus) und unten benannt. **Keine Abnahme
haengt von einer offenen Frage ab** — die offenen Fragen aendern Parameter, nicht Kriterien.

**Zwei Etappen tragen den Regressionsfang fuer den 27.08.:** E2 (Abnahme B1/B2 — die gemessene
403/D51-Antwort ergibt `not-placed:invite-403-D51` und die Buchung bleibt unveraendert) und E4
(Abnahme D1 — `ani_override` gesetzt, aber `phone_numbers`-Filter liefert 0 Treffer ->
`ownership_lost`). **Beide ohne echten Anruf, ohne Netz, ohne Provider-Schreibzugriff.**

---

### E0 — WIEDERHERSTELLUNG (OWNER-AKTION, wird in diesem Plan NICHT ausgefuehrt)

**Ziel.** Der Live-Pfad kann wieder anrufen. Echte Kosten, echte Provider-SCHREIBzugriffe.

> **OWNER-AKTION.** Jeder Schritt dieser Etappe kostet Geld oder braucht einen SCHREIBzugriff
> beim Anbieter. Der Plan beschreibt sie, fuehrt sie nicht aus.

**Voraussetzungen, die Geld sind (OWNER):** Telnyx-Guthaben steht bei **3,09 USD**,
`credit_limit 0.00` (bei Null ist Schluss). Der DeepSeek-Adapter meldete am 27.08. **HTTP 402
Insufficient Balance**. Beides gehoert vor den Testanruf aufgefuellt, sonst scheitert der
Testanruf aus einem zweiten, unabhaengigen Grund und verwirrt die Diagnose.

**Harte Vorbedingung, VOR jedem PATCH (rein lesend, kostet nichts):**

> **Die gewaehlte ANI muss eine DID des BOOTSTRAP-Tenants sein — keinem Kunden zugeordnet,
> ohne Inbound-Funktion.**

Begruendung: `+17067101188` ist laut Befund die `from_e164` des **anrufenden Tenants**, also eine
Kunden-DID, und sie haengt an Connection `2982643896460248193` ("Hermes"), also am Inbound-Weg.
Zeigt `PLATFORM_ANI_E164` darauf, ist sie **wieder in zwei Rollen** — der Riegel friert die
Doppelrolle dann ein, statt sie zu beenden, dieser Tenant kann sein Konto nicht mehr sauber
beenden, und alle Anrufe aller anderen Tenants gehen unter der Nummer eines fremden Kunden raus.
Schritt 5 von Weg 1 kappte zusaetzlich dessen Inbound. Welchem Tenant die drei kontoeigenen DIDs
(`+15804504874`, `+17067101188`, `+18643028341`) gehoeren, ist **rein lesend in der Prod-DB
feststellbar** und gehoert VOR den PATCH.

#### Weg 1b — eine EIGENE Plattform-DID kaufen (EMPFOHLEN, OWNER, kostet)

1. **KAUF (OWNER, Geld):** eine Telnyx-DID unter dem **Bootstrap-Tenant**, US local
   **1,00 USD einmalig + 2,00 USD/Monat**.
2. Inbound dieser DID auf eine Ansage oder den Support legen — **nicht ins Leere**. Das ist die
   eigene Auflage aus F-2, die sonst niemand baut.
3. `PATCH /v2/fqdn_connections/3026479542865757220` -> `ani_override` = diese DID.
4. `PLATFORM_ANI_E164` = diese DID (Render-Dashboard).

**Warum das der bessere Startpunkt ist:** es beendet die Doppelrolle **an der Wurzel**, statt sie
per Riegel einzufrieren; es macht PM-1 (blockierte Kunden-Kuendigung) gegenstandslos; und es
verhindert, dass Rueckrufe fremder Angerufener im Posteingang eines Kunden landen. 3,00 USD im
ersten Monat sind billiger als der Folgeschaden.

#### Weg 1 — Sofort-Wiederanlauf mit einer vorhandenen DID (ZWISCHENSTUFE)

1. `PATCH /v2/fqdn_connections/3026479542865757220`
   Body: `{ "outbound": { "ani_override": "<kontoeigene aktive DID>", "ani_override_type": "always" } }`
2. Keine EL-Aenderung. `ELEVENLABS_AGENT_PHONE_NUMBER_ID` bleibt
   `phnum_1101m00pjrg7e1js7aaxwp8hdw38`.
3. `PLATFORM_ANI_E164` = dieselbe DID (Render-Dashboard).
4. **Preis, bewusst:** EL-Registrierung (`+15739090177`) und real gesendete ANI laufen
   auseinander — Pruefung 5 des Waechters ist rot und wird als **deklarierte Ausnahme mit Grund
   und Datum** gefuehrt. `inbound_trunk.allowed_numbers` bei EL zeigt weiter auf die tote Nummer.
5. **RISIKO, das nur ein Testanruf klaert:** ob die ANI derselben Connection zugewiesen sein
   muss wie der ausgehende Trunk. Falls ja, zusaetzlich
   `PATCH /v2/phone_numbers/<id> {connection_id: 3026479542865757220}` — **was den Inbound-Weg
   dieser DID kappt.** Ist die DID eine Kunden-DID, ist dieser Schritt **verboten**.

#### Weg 2 — Beide Seiten konsistent (der bessere Endpunkt fuer den EIN-ANI-Aufbau)

1. `PATCH /v2/fqdn_connections/3026479542865757220` -> `user_name`/`password` neu setzen
   (das SIP-Passwort ist bei Telnyx nicht lesbar; Vorlage `scripts/spike2-sip.mjs:121-140`).
2. `POST /v1/convai/phone-numbers` mit `phone_number: "<Plattform-DID>"`, `label`,
   `provider: "sip_trunk"`, `agent_id: "agent_5301kwkh9vv3ezesf100pggfj9rs"`,
   `inbound_trunk_config.allowed_numbers: ["<dieselbe DID>"]`, `outbound_trunk_config: {…}`
   (Vorlage exakt: `scripts/spike2-sip.mjs:153-170`).
3. `PATCH /v2/fqdn_connections/…` -> `ani_override` = **dieselbe DID**.
4. Env nachziehen — **vier Orte plus Dashboard**: `ELEVENLABS_AGENT_PHONE_NUMBER_ID` und
   `PLATFORM_ANI_E164` in `src/config.js:699`, `.env.example:135`, `render.yaml:108`,
   `test/helpers.js:262` (BASE_ENV) — **und im Render-Dashboard**, da die Live-Env
   dashboard-verwaltet ist.
5. **Erst NACH gruenem Testanruf:** `DELETE /v1/convai/phone-numbers/phnum_1101m00pjrg7e1js7aaxwp8hdw38`.

#### Weg 3 — verifizierte Fremdnummer (`POST /v2/verified_numbers`)

Existiert, 0,03 USD je erfolgreicher Verifikation + Kanalgebuehr. **Nicht empfohlen** fuer den
Produktpfad — aber der einzige Weg, eine NICHT-Telnyx-Nummer als ANI zu fuehren.

#### Die alte Nummer zurueckholen: heute NICHT verfuegbar

`+15739090177` laesst sich nicht einfach zurueckkaufen: `number.e164` ist global UNIQUE
(`schema.sql:646`) und die freigegebene Zeile haelt die `e164` weiter. Solange E1 das nicht
mitloest (`releaseNumber` setzt `e164=NULL`), endet ein Wiederkauf in einer UNIQUE-Verletzung.
-> **offene Frage F-9**.

#### Abnahme E0

| # | Kommando | Erwartete Ausgabe |
|---|---|---|
| A0-1 | Prod-DB, rein lesend: `SELECT tenant_id, e164, status FROM number WHERE e164 IN (…)` unter dem jeweiligen RLS-GUC | Die gewaehlte ANI gehoert dem **Bootstrap-Tenant** oder keinem Tenant. Gehoert sie einem Kunden: **Abbruch**, stattdessen Weg 1b |
| A0-2 | `GET /v2/phone_numbers?filter[phone_number]=<N_ani>` | `total_results == 1`, `status == "active"` |
| A0-3 | `GET /v2/fqdn_connections/3026479542865757220` | `outbound.ani_override == <N_ani>` |
| A0-4 | `GET /v1/convai/phone-numbers/<id>` | `supports_outbound == true`, Agent stimmt |
| A0-5 | `npm run outbound:drift` (nach E4) | Exit `0`, Ausgabe enthaelt woertlich `pruefung3 ownership=ok N_ani=<maskiert> treffer=1 status=active` |

#### Abschliessende Bestaetigung (echter Testanruf, OWNER, kostet)

Ein Anruf an die eigene hinterlegte Nummer. Erwartet:
- ElevenLabs: `status == "done"`, `metadata.call_duration_secs > 0`, `metadata.error == null`;
- unser Store: `status='completed'`, `failure_reason IS NULL`, `answered_unclear_reason IS NULL`,
  `from_actual_e164 == <N_ani>` (nach E5);
- **`call.calleeIsOwner === true`**, und die Eroeffnung **nennt die KI beim Namen** (Absolute
  Regel 2, Owner-Entscheidung OC vom 2026-08-20 — der lange Dritt-Satz entfaellt, die
  KI-Kennzeichnung nicht).
- **Abbruchkriterium:** bleibt `metadata.error` gesetzt oder `call_duration_secs == 0`, wird der
  PATCH aus Schritt 1 sofort zurueckgedreht (ein einzelner PATCH) und der Befund gegen das
  Runbook gehalten — es wird **nicht** ein zweites Mal probiert, ohne die Ursache benannt zu
  haben.

**Rueckbau.** Weg 1/1b ist ein einzelner PATCH und in einem Schritt zurueckdrehbar. Weg 2 ist bis
Schritt 5 vollstaendig zurueckdrehbar (alte Registrierung bleibt stehen, Env zurueck). Nach
Schritt 5 nicht mehr — deshalb steht er nach dem Testanruf.

---

### E1 — WURZEL: Plattform-Nummern-Bindung und dreifacher Freigabe-Riegel

**Ziel.** Eine Nummer, die als Plattform-Nummer (Absender ODER Alarm-Absender) in Benutzung ist,
kann durch **keinen** Lebenszyklus-Weg **unseres Codes** mehr freigegeben, suspendiert oder
umgewidmet werden — erzwungen im Code und in der DB, nicht durch Betriebsdisziplin. Zusaetzlich:
keine Freigabe waehrend eines laufenden Anrufs, und ein Unbind-Protokoll fuer die legitime
Kuendigung.

> **HARTE VORBEDINGUNG DES MERGES (OWNER-AKTION, kostet nichts):** `PLATFORM_ANI_E164` ist im
> Render-Dashboard gesetzt, **bevor** E1 deployt wird. Die Live-Env ist dashboard-verwaltet;
> `render.yaml` allein setzt live nichts. Beleg nach dem Deploy: `/healthz` zeigt einen
> geaenderten `configHash`.

**Betroffene Dateien**
- `src/db/schema.sql` — Tabelle `platform_number_use` + Teilindex + RLS ENABLE/FORCE + globale
  Policy (Muster `profile_global`, `:866`); Trigger-Funktion + Trigger in der **exakten Form aus
  E-1 Ebene C** (`DROP TRIGGER IF EXISTS` + `CREATE OR REPLACE FUNCTION`, `WHEN`-Klausel auf den
  Zustandsuebergang, **kein** werfender DELETE-Zweig).
- `src/store/state-ops.js` — reines Praedikat `platformNumberInUse(s, e164)` und
  `numberBusyReason(s, number)`; `releaseNumber` (`:2466`) und der `SUSPENDED`-Uebergang werfen;
  `releaseNumber` setzt zusaetzlich `e164=NULL`; `numberReleaseVerdict` (`:2582`) und
  `tenantNumbersForErase` (`:2621`) liefern **Koerbe** `{release, hold}`; Mutatoren
  `bindPlatformNumber`/`unbindPlatformNumber`.
- `src/release-reconcile.js` — Orchestrator zaehlt HOLD als `aborted` und schreibt
  `AUDIT_ACTION.ABORTED` mit `grund=platform_number_in_use` (`:30/65/103`); Unbind-Kette bei
  legitimer Freigabe.
- `src/store/defaults.js` — `PLATFORM_NUMBER_PURPOSE`-Enum, `s.platformNumberUse: []`.
- `src/store.js` (Fassaden-Export), `src/store/json.js` (**Wrapper-Paritaet**),
  `src/store/pg.js` (Flush/Hydrate der **globalen** Tabelle, also nicht `flushOwnScoped`).
  Alle drei sind Pflicht: fehlt ein Wrapper, ist die Funktion in einem Backend schlicht
  `undefined` (`src/store.js:374` nennt genau diesen Fehlerfall).
- `src/boot.js` — Ableitung **beider** Bindungen (`outbound_ani` aus `PLATFORM_ANI_E164`,
  `alert_sms_sender` aus `findActiveNumber(BOOTSTRAP_TENANT_ID)`), idempotent, VOR
  `assertBootGates`.
- `src/boot-guard.js` — `platformAniFindings({platformAniE164, elevenLabsOutboundEnabled})`,
  **nicht fatal**, Wirkung auf den Outbound-Zweig begrenzt (Begruendung in E-1).
- `src/config.js` (Namespace `provisioning`, Nachbarschaft zu `bootstrapE164`), `.env.example`,
  `render.yaml`, `test/helpers.js` BASE_ENV.
- **`PLAN-SECURITY.md`** — Eintrag: der neue Riegel auf dem Nummern-Lebenszyklus, seine
  Reichweite (unser Store, nicht die Anbieter-Seite) und der Preis "haengende Kuendigung".
  Pflicht nach `CLAUDE.md` ("Bei sicherheitsrelevanten Aenderungen: `PLAN-SECURITY.md`
  aktualisieren").

**Zu aendernde Bestandstests (Pflicht)**
- `test/rls-with-check.test.js:135` (ruft `applySchema` **zweimal**) — der vorhandene
  Idempotenz-Waechter; er ist der Beleg, dass die erste Trigger-DDL im Repo den zweiten Boot
  ueberlebt.

**Neue Tests** (Namen ohne Katalog-Praefix — Lehre `catalog-id-prefix-misroutes-tests`)
- `test/plattform-nummer-bindung.test.js`
  - `releaseNumber` auf eine gebundene Nummer **wirft**; Store bleibt `active`.
  - Uebergang nach `SUSPENDED` auf eine gebundene Nummer **wirft** ebenfalls.
  - `tenantNumbersForErase` liefert die gebundene Nummer im Korb **`hold`** mit
    `reason='platform_number_in_use'` (nicht: sie fehlt).
  - `releaseTenantNumbersOnErase` fuehrt fuer eine gebundene Nummer **keinen** Provider-DELETE
    aus (Attrappe zaehlt 0), meldet `aborted>0` -> `numberReleasePending` bleibt `true`, und es
    entsteht **genau EINE** Audit-Zeile `did_release_aborted` mit dem Grund.
  - **Positiv-Kontrolle:** eine **nicht** gebundene Nummer wird weiterhin freigegeben.
  - **Unbind:** eine Bindung, die dem freigebenden Tenant selbst gehoert, wird ueber die
    Unbind-Kette geloest und die Nummer freigegeben; die geteilte Plattform-ANI nicht.
  - Laufender Anruf auf der Nummer -> HOLD `active_call_on_number`; nach Call-Ende Freigabe.
  - Boot leitet **zwei** Bindungen ab; zweimal booten -> zwei Zeilen (Idempotenz).
  - Leeres `PLATFORM_ANI_E164` + `ELEVENLABS_OUTBOUND_ENABLED=true` -> Befund gemeldet, Boot
    laeuft, **Inbound unveraendert**, EL-Outbound waehlt nicht.
  - Freigabe setzt `e164=NULL` -> dieselbe Nummer ist danach erneut beschaffbar.
- `test/plattform-nummer-bindung-pg.test.js` (Muster `test/store-pg-multitenant.test.js`, laeuft
  nur mit `DATABASE_URL`):
  - **NEUSTART-Round-Trip:** schreiben, Spiegel verwerfen, hydrieren, lesen (nicht nur
    schreiben/lesen — Lehre `pg-store-holds-state-in-memory`).
  - Trigger wirft bei `UPDATE number SET status='released'` auf eine gebundene Zeile.
  - **Flush-Regression (der Blocker):** eine gebundene, **bereits `released`-e** Zeile wird
    zweimal geflusht -> **kein Wurf**, `save()` geht durch.
  - **Prune-Regression:** ein Flush mit **leerem** Nummern-Slice des gebundenen Tenants ->
    kein Wurf, Transaktion committet.
- `test/schema-plattform-trigger.test.js`: Text-Assertion, dass `schema.sql` die globale Policy,
  `DROP TRIGGER IF EXISTS`, die `WHEN`-Uebergangsbedingung und **keinen** `RAISE EXCEPTION` im
  DELETE-Zweig enthaelt — der Beleg, der auch ohne DB laeuft.

**Abnahmepunkte**

| # | Kommando | Erwartete Ausgabe |
|---|---|---|
| A1 | `node --test test/plattform-nummer-bindung.test.js` | `pass 10`, `fail 0` |
| A2 | `node --test test/schema-plattform-trigger.test.js` | `pass 4`, `fail 0` |
| A3 | `node --test test/rls-with-check.test.js` | `fail 0` (zweimaliges `applySchema` bleibt gruen) |
| A4 | `npm test` | `fail 0` |
| A5 | `DATABASE_URL=<test-db> node --test test/plattform-nummer-bindung-pg.test.js` | `fail 0` (ohne DB: `skip`) |
| A6 | `grep -c "OUTBOUND-RESILIENZ" PLAN-SECURITY.md` | `>= 1` (der Sicherheits-Eintrag existiert) |

**Rueckbau-Risiko: mittel.** Der Riegel kann eine legitime Freigabe blockieren, wenn
`PLATFORM_ANI_E164` versehentlich auf eine Kunden-DID zeigt (deshalb die harte Vorbedingung in
E0). Gegenmittel: die Bindung ist EINE Env-Zeile + ein Neustart entfernt
(`PLATFORM_ANI_E164=""` -> keine Bindung -> Bestandsverhalten), jede blockierte Freigabe
hinterlaesst eine Audit-Zeile mit Grund und eskaliert nach 24 h. Die DDL ist additiv; der Trigger
laesst sich per `DROP TRIGGER` einzeln entschaerfen, ohne Datenverlust.

---

### E2 — F1: EIN Fehlervokabular ueber alle Engines (REGRESSIONSFANG 27.08.)

**Ziel.** Fuer jeden nicht erfolgreichen Anruf steht ein maschinenlesbarer, PII-freier Grund am
Datensatz; "nie zustande gekommen, weil WIR kaputt sind", "nie zustande gekommen, weil das ZIEL
nicht erreichbar ist" und "niemand hat abgenommen" sind drei unterscheidbare Dinge; die
Kostenbuchung ist **byte-identisch** zum Bestand.

**Vorbedingung, die VOR E2 entschieden sein muss:** die Umlaut-Frage (F-6). Entweder alle acht
Phrasen mit echten Umlauten (plus korrigierter Dateikopf) **oder** alle in der ASCII-
Transliteration des Bestands — **nicht halb und halb**. Eine bewusst uneinheitliche Datei ist die
schlechteste der drei Varianten und macht den Dateikopf-Kommentar
(`src/i18n/failure-reason-texts.js:7-10`) sachlich falsch.

**Betroffene Dateien**
- `src/telephony/failure-reason.js` — Konstanten `NOT_PLACED` / `UNREACHABLE` /
  `RESULT_UNKNOWN`; reine Erzeuger `startRejectionReason(providerStatus)` und
  `providerErrorReason({code, reason, error_type})` mit der Zuordnungsregel aus E-2
  (4xx/5xx, SIP-403-Klasse vs. SIP-404-Klasse); **Export `FAILURE_REASON_BASE_TOKENS`** als EINE
  Quelle aller Basis-Token.
- `src/i18n/failure-reason-texts.js` — Phrasen fuer die drei Token in de/fr/en, **paarweise
  verschieden** (`gq-p15…:96-99` verlangt das).
- `src/elevenlabs/outbound.js` — `recordFailureReason` in `finishFromConversation` (`:1221`),
  `finishExpiredPoll` (`:1011`), `finishOnPermanentError` (`:1027`); `answeredAnchorOutcome`
  (`:427-440`) bekommt die Fehler-Frage **zwischen `PROVIDER_IN_PROGRESS` und
  `durationSecs === 0`**; neuer Grund `provider_rejected_before_answer`.
- `src/routes/api-calls.js:392-401` — `recordFailureReason` aus `err.providerStatus` **als erste
  Anweisung im `catch`, VOR `terminateAndBillCall`**.
- `test/fixtures/elevenlabs-conversations.js` — neue, **gemessene** Fixture des 403/D51-Falls vom
  27.08. (Rufnummern maskiert wie im Bestand).
- **`PLAN-SECURITY.md`** — nur wenn die PII-Whitelist als Sicherheitszusage gefuehrt wird
  (Regex statt Anbieter-Freitext); sonst nicht noetig.

**Zu aendernde Bestandstests (Pflicht, nicht optional)**
- `test/el-fixtures-echte-antworten.test.js:129-150` pinnt heute die **falsche** Zuordnung
  (`unclearReasons === ["call_duration_secs_zero_not_answered"]` fuer den SIP-404-Fund, Kommentar
  *"er IST bekannt: es wurde nie abgenommen"*). Erwartung wird auf
  `provider_rejected_before_answer` + `failureReason === "unreachable:invite-404-D11"` gedreht,
  mit einer Kommentarzeile, die sagt **warum** die alte Erwartung falsch war.
- `test/gq-p15-failure-reason-notification.test.js:73-85` — `baseTokens` wird aus
  `FAILURE_REASON_BASE_TOKENS` gespeist statt aus dem hartkodierten `lifecycleEvents`-Array,
  plus eine **Negativ-Probe**: ein Basis-Token ohne Phrase macht den Test rot. Ohne diese
  Aenderung ist das Phrasen-Gate wirkungslos (s. E-2).

**Neue Tests**
- `test/fehlergrund-vokabular.test.js`
  - **REGRESSIONSFANG 27.08.:** `providerErrorReason` auf der **gemessenen** 403-Antwort ->
    `"not-placed:invite-403-D51"`.
  - SIP-404-Bestandsfixture -> `"unreachable:invite-404-D11"` (**andere Klasse**, das ist der
    Punkt).
  - `startRejectionReason(422)` -> `"not-placed:start-422"`; `startRejectionReason(503)` ->
    `"result-unknown:start-503"`; `undefined` -> `null`.
  - **PII:** eine konstruierte `reason` mit eingebetteter fiktiver Rufnummer `+12025550143` ->
    Token enthaelt **keine** Ziffernfolge daraus.
  - `failureReasonBase("not-placed:invite-403-D51")` -> `"not-placed"`.
- `test/el-anbieterfehler-anker.test.js` — **die Geld-Regression**
  - Gemessene 403-Fixture (Dauer 0) durchgepollt -> `answeredAt === null`, gebuchte
    Voice-Minuten `0`, `billedAt` gesetzt — identisch zum Bestand; NUR `unclearReason` und
    `failureReason` sind neu.
  - **Dritter Pflichtfall:** `metadata.error != null` **UND** `call_duration_secs = 42` ->
    Anker **bleibt**, gebuchte Minuten unveraendert, `failureReason` bleibt `null`.
  - Laufendes Gespraech (`status=in-progress`) mit gesetztem `metadata.error` -> `keepAnchor`,
    `unclearReason` unveraendert.
  - Echte Nicht-Rufannahme (Dauer 0, `metadata.error == null`) -> weiterhin
    `call_duration_secs_zero_not_answered`. **Die Faelle duerfen nie dasselbe Label tragen.**
- `test/anrufstart-ablehnung-grund.test.js` — Spawn-Test (`PORT=0`, `DATA_DIR`-Override): eine
  Attrappe laesst den Originate mit `providerStatus=403` scheitern -> `GET /api/calls/:id` zeigt
  `failureReason: "not-placed:start-403"`, Antwortstatus 502, **kein** Roh-Provider-Text in der
  Antwort — **und die erzeugte Notification traegt die Grund-Phrase**, nicht
  `"<Ziel> (Status: failed)"` (das pinnt die Schreib-Reihenfolge).

**Abnahmepunkte**

| # | Kommando | Erwartete Ausgabe |
|---|---|---|
| B1 | `node --test test/fehlergrund-vokabular.test.js` | `pass 5`, `fail 0` |
| B2 | `node --test test/el-anbieterfehler-anker.test.js` | `pass 4`, `fail 0` |
| B3 | `node --test test/anrufstart-ablehnung-grund.test.js` | `pass 1`, `fail 0` |
| B4 | `node --test test/el-fixtures-echte-antworten.test.js` | `fail 0` (mit gedrehter Erwartung) |
| B5 | `node --test test/gq-p15-failure-reason-notification.test.js` | `fail 0` — und die Negativ-Probe belegt, dass ein Token ohne Phrase rot faerbt |
| B6 | `npm test` | `fail 0` |

*(Der grep-Abnahmepunkt `grep "metadata.error"` des ersten Entwurfs entfaellt: ein einzelner
Kommentar erfuellte ihn, ohne dass eine Zeile Code den Anbieter-Fehler liest. B1/B2 sind die
Verhaltens-Zusicherungen, die er ersetzen sollte.)*

**Rueckbau-Risiko: gering.** Rein additive Felder und Token; der Money-Pfad ist per B2 gepinnt.
Ein falsch klassifizierter Grund fuehrt zu einem falschen Nutzertext, nicht zu einer falschen
Buchung.

**Weiche Abhaengigkeit:** keine. E2 laeuft unabhaengig von E1.

---

### E3a — F2(a): Der Fehler erreicht den Nutzer

**Ziel.** Wer den Anruf ausgeloest hat, erfaehrt Scheitern UND Grund, ohne einen zweiten
Werkzeugaufruf raten zu muessen.

*(E3 des ersten Entwurfs war die einzige Etappe mit zwei unabhaengigen Adressaten, sieben
Produktionsdateien ueber vier Schichten und vier neuen Env-Werten. Sie ist entlang der
natuerlichen Naht geteilt: der MCP-/Frontend-Rueckweg ist additiv und risikoarm, der Alarmweg
ist es nicht.)*

**Betroffene Dateien**
- `src/mcp-tools.js` — `AWAIT_EVENT_OUTPUT` (`:216-223`) + `awaitEventView` (`:229-239`) bekommen
  `status` und `failure_reason` **ueber den bestehenden Erzeuger `pickCallStatus` (`:150-163`)**,
  nicht handgebaut; `pickTranscript` (`:184-193`) bekommt `texts` und ersetzt den
  Warte-Platzhalter **nur bei `status==='failed'` UND `failureReason != null`**.
- **die MCP-Server-Instruktionen** — ein Satz zu `not-placed` ("nicht wiederholen, dem Nutzer
  sagen"). Ohne ihn wiederholt der Assistent den Anruf, jedes Mal mit echten Kosten.
- `apps/web/src/lib/render.js` + zugehoerige Seite — Notification-Feed rendern (heute 0 Treffer).
- `src/mail/…` — **genau eine** Nutzer-Mail, ausschliesslich fuer die `not-placed`-Klasse
  (E-3); `unreachable`/`no-answer` erzeugen keine.

**Neue Tests**
- `test/mcp-fehlergrund-rueckweg.test.js`
  - `await_call_event` auf einen `failed`-Call mit Grund liefert `status:"failed"` +
    `failure_reason:"not-placed:invite-403-D51"`; `result_summary` enthaelt **nicht** die
    Zeichenkette `"5 Sekunden warten"`.
  - **Gegenrichtung (Bestandsschutz):** ein terminaler Call **ohne** Grund und ein laufender Call
    liefern **byte-identisch** den bisherigen Text.
- `test/dashboard-notification-feed.test.js` — die Renderfunktion erzeugt aus einem Feed-Eintrag
  sichtbaren Text (heute rendert nichts).
- `test/nutzer-mail-nur-not-placed.test.js` — `not-placed` erzeugt genau eine Mail;
  `unreachable` und `no-answer` erzeugen **keine** (Mail-Port als Attrappe, zaehlt Aufrufe).

**Abnahmepunkte**

| # | Kommando | Erwartete Ausgabe |
|---|---|---|
| C1 | `node --test test/mcp-fehlergrund-rueckweg.test.js` | `pass 3`, `fail 0` |
| C2 | `node --test test/dashboard-notification-feed.test.js` | `pass 1`, `fail 0` |
| C3 | `node --test test/nutzer-mail-nur-not-placed.test.js` | `pass 3`, `fail 0` |
| C4 | `npm test` | `fail 0` |

**Rueckbau-Risiko: gering.** Die MCP-Felder sind additiv (Schema-Erweiterung, kein Feld
entfaellt); der Platzhalter-Austausch ist eng gefasst und in beide Richtungen gepinnt.

**Weiche Abhaengigkeit:** E2 liefert die Token. Ohne E2 traegt der Rueckweg die Bestandstoken und
ist trotzdem gruen testbar.

---

### E3b — F2(b): Der systematische Ausfall meldet sich beim Betreiber

**Ziel.** Ein systematischer Ausfall meldet sich von selbst, gedaempft, ueber zwei voneinander
unabhaengige Kanaele — und der Zustand ueberlebt einen Prozess-Neustart.

**Betroffene Dateien**
- `src/telephony/outage-alert.js` (neu) — reine Erkennungsregel (K0/K1/K2 aus E-4), IO-frei,
  zeit-injiziert.
- `src/telephony/call-finish.js` — Ausloeser: jeder beendete Anruf fragt die Regel.
- `src/store/state-ops.js` + `src/store.js` + `src/store/json.js` + `src/store/pg.js` — das
  Fenster wird aus den **persistenten `call`-Zeilen** abgeleitet (reine Query); **nur** der
  Zustands-/Entprell-Marker bekommt eine durable globale Zeile. Alle drei Store-Dateien sind
  Pflicht (Wrapper-Paritaet).
- `src/telephony/alert-sms.js` + `src/mail/ports.js` — Meldeweg WARN -> Audit -> **Mail** -> SMS,
  mit Body-Vertrag (nur Token/Zaehler/Fenster/Tenant-ANZAHL).
- `src/boot-guard.js` — `alertChannelFindings` (`:424-446`) um den Mailkanal erweitert: fatal,
  wenn bei aktivem EL-Outbound **beide** Kanaele leer sind.
- `src/config.js` (Namespace `billing`, dort wohnen `platformAlertSmsTo`/`costAlertDebounceMs`),
  `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV: `OUTAGE_ALERT_MIN_FAILURES=3`,
  `OUTAGE_ALERT_MIN_ATTEMPTS=20`, `OUTAGE_ALERT_FAIL_SHARE=0.2`,
  `OUTAGE_ALERT_WINDOW_MS=3600000`, `OUTAGE_ALERT_DEBOUNCE_MS=21600000`,
  `PLATFORM_ALERT_MAIL_TO=""`.

**Neue Tests**
- `test/ausfall-erkennung.test.js` (reine Regel, ohne Netz, ohne Zeitquelle)
  - **K0:** der erste `not-placed:invite-403`-Befund, der im Vorfenster nicht auftrat -> WARN +
    Audit, **keine** SMS/Mail. (Das ist der Fall "ein Nutzer ruft einmal an und gibt auf".)
  - **K1 / REGRESSIONSFANG 27.08.:** 3x `not-placed:invite-403`, **0** Erfolge im Fenster,
    **ein** Tenant -> **Alarm**.
  - **K2:** 25 Versuche, davon 8 `not-placed`, viele Erfolge -> **Alarm** (Anteil 32 % >= 20 %).
  - 25 Versuche, davon 2 `not-placed` -> **kein Alarm** (Anteil 8 %).
  - 10x `unreachable` von EINEM Tenant -> **kein Alarm** (Ziel-Schuld, nicht unsere).
  - 10x `no-answer` -> **kein Alarm** (normaler Betrieb).
  - zweiter Ausfall innerhalb der Entprellfrist -> **kein zweiter Alarm**; nach Ablauf -> Alarm.
  - Rueckkehr zu gesund -> genau eine Audit-Zeile, keine SMS.
- `test/ausfall-meldeweg.test.js`
  - Reihenfolge fixiert: WARN + Audit **immer**, auch wenn Mail und SMS werfen (fail-soft,
    Aufrufer nie abgebrochen); ein Sendefehler erzeugt eine WARN-Zeile **mit Kanal-Kennung**.
  - Ziel-Adresse/Nummer wird **nie** geloggt.
  - **Body-Vertrag:** der Alarm-Body matcht **nicht** `/\+?\d{7,}/` und **nicht** `/t_user_/`.
- `test/ausfall-marker-durabel-pg.test.js` — **NEUSTART-Round-Trip:** Marker schreiben, Spiegel
  verwerfen, hydrieren -> der Marker ist noch da (kein zweiter Alarm nach dem Aufwachen).
- `test/platform-number-hold-eskalation.test.js` — ein HOLD `platform_number_in_use`, der laenger
  als 24 h besteht, erzeugt genau einen Betreiber-Befund ueber denselben Meldeweg.
- `test/alarmkanal-selbsttest.test.js` — der monatliche Selbsttest feuert genau einmal je
  Periode (Muster "melde genau einmal je Periode") und laeuft ueber beide Kanaele.

**Abnahmepunkte**

| # | Kommando | Erwartete Ausgabe |
|---|---|---|
| C5 | `node --test test/ausfall-erkennung.test.js` | `pass 8`, `fail 0` |
| C6 | `node --test test/ausfall-meldeweg.test.js` | `pass 3`, `fail 0` |
| C7 | `DATABASE_URL=<test-db> node --test test/ausfall-marker-durabel-pg.test.js` | `fail 0` (ohne DB: `skip`) |
| C8 | `node --test test/platform-number-hold-eskalation.test.js` | `pass 1`, `fail 0` |
| C8b | `node --test test/alarmkanal-selbsttest.test.js` | `pass 2`, `fail 0` |
| C9 | `node --test test/route-auth-inventory.test.js` | `fail 0` (falls ein Operator-Endpunkt dazukommt: Eintrag in `src/route-policy.js`) |
| C10 | `npm test` | `fail 0` |

**Rueckbau-Risiko: mittel.** Der Alarm kann bei Fehl-Kalibrierung zu laut sein; alle Schwellen
sind Env-Werte, `OUTAGE_ALERT_MIN_FAILURES=0` + `OUTAGE_ALERT_FAIL_SHARE=1.1` schalten ihn aus.
Die Regel *"Zu laut ist erlaubt, stumm nie"* (`state-ops.js:3985`) gilt hier ausdruecklich.

**Weiche Abhaengigkeit:** E2 liefert die Schuld-Trennung, auf der die Regel zaehlt. Ohne E2
zaehlt sie auf den Bestandstoken und ist trotzdem gruen testbar (die Regel ist token-agnostisch).

---

### E4 — F4: Drift-Waechter gegen die Anbieter-Wirklichkeit (REGRESSIONSFANG 27.08.)

**Ziel.** Eine Abweichung zwischen unserer Konfiguration und der Wirklichkeit beim Anbieter wird
erkannt, bevor ein Kunde es merkt — auch dann, wenn niemand anruft.

> **OWNER-AKTION in dieser Etappe:** die drei Env-Werte im Render-Dashboard setzen und die
> nur-lesenden Secrets fuer den GitHub-Actions-Workflow hinterlegen. Ohne beides ist der
> Waechter **live inert** — und "inert" saehe im Log wie "gruen" aus.

**Betroffene Dateien**
- `src/telephony/outbound-config-drift.js` (neu) — reiner Entscheidungskern: nimmt die neun
  Messwerte, liefert Befunde mit Klasse (`ownership` / `config` / `warn` / `unknown` /
  `watchdog_stale`). Kein Netz, kein `Date.now`.
- `src/telephony/ports.js` + `src/telephony/registry.js` +
  `src/telephony/adapters/telnyx/numbers.js` — die Telnyx-GETs als rein **lesende** Erweiterung
  des bestehenden Adapters (**kein zweiter HTTP-Client**, s. E-6).
- `src/elevenlabs/…` — der EL-GET (Pruefung 1) im bestehenden Modul.
- `scripts/check-outbound-drift.mjs` (neu) + `package.json` `"outbound:drift"`.
- `.github/workflows/outbound-drift.yml` (neu) — `on: schedule`, stuendlich, nur-lesende
  Secrets, **rot bei fehlendem Secret** (nicht `::warning::` wie `ci.yml:83-91`).
- `src/boot.js` — Lauf nach `app.listen`, fire-and-forget mit Timeout und **Mindestfrist**;
  vierter Schritt in `runSweepTick` (`:873-887`); **Single-Flight** ueber
  `pg_try_advisory_lock`.
- `src/telephony/outbound-gates.js` — der ANI-Riegel als **eigenes** Gate-Glied hinter
  `resolve_outbound`, mit eigenem `denialAudit`-Grund `ani_not_owned`, Frische-Grenze und
  Live-Nachmessung.
- `docs/RUNBOOK-OUTBOUND.md` (neu) — je Befundklasse ein Eintrag (E-6).
- `src/config.js`, `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV:
  `TELNYX_FQDN_CONNECTION_ID=""` und `TELNYX_OUTBOUND_VOICE_PROFILE_ID=""` im Namespace
  **`telephony`** (dort wohnen bereits `telnyxApiKey`/`telnyxConnectionId`, `config.js:1929-1941`
  — eine zweite Connection-ID unter `provisioning` trennte Gleiches);
  `OUTBOUND_ANI_GATE_ENABLED=false` und `OUTBOUND_ANI_GATE_MAX_AGE_MS=900000` im Namespace
  **`safety`** (dort wohnen die Anruf-Gates `outboundFrozen`/`allowedCountryCodes`/
  `maxCallsPerHour`). `PLATFORM_ANI_E164` bleibt unter `provisioning` (Nachbarschaft zu
  `bootstrapE164`).
- `src/boot-guard.js` — Befunde fuer **beide** neuen Telnyx-IDs mit derselben Abstufung wie
  `PLATFORM_ANI_E164` (Wirkung auf den Outbound-Zweig begrenzt, nicht boot-fatal).
- **`PLAN-SECURITY.md`** — Eintrag: neues Glied in der Outbound-Gate-Kette
  (`OUTBOUND_ANI_GATE_ENABLED`), Default-aus-Begruendung, bewusst getragenes
  Falsch-Positiv-Risiko. Pflicht nach `CLAUDE.md`.

**Zu aendernde Bestandstests (Pflicht — im ersten Entwurf fehlte dieser Abschnitt ganz)**
- `test/outbound-gates-order.test.js:22ff` haelt `EXPECTED_ORDER` **hartkodiert** und begruendet
  das ausdruecklich: *"eine kuenftige Umsortierung der Gate-Kette soll DIESEN Test bewusst
  brechen"*. Ein neues Glied macht `npm test` rot; der Test wird um das Glied an **exakt der
  geplanten Position** erweitert, mit Kommentar, warum es dort sitzt.
- `test/deny-diagnosability.test.js` — zu pruefen wegen des neuen `denialAudit`-Grunds
  `ani_not_owned`.
- `test/scripts-config-namespace.test.js:16-21` — die hartkodierte `SCRIPTS`-Liste wird um
  `scripts/check-outbound-drift.mjs` erweitert. Ohne den Eintrag erfasst dieses Gate das neue
  Skript **schlicht nicht** und bleibt gruen, ohne etwas zu pruefen.

**Neue Tests** (alle mit injizierter Fetch-Attrappe, **kein Netz**)
- `test/outbound-drift-kern.test.js`
  - **REGRESSIONSFANG 27.08.:** `ani_override` gesetzt, aber `phone_numbers`-Filter liefert
    `total_results: 0` -> Befund `ownership_lost`, Klasse `ownership`.
  - **Positiv-Kontrolle:** alles stimmt -> **leere Befundliste**. Ohne sie belegt ein gruener
    Lauf nichts (Lehre `pruefkommando-ohne-positiv-kontrolle`).
  - `N_el != N_ani` -> `config`, **nie** `ownership` (Weg 1 darf nicht gaten).
  - Alarm-Absender nicht kontoeigen (Pruefung 9) -> `ownership`-Befund.
  - Deklarierte Ausnahme mit Grund+Datum -> Befund bleibt **sichtbar**, blockiert nicht; Ausnahme
    ohne Grund oder ohne Datum -> Fehler, blockiert.
  - Netzfehler/Timeout/fehlender Schluessel -> `unknown` mit **sichtbarem Zaehler**, **nie**
    `ownership`.
  - Letzte erfolgreiche Messung aelter als K Zyklen -> `watchdog_stale`.
  - `connection_id` als JSON-Zahl mit Praezisionsverlust -> Vergleich trifft trotzdem
    (String/BigInt).
  - Ein bedientes Zielland fehlt in `whitelisted_destinations` -> `config`-Befund.
  - Guthaben-**Reichweite** unter 72 h -> `warn`.
- `test/outbound-ani-gate.test.js` — Spawn-Test:
  - `OUTBOUND_ANI_GATE_ENABLED=false` + `ownership_lost` -> `place_call` laeuft **unveraendert**
    durch (Beobachtungsmodus).
  - `=true` + **frischer, erfolgreicher** `ownership_lost` + **Nachmessung bestaetigt** -> 503
    mit Grund-Token, `denialAudit` `ani_not_owned`, **kein** Waehlversuch (Attrappe: 0 Aufrufe).
  - `=true` + Messung `unknown` **oder** aelter als `OUTBOUND_ANI_GATE_MAX_AGE_MS` -> `place_call`
    laeuft durch (**fail-open bei Unwissen**).
  - `=true` + Messung negativ, aber **Live-Nachmessung schlaegt fehl** -> durchlassen.
  - `OUTBOUND_FROZEN` bleibt in allen Faellen unveraendert (Regressionsschutz gegen den
    Selbstabschalter).

**Abnahmepunkte**

| # | Kommando | Erwartete Ausgabe |
|---|---|---|
| D1 | `node --test test/outbound-drift-kern.test.js` | `pass 10`, `fail 0` |
| D2 | `node --test test/outbound-ani-gate.test.js` | `pass 5`, `fail 0` |
| D3 | `node --test test/outbound-gates-order.test.js` | `fail 0` (mit erweiterter `EXPECTED_ORDER`) |
| D4 | `node --test test/scripts-config-namespace.test.js` | `fail 0` (neues Skript in `SCRIPTS`) |
| D5 | `npm run outbound:drift` **ohne** Schluessel | Exit `1`, Meldung "Schluessel fehlt" (fail-closed, nie stilles OK) |
| D6 | `npm test` | `fail 0` |
| D7 | **(OWNER, nur GET)** `npm run outbound:drift` gegen das Live-Konto, **mit** gesetzten Dashboard-Variablen | vor E0: Exit `1` + `ownership_lost`; nach E0: Exit `0` und woertlich `pruefung3 ownership=ok` — **das ist die Betriebs-Positiv-Kontrolle**, ohne sie belegt der Waechter live nichts |
| D8 | `grep -c "OUTBOUND_ANI_GATE_ENABLED" PLAN-SECURITY.md` | `>= 1` |

*(Der grep-Abnahmepunkt `grep "ani_override" src/` des ersten Entwurfs entfaellt: ein einzelner
Kommentar erfuellte ihn. D1 und D7 sind die Verhaltens-Zusicherungen, die er ersetzen sollte.)*

**Rueckbau-Risiko: mittel, aber gekapselt.** Das einzige Verhalten, das Kundenanrufe verhindern
kann, ist der ANI-Riegel — Default aus, nur bei frischer positiver Messung **plus**
bestaetigender Nachmessung, eine Env-Zeile entfernt. Der Waechter selbst schreibt nie und kann
nur Log/Audit/Alarm erzeugen. `OUTBOUND_FROZEN` wird von keinem Codepfad dieser Etappe
geschrieben (D2 pinnt das).

**Weiche Abhaengigkeit:** E1 liefert `PLATFORM_ANI_E164` als Soll-Wert; ohne E1 vergleicht der
Waechter `N_el` gegen `N_ani` und meldet nur bei Ownership. E3b liefert den Meldeweg; ohne E3b
bleibt es bei WARN + Audit.

---

### E5 — F3: Absender-Wahrheit

**Ziel.** Die gespeicherte Absendernummer ist die tatsaechlich gesendete — oder das System sagt
ehrlich, dass es sie nicht kennt.

**Betroffene Dateien**
- `src/db/schema.sql` — `ALTER TABLE call ADD COLUMN IF NOT EXISTS from_actual_e164 TEXT` +
  `from_source TEXT` (Bestandsmuster `:655-672`).
  **`number.provider_agent_phone_number_id` nur, wenn Drift-Pruefung 1 sie in derselben Etappe
  als Soll-Quelle LIEST** — sonst entfaellt sie (toter Code ist verboten).
- `src/store/pg.js` + `src/store/json.js` + `src/store.js` — Flush/Hydrate der Call-Felder
  (`pg.js:1889-1905`, `:1303`) und Wrapper-Paritaet in **beiden** Backends.
- `src/store/state-ops.js` — `recordActualSender(callId, {e164, source})`, **set-once**
  (Fabrik `recordProviderHandleOnce:865` wiederverwenden, G5), mit **E.164-Formpruefung**
  (geteiltes Praedikat, keine zweite Normalisierung).
- `src/elevenlabs/outbound.js#persistProviderResult` (`:1175`) — schreibt
  `metadata.phone_call.agent_number` -> `provider_measured`, **nur wenn E.164-foermig**.
- `src/routes/api-calls.js` — auf den Telnyx-Zweigen `from_actual = from`, `source='tenant_did'`.
  **Auf dem EL-Zweig wird beim Start NICHTS geschrieben** (`source` bleibt `'unknown'`, bis
  gemessen wird — s. E-5).
- `src/store/views.js#publicCall` — die zwei Felder **nicht** strippen (Anzeige-Vertrag).
- `src/mcp-tools.js`/`apps/web` — dort, wo "unsere Nummer" behauptet wird, den gemessenen Wert
  lesen und `"unbekannt"` sagen, wenn NULL.

**Neue Tests**
- `test/absender-wahrheit.test.js`
  - **Maskierte Bestandsfixture** (`agent_number: "***0177#1ca0c7"`) -> `from_actual_e164` bleibt
    **NULL**, `from_source='unknown'` (die Formpruefung greift).
  - Eine getrennt und **ausdruecklich als konstruiert markierte** E.164-Fixture ->
    `from_source='provider_measured'`, **auch beim gescheiterten Anruf**.
  - EL-Fixture ohne `phone_call` -> NULL / `'unknown'`.
  - Telnyx-Weg -> `from_actual_e164 === from_e164`, `from_source='tenant_did'`.
  - Set-once: ein zweiter Ergebnisabruf ueberschreibt den Wert nicht.
  - **Inbound schreibt nie** in `from_actual_e164`.
  - **Bestandsschutz:** `from_e164` selbst ist unveraendert; Geo-/Sprach-/Tarif-Aufloesung liest
    weiterhin `from` (kein Routing-/Geld-Bruch).
- `test/absender-wahrheit-pg.test.js` — **NEUSTART-Round-Trip** beider Spalten; Bestandszeile ohne
  Werte hydriert als `null` (der dokumentierte "kein Backfill"-Fall).

**Abnahmepunkte**

| # | Kommando | Erwartete Ausgabe |
|---|---|---|
| E-1 | `node --test test/absender-wahrheit.test.js` | `pass 7`, `fail 0` |
| E-2 | `DATABASE_URL=<test-db> node --test test/absender-wahrheit-pg.test.js` | `fail 0` (ohne DB: `skip`) |
| E-3 | `npm test` | `fail 0` |

*(Der grep-Abnahmepunkt `grep "agent_number"` des ersten Entwurfs entfaellt aus demselben Grund
wie B6/D6.)*

**Rueckbau-Risiko: gering.** Rein additiv; `from_e164` und damit jeder Geld-, Geo- und
Routing-Pfad bleibt unberuehrt (E-1-Test pinnt das).

**Weiche Abhaengigkeit:** keine (der Wegfall von `platform_ani_declared` hat die Abhaengigkeit
von E1 aufgeloest — ohne Messung gilt `'unknown'`, was ebenfalls ehrlich ist).

---

## 6. Testkonzept

**Grundsaetze** (Bestandspraxis, `CLAUDE.md` + `test/testbaenke-run.mjs`)

- `node:test` ohne zusaetzliche Dependencies; Tests in `test/*.test.js`.
- **KEINE echten Anrufe, KEINE SMS, KEINE Provider-SCHREIBzugriffe.** Alle Anbieter-Antworten
  kommen aus Fixtures oder injizierten `fetchImpl`-Attrappen.
  `ELEVENLABS_OUTBOUND_ENABLED="false"` bleibt in `test/helpers.js` BASE_ENV der Riegel (`:258`);
  `FAKE_ORIGINATE_ELEVENLABS="false"` ebenso.
- **Fixtures sind gemessen, nicht erfunden.** Die neue 403/D51-Fixture ist eine echte
  Aufzeichnung vom 27.08.2026, Rufnummern per `maskNumber` maskiert. **Wo eine Fixture fuer einen
  Test konstruiert werden muss (die E.164-foermige `agent_number` in E5), wird sie ausdruecklich
  als konstruiert markiert** — Bestandspraxis derselben Datei.
- **Beispiel-/Testdaten erkennbar fiktiv:** Zielrufnummern aus reservierten Bereichen (z.B.
  `+12025550143`), nie eine echte Nummer.
- **Jede neue Env-Variable gehoert in `test/helpers.js` BASE_ENV** — sonst leakt die lokale
  `.env` via `dotenv` in jeden Spawn-Test (Lehre `test-base-env-drift`).
- **Testnamen ohne Katalog-Praefix** (`DID-`, `OUT-`, `GAP-`, `ABNAHME-`, …): ein Praefix am
  Namensanfang schiebt den Test in den Gates- bzw. Abnahme-Lauf (Lehre
  `catalog-id-prefix-misroutes-tests`). Diese Tests sind Regressionsfang und gehoeren in
  `npm test`.
- **Spawn-Muster** fuer alles, was den Server braucht: Kindprozess mit `PORT=0` und
  `DATA_DIR`-Override auf ein Temp-Verzeichnis; Server nach dem Test sauber beenden (Lehre
  `leaked-test-servers-overheat`).
- **Beide Store-Backends, und BEIDE Wrapper.** Die Invariante lebt in `state-ops.js` und wird
  backend-frei getestet; zusaetzlich je eine pg-Round-Trip-Datei nach dem Muster
  `test/store-pg-multitenant.test.js`, die ohne `DATABASE_URL` sauber `skip`t. **Jede neue
  Store-Funktion braucht ihren Wrapper in `json.js` UND `pg.js`** — sonst ist sie in einem
  Backend `undefined` (`src/store.js:374`).
- **pg-Round-Trips pruefen den NEUSTART**, nicht nur schreiben/lesen: schreiben, Spiegel
  verwerfen, hydrieren, lesen (Lehre `pg-store-holds-state-in-memory`). Das gilt fuer die
  Bindung (E1), den Entprell-Marker (E3b) und die Absender-Felder (E5).
- **Die neue Trigger-DDL wird dreifach gedeckt** — sie ist die erste im Repo:
  (a) `test/schema-plattform-trigger.test.js` belegt Form und `WHEN`-Klausel im Schema-Text;
  (b) `test/rls-with-check.test.js:135` belegt, dass `applySchema` **zweimal** laeuft;
  (c) die Flush-/Prune-Regressionen in `test/plattform-nummer-bindung-pg.test.js` belegen, dass
  der Trigger den normalen Schreibpfad **nicht** anfasst. **Vor E1: PGlite-Kompatibilitaet der
  plpgsql-Form belegen** — die pg-Tests laufen gegen PGlite, nicht gegen Postgres.
  Die Ausfuehrung gegen Prod bleibt ein Owner-Pruefpunkt, rein lesend:
  `psql "$(cat ~/.config/hermes/db-url)" -c "\d+ number"` zeigt den Trigger (Lehre
  `prod-db-ip-allowlist`: "SSL connection closed unexpectedly" heisst Firewall, nicht TLS).
- **Positiv-Kontrolle ist Pflicht — im Test UND im Betrieb.** Jeder neue Waechter braucht einen
  Test, der beweist, dass er im gruenen Fall gruen ist UND im roten Fall rot. **Zusaetzlich neu:
  D7** — ein Lauf gegen das Live-Konto mit gesetzten Dashboard-Variablen. Ohne ihn haette der
  Waechter seine Positiv-Kontrolle im Test, nicht im Betrieb, und liefe live mit leeren Env-Werten
  dauerhaft auf `unknown` — was im Log wie gruen aussaehe (Lehre
  `pruefkommando-ohne-positiv-kontrolle`, eine Ebene hoeher).
- **Geld-Regression explizit pinnen.** E2 aendert einen Pfad, an dem Buchung haengt. B2 misst
  gebuchte Minuten und `answeredAt` an derselben Fixture — **inklusive des Falls
  "Anbieterfehler bei Dauer > 0"**, ohne den die Geld-Neutralitaet nicht bewiesen ist.
- **Testbank-Invariante:** `npm test` + `npm run test:gates` + `npm run test:abnahme` ergeben
  zusammen weiterhin denselben Testbestand wie ein ungefilterter Lauf.

---

## 7. Pre-Mortem

*Ein Jahr spaeter: die Sache ist schiefgegangen. Was ist passiert?*
`CLAUDE.md` verlangt die Benennung **vor** der Umsetzung. PM-1 bis PM-10 stammen aus dem
Entwurf, PM-11 bis PM-26 aus der Pruefung dieses Entwurfs — sie betreffen genau die Stellen, an
denen der **Umbau selbst** schaden kann.

| # | Szenario (Hergang) | Massnahme | Schwere |
|---|---|---|---|
| PM-1 | Der Freigabe-Riegel blockiert eine legitime Kunden-Kuendigung; die DID bleibt gemietet. | HOLD statt Fehler, Audit-Zeile, Retry-Sweep, **24-h-Eskalation**, Unbind-Protokoll; `PLATFORM_ANI_E164=""` loest die Bindung in einer Env-Zeile. Weg 1b (eigene Plattform-DID) macht den Fall gegenstandslos. | mittel |
| PM-2 | Der ANI-Riegel schaltet das Produkt wegen eines Falsch-Positivs ab. | Default aus; gated nur bei frischer (**<= 15 min**), erfolgreicher, positiver Messung **plus Live-Nachmessung**; `unknown` gated nie; `OUTBOUND_FROZEN` nie automatisch (per Test gepinnt). | hoch |
| PM-3 | Der Alarm ist so laut, dass er ignoriert wird. | Schuld-Trennung im Vokabular, K0/K1/K2 statt absoluter Zwei-Klausel-Regel, Zustandsmaschine, Entprellung, deklarierte Ausnahmen sichtbar aber nicht blockierend, **EL-Deprovisionierung** gegen Waisen-Befunde. | hoch |
| PM-4 | Der Alarm ist stumm, weil der Alarmkanal vom selben Ausfall betroffen ist. | Reihenfolge WARN -> Audit -> **Mail** -> SMS; Mail haengt an keinem Carrier; `alertChannelFindings` meldet fatal, wenn beide Kanaele leer sind; Pruefung 9 sichert den Alarm-Absender. | hoch |
| PM-5 | Der Drift-Waechter laeuft auf dem Free Tier nie, weil der Dienst schlaeft. | Boot-Lauf + Stundentakt **+ GitHub-Actions-Workflow `on: schedule`** (ausserhalb Render, ausserhalb unserer Telefonie); `watchdog_stale` meldet, wenn beides ausfaellt. | hoch |
| PM-6 | Der Fehler-Token traegt doch PII. | Regex-Whitelist statt Freitext; Rohtext weder gespeichert noch geloggt; PII-Test mit eingebetteter fiktiver Nummer; **Body-Vertrag** fuer den Alarm mit Regex-Pruefung. | mittel |
| PM-7 | Die neue Anker-Reihenfolge bricht die Kostenbuchung. | Einfuegepunkt **woertlich** festgeschrieben; B2 misst Minuten und Anker **inklusive des Falls Dauer > 0 mit Fehler**. | hoch |
| PM-8 | `platform_number_use` bleibt leer und der Riegel schuetzt nichts — sieht aber gruen aus. | Bindungen werden beim Boot **abgeleitet**, nicht gepflegt; **zwei** Rollen, nicht eine; Boot-Guard meldet leer; Positiv-Kontrolle im Test **und** live (D7). | hoch |
| PM-9 | Weg 1 scheitert an der Connection-Zuordnung der ANI und der Owner haengt fest. | Weg 2 vollstaendig beschrieben; Weg 1b (eigene DID) empfohlen; Abbruchkriterium im Runbook. | mittel |
| PM-10 | Ein zweiter Engine-Zweig entsteht und umgeht das Vokabular wieder. | Der `catch` in `api-calls.js` deckt jeden Zweig; die einzige `RELEASED`-Mutation ist verriegelt. **Nicht gedeckt:** ein Zweig, der `store.endCallRecord` direkt ruft (`bridge.js`) — benannt, nicht gefixt. | mittel |
| **PM-11** | **Der pg-Trigger legt den gesamten Schreibpfad still.** `flushNumbers` upsertet per `ON CONFLICT DO UPDATE` bei JEDEM `save()`; zeigt `PLATFORM_ANI_E164` auf eine bereits `released`-e Zeile (**der heutige Live-Zustand**), wirft der Trigger, `flush()` rollt zurueck — ab da persistiert der Dienst gar nichts mehr, fuer ALLE Tenants, und es sieht aus wie ein DB-Problem. | Trigger gatet auf den **Zustandsuebergang** (`WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('released','suspended'))`); Pflichttest: gebundene, bereits released-e Zeile zweimal flushen -> kein Wurf. | **hoch** |
| **PM-12** | **Ein werfender DELETE-Zweig macht aus jeder Spiegel-Divergenz einen Totalausfall.** `flushOwnScoped` prunt vor jedem Insert-Loop; bei leerem Slice woertlich `DELETE FROM number WHERE tenant_id=$1`. | Kein `RAISE EXCEPTION` im DELETE-Zweig — `RAISE WARNING` + Audit; die Cascade-Klasse deckt Ebene A+B. Pflichttest: Flush mit leerem Nummern-Slice des gebundenen Tenants. | **hoch** |
| **PM-13** | **Der Dienst bootet nach dem zweiten Start nicht mehr.** Erste Trigger-DDL im Repo; `applySchema` fahrt die ganze Datei bei jedem Prozessstart; ein blankes `CREATE TRIGGER` schlaegt beim zweiten Mal fehl. | `DROP TRIGGER IF EXISTS` + `CREATE OR REPLACE FUNCTION`; `test/rls-with-check.test.js:135` als Abnahmepunkt; PGlite-Kompatibilitaet vor E1 belegen. | **hoch** |
| **PM-14** | **Der Buchungsanker echter Gespraeche geht verloren.** Die Fehler-Frage wird an den Anfang von `answeredAnchorOutcome` gezogen; jede Konversation mit `metadata.error` verliert den Anker, auch die 90-Sekunden-lange. Wir zahlen den Carrier und kassieren nichts. | Einfuegepunkt woertlich (zwischen `PROVIDER_IN_PROGRESS` und `durationSecs === 0`); dritter Pflichtfall in B2. | **hoch** |
| **PM-15** | **Der Wiederkauf der alten Nummer scheitert an `e164 UNIQUE`** — unter FORCE-RLS mit einer Fehlermeldung, die auf eine unsichtbare Zeile zeigt. | `releaseNumber` setzt `e164=NULL`; die Historie liegt in `number_assignment`. Bis dahin: "alte Nummer zurueckholen" ist **kein** Wiederherstellungsweg (F-9). | hoch |
| **PM-16** | **Der Waechter ist live inert.** Drei dashboard-verwaltete Env-Werte sind leer, "leer" ergibt `unknown`, `unknown` gated nie und alarmiert nie — jeder Log-Blick sagt gruen. Nach dem naechsten Ausfall stellt sich heraus, dass er zwoelf Monate nichts geprueft hat. | Boot-Guard-Befund fuer alle drei IDs; `unknown` ist eine eigene, **gezaehlte** Befundklasse; **D7 als Betriebs-Positiv-Kontrolle** gegen das Live-Konto. | **hoch** |
| **PM-17** | **Der Alarm-Absender faellt genauso aus wie die ANI.** `resolveBootstrapAlertSender` nimmt die erste aktive Bootstrap-Nummer; derselbe Erase-Weg gibt sie frei; der Kanal stirbt STILL (WARN-Zeile, `null`). | Zweite Bindung `alert_sms_sender` beim Boot ableiten; Drift-Pruefung 9; Mail als primaerer Kanal. | **hoch** |
| **PM-18** | **Der Freigabeauftrag verfaellt still.** Ein Filter statt eines Verdikts liefert `aborted=0` -> `numberReleasePending=false` -> `setContractEndCleanupPending` markiert erledigt -> der Sweep findet den Tenant nie wieder. | Ebene B liefert **Koerbe**; der Orchestrator zaehlt HOLD als `aborted` und schreibt `AUDIT_ACTION.ABORTED`. | **hoch** |
| **PM-19** | **Der Nutzer bekommt dauerhaft die falsche Erklaerung.** `not-placed` traegt Tippfehler des Nutzers und unseren Konfigurationsdefekt; der Text loest auf dem Basis-Token auf. Bei Skala ist der Tippfehler der haeufigste Fall. | Schuld-Trennung `not-placed` / `unreachable` / `result-unknown`. | hoch |
| **PM-20** | **Jeder Anbieter-5xx-Sturm alarmiert.** 5xx/Timeout landen in derselben Klasse wie unsere Konfigurationsfehler; nach dem dritten Fehlalarm wird die Mail weggefiltert. | 4xx -> `not-placed` (zaehlt), 5xx/Timeout -> `result-unknown` (zaehlt nicht). | mittel |
| **PM-21** | **Der Alarm schweigt beim wahrscheinlichsten Verlauf.** Ein Nutzer ruft einmal an und gibt auf: `N=1 < 3`, kein Alarm. Bei ~1 Anruf/Woche wird die Schwelle faktisch nie erreicht. | Klausel **K0**: der erste Befund einer neuen Klasse erzeugt immer WARN + Audit (kostenlos); SMS/Mail erst ab N bzw. Anteil. | mittel |
| **PM-22** | **Der Alarm raucht bei Skala.** Bei ~8.300 Anrufen/h ist ">=3 UND >=2 Tenants" immer erfuellt: ~40 Alarme/Tag Rauschen, waehrend "0 Erfolge" nie feuert. | Klausel **K2**: Anteil mit Mindestnenner, dimensioniert nach (Land \| Route \| ANI). | mittel |
| **PM-23** | **Fenster und Entprell-Marker ueberleben den Neustart nicht.** Das zitierte Muster ist im pg-Backend strukturell ephemer; auf `plan: free` faellt das Fenster bei jedem Schlaf auf 0, und der Alarm feuert bei jedem Aufwachen erneut. | Fenster aus persistenten `call`-Zeilen ableiten; Marker in eine durable globale Zeile bzw. `audit_store`, **nicht** in den Notification-Ringpuffer; NEUSTART-Test. | **hoch** |
| **PM-24** | **Der Riegel blockiert im eigenen Zielzustand jede Kuendigung.** Je Tenant-DID eine Bindung, `unbindPlatformNumber` ohne Aufrufer: bei 1.000 Tenants ~50, bei 1 Mio. ~1.700 Betreiber-Eingriffe pro Tag. | Unbind-Protokoll mit definiertem Aufrufer und geschaerftem Praedikat (Bindung gehoert dem freigebenden Tenant -> darf mit). | **hoch** |
| **PM-25** | **Der Rueckruf eines fremden Angerufenen landet im Posteingang eines Kunden.** Inbound routet ueber die angerufene Nummer; die geteilte ANI ist eine Tenant-DID. | Weg 1b: eigene Plattform-DID unter dem Bootstrap-Tenant, Inbound auf Ansage/Support; harte Vorbedingung A0-1 vor jedem PATCH. | **hoch** |
| **PM-26** | **Der Waechter ist im Deploy-Fenster blind und verbrennt sein Kontingent.** M Instanzen laufen gleichzeitig in die 4-req/s-Grenze -> 429 -> `unknown`; mit externem 10-Minuten-Ping bis zu ~1.000 statt ~25 Requests/Tag. | Single-Flight (`pg_try_advisory_lock`); Mindestfrist fuer den Boot-Lauf; Bulk-Abstimmung als Zielbild ab ~5.000 Nummern. | mittel |

**Von der Revision zu fuellen** (Platzhalter, absichtlich offen):

- [ ] **PM-R1 — Was hat der Umbau selbst kaputtgemacht?** (Welcher Bestandspfad wirft jetzt, der
      vorher lief? PM-11/PM-12/PM-13 sind die Kandidaten.)
- [ ] **PM-R2 — Wo ist die Zwischenstufe zum Dauerzustand geworden?** (Kandidaten:
      `PLATFORM_ANI_E164` als Skalar, `OUTBOUND_ANI_GATE_ENABLED=false`, der lineare
      Drift-Pruefsatz, der Alarm ohne Selbstheilung.)
- [ ] **PM-R3 — Welche der offenen Fragen wurde nie beantwortet, und was hat das gekostet?**
- [ ] **PM-R4 — Hat der externe Takt tatsaechlich laufend gelaufen** — oder wurde der
      Actions-Workflow nach 60 Tagen Inaktivitaet deaktiviert und niemand hat es bemerkt?

*(PM-R5 des ersten Entwurfs — "haelt die Zwei-Klausel-Regel bei 10.000 Anrufen/Stunde?" — ist
gestrichen: die Antwort war vor der Umsetzung ableitbar (sie haelt nicht) und hat die Regel
geaendert, statt die Revision zu beschaeftigen. Ebenso der alte PM-R2 zu `agent_number`: der
Entwurf faellt bereits auf `unknown` zurueck, das ist eine getroffene Entscheidung, keine
offene Frage.)*

---

## 8. Bewusst akzeptierte Risiken

Was hier steht, ist **nicht geloest** und wird trotzdem gebaut. Jeder Eintrag nennt, warum die
vollstaendige Loesung heute nicht gebaut wird, und was sie waere. **Keiner dieser Punkte darf
stillschweigend als Endzustand gelesen werden.**

| # | Risiko | Warum wir es tragen | Zielzustand (nicht in diesen Etappen) |
|---|---|---|---|
| BA-1 | **Anbieter-seitige Umwidmung ist nicht verhinderbar.** Wer im Telnyx-Portal die `connection_id` umhaengt, `ani_override` aendert oder die EL-Registrierung loescht, umgeht Ebene A/B/C vollstaendig. | Wir kontrollieren das Anbieter-Portal nicht. Der Auftrag sagt "freigegeben oder umgewidmet" — die zweite Haelfte kann nur **erkannt**, nie verhindert werden. | EIN Provider-Schreibweg fuer Nummern, der vor jedem Schreibzugriff die Bindung prueft; alles ausserhalb bleibt Waechter-Sache. |
| BA-2 | **Eine legitime Kuendigung kann haengen bleiben**, solange die DID des Kunden zugleich geteilte Plattform-ANI ist. | Ein Produkt-Totalausfall ist teurer als eine haengende Nummern-Rueckgabe. **Artikel 17 ist erfuellt** — `eraseTenantData` loescht alle personenbezogenen Daten; offen ist nur die DID-Miete. HOLD + Audit + 24-h-Eskalation machen es laut. | Weg 1b (eigene Plattform-DID) beendet den Fall; das Unbind-Protokoll deckt den Rest. |
| BA-3 | **Der Alarm heilt nichts, er meldet nur.** Kein Rueckfall auf eine Ersatz-ANI, keine Wiedervorlage-Warteschlange, keine automatische Nachfuehrung. | Bei EINER Absendernummer ist ein Vorfall ein Vorgang — das ist handhabbar. | Ab ~10.000 Nummern zwingend eine Abstimmungs-Warteschlange mit automatischer Nachfuehrung (EL neu registrieren, `ani_override` nachziehen). Bei 1 Mio. Nummern waeren es ~14 manuelle Vorgaenge/Tag. |
| BA-4 | **Der Drift-Pruefsatz skaliert linear.** Pruefung 1 und 3 sind pro Nummer; ab ~5.000 Nummern ist ein Stundentakt nicht mehr fahrbar (4 req/s bei Telnyx). | Heute gibt es genau eine Absendernummer; der Satz kostet 7-9 Requests. | Taegliche Bulk-Abstimmung (Bestandsliste blaettern, Mengendifferenz) + stuendliche Einzelpruefung nur der Bindungen + Pruefung beim Schreiben. |
| BA-5 | **`PLATFORM_ANI_E164` und `ELEVENLABS_AGENT_PHONE_NUMBER_ID` sind Env-Skalare.** Ein Skalar kann per Definition keine Pro-Tenant-Groesse tragen. | Der Mehr-Nummern-Betrieb ist Beschaffung + Geld (F-2), kein Code-Problem. | Mehrere Bindungen in `platform_number_use`; `number.provider_agent_phone_number_id` je DID. |
| BA-6 | **Der ANI-Riegel bleibt zunaechst abgeschaltet** (`OUTBOUND_ANI_GATE_ENABLED=false`). Ein Anruf, der nachweislich mit 403 scheitern wird, wird trotzdem gewaehlt. | Ein falsch-positives Gate schaltet das Produkt ab; ein verbrannter Waehlversuch kostet Cent. Erst Beobachtung, dann Scharfschaltung (F-5). | An, nach einer Woche gruener Laeufe ohne Falsch-Positiv im Audit. |
| BA-7 | **Der Betreiber-Alarm hat genau einen Empfaenger** (eine Mailadresse, eine SMS-Nummer), keine Rufbereitschaft, keine Eskalationsstufe. | Es gibt heute einen Betreiber. | Rufbereitschaft/Eskalation, sobald es mehr als einen gibt. |
| BA-8 | **Der GitHub-Actions-Takt ist selbst ueberwachungsbeduerftig.** Geplante Laeufe sind best-effort und werden nach 60 Tagen Repo-Inaktivitaet deaktiviert. | Er ist trotzdem der einzige Takt, der ausserhalb von Render und ausserhalb unserer Telefonie liegt — und er kostet nichts. | `watchdog_stale` faengt seinen Ausfall; ein bezahlter externer Scheduler waere die Alternative. |
| BA-9 | **`from_actual_e164` ist auf den Telnyx-Wegen eine Ableitung, keine Messung.** Wir setzen `= from_e164`, weil die TeXML-Application heute kein `ani_override` traegt. | Der Beleg ist live geprueft, aber er ist eine Momentaufnahme der Anbieter-Konfiguration. | Der Drift-Waechter prueft genau diese Annahme laufend (Pruefung 2/6). |
| BA-10 | **Die Realtime-Bridge (`bridge.js:157`) bekommt keinen Fehlergrund.** | Auf diesem Weg liegt uns keine Anbieter-Ursache vor; ein erfundener Token waere schlechter als keiner. `VOICE_ENGINE=realtime` ist nicht live. | Wenn der Realtime-Weg live geht, gehoert er in dasselbe Vokabular. |
| BA-11 | **Es gibt keinen Degradationspfad bei Anbieter-Ausfall.** Kein zweiter Carrier, keine Warteschlange fuer verzoegerte Auftraege. | Ein zweiter Carrier ist ein eigenes Projekt. Der Melder faengt den Fall, der Nutzer erfaehrt den Grund. | Zweiter Anbieter oder Auftrags-Warteschlange. |
| BA-12 | **Der Guthaben-Fall reisst den SMS-Kanal mit.** Bei `credit_limit 0.00` endet mit dem Guthaben auch die Alarm-SMS. | Genau deshalb ist Mail der **primaere** Kanal und nicht optional; Pruefung 8 warnt auf Reichweite, nicht auf Restbetrag. | Guthaben-Automatik beim Anbieter (Auto-Recharge) — Owner-/Geld-Entscheidung. |
| BA-13 | **Die Bindungs-Abfrage ist ein linearer Scan ueber den hydrierten Spiegel.** | Bei einer Handvoll Bindungen ist das die einfachste funktionsfaehige Loesung, und sie erbt keine neue Abhaengigkeit. | Im Mehr-Nummern-Betrieb ein indizierter DB-Treffer (`UNIQUE (e164, purpose) WHERE released_at IS NULL` liegt bereits), nicht ein Array-Durchlauf. |

---

## 9. Offene Fragen an Antonio

Ausgelagert und einzeln entscheidbar: **`tasks/entscheidungen-outbound-resilienz.md`**.
Kurzfassung, damit dieses Dokument fuer sich lesbar bleibt:

| # | Frage | Getroffene Annahme (damit die Etappen laufen) |
|---|---|---|
| F-1 | Welcher Wiederherstellungsweg, und mit welcher Nummer? | **Weg 1b** (eigene Plattform-DID kaufen, ~3,00 USD im ersten Monat) ist empfohlen; E0 beschreibt alle Wege, Weg 1 ausdruecklich als Zwischenstufe. Harte Vorbedingung A0-1 gilt in jedem Fall. |
| F-2 | Eine ANI fuer alle oder je Tenant eine eigene DID, und ab wann? | Eine ANI bis zum Launch — **aber kontoeigen und rueckrufbar**. E5 baut die Ehrlichkeit; der Mehr-Nummern-Betrieb ist nicht Teil dieser Etappen. |
| F-3 | Alarm-Kanal: reicht SMS, oder kommt Mail dazu? | **Mail ist der primaere Kanal**, SMS der zweite; `PLATFORM_ALERT_MAIL_TO` neu, Default leer = aus. Boot-Guard meldet fatal, wenn beide leer sind. |
| F-4 | Externer Takt fuer den Waechter? | **GitHub-Actions-Workflow `on: schedule`** als Liefergegenstand von E4 (kostenlos, ausserhalb Render). Braucht nur-lesende Secrets im Repo -> Owner-Aktion. |
| F-5 | Darf der ANI-Riegel scharf werden, und wann? | `OUTBOUND_ANI_GATE_ENABLED=false`; scharf nach einer Woche gruener Laeufe. |
| F-6 | Umlaute in `FAILURE_REASON_TEXTS`? | **Vor E2 zu entscheiden**: alle acht Phrasen mit Umlauten (empfohlen, sechs Bestands-Strings mit umstellen) **oder** alle in ASCII. Nicht halb und halb. |
| F-7 | Telnyx-Guthaben (3,09 USD) und DeepSeek-Konto (HTTP 402)? | Vor E0 auffuellen; blockiert keine Code-Etappe. |
| F-8 | Darf eine Kuendigung wegen einer Plattform-Bindung haengen bleiben? | Ja, mit HOLD + Audit + 24-h-Eskalation. Artikel 17 ist unabhaengig davon erfuellt. |
| F-9 | Soll eine Freigabe die `e164` leeren, damit dieselbe Nummer zurueckgekauft werden kann? | Ja — E1 setzt `e164=NULL` bei Freigabe. Ohne die Entscheidung ist "alte Nummer zurueckholen" kein verfuegbarer Weg. |

---

## 10. OFFEN (nicht belegt, nicht geraten)

1. Zulaessige Werte von `ani_override_type` bei Telnyx (`no_override`/`normal`) — die
   Telnyx-OpenAPI war in dieser Sitzung nicht abrufbar. Verifikation: GET nach dem PATCH.
2. Ob die D51-Eigentumspruefung vor oder nach `ani_override` greift. **Praktisch irrelevant:**
   BEIDE Stellen muessen auf eine gueltige Origination zeigen.
3. Ob die ANI derselben Connection zugewiesen sein muss wie der ausgehende Trunk. Entscheidet, ob
   Weg 1 ohne Zusatzschritt funktioniert. Nur ein Testanruf klaert es.
4. Ob `metadata.phone_call` in **jedem** Fehlerfall befuellt ist — an einem Fall (403/D51)
   gemessen, in der OpenAPI als `anyOf [..., null]` gefuehrt. Der Entwurf faellt deshalb auf
   `from_source='unknown'` zurueck, statt es vorauszusetzen.
5. Ob der 1008-Fall (fehlende `dynamic_variable`) `call_duration_secs=0` oder `>0` liefert.
6. Preis einer EL-SIP-Nummernregistrierung (nicht veroeffentlicht).
7. Live-Werte von `PLATFORM_ALERT_SMS_TO`, `BREVO_API_KEY` und `METRICS_ENABLED` auf Render
   (dashboard-verwaltet). **Solange sie unbekannt sind, ist unbelegt, ob ueberhaupt ein
   Betreiber-Kanal besetzt ist** — deshalb der Boot-Guard-Befund in E3b.
8. Welchem Tenant die drei kontoeigenen DIDs (`+15804504874`, `+17067101188`, `+18643028341`)
   gehoeren. Rein lesend in der Prod-DB feststellbar; **Abnahmepunkt A0-1 von E0**.
9. Ob PGlite die geplante plpgsql-/Dollar-Quoting-Form ausfuehrt. **Vorbedingung von E1** — es
   waere die erste Trigger-DDL im Repo, und die pg-Tests laufen gegen PGlite.
10. Was der Angerufene in DE bei einer US-ANI tatsaechlich als CLI sieht (Netz-Substitution) —
    nicht ohne echten Anruf messbar. **Die Zustellbarkeit selbst ist geklaert** (bindende
    Owner-Aussage: "die US-DID-Spur ist Unsinn"); das Argument gegen die US-Nummer ist die
    Rueckrufbarkeit.

*(Punkt 9 des ersten Entwurfs — "Ob `npm run elevenlabs:drift` heute in CI oder periodisch
laeuft" — ist gestrichen und durch die Tatsache ersetzt, die im Repo steht: er laeuft bei
`push`/`pull_request`, **nicht** periodisch, und wird ohne hinterlegtes `ELEVENLABS_API_KEY`
mit `::warning::` uebersprungen (`.github/workflows/ci.yml:9`, `:75-91`). Das ist zugleich der
Praezedenzfall, den der neue Waechter vermeiden muss — s. E-4 "Takt".)*
