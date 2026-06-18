# Strategie & Phasenplan: Multi-Tenant-Telefonie (provider-agnostisch, Telnyx + Twilio)

> Erstellt am 2026-06-14 von einem Agent-Team (4 Recherche + 3 unabhaengige Architekturen
> + 3 adversariale Gutachten + 1 Synthese).
> Verbindliche Eckpfeiler: provider-agnostische Abstraktion (oberste Direktive),
> Produktionsskala (Richtung Millionen Nutzer), Nummer erst nach Zahlung/Verifikation,
> Billing im Scope.
> Liefergegenstand: PLAN. Noch keine Implementierung.

## TL;DR (Empfehlung in max. 6 Saetzen)

Wir bauen die Twilio-Verdrahtung hinter **vier provider-neutrale Ports** (NumberProvisioning / VoiceControl / Messaging / MediaTransport — Struktur aus Vorschlag A) und ziehen sie per **Strangler-Fig in kleinen, jederzeit lauffaehigen Schritten** um (Migrations-Disziplin aus Vorschlag B: P0 = reines Client-Aufruf-Verschieben, `store.js`-Fassade mit Backend-Flag, jede Phase mit deterministischem Test). Die Realtime-Bridge bleibt **eine** Implementierung mit **einem** `clearPlayback`-Strategy-Hook (kein Doppel-Code an der HEIKLE STELLE); die Telnyx-Doku-Recherche (2026-06-14) bestaetigt Barge-in ueber denselben WS-Befehl `{event:"clear"}` wie Twilio (PCMU 8000 Hz, fast identisches Protokoll), der Hook ist damit sogar symmetrisch — **Telnyx-Realtime ist in Scope**; der **WS-Echo-Test** bleibt als P7-Gate, klaert aber nur noch das exakte Payload-Format (rohe µ-law vs. RTP-gewrappt). Der **gefaehrlichste Einzelumbau** ist die Umstellung des heute globalen `MAX_BUDGET_EUR` auf pro-Tenant-Budget (Einsicht aus Vorschlag C): das kommt **bevor** ein zweiter zahlender Tenant live geht, aber **entkoppelt** von der DB-Migration (gegen C's Kopplungsfehler). Nummernkauf ist strukturell hinter dem State `requested` verriegelt (nur nach Stripe-Hold, capture-vor-provisionieren mit eigenem `capturing`-State), Transkripte wandern in eine **eigene Tabelle mit kuerzerer Retention** (Two-Party-Consent/DSGVO), und alle Safety-Gates sowie der fest verdrahtete Disclosure-Satz bleiben unangetastet. Eine **blockierende Vorab-Entscheidung** (Provider-Account-Modell: Pool-`tenant_id` vs. Subaccounts pro Tenant) muss vor dem Datenmodell-Design fallen, weil sie das Schema bestimmt.

---

## Wie das Team zu diesem Plan kam

Drei unabhaengige Vorschlaege, drei Linsen:

- **A (Architektur-Purist):** sauberste Abstraktion — vier Ports nach Bounded Context, schaerfste Realtime-Bridge-Analyse (Frame-Pipe / Lifecycle / Barge-in als drei Schichten), TeXML-statt-Call-Control mit Leak-Begruendung, `capturing`-State.
- **B (Inkrementell-Minimal):** beste Migrierbarkeit — `store.js` ist bereits die schmale Fassade (der Strangler-Hebel), P0 = reines Verschieben, Self-Service per Feature-Flag schlicht aus, kleinster Blast-Radius pro Schritt.
- **C (Scale/Safety/Kosten):** bester Betriebs-/Kostenrealismus — gestaffelter DB-Skalierungspfad, `transcript_segment` als eigene Tabelle, und die schaerfste Sicherheitseinsicht: global→pro-Tenant-Budget ist der gefaehrlichste Umbau und muss frueh kommen.

**Was das Kreuzverhoer (drei Gutachten) entschieden hat:**

1. **Basis = A's Architektur, NICHT als Startpunkt sondern als Nordstern.** Gutachten 1 (Architektur) waehlt A als Basis, weil die Port-Struktur sich nicht nachtraeglich transplantieren laesst (falsch geschnittene Ports = Rewrite), Inhalte aus C dagegen schon. Gutachten 3 (Shippability) waehlt B als Basis, weil A's P0 zu breit ist und A den `MediaTransport`-Port zu frueh einfriert. **Aufloesung:** A's Ziel-Struktur (vier Ports) + B's Phasen-Disziplin (P0 klein, schrittweise) — man baut A's Reinheit *auf* B's Naht auf, friert den Realtime-Port aber erst ein, wenn er implementiert wird.

2. **Budget-Timing einstimmig korrigiert.** Alle drei Gutachten: A legt das pro-Tenant-Budget zu spaet (P6), B zu spaet (P3 mit Zwischenfenster), C richtig frueh aber **falsch gekoppelt** (Budget + DB in einer Phase). Synthese-Beschluss: Budget-Tenantisierung **vor dem zweiten zahlenden Tenant**, aber als **eigene Phase nach** der stabilen Store-Fassade — C's Prioritaet ohne C's Kopplungsfehler.

3. **Reihenfolge-Korrektur gegen alle drei:** Gutachten 1 zeigt, dass Budget *vor* Tenant-Identitaet (C's P2) zu einem doppelten Umbau am sicherheitskritischen Gate fuehrt. Daher: **Tenant-Entitaet + Routing zuerst, dann sofort Budget** — kein zweiter zahlender Tenant davor.

4. **Realtime-Bridge:** alle drei Vorschlaege UND alle drei Gutachten kommen unabhaengig zum selben Schluss — **eine Bridge + ein Hook, WS-Echo-Test als Show-Stopper-Gate**. Robusteste Einzelentscheidung im Set, uebernommen.

5. **Raw-Body-Falle:** Gutachten 3 deckt auf, was alle drei Vorschlaege unterschaetzen — der Telnyx-Ed25519-Umbau kollidiert mit der bestehenden Reihenfolge `express.urlencoded` (server.js:55) → `validateRequest(req.body)` (server.js:91). Bekommt eine **eigene, isoliert getestete Phase**.

6. **Faktenkorrektur:** C's "9 Stellen `twilioNumber`" ist falsch (real 5, davon 3 call/SMS-relevant — selbst verifiziert). A's Zeilenangaben (Disclosure claude.js:51+56, bridge.js:93) am genauesten. Diese Praezision wird uebernommen.

---

## Zielarchitektur

### Vier provider-neutrale Ports (Bounded Contexts)

Leitregel: **Der Port spricht Domaene, nie Vendor-Sprache.** Keine Methode gibt TwiML/TeXML zurueck, reicht `CallSid`/`streamSid` durch oder kennt ein Twilio-Frame-Schema. Vier getrennte Interfaces statt Gott-Interface, weil die Aufrufer unterschiedliche Lebenszyklen und Skalierungsprofile haben:

```
src/telephony/
  ports.js          # JSDoc-Vertraege der vier Ports + neutrale Enums/Konstanten
  directives.js     # neutrale Call-Direktiven (answer/say/gather/stream/hangup/reject)
  registry.js       # provider-Name (aus number-Record) -> Adapter-Instanz
  adapters/
    twilio/         # bestehender Code, hierher extrahiert
    telnyx/         # neuer Primaer-Adapter (spaeter)
```

**Port 1 — `VoiceControl`** (Aufrufer: `server.js`-Hot-Path, Bridge):
- `originateCall({fromE164, toE164, answerUrl, statusUrl, maxDurationS, idempotencyKey})` → `{callRef}` — kapselt `calls.create` (server.js:413-431).
- `endCall(callRef)` — kapselt `calls(sid).update({status:"completed"})`, heute an 3 Stellen dupliziert (server.js Cancel + Max-Dauer-Timer, bridge.js:54).
- `verifyInboundSignature({headers, rawBody, url, parsedParams})` → `boolean`, **fail-closed** — Twilio: HMAC-SHA1 ueber URL+sortierte Params (heutiges `validateRequest`, server.js:91). Telnyx: Ed25519 ueber `timestamp|rawBody` + Replay-Window.
- `parseInboundWebhook(rawRequest)` → neutrales `{event, callRef, fromE164, toE164, status}` mit **eigenem** Status-Enum (`ringing|answered|completed|failed|busy|no-answer|cancelled`).
- `renderDirectives(directives[])` → Provider-Antwort-Body (TwiML/TeXML). **Der TwiML-Generator lebt hier, nicht im Core.**

**Port 2 — `Messaging`** (Aufrufer: `finishCall`-SMS, server.js:351-356):
- `sendSms({fromE164, toE164, body, idempotencyKey})` → `{messageRef}` — kapselt `messages.create`.

**Port 3 — `NumberProvisioning`** (Aufrufer: Provisioning-Worker, NICHT Hot-Path):
- `searchNumbers({countryCode, type, capabilities})` → `[{e164, type, capabilities, monthlyCostCents}]`.
- `getRequirements(countryCode, type)` → neutral `{fields[], documentsRequired[], addressProof, leadTimeDays}` (Telnyx Requirement-Groups; Twilio Regulatory-Bundles).
- `orderNumber({e164, tenantRef, requirementRef, idempotencyKey})` → `{providerNumberId, status: provisioning|active|failed}`.
- `configureNumber({providerNumberId, voiceWebhookUrl, smsWebhookUrl, statusCallbackUrl})` → setzt Routing.
- `releaseNumber(providerNumberId)` → `void`.

**Port 4 — `MediaTransport`** (Aufrufer: `bridge.js` — eigener Abschnitt unten).

**Neutrale Direktiven** (`directives.js`): Statt dass `server.js` TwiML baut (`gatherTurn`, `streamTwiml`, `say`), produziert es eine Liste wie `[{say, text, voiceProfile}, {gather, action}]`. `voiceProfile` ist ein **logischer** Name (`de-female-neural`), den der Adapter auf `Polly.Vicki-Neural` bzw. den Telnyx-Voice-Bezeichner mappt — Voice-Namen verlassen den Core nie.

### Adapter Twilio / Telnyx

| Baustein | Twilio | Telnyx | Leak-Risiko |
|---|---|---|---|
| `orderNumber`/`configureNumber` | Number-Update + Regulatory Bundle | `POST /v2/number_orders` + `requirement_group_id` + `connection_id`/`messaging_profile_id` | Niedrig |
| `verifyInboundSignature` | `validateRequest` (vorhanden) | Ed25519 + Timestamp | Niedrig — **aber Raw-Body-Umbau noetig (s.u.)** |
| `parseInboundWebhook` | `req.body.From/To/CallSid` | **TeXML liefert dieselben Twilio-Feldnamen** form-urlencoded | Sehr niedrig |
| `renderDirectives` | `VoiceResponse` | TeXML-String | Niedrig (Voice-Namen in Config) |
| `sendSms` | `messages.create` (form) | `POST /v2/messages` (JSON, Bearer) | Minimal |

**Architektur-Entscheidung Telnyx: TeXML, nicht Call-Control.** TeXML haelt **beide** Adapter im selben Paradigma (deklaratives Markup + form-urlencoded-Webhooks mit Twilio-Feldnamen). `parseInboundWebhook` bleibt fuer beide fast identisch, die Direktiven→Markup-Uebersetzung symmetrisch. Call-Control (imperativ, JSON-Webhooks) wuerde ein zweites, fundamental anderes Webhook-Modell in den Core ziehen — genau der Leak, den die oberste Direktive vermeidet.

### Realtime-Media-Bridge — die klare Antwort

**Eine Bridge, ein Strategy-Hook. KEINE zwei Implementierungen.** Begruendung an den verifizierten Zeilen:

Die Bridge zerfaellt in drei Schichten unterschiedlicher Kapselbarkeit:

- **Schicht 1 — Frame-Pipe:** Codec ist bei beiden Providern identisch (G.711 µ-law 8kHz mono base64, kein Transcoding). Die **OpenAI-Seite** der Bridge (`connectOpenAI`, `session.update`, Audio-Deltas, Transkript-Events, Tool-Loop in `response.done`) ist **vollstaendig provider-agnostisch** und bleibt unberuehrt — das sind ~90% des Codes. Nur die Provider-Seite braucht Normalisierung: `parseMediaFrame(raw)` (uebersetzt `streamSid`↔`stream_id`, `customParameters`↔`dynamic_variables`, `sequenceNumber`↔`sequence_number`) und `buildMediaFrame({payload, ref})` (heute `{event:"media", streamSid, media:{payload}}`, bridge.js:107).

- **Schicht 2 — Stream-Auth + Lifecycle:** Die `stream_token`-Pruefung beim `start`-Event (Anti-Hijack, `safeEqual`, bridge.js:185-187) ist Kernlogik und bleibt; nur die Feld-Extraktion geht durch `parseMediaFrame`.

- **Schicht 3 — Barge-in + Call-Ende (die HEIKLE STELLE):** **Doku-Recherche 2026-06-14: weitgehend symmetrisch.** Twilio verwirft gepufferte Audio mit `{event:"clear", streamSid}` (bridge.js:120); Telnyx hat denselben WS-Befehl `{event:"clear"}` ("Immediately stop the media playing on the stream and clear the media queue") — **kein REST-Umweg noetig** (die fruehere Sorge "evtl. nur `playback_stop` ueber REST" ist widerlegt). Einziger Rest-Unterschied: Telnyx braucht im Outbound-Frame keine `stream_id`. Call-Ende (bridge.js:49-54) laeuft schon ueber die VoiceControl-Ebene → geht sauber in `endCall(callRef)`. Offen bleibt nur das exakte Payload-Format (rohe µ-law-Samples wie Twilio vs. RTP-gewrappt) — das klaert der WS-Echo-Test (P7).

**Port 4 — `MediaTransport`:**
```
parseMediaFrame(raw)            // Feld-Normalisierung
buildMediaFrame({payload, ref}) // Audio raus
clearPlayback(ctx)              // Barge-in, Telnyx-Doku 2026-06-14 bestaetigt:
                                //   beide -> WS {event:"clear"} (symmetrisch); einziger Unterschied: Feld-/Payload-Normalisierung, KEIN REST-Umweg
```

`clearPlayback` ist die letzte provider-spezifische Verzweigung im sonst gemeinsamen Codepfad — und laut Doku-Recherche (2026-06-14) sogar symmetrisch (`{event:"clear"}` bei beiden). Zwei volle Bridges wuerden den HEIKLE-STELLE-Code duplizieren — also genau die gefaehrlichste Logik zweimal pflegen; deshalb eine Bridge. **WS-Echo-Test-Gate (jetzt Format-Bestaetigung, nicht mehr Existenz-Beweis):** Bevor ein Produktiv-Realtime-Call ueber Telnyx laeuft, verifiziert ein isolierter WS-Echo-Test gegen die Telnyx-Live-API das exakte Payload-Format (rohe µ-law vs. RTP-gewrappt) plus `clear`/`mark`/`stop`/`dtmf` end-to-end. Bis gruen bleibt Telnyx-Realtime hinter einem Flag. Pre-Mortem-Punkt aus C: das Max-Dauer-Gate (bridge.js Timer) greift erst nach `maxDurationS` — ein nicht beendeter Stream ist ein kostenpflichtiger Geistercall, deshalb ist der Echo-Test nicht optional.

**Akzeptierte, nicht wegabstrahierbare Provider-Spezifik** (alle Adapter-intern): `clearPlayback`-Mechanismus, Voice-Namen-Mapping, Recording-Channel-Defaults (Telnyx dual, Twilio single), Signatur-Krypto.

---

## Datenmodell & DB-Migration

### DB-Wahl: PostgreSQL

Begruendung: `store.js` haelt `state` global im Speicher und macht bei jeder Mutation `save()` = `writeFileSync` des **Gesamtobjekts** (store.js:42, 85-87). Bei zwei parallelen Webhooks verschiedener Tenants → **lost updates**. Das ist kein Skalierungs-, sondern ein **Korrektheitsproblem** ab dem ersten Parallelbetrieb. Postgres: `tenant_id`-Spalte (Pool-Modell), **Row-Level-Security** als zweite Verteidigungslinie, `UNIQUE(e164)` als Constraint statt App-Logik, indexierte per-Tenant-DSGVO-Loeschung. **Queue bleibt in Postgres (pg-boss)** — kein Redis, ehrt die Repo-Doktrin "wenige Dependencies".

### Entitaeten

```
tenant(id, idp_subject UNIQUE, display_name, status: active|suspended|closed,
       kyc_level: none|otp|card|id_verified, stripe_customer_id, country, created_at)
  -- idp_subject = heutige Identity (auth.js liefert req.auth.{sub,email})

number(id, tenant_id FK, e164 UNIQUE, provider: twilio|telnyx, provider_number_id,
       country_code, type: local|mobile|tollfree, capabilities,
       status: <State-Machine>, voice_webhook_url, created_at, activated_at)

number_assignment(number_id FK, tenant_id FK, assigned_at, released_at)
  -- Recycling-Hygiene: frisch freigegebene Nummer nicht sofort neu vergeben

call(<alle heutigen Felder aus store.createCall> + tenant_id FK + provider
     + provider_call_ref + stream_token)
  -- requestedBy bleibt (store.js:115)

transcript_segment(call_id FK, tenant_id FK, role, text, at)
  -- NUR FLUECHTIG waehrend des aktiven Calls (Live-Dashboard + Summary-Erzeugung).
  -- BESCHLUSS 2026-06-14: nach Call-Ende wird das Roh-Transkript GELOESCHT, nur Summary
  -- + Action Items bleiben (Datenminimierung). Persistenz hoechstens als kurzlebige
  -- Zeile, die finishCall nach erfolgreicher Summary purged; Roh-Transkript erreicht
  -- NICHT die Langzeit-Retention. (Two-Party-Consent/DSGVO; per-Tenant-Loeschung + RLS
  -- gelten weiter fuer die fluechtige Phase.)

action_item, calendar_event, notification   -- je + tenant_id FK

usage_event(id, tenant_id FK, call_id FK, kind: voice_minute|ai_token|sms|number_month,
            quantity, cost_cents, occurred_at, stripe_meter_sent bool)
  -- append-only, ersetzt globales settings.usage; Quelle fuer Budget UND Stripe

tenant_budget(tenant_id PK, period_start, budget_cents, spent_cents, hard_cap_cents)
  -- ersetzt globales MAX_BUDGET_EUR

profile(tenant_id PK, <PROFILE_FIELDS aus store.js: allowed_numbers,
        allowed_country_codes, unrestricted, max_calls_per_hour, allow_calendar, allow_booking>)
  -- heutige profiles{}-Map, jetzt 1:1 zu tenant statt keyed-by-email

provisioning_job(id, number_id FK, state, attempts, idempotency_key,
                 payment_intent_id, last_error, next_run_at)
  -- pg-boss-backed
```

### Number-Lifecycle als State-Machine (mit `capturing`)

```
requested ──(Stripe-Hold: PaymentIntent requires_capture)──> provisioning
provisioning ──(provider order ok)──> capturing
provisioning ──(provider error/timeout)──> failed ──(Hold cancel)──[ende]
capturing    ──(Stripe CAPTURE ok)──> active
capturing    ──(capture fail)──> failed ──(releaseNumber rollback + Hold cancel)──[ende]
active ──(payment fail | abuse-flag | budget-hard-cap | manual)──> suspended
suspended ──(zahlung ok | unblock)──> active
active|suspended ──(churn | grace abgelaufen)──> releasing ──(release ok)──> released [terminal]
```

Drei nicht-verhandelbare Design-Punkte:
- **`provisioning` explizit** und getrennt von `active` → keine "halb gekauften" Nummern.
- **`capturing` als eigene Transition:** `active` nur nach Stripe-**Capture**, nicht nach Authorization (Stripe-Doku: Ressource erst nach Capture provisionieren). Capture-Fail nach erfolgreicher Order → `releaseNumber`-Rollback. Das ist eine eigene Kante, kein If.
- **Grace-Period vor `released`** (terminal, oft nicht zurueckholbar). Jeder Provider-Call mit `idempotency_key` (Retry kauft nie doppelt).

### Migrationsweg vom JSON-Store

`store.js` exportiert ~30 Funktionen, die `server.js`/`bridge.js`/`claude.js`/`mcp-tools.js` ueber `store.X()` aufrufen — **das ist der Strangler-Hebel** (verifiziert). Diese Signaturen werden zum Repository-Port:
1. `store.js` → `store/json.js` (1:1, kein Verhaltenswechsel); `store/index.js` re-exportiert. Caller unveraendert.
2. `store/pg.js` mit identischen Signaturen hinter `STORE_BACKEND=json|pg`. Single-Tenant-Daten = **ein Owner-Tenant**, damit der heutige Pfad bitidentisch bleibt.
3. Heute globale Funktionen (`budgetExceeded`, `countOutboundCallsSince`, `trackUsage`) bekommen `tenantId`-Param; Owner-Tenant ist Default → keine Verhaltensaenderung im Bestand.
4. **Sauberer Schnitt (Beschluss #8):** PG startet leer, KEIN Import der `data/store.json` (kein Roundtrip-Test noetig). **Gesamte Suite laeuft gegen BEIDE Backends.** Rollback in der Uebergangszeit = `STORE_BACKEND=json`.

Das ist exakt das bestehende Phase-1/2-Muster (Env-Flag, Owner als Default, Bestandstests bleiben gruen).

---

## Onboarding-Flow

```
1. Registrierung      -> tenant{status:active, kyc_level:none}. KEINE Nummer.
2. IdP-Login          -> idp_subject (auth.js liefert sub/email schon).
3. Land + Typ waehlen -> searchNumbers (Anzeige) + getRequirements: zeigt Lead-Time +
                         Doku-Pflicht EHRLICH ("DE-Ortsnummer: ID + Adressnachweis, ~1-5 Werktage").
4. Verifikation       -> risk-based: OTP + Karte als Default; ID-Verifikation eskaliert bei
                         DE-Geo-Nummer (Adresspflicht) / Outbound-Volumen-Schwelle. kyc_level steigt.
5. Zahlung (Hold)     -> Stripe PaymentIntent capture_method=manual -> requires_capture.
                         number{status:requested}. KEIN Provider-Call. >>> HTTP-Request endet hier <<<
6. Async-Provisioning -> Worker (pg-boss): orderNumber -> provisioning ; bei Doku-Pflicht
                         requirement_group_id ; configureNumber(voiceWebhookUrl).
7. Capture            -> nach Provider-Erfolg: Stripe capture -> capturing -> active -> assignment-Row.
8. Bindung            -> number.tenant_id gesetzt, voice_webhook_url -> /voice/incoming.
9. Fehlerpfad         -> order/capture fail -> failed + releaseNumber-Rollback + Hold cancel.
                         Kunde zahlt nie fuer eine Nummer, die nie kam.
```

### Wie "KEIN Nummernkauf vor Zahlung/Verifikation" **strukturell** garantiert wird (drei Schloesser, fail-closed)

1. **Datenmodell-Schloss:** `orderNumber` ist **ausschliesslich** vom Provisioning-Worker aufrufbar, nie aus einem HTTP-Handler. Der Worker zieht Jobs **nur** fuer Numbers im Zustand `requested`.
2. **State-Machine-Schloss:** Eine Number erreicht `requested` **nur** ueber die Transition `(Stripe-Hold ok)` UND erreichte `kyc_level`. Kein Hold → kein `requested` → kein Job → kein `orderNumber`. Kein Default umgeht das.
3. **Idempotenz-Schloss:** Jeder `orderNumber`-Call traegt `idempotency_key` (number_id-basiert) → Worker-Retry kauft nie doppelt.

Zusaetzlich, aus B: In den fruehen Phasen (vor Billing) ist **Self-Service-Provisioning per Feature-Flag schlicht abgeschaltet** — ein Pfad, der nicht existiert, kann nicht missbraucht werden. Nummern werden bis dahin Admin-zugeteilt. Das ist dieselbe fail-closed-Disziplin wie die heutigen Number-Gates: der Geld kostende Effekt ist hinter einem Zustand verriegelt, nicht hinter einem Flag.

---

## Inbound-/Outbound-Routing-Umbau

### Inbound: viele Nummern → richtiger Tenant

Heute: `/voice/incoming` liest `req.body.To || config.twilioNumber` (server.js:241) rein informativ. Zielbild: **Ein gemeinsamer Webhook + `To`-Lookup aus EIGENER DB** (nicht pro-Nummer-URLs — Routing-Wahrheit bleibt bei uns, ein Provider-/Domain-Wechsel aendert dann kein Routing).

Reihenfolge ist **sicherheitskritisch und fail-closed**:
1. **Zuerst `verifyInboundSignature`.** Erst danach `To` aus dem *signierten* Body lesen. Niemals `To` vor der Signaturpruefung vertrauen — sonst Tenant-Spoofing. Das spiegelt exakt das bestehende `x-internal-identity`-Anti-Spoof-Muster (server.js:27-34, nur von localhost akzeptiert).
2. `number`-Lookup `e164 → tenant_id` (gecached, Hot-Path <50ms, Invalidierung bei Statuswechsel).
3. Kein Mapping-Treffer → fail-closed: hoeflicher Hangup, Audit, **kein Default-Tenant**.
4. Greeting/Profile/Kalender aus DEM Tenant, nicht global.

### Outbound: Tenant-eigene Nummer als From

Heute: `from: config.twilioNumber` an 3 Stellen (server.js:354 SMS, 415/429 Call). Umbau:
- `from` = `number.e164` des aufrufenden Tenants, aufgeloest ueber `requestedBy`/`tenant_id` des Call-Records.
- Adapter-Wahl ueber `number.provider` aus der `registry` — ein Telnyx-Tenant ruft ueber Telnyx, ein Twilio-Tenant ueber Twilio, **im selben Codepfad**.
- `config.twilioNumber` wird zur **Owner-Tenant-Nummer** degradiert (Fallback fuer den Bestand), **nicht entfernt** — so bleibt der Single-Tenant-Betrieb in den fruehen Phasen unveraendert lauffaehig. `assertConfig` (config.js:96) lockert `TWILIO_NUMBER` von "required" zu "required nur, wenn kein Tenant-Nummern-Backend aktiv".
- `get_my_number` (mcp-tools.js) wird tenant-aware: liefert die Nummer des authentifizierten Tenants (Identity via `X-Internal-Identity` schon vorhanden), Owner ohne Identity → Owner-Nummer.

---

## Pro-Tenant Safety-Gates & Billing

### Was global bleibt (harte Obergrenze, nie aufweichbar — Regel 1)

Die heutige Doktrin in `numberGateError` (server.js:180) ist bereits richtig geschichtet — Profil kann nur **einschraenken**. Das bleibt:
- **Denylist** (Notruf 110/112/911/999, Premium-Praefixe) — global, hardcoded, nie pro-Tenant lockerbar.
- **Land-Obergrenze** (`ALLOWED_COUNTRY_CODES`, config.js:33) — Plattform-Maximum; Tenant-Profil bildet Schnittmenge.
- **Globales Stundenlimit** (`MAX_CALLS_PER_HOUR`) als plattformweite Notbremse.
- **Signaturpruefung** (→ `verifyInboundSignature`, fail-closed in **beiden** Branches).

### Global → pro-Tenant-Budget (der gefaehrlichste Einzelumbau)

Verifiziert: `budgetExceeded(cfg)` (store.js:233) prueft `usage.costEur >= cfg.maxBudgetEur` **global**, `trackUsage` (store.js:221) schreibt in ein **globales** Objekt, beide ohne `tenantId`. Bei Multi-Tenant **falsch** (ein Tenant verbraucht das Budget aller → Cross-Tenant-DoS oder ungedeckelte Kosten). Umbau:
- `trackUsage(input, output, cfg, tenantId)` schreibt `usage_event` mit `tenant_id`.
- `budgetExceeded(cfg, tenantId)` prueft `tenant_budget.spent_cents >= hard_cap_cents`.
- **Zwei-stufig:** weiches Inklusiv-Kontingent (→ usage-based Billing darueber) UND harter `hard_cap_cents` (→ Call-Sperre, Number `suspended`). Der harte Cap ist Safety **und** Geschaeftsmodell-Schutz (Voice-Minuten = ~60-80% der variablen Kosten, ~$0.25/min Realtime — ein 10x-Tenant darf keine Flat sprengen).
- **Globaler Plattform-Notaus bleibt zusaetzlich** (Schnittmenge: ein Call ist erlaubt nur, wenn Tenant-Budget UND Plattform-Budget frei sind). Globaler Deckel wird **nie entfernt, nur ergaenzt** — Regel 1 eingehalten.

### Pro-Tenant-Allowlist/Limits + neue Abuse-Gates

Existiert bereits konzeptionell: `resolveProfile` + `allowedNumbers`/`unrestricted`/`maxCallsPerHour` (effektiv `min(global, profil)`). Wandert 1:1 in `profile(tenant_id)`. `countOutboundCallsSince(since, requestedBy)` → `(since, tenantId)`, Logik unveraendert. Neue fail-closed-Gates:
- **Geo-Lock** — nur per KYC freigeschaltete Ziel-Laender (verschaerft das Land-Gate pro-Tenant).
- **KYC-Gate vor erstem Outbound** — `kyc_level >= card` (Number-Provisioning erzwingt das ohnehin).
- **Velocity pro Tenant** — Calls/Tag + Minuten/Tag zusaetzlich zum Stundenlimit; Ueberschreitung → `suspended` (State-Machine, nicht nur Call-Reject).
- **Number-Warm-up** — Outbound-Volumen-Rampe fuer frische Nummern (Reputation); **Recycling-Hygiene** ueber `number_assignment`.

### Disclosure bleibt fest verdrahtet (Regel 2)

`disclosureSentence(call)` (claude.js:56+) bleibt der **fest verdrahtete erste Satz** — in **beiden** Engines (claude.js:51 Prompt-Pfad/Budget-Engine UND bridge.js:93 Realtime-Opener). Keine Tenant-Einstellung darf ihn abschalten. EU-AI-Act Art. 50(2) (ab 08/2026, maschinenlesbare KI-Markierung der synthetischen Stimme) ist eine **zusaetzliche, getrennte** Pflicht — siehe offene Entscheidung 6, ersetzt den gesprochenen Satz nie.

### Billing (Stripe)

- **Stripe-Customer = Tenant** (`tenant.stripe_customer_id`).
- **Drei Meter:** (1) Nummern → recurring Subscription-Item pro aktiver Number (monatlich); (2) Voice-Minuten → metered, je beendetem Call (Dauer × Provider-Rate, provider-spezifisch im Adapter); (3) AI-Tokens → metered, je `trackUsage` (heutige Cost-Engine `priceIn/OutPerMTokUsd`, config.js, liefert die Zahlen).
- **App-seitige Aggregation:** `usage_event` sammelt roh (append-only, `stripe_meter_sent=false`); periodischer Flush schickt **ein** Meter-Event/Tenant/Periode (unter Stripe-Rate-Limits).
- **Provision-after-payment** an die State-Machine gekoppelt: `manual capture` Hold → `orderNumber` → `capture` → `active`; Capture ist die Transition-Bedingung, nicht Authorization.

---

## Phasen-Roadmap

Prinzip: jede Phase **deterministisch pruefbar** (neuer `node:test` + Bestand bleibt byte-identisch gruen), Twilio bleibt Default und durchgehend lauffaehig (Owner = Default-Tenant). **P0 ist bewusst klein** (gegen A's zu breites P0): nur Client-Aufrufe verschieben, der Direktiven-Renderer kommt separat in P1.

---

**P0 — VoiceControl/Messaging-Client-Aufrufe hinter den Port (reines Verschieben, TwiML bleibt inline)**
- **Ziel:** `originateCall`/`endCall`/`sendSms` als Port; `calls.create`/`messages.create`/`calls(sid).update` dahinter. **`VoiceResponse`-Bauten bleiben vorerst inline** — kleinster Blast-Radius.
- **Dateien:** neu `src/telephony/{ports,registry}.js` + `adapters/twilio/{voice,messaging}.js`; `server.js` (Call-Sites 354/413-431 + Cancel/Max-Dauer-Timer → Port); `bridge.js:54` (`endCall`); `config.js` (Twilio-Config in Adapter-Scope).
- **Pruefbar:** Bestehende Suite (`api`, `number-gate`, `media-token`, `oauth`, `security`) **vollstaendig gruen ohne Test-Aenderung**. `node --check` aller Dateien. Smoke `/voice/incoming` via `SKIP_TWILIO_SIGNATURE_CHECK=true` + curl liefert identisches TwiML.
- **Risiko:** Niedrig — reiner Move; `bridge.js` HEIKLE STELLE nur an `endCall`.

**P1 — Direktiven-Renderer + Voice-Profile aus Config**
- **Ziel:** `renderDirectives` ersetzt direkte `VoiceResponse`-Bauten; Voice-Name (`Polly.Vicki-Neural`) → logischer `voiceProfile`.
- **Dateien:** `server.js` (`say`/`gatherTurn`/`streamTwiml` → Direktiven); `adapters/twilio/render.js`; `directives.js`.
- **Pruefbar:** Snapshot-Test: Direktiven → erwartetes TwiML **byte-genau** gegen heutiges Output. Bestand gruen.
- **Risiko:** Niedrig.

**P2 — Raw-Body-Middleware + `verifyInboundSignature`-Port (isoliert, fail-closed in beiden Branches)**
- **Ziel:** Signaturpruefung wird Port-Methode; rawBody fuer kuenftigen Ed25519-Pfad erhalten, **ohne** den Twilio-HMAC-Pfad zu schwaechen.
- **Dateien:** `server.js` — rawBody ueber `verify`-Callback von `express.urlencoded` (server.js:55) UND `express.json` (server.js:56), `req.body` bleibt geparst fuer `validateRequest` (server.js:91).
- **Pruefbar:** Neuer Test: gefaelschte Signatur → 403 (beide Provider-Stubs); gueltige → 200; manipulierter Body → reject. Bestehender Twilio-Signatur-Test bleibt gruen.
- **Risiko:** **Mittel** — Middleware-Stack beruehrt den Body-Parser, von dem der Twilio-HMAC-Pfad abhaengt. Eigene isolierte Phase, weil ein Fehler hier Safety-Gate Nr. 1 zerstoert (von allen drei Vorschlaegen unterschaetzt, von Gutachten 3 aufgedeckt).

**P3 — Store-Port + Postgres-Backend + Tenant-Entitaet + Inbound-`To`-Routing (Owner = Default-Tenant)**
- **Ziel:** `store.js` → `store/json.js` + `store/pg.js`, `STORE_BACKEND`-Flag. `tenant`/`number`/`number_assignment`/`transcript_segment`-Schema. `profiles{}` → `tenants`. Inbound nutzt verifizierten `To` → Tenant-Lookup, Owner als einziger Eintrag. **`transcript_segment` von Anfang an als eigene Tabelle** (nicht nachgeruestet).
- **Dateien:** `store.js` (Split), `src/db/{schema.sql,migrate.js}`, alle Caller (nur wo `tenantId` durchgereicht wird), `server.js` (`/voice/incoming` :241, `resolveProfile`-Aufrufe), `auth.js` (email/sub → tenant). Neu: pg-boss-Dependency.
- **Pruefbar:** **Gesamte Suite gegen BEIDE Backends** (`json`=heute, `pg`=Test-DB). (Roundtrip-Import entfaellt — sauberer Schnitt, Beschluss #8.) Anruf an bekannte Nummer → richtiger Tenant (Smoke); **unbekannte `To` → fail-closed-Reject, kein Default-Tenant** (Test); Anti-Spoof-Test (`To` ohne gueltige Signatur). Cross-Tenant-Read = leer (analog bestehendem Anti-Spoof-Test).
- **Risiko:** **Mittel-hoch** — groesste Phase; Mitigation: JSON-Backend bleibt parallel lauffaehig, kein Cutover-Zwang, Rollback = Env-Flag.

**P4 — Pro-Tenant-Budget + pro-Tenant-Gates (HART vor zweitem zahlenden Tenant, entkoppelt von P3)**
- **Ziel:** `budgetExceeded(cfg, tenantId)` + `trackUsage(..., tenantId)` + `tenant_budget`/`usage_event`. Globaler Notaus bleibt parallel (Schnittmenge). `numberGateError`/`countOutboundCallsSince` tenant-parametrisiert. Geo-Lock, Velocity, KYC-Gate.
- **Dateien:** `server.js` (Budget-Checks :231/:407, Gate-Kette :180, From-Aufloesung), `store/pg.js`/`store/json.js` (`tenant_budget`, `usage_event`), `config.js`.
- **Pruefbar:** Tenant A's Budget erschoepft → A geblockt, B telefoniert weiter (Test); globaler Notaus greift bei Summe (Test); Owner-Demo unveraendert; jede Gate-Aenderung mit Test, der das ALTE restriktive Verhalten als Untergrenze festschreibt.
- **Risiko:** **Hoch** — Sicherheits-/Geld-Pfad. Mitigation: **entkoppelt von der DB-Migration** (P3 erst stabil + getestet), gegen C's Kopplungsfehler. Harte Phasen-Gate-Bedingung: kein zweiter zahlender Tenant geht live, bevor P4 gruen ist.

**P5 — Telnyx-Adapter (SMS + TeXML + Provisioning), KEINE Realtime-Bridge**
- **Ziel:** Telnyx fuer `sendSms`, `renderDirectives` (TeXML), `verifyInboundSignature` (Ed25519), `NumberProvisioning`. Budget-Engine end-to-end ueber Telnyx fuer einen Test-Tenant. **Beweist den Port-Vertrag frueh** (gegen C's "Telnyx zu spaet").
- **Dateien:** `adapters/telnyx/*`, `registry.js`. Kein `bridge.js`.
- **Pruefbar:** Adapter-Unit-Tests (TeXML-Output, Ed25519-verify mit Test-Vektoren, SMS-Body-Shape). Smoke gegen Telnyx-Test-Nummer: inbound TeXML-Webhook → korrekter Tenant; outbound Budget-Call. Contract-Test gruen fuer beide Adapter. **Twilio-Tenant unveraendert.** Dichtheits-Test: aendert der zweite Adapter nur Dateien in `adapters/telnyx/`?
- **Risiko:** Mittel — Telnyx-Feldsignaturen teils unbestaetigt; Mitigation: echten TeXML-Webhook dumpen + `/v2/messages`-Shape live verifizieren **vor** Adapter-Finalisierung.

**P6 — Onboarding + Stripe Hold/Capture + Provisioning-Worker**
- **Ziel:** Tenant-Onboarding, Stripe `manual capture`, Number-Lifecycle-Worker (pg-boss), `capturing`-State + Rollback. Self-Service-Flag an.
- **Dateien:** neu Onboarding-Routen, `src/worker/*`, `src/billing/stripe.js`; `server.js`; `public/` (Onboarding-/Billing-UI).
- **Pruefbar:** State-Machine-Tests (jede Transition + Rollback bei Capture-Fail = **kein `active` ohne Capture**). **Invariante-Test: `orderNumber` nie ohne vorausgehenden Hold.** Order-Fail → Hold-Cancel + `failed` (Test). Idempotenz bei Retry (Test). Stripe-Test-Mode.
- **Risiko:** Mittel-hoch — echtes Geld, echte Provider-Orders. Mitigation: Stripe-Test-Mode, harte Invarianten als Test, Grace-Period vor `released`.

**P7 — Telnyx-Realtime ueber `MediaTransport`-Port (der heikle Teil, isoliert) — NUR nach gruenem WS-Echo-Test**
- **Ziel:** `parseMediaFrame`/`buildMediaFrame`/`clearPlayback` als Port; Telnyx-Media als zweiter Transport.
- **Dateien:** `bridge.js` (Frame-Schicht + `clearPlayback`-Hook; OpenAI-Seite unangetastet).
- **Pruefbar:** **WS-Echo-Test ZUERST** gegen Telnyx-Live-API. Existenz von Barge-in (`clear`) ist per Doku bereits bestaetigt (2026-06-14); der Test verifiziert das exakte **Payload-Format** (rohe µ-law vs. RTP-gewrappt) + `clear`/`mark`/`stop`/`dtmf` end-to-end. Frame-Roundtrip-Test (µ-law base64 rein = raus). Twilio-Realtime-Pfad bleibt **byte-identisch**.
- **Risiko:** **Mittel-hoch** (herabgestuft, seit Barge-in per Doku bestaetigt) — bleibt die HEIKLE STELLE. Mitigation: symmetrischer Strategy-Hook, Live-Test vor Produktiv-Traffic, Twilio-Realtime bleibt Default-Fallback. Bis Echo-Test gruen: Telnyx-Realtime hinter Flag.

**P8 — Ops/Scale + DSGVO-Tiefe**
- **Ziel:** PgBouncer (Transaction-Mode ~10k, mehrere + `auth_query` ~100k, Read-Replicas + Zeit/Tenant-Partitionierung von `calls`/`usage_events` ~1M); Metering-Aggregations-Flush; per-Tenant-DSGVO-Loeschung; getrennte Transkript-Retention (kuerzer als Call-Metadaten).
- **Dateien:** Infra/`render.yaml`, `store/pg.js` (per-Tenant-Prune, heute global `pruneOldData`), `config.js`.
- **Pruefbar:** Lasttest; per-Tenant-Loeschung entfernt nur den einen Tenant (Test); Transkript-Retention kuerzer als Call-Retention (Test).
- **Risiko:** Mittel. Architektur-Weichen (Partition-Key) muessen schon in P3 richtig gesetzt sein, Umsetzung kommt spaet.

---

### Tech-Debt (bewusst deferred)

- **P0/P15 — DI des Telefonie-Clients:** `src/telephony/adapters/twilio/client.js` nutzt ein Lazy-Init-Singleton (`if (!client) ...`) - vom Clean-Code-Katalog als P15/N7-Smell markiert, in P0 bewusst belassen (verhaltenserhaltend, entspricht dem Master-Pattern, Node-single-threaded ungefaehrlich). **Sauberer Fix (Client injizieren statt lazy konstruieren) wird in P3/P5 nachgezogen**, wo die Registry ohnehin pro Tenant Adapter/Client aufloest. (Beschluss 2026-06-14: defern.)

- **P3c/P6 — E.164-Normalisierung des Owner-Nummer-Seeds:** Der Inbound-Lookup normalisiert `To` via `normNum` (strippt Space/Dash/Paren, `src/server.js`), der Owner-Nummer-Seed speichert `config.twilioNumber` aber RAW (`src/db/migrate.js` seedDefaults + `src/store/state-ops.js` seedOwnerNumber). Heute KEIN Defekt: Twilio liefert `To` bereits in E.164 und `.env.example` dokumentiert `TWILIO_NUMBER` als sauberes `+49...`-Format; eine Fehlkonfiguration (Env mit Leerzeichen/Dash) scheitert **fail-closed** (Nummer routet nicht, statt falsch zu routen). **P6-Fix (Defense-in-Depth):** `TWILIO_NUMBER` beim Seed durch dieselbe E.164-Normalisierung wie der Lookup schicken. (Aus dem P3c-Clean-Code-Audit 2026-06-14, S3, nicht-blockierend.)

- **P5/P6 — `provider`-Default als benannte Konstante:** Der Provider-Wert `"twilio"` ist beim Owner-Number-Seed an zwei Stellen hardcoded (`src/store/state-ops.js` seedOwnerNumber + `src/store/pg.js` flushNumbers). In P3c akzeptiert (einziger Provider, einziger Owner-Seed). **Fix sobald P5/P6 Multi-Provider bringt:** in eine benannte `DEFAULT_PROVIDER`-Konstante ziehen (G25/Konsistenz), wenn echte provider-Werte (Telnyx) ins Spiel kommen. (Aus dem P3c-Clean-Code-Audit 2026-06-14, S4, nicht-blockierend.)

## Pre-Mortem: Top-Risiken + Mitigationen

**Rahmen: Ein Jahr in der Zukunft (06/2027) — der Umbau ist gescheitert. Was ist passiert?**

**R1 — Ungewollter Anruf (Fehlrouting / falscher Tenant).**
*Was passierte:* Beim Adapter-Umbau (P0/P5) wurde `from`/`to` vertauscht, oder ein `To`-Lookup-Cache war stale, oder ein recyceltes `number_assignment` zeigte auf den Vorbesitzer — ein Anruf landete bei der falschen Persona / der Agent rief im Namen des falschen Tenants an.
*Mitigation:* `originateCall` nur mit aufgeloester `tenant_id` → `number.e164`; Number-Gates (`numberGateError`) laufen **vor** jedem Adapter, provider-unabhaengig; Inbound erst `verifyInboundSignature`, DANN `To` (Anti-Spoof); **kein Default-Tenant** bei Miss; `number_assignment`-Historie + Recycling-Karenz + Cache-Invalidierung bei Statuswechsel; P0-Test prueft byte-identisches Verhalten; Disclosure fest verdrahtet als letzte Absicherung gegen heimliche Anrufe.

**R2 — Kostenexplosion.**
*Was passierte:* Globales `MAX_BUDGET_EUR` durch pro-Tenant-Budget ersetzt, aber globale Notbremse vergessen; ODER ein zweiter zahlender Tenant ging live, bevor P4 stand (das Zwischenfenster, das B's Reihenfolge erzeugt haette); ein kompromittierter/10x-Tenant fuhr Voice-Minuten hoch.
*Mitigation:* `hard_cap_cents` pro Tenant **plus** globaler Notaus (Schnittmenge, beide fail-closed, globaler nie entfernt); **harte Phasen-Gate-Bedingung: kein zweiter zahlender Tenant vor gruener P4**; Number `suspended` bei Cap; Velocity-Gate; KYC vor erstem Outbound; `MAX_CALL_DURATION_S` bleibt.

**R3 — Transkript-Leak.**
*Was passierte:* DB-Migration (P3) ohne RLS, eine Query ohne `tenant_id`-Filter; Tenant A sah Transkripte von B. ODER: Transkripte als Array im Call (alter Stand) → per-Tenant-Loeschung wurde Full-Table-Scan, alte Transkripte blieben liegen → DSGVO + Two-Party-Consent-Verstoss. ODER EU-Transkripte auf US-Infra ohne SCC.
*Mitigation:* **Staerkste Massnahme (Beschluss 2026-06-14): Roh-Transkripte werden nach Call-Ende geloescht — es liegt fast kein Gespraechsinhalt at rest** (nur Summary/Action Items), der Leak-Blast-Radius fuer Transkripte ist damit minimal. Zusaetzlich: **`transcript_segment` mit `tenant_id` + RLS** auch fuer die fluechtige Phase; jeder Store-Query `tenant_id`-pflichtig (Cross-Tenant-Read-Test = leer); `publicCall`-Whitelist (server.js:214) filtert `streamToken` schon heute — Muster beibehalten, nie Secrets/Transkripte in MCP-Ausgaben (Regel 4/5); Datenresidenz = offene Entscheidung 4.

**R4 — Toll-Fraud / Provisioning-Abuse.**
*Was passierte:* Self-Service mit gestohlener Karte → Wegwerf-Nummern fuer IRSF/SMS-Pumping; Plattform trug Carrier-Kosten + Chargebacks + Reputationsschaden. Karte wurde faelschlich als Identitaets-Gate verstanden.
*Mitigation:* Nummernkauf strukturell hinter `requested` (nur nach Hold, drei Schloesser); Self-Service bis P6 per Flag aus; Geo-Lock fail-closed; Denylist global; risk-based KYC-Eskalation (ID bei DE-Geo/Volumen) — Karte ist **nicht** das Identitaets-Gate; Number-Warm-up + STIR/SHAKEN anstreben.

**R5 — Provider-Lock-in TROTZ Abstraktion.**
*Was passierte:* Die Bridge-HEIKLE-STELLE (`clear`) liess sich bei Telnyx nicht symmetrisch loesen; Telnyx-Code sickerte in den gemeinsamen Bridge-Pfad. ODER der Port wurde "shaped like Twilio" entworfen (gab heimlich TwiML zurueck, reichte `CallSid` durch), und ein zweiter Adapter erzwang Aenderungen quer durch `server.js`/`bridge.js`. ODER der `MediaTransport`-Port wurde in P0 eingefroren, aber erst in P7 implementiert — und passte dann nicht.
*Mitigation:* Port **vor** Adapter in Domaenensprache (kein `CallSid`/TwiML im Core); `clearPlayback` als expliziter Strategy-Hook (laut Doku 2026-06-14 sogar symmetrisch, `{event:"clear"}` bei beiden — Restrisiko nur noch das Payload-Format); **`MediaTransport`-Port erst in P7 final eingefroren** (gegen das Zu-frueh-Einfrieren, das Gutachten 3 bei A aufdeckte); WS-Echo-Test als P7-Gate (Payload-Format-Bestaetigung); Telnyx-Adapter frueh in P5 (beweist den Port-Vertrag, bevor viel darauf aufbaut); Dichtheits-Test "aendert ein zweiter Adapter nur Dateien in `adapters/<x>/`?".

---

## Offene Entscheidungen fuer den Auftraggeber

**1. Provider-Account-Modell — BESCHLOSSEN (2026-06-14): Pool.**
Pool-Modell (eine DB, `tenant_id`-Spalte) vs. Subaccounts/Managed Accounts pro Tenant (harte Billing-/Compliance-Isolation, aber konkurrierendes Schema). Gutachten 1 markiert das als die groesste Schema-Weiche — ein nachtraeglicher Wechsel ist ein Rewrite.
**BESCHLUSS:** **Pool-Modell mit `tenant_id` + RLS.** Pro-User-Budget ist damit sauber moeglich (Anwendungslogik auf `tenant_id`; die dominante KI-Kostenposition zwingt ohnehin zu app-seitigem Metering, unabhaengig vom Account-Modell). Subaccounts erst, wenn ein Enterprise/Vodafone-Silo physische Isolation vertraglich erzwingt. Damit ist die blockierende P3-Schema-Weiche gesetzt.

**2. Realtime-Engine bei Telnyx. — BESCHLOSSEN/aktualisiert (2026-06-14, Doku-Recherche).**
Frage war: hat Telnyx ueberhaupt Barge-in ueber WS? **Recherche-Ergebnis: Ja.** Telnyx Media Streaming ist bidirektional, Codec PCMU 8000 Hz mono (identisch zu Twilio), und kennt den WS-Befehl `{event:"clear"}` ("Immediately stop the media playing on the stream and clear the media queue") — das exakte Barge-in-Primitiv, **kein REST-Umweg**. Das Protokoll ist fast deckungsgleich mit Twilio (Events connected/start/media/dtmf/mark/stop, Befehle media/clear/mark; Unterschied vor allem snake_case `stream_id` vs camelCase `streamSid`).
**BESCHLUSS:** Telnyx-Realtime ist **in Scope** (nicht budget-engine-only). Der WS-Echo-Test (P7) bleibt, klaert aber nur noch das exakte Payload-Format (rohe µ-law vs. RTP-gewrappt), nicht die Existenz von Barge-in. Risiko R5 (Bridge-Lock-in) deutlich gesenkt; `clearPlayback`-Hook ist symmetrisch.
Quelle: developers.telnyx.com/docs/voice/programmable-voice/media-streaming

**3. Zielmaerkte. — BESCHLOSSEN (2026-06-14): DE-only.**
DE-only, DACH, oder DE+UK+US? Bestimmt KYC-Tiefe, Lead-Times (DE-Geo: Adresse+ID ~1-5 Tage; US-SMS: 10DLC 10-15 Tage) und TCPA-Consent-Pflicht (Allowlist ≠ "prior express consent").
**BESCHLUSS:** **Launch DE-only** (passt zu DE-Server #4 und Single-Tenant-Start #7). Kein TCPA-Consent-Layer, einfachstes Nummern-Provisioning; `ALLOWED_COUNTRY_CODES` bleibt vorerst `+49`. DACH/US sind spaetere, bewusste Erweiterungen.

**4. Datenresidenz. — BESCHLOSSEN (2026-06-14).**
EU-Tenant-Transkripte — EU-Region-Hosting oder dokumentierte SCCs auf US-Infra? Entscheidet ueber die DB-Region in P3.
**BESCHLUSS:** Server + DB liegen in **Deutschland** (EU-Region). Kein US-Transfer, keine SCCs noetig. Render-Deployment muss eine DE/EU-Region nutzen — in `render.yaml` (Infra, P8) festschreiben und gegen versehentliche US-Region absichern. Hinweis: Durch den Summary-only-Beschluss (#7) liegen ohnehin keine Roh-Transkripte mehr at rest; Summaries (mit Personenbezug) bleiben damit ebenfalls in der EU.

**5. Pricing-Modell. — BESCHLOSSEN (2026-06-14): Option A.**
Flat mit Inklusiv-Kontingent + hartem Cap, oder rein usage-based? Realtime-Minuten dominieren (~$8-22/Tenant/Monat Selbstkosten bei 30-60 min).
**BESCHLUSS:** **Flat mit Inklusiv-Kontingent UND hartem Minuten-Cap.** Der harte Cap ist ohnehin als Safety-Gate (R2, pro-Tenant `hard_cap_cents` in P4) vorhanden — die Pricing-Absicherung kommt also gratis aus der Safety-Architektur. Konkrete Kontingent-/Preis-Zahlen spaeter, wenn die Selbstkosten je Markt feststehen.

**6. EU-AI-Act Art. 50(2) — maschinenlesbare KI-Markierung. — BESCHLOSSEN (2026-06-14): jetzt nicht, spaetere Phase.**
Der gesprochene Disclosure-Satz ist Pflicht und vorhanden, aber Art. 50(2) (ab 08/2026) verlangt zusaetzlich maschinenlesbare Markierung der synthetischen Stimme.
**BESCHLUSS:** **Vorerst nicht umsetzen**, als eigenes Compliance-Item in eine **spaetere Phase** schieben (Scope am finalen Code of Practice mit Legal klaeren). Beruehrt den Telephony-Umbau (P0-P8) nicht. Der gesprochene Disclosure-Satz bleibt unabhaengig davon fest verdrahtet (Regel 2).

**7. Retention-Default pro Tenant. — TEILWEISE BESCHLOSSEN (2026-06-14).**
Heute global 30 Tage (`pruneOldData`). Pro-Tenant konfigurierbar oder fixer Default?
**BESCHLUSS:** Roh-Transkripte werden **nach Call-Ende NICHT aufbewahrt** — nur Summary +
Action Items bleiben. Das Roh-Transkript existiert nur fluechtig waehrend des aktiven Calls
(Live-Dashboard + Summary-Erzeugung) und wird in `finishCall` geloescht, sobald die Summary
steht. Folgen: (a) `get_transcript` (MCP) liefert fuer abgeschlossene Calls nur noch
`result_summary`/`objective_achieved`, kein `transcript[]` — Tool-Vertrag + README anpassen;
(b) woertliches Nachlesen / Streitfall-Beleg nur noch ueber die Summary; (c) Edge-Case:
scheitert die Summary-Erzeugung, wird das Roh-Transkript ausnahmsweise (geflaggt, kurze
Frist) zur Wiederholung gehalten und erst nach erfolgreicher Summary geloescht.
**BESCHLUSS (2026-06-14):** Retention-Default fuer Summary/Metadaten = **fixer DSGVO-konformer
Default**, **keine** pro-Tenant-Konfigurierbarkeit vorerst (Begruendung Auftraggeber: "erstmal
nur ich" = effektiv Single-Tenant). Pro-Tenant-Retention erst, wenn echte Fremd-Tenants live
gehen; dann nur nach unten konfigurierbar.

**8. Migrations-Fenster JSON→PG. — BESCHLOSSEN (2026-06-14): Option A.**
Gibt es Produktionsdaten in `data/store.json`, die migriert werden muessen, oder ist ein sauberer Schnitt (Demo-Reset) akzeptabel?
**BESCHLUSS:** **Sauberer Schnitt** — PG startet leer, die heutige `data/store.json` wird verworfen. Folge fuer P3: der **Roundtrip-Import + Import-Test entfaellt** (Aufwand gespart); die `pg`-Suite testet nur das frische Schema, nicht den Datenimport.

---

**Relevante Dateien dieses Repos (absolut):**
`src/server.js` (Twilio-Naht, Routing, `numberGateError`:180, `budgetExceeded`-Aufrufe :231/:407, `twilioNumber` :241/:354/:415/:429/:478, `validateRequest` :91, Body-Parser :55/:56, Anti-Spoof :27-34, `publicCall` :214), `src/bridge.js` (Realtime, HEIKLE STELLE Barge-in :114-120 + Call-Ende :49-54, `streamSid`/`customParameters`/`stream_token` :107/:177/:185), `src/claude.js` (`disclosureSentence` :56+, Prompt-Verdrahtung :51), `src/store.js` (JSON→PG-Migration, `budgetExceeded`:233/`trackUsage`:221 global→pro-Tenant, `resolveProfile`/Profile, `pruneOldData`), `src/config.js` (`maxBudgetEur`, `twilioNumber`:15/:96, `allowedCountryCodes`:33), `src/mcp-tools.js` (`get_my_number` tenant-aware), `src/auth.js` (`req.auth.{sub,email}` :76 → `tenant.idp_subject`), `test/*.test.js` (Verifikations-Anker je Phase). Neu: `src/telephony/{ports,registry,directives}.js` + `adapters/{twilio,telnyx}/`, `src/db/*`, `src/worker/*`, `src/billing/stripe.js`.
