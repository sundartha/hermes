# PLAN-SECURITY.md — Sicherheits-Plan (Launch-Fixes)

Sammlung der sicherheitsrelevanten Einträge der Launch-Blocker-Kette (OUT-05/PROV-01/A6,
PLAN-LAUNCH-FIXES.md). Jede sicherheitsrelevante Phase ergänzt hier ihren Eintrag (Pflicht,
CLAUDE.md). Aeltere Phasen-Historie liegt in Git.

## OUT-05 — Budget-/Reserve-Race bei parallelen place_call (nach F2)

> **Durch KS-P9 (2026-07-30, E10) ueberholt:** die Plattform-Achse (`MAX_BUDGET_EUR`) trifft keine Sperrentscheidung mehr. Aussagen dieses Abschnitts ueber einen Plattform-Notaus / eine Geld-Schnittmenge beschreiben den Stand VOR KS-P9 und werden bewusst nicht rueckwirkend umgeschrieben.

> OUT-05 (Reserve-Race): Worst-Case-Reserven pro place_call in einem strukturell ephemeren
> In-Prozess-Ledger (`s.reservations`, nie serialisiert/hydriert); Check+Reserve atomar unter
> `withStoreLock` (Schnittmenge Tenant+global), fail-closed try/catch (Body-Throw = Denial 402).
> Freigabe bei jedem Endzustand: Erfolg via `finishCall`, Fehler via `catch`, UND — unabhaengig vom
> Provider-Callback — via beim Originate armiertem Reserve-Release-Timer (beide Engines) bei
> `maxDur + RESERVE_RELEASE_GRACE_MS`. Restrisiken (akzeptiert, bounded): (a) Multi-Prozess nicht
> abgedeckt (OT-3, single-instance); (b) Freigabe braucht die Live-Call-Referenz -> cross-instance
> blind (OT-3); (c) Hung-Originate laesst eine Reserve bis Boot stehen (selten, boot-begrenzt);
> (d) **seit KS-P3 (a) neu gefasst:** die Reserve deckt nicht mehr das ganze Gespraech,
> sondern nur noch ein festes VORLAUFFENSTER von `RESERVE_LEAD_MINUTES` = 2 Minuten
> (`outboundReserveCents` = `Satz * 2` statt `Satz * ceil(maxDur/60)`). Alles jenseits
> dieser zwei Minuten deckt der Live-Verbrauchszaehler aus KS-P2, der ueber ALLE aktiven
> Outbound-Legs desselben Tenants summiert. Bleibende Kante ist damit genau das Fenster
> zwischen Dial und erstem Turn - und dafuer ist die Reserve da. Die alte Kante ("Ist-Kosten
> uebersteigen die Reserve um <= 1 Minutentakt durch Rundung/Hangup-Latenz") besteht
> unveraendert fort, fail-forward. `FAKE_ORIGINATE` ist ein boot-gehaerteter Test-Seam (nur
> zulaessig wenn Signaturpruefung geskippt -> in Prod unmoeglich), keine abgeschaltete
> Sicherung.

## PROV-01 — Provisioning-Crash-Recovery (klassifizierender Boot-Sweep) (nach F5, ergaenzt nach F6/F7)

> Provisioning-Crash-Recovery (PROV-01, klassifizierender Boot-Sweep): Nach einem Prozess-Crash
> zwischen Enqueue und Drain klassifiziert ein fire-and-forget Boot-Sweep
> (`reconcileOrphanedProvisioning`, gated auf `PROVISIONING_ENABLED`) die persistierten
> `queued`-Jobs in drei Koerbe: redrive (nur `requested` + aktiver KYC-Subscriber + Job juenger als
> `PROVISIONING_REDRIVE_MAX_AGE_MS`, Default 0 = Observe-Only) ueber den idempotenten,
> single-flight-serialisierten Worker; hold (zu alt / unbekanntes Alter / gate-faellt / Nummer
> mid-flight) -> Owner-Reconcile-Runbook, KEIN Auto-Kauf; close (Nummer aktiv/terminal/fehlt) ->
> Job schliessen. `captureHold` (`billing/stripe.js`) behandelt seit F6 den Stripe-Fehler
> "already captured" (`payment_intent_unexpected_state` mit PI-Status `succeeded`) als Erfolg
> statt als Fehler (kein Release einer bezahlten Nummer) - ein Re-Drive nach einem Crash
> zwischen erfolgreichem Capture und `store.save()` loest damit KEIN `rollbackAfterOrder`
> mehr aus. Praezise Diskriminierung: NUR diese Kombination gilt als Erfolg, jeder andere
> Stripe-Fehler wirft weiter. Der on-demand Operator-Re-Trigger (`POST /api/onboard/retry` ->
> `triggerTenantProvisioning`) nutzt seit F7 dieselbe alters-gegatete Entscheidung
> (`resolveProvisionRetry`, geteiltes Alters-Gate `redriveAgeHoldReason`): ein junger stuck
> `requested`+`queued` wird ueber den single-flight-Drain geld-sicher nachgefuehrt (dieselbe
> numberId/idempotencyKey, KEIN Doppelkauf); ein zu alter / alters-unbekannter stuck-Job liefert
> `needs_manual_reconcile` (HTTP 409 mit Runbook-Hinweis) statt eines Auto-Kaufs. Das Abo/KYC-Gate
> der Route (`tenantActiveSubscriber`, Regel 1) bleibt VOR dem Trigger unveraendert; eine aktive
> Nummer bleibt `already_provisioned` (409), ein terminal `failed` fragt weiter eine frische
> Nummer an. HARTER Launch-Gate: Scharfschaltung (maxAge>0) mit
> PAYMENT_ENABLED erst nach gruenem Owner-Smoke der Telnyx-Idempotenz auf `/v2/number_orders`
> (zweimal derselbe Key -> eine Order); F6 (captureHold-Idempotenz) ist gemergt. Bis dahin
> Observe-Only. Bewusst akzeptierte Restrisiken: (1) Multi-Instance-Sweep braucht
> vor Skalierung auf >1 Instanz einen pg-Advisory-Lock pro numberId; Launch ist Single-Instance.
> (2) Cap-Re-Validierung: der Re-Drive verbraucht keine neue Kapazitaet, eine seither verschaerfte
> MAX_NUMBERS-Bremse wird fuer sie nicht neu geprueft. (3) `runProvisioningDrain` haelt keinen
> `withStoreLock` ueber die Drain-Schleife (pre-existierend); der Single-Flight-Guard schliesst den
> Doppel-Drain, der Whole-Mirror-Flush-Race bleibt an das Single-Instance-Gate gekoppelt.

## A6 / DEPLOY-04 — Call-State-Kontinuitaet ueber Restart (nach F12, Bausteine ab F8-F11)

> A6/DEPLOY-04: Call-State-Kontinuitaet ueber Restart. Max-Dauer-Cap (Regel 1) wird beim Boot fuer
> rehydrierte aktive Calls neu armiert, verankert am echten Call-Start; Zombies (>= Max-Dauer)
> werden beim Boot ueber den EINEN Abrechnungspfad (`finishCall`) beendet — mit gekapptem `endedAt`
> (nie Boot-Zeit) und persistiertem `billedAt`-Marker (genau-einmal-Buchung ueber Prozessgrenzen).
> `/voice/*`-Re-Attach (inkl. `/voice/status`) fuehrt einen aktiven Call nur nach RLS-scoped
> DB-Bestaetigung fort (fail-closed bei unbekannter/fremder callId) und reanimiert keinen
> Ueber-Zeit-Leg. Provider-Signaturpruefung bleibt vorgelagert. Reconcile-Flush loescht keine
> `status='active'`-Call-Zeile mehr. SIGTERM/SIGINT-Graceful-Shutdown draint den letzten Flush
> (await close -> save). RESTRISIKEN (bezahlter zero-downtime-Tier, auf Render Free strukturell
> nicht erreichbar): (a) eine nicht-gespiegelte aktive Zeile ohne jeden Folge-Webhook bekommt keinen
> Max-Dauer-Timer; (b) `usage_event`/`number` bleiben Reconcile-ungeschuetzt (Ledger/DID). Beide
> vor Aktivierung von Prozess-Overlap durch einen DB-weiten Cross-Tenant Active-Call-Reconciler zu
> schliessen (Pflicht-Gate des paid-Umstiegs); bis dahin bewusst deferiert. Boot-Gap auf Render
> Free (kein Overlap/preDeploy) ist eine Infra-Grenze, kein Store-Bug — durch Deploy-Freeze bei
> aktivem Traffic oder bezahlten zero-downtime-Tier zu adressieren.

## BILL-RACE — Webhook-gewonnenes Checkout-Rennen band keine Karte (Fix 2026-07-06)

> Befund (Live-Logs): der Stripe-Webhook (`customer.subscription.updated`, status=active)
> gewinnt das Rennen gegen den Browser-Checkout-Return regelmaessig (Zustellung in ms vs.
> Redirect in Sekunden), speicherte das Abo und stiess Provisioning an — band aber KEIN
> payment_method. Der Return brach danach bei `already_subscribed` VOR `setTenantStripe`
> ab: Tenant dauerhaft abonniert-aber-kartenlos, jedes Provisioning fail-closed tot
> (`provisionNumber: kein hinterlegtes Zahlungsmittel`, Nummer -> failed). Sichtbar erst
> seit der Webhook-Secret-Reparatur (vorher verlor der Webhook immer per signature-reject).
> Fix zweischichtig, beide Pfade fail-closed: (1) `applyStripeWebhook` bindet das
> signatur-verifizierte `customer`+`default_payment_method` aus dem Event — NUR als
> Luecken-Fueller (nie eine vorhandene Karte ueberschreiben) und NUR bei Customer-Match
> (R4: nie ein fremdes payment_method an den Tenant); der Webhook-Pfad provisioniert damit
> selbststaendig, der Browser-Return ist nicht mehr zustandskritisch. (2)
> `activateSubscriptionFromCheckoutSession` heilt den Rennen-Zustand (identische
> subscriptionId + KEINE Karte): Karte aus der customer-+plan-verifizierten Session binden
> + idempotente Aktivierung (`tenantHasLiveNumber`-Guard verhindert Doppelkauf); MIT Karte
> bleibt `already_subscribed` ein reiner No-op, `subscription_conflict` unveraendert.
> Geld-Invarianten unangetastet: Hold-vor-Order, Caps, KYC-Gate, PAYMENT_ENABLED.

## STRIPE-RACE — Webhook-Events pro Korrelationsschluessel serialisiert (P1, Fix 2026-07-15)

> Befund (Clean-Code-Audit 2026-07-15, S1-1/C1, `tasks/clean-code-audit-2026-07.md` +
> `PLAN-FRAGILITY-REMEDIATION.md`): `applyStripeWebhook` lief ohne jede Serialisierung.
> Stripe liefert Events at-least-once, ohne Ordnungsgarantie; zwei konkurrierende Events
> (z.B. `customer.subscription.updated`->active UND ein zeitnahes `invoice.payment_failed`)
> konnten je nach zufaelligem Promise-Timing in FALSCHER Reihenfolge abschliessen - ein
> Tenant konnte `active`+KYC=CARD bleiben, obwohl die Zahlung zwischenzeitlich scheiterte
> (Outbound-Gate faelschlich offen). Fix: `applyStripeWebhookSerialized`
> (`src/billing/webhook.js`) serialisiert pro Stripe-Korrelationsschluessel
> (`subscriptionId`, Fallback `tenantRef`) ueber einen gekeyten Chain-Mutex
> (`makeKeyedChainMutex`, `src/chain-mutex.js`, additiv neben dem bestehenden
> `makeChainMutex`) UND verwirft veraltete/doppelte Events (Ordnungswache: exakte
> Event-ID-Redelivery ODER `event.created` nicht neuer als das zuletzt angewendete Event
> fuer denselben Schluessel). Der Route-Handler (`server.js`, `POST /webhooks/stripe`)
> ruft ab jetzt `applyStripeWebhookSerialized`; `applyStripeWebhook` selbst bleibt
> unveraendert (direkt getestet in `test/p3-payment-webhook.test.js`).
>
> Bewusst KEIN `store.withStoreLock`: der ACTIVATE-Zweig laeuft ueber `activatePaidTenant`
> in einen verschachtelten `provision()`-Aufruf, der seinerseits `store.withStoreLock`
> nutzt - ein `withStoreLock`-Body darf laut HARD-RULE (`store.js`) NIE erneut
> `withStoreLock` aufrufen (Deadlock). Die neue Sperre ist eine voellig eigenstaendige
> Chain-Instanz, getrennt von `store.withStoreLock` UND vom Provisioning-Drain-Mutex
> (`single-flight.js`).
>
> **Akzeptiertes Restrisiko:** Dedup-Zustand (`lastAppliedByKey`) ist In-Process (kein
> persistentes Ledger) - bei einem Prozess-Neustart (Render-Deploy) leert er sich; eine
> sehr alte Stripe-Redelivery koennte in einem sehr kleinen Fenster direkt nach Neustart
> einmalig durchrutschen. Bewusst akzeptiert wie das bestehende OT-3-Restrisiko
> (Single-Instance, Render Free = 1 Instanz); eine persistente, backend-uebergreifende
> Loesung waere eine eigene Folge-Phase. Zweites, bewusst separates Restrisiko: die Map
> waechst NIE geloescht ueber die gesamte Prozesslaufzeit (ein Eintrag pro je gesehenem
> Korrelationsschluessel, nicht nur pro aktuell aktivem) - bei sehr langer Uptime UND
> Millionen-Skala (ein Schluessel pro Stripe-Subscription) ist unbeschraenktes Wachstum
> theoretisch moeglich. Bewusst KEINE TTL/Cap in P1 (Scope: nur der Gleichstand-Fix
> AUDIT-1) - Groessenordnung/Notwendigkeit einer Grenze ist eine eigene Folge-Phase,
> sobald reale Uptime-/Subscription-Zahlen vorliegen.
> Tie-Break (AUDIT-1, Nachtrag): `event.created`-Gleichstand (verschiedene `event.id`,
> z.B. `customer.subscription.updated`->active UND `invoice.payment_failed` in derselben
> Sekunde) wird NICHT laenger pauschal als "stale" verworfen - ein gate-schliessendes
> SUSPEND gewinnt bei Gleichstand immer gegen ein gate-oeffnendes ACTIVATE, unabhaengig
> von der Lock-Ankunftsreihenfolge (fail-closed). Test: `test/stripe-webhook-race.test.js`.

## PLAY-TTS — PII-Audio-Serve-Surface (ElevenLabs-Stimme via `<Play>`)

> `GET /voice/tts/:token` ist auth-frei (VOR der `/voice`-Signaturpruefung registriert),
> weil Telnyx diese URL SERVERSEITIG fetcht (kein Provider-Signatur-Header moeglich).
> Absicherung: 256-bit-Token (`crypto.randomBytes(32)`, base64url), kurze TTL (Default
> 60 s, `ELEVENLABS_TTS_TOKEN_TTL_MS`), EINMALIGER Abruf (`takeOnce` loescht sofort).
> Der Store ist eine In-Memory-Seam (Port); **Multi-Replica ist ein bewusst akzeptiertes
> Restrisiko** (heute Single-Instance; ein zweiter Prozess ohne den Token faellt auf
> Stille statt Absturz zurueck, weil der Player-Abruf einfach 404 liefert — kein Call-
> Kill). Der Port ist spaeter gegen einen Objekt-Store/CDN tauschbar, sobald mehrere
> Replicas laufen. Kein Call/keine SMS/keine Kosten ueber diesen Endpunkt ausloesbar
> (Regel 1 unberuehrt).
>
> Korrigierter Befund (A/B-belegt 2026-07-06): der fruehere ElevenLabs-**Relay**-Pfad
> (`telnyxElevenLabs`, `<Say voice="ElevenLabs...">`) unterdrueckt den Inbound-Track —
> Deepgram-STT liefert dabei LEER (Agent hoert den Angerufenen nicht). Der fruehere
> Code-Kommentar "STT bleibt UNBERUEHRT" war falsch und ist korrigiert. Der neue
> Play-TTS-Pfad (server-seitige Vorab-Synthese + natives `<Play>` einer statischen
> Datei) umgeht dieses Problem, weil Telnyx keinen Live-Relay-Stream aufbaut.

## C-TELNYX — AI-Assistant-Engine (Barge-in, Custom-LLM-Shim, Call-Control)

C-Telnyx (PLAN-TELNYX-AI-ASSISTANT.md, P1-P11) migriert die Live-Voice-Schicht auf den
Telnyx AI Assistant (voll-duplex, Sprach-Barge-in). Master-Flag `TELNYX_AI_ASSISTANT_ENABLED`
(Default AUS): der gesamte Pfad ist bis zum Owner-Cutover (P11) inaktiv, der Live-CALL-Pfad
byte-identisch. Neue Angriffsflaechen + Mitigationen:

- **Custom-LLM-Shim (`/v1/chat/completions`, `src/telnyx-llm-shim.js`):** neuer Endpunkt,
  der pro Turn Claude-Tokens verbrennt und Transkript-Fragmente empfaengt. Bewusst VOR der
  Basic-Auth registriert (Telnyx BYO-LLM kann keinen Basic-Header setzen) mit EIGENER
  fail-closed-Absicherung: (1) 404 bei Flag aus (Existenz hinter dem Flag - keine monatelang
  offene Flaeche); (2) statisches Telnyx-Integration-Secret als Bearer, timing-sicher
  (`safeEqual`) gegen `config.telnyxShimSharedSecret`; Empty-Secret-Trap explizit abgelehnt.
  Korrelation ueber die Telnyx-eigene `call_control_id` aus dem `forward_metadata`-Body
  (`getCallByControlId`), nicht ueber die spoofbare Body-callId; (3) per-callId-Rate-Limiter
  (`TELNYX_SHIM_MAX_TURNS_PER_MIN`, Default 30) + Budget-Gate pro Turn (`budgetExceeded` -
  kein Token-Burn ueber dem Cap).
  Akzeptiertes Restrisiko (Single-Secret statt per-Call-Token): EIN Bearer-Wert gilt fuer
  ALLE Calls dieser Instanz statt eines je Call rotierenden Secrets - schwaecher als das
  P1-Design, aber das Modell jeder OpenAI-kompatiblen Custom-LLM-Integration. Kompensierende
  Kontrollen: das Secret liegt nur im Telnyx-Integration-Secret-Store + Render-Env (nie
  geloggt/projiziert); `getCallByControlId` muss einen EXISTIERENDEN, `status==='active'`
  Call treffen (kein Enumerations-Freifahrschein); der per-callId-Rate-Limiter + das
  Budget-Gate bleiben unveraendert bestehen. Bewusst akzeptiert.
- **Call-Control-Origination HINTER der Gate-Kette:** der neue Pfad haengt an genau der
  Stelle, an der heute `originateCall()` sitzt (server.js), NACH der vollstaendigen
  Pre-Dial-Kette (OUTBOUND_FROZEN, Tenant/KYC, Denylist/Land/Rate/Cooldown, Verifikation,
  Budget global n Tenant, Minuten-Kontingent, atomare Reserve). KEIN zweiter Origination-
  Einstieg.
- **Call-Control-Event-Ingest (P4.5):** eingehende `call.answered`/`speak.ended`/`call.hangup`-
  Webhooks sind Ed25519-signiert und fail-closed geprueft (kein implizites Wegfallen der
  Signatur; ungueltige Signatur -> 403). Der Handler mappt auf `finishCall`/`releaseReserve`/
  Timer (verhindert Reserve-Leak) und gatet die Disclosure->Assistant-Sequenz.
- **Inbound-Budget-Gate (Befund 8):** Inbound laeuft NICHT durch die Origination-Kette und
  hat keine Vorab-Reserve -> beim Answer expliziter globaler n Tenant-Budget-Check
  (`budgetExceeded`), Ablehnung bei Ueberschreitung (Toll-Fraud-Vektor: wiederholte Anrufe,
  KI redet unbegrenzt).
- **Mid-Call-Kill (beide Kosten-Achsen):** die Vorab-Reserve deckt nur Minuten; Tokenkosten
  laufen mid-call ueber den Shim. Deshalb pro Shim-Turn ein `budgetExceeded`-Check
  (Abschluss-Ansage + realer Call-Control-Hangup bei Ueberschreitung). Der Max-Dauer-Timer
  bleibt der out-of-band Zeit-Deckel.
- **Boot-Re-Arm (callControlId):** die `call_control_id` liegt als eigenes persistiertes
  Feld (NICHT `twilioSid` ueberladen), damit Boot-Recovery (`rearmActiveCallTimers`/
  `reattachActiveCall`) nach Deploy den korrekten Call-Control-Hangup trifft statt eines
  orphanten TeXML-Caps.
- **Secrets:** `.env.example`/`render.yaml` tragen keine echten Werte (`sync:false`/Default);
  Fehler nur ueber `assertTelnyxOk` geparst (nie Raw-Body/Key geloggt).
- **Boot fail-closed (P10):** Flag an ohne `TELNYX_ASSISTANT_ID`/`TELNYX_API_KEY`/
  `TELNYX_CONNECTION_ID`/`TELNYX_SHIM_SHARED_SECRET` -> `assertConfig` verweigert den Start;
  ein absurd hoher `TELNYX_SHIM_MAX_TURNS_PER_MIN` im Hosting -> `productionFootguns` fatal.
- **Verzoegerter Hangup nach `end_call` (afix-p3, bewusste Abweichung):** der Shim terminiert bei
  `end_call` NICHT mehr sofort, sondern uebergibt an den Conversation-Watchdog
  (`scheduleFarewellHangup`), der den Call-Control-Hangup um die geschaetzte Sprechdauer des
  Abschiedssatzes verzoegert (`clamp(1500 ms + Zeichen * 70 ms, 3000 ms, 12000 ms)`). Grund: der
  sofortige Hangup schnitt den Abschied ab (RCA 2026-07-12, Wurzel R4: Hangup 81 ms nach der
  Completion). Kosten-Effekt: bis zu 12 s zusaetzliche Gespraechsminuten pro per `end_call`
  beendetem Anruf — HART gedeckelt (`FAREWELL_MAX_MS`), kein konfigurierbarer Wert, keine neue
  Env-Var. Mitigationen/Backstops unveraendert: (1) der Farewell-Timer terminiert selbst (er ist
  kein Aufschub ins Offene); (2) waehrend der Verzoegerung ist die Dead-Air-Achse SUSPENDIERT,
  damit sie nicht praeemptiv terminiert — sie lebt beim naechsten Turn wieder auf; (3) ein
  externer `call.hangup` (`watchdog.clear`) gewinnt immer, genau EIN Terminate pro Call;
  (4) Telnyx `time_limit_secs=1800`, der out-of-band Max-Dauer-Cap und die Budget-Gates
  (global n Tenant, pro Shim-Turn) bleiben unangetastet. Die NOTAUS-Pfade (Loop-Guard,
  Mid-Call-Budget-Kill) terminieren weiterhin SOFORT — kein Abschied, kein Aufschub (Regel 1).
  Akzeptiertes Restrisiko: ein Prozess-Restart mid-Delay verliert den Timer; der Call laeuft
  dann bis zum naechsten Backstop (Dead-Air-Re-Arm beim naechsten Turn, Max-Dauer,
  `time_limit_secs`, Budget-Cap) — bewusst akzeptiert, kein Persistenz-Timer.
- **Sprech-Verlaengerung des Dead-Air-Notaus (dead-air-speech, bewusste Abweichung):** der
  Dead-Air-Timer terminiert nicht mehr bedingungslos, wenn er feuert — steht laut
  Sprechdauer-Schaetzung des letzten Turns noch Agentensprache aus, vertagt er sich **einmalig**
  um deren Rest plus die volle Frist (`TELNYX_DEAD_AIR_TIMEOUT_S`), explizit geklammert
  (`Math.min`) auf `SPEECH_EXTENSION_MAX_MS`. Grund: die Achse mass "Anrufer schweigt" statt
  "Leitung tot" und beendete aktive Gespraeche mitten im Satz (Live-Beleg `call_msn34lpf77wg`,
  86 s, `hangup_source=caller`). Kosten-Effekt: hoechstens `SPEECH_EXTENSION_MAX_MS` (90 s)
  zusaetzlich je Call, HART gedeckelt (durchgesetzt unabhaengig von der Turn-Latenz zwischen
  Timer-Stellung und Sprech-Schaetzung, Review-Fix Runde 1), keine Env-Var, nicht kumulativ
  (absoluter Zeitstempel, wird ersetzt statt summiert). Backstops unveraendert:
  Max-Gespraechsdauer-Cap, pro-Tenant-Kostendecke, `OUTBOUND_FROZEN`, Telnyx
  `time_limit_secs=1800`. Notaus-Pfade (Loop-Guard, Mid-Call-Budget-Kill) terminieren weiterhin
  SOFORT.

## TENANT-IDENTITY — Email-verifizierte Dedup + synchroner sub->Tenant-Resolver (Fix 1, A+B)

Wurzel (RCA `tasks/rca-tenant-number-proliferation.md`): die Tenant-Identitaet hing roh am
OIDC-`sub` (`t_<sub>`), es gab keine Email-Dedup -> jeder neue WorkOS-`sub` desselben Menschen
erzeugte einen frischen Tenant, der beim Abo eine neue echte Telnyx-DID kaufte. Fix 1 dedupliziert
verifizierte Identitaeten. NUR pg (Web-Login/`account` existieren nur bei `STORE_BACKEND=pg`);
json-Backend byte-identisch. Kein Safety-Gate beruehrt, keine neue Dependency, Schema additiv/
idempotent. Neue Angriffsflaechen + Mitigationen:

- **Account-Takeover ueber Email-Merge (Phase A):** `upsertOnFirstLogin` mappt einen neuen sub
  per `SELECT tenant_id FROM account WHERE email=$1` auf einen bestehenden Tenant. Eine
  ungeprueft akzeptierte Email wuerde fremde Konten (Anrufhistorie, aktive DID, laufendes Abo,
  Outbound-Berechtigung) uebernehmbar machen. **Mitigation, nicht verhandelbar:** Merge NUR bei
  `email_verified===true` — das bestehende `claimsFromPayload`-Gate (`web-auth.js`) wird
  wiederverwendet, NICHT aufgeweicht. Fehlende/unverifizierte Email -> expliziter, geloggter
  Reject (Email selbst NICHT geloggt), KEIN Tenant + KEIN account angelegt (vorher lief das in
  einen unbeabsichtigten NOT-NULL-Crash mit generischem 401).
- **Merge auf hart-geschlossenen/suspendierten Tenant (Phase A, Review-Fund R3):** der Dedup-
  SELECT joint gegen `tenant.status` — ein brandneuer sub wird NIE auf einen geschlossenen/
  suspendierten Tenant gemergt (sonst koennte ein Angreifer ueber eine recycelte Mailbox einen
  stillgelegten Tenant samt DID wiederbeleben).
- **Determinismus (Phase A):** Merge-Regel "aeltester Tenant gewinnt" (`ORDER BY created_at ASC
  LIMIT 1`), transitiv -> zwei subs mergen nie in verschiedene Richtungen, bestehende
  MCP-Tokens mit altem sub treffen weiter denselben kanonischen Tenant.
- **Orphan-Tenant-Fenster geschlossen (Phase A):** Tenant-Aufloesung + account-INSERT laufen in
  EINER Transaktion (BEGIN/COMMIT/ROLLBACK). Vorher konnte bei null-Email der Tenant-INSERT
  committen und der account-INSERT crashen -> tenantloser/accountloser Halbzustand.
- **Index (Phase A):** `account_email_idx` ist NICHT-unique (mehrere subs pro Email teilen sich
  einen Tenant; ein Unique-Index wuerde die Dedup brechen). Reine Lookup-Beschleunigung; die
  1-Tenant-pro-Email-Invariante garantiert die Dedup-Logik, nicht der Index.
- **MCP/REST-Resolver bleibt fail-closed + synchron (Phase B):** `resolveTenant` (nicht-awaiteter
  Hot-Path) konsultiert einen In-Memory `subIndex` (sub->tenantId) mit Vorrang vor dem
  `idpSubject`-Fallback; unbekannter sub -> kein Tenant (Ablehnungsverhalten unveraendert). Kein
  invasiver async-Umbau. Der Index wird pg-seitig bei `init()` aus der RLS-exempten `account`-
  Tabelle hydriert (`hydrateSubIndex`) und beim Nach-Boot-Login via `mintSession`
  (`bindSubToTenant`) gebunden — das schliesst die "idp_subject nach Boot eingefroren"-Landmine
  (ein per Email gemergter sub war sonst im MCP-Kanal abgelehnt). json-Backend: `subIndex`
  defensiv-ephemer, Parity-Test gruen.
- **Onboard-Guard (Phase B):** `POST /api/onboard` (operator-only) prueft vor `registerTenant`
  per `checkOnboardMerge` (reine Funktion `src/onboard-guard.js`) und liefert `409
  sub_already_merged` statt einen Zweit-Tenant fuer einen bereits gemergten sub anzulegen.
- **Bewusst praeventiv, nicht retroaktiv:** die 4 bestehenden Tenants/DIDs bleiben unangetastet
  (separate Phase F, per-Nummer Owner-Freigabe). Wirksamkeit haengt an der Live-DB-Annahme, dass
  die subs desselben Menschen dieselbe verifizierte Email tragen — vor jedem retroaktiven Schritt
  an der DB gegengeprueft.

## DID-LIFECYCLE — kontrollierter Nummern-Release (Fix 2, C+D+E)

Neue **destruktive Faehigkeit**: der Reconcile-Pfad kann echte Telefonnummern bei Telnyx loeschen
(DELETE /v2/phone_numbers) — ein Fehl-Release ist Geld- UND Rufnummern-Verlust (Telnyx gibt eine
released DID nicht garantiert zurueck). Deshalb mehrschichtig fail-closed. Neues Env
`RELEASE_GRACE_DAYS` an 4 Orten (`config.js` numEnv Default 0, `.env.example`, `render.yaml` "0",
`test/helpers.js` BASE_ENV "0" — kein `.env`-Leak in Spawn-Tests). Kein Safety-Gate beruehrt,
keine neue Dependency, Schema additiv/idempotent (`tenant.suspended_at`). Mitigationen:

- **Observe-Only ist der Default UND ein harter Sentinel (Phase D):** `RELEASE_GRACE_DAYS=0`
  (ausgeliefert) -> `runReleaseReconcile` (`src/release-reconcile.js`) returnt bei `graceMs===0`
  VOR jedem DELETE-Pfad und loggt nur die Kandidaten. Der Release-Code ist strukturell nur bei
  `graceMs>0` erreichbar. Analogie `PROVISIONING_REDRIVE_MAX_AGE_MS=0`. Nichts aendert sich, bis
  der Owner die Grace bewusst > 0 setzt.
- **Grace-Anker set-if-absent (Phase C):** `tenant.suspended_at` wird bei der ERSTEN Suspendierung
  gestempelt (nicht bei jedem Dunning-Retry -> Grace verlaengert sich nie ungewollt) und an ALLEN
  drei Reaktivierungspfaden geloescht (Webhook-Activate, Self-Service-Subscribe, Admin-Approve —
  der dritte war ein Review-Fund). pg: `rowToTenant` hydriert das Feld (i8-Landmine), sonst
  Verlust beim Flush.
- **Nur Telnyx (Phase D/E):** der Release gilt ausschliesslich `provider==="telnyx"`; alles andere
  -> `hold` (manuell). Telnyx ist seit C-P4 der einzige registrierte Anbieter; jeder andere Wert
  am Nummern-Record fiele in den Hold-Zweig. Der Release laeuft ueber den bestehenden
  NumberProvisioning-Port (registry-Dispatch), kein neuer Provider-Einstieg.
- **Live-Recheck vor JEDEM DELETE (Phase D):** unmittelbar vor dem Provider-DELETE wird der Tenant
  frisch geladen und das Release-Verdikt neu berechnet (`numberReleaseVerdict`); reaktivierte der
  Kunde zwischenzeitlich -> Abbruch. Schliesst den Reaktivierungs-Race.
- **Idempotenz gegen den nicht-idempotenten Telnyx-DELETE (Phase D):** Store-Status-Check
  (`ACTIVE` -> sonst skip) schuetzt Doppel-Laeufe; ein Provider-404 zaehlt als Konvergenz
  (`providerStatus` via `attachStatus`), kein Fehler-Abbruch. Reihenfolge Provider-DELETE ->
  Store-Mutation -> Audit; ein Crash dazwischen konvergiert beim naechsten Lauf (kein
  Store-Divergenz-Orphan).
- **Durabler Audit (Phase D/E):** jede Release-Aktion ueber `makeAuditStore`/`audit_log`
  (actor = Reconcile-System), nicht nur `console`.
- **Scheduling (Phase D):** Boot-Lauf + `setInterval(...).unref()` (Retention-Pattern).
  Free-Tier-Liveness-Vorbehalt im Code dokumentiert; Render-Cron ist das spaetere Upgrade.
- **DSGVO-Erase (Phase E):** `eraseTenantData` (Art. 17) gibt die Nummern grace-frei frei (Tenant
  ist weg), aber weiterhin Telnyx-only + idempotent + auditiert (gemeinsamer Kern
  `performNumberRelease`). Noch KEIN Live-Aufrufer von `eraseTenantData` — latent vorverdrahtet,
  damit eine kuenftige Erase-Route keine DID leakt.

## OUTBOUND-RESILIENZ-E1 — Plattform-Nummern-Bindung + dreifacher Freigabe-Riegel (2026-08-27)

**Root Cause (24.08.2026):** die Absendernummer des Produkt-Outbounds war im Datenmodell
nicht von einer gewoehnlichen Tenant-DID unterscheidbar. Der Kuendigungs-/Loesch-Weg eines
Wegwerf-Kontos gab sie deshalb frei wie jede andere Nummer — der gesamte Outbound-Absender
war weg, ohne dass irgendetwas widersprach.

**Reichweite (wichtig, nicht ueberlesen):** der Riegel deckt **unseren Store** — jeden
Code-Pfad, der eine Nummer ueber `state-ops.js` nach `released`/`suspended` bringt, plus
manuelle DB-Eingriffe. Er deckt NICHT die Anbieter-Seite: wer im Telnyx-Portal die
`connection_id` umhaengt, `ani_override` aendert oder eine EL-Registrierung loescht, umgeht
alle drei Ebenen. Das ist Waechter-Sache (kuenftige, separate Etappe), nicht Teil dieses
Riegels.

**Drei Ebenen, alle im selben Umbau, keine ersetzt eine andere:**

- **Ebene A — der Engpass.** `transitionNumber` (`src/store/state-ops.js`) ist der EINZIGE
  Schreiber von `number.status` im Repo; er wirft, wenn eine plattform-gebundene Nummer nach
  `released` oder `suspended` will. Deckt jeden Code-Pfad, heute und kuenftig, ohne dass ein
  kuenftiger Aufrufer daran denken muss.
- **Ebene B — das Verdikt.** `numberReleaseVerdict` und `tenantNumbersForErase` liefern HOLD
  statt eines Filters, BEVOR der irreversible Provider-DELETE startet (der laeuft vor der
  Store-Mutation, `release-reconcile.js`). Der Orchestrator zaehlt jeden HOLD als `aborted`
  und schreibt eine durable Audit-Zeile (`did_release_aborted`, Grund `platform_number_in_use`
  bzw. `active_call_on_number`) — nie eine E.164 im Audit-Text.
- **Ebene C — der DB-Backstop.** Ein pg-Trigger auf `number` (`BEFORE UPDATE OF status`,
  gegated auf den Zustandsuebergang, kein werfender DELETE-Zweig) faengt manuelle
  DB-Eingriffe und jeden kuenftigen Schreibweg, der `state-ops.js` umgeht. Ein Fremdschluessel
  taugt hier nicht: unsere Freigabe loescht keine Zeile, sie setzt `status='released'`.

**Unbind-Protokoll:** eine offene Bindung, die dem FREIGEBENDEN Tenant selbst gehoert (nicht
die geteilte Plattform-ANI), blockiert nicht — die Freigabe-Kette loest sie vorher
(`unbindPlatformNumber`), dann laeuft die Freigabe normal durch. Ohne dieses Protokoll wuerde
der Riegel im eigenen Zielzustand (je Tenant-DID eine eigene Bindung) JEDE legitime
Kuendigung blockieren.

**Preis, bewusst getragen (BA-2): eine haengende Kuendigung.** Ein Tenant, dessen DID
zugleich GETEILTE Plattform-ANI ist, kann seine Nummer nicht per Kuendigung freigeben — die
Freigabe haengt (HOLD + Audit), bis der Betreiber die Bindung von Hand loest. **Artikel 17
bleibt davon unberuehrt:** `eraseTenantData` loescht weiterhin ALLE personenbezogenen Daten
(Calls, ActionItems, Notifications, Privatnummer) und fasst `s.numbers` ohnehin nie an — offen
bleibt ausschliesslich die Rueckgabe der Rufnummer an den Anbieter, eine Kosten-/Betriebsfrage,
keine Betroffenenrechts-Frage.

**Rueckbau, falls der Riegel eine legitime Freigabe blockiert:** `PLATFORM_ANI_E164=""` setzen
und neu starten — der Boot leitet dann keine Bindung mehr ab, die alte Bindung wird beim
naechsten Boot-Abgleich geschlossen, Bestandsverhalten kehrt zurueck. Der Trigger selbst laesst
sich zusaetzlich per `DROP TRIGGER number_platform_binding_guard ON number;` einzeln
entschaerfen, ohne Datenverlust (additive DDL).

**Bewusst offen gelassen: die Prune-DELETE-Luecke.** `flushOwnScoped`/`deleteMissing`
(`src/store/pg.js`) kann eine `number`-Zeile ganz LOESCHEN (Spiegel-Prune bei leerem
Nummern-Slice). Ein `BEFORE DELETE`-Trigger wuerde diesen Weg schliessen, ist aber bewusst
NICHT gebaut: er waere selbst PM-12 — jede Spiegel-Divergenz (Teil-Hydrierung, Overlap-Prozess
beim Free-Tier-Aufwachen) machte dann aus einem lokalen Problem einen Totalausfall des
gesamten Schreibpfads fuer ALLE Tenants. Tragbar, weil ein Prune-DELETE (a) die Bindung in
`platform_number_use` nicht mitloescht (globale, eigene Tabelle) und (b) die Nummer NICHT beim
Anbieter freigibt.

**Praezisierung (Review-Blocker Runde 3, korrigiert 2026-08-28):** der irreversible
Provider-DELETE laeuft NICHT ausschliesslich ueber `performNumberRelease`/Ebene B — ein
zweiter Aufrufer von `provisioner.releaseNumber` existiert in `src/onboarding.js`
(`rollbackAfterOrder`, Capture-Fehlerpfad nach erfolgreichem Kauf). Dieser Pfad hat kein
eigenes Verdikt, ist aber vor demselben `numberBusyReason`-Kern (G5) abgesichert: er trifft
strukturell nur eine gerade erst gekaufte, nie aktivierte Nummer (`number.e164` ist bis
`activateNumber` `null`, s. `requestNumber`/`state-ops.js`), kann also die geteilte
Plattform-ANI (immer bereits `active`, eigener `providerNumberId`) nicht treffen — der
Recheck ist Beleg und Zukunftssicherung zugleich, kein Ersatz fuer Ebene B.

Kein Safety-Gate beruehrt (Outbound-Permit, `OUTBOUND_FROZEN`, Denylist/Land-Gate/
Stundenlimit, pro-Tenant-Kostendecke, Max-Gespraechsdauer, Telnyx-Signaturpruefung
unveraendert); die Offenlegungs-Mechanik und `callee_is_owner` unangetastet. Neue Env
`PLATFORM_ANI_E164` (Default leer = keine Bindung, Boot-Guard meldet das nicht-fatal).

## C5 — finishCall-Settlement strukturell erzwingen (Struct-4, nach P3)

> `terminateAndBillCall` (`src/telephony/call-termination.js`) ist der EINE Terminierungspfad
> fuer alle 5 Wege, auf denen ein aktiver Call die Budget-Engine verlaesst (Max-Dauer-Cap,
> `cancel_call`, `/voice/status`, Telnyx `onHangup`, `place_call`-Dial-Fehlschlag). `bill`
> (Settlement/`finishCall`) ist ein strukturell erzwungenes Pflichtfeld (Fail-Fast-`TypeError`
> bei Fehlen) statt einer Konvention "denk dran, finishCall aufzurufen" - genau das liess den
> place_call-Dial-Fehlschlag zuvor ohne Settlement/Notification/Reserve-Freigabe stehen.
> `bridge.js` (Realtime-Engine, 6. Pfad, andere Topologie) bleibt bewusst ausserhalb (siehe
> `PLAN-FRAGILITY-REMEDIATION.md` P7-Restrisiko).
>
> Restrisiko (akzeptiert, bounded, Review-Blocker S1-2): `bill` laeuft in ALLEN 5 Pfaden
> fire-and-forget (`void bill()` in `terminateAndBillCall`) - absichtlich, sonst wuerde z.B.
> `cancel_call` auf den vollen Summary-/SMS-Roundtrip warten (echter LLM-Aufruf ueber
> `src/llm.js`, Retry-Budget bis ~12s), ein Verstoss gegen den harten Max-Dauer-Cap (Absolute
> Regel 1). Vor diesem Umbau lief die Reserve-Freigabe (`releaseReserve`) im `place_call`-Dial-
> Fehlschlag-Pfad synchron VOR `endCallRecord` UND vor der HTTP-Response; seit dem Umzug auf
> `terminateAndBillCall` laeuft sie wie bei den anderen 4 Pfaden asynchron und ist zum
> Response-Zeitpunkt nicht mehr garantiert abgeschlossen. Das Fenster ist eng (typischerweise
> im Millisekundenbereich: der Call steht auf "failed" mit leerem Transkript, `finishCall`
> kehrt VOR jedem `summarizeCall`/SMS-Versand zurueck) - ein zweiter `place_call` desselben
> Tenants, der GENAU in diesem Fenster startet, kann faelschlich wegen Budget/Reserve abgelehnt
> werden. Richtung ist fail-closed (kein Overspend-Risiko, nur eine zu enge Ablehnung) und
> selbstheilend (die Reserve wird Millisekunden spaeter freigegeben, kein dauerhaft blockiertes
> Budget). Bewusst NICHT fuer diesen einen Pfad awaited: das wuerde die Uniformitaet der 5 Pfade
> (dieselbe Fire-and-forget-Semantik, `call-termination-order.test.js`) aufbrechen und ein
> Selektor-Argument in `terminateAndBillCall` erzwingen (Clean-Code G15/F3), fuer einen Nutzen,
> der bereits durch OUT-05s Reserve-Release-Backstop-Timer bounded ist.
>
> P8 (Review-Blocker S1, Beobachtbarkeit, behoben): `bill()` bleibt fire-and-forget, aber
> `terminateAndBillCall` haengt ein `.catch` an statt die Rejection nur an den generischen
> globalen `onUnhandledRejection`-Handler (`process-guards.js`) durchzureichen - der Log-
> Eintrag traegt ein stabiles `[terminateAndBillCall]`-Praefix + `callId` (Korrelation, keine
> PII) + `e.message`, secret-frei. Alle 5 Terminierungspfade reichen `callId` mit.

## P2B-DIAG — Diagnose-Retention + geschlossenes `allowSummaries`-Leck (nach P2a)

> **Geschlossene Luecke (Wurzel):** Bei `allowSummaries=false` gab `summarizeCall` `null`
> zurueck, `finishCall` returnte frueh und `purgeTranscript` lief NIE - ein Tenant, der
> Summaries abschaltete, bekam still die LAENGSTE Aufbewahrung (Roh-Transkript bis
> `RETENTION_DAYS`) statt der kuerzesten. Der Purge steht jetzt VOR dem Frueh-Return; ein
> leeres Summary-Ergebnis heisst strukturell "Summaries aus" (ein echter Fehler wirft und
> landet im `catch`, wo das Transkript wie bisher liegen bleibt und von `pruneOldData`
> abgeraeumt wird).
>
> **Diagnose-Retention (Scope):** `call.diagnostic` wird AUSSCHLIESSLICH serverseitig
> gesetzt (`src/diagnostic-retention.js`, aufgerufen in `POST /api/calls`) und NUR, wenn
> das normalisierte Ziel exakt der `privateNumber` des anrufenden Tenants entspricht.
> Diese ZIEL-Pruefung ist die Datenschutz-Grenze - sie ist unveraendert und traegt die
> gesamte Rechtfertigung: fremde Gespraechsinhalte koennen nicht laenger liegen als
> versprochen.
>
> **GQ-P11 (2026-08-06, Owner-Entscheidung O-B) - Opt-in wurde Opt-out:** Der Body-/MCP-Wert
> verlangte bis dahin ein ausdrueckliches `=== true`, das das Client-Modell selbst setzen
> musste. Messung: 58 Calls in Produktion, kein einziger markiert - die Aufbewahrung war
> faktisch nie scharf, und jeder sauber beendete Testanruf verlor sein Roh-Transkript. Der
> Server entscheidet die Markierung seither selbst; der Body-Wert ist nur noch der
> Widerspruch. Die Ablehnung wird gegen `false` UND den String `"false"` geprueft (beide
> Body-Typen sind geparst, `app.js`), NIE per Truthiness - sonst wuerde ein urlencodetes
> `"false"` die Aufbewahrung genau dann verlaengern, wenn ihr widersprochen wurde.
> Datenschutz-Argument der Umkehrung: bei `to === ownNumber` gehoeren BEIDE Seiten der
> Leitung demselben Tenant; es entstehen keine fremden Rohdaten.
>
> Fail-closed in jeder Richtung unveraendert: fehlende `privateNumber`, fremdes Ziel oder
> `DIAGNOSTIC_RETENTION_DAYS=0` ergibt exakt das Bestandsverhalten.
>
> **Beobachtbarkeit (GQ-P11):** Der Live-Wert von `DIAGNOSTIC_RETENTION_DAYS` war im
> Boot-Log nicht lesbar (`runRetention` druckt nur, wenn der Sweep etwas geloescht hat).
> `capabilityProbeLines` traegt jetzt die Zeile `Diagnose-Transkripte: ...` in beiden
> Richtungen.
>
> **Frist + Loeschpfad:** `DIAGNOSTIC_RETENTION_DAYS` (Default 7, `min: 0`), strikt
> getrennt von `RETENTION_DAYS` (30). Der bestehende Retention-Sweep (`boot.js
> runRetention` -> `store.pruneOldData` -> `state-ops.purgeExpiredDiagnosticTranscripts`)
> bekam einen zweiten, strengeren Durchgang: Roh-Transkripte markierter Calls fallen nach
> der kurzen Frist, der Call-Record selbst erst nach der langen. Der Durchgang laeuft
> UNABHAENGIG von `RETENTION_DAYS` - `RETENTION_DAYS=0` darf die kuerzere Frist nicht mit
> abschalten. `DIAGNOSTIC_RETENTION_DAYS=0` bedeutet hier bewusst "cutoff = jetzt" (alles
> faellt), nicht "Durchgang aus" - nur diese Asymmetrie ist fail-closed.
>
> **Restrisiko 1 (akzeptiert, bounded) - Sweep-Takt:** `pruneOldData` laeuft beim Boot UND
> alle 6 h (`RETENTION_SWEEP_INTERVAL_MS`, `boot.js`). Die reale Obergrenze ist damit
> `DIAGNOSTIC_RETENTION_DAYS + 6 h`, nicht die Frist auf die Minute. Render Free hat keine
> Cron-Jobs (Owner-Removal-Kette); ein exakterer Takt braeuchte einen eigenen Timer.
>
> **Restrisiko 2 (akzeptiert, benannt) - `privateNumber` ist validiert, nicht OTP-
> verifiziert:** Ein Tenant kann seine `privateNumber` per Self-Service setzen
> (`self-service-routes.js` -> `setPrivateNumber`); geprueft werden E.164-Form und
> erlaubtes Land, KEIN Rueckruf-/OTP-Nachweis. Wer dort die Nummer eines Dritten eintraegt,
> koennte fuer Anrufe an diesen Dritten die verlaengerte Aufbewahrung ausloesen.
> Gegengewichte: dieselbe Nummer ist das Ziel der Summary-SMS (der Missbrauch leitet die
> eigenen Zusammenfassungen an den Dritten weiter, also selbst-begrenzend), Outbound ist
> ohnehin KYC- und abo-gegated, und die Frist bleibt kurz. Ein OTP-Nachweis der
> `privateNumber` ist die saubere Loesung und bleibt offen.
>
> **Restrisiko 3 (akzeptiert) - Fristverkuerzung wirkt erst beim naechsten Sweep:** Wird
> `DIAGNOSTIC_RETENTION_DAYS` von 7 auf 0 gedreht, faellt ein bereits markiertes
> Transkript nicht sofort, sondern beim naechsten Sweep (<= 6 h). `RETENTION_DAYS` bleibt
> der harte Backstop.
>
> **Deploy-Kopplung (Reihenfolge, kein Code-Gate):** In Produktion steht
> `DIAGNOSTIC_RETENTION_DAYS=0`, bis die Datenschutzerklaerung (`apps/web`) den
> Diagnosemodus und seine Frist nennt.

## P3-INBOUND — Frueh-Hangup-Schutz symmetrisiert (Kostenachse benannt, nach P2b)

> **Geschlossene Luecke:** `shouldSuppressEndCall` hatte einen Direction-Kurzschluss
> (`if (call.direction !== "outbound") return false`). Der Schutz gegen voreiliges
> Auflegen (RCA-R3) galt damit nur fuer Outbound; ein Inbound-Call konnte beendet werden,
> bevor der Anrufer ueberhaupt gesprochen hatte. Der Kurzschluss ist entfernt, das
> Praedikat ist jetzt richtungslos - `maxEmptyTurns` (Default 3, `min: 2`) gilt beidseitig.
>
> **Bewusste Rest-Asymmetrie:** `callerHasSpoken` bleibt richtungsabhaengig (TG-REC-1):
> outbound zaehlt nur eine SUBSTANZIELLE Zeile (>= `CALLER_SUBSTANCE_MIN_LEN`), inbound
> jede nicht-leere. Der Guard hebt sich inbound also FRUEHER - der konservativere Bias auf
> dem Pfad, den Fremde ausloesen.
>
> **Kostenachse (benannt, bounded, akzeptiert):** Ein Inbound-Call, bei dem niemand spricht
> (Anrufbeantworter, Fehlwahl, Rauschen), kann sich bis zu `maxEmptyTurns` Turns lang nicht
> selbst beenden. LLM-Token laufen richtungsunabhaengig ueber `trackUsage`/`tokenCostUsd`
> IN den Budget-Guard (gedeckelt). Carrier-Minuten laufen NICHT hinein:
> `reconcileOutboundVoiceBudget` steigt bei `call.direction !== "outbound"` explizit aus.
> Begrenzt wird die Exposition seit KS-P3 NICHT mehr durch einen festen Zeit-Cap: die
> Zeitgrenze eines Legs ist eine guthaben-abgeleitete NOTBREMSE
> (`min(Restminuten + 1, 1800 s)`, `emergencyBrakeSeconds`), und die eigentliche
> Kostenschranke ist der Live-Verbrauchszaehler aus KS-P2 (`blockingBudgetAxis` ->
> `liveVoiceSpendCents`) gegen die pro-Tenant-Kostendecke. Der frueher hier genannte
> `MAX_CALL_DURATION_S`-Cap existiert nicht mehr (E2/E3). **Vertretbar nur mit
> `MAX_EMPTY_TURNS` auf dem konservativen Default 3. Wer den Wert hochdreht, kauft
> Hoeflichkeit mit Carrier-Minuten, die kein Gate sieht.**
>
> **Nicht beruehrt (Regel 1):** `CAP_FAREWELL_LEAD_MS` (P3.1) verlaengert die Frist NICHT.
> Der Abschluss-Satz wird INNERHALB der Frist gerendert; `terminateCappedCall`,
> `armMaxDurationTimer` und `POST /api/calls/:id/cancel` (Owner-Notaus ohne Ansage) bleiben
> unveraendert. `CAP_FAREWELL_LEAD_MS=0` schaltet die Ansage aus, ohne die Frist anzufassen.
> Der Default 20000 ms bleibt deutlich unter der KUERZESTMOEGLICHEN Notbremse (60 s).

## P7A-MODELPRICE — Budget-Guard rechnet pro Modell (fail-closed, 2026-07-19)

> **Durch B4A ueberholt (2026-08-08):** die Betriebs-Auflage ist ein BOOT-GATE geworden
> (`assertPricedModels`, `src/boot.js`), und die Preis-Politik "LISTENPREISE statt
> Einfuehrungsrabatt" ist durch datierte Staffeln (`validFrom`) ersetzt. Der Rest des
> Abschnitts (Proxy-Fallen, Fail-closed-Prinzip) gilt unveraendert; s. B4A am Dateiende.

> **Geschlossene Luecke:** `tokenCostUsd` rechnete mit EINER globalen Formel
> (`priceInPerMTokUsd`/`priceOutPerMTokUsd`, faktisch Haiku-Preise). Jedes andere
> Modell - auch ein teureres - wurde zu Haiku-Preisen gebucht. Auf der KI-Kosten-Achse
> haette der Budget-Guard (Regel 1) damit bis zu einem Faktor 3 zu wenig gesehen.
>
> **Neu:** `config.llm.modelPricesUsd` ist die EINZIGE Preisquelle. Live-Gate
> (`trackUsage`) und Stripe-Ledger (`aiCostCents`) leiten beide daraus ab; die
> Modell-ID reist als Teil des Verbrauchs-Tripels `{inputTokens, outputTokens, model}`
> vom Aufrufer (`src/claude.js`) bis in die Preisformel.
>
> **Fail-closed:** Eine Modell-ID, die NICHT in der Tabelle steht, wird mit der
> TEUERSTEN hinterlegten Rate gebucht (`priceForModel`/`mostExpensivePrice`) - nie mit
> 0, nie mit dem Haiku-Default. Eine leere Tabelle wirft benannt statt still auf 0 zu
> fallen. Beides ist getestet (`test/model-price-gate.test.js`), inklusive des Nachweises,
> dass ein unbekanntes Modell das Gate weiterhin REISST.
>
> **Proxy-Falle (bewusst festgehalten):** `config.llm.modelPricesUsd` ist zur Laufzeit
> ein `guardedConfig`-Proxy, dessen `get`-Trap bei unbekanntem Schluessel wirft. Der
> Lookup MUSS `Object.hasOwn` nutzen; ein Roh-Index `prices[model]` wuerde den Turn mit
> 500 killen statt konservativ zu buchen. Ein Test faehrt den Fail-closed-Zweig deshalb
> gegen die ECHTE `config`-Oberflaeche, nicht nur gegen einen Plain-Object-Mock.
>
> **Zweite Proxy-Falle (in dieser Phase gefunden + behoben, nicht im Ursprungsplan):**
> `modelPricesUsd` war im ersten Entwurf `Object.freeze(...)`. `guardedConfig` wrapt
> jeden Objekt-Wert bei JEDEM Zugriff in einen NEUEN Proxy; fuer eine per `Object.freeze`
> non-configurable/non-writable GEMACHTE Eigenschaft verlangt die Sprache aber, dass
> `[[Get]]` denselben (SameValue) Rueckgabewert wie am Target liefert. Ein frischer
> Wrapper verletzt diese Invariante -> die Engine warf `TypeError` bei JEDEM Zugriff auf
> `config.llm.modelPricesUsd[...]`, auch auf BEKANNTE Modelle - nicht nur bei unbekannten.
> Genau der Fail-open-durch-Crash (500 auf jeden Turn), den `priceForModel` verhindern
> soll, waere damit ab dem ersten Request eingetreten. Gefunden durch das Rot-vor-Fix-
> Protokoll: der Test gegen die echte `config`-Oberflaeche (siehe oben) schlug nach dem
> ersten Implementierungsversuch mit genau dieser Proxy-Invariant-Meldung fehl. Fix:
> `modelPricesUsd` bleibt ein normales (ungefreeztes) Objekt, Muster wie die bestehenden
> nested Config-Bloecke `telnyxElevenLabs`/`telnyxAssistant`.
>
> **Betriebs-Auflage (KEIN Boot-Gate):** Jedes kuenftige Modell MUSS in
> `modelPricesUsd` eingetragen werden, BEVOR `CLAUDE_MODEL` darauf gestellt wird. Auch
> eine DATIERTE Snapshot-ID (`claude-haiku-4-5-20251001`) ist ein ANDERER Schluessel als
> der Alias. Sonst rechnet das Gate mit der teuersten Rate - Calls brechen zu frueh ab.
> Bewusst KEIN Boot-Refusal: das wuerde ein eingegrenztes Geld-Risiko (konservativ zu
> teuer buchen) in einen Totalausfall der Telefonie verwandeln.
>
> **Preis-Politik:** In der Tabelle stehen LISTENPREISE, nicht Einfuehrungsrabatte
> (Sonnet 5: 3/15 USD, nicht die bis 2026-08-31 gueltigen 2/10). Ein zu NIEDRIGER Preis
> macht das Gate blind; ein zu hoher ist hoechstens zu streng.
>
> **Nicht beruehrt:** Der P1-Safety-Blocker bleibt unveraendert - `trackUsage`
> akkumuliert weiter EXAKT in Mikro-Cents (`costMicroCentsRem`) und rundet NICHT pro
> Inkrement. Denylist/Land-Gate/Stundenlimit/Max-Dauer/Signaturpruefung sind nicht
> angefasst.

## P2A-TENANTFALLBACK — Tenant-Achse bindet fuer Tenants ohne eigene Zeile (2026-07-19)

> **Durch KS-P9 (2026-07-30, E10) ueberholt:** die Plattform-Achse (`MAX_BUDGET_EUR`) trifft keine Sperrentscheidung mehr. Aussagen dieses Abschnitts ueber einen Plattform-Notaus / eine Geld-Schnittmenge beschreiben den Stand VOR KS-P9 und werden bewusst nicht rueckwirkend umgeschrieben.

> **Geschlossene Luecke (D3):** Ein Tenant OHNE eigene `tenant_budget`-Zeile fiel in
> `effectiveCapCents` bisher direkt auf den globalen Plattform-Cap (`globalCapCents`)
> zurueck. Damit war der PLATTFORM-NOTAUS zugleich das Nutzer-Kontingent - die Tenant-
> Achse des Budget-Gates war fuer jeden Tenant ohne Zeile wirkungslos, der Cap effektiv
> ein GETEILTER Topf ueber alle Tenants.
>
> **Neu:** `effectiveCapCents` (genutzt von `budgetExceeded` UND `reserveExceedsBudget`)
> hat eine dritte Praezedenzstufe zwischen der Tenant-Zeile und dem globalen Cap: die
> Tenant-Default-Decke aus der Config (`defaultTenantBudgetCents`). Praezedenz absteigend:
> (1) `tenant_budget`-Zeile, (2) `defaultTenantBudgetCents`, (3) `globalCapCents`.
> `globalCapCents` bleibt PARALLEL ueber `globalBudgetExceeded`/`globalReserveExceedsBudget`
> bestehen - es gilt weiter die Schnittmenge min(Tenant, Plattform), Absolute Regel 1. Kein
> Gate wird entfernt oder ersetzt, es kommt nur eine zusaetzliche, engere Decke dazu.
>
> **0-Sentinel (SAFETY-BLOCKER, kein Stilfehler):** Der Fallback greift nur bei
> `defaultTenantBudgetCents > 0`. 0 ist die dokumentierte Sentinel-Semantik "kein
> Default-Seed" - ein bedingungsloser Fallback lieferte bei Live-Wert 0 einen Cap von 0:
> `budgetExceeded` (`>=`) waere fuer JEDEN Tenant ohne Zeile sofort `true` - jeder
> Outbound blockt, der kostenlose Inbound-Pfad weist ab, jeder laufende Call legt mitten
> im Gespraech auf. Das waere ein Totalausfall der Telefonie. Derselbe Vergleich faengt
> zugleich ein fehlendes oder nicht-numerisches Feld ab (`undefined > 0` ist `false`) und
> landet dann ebenfalls auf dem Bestandsverhalten - die Abweichung geht immer Richtung
> Bestand, nie Richtung 0-Cap. Test: `test/effective-cap-fallback.test.js`.
>
> **Offene Inkohaerenz (nicht in dieser Phase geloest):** Live UND `.env.example`/
> `render.yaml` stehen auf `MAX_BUDGET_EUR=8` (800 Cent) bei `DEFAULT_TENANT_BUDGET_CENTS=
> 1000`. In dieser Konstellation bindet die Schnittmenge weiter am globalen Cap (800 <
> 1000) - der neue Fallback ist bei den aktuellen Werten ein reiner Code-Riegel ohne
> sofortige Live-Wirkung, kein Verstoss gegen Regel 1. Aufloesung gehoert an P0
> (`MAX_BUDGET_EUR` anheben) oder ans Senken des Default-Werts, nicht an diese Phase.
>
> **Nicht beruehrt:** Kein Gate entfernt/aufgeweicht. `seedTenantDefaultBudget` (Seed
> beim Registrieren) unveraendert. Kein Backfill bestehender Tenants, keine Migration.

## P5A-ACHSENTRENNUNG — Achsen in Anzeige und Ablehnung getrennt (2026-07-19)

> **Durch KS-P9 (2026-07-30, E10) ueberholt:** die Plattform-Achse (`MAX_BUDGET_EUR`) trifft keine Sperrentscheidung mehr. Aussagen dieses Abschnitts ueber einen Plattform-Notaus / eine Geld-Schnittmenge beschreiben den Stand VOR KS-P9 und werden bewusst nicht rueckwirkend umgeschrieben.
>
> **Durch KS-P8 (2026-07-30, E4) teilweise ueberholt:** die hier beschriebene "Neue
> Informationskante" (`/api/state` nennt eigene Budgetzahlen des Tenants) gilt seither
> NUR NOCH fuer die 402-Ablehnungstexte des `budget`-/`reserve_budget`-Gates.
> `/api/state` traegt seit KS-P8 keinen Kostenbetrag mehr - s. Abschnitt KS-P8 unten.

> **Neue Informationskante:** `/api/state` und jede 402-Ablehnung des `budget`-/
> `reserve_budget`-Gates (`src/telephony/outbound-gates.js`) nennen jetzt EIGENE
> Budgetzahlen des anfragenden Tenants (Decke, Verbrauch, Fehlbetrag). Vorher stand in
> `usage.maxBudgetEur` der GLOBALE Plattform-Cap neben dem TENANT-Verbrauch - "3,50 von
> 8,00" sah gesund aus, waehrend die eigene Decke (oder die Plattform-Achse) laengst
> blockierte (D4). Der alte Schluessel `maxBudgetEur` ist ERSATZLOS entfallen (kein
> Schluessel-behalten-Bedeutung-wechseln), neuer Schluessel `tenantCapEur`
> (`src/store/state-ops.js` `tenantBudgetSnapshot`, EINE Quelle mit den Gate-Praedikaten
> `effectiveCapCents`/`usageFor`/`reservationFor`).
>
> **Begrenzt auf die EIGENE Tenant-Achse - die Plattform-Achse bleibt zahlenfrei.** Der
> Plattform-Notaus (`globalBudgetExceeded`/`globalReserveExceedsBudget`) wird zwar
> BENANNT (`grund=budget_platform`, Text "Plattform-Notaus aktiv, bitte Betreiber
> kontaktieren."), gibt aber NIE eine Zahl heraus - weder den Cap noch die Summe ueber
> fremde Tenants. Der Text ist ein interpolationsfreies String-Literal
> (`PLATFORM_DENIAL`), der Plattform-Zweig liest `tenantBudgetSnapshot` gar nicht erst.
> `globalCapEur` (die einzige EUR-Ableitung des Plattform-Caps) ist mit dieser Phase aus
> dem Repo entfernt (tote Funktion, kein Aufrufer mehr) - eine Plattform-Zahl kann an
> dieser Stelle strukturell nicht mehr in eine Tenant-Antwort geraten (Cross-Tenant-Leck,
> Absolute Regel 4/6). Test: `test/deny-diagnosability.test.js`,
> `test/api-state-usage-axis.test.js` (Whitelist-Assert auf die Feldmenge von `usage`).
>
> **Akzeptierte Kante (0-Sentinel, aus P2A-TENANTFALLBACK geerbt):** Steht
> `DEFAULT_TENANT_BUDGET_CENTS=0` (Sentinel "kein Default-Seed"), faellt
> `effectiveCapCents` laut P2A-Praezedenz auf den globalen Cap - `tenantCapEur` traegt
> dann denselben Zahlenwert wie der Plattform-Cap. Das ist KEINE Plattform-Offenlegung:
> es ist die real bindende eigene Decke DIESES Tenants, und es wird nie ein Plattform-
> VERBRAUCH (Summe ueber fremde Tenants) sichtbar. Prod steht auf `DEFAULT_TENANT_BUDGET_
> CENTS=600` (> 0), der P3-Boot-Guard `spendCapCoherence` haelt die Ordnung.
>
> **Kein Praedikat, keine Gate-Entscheidung geaendert.** `budgetExceeded` (`>=`) und
> `reserveExceedsBudget` (`>`) sind unangetastet; `tenantBudgetSnapshot` ist eine rein
> lesende Diagnose-Query auf DERSELBEN Quelle. Die Ablehnung nennt NIEMALS eine noch
> ausfuehrbare `max_duration_s`/Sekunden/Minutenzahl - Fehlbetrag + Spend-Monat-Ende
> erfuellen das Diagnose-Ziel, ohne dem aufrufenden LLM eine maschinenlesbare
> Umgehungsanleitung fuer die Reserve-Berechnung zu liefern (per Negativ-Assert in jedem
> Reserve-Testfall gepinnt).

## P7-SPENDMONTH — Gate-Achse auf UTC-Kalendermonat umstellbar (2026-07-20)

> **Durch KS-P9 (2026-07-30, E10) ueberholt:** die Plattform-Achse (`MAX_BUDGET_EUR`) trifft keine Sperrentscheidung mehr. Aussagen dieses Abschnitts ueber einen Plattform-Notaus / eine Geld-Schnittmenge beschreiben den Stand VOR KS-P9 und werden bewusst nicht rueckwirkend umgeschrieben.

> **Was diese Phase einzieht:** zwei benannte Aufloesungsfunktionen
> (`gateUsageCents`/`gatePlatformUsageCents`, `src/store/state-ops.js`), auf die alle vier
> Gate-Praedikate (`budgetExceeded`/`reserveExceedsBudget`/`globalBudgetExceeded`/
> `globalReserveExceedsBudget`) umgestellt sind. Hinter EINEM Flag
> (`BUDGET_MONTH_ENABLED`, `config.billing.budgetMonthEnabled`, Default AUS): AUS liest
> weiter den Lebenszeit-Zaehler `costCents` (byte-identisch zum Bestand), AN liest
> stattdessen die additive, seit P4 mitgefuehrte Spend-Monat-Achse
> (`spendMonthUsageCents`) - denselben UTC-Kalendermonat. **Diese Phase flippt das Flag
> NICHT** - der Flip ist ein bewusster Betreiber-Akt NACH einem Live-Beleg, dass
> `spendMonthKey` einen Neustart uebersteht (Free-Tier-Host, fluechtiges Dateisystem).
>
> **Bewusst akzeptierte Divergenz (Kalendermonat vs. Abrechnungsperiode):** der Gate-Monat
> beginnt am 1. UTC, die Stripe-Abrechnungsperiode am Anmeldetag des Tenants. Ein Tenant
> kann dadurch innerhalb EINER Rechnungsperiode zwei Gate-Monate ausschoepfen - also bis
> zu 2x seine eigentliche Decke. Akzeptiert: ein Anker an der Stripe-Periode waere ohne
> Abo fail-closed und wuerde jeden pre-Payment-Tenant dauerhaft sperren; eine halbierte
> Decke verschiebt die Willkuer nur auf einen anderen Wert. Datiert festgehalten, damit
> diese Kante in einem Jahr als bewusste Entscheidung erinnert wird, nicht als Bug neu
> entdeckt.
>
> **Was der (kuenftige) Flip aufgibt:** der Lebenszeit-Akku war ein Bug (siehe P4) UND ein
> absoluter Deckel - ein Tenant/die Plattform konnte den Cap genau EINMAL je Lebenszeit
> ausschoepfen. Ab Flag AN kostet die Plattform bis zum Cap, JEDEN Monat, unbegrenzt oft.
> Das ist die einzige bewusste Lockerung der gesamten Budget-Achsen-Kette.
>
> **Was dagegen steht:** Default AUS (die volle Bestandssuite bleibt mit Flag AUS
> unveraendert gruen, siehe `test/budget-month-flip.test.js`); Rollback per Env-Flip OHNE
> Deploy; `costCents` bleibt unveraendert als unabhaengige Gegenprobe stehen (D7-Riegel
> prueft nach dieser Phase BEIDE Zahlen - Gate-Groesse UND Lebenszeit-Wert derselben
> Quelle - ein Flag darf eine bestehende Sicherung nie schrumpfen lassen); die P6-
> Fruehwarnung (`claimPlatformSpendWarning`) liest ueber `platformSpendObservedCents`
> dieselbe Achse wie das Gate, damit sie nach einem Flip nicht dauerhaft auf der
> abgeschalteten Lebenszeit-Achse fehlalarmiert.
>
> **Nicht Teil dieser Phase:** kein Flag-Flip, keine Cap-Neudimensionierung (die Cap-Werte
> `MAX_BUDGET_EUR`/`DEFAULT_TENANT_BUDGET_CENTS` sind nach einem kuenftigen Flip MONATS-
> statt Lebenszeit-Werte - eine Env-Entscheidung des Betreibers, kein Code-Default), kein
> abgeleiteter Plattform-Cap (eigene Folgephase), keine Aenderung an den
> Ablehnungstexten/`tenantBudgetSnapshot` (die zeigen nach einem Flip weiter
> Lebenszeit-Zahlen neben einer Monats-Entscheidung - irrefuehrend, aber nicht unsicher,
> da keine Gate-Entscheidung daran haengt; bewusst ausgeklammerte Folgephase - **genau
> diese Folgephase ist KS-P4, s. u.**).

## P4B-FULLCOSTGUARD — Vollkosten-Boot-Guard sichert die kuenftige Owner-Tarifsenkung ab (2026-07-20)

> **Was diese Phase einzieht:** eine neue Env-Var `VOICE_TARIFF_FULL_COST_FLOOR_CENTS`
> (`config.billing.voiceTariffFullCostFloorCents`, GANZZAHL EUR-Cent, Default 10) plus
> eine reine WARN-Boot-Entscheidung `voiceTariffFloorFindings` (`src/boot-guard.js`),
> verdrahtet als `warnVoiceTariffBelowFullCost` (`src/boot.js`, Ende von
> `assertBootGates`). Diese Phase SENKT `VOICE_TARIFF_DOMESTIC_CENTS` NICHT (bleibt
> Default `20`) - sie liefert nur die Absicherung fuer eine spaetere Owner-Tarifsenkung.
>
> **Feuert GENAU in der Konjunktion:** der konfigurierte Inlandstarif
> (`VOICE_TARIFF_DOMESTIC_CENTS`) liegt unter der Vollkostenschwelle UND die live aus
> dem Kosten-Abgleich-Spiegel gerechnete Deckungsquote (`costTruingCoveragePercent`, P3,
> EINE Quelle - auch fuer den P4-Buchungsguard) liegt unter
> `COST_TRUING_MIN_COVERAGE_PERCENT`. Nur EINE der beiden Bedingungen -> KEINE Meldung.
> WARN, kein `exit(1)` (Praezedenz `warnUnpricedModels`/`warnAlertChannelUnset`): ein
> Boot-Refusal tauschte ein Kostenproblem gegen einen Telefonie-Totalausfall.
>
> **Schwellen-Herleitung (10, nicht 5):** teuerste AKTIVIERBARE Konfiguration inklusive
> des im Code UND per Env (`TELNYX_AI_ASSISTANT_ENABLED`) noch aktivierbaren
> Assistant-Pfads, 10,4 USD-Cent/min * 0,92 (USD->EUR-Kurs) = 9,568, aufgerundet 10. Nach
> VOLLZOGENEM Rueckbau des Assistant-Pfads (grep findet `startAssistant`/
> `ai_assistant_start` nicht mehr) sinkt die Schwelle auf 5 (5,4 USD-Cent * 0,92 = 4,968,
> aufgerundet) - der Rueckbau selbst ist NICHT Teil dieser Phase.
>
> **`min:0`, nicht `min:1`:** Test-neutral wie `VOICE_TARIFF_DOMESTIC_CENTS=0` - BASE_ENV
> setzt beide auf `"0"` (`0 < 0` = false = still), sonst feuerte der Guard flaechendeckend
> in der Suite. Unset (Prod/Render) faellt auf den armierten Default `10` zurueck. `0`
> deaktiviert den WARN bewusst und sichtbar - er ist eine Diagnose (kein Geld-Gate), also
> KEIN per-Default abgeschaltetes Safety-Gate im Sinne von Regel 1.
>
> **Bewusst NICHT eigenstaendig ueberwacht:** die Vollkosten-Deckungsquote ALLEIN. Bei
> hoher Deckung (>= `COST_TRUING_MIN_COVERAGE_PERCENT`) schweigt der Guard auch dann,
> wenn der Tarif unter der Vollkostenschwelle liegt (Test (q1) pinnt diese Flanke explizit
> als akzeptierte Kante, nicht als Luecke). Der Guard beweist "die Senkung ist unter
> duenner Deckung passiert", nicht "die Senkung ist beliebig sicher".
>
> **Nicht beruehrt:** `metering.js`, `outbound-gates.js`, kein Buchungs-/Gate-Pfad,
> `VOICE_TARIFF_DOMESTIC_CENTS`-Default (bleibt `20`). Denylist/Land-Gate/Stundenlimit/
> Budget-Guard/Max-Dauer/Signaturpruefung sind nicht angefasst.

## P6-BUDGETFENSTER — Perioden-Fenster + ersatzloser Wegfall der Plattform-Stundenbremse (2026-07-26)

> **Durch KS-P9 (2026-07-30, E10) ueberholt:** die Plattform-Achse (`MAX_BUDGET_EUR`) trifft keine Sperrentscheidung mehr. Aussagen dieses Abschnitts ueber einen Plattform-Notaus / eine Geld-Schnittmenge beschreiben den Stand VOR KS-P9 und werden bewusst nicht rueckwirkend umgeschrieben.

> **Bewusste Abweichung von Absoluter Regel 1 (O5, Owner-Entscheidung):** die
> plattformweite Stundenbremse (`globalHourReached`, `countOutboundCallsSince` OHNE
> Filter) ist **ersatzlos entfallen**. Begruendung: ein globales Anruflimit macht mit
> wachsender Tenant-Zahl jeden zusaetzlichen Kunden zum Gegner aller anderen - ein
> einzelner Tenant konnte die gesamte Plattform aus dem Stundenfenster draengen. Die
> verbleibende Achse (`tenantHourReached`) zaehlt nach `tenantId` statt `requestedBy` und
> ist damit **strikt strenger** als die frueher zweite Achse (`count(tenantId) >=
> count(requestedBy)`); `min(config, profil)` bleibt, `maxCallsPerHour:0` bleibt harter
> Block. **Verbleibender Plattform-Not-Aus:** `OUTBOUND_FROZEN` (globaler Kill-Switch,
> erstes Gate der Kette). Die GELD-Achse ist unveraendert eine Schnittmenge
> (`globalBudgetExceeded`/`gatePlatformUsageCents` sind nicht angefasst).
> Quelltext-Invariante (`test/gap-10-hour-limit-per-tenant.test.js`): jeder
> `countOutboundCallsSince`-Aufruf in `outbound-gates.js` traegt ein Filter-Objekt - eine
> ungefilterte Fundstelle waere die zurueckgebaute Plattform-Bremse.
>
> **Ablehnungstext ohne Env-Namen:** `MAX_CALLS_PER_HOUR=<n>` steht nicht mehr im
> Kundentext (Regel-4-Nachbarschaft: der Anrufer erfaehrt die Sperre, nicht die
> Konfigurationsflaeche). Der Blattwert bleibt ueber `grund=stundenlimit` im Audit-Log
> forensisch nachvollziehbar; die Wertempfindlichkeit des Gates ist per Gegenprobe
> getestet (`test/outbound-gates-order.test.js`).
>
> **Perioden-Fenster des Budget-Gates (GAP-01).** `gateUsageCents` misst im Zweig
> `BUDGET_MONTH_ENABLED=false` nicht mehr die Lebenszeit, sondern `costCents` minus
> `budgetPeriodBaselineCents` - gestempelt bei Beginn der Stripe-Abrechnungsperiode
> (`stampBudgetPeriod`, aufgerufen in `activatePaidTenant`). Der Flag-AN-Zweig
> (Spend-Monat, P7) und die Plattform-Achse bleiben unberuehrt. Reset-Bedingung = dieselbe
> Kante wie die Reaktivierung (O4): erreichbar nur fuer ein bestaetigtes Abo
> (`CONFIRMED_SUBSCRIPTION_STATUS`; `past_due`/`unpaid`/`incomplete` sind vorher `IGNORE`)
> UND ohne aktiven `billingHold`. Monotonie-/Idempotenz-Riegel ueber `laterMonotonicKey`
> (dieselbe eine Regel wie die Spend-Monat-Achse).
>
> **Getragene Restrisiken (bewusst akzeptiert, nicht behoben):**
>
> 1. Ein gestempelter Bucket ohne weiterlaufendes Abo (Kuendigung) friert auf dem letzten
>    Baseline ein - das Fenster wird nie mehr zurueckgesetzt. Ueber die Zeit ist das
>    **strenger** als vorher, aber dauerhaft um den Baseline lockerer als Lebenszeit. Der
>    Tenant ist ueber `tenantInactive`/`allowlistError` ohnehin fuer Outbound gesperrt.
> 2. ~~Eine verspaetete Kostenkorrektur aus der Vorperiode faellt positiv ins neue Fenster
>    bzw. wird negativ auf 0 geklemmt (`Math.max(0, ...)`, sonst waere sie ein Guthaben,
>    das das Gate aufweitet). Identische Asymmetrie wie die bestehende Spend-Monat-Achse
>    (`bookCostCorrectionCents`) - kein neuer Sachverhalt.~~ **Aufgeloest in KS-P5**
>    (2026-07-30): eine verspaetete Gutschrift wirkt je Achse nur, wenn der am Call
>    persistierte Belastungs-Anker (`estimated_cost_spend_month_key` /
>    `estimated_cost_period_key`) dieselbe Achsen-Zahl trifft; gehoert sie in ein
>    abgeschlossenes Fenster, wandert `budgetPeriodBaselineCents` mit und das Fenster bleibt
>    unberuehrt. Eine Gutschrift der LAUFENDEN Periode gibt dem Kunden sein Kontingent
>    dagegen zurueck, statt wie bisher nur den Lebenszeit-Zaehler zu senken.
> 3. ~~`tenantBudgetSnapshot` (Anzeige/Ablehnungstexte) bleibt eine LEBENSZEIT-Sicht neben
>    einer Perioden-Entscheidung.~~ **Aufgeloest in KS-P4** (2026-07-30): der Snapshot
>    liest seither dieselbe aufgeloeste Gate-Groesse (`gateUsageCents` ueber
>    `tenantUsageAxes`) wie `budgetExceeded`/`reserveExceedsBudget` - die Anzeige/Gate-
>    Divergenz entfaellt strukturell, s. Abschnitt `## KS-P4` unten.
>
> **Belastungs-Anker + 0-Boden beider Achsen (KS-P5, 2026-07-30).** Bis dahin unbeschrieben
> und deshalb hier nachgetragen: die PERIODEN-Achse hatte den Missbrauchsschutz vor KS-P5
> **gar nicht**. `budgetPeriodUsageCents` ist eine reine Ableitung (`costCents` minus
> Baseline) - jede Gutschrift senkte das Fenster automatisch mit, gleich aus welcher Periode
> die Belastung stammte. Nur die SPEND-MONAT-Achse war geschuetzt, und die pauschal (jede
> negative Korrektur wurde von ihr ferngehalten). Seit KS-P5 entscheidet auf BEIDEN Achsen
> derselbe Belastungs-Anker: `recordCallEstimatedCostCents` persistiert zusammen mit dem
> Betrag die zwei Achsen-Stempel, unter denen tatsaechlich gebucht wurde (Bucket-Brigade in
> `reconcileOutboundVoiceBudget` - der Anker ist der Rueckgabewert der Buchung, nie
> `call.startedAt` und nie der Zeitpunkt der Korrektur). Fehlt der Anker (Bestandszeile vor
> KS-P5, kein Backfill moeglich), gilt `NO_CHARGE_ANCHORS` und die Gutschrift bleibt auf der
> Lebenszeit-Achse - dem Bestandsverhalten und der strengsten der drei Achsen.
>
> Damit die Monats-Achse jetzt sinken KANN, traegt `spendMonthUsageCents` seit KS-P5
> denselben `Math.max(0, ...)`-Riegel wie die Schwester `budgetPeriodUsageCents`. Ohne ihn
> waere die Folge nicht lokal: der 0-Boden von `costCents` kappt die Lebenszeit, die
> Monatszahl bekaeme den vollen Betrag ab und koennte negativ werden - ein negativer
> Monatsverbrauch ist ein Guthaben, das ueber `platformSpendMonthCents` in die
> PLATTFORM-Summe wandert und die dort abgelesene Zahl fuer ALLE Tenants nach unten zieht
> (seit KS-P9 Beobachtung/Schwellenwarnung statt Sperre - eine verfaelschte Warnschwelle
> bleibt trotzdem ein Befund). Testgepinnt in
> `test/ks-p5-current-period-credits.test.js` (P5/P6).
>
> **Deploy-Vorbedingung (KS-P5, DDL).** Zwei additive NULLABLE Spalten auf `call`. Reihenfolge
> zwingend **erst migrieren, dann deployen** (zusaetzliche Spalten stoeren den alten Code
> nicht, fehlende brechen den neuen sofort - Lehre `no-automatic-db-migration`):
> `ALTER TABLE call ADD COLUMN IF NOT EXISTS estimated_cost_spend_month_key TEXT;` und
> `ALTER TABLE call ADD COLUMN IF NOT EXISTS estimated_cost_period_key TEXT;`
>
> **Deploy-Vorbedingung (GAP-07).** `alertChannelFindings` liefert seit dieser Phase einen
> FATALEN Befund bei `PAYMENT_ENABLED=true` UND `PLATFORM_SPEND_WARN_PERCENT>0` UND leerem
> `PLATFORM_ALERT_SMS_TO`; `assertConfig()` faltet ihn in seine Fatal-Menge -> **Boot-
> Refusal**. Vor dem Deploy ist der Live-Zustand von `PLATFORM_ALERT_SMS_TO` abzulesen:
> ist der Kanal leer, verweigert die Instanz den Start. Abhilfe: Empfaenger setzen ODER
> `PLATFORM_SPEND_WARN_PERCENT=0` (Warnung bewusst aus). Ohne Buchung oder mit
> abgeschalteter Warnschwelle bleibt es bei der bestehenden WARN.
>
> **Nicht beruehrt:** `disclosureSentence`, Signaturpruefung, Auth, `MAX_BUDGET_EUR`/
> `globalBudgetExceeded`/`gatePlatformUsageCents`, `DEFAULT_TENANT_BUDGET_CENTS`,
> `BUDGET_MONTH_ENABLED`-AN-Pfad, `render.yaml`-Werte (`MAX_CALLS_PER_HOUR` bleibt `6`).
> Keine neue Dependency, kein neuer Env-Schluessel.

## P7-BOOTKOHAERENZ — startfaehiger Blueprint + In-Prozess-Heilung des leeren Stores (2026-07-26)

> **Durch KS-P9 (2026-07-30, E10) ueberholt:** die Plattform-Achse (`MAX_BUDGET_EUR`) trifft keine Sperrentscheidung mehr. Aussagen dieses Abschnitts ueber einen Plattform-Notaus / eine Geld-Schnittmenge beschreiben den Stand VOR KS-P9 und werden bewusst nicht rueckwirkend umgeschrieben.

> **Kosten-Decken kohaerent gemacht (GAP-32/GAP-33).** Die ausgelieferte Konfiguration war
> auf zwei Achsen inkohaerent: `MAX_BUDGET_EUR=8` (800 ct) lag unter der abgeleiteten
> Business-Plan-Decke (900 ct) → `plan_cap_inert`, `exit 1` (der Blueprint war nicht
> startfaehig), und `DEFAULT_TENANT_BUDGET_CENTS=600` lag unter der Worst-Case-Reserve
> `VOICE_TARIFF_DEFAULT_CENTS(300) * ceil(MAX_CALL_DURATION_CAP_S(300)/60) = 1500` → jedes
> Ziel ohne gemessenen Inlandssatz fiel schon vor dem Dial ins Reserve-Gate (402). Angehoben
> wurde ausschliesslich die **Decke** (30 / 1500), gegen die reserviert wird — auf exakt den
> Betrag, den die eigene Rechnung fordert. **Kein Gate wurde aufgeweicht:** Tarif, Land-Gate,
> Stundenlimit, Denylist, Max-Dauer und die Signaturpruefung sind unveraendert (O6: Tarif
> NICHT senken, `MAX_CALL_DURATION_CAP_S` bleibt 300 s und Code-Konstante). **Geld-Folge,
> ausdruecklich:** ein Tenant ohne eigene `tenant_budget`-Zeile darf 15,00 EUR statt 6,00 EUR
> pro Fenster verbrauchen; der Plattform-Backstop bleibt als Schnittmenge bei 30,00 EUR.
>
> **Neuer FATALER Boot-Guard (GAP-32).** `spendCapCoherence` Klausel B
> (`WORST_CASE_UNAFFORDABLE`: Worst-Case-Reserve > Tenant-Decke) ist von WARN auf **FATAL**
> gedreht. Bis dahin stand die Zeile seit dem ersten Deploy folgenlos im Log, waehrend der
> Dienst fuer jedes Ziel ohne gemessenen Inlandssatz faktisch abgeschaltet war — eine
> Konfiguration, unter der ein ganzer Zielbereich **vor dem Dial** abgewiesen wird, ist kein
> Betriebszustand. Die Meldung nennt beide Env-Namen, die berechnete Reserve und den
> Zielwert (`Abhilfe: … auf mindestens <n> anheben`), ausschliesslich Betreiber-Zahlen —
> kein Secret, kein PII. `AUDITED_BOOT_FINDINGS` in `src/boot.js` ist damit unerreichbar
> geworden und ersatzlos entfallen (toter Code). **Rollback ohne Deploy:**
> `DEFAULT_TENANT_BUDGET_CENTS` im Dashboard anheben; mit Deploy: `git revert` dieses einen
> Commits.
>
> **Neuer SCHREIBENDER Boot-Pfad (GAP-38).** `healBootstrapStore` (`src/boot.js`) legt beim
> Start Bootstrap-Tenant + aktive Nummer aus `BOOTSTRAP_E164`/`BOOTSTRAP_PROVIDER` an. Er
> ersetzt den `preDeployCommand` in `render.yaml`, den Render auf `plan: free` **nie
> ausgefuehrt** hat — der Bootstrap-Seed lief live also nie, und ein frischer/leerer Store
> endete bei jedem Deploy im fail-closed Boot-Refusal (`hasActiveNumber`).
>
> **Riegel dieses Pfads** (Entscheidung `bootstrapHealDecision`, `src/boot-guard.js`, rein
> und arg-injiziert; die Reihenfolge ist die Spezifikation):
>
> 1. `NOT_NEEDED` — irgendeine aktive Nummer da → nichts tun (idempotent, strukturell:
>    nach der Heilung ist genau das der Zustand).
> 2. `BLOCKED_STORE_NOT_FRESH` — **jede** Spur eines gelebten Stores (Nummer in *irgendeinem*
>    Zustand, fremder Tenant neben dem Code-Default-Bootstrap-Tenant, Call-Historie) → **NIE**
>    heilen; der bestehende fail-closed Refusal greift stattdessen. Das ist der Riegel gegen
>    Tenant-/Nummern-Proliferation.
> 3. `BLOCKED_PARAMS` — leere ODER unbrauchbare Parameter (E.164-Regex + `telnyx`).
>    Pflicht, kein Stil: `seedBootstrapNumber` **normalisiert nur, es validiert nicht** — ein
>    Tippfehler wuerde sonst als "aktive Nummer" geseedet und der Boot liefe gruen mit totem
>    Routing (Lehre `seedOwnerNumberFromEnv`).
> 4. `HEAL` — nur hier wird geschrieben.
>
> Die Funktion **verweigert nie selbst**: sie heilt oder schweigt. `assertBootGates` bleibt
> die EINZIGE Stelle, die "keine Nummer → kein Start" entscheidet (eine Exit-Stelle). Sie
> laeuft **nach** `store.load()` (ein Ladefehler hat den Prozess dort bereits beendet) und
> **vor** den Gates. Kein Nummern-**Kauf** ist beteiligt (`bootstrapTenant` ist reine
> State-Mutation, kein Provider-IO, keine Kosten).
>
> **Regel 4 (Secrets/PII):** die Nummer wird **nie** geloggt — weder im Erfolgs-Log noch in
> der Fehlermeldung noch im Audit (`bootstrap_store_geheilt` traegt nur `provider=`). Der
> Vorgang ist ueber Audit-Zeile + Plattform-SMS (`PLATFORM_ALERT_SMS_TO`) sichtbar, damit
> eine unerwartete Heilung nicht unbemerkt bleibt.
>
> **Getragenes Restrisiko:** ein korrupter `store.json` wird forensisch umbenannt und auf
> Defaults zurueckgesetzt; dieser Zustand ist nach obigem Kriterium "frisch" und wuerde bei
> gesetzten Parametern geheilt. Bewusst so: die Forensik-Kopie bleibt, `[store] KORRUPTES
> store.json erkannt` bleibt laut, Heilung + Audit + SMS machen das Ereignis sichtbar — die
> Alternative waere ein toter Telefondienst.
>
> **Follow-up ausserhalb dieser Phase:** `OWNER_NUMBER_SEED`/`OWNER_NUMBER_PROVIDER`
> (json-only, seedet nur die Nummer ohne Tenant) und `BOOTSTRAP_E164`/`BOOTSTRAP_PROVIDER`
> (backend-agnostisch, Tenant + Nummer) sind zwei Env-Paare fuer dieselbe Sache. Sie
> komponieren heute sauber (der json-Seed laeuft in `load()`, die Heilung wird danach
> `NOT_NEEDED` — gepinnt in `test/bootstrap-heal-boot.test.js`), sollten aber konsolidiert
> werden.
>
> **Nicht beruehrt:** `disclosureSentence`, Signaturpruefung, Auth, alle Outbound-Gates,
> `scripts/bootstrap-tenant.js` (bleibt der manuelle Weg), `VOICE_TARIFF_*`,
> `MAX_CALL_DURATION_*`, die Plan-Decken (`planCapCents`). Keine neue Dependency.

## SCA-DEADEND — off-session-Zahlung ohne Authentifizierungs-Ausweg (offen, 2026-07-27)

**Status: OFFEN. Launch-Blocker der Geld-Achse.** Gefunden in W3/PAY-19, live gegen Stripe
TEST gemessen — nicht vermutet.

**Symptom.** Verlangt die Bank eines Kunden bei einer off-session-Belastung eine
Authentifizierung (3-D Secure / SCA), lehnt Hermes ab und behandelt den Vorgang als
Fehlschlag. Der Kunde wird nie gefragt und hat keinen Weg, die Zahlung zu bestaetigen.

**Gemessen** (Replikat von `placeHold` gegen Stripe TEST mit dem dokumentierten Test-Token
`pm_card_authenticationRequired`; kein Echtgeld, keine Karteneingabe):

```
HTTP 402 · error.code = authentication_required · decline_code = authentication_required
payment_intent.status = requires_payment_method · next_action = NICHT VORHANDEN
```

Das fehlende `next_action` ist der Kern: es gibt in dieser Antwort **nichts, wohin man
umleiten koennte**. Eine Erholung muss eine NEUE on-session-Bestaetigung sein.

**Zwei betroffene Pfade.**

| Pfad | Stelle | Heute |
| --- | --- | --- |
| Abo anlegen | `src/billing/stripe.js:338-356` | `off_session=true` + `payment_behavior: error_if_incomplete`; der Kommentar `:330-333` nennt 3DS ausdruecklich und waehlt fail-closed. Stripe wirft -> **der Kunde kann nicht abonnieren**. |
| Reserve vor Anruf/Nummernkauf | `src/billing/stripe.js:135-161` | `assertOk` wirft bei 402 -> Nummer auf `failed` (`src/store/views.js:83`) bzw. Anruf abgelehnt. |

**Drei Luecken.**
1. Keine Erkennung: `grep -rniE "requires_action|authentication_required|next_action|3ds"
   src/billing/` -> 0 Treffer. Der Fall ist von einer echten Ablehnung ununterscheidbar.
2. Kein typisierter Grund: `subscribeAndActivate` (`src/billing/subscribe.js:95-112`) kennt
   `plan_unconfigured`/`already_subscribed`/`no_card`; ein Wurf aus `createSubscription`
   ist keiner davon und propagiert unbehandelt.
3. Keine Benachrichtigung und kein Wiederaufnahme-Pfad fuer den Kunden.

**Warum das nie aufgefallen ist.** Laut der Checkout-Forensik vom 2026-07-10 waren alle
vier Live-Rechnungen 0,00 EUR (Owner-Coupon) — der Vollpreis-Pfad mit echtem PaymentIntent
**lief in Produktion noch nie**. Die Fehlerrate ist damit nicht "niedrig", sondern
**ungemessen**; der erste echte zahlende Kunde ist das Experiment. (Nicht verwechseln mit
der dortigen Blockade: die betraf einen SetupIntent mit `generic_decline` — anderes Objekt,
anderer Code, kein belegter Zusammenhang.)

**Vorgesehene Abhilfe** (Stripe-Standardweg, noch nicht umgesetzt):
- Abo: `payment_behavior: default_incomplete`, dann `next_action` bzw. die
  Hosted-Invoice-URL der ersten Rechnung an den Kunden reichen. `error_if_incomplete` wirft
  genau die Information weg, die die Erholung traegt.
- Reserve: `authentication_required` am `error.code` erkennen, eigener typisierter Grund
  statt stiller `failed`-Zustand, Kunde benachrichtigen.
- Beide Pfade brauchen einen Test — **seit 2026-07-27 vorhanden**:
  `test/pay-19-sca-authentication-required.test.js` haelt zwei SOLL-Gates (`PAY-19`), die
  verlangen, dass ein SCA-Fehlschlag am Ergebnis **maschinenlesbar** von einer echten
  Ablehnung unterscheidbar ist. Beide heute rot; die Fehlermeldung nennt den Beweis:
  `{"type":"Error","own":{}}` fuer BEIDE Faelle. Formuliert am beobachtbaren Ergebnis, nicht
  an einer Signatur — der Fix darf einen eigenen Fehlertyp (Praezedenz: `CustomerMissingError`),
  ein Feld am Fehler oder ein typisiertes Ergebnis waehlen.

---

## P14-PORTALPFAD — Basic-Auth-Ausnahme fuer `/tenant.html` entfallen (2026-07-28)

`public/tenant.html` (das alte Kunden-Dashboard) ist geloescht; die App-Shell aus
`apps/web` (`/app`, `WEB_DIST_DIR`) ist das einzige Kunden-Dashboard. Sicherheits-Folgen:

- Die flag-gegatete Basic-Auth-**Ausnahme** fuer `/tenant.html` (`src/wiring/auth-gate.js`,
  frueher der erste Eintrag der eingefrorenen Exemption-Kette INV-3) ist **entfernt**. Die
  Kette ist um einen Eintrag kuerzer: `/voice*` -> `/mcp*` -> `/.well-known*` ->
  `STRIPE_WEBHOOK_PATH` -> `/healthz` -> `BRAND_ASSETS_PREFIX*` -> `/favicon.ico` ->
  `isTrustedLocalCaller` -> `safeEqual`. Richtung **fail-closed**: eine Ausnahme faellt
  weg, das kann nie etwas oeffnen. Live-Wirkung: keine — mit `WEB_DIST_DIR` beantwortet
  der Altpfad-Redirect `/tenant.html` bereits **vor** dem Gate (`registerStaticServing`
  wird vor `installAuthGate` gemountet), die Ausnahme war dort schon unerreichbar.
- Der Post-Login-Zweig auf `/tenant.html` (`src/wiring/web-login.js`) ist entfallen — ein
  Redirect dorthin waere nach der Loeschung ein 404 direkt nach dem Login.
- Der **Redirect** `/tenant.html` -> `/app` (inkl. Query-String) bleibt bewusst bestehen:
  Stripe-Checkout-Sessions, die vor dem Deploy geoeffnet wurden, tragen die alte
  Rueckkehr-Adresse in der Stripe-Session; ohne den Redirect landet genau der Kunde, der
  gerade bezahlt hat, auf einem 404 (`test/single-origin-serving.test.js`).

**Offen (Folgeauftrag, bewusst NICHT Teil von P14):** die CSP in `src/middleware.js`
lockert `script-src`/`style-src` auf `'unsafe-inline'` **wegen** der geloeschten Datei.
Der urspruengliche Grund ist entfallen, die Regel bleibt vorerst unveraendert — das
Verschaerfen verlangt, die App-Shell aus `apps/web` vorher gegen die engere Policy zu
messen, und ist deshalb ein eigener Auftrag, kein Nebeneffekt der Loeschung.

## AL-P6-TURNBUDGET — Budget-Pruefung pro Tool-Loop-Runde + Turn-Frist (2026-07-28)

> **Durch KS-P9 (2026-07-30, E10) ueberholt:** die Plattform-Achse (`MAX_BUDGET_EUR`) trifft keine Sperrentscheidung mehr. Aussagen dieses Abschnitts ueber einen Plattform-Notaus / eine Geld-Schnittmenge beschreiben den Stand VOR KS-P9 und werden bewusst nicht rueckwirkend umgeschrieben.

**Das Loch.** `agentTurn` (`src/claude.js`) fuhr eine feste Schleife ueber bis zu vier
`llm.complete`-Runden und buchte in **jeder** Runde `bookTokenUsage(...)` — geprueft wurde
das Budget aber hoechstens **einmal je Request**: im Assistant-Pfad vor dem Turn (Shim,
Schritt 6), im Budget-Pfad `/voice/turn` **gar nicht** (nur `/voice/incoming` hat ein
Gate). Ein Cap, der mitten im Turn riss, kostete also bis zu drei weitere Runden Tokens,
und ein Folge-Turn der Budget-Engine lief unabhaengig vom Cap durch.

**Der Fix.** Vor **jeder** Schleifenrunde fragt `agentTurn` eine Stelle
(`roundStopReason`): die GELD-Achsen ab der ersten Runde (`blockingBudgetAxis` in
`src/budget-gate.js` — dieselbe Schnittmenge Tenant-Cap/Plattform-Notaus und dieselben
Grund-Token `budget_tenant`/`budget_global`, die der Shim schon loggte), die ZEIT-Frist
(`turnLoopDeadlineMs`, abgeleitet aus Provider-Hardcut minus Synthese minus Netzreserve —
**kein** eigener Env-Knopf) erst ab der zweiten. Die Pruefung ist **nicht injizierbar**:
sie laeuft gegen den Modul-Store und die Modul-Config; kein Aufrufer kann sie per No-op
abschalten. Injizierbar ist allein die REAKTION: der Shim beendet den Call ueber
Call-Control (`killCallForBudget`, derselbe Notaus wie das Gate vor dem Turn), die
Budget-Engine rendert `budgetExhaustedHangup` + `<Hangup>` (`budgetHangupOutcome` in
`src/routes/voice.js`). Der Zeit-Abbruch legt bewusst **nicht** auf — der Turn hat eine
gueltige Antwort. Ein zweiter Boot-Waechter (`warnTurnOutlivesDeadAir`, WARN) meldet
Konfigurationen, in denen ein ganzer Turn den Dead-Air-Watchdog des Assistant-Pfads
reissen kann; mit ausgelieferten Werten schweigt er.

**Benannte Folge (bewusst akzeptiert).** `budgetExceeded` sperrt fail-closed auch bei
KORRUPTEM Usage-Bucket (D7, Grund `usage_korrupt` in `src/store/state-ops.js`). Diese
Sperre beendet damit jetzt auch einen laufenden **Budget-Engine**-Call — bisher galt das
nur fuer den Shim und die Inbound-Annahme. Bei NaN-Verbrauch ist genau das richtig; die
Gruende bleiben im Log unterscheidbar (`usage_korrupt` an der Store-Kante,
`[turn] abbruch grund=budget_tenant` an der Turn-Kante).

**Ausdruecklich NICHT geaendert:** die Schnittmenge global/Tenant, Perioden- vs.
Lebenszeit-Topf, die Buchungskante selbst (`bookTokenUsage`/`trackUsage` — der KI-Kosten-
Akku wird weiterhin NICHT pro Inkrement gerundet), das Gate in `/voice/incoming`, sowie
Denylist/Land-Gate/Stundenlimit/Max-Gespraechsdauer/Provider-Signaturpruefung.

---

## SECRETS-HYGIENE — Inventar, Rotation, Provider-Minimalrechte (begleitend, kein Einmal-Gate)

> Hierher gezogen aus `docs/RUNBOOK-OPERATOR.md` Gate 7 (2026-07-28), als das Operator-Runbook
> als veraltete Ableitung von `STATUS.md` entfernt wurde. Der Inhalt hier ist das Unikat: er
> stand nirgends sonst. Die uebrigen Runbook-Abschnitte (Gates 1-6, Anhaenge) waren Duplikate
> oder ueberholt.

**Grundregeln (Absolute Regel 4):** Secrets NUR ueber Render-Dashboard / lokale `.env` — nie
committen, nie loggen, nie in API-/MCP-Antworten oder MCP-Tool-Ausgaben leaken. Selbst-erzeugte
Secrets mit `openssl rand -hex 32` (gilt fuer `MCP_AUTH_TOKEN`, `SESSION_SECRET`,
`DASHBOARD_PASSWORD`).

### Secrets-Inventar (was leakt was)

| Secret (Env)         | Anbieter / Quelle               | Gewaehrt bei Leak                                              | Blast-Radius                                     |
| -------------------- | ------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `ANTHROPIC_API_KEY`  | console.anthropic.com           | LLM-Calls auf deine Kosten                                     | Kosten (kein Daten-Leak)                         |
| `TELNYX_API_KEY`     | Telnyx Portal                   | Voice/SMS-API (Telnyx)                                         | Calls/SMS auf deine Kosten                       |
| `TELNYX_PUBLIC_KEY`  | Telnyx Portal                   | **KEIN Secret** (Ed25519-Verify), aber falsch = Inbound bricht | Verfuegbarkeit (kein Leak)                       |
| `OPENAI_API_KEY`     | platform.openai.com             | Realtime-API (nur `VOICE_ENGINE=realtime`)                     | Kosten                                           |
| `STRIPE_SECRET_KEY`  | Stripe Dashboard                | Hold/Capture, Charges (**echtes Geld** bei `sk_live`)          | Geld + Kundendaten                               |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard | Faelschung von Webhook-Events (Fake-Subscription-Aktivierung) | Unautorisierte Plan-Aktivierung/Provisioning |
| `MCP_AUTH_TOKEN`     | selbst (`openssl rand -hex 32`) | `/mcp`-Zugang (Legacy-Bearer); bei `MCP_AUTH=oauth` ungenutzt  | Voller MCP-Tool-Zugriff                          |
| `SESSION_SECRET`     | selbst (`openssl rand -hex 32`) | Faelschung von Browser-Session-Cookies                         | Account-Uebernahme im Portal                     |
| `OIDC_CLIENT_SECRET` | WorkOS AuthKit                  | OIDC-Auth-Code-Tausch (Browser-Login)                          | Login-Flow-Kompromittierung                      |
| `DASHBOARD_PASSWORD` | selbst gesetzt                  | Owner-Dashboard (Basic-Auth)                                   | Voller Owner-Dashboard-Zugriff                   |
| `DATABASE_URL`       | Render Postgres                 | DB-Passwort (in der URL)                                       | Voller DB-Zugriff (alle Tenants)                 |

> Stand 2026-07-03: `STRIPE_WEBHOOK_SECRET` existiert seit W4 (fail-closed, HMAC-verifizierter
> Inbound-Webhook `src/billing/webhook.js`, Route `/webhooks/stripe`). Einen separaten
> WorkOS-API-Key gibt es weiterhin **nicht** (nur OIDC-Client + AuthKit-Issuer). Bei Aenderung
> der Billing-/IdP-Integration neu pruefen.

### Token-Rotation — Standard-Prozedur (Ueberlappung = Zero-Downtime)

Generisches 5-Schritt-Muster fuer jedes Secret oben:

1. **Neuen Wert erzeugen** beim Anbieter — der **alte bleibt zunaechst gueltig** (Ueberlappung).
2. **Render-Dashboard → Service → Environment** → Wert ersetzen → speichern (loest Re-Deploy aus).
3. **Verifizieren:** `/healthz` gruen, `[boot]`-Banner = erwarteter Commit, betroffene Route
   testen (z.B. Test-Call fuer Telnyx, Login fuer OIDC).
4. **Alten Wert widerrufen/loeschen** beim Anbieter — erst NACH bestaetigter Verifikation.
5. **Rotation protokollieren** (Datum + welches Secret + Anlass) im privaten Rotation-Log
   (nie ins Repo). Anlass = Quartals-Routine **oder** Verdacht/Personalwechsel.

**Empfohlene Kadenz:** vierteljaehrlich routinemaessig; **sofort** bei Verdacht auf Leak,
ausgeschiedenem Teammitglied oder kompromittiertem Geraet.

### Rotation — Besonderheiten pro Secret

| Secret                                 | Rotations-Besonderheit                                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`                    | Im Stripe-Dashboard **"Roll key"** mit Ablauf-Frist (alter Key laeuft kontrolliert aus) statt Sofort-Widerruf. Test- (`sk_test`) und Live-Key (`sk_live`) **getrennt** rotieren.                                                                                              |
| `SESSION_SECRET`                       | Rotation **invalidiert alle aktiven Browser-Sessions** (User muessen neu einloggen). Geplant ausserhalb der Stosszeit, ggf. ankuendigen. Kein Ueberlappungs-Mechanismus.                                                                                                      |
| `DATABASE_URL`                         | Postgres-Passwort in Render rotieren (Render Postgres → Rotate) → URL in der Env des Web-Service nachziehen. Kurzer Reconnect; Pool baut neu auf.                                                                                                                             |
| `MCP_AUTH_TOKEN`                       | Bei `MCP_AUTH=oauth` **nicht in Benutzung** — dann ganz aus der Env nehmen statt rotieren. Im Legacy-/`token`-Modus: Client (z.B. curl-Skripte) und Env **gleichzeitig** umstellen (keine Ueberlappung moeglich).                                                             |
| `OIDC_CLIENT_SECRET`                   | In WorkOS AuthKit ein neues Client-Secret erzeugen (WorkOS erlaubt Ueberlappung) → Env tauschen → altes in WorkOS loeschen.                                                                                                                                                   |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Zweiten Key erstellen → Env tauschen → ersten widerrufen. Ueberlappung trivial.                                                                                                                                                                                               |

### Telnyx-Scoped-Key auf minimale Rechte

**Ziel:** Hermes laeuft nie mit Master-/Account-weiten Vollrechten — ein geleaktes Token darf nur
den Hermes-Kontext betreffen, nicht den ganzen Provider-Account.

**Telnyx:**

- [ ] **Scoped API Key** (V2, least-privilege) statt Account-weitem Key; nur die fuer Voice/SMS
      noetigen Scopes. Pro Umgebung (Staging/Prod) eigener Key.
- [ ] API-Key/TeXML-App an die **eine** genutzte Connection/Nummerngruppe binden.
- [ ] Outbound-Voice-/Messaging-Profile mit Land-/Ziel-Restriktionen (die Notruf-/Premium-Sperre
      bleibt zusaetzlich app-seitig hardcoded, s. Absolute Regel 1 in `CLAUDE.md`).
- [ ] Spend-/Concurrency-Limits im Telnyx-Portal als zweite Bremse.

**Akzeptanz:** Inventar oben stimmt mit der gesetzten Render-Env ueberein; fuer jedes Secret ist
die Rotations-Besonderheit verstanden; der Telnyx-Scoped-Key ist mit Spend-Limit
aktiv und Master-Credentials nirgends in der Hermes-Env.

## AL-P11 — Ergebnis-Karte statt Prosa (2026-07-29)

> `summarizeCall` persistiert zusaetzlich zur Prosa-Summary ein neues nullable Call-Feld
> `call.result` (outcome/commitments/counterparty_commitments/open_points/next_step/facts,
> normalisiert und laengen-/mengengekappt in `src/call-result.js`). Optional darin: `evidence`
> (hoechstens 2 woertliche Zitate Dritter), gesteuert von EINER neuen Env-Variable
> `EVIDENCE_RETENTION_DAYS` (Default 0 = aus), die zugleich Schalter UND Frist ist - Muster
> `DIAGNOSTIC_RETENTION_DAYS` (P2B-DIAG oben). BEWUSST NICHT `DIAGNOSTIC_RETENTION_DAYS`
> wiederverwendet: zwei Sachverhalte auf einem Label liessen eine zu Debug-Zwecken hochgedrehte
> Diagnose-Frist still auch die Aufbewahrung woertlicher Drittzitate verlaengern. `evidence`
> faellt ueber einen DRITTEN, eigenen Retention-Durchgang (`purgeExpiredResultEvidence`, im
> selben Sweep wie `purgeExpiredDiagnosticTranscripts`), NICHT ueber `RETENTION_DAYS`.
>
> **MCP-Whitelist (E2):** `get_transcript` gibt nur die fuenf handlungsrelevanten Felder nach
> aussen (`outcome`, `commitments`, `counterparty_commitments`, `open_points`, `next_step`).
> `evidence` (woertliche Aeusserungen eines Dritten, der nie eingewilligt hat) und `facts`
> (reine Eingabe fuer das kuenftige serverseitige Beziehungsgedaechtnis, AL-P12) haben KEINEN
> MCP-Konsumenten - ein zweiter Transportweg dafuer waere die Umkehrung der
> Datenminimierungs-Entscheidung aus P2B-DIAG.
>
> **Deploy-Kopplung (Reihenfolge, kein Code-Gate):** In Produktion steht
> `EVIDENCE_RETENTION_DAYS=0`, bis die Datenschutzerklaerung (`apps/web`) woertliche Zitate
> Dritter und ihre Frist nennt.

## AL-P12 — Beziehungsgedaechtnis (2026-07-29)

> Neues Per-Tenant-Setting `allowCallMemory` (Default AUS, Spalte `settings.allow_call_memory`
> NOT NULL DEFAULT FALSE). Ist es an, rendert der Outbound-Systemprompt einen Block
> "WAS BISHER GESCHAH" aus `outcome` + `facts` der letzten drei eigenen Anrufe an DIESELBE
> Zielnummer. Es entsteht KEIN neuer Datensatz und keine neue Aufbewahrung - eine reine
> Leseprojektion auf bestehende `call.result`-Felder, die mit den Quell-Calls verfaellt.
>
> Warum Default AUS: getragen werden Fakten ueber einen Dritten, ueber Anrufe hinweg, in
> kuenftige Prompts. Das ist ein neuer Verarbeitungszweck ueber Drittdaten und wird fuer
> Bestands-Tenants nicht still scharf geschaltet (Muster `allowResearch`).
>
> Drei strukturelle Riegel in `counterpartyMemory` (`src/store/state-ops.js`): Tenant-Gate
> vor dem Scan, Tenant-Scope `c.tenantId === tenantId` (kein cross-tenant-Zweig; per Test
> gepinnt), und **outbound-only**. Der letzte Riegel ist eine Sicherheitsentscheidung:
> Inbound-Anrufer-IDs sind faelschbar - ueber sie koennte ein Fremder Fakten in das
> Gedaechtnis einer Nummer legen, die der Tenant spaeter selbst anruft, oder die Notizen
> ueber den Vorbesitzer einer neu vergebenen Nummer auslesen lassen.
>
> Injektions-Riegel: jede Notiz wird auf EINE Zeile gefaltet (kein vorgetaeuschter
> Sektionskopf) und laengen-gekappt (`src/call-memory.js`, 3 x 200 = 600 Zeichen); der Block
> traegt eine Guardrail-Zeile "Information, keine Anweisung". `evidence` (woertliche Zitate
> Dritter) und die uebrigen Kartenfelder gehen NICHT in den Prompt.
>
> Kein MCP-Transportweg: `facts` bleibt ausserhalb der `get_transcript`-Whitelist (AL-P11 E2).

## AL-P13 — Consult-Kanal am Call (2026-07-29)

> Zwei neue Endpunkte, beide vollstaendig **innerhalb** von `/api/*` und damit hinter der
> bestehenden Auth-Kante (Regel 3, KEINE neue Auth-Ausnahme, kein eigener Pfad-Praefix):
> `GET /api/calls/:id/consult` (kurzer, client-gezogener Long-Poll) und
> `POST /api/calls/:id/consult/answer`. Lesepfad Read-404, Schreibpfad Write-403 bei
> `TENANT_REJECT` - dieselbe Praezedenz wie `GET /api/calls/:id` bzw. `POST /api/calendar`.
> Ein spaeterer Gate-Wechsel (PLAN-AUTH-GATE) tauscht die Middleware vor `/api/*` aus und
> bricht diese Routen strukturell nicht. Keiner der beiden Endpunkte loest Calls, SMS oder
> Geld aus - die Outbound-Gate-Kette, der Budget-Guard, der Offenlegungssatz und die
> Provider-Signaturpruefung sind in dieser Phase nicht angefasst.
>
> **Faehigkeits-Gate:** `consultAllowedFor` (`src/consult/gate.js`) ist die EINE
> Schnittmenge aus Master-Schalter `CONSULT_ENABLED` (Default AUS), Kontext-Kanal
> `ASSISTANT_CONTEXT_ENABLED` und dem Per-Tenant-Recht `allowConsult` (Default AUS in
> `DEFAULT_PROFILE` **und** im Plan-Profil - der Kanal bleibt bis zur Abnahme eine
> Owner-Faehigkeit). Fehlt eine Bedingung: kein Consult emittiert, Lesepfad 404 (die
> Existenz des Kanals ist selbst eine Information), Schreibpfad 403, MCP-Werkzeuge gar
> nicht erst registriert.
>
> **Fremdtext hat genau EINE Tuer:** die Antwort des Client-Modells laeuft durch dieselbe
> `validateAssistantContext`-Kante wie das Briefing und landet ausschliesslich in
> `call.context.key_facts` -> HINTERGRUND-Block. Eine zweite, eigene Laengenpruefung waere
> eine zweite, schwaechere Tuer in den Systemprompt. Verstoss -> 400, Antwort verworfen,
> Rueckfrage bleibt offen. Ein Injektions-Fixture pinnt, dass `disclosureSentence`,
> `call.to`, `call.goal` und `call.mandate` unveraendert bleiben.
>
> **Kein Audio, kein Transkript ueber den Kanal** (Regel 5): der Lesepfad liefert nur
> Ereignis, Kennung und Fragen; das MCP-Werkzeug `await_call_event` komponiert den
> Abschluss ueber die BESTEHENDE `pickTranscript`-Whitelist (keine zweite Ergebnis-Sicht).
>
> **Ressourcen-Riegel ohne Env-Knopf:** `MAX_OPEN_POLLS_PER_CALL=2` /
> `MAX_OPEN_POLLS_PER_TENANT=4` als benannte Konstanten in `src/consult/delivery.js`;
> Freigabe im `finally`, NICHT auf ein Socket-Ereignis hin (in `routes/mcp.js` schliesst
> `res.on("close")` Transport und Server, waehrend ein Handler weiterlaufen kann).
> `releaseOpenPolls()` laeuft im Shutdown VOR `httpServer.close()`, damit ein haltender
> Poll den Drain nicht in den 8-s-Watchdog laufen laesst - sonst fiele der finale
> Store-Flush aus (Datenverlust bei jedem Deploy).
>
> **Datenschutz:** `call.consults` haengt am Call-Record und faellt damit automatisch unter
> Erase/Export/Retention (per Test nachgewiesen, inkl. Cross-Tenant-Gegenprobe). Der
> Antworttext lebt NUR in `context.key_facts` - der Consult-Datensatz traegt lediglich
> einen Zaehler (`answeredFacts`), also kein zweiter Loeschpfad und keine zweite
> Leak-Flaeche. Die Fragen stammen in dieser Phase ausschliesslich aus
> `context.open_questions` (aus dem Auftrag des Nutzers), NIE aus fremder Rede - **diese
> Grenze ist in AL-P14 neu zu bewerten**, sobald Fragen aus dem laufenden Gespraech
> entstehen. Die Audit-Ereignisse `consult_emitted`/`consult_answered` tragen nur Zaehler
> und Kennungen, nie Freitext (Regel 4). Die Kennung selbst ist Client-Eingabe -
> `POST /api/calls/:id/consult/answer` prueft `event_id` deshalb VOR jeder
> Weiterverarbeitung (auch vor dem Audit-Aufruf) gegen das serverseitig erzeugte Format
> `c<seq>` (`isConsultEventId`, `src/store/state-ops.js`) und lehnt Abweichungen mit 400
> ab - sonst waere die Kennung selbst der Freitext-Kanal, den dieser Absatz ausschliesst.
>
> **Persistenz-Nebenwirkung (bewusst, dokumentiert):** `call.context` ist ab dieser Phase
> NICHT mehr nach dem Create unveraenderlich und steht deshalb im
> `ON CONFLICT DO UPDATE SET` von `flushCalls` (`src/store/pg.js`). Ohne diesen Eintrag
> fiele jede beantwortete Rueckfrage im pg-Backend beim naechsten Flush lautlos zurueck -
> ein stiller Datenverlust, der im json-Backend unsichtbar geblieben waere.

---

## AL-P14 — Rueckfrage IM Gespraech (2026-07-31)

> **Neue Exposition, deshalb ein EIGENES Flag.** AL-P13 exportierte nur Fragen aus dem
> AUFTRAG des Nutzers. Ab AL-P14 formuliert der Telefon-Agent eine Frage waehrend eines
> laufenden Gespraechs und schickt sie an den MCP-Host - die Frage entsteht also aus
> FREMDER Rede, und der Angerufene hat dem nie zugestimmt. Genau die in AL-P13 als
> "in AL-P14 neu zu bewerten" markierte Grenze wird hier ueberschritten. Schalter:
> `IN_CALL_CONSULT_ENABLED`, Default AUS, wirksam nur als Schnittmenge mit
> `CONSULT_ENABLED`, `ASSISTANT_CONTEXT_ENABLED` und dem Per-Tenant-Recht `allowConsult`.
> Ist er scharf, sagt es das Boot-Banner bei jedem Start (`inCallConsultBannerLine`) -
> kein Deploy fuehrt ihn unbemerkt weiter.
>
> **Fuenf unabhaengige Riegel** (`consultAvailableFor`, `src/consult/in-call.js`):
>
> 1. **Richtungs-Gate (Sicherheitskern):** nur `direction === "outbound"`. Ein fremder
>    Inbound-Anrufer kann den Agenten damit strukturell nicht dazu bringen, seine
>    Aeusserungen als "Rueckfrage" in den claude.ai-Kontext des Tenants zu exportieren
>    (Second-Order-Injektion). Per Mutationsprobe belegt: entfernt man das Praedikat, wird
>    `AL-P14-2` rot.
> 2. **Poll-Kandidaten-Gate:** das Werkzeug erscheint nur, wenn auf DIESEN Call innerhalb
>    von `CONSULT_POLL_FRESH_MS` gepollt wurde. Der Marker (`call.consultPolledAtMs`) ist
>    EPHEMER (keine pg-Spalte) - nach einem Instanzwechsel gilt fail-closed "kein
>    wartender Client".
> 3. **`execTool` kennt `get_consult` nicht.** Ein dennoch gefeuertes Werkzeug faellt in
>    den `default`-Zweig (`unknownTool`). Der Riegel gilt damit automatisch fuer die
>    Realtime-Bridge, die `execTool` direkt ruft; `toolDefs()` bleibt unveraendert, die
>    Realtime-Engine und `agentToolNames` sehen das Werkzeug nie.
> 4. **Paraphrase-Riegel serverseitig** (`src/consult/question.js`): explizite Zitate
>    (Anfuehrungszeichen-Spannen) werden entfernt, implizite Zitate (>= 6 Woerter woertlich
>    aus einer `caller`-Zeile) fuehren zur Ablehnung, die Frage wird auf 200 Zeichen
>    gekappt. Der Prompt verbietet Zitate zusaetzlich - aber ein Prompt ist keine
>    Durchsetzung.
> 5. **Kontingent + Zeitfenster:** hoechstens EIN In-Call-Consult je Gespraech
>    (`MAX_IN_CALL_CONSULTS_PER_CALL`), und nur, wenn die Wartezeit noch in die laufende
>    Abrechnungsminute passt (`consultFitsBillingMinute`) - eine Rueckfrage reisst damit
>    keine zusaetzliche Carrier-Minute auf. Eine Ablehnung ist deterministisch und
>    verbraucht das Kontingent NICHT.
>
> **Nicht-blockierend, per Konstruktion:** es wird nirgends gewartet. `get_consult` bricht
> den Tool-Loop sofort ab und spricht einen deterministischen, LLM-freien
> Ueberbrueckungssatz. Die Frist (`CONSULT_TIMEOUT_MS = 4000`, benannte Konstante, KEIN
> Env-Knopf - ein zu gross gesetzter Wert waere eine abgeschaltete Sicherung) wird erst
> beim NAECHSTEN Turn ausgewertet. Danach gibt es hoechstens EINEN Halte-Satz, dann
> schaltet der Consult auf `timed_out` und der Agent entscheidet im Rahmen seines
> Mandats. Ein Anruf kann dadurch nicht einfrieren (per Test ueber drei Turns belegt).
>
> **Fremdtext hat weiterhin genau EINE Tuer:** die ANTWORT laeuft unveraendert ueber
> `answerConsult` -> `call.context.key_facts` -> HINTERGRUND-Block. Der Timeout-Hinweis in
> der Message-Kette ist server-eigener, eckig geklammerter Steuertext derselben Klasse wie
> `silentTurn` - keine zweite Tuer, keine Injektionsflaeche.
>
> **Keine Aenderung** an Safety-Gates, Offenlegungssatz, Signaturpruefung, Auth oder
> Routen-Bestand; keine neue Route, keine neue DB-Spalte, keine neue Dependency. Die
> Log-Zeile `[consult] gestellt call=<id> frist_ms=<n>` ist PII-frei (nie die Frage, nie
> eine Nummer).
>
> **Freischaltung erst nach Datenschutzerklaerung:** `IN_CALL_CONSULT_ENABLED=true` darf
> erst gesetzt werden, nachdem die Datenschutzerklaerung in `apps/web` die Weitergabe von
> Inhalten aus dem laufenden Gespraech an den MCP-Host nennt (Abnahme AL-P14-6 in
> `tasks/al-testcall-checklist.md`).

---

## AL-P10b — Nachschlagen IM Gespraech (2026-07-31)

> **Neue Exposition, deshalb ein EIGENES Flag UND ein eigener Abschnitt.** Die
> Vorab-Recherche (AL-P10) laeuft in Anthropics serverseitigem `web_search` INNERHALB des
> bestehenden Modell-Aufrufs - kein eigener HTTP-Client, kein neues Secret, kein zweiter
> Auftragsverarbeiter. **AL-P10b durchbricht genau diese Randbedingung**: der In-Call-
> Adapter (`src/research/adapters/exa-search.js`) fuehrt die Suche SELBST aus, mit einem
> NEUEN Secret (`EXA_API_KEY`) bei einem ZWEITEN Auftragsverarbeiter (Exa).
> **AL-P10c (2026-08-01):** Anbieter-Tausch Brave -> Exa. Brave war NIE live (nie ein Key
> gesetzt, kein einziger Aufruf gegen die echte API); der Adapter wurde ersatzlos entfernt.
> Alle vier Riegel gelten unveraendert weiter.
> Schalter: `LOOKUP_ENABLED`, Default AUS.
>
> **Vier unabhaengige Riegel** (`lookupProviderFor`, `src/research/in-call.js`):
>
> 1. **Richtungs-Gate (Sicherheitskern):** nur `direction === "outbound"` und nur ein
>    aktiver Call. Eine im Gespraech mit einem FREMDEN Inbound-Anrufer entstandene Frage
>    kann damit strukturell nicht an einen Suchindex gehen. Zusaetzlich Schnittmenge mit
>    `ASSISTANT_CONTEXT_ENABLED` (ohne HINTERGRUND-Kanal gaebe es keinen Empfaenger fuer
>    den Treffer), dem Per-Tenant-Recht `allowLookup` (Default AUS in `DEFAULT_PROFILE`
>    UND `PAID_PLAN_PROFILE`, nur `OWNER_PROFILE` traegt `true`), einem gesetzten
>    Secret (leer = fail-closed inaktiv, auch bei `LOOKUP_ENABLED=true`) und der
>    **Budget-Engine**: unter `VOICE_ENGINE=realtime` ist das Werkzeug strukturell
>    inaktiv (AL-P10b-fix, s. Riegel 4).
> 2. **Kontingent:** hoechstens `LOOKUP_MAX_PER_CALL = 2` Suchen je Gespraech (benannte
>    Konstante, KEIN Env-Knopf - ein zu gross gesetzter Wert waere eine abgeschaltete
>    Sicherung). Der Zaehler ist EPHEMER (keine DB-Spalte, Muster `countNoSpeechTurn`):
>    ein Instanzwechsel MITTEN im Anruf setzt ihn zurueck und kostet hoechstens 2 weitere
>    Suchen a `LOOKUP_SEARCH_FEE_CENTS` in genau diesem Call - benannt und akzeptiert; der
>    harte Deckel bleibt die pro-Tenant-Kostendecke, die vor JEDER Schleifenrunde greift.
>    Die Gebuehr wird VOR dem Absenden gebucht (eine ausgeloeste Suche ist bezahlt, auch
>    wenn die Antwort nie ankommt - Regel 1).
> 3. **Egress-Riegel serverseitig** (`src/research/lookup-guard.js`): verworfen werden
>    Ziffernfolgen ab 5 Stellen (Rufnummer/IBAN/Karte/Kundennummer), E-Mail-Adressen, die
>    Rufnummer des Angerufenen und woertliche Uebernahmen (>= 6 Woerter) aus `caller`-
>    Zeilen des Transkripts; Zitatspannen werden entfernt, der Rest auf 120 Zeichen
>    gekappt. Eine verworfene Suche verlaesst den Server NICHT, kostet nichts und
>    verbraucht das Kontingent nicht. KEIN Namens-Filter: `call.callerName` ist seit G1
>    (Identitaets-Bindung) hart `null` - kein Producer im Repo befuellt es, ein Filter
>    darauf waere toter Code mit einer falschen Schutzbehauptung.
> 4. **`execTool` kennt `look_up` nicht.** Ein dennoch gefeuertes Werkzeug faellt in den
>    `default`-Zweig (`unknownTool`). Der Riegel gilt damit automatisch fuer die
>    Realtime-Bridge, die `execTool` direkt ruft; `toolDefs()` bleibt unveraendert, die
>    Realtime-Engine und `agentToolNames` sehen das Werkzeug nie.
>    **AL-P10b-fix:** weil die Realtime-Bridge sich den `systemPrompt` mit der
>    Budget-Engine teilt, versprach die GRENZEN-Zeile dort bis dahin eine Faehigkeit
>    ohne Werkzeug (gemessen: Prompt "kann nachschlagen" = true, angebotene Werkzeuge =
>    `end_call,take_message`). Der Engine-Faktor in `lookupProviderFor` schliesst das an
>    der EINEN Quelle: Prompt-Zeile und Werkzeugsatz koennen nicht auseinanderlaufen.
>    Gepinnt in `test/al-p10b-lookup.test.js` (AL-P10b-15), inklusive Praemisse
>    "`realtimeTools` traegt kein `look_up`".
>
> **EHRLICHE GRENZE (E8), bewusst so und nicht geschoent:** dieser Filter ist **schwaecher
> als die pre-call-Konstruktion** von AL-P10. Dort ist der Egress ueber eine gefrorene
> Feld-Whitelist (`RESEARCH_EGRESS_FIELDS`) begrenzt - hier formuliert ein Modell die
> Query frei, und der Server prueft sie nur gegen deterministisch pruefbare Muster. Ein
> Schlagwortfilter fuer "Gesundheits-/Finanzdetails/Personenbezug (Name)" wird BEWUSST
> NICHT gebaut: er waere sprachabhaengig, luecken- und fehlalarm-behaftet und wuerde ein
> Schutzversprechen vortaeuschen, das er nicht halten kann. Diese Restflaeche traegt die
> Tool-Description (`t.lookUpQueryParam`: "ohne Personenbezug", enges Verbot am
> Entscheidungspunkt) - Prompt, also KEINE Durchsetzung. Wer das Flag scharf schaltet,
> akzeptiert genau diese Restflaeche.
>
> **Fremdtext hat genau EINE Tuer:** der Treffer geht ausschliesslich ueber
> `addLookupFacts` -> `call.context.key_facts` -> HINTERGRUND-Block MIT Guardrail-Zeile.
> Das `tool_result` selbst ist server-eigener Konstanttext. Mandat, Offenlegungssatz,
> Wahlziel und die Safety-Gates sind von dort strukturell unerreichbar (per Injektions-
> Fixture in `test/al-p10b-lookup.test.js` belegt).
>
> **Keine Aenderung** an Safety-Gates, Offenlegungssatz, Signaturpruefung, Auth oder
> Routen-Bestand; keine neue Route, keine neue DB-Spalte, keine neue Dependency. Die
> Log-Zeilen `[lookup] verworfen grund=egress call=<id>` und `[lookup] fertig call=<id>
> ok=<b> dauer_ms=<n> fakten=<n>` sind PII-frei (nie die Query, nie der Treffer, nie eine
> Nummer, nie der Key).
>
> **Freischaltung erst nach Datenschutzerklaerung:** `LOOKUP_ENABLED=true` darf erst
> gesetzt werden, nachdem die Datenschutzerklaerung in `apps/web` den ZWEITEN
> Auftragsverarbeiter nennt (Abnahme in `tasks/al-testcall-checklist.md`).

---

## KS-P9 — Plattform-Achse verliert die Sperrwirkung (2026-07-30, E10)

> **Was entfaellt.** Die Plattform-Geldachse trifft ab dieser Phase KEINE
> Sperrentscheidung mehr. Ersatzlos geloescht: `globalBudgetExceeded`,
> `globalReserveExceedsBudget`, `globalSpendOrDeny` (`src/store/state-ops.js`) samt ihrer
> Fassaden-Wrapper (`store.js`/`store/json.js`/`store/pg.js`), die zweite Bedingung in
> `tryReserveOutboundBudget`, der Plattform-Zweig des `budget`-Gates und der
> Plattform-Fallback in `reserveOutcome` (`src/telephony/outbound-gates.js`), der
> Plattform-Zweig der Inbound-Annahme (`src/routes/voice.js`), `BUDGET_AXIS.GLOBAL`
> (`src/budget-gate.js`), der Ablehnungsgrund `budget_platform` und der Text `platformHalt`
> (de/en/fr). Boot-seitig entfallen `spendCapCoherence`-Klausel A (`tenant_default_inert`,
> FATAL), der INERT-Zweig von `planCapInertFindings` (`plan_cap_inert`, FATAL) und
> `tenantCapRowInertFindings` (`tenant_cap_row_inert`, WARN) komplett. **Kein Guard wurde
> von FATAL auf WARN abgesenkt** — wo die Aussage falsch wurde, wurde sie geloescht.
>
> **Warum das kein Schutzverlust ist (Gegen-Gates).** Ein Kostenweglauf braucht Outbound.
> Outbound setzt in derselben Gate-Kette ein aktives Abo UND KYC voraus (fail-closed) — ein
> unverkaufter Tenant erzeugt keine Carrier-Kosten. DID-Vermehrung deckeln `MAX_NUMBERS`
> (plattformweit) und `MAX_NUMBERS_PER_TENANT`. Der bewusste Notaus bleibt
> `OUTBOUND_FROZEN` (erstes Glied der Kette). Denylist, Land-Gate, Stundenlimit pro Tenant,
> Per-Target-Cap, Max-Gespraechsdauer und die Provider-Signaturpruefung sind unberuehrt.
>
> **Was bleibt (in voller Schaerfe).** Die pro-Tenant-Kostendecke: `budgetExceeded`,
> `reserveExceedsBudget`, `effectiveCapCents` (inkl. Stufe (3) `globalCapCents` — das ist
> der PRO-TENANT-Fallback bei Sentinel `DEFAULT_TENANT_BUDGET_CENTS=0`, keine
> Plattform-Summe; ihn zu entfernen waere fail-open), `tenantSpendOrDeny`/`spendOrDeny`,
> der `isBookableCents`-Riegel (D7, fail-closed bei korruptem Verbrauchszaehler),
> `tryReserveOutboundBudget` als atomare Check+Reserve unter `withStoreLock`. Boot-seitig
> bleiben `spendCapCoherence`-Klausel A0 (WARN) und Klausel B (FATAL, Worst-Case-Reserve
> gegen die TENANT-Decke — sie haengt an keiner Plattform-Zahl) sowie
> `planCapUnderivableFindings` (FATAL) und `alertChannelFindings`.
>
> **Plan-Decken-Klemme entfaellt mit.** `deriveTenantBudgetFromPlan` klemmte die aus dem
> Plan abgeleitete Decke auf `platformSpendCapCents`. Diese Klemme war die dritte Klausel
> derselben Praemisse ("der Plattform-Cap bindet zuerst") und bei kohaerenter Konfiguration
> unerreichbar, weil `plan_cap_inert` am Boot fatal war. Bliebe sie stehen, machte
> ausgerechnet KS-P9 aus einem schlafenden Pfad einen scharfen: sobald der Betreiber
> `MAX_BUDGET_EUR` als Warnschwelle NIEDRIG setzt (was diese Phase erst ermoeglicht),
> kuerzte der naechste Stripe-Webhook eine verkaufte Business-Decke von 900 ct auf den
> Warnwert — still, mit einer WARN-Zeile, ohne Boot-Guard. Sie ist deshalb in DIESER Phase
> mit entfallen.
>
> **Die Plattform-Achse bleibt als BEOBACHTUNG.** `gatePlatformUsageCents`,
> `platformSpendMonthCents`, `globalUsageTotals`, `reservationsTotal`,
> `platformSpendObservedCents`, `claimPlatformSpendWarning` und die Emission
> (`emitPlatformSpendWarning`, Audit + optionale SMS) sind unveraendert. `MAX_BUDGET_EUR`
> ist ab jetzt ausschliesslich die Bezugsgroesse von `PLATFORM_SPEND_WARN_PERCENT` (und der
> Pro-Tenant-Fallback bei Sentinel 0). **Betriebs-Vorbehalt:** ohne gesetztes
> `PLATFORM_ALERT_SMS_TO` laeuft die Warnung NUR ins Audit-Log — `alertChannelFindings`
> bleibt deshalb scharf (FATAL bei `PAYMENT_ENABLED=true` + `PLATFORM_SPEND_WARN_PERCENT>0`
> + leerem Empfaenger).
>
> **Bewusst getragenes Restrisiko.** Fuer Starter-Kunden bleibt die zu enge Plan-Decke
> (300 ct) bestehen. KS-P9 verschaerft sie nicht, hebt sie aber auch nicht auf — sie ist
> Gegenstand von KS-P5a.

---

## KS-P8 — Kostenbetraege verlassen die Tenant-Projektion (2026-07-30, E4)

> **Was entfaellt.** `GET /api/state` (und darueber `get_agent_status` sowie das
> gleichnamige MCP-Widget) traegt ab dieser Phase KEINEN Kostenbetrag mehr. Ersatzlos
> geloescht aus `usage`: `costEur`, `tenantCapEur`, `spendMonthCostEur`, `spendMonthKey`,
> `reservedEur` (kein Schluessel-behalten-Bedeutung-wechseln - dieselbe harte Migration
> wie `maxBudgetEur` in P5A-ACHSENTRENNUNG). `/api/state` ruft `tenantBudgetSnapshot`/
> `reservationOf` seither NICHT mehr auf.
>
> **Was an die Stelle tritt.** EIN Wert: `usage.planUsagePercent`, der Anteil der
> verbrauchten Plan-Minuten in ganzen Prozent (`planUsagePercent`,
> `src/billing/meter.js`), abgeleitet aus DEMSELBEN Minuten-Kontingent (`quotaView`) und
> DEMSELBEN Erschoepfungs-Praedikat (`planMinutesExceeded`) wie das Outbound-Gate -
> Anzeige == Gate bleibt gewahrt. Fail-closed: kein Kontingent hinterlegt -> `null`
> ("kein Kontingent hinterlegt"), NIE `0 %` (ein Prozentwert ohne Bezugsgroesse
> behauptet ein Kontingent, das es nicht gibt). `floor` statt `round`: `100 %` bedeutet
> IMMER "erschoepft", nie "das Gate blockt gleich, zeigt aber noch Luft".
>
> **Warum das die Angriffs-/Informationsflaeche verkleinert, nicht vergroessert.** Die
> Tenant-Projektion legte bislang die eigene Kostenstruktur je Tenant offen (Cent-genauer
> Verbrauch, eigene Decke, Reserve). Ein Prozentwert relativ zum GEKAUFTEN Minuten-
> Kontingent traegt diese Information nicht mehr. Kein Gate wurde beruehrt: alle
> Sperrentscheidungen (`budgetExceeded`, `reserveExceedsBudget`, `planMinutesExceeded`,
> Abo+KYC-Permit, `OUTBOUND_FROZEN`, Denylist, Land-Gate, Stundenlimit,
> `MAX_CALL_DURATION_S`, Signaturpruefung) bleiben unveraendert und lesen weiterhin
> dieselben Werte wie vor dieser Phase.
>
> **Wo die Geld-Achse sichtbar bleibt.** In den 402-Ablehnungstexten
> (`tenantBudgetSnapshot` -> `outbound-gates.js`, KS-P4) und in der Betreiber-Sicht
> `GET /api/billing/platform-costs` (plattformweit, kein Tenant, hinter der bestehenden
> `/api/*`-Basic-Auth) - beide unveraendert.
>
> **Getragene Nebenwirkung.** `/api/state` hat keine Rollen-Weiche (Owner vs. Tenant); die
> Owner-Sicht verliert die EUR-Zahlen in `/api/state` mit. Eine neue Rollen-Mechanik waere
> neue Auth-Flaeche und damit ausserhalb dieser Phase - der Betreiber-Ersatzpfad ist die
> Plattform-Route oben plus DB/Logs.

---

## KS-P5a — Plan-Decke und Buchung teilen sich einen Satz (2026-07-30, E5/E5a)

> **Was sich aendert.** `planCapCents` (`src/billing/plan-caps.js`) rechnet ab dieser Phase
> mit `cfg.voiceTariffDefaultCents` — demselben Satz, mit dem der Verbrauch gebucht wird
> (`tariffCentsPerMin`, Worst-Case-Zweig). Der zweite Deckel-Basissatz
> `voiceCapRateCentsPerMin` / `VOICE_CAP_RATE_CENTS_PER_MIN` entfaellt **ersatzlos**:
> config-Eintrag, `CONFIG_NAMESPACES.billing`, `.env.example` und `render.yaml`. Kein
> Alias, keine Bruecke, kein Deprecation-Schalter. Grund: zwei Zahlen fuer dieselbe Sache
> sind auseinandergelaufen — der Starter-Kunde konnte statt seiner verkauften 30 Minuten
> nur rund 10 telefonieren, danach sperrte die eigene Decke.
>
> **Zahlen (Herleitung).** Kopffreiheit unveraendert Starter 5/3, Business 5/4. Damit gilt
> fuer jeden ganzzahligen Satz T: Starter `30·T·5/3 = 50T`, Business `120·T·5/4 = 150T` —
> immer ganzzahlig, nie aus einer Rundung. Bei T=30 (live): **1500 / 4500 ct**; bei T=300
> (Stand vor KS-P6): **15000 / 45000 ct**. Die tragende Invariante ist
> `M·T + 5·T ≤ M·T·num/den` (der letzte Anruf mit seiner Worst-Case-Reserve
> `T · ceil(MAX_CALL_DURATION_CAP_S/60) = 5T` muss noch hineinpassen); sie fordert
> `M ≥ 7,5` (Starter) bzw. `M ≥ 20` (Business) und haelt bei jedem T > 0. Der Katalog liegt
> mit 30 bzw. 120 verkauften Minuten darueber.
>
> **Absolute Regel 1 unberuehrt.** Die Tenant-Kostendecke wird **angehoben, nicht
> abgeschafft**: `budgetExceeded`, `reserveExceedsBudget`, `effectiveCapCents`,
> `tryReserveOutboundBudget` und der `isBookableCents`-Riegel (D7) sind byte-identisch.
> Ebenso unberuehrt: Abo+KYC als Outbound-Permit, `OUTBOUND_FROZEN`, Denylist, Land-Gate,
> Stundenlimit, Per-Target-Cap, Max-Gespraechsdauer, Provider-Signaturpruefung. **Kein
> Boot-Guard wurde abgesenkt** (kein `fatal: true → false`). Nachgemessen: mit den neuen
> Decken feuert keiner — `spendCapCoherence` rechnet ausschliesslich
> `voiceTariffDefaultCents · ceil(300/60)` gegen `defaultTenantBudgetCents` (300·5 = 1500 ≤
> 1500; 30·5 = 150 ≤ 1500), `planCapUnderivableFindings` prueft nur Ableitbarkeit. Der Boot
> ist bei T=300 UND bei T=30 gruen (beide Male lokal gefahren, `/healthz` 200).
>
> **Neuer fail-closed Pfad.** `voiceTariffDefaultCents` ist per `min: 0` abschaltbar (die
> gesamte Spawn-Suite faehrt `VOICE_TARIFF_DEFAULT_CENTS=0`). Ein Satz von 0 ergaebe eine
> 0-Decke — das waere kein strengeres Gate, sondern Telefonie-Totalausfall fuer den Tenant
> (`effectiveCapCents` liefert die Zeile, `budgetExceeded` ist ab dem ersten Cent true).
> `deriveTenantBudgetFromPlan` (`src/store/state-ops.js`) behandelt das an der
> Schreibkante: abgeleitete Decke ≤ 0 → **No-op + laute WARN `grund=tarif_null`**, die
> bestehende Decke bindet weiter. Eigenes Grund-Label, getrennt von `grund=slug_unbekannt`.
> Ein 0-Cap-Tenant kann strukturell nicht mehr entstehen (gleiche Entscheidung wie
> `seedTenantDefaultBudget`).
>
> **Bewusst getragenes Restrisiko.** `MAX_BUDGET_EUR` = 30 € liegt unter der Summe der
> verkauften Decken, sobald zwei Starter- oder ein Business-Kunde abschliessen (Decken-
> Lesart bei T=30: Starter 15 €, Business 45 €). Seit KS-P9/E10 sperrt diese Achse nicht
> mehr — die Folge ist also keine Blockade, sondern eine dauerhaft feuernde
> 80-%-Warnschwelle, die damit zu Rauschen wird. Die Zahl anzupassen ist Owner-Entscheidung
> **E9**; die vollstaendige Aufstellung (welcher Satz gebucht wird, welche Decke je Plan
> folgt, welches N ein gegebener Plattform-Wert traegt) steht in
> `tasks/ks-p5a-report.md`.

## KS-P6 — Worst-Case-Minutentarif im Code auf den gemessenen Wert (2026-07-30, E1)

> **Was sich aendert.** Der numEnv-Fallback von `VOICE_TARIFF_DEFAULT_CENTS` faellt von
> 300 auf 30 ct/min, gleichlautend in `src/config.js`, `.env.example` und `render.yaml`.
> Der Live-Dienst faehrt 30 seit dem 2026-07-29 (E1, Boot-Banner `Worst-Case-Tarif
> 30 ct/min`) - die Phase schliesst nur die Luecke zwischen Repo und Betrieb.
>
> **Grundlage.** 21 Outbound-Anrufe mit vollstaendigem Telnyx-Beleg: 8,18 ct je
> ANGEFANGENER Minute (Spanne 3,89-9,23). 300 war nie gemessen; 30 ist rund das 3,7-Fache
> des Ist.
>
> **Richtung der Wirkung (Code-Defaults, ohne gesetzte Env).** Beide Wirkungen sind
> STRENGER oder neutral, keine ist eine Lockerung eines Gates:
> - Vorab-Reserve je Anruf: `tariffCentsPerMin * ceil(maxDur/60)` faellt von 1500 auf
>   150 ct - weniger Vor-Dial-402 bei unveraendert scharfem Gate.
> - Plan-Kostendecke (seit KS-P5a derselbe Satz): Starter 15000 -> 1500 ct,
>   Business 45000 -> 4500 ct. Die Decke wird ENGER, der Kunde bekommt weiterhin genau
>   seine verkauften Minuten (`test/ks-p5a-plan-cap-carries-sold-minutes.test.js` pinnt
>   das satzunabhaengig).
>
> **Boot-Guards nachgerechnet, keiner abgesenkt.** `spendCapCoherence` Klausel B:
> 30 * ceil(300/60) = 150 <= `DEFAULT_TENANT_BUDGET_CENTS` 1500 - kein Befund.
> `planCapUnderivableFindings` prueft nur Ableitbarkeit. `voiceTariffFloorFindings` liest
> ausschliesslich `VOICE_TARIFF_DOMESTIC_CENTS` und ist unberuehrt. Kein
> `fatal: true -> false`.
>
> **Unberuehrt:** `disclosureSentence`, Provider-Signaturpruefung, Auth, Abo+KYC als
> Outbound-Permit, `OUTBOUND_FROZEN`, Denylist, Land-Gate, Stundenlimit, Per-Target-Cap,
> `MAX_CALL_DURATION_S`/`MAX_CALL_DURATION_CAP_S`, `DEFAULT_TENANT_BUDGET_CENTS` (Wert
> bleibt 1500), `MAX_BUDGET_EUR`, `VOICE_TARIFF_DOMESTIC_CENTS`. Keine neue Dependency,
> kein neuer Env-Schluessel.
>
> **Bewusst getragenes Restrisiko.** Fuer `VOICE_TARIFF_DEFAULT_CENTS` existiert nach wie
> vor KEINE Untergrenze im Code (`min: 0`; `spendCapCoherence` prueft nur nach oben). Ein
> versehentlich zu niedrig gesetzter Satz unterreserviert still und verkuerzt zugleich die
> Plan-Decke. Eine Untergrenze analog `voiceTariffFloorFindings` ist eine eigene Aufgabe
> (so schon in KS-P0 festgehalten) und NICHT Teil dieser Phase.

## KS-P2 — Live-Verbrauch der Carrier-Achse in der Mid-Call-Pruefung (2026-07-30)

> **Was sich aendert.** `blockingBudgetAxis` (`src/budget-gate.js`) fragt nicht mehr
> `store.budgetExceeded`, sondern `store.liveBudgetExceeded`, und reicht dabei einen
> LIVE-TERM mit: die Summe der angefangenen Minuten ALLER noch laufenden Outbound-Legs des
> Tenants mal deren Leg-Tarif (`liveVoiceSpendCents`, `src/billing/metering.js` - dieselbe
> ceil-Rundungsregel wie `voiceMinutesOf`). Bis hierher war genau die teure Achse mid-call
> blind: die KI-Token-Achse bucht in JEDER Schleifenrunde, die Carrier-Minuten erst bei
> Call-Ende (`reconcileOutboundVoiceBudget`).
>
> **Richtung der Wirkung: STRENGER, nie lockerer.** Derselbe Cap, nur frueher bindend. Ohne
> laufenden Zusatzverbrauch (Dial-Gate, Inbound-Reject) ist der Term 0 und der Ausdruck
> bleibt byte-identisch `spent >= cap`: `budgetExceeded` ist seither ueber
> `liveBudgetExceeded(s, tenantId, 0, ...)` ausgedrueckt - EINE Entscheidungsstelle statt
> zweier Kopien (G5).
>
> **Fail-closed (D7-Reichweite waechst, sie schrumpft nicht).** Ein unlesbarer Zeitanker
> liefert NaN statt eines stillen 0; der Term laeuft durch denselben `isBookableCents`-Riegel
> wie jeder gebuchte Geldwert, mit EIGENEM Feldnamen im Log:
> `[budget] grund=usage_korrupt kante=tenant:<id> feld=liveCents wert=NaN`. Ohne den Riegel
> waere das Gate still AUS ("gebucht + NaN >= cap" ist immer false). Ein Uhr-Ruecksprung
> clampt auf 0 - der Live-Term darf den Verbrauch nie UNTER den gebuchten Wert druecken.
>
> **Inbound traegt strukturell nichts bei.** `activeOutboundCallsFor` (`state-ops.js`)
> filtert auf `direction === "outbound"` - spiegelbildlich zu
> `reconcileOutboundVoiceBudget`. Was nie gebucht wird, darf auch live nicht zaehlen, sonst
> loeste ein Phantom-Verbrauch, der bei Call-Ende spurlos verschwindet, mittendrin ein
> KOSTENLOSES Inbound-Gespraech auf. Ebenso strukturell: nur `status === "active"` (ein
> beendeter Leg ist bereits gebucht - keine Doppelzaehlung) und nur der eigene Tenant.
>
> **Die Reserve zaehlt bewusst NICHT mit.** Sie ist bereits fuer genau diesen Call gebucht;
> "gebucht + Reserve + eigene Zeit" haette den Call nach der ersten Minute gegen sich selbst
> aufgelegt. `reserveExceedsBudget` (Vorab-Exposition eines NOCH NICHT begonnenen Calls)
> bleibt davon unberuehrt.
>
> **Unberuehrt:** das Dial-Gate (`budgetExceeded` + `reserveExceedsBudget` in
> `outbound-gates.js`), der Inbound-Reject in `routes/voice.js`, `tenantBudgetSnapshot`,
> `tryReserveOutboundBudget`, `disclosureSentence`, Provider-Signaturpruefung, Auth, Abo+KYC
> als Outbound-Permit, `OUTBOUND_FROZEN`, Denylist, Land-Gate, Stundenlimit, Per-Target-Cap,
> `MAX_CALL_DURATION_S`/`MAX_CALL_DURATION_CAP_S`, alle Env-Werte und Plan-Decken. Keine neue
> Dependency, kein neuer Env-Schluessel, keine `.env.example`-/`render.yaml`-/`config.js`-
> Aenderung. Kein Aufrufer von `blockingBudgetAxis` wurde angefasst (`claude.js`,
> `telnyx-llm-shim.js`): der Live-Term ist eine TENANT-Groesse und wird vollstaendig
> innerhalb der Gate-Kette aus dem Store gezogen - es gibt kein vom Aufrufer geliefertes
> Datum, das jemand vergessen oder auf 0 setzen koennte (G27).
>
> **Drei bewusst getragene Restrisiken.**
> 1. **Die Plattform-Achse bleibt mid-call blind.** `globalBudgetExceeded` existiert seit
>    KS-P9/E10 als Sperre nicht mehr; der einzige In-Flight-Schutz der Plattform ist
>    `globalReserveExceedsBudget` am Dial-Gate. KS-P2 aendert daran nichts.
> 2. **Die Vorab-Reservierung ist strukturell ephemer** - nie persistiert, nie hydriert, nach
>    jedem Neustart 0. KS-P2 verlaesst sich fuer die Gleichzeitigkeit deshalb ausdruecklich
>    NICHT auf sie (der Live-Term ist eine Tenant-Summe ueber alle laufenden Legs); die
>    Reserve bleibt unangetastet, ist aber kein Deploy-fester Schutz.
> 3. **pg-Spiegel-Grenze.** `activeOutboundCallsFor` scannt den hydrierten Spiegel (wie
>    `getCall`/`getCallByControlId`). Ein Leg, das eine ANDERE Instanz nach unserem
>    `hydrate()` angelegt hat, fehlt in der Summe - der Term unterzaehlt dann, er
>    ueberzaehlt nie.

## KS-P4 — Ablehnungstexte lesen dieselbe Achse wie das Gate (2026-07-30)

> **Was sich aendert.** `tenantBudgetSnapshot` (`src/store/state-ops.js`) - die einzige
> Quelle der zwei Konsumenten `tenantBudgetDenial`/`tenantReserveDenial`
> (`src/telephony/outbound-gates.js`) - liest den Verbrauch nicht mehr direkt aus
> `usageFor(s, tenantId).costCents` (Lebenszeit), sondern ueber `tenantUsageAxes` dieselbe
> aufgeloeste Gate-Groesse (`gateUsageCents`) wie `budgetExceeded`/`reserveExceedsBudget`.
> Die neue Funktion `tenantUsageAxes` ist die EINE Quelle (G5) fuer beide Verbrauchsgroessen
> der Tenant-Achse; der D7-Riegel selbst ist ueber `usageAxesBookable` als reines
> Praedikat herausgezogen und wird an BEIDEN Kanten (Gate `spendOrDeny`, Anzeige
> `tenantBudgetSnapshot`) angewendet - die Anzeige-Kante loggt dabei bewusst NICHT (kein
> `denyCorruptUsage`), weil `/api/state` sie bei jedem Dashboard-Poll aufruft und ein
> dauerhaft vergifteter Bucket sonst eine Log-Flut erzeugte.
>
> **Klarstellung (KS-P8, 2026-07-30, E4):** `/api/state` ruft `tenantBudgetSnapshot` seit
> KS-P8 NICHT MEHR auf (die Tenant-Projektion traegt keinen Kostenbetrag mehr, s. Abschnitt
> KS-P8). Die Nicht-Log-Entscheidung oben bleibt trotzdem gueltig - die verbleibenden
> Aufrufer sind `outbound-gates.js` (Ablehnungstexte) und `routes/voice.js`
> (Mid-Call-Restdauer), die denselben Bucket ebenfalls im laufenden Betrieb (nicht nur
> per Poll) treffen koennen. Reine Klarstellung, kein Log-Verhalten geaendert.
>
> **Bewiesene Invariante:** `reserveExceedsBudget(...) === (reserveCents -
> tenantBudgetSnapshot(...).remainingCents > 0)`. Vor dieser Phase konnte eine
> Kostenkorrektur (`bookCostCorrectionCents`, senkt NUR `costCents`, nie die Spend-Monat-
> Achse) genau diesen Widerspruch erzeugen: das Gate sperrt (liest die Monatszahl), der
> Ablehnungstext rendert trotzdem einen NEGATIVEN Fehlbetrag (liest die - bereits durch die
> Korrektur gesenkte - Lebenszeitzahl). Regressionsschutz: `test/ks-p4-snapshot-gate-axis.test.js`
> (T1/T2, Mutationsprobe gegen den echten, live gemessenen Zustand 4,23 EUR Lebenszeit /
> 12,84 EUR Spend-Monat) sowie `test/deny-diagnosability.test.js`/T7 (echte Ablehnungstexte
> ueber die Gate-Kette).
>
> **Unberuehrt:** alle Gate-Praedikate (`budgetExceeded`/`reserveExceedsBudget`/
> `tryReserveOutboundBudget` bleiben unveraendert die einzigen Entscheidungsstellen -
> `tenantBudgetSnapshot` bleibt REIN LESEND), `disclosureSentence`, Signaturpruefung, Auth,
> Abo+KYC als Outbound-Permit, `OUTBOUND_FROZEN`, Denylist, Land-Gate, Stundenlimit,
> `MAX_CALL_DURATION_S`, alle Env-Werte und Plan-Decken. Kein neuer Env-Schluessel, keine
> neue Dependency, keine `.env.example`-/`render.yaml`-Aenderung.
>
> **Getragene Kante:** `store.tenantBudgetSnapshot` und `store.reserveExceedsBudget`
> erzeugen an der Store-Fassade (`json.js`/`pg.js`) je ein EIGENES `nowIso`
> (`new Date().toISOString()`) - die nach aussen sichtbare Fassaden-Signatur bleibt laut
> Spec unveraendert (kein durchgereichtes `nowIso`-Argument). Eine Divergenz ist nur
> denkbar, wenn zwischen den zwei Aufrufen eine UTC-Monatsgrenze faellt UND die
> Flag-Aufloesung auf der Spend-Monat-Achse steht (`BUDGET_MONTH_ENABLED=true`, Default
> `false`); der Effekt kann dann in BEIDE Richtungen gehen, EINSCHLIESSLICH eines
> negativen Fehlbetrags im Ablehnungstext (belegt: `outbound-gates.js` ruft erst
> `store.reserveExceedsBudget` mit der ersten Fassaden-Uhr `t1` auf und danach, bei
> Ablehnung, `tenantReserveDenial` -> `store.tenantBudgetSnapshot` mit der zweiten
> Fassaden-Uhr `t2 >= t1`; rollt der Monat zwischen `t1` und `t2`, faellt
> `spentCents` auf 0, `remainingCents` waechst, und `reserveCents - remainingCents`
> wird negativ). Die "strukturell unmoeglich"-Zusage der bewiesenen Invariante oben
> gilt NUR bei identischem `nowIso` auf beiden Seiten - also auf der ops-Ebene, die
> `test/ks-p4-snapshot-gate-axis.test.js` (T1/T2) pinnt - nicht ueber die zwei
> getrennten Fassaden-Uhren. Auswirkung bleibt reiner Anzeigetext (kein Gate kippt,
> `reserveExceedsBudget` lehnt weiterhin korrekt ab), Eintrittsfenster
> Sub-Millisekunde einmal pro Monat und nur bei Flag AN. Ein durchgereichtes `nowIso`
> durch die Fassade wuerde die Divergenz strukturell schliessen, ist aber ausserhalb
> des Umfangs dieser Phase (Signaturaenderung an beiden Store-Backends).

---

## KS-P1b — Assistant-Shim auf dem geteilten Re-Attach-Pfad (2026-07-30)

> **Geschlossene Luecke (KS-P1-Befund).** Der Telnyx-Brain-Shim
> (`src/telnyx-llm-shim.js`) loeste den Call bisher ausschliesslich ueber den
> Prozess-Spiegel auf (`store.getCallByControlId`) und antwortete bei einem Miss mit 403.
> Ein Deploy-/Instanzwechsel liess damit ein LAUFENDES Assistant-Gespraech beim Provider
> weiterlaufen - ohne Max-Dauer-Cap-Timer und ohne Dead-Air-Watchdog (beide prozesslokal),
> also ohne jede Kostenbremse. Der Shim geht jetzt bei einem Spiegel-Miss ueber DENSELBEN
> Re-Attach-Seam wie `/voice/turn|outbound|status` und der Call-Control-Ingest
> (`lifecycle.reattachActiveCallByControlId` -> `telephony/reattach.js`), inklusive
> Restzeit-Klassifikation und Cap-Rearm. Neue Store-Query `attachActiveCallByControlId` in
> BEIDEN Backends (pg: RLS-sauberer Tenant-Loop, KEIN Bypass; json: Spiegel-Query wie
> `attachActiveCall`).
>
> **Zusaetzliche Verschaerfung (E8).** Der Re-Attach prueft neben der Zeit-Achse jetzt auch
> die Geld-Achse: `blockingBudgetAxis` (`src/budget-gate.js`) - dasselbe Praedikat, das der
> Shim-Turn und das Dial-Gate lesen, KEIN neues Gate. Ein Leg, dessen Tenant-Decke zwischen
> Anrufstart und Re-Attach erschoepft wurde, wird terminalisiert statt mit frischer Frist
> reanimiert. Reihenfolge: Zeit zuerst (genauerer Grund), dann Geld.
>
> **Neuer Forensik-Token:** `BUDGET_FAILURE_REASON = "budget-exhausted"` neben
> `CAP_FAILURE_REASON` (GAP-26-Logik: ein an der Decke gestorbener Anruf muss von einem am
> Zeit-Cap gestorbenen unterscheidbar bleiben). Stabil und PII-frei. Der EINE
> Terminalisierungspfad bleibt EINER: `terminateCappedCall` (Zeit) und
> `terminateOverBudgetCall` (Geld) sind zwei intentions-benannte Wrapper ueber
> `terminateActiveCall` - Reihenfolge (Provider-Leg zuerst awaited, dann buchen),
> Idempotenz und INV-9 unveraendert.
>
> **Benannter Verhaltens-Blast-Radius (bewusst getragen).** Ein Leg mit erschoepfter
> Tenant-Decke, das nach einem Instanzwechsel ueber `/voice/turn` re-attached wird, bekommt
> kuenftig einen harten Hangup statt des hoeflichen `budgetExhaustedHangup`. Trifft nur die
> Schnittmenge *Spiegel-Miss x Decke erschoepft* (in der Praxis: Post-Deploy) und immer in
> die sichere Richtung. Kein stummer Pfad: `logShimReattach` (kind `reattached`), Gate-Grund
> `reattach_terminalized` und eine `[budget]`-Warnzeile in `terminateOverBudgetCall`.
>
> **Unberuehrt:** `disclosureSentence`, Provider-Signaturpruefung, Basic-/MCP-Auth, Abo+KYC
> als Outbound-Permit, `OUTBOUND_FROZEN`, Denylist, Land-Gate, Stundenlimit,
> `MAX_CALL_DURATION_S` und die drei 300er-Klemmen (KS-P3), `outbound-gates.js`,
> `metering.js`. Kein neuer Env-Schluessel, keine `.env.example`-/`render.yaml`-Aenderung,
> keine neue Dependency.
>
> **Getragene Kante:** der ccid-Riegel in `pg.js` (`ccid ? ... : null`) ist eine
> Roundtrip-Ersparnis, KEIN eigenes Sicherheitsnetz - `WHERE call_control_id = NULL` trifft
> in SQL ohnehin nie eine Zeile (gemessen: die Mutationsprobe ohne den Riegel bleibt gruen).
> Das Ergebnis ist trotzdem gepinnt (KS-P1b-10), damit eine kuenftige Umformulierung der
> Query auffliegt.
>
> **Regressionsschutz:** `test/ks-p1b-shim-reattach.test.js` (KS-P1b-1..6),
> `test/reattach-active-call.test.js` (KS-P1b-7/8),
> `test/store-pg-reattach-active-call.test.js` (KS-P1b-9/10),
> `test/store-backend-parity.test.js` (Backend-Paritaet erzwungen).

## KS-P3a — Plan-Decken gegen die Worst-Case-Reserve abgesichert (2026-07-30)

> **Was sich aendert.** Neuer FATALer Boot-Guard `planCapReserveFindings`
> (`src/boot-guard.js`, verdrahtet in `assertSpendCapCoherence`): die Worst-Case-Reserve
> EINES Anrufs (`VOICE_TARIFF_DEFAULT_CENTS · ceil(MAX_CALL_DURATION_CAP_S/60)`) wird gegen
> `MIN(planCapCents(slug))` ueber alle `CATALOG_SLUGS` gehalten. Bisher pruefte
> `spendCapCoherence` Klausel B ausschliesslich gegen `DEFAULT_TENANT_BUDGET_CENTS` — die
> Decke eines ZAHLENDEN Tenants kommt aber aus dem Plan (`effectiveCapCents` bevorzugt die
> `tenant_budget`-Zeile), und `planCapUnderivableFindings` prueft nur Ableitbarkeit. Genau
> die Decken der zahlenden Kunden sah der Boot also nie (B7).
>
> **Zahlen.** Seit KS-P5a rechnen Decke und Reserve mit demselben Satz T; er kuerzt sich aus
> der Ungleichung heraus: Starter `50T`, Business `150T`, Reserve `T·ceil(300/60) = 5T`.
> Geprueft wird faktisch `ceil(MAX_CALL_DURATION_CAP_S/60)` gegen `includedMinutes·num/den`.
> Beim heutigen Katalog feuert der Guard ab **MAX_CALL_DURATION_CAP_S > 3000 s**. Boot
> nachgerechnet und gemessen gruen bei T=0 (Testsuite), T=30 (live) und T=300.
>
> **Absolute Regel 1: eine Sicherung kommt HINZU, keine wird entfernt.** Kein
> `fatal: true → false`, kein Guard umgehaengt. `spendCapCoherence` A0/B unveraendert
> (nur die gemeinsame Reserve-Rechnung ist als `worstCaseReserveCents` extrahiert —
> verhaltensgleich), `planCapUnderivableFindings` in Signatur, Rueckgabe und Meldung
> unveraendert. Kein Laufzeitpfad angefasst: `budgetExceeded`, `reserveExceedsBudget`,
> `effectiveCapCents`, `tryReserveOutboundBudget`, `deriveTenantBudgetFromPlan` sind
> byte-identisch. Ebenso unberuehrt: `disclosureSentence`, Signaturpruefung, Auth, Abo+KYC
> als Outbound-Permit, `OUTBOUND_FROZEN`, Denylist, Land-Gate, Stundenlimit,
> Per-Target-Cap, Max-Gespraechsdauer. **Kein neuer Env-Schluessel, keine neue Dependency.**
>
> **Kalibrierung (Teil 2 der Phasen-Spec) ist bereits erledigt** — KS-P5a/E5a hat
> `voiceCapRateCentsPerMin` ersatzlos entfernt; es gibt nur noch EINEN Satz. Diese Phase
> liefert deshalb ausschliesslich den Boot-Guard.
>
> **Bewusst getragenes Restrisiko.** Der Guard prueft die Decke, die aus dem Plan ABGELEITET
> wird, nicht eine per Hand gesetzte `tenant_budget`-Zeile — eine manuell zu niedrig
> geschriebene Decke faengt er nicht. Ausserdem greift er beim Boot, nicht beim Schreiben:
> eine Konfiguration, die erst nach dem Start inkohaerent wuerde, meldet er erst beim
> naechsten Neustart.
>
> **Regressionsschutz:** `test/ks-p3a-plan-cap-reserve-guard.test.js` (Wahrheitstabelle
> (a)–(e)), `test/boot-failclosed.test.js` (Spawn mit dem Live-Satz 30 ct/min).

## KS-P7 — Schutzlast von der Kosten-Achse auf die Denylist verschoben (2026-07-30)

> **Was sich aendert.** `src/telephony/number-denylist.js` fuehrt eine zweite, benannte
> Klasse `HIGH_COST_COUNTRY_PREFIXES` (ganze Laendercodes) neben den bestehenden
> `PREMIUM_PREFIXES` (Sub-Ranges) und ergaenzt 24 Hochpreis-Ziele + `+878` (UPT).
>
> **Warum.** Bis KS-P0/KS-P6 war der Worst-Case-Tarif von 300 ct/min der erklaerte
> Hauptschutz gegen teure Ziele; die Denylist nannte sich im eigenen Kommentar "Beifang,
> NICHT der Hauptschutz". Mit 30 ct/min schaetzt die Kosten-Achse teure Ziele mit UNSEREM
> Satz statt mit dem echten Zielpreis (TOD 1: Kuba). Die Schutzlast liegt damit auf der
> Denylist - der Modulkommentar sagt das jetzt.
>
> **Aufnahmekriterium.** Terminierungspreis ueber dem Worst-Case-Tarif
> (`VOICE_TARIFF_DEFAULT_CENTS`, 30 ct/min). BEWUSST als Kuratierungsregel dokumentiert,
> NICHT zur Laufzeit an den Env-Wert gekoppelt: eine per Env veraenderbare Sperrmenge waere
> ein aufweichbares Gate.
>
> **Absolute Regel 1: das Gate wird erweitert, nie geschwaecht.** Kein Eintrag entfernt,
> keine Bedingung gelockert, kein Env-Schalter, keine Abschaltmoeglichkeit. Die zehn
> karibischen NANP-Vorwahlen wurden verhaltensgleich in Klasse 2 verschoben (Beweis:
> `test/number-gate.test.js` bleibt in allen Bestandsfaellen unveraendert gruen).
> Unberuehrt: Land-Gate, Stundenlimit, Per-Target-Cap, Abo+KYC als Outbound-Permit,
> `OUTBOUND_FROZEN`, Max-Gespraechsdauer, Budget-Gate, Signaturpruefung,
> `disclosureSentence`.
> **Kein neuer Env-Schluessel, keine neue Dependency, kein Laufzeitpfad angefasst.**
>
> **Bewusst getragener Preis.** Klasse 2 sperrt ganze Laender, auch gewoehnliche
> Mobilnummern. Diaspora-Anrufe nach Kuba und Haiti sind damit nicht moeglich. Zweitwirkung:
> ein Tenant in einem betroffenen Land kann keine private Summary-SMS-Nummer setzen
> (`normalizePrivateNumber` teilt dieselbe Liste). Eine per-Tenant-Freischaltung waere eine
> eigene Phase - hier bewusst NICHT gebaut, weil sie das Gate abschaltbar machen wuerde.
>
> **Regressionsschutz:** `test/ks-p7-high-cost-denylist.test.js` (25 handgeschriebene
> Negativziele, 22 Positivziele aus Nachbarlaendern/Startmaerkten, Struktur-Invariante),
> ein Gate-Ende-zu-Ende-Fall in `test/number-gate.test.js`, ein Fall in
> `test/p8-private-number-country-gate.test.js`.

## KS-P3 — Reserve von der Maximaldauer entkoppelt, Zeitgrenze wird guthaben-abgeleitete Notbremse (2026-07-30, E2/E3/E8)

> **Was sich aendert (neue Zeit-/Kosten-Kante, mit Zahlen).**
>
> | Groesse | Vorher | Nachher |
> | --- | --- | --- |
> | Vorab-Reserve je Outbound | `Satz * ceil(maxDur/60)` (bei 30 ct/min und 300 s: 150 ct) | `Satz * RESERVE_LEAD_MINUTES` = `Satz * 2` (bei 30 ct/min: 60 ct) |
> | Zeitgrenze je Leg | fest `MAX_CALL_DURATION_S` (Env, live 180 s), hart geklemmt auf 300 s | `min((Restminuten + 1) * 60, 1800 s)`, aus dem Restguthaben abgeleitet |
> | Absolute Obergrenze | `MAX_CALL_DURATION_CAP_S` = 300 s | `MAX_CALL_DURATION_CAP_S` = 1800 s (hartkodiert, kein Env-Knopf) |
>
> **Absolute Regel 1 bleibt gewahrt.** Die Max-Gespraechsdauer wird NICHT entfernt, sondern
> pro Call SCHAERFER: wer wenig Guthaben hat, bekommt eine kurze Frist; wer viel hat, eine
> lange - immer unter einem harten Deckel. Der Timer-Backstop (`terminateCappedCall`, INV-9),
> der Boot-Re-Arm und der Re-Attach-Pfad sind unangetastet. Denylist, Land-Gate,
> Stundenlimit, Per-Target-Cap, Abo+KYC als Outbound-Permit, `OUTBOUND_FROZEN`, die
> pro-Tenant-Kostendecke, `disclosureSentence` und die Provider-Signaturpruefung sind
> unberuehrt.
>
> **Warum der Puffer (E8, `BRAKE_BUFFER_MINUTES` = 1).** Die Notbremse liegt strukturell
> EINE Minute ueber den bezahlbaren Minuten. Damit bindet im Normalbetrieb IMMER zuerst der
> Live-Verbrauchszaehler (KS-P2) - der Kunde hoert den Abschiedssatz, statt wortlos
> abgeschnitten zu werden. Die Uhr ist die ZWEITE Linie, nicht die erste.
>
> **Fail-Richtung.** Nicht aufloesbares Guthaben (`remainingCents === null`, D7-Riegel) oder
> ein Satz <= 0 ergeben die absolute Obergrenze, NIE "unbegrenzt". Das ist unschaedlich,
> weil derselbe Zustand am Dial ueber `reserveUnreadableDenial` und beim Inbound ueber
> `budgetExceeded` bereits fail-closed sperrt - die Notbremse ist dort nie die letzte Linie.
> Untergrenze ist der Puffer allein (60 s), nie 0: eine 0-Frist terminalisierte den Call
> schon beim Armieren, und "kein Geld" ist die Aufgabe der Geld-Achse, nicht der Uhr.
>
> **Der Body-Override kann nur verkuerzen.** `resolveMaxDurationS(raw, brakeSeconds)` nimmt
> einen Client-Wunsch nur an, wenn er endlich, strikt positiv UND kuerzer als die Notbremse
> ist. Ein Client kann sich keine Zeit erkaufen, die sein Guthaben nicht traegt.
>
> **`MAX_CALL_DURATION_S` ist ersatzlos entfallen (E2/E3).** Ein Operator-Knopf, der jede
> Gespraechsdauer global kuerzt, IST die willkuerliche Produktgrenze, die diese Phase
> beseitigt. Der Key wird nicht mehr gelesen - ein im Render-Dashboard stehengebliebener
> Wert ist ab diesem Deploy wirkungslos (fail-safe: ein ignorierter Key kann nichts tun, ein
> weitergelesener haette den Defekt still konserviert). Ueberall, wo er als Fallback stand,
> steht jetzt die hartkodierte `MAX_CALL_DURATION_CAP_S`.
>
> **Getragene Restrisiken (benannt, nicht behoben).**
> (1) Ein Kunde kann bis zu `Decke / 30 ct` Minuten je Periode telefonieren, auch in teure
> Ziele - die Kosten-Achse rechnet mit UNSEREM Satz, nicht dem echten Zielpreis (TOD 1).
> Das Gegenmittel ist die Sperrliste aus KS-P7, die bewusst VOR dieser Phase steht.
> (2) Calls, die den Deploy ueberleben, haben kein `maxDurationS` und fallen auf die
> absolute Obergrenze (1800 s statt vorher 180 s). Bounded auf die zum Deploy-Zeitpunkt
> aktiven Legs; der Live-Zaehler greift beim naechsten Turn. Eine Migration fuer < 10 Minuten
> Uebergang waere unverhaeltnismaessig.
> (3) `rearmActiveCallTimers` (Boot-Re-Arm) hat - anders als der Re-Attach seit KS-P1b -
> kein Geld-Gate; ein beim Boot re-armter Call behaelt seine alte Frist. Bounded durch
> dieselbe Frist plus den Live-Zaehler am naechsten Turn. Befund einer Nachbarphase, hier
> bewusst nur notiert.
>
> **Kein neuer Env-Schluessel** (einer ist ENTFALLEN), **keine neue Dependency.**

## AUTH-P1 — Routen-Inventar ersetzt die Sammelsicherung (2026-08-01)

Erste Phase von `PLAN-AUTH-GATE.md`. **Aendert kein Laufzeitverhalten** — sie baut den
Meldeweg, den der spaetere Wegfall des Basic-Auth-Gates braucht.

**Das Problem, das hier geloest wird.** Heute ist eine neue Route per Default sicher:
das Basic-Auth-Gate (`src/wiring/auth-gate.js`) sichert alles, was nicht ausdruecklich
ausgenommen ist. Faellt das Gate (P7), kehrt sich die Richtung um — eine neue Route
waere per Default oeffentlich, und zwar **lautlos**: sie antwortet 200, loggt nichts und
verhaelt sich normal, nur eben fuer jeden. Es gaebe kein Signal.

**Der Ersatz ist eine maschinelle Vollstaendigkeitspruefung.**
`test/route-auth-inventory.test.js` laeuft ueber den Express-Routengraph und ordnet jede
Route in genau eine Klasse ein (`src/route-policy.js`):

- **auth** — traegt eine der drei benannten Auth-Middlewares (`webAuthGateMiddleware`,
  `adminOnlyMiddleware`, `mcpAuth`). Heute 12 Routen.
- **public** — bewusst oeffentlich oder handler-intern abgesichert, **mit Begruendung im
  Code**. Heute 19 Routen.
- **gate_only** — haengt heute allein am Basic-Auth-Gate. Heute **21** Routen. Diese
  Liste IST die Arbeitsliste von P4/P5/P6, und sie ist die **harte Vorbedingung fuer
  P7: das Gate darf erst fallen, wenn sie leer ist.** Bewusst NICHT als "public"
  gefuehrt — das haette gruen gemeldet, was in Wahrheit eine offene Tuer ist.
- **unprotected** — nirgends eingeordnet -> `npm test` rot.

**Warum der Test den Produktions-Routengraph baut (Befund B3).** Der gesamte
Web-Login-Block (`/auth/*`, `/api/self-service/*`, `/api/admin/*`,
`/api/portal/state`, `/webhooks/stripe`) haengt in `src/app.js` an
`sessionSecret && storeBackend === "pg"`. Die Spawn-Tests fahren `STORE_BACKEND=json` —
in ihnen existieren diese Routen **gar nicht**. Ein naiv gebauter Inventar-Test waere
blind fuer genau die Middleware, auf der P5/P6 ruhen: gruen und wertlos. Der Test baut
darum den Prod-Graph offline (pg-Schalter + injizierter `createPortalRunner`, ohne
erreichbare Postgres) und beweist ueber eine **Positiv-Assertion**, dass es dieser Graph
ist. Empirisch bestaetigt: mit `json` bleibt die Klassifikations-Assertion **gruen**,
nur die Positiv-Assertion schlaegt an — ohne sie waere der Test wertlos gewesen.

**Rot-vor-Fix nachgewiesen** (beide Faelle gemessen, nicht behauptet):
ein absichtlich eingefuegtes `app.get("/probe-rot-vor-fix", ...)` macht 2 Tests rot;
ein auf `json` gedrehter Graph macht 4 Tests rot.

**Der einzige Code-Eingriff:** `buildApp` nimmt `createPortalRunner` als optionalen
Dep entgegen (Default = der echte Runner). Derselbe DIP-Seam, den `wireWebLogin` intern
schon nutzt, nur eine Ebene hoeher. Der Produktivpfad (`server.js` reicht den Dep nicht)
ist unveraendert.

**Getragene Restrisiken (benannt, nicht behoben).**
(1) Der Test sieht **route-level** Middleware. Nicht sichtbar sind Auth im
Handler-Rumpf (`GET /voice/tts/:token`, `POST /v1/chat/completions`,
`POST /webhooks/stripe`), Praefix-Middleware (`/voice/*`-Signaturpruefung) und Routen,
die nur hinter einem Flag registriert werden (`POST /auth/dev-login`). Dafuer gibt es
den quartalsweisen Pruefpunkt in `docs/RUNBOOK-AUTH-REVIEW.md` — ein Mensch, kein
Mechanismus; wird er ausgelassen, meldet nichts.
(2) Der Test sieht, DASS eine Auth-Middleware da ist, nicht ob es die **richtige Stufe**
ist. Eine Betreiber-Route mit `webAuthMw` statt `webAuthMw + adminMw` faellt keinem
Mechanismus auf. Bleibt eine Review-Entscheidung.

**Kein neuer Env-Schluessel, keine neue Dependency, keine DB-Aenderung.**

## AUTH-P2 — Live-Probe der Routen-Absicherung (2026-08-02)

Zweite Phase von `PLAN-AUTH-GATE.md`. **Aendert kein Laufzeitverhalten** — reines
`curl` + Statusvergleich, keine neue Dependency. `scripts/probe-auth.sh` fragt jede
Route der laufenden Instanz **ohne Sitzung und ohne Credentials** ab. AUTH-P1 prueft den
Quellstand, diese Probe den **deployten** Zustand; erst beide zusammen decken den Fall
ab, dass der Code richtig ist und die Instanz trotzdem offen steht.

**Ziel-Pin (W7).** URL **und** erwarteter Commit sind Pflichtargumente. Erste Handlung
ist `GET /healthz` (liefert `commit`); weicht der SHA ab -> Abbruch mit Exit 2, **keine
weitere Anfrage**. Ohne den Pin liefe die Probe gruen gegen einen alten Deploy, waehrend
Produktion offen steht.

**404 ist kein Erfolg (W6) — und das Gate verdeckt genau das.** Fuer sitzungspflichtige
Routen zaehlt nur 401/403; ein 404 hiesse, dass `guardedBoot` (fail-open) den
Web-Login-Block verschluckt hat und die Route gar nicht gemountet ist. Solange das
Basic-Auth-Gate steht, ist dieser 404 aber **unsichtbar**: das Gate haengt vor dem
404-Handler und beantwortet jeden unbekannten Pfad mit 401. Die Probe prueft deshalb
zusaetzlich, **wer** geantwortet hat: `WWW-Authenticate: Basic` ist der Fingerabdruck
des Gates. Traegt eine Route, die vom Sitzungs-Cookie geschuetzt sein soll, diese
Challenge, ist der Web-Login-Block nicht gemountet — der W6-Zustand, heute schon
sichtbar. (Die Bearer-Challenge von `mcpAuth` zaehlt bewusst nicht mit.)

**Zwei Modi, beide gebaut.** `ist-aufnahme` (Vorgabe, heute): die Basic-Challenge wird
je Zeile gegen die erwartete Schicht geprueft. `nach-p7`: sie muss **ueberall** fehlen.
Kein auskommentierter Platzhalter — der P7-Modus ist gegen den lokalen Server
vorgefuehrt (44 Abweichungen, Exit 1, weil das Gate dort noch steht).

**Eine Wahrheit, maschinell gepinnt.** `test/probe-auth-table.test.js` haelt die
Erwartungstabelle gegen `src/route-policy.js`: jede Route der Politik kommt in der
Tabelle vor, die Einordnung stimmt ueberein, eine sitzungspflichtige Zeile darf **nie**
404 oder 2xx erwarten, und keine Zeile darf etwas fuer oeffentlich erklaeren, das in
`PUBLIC_ROUTES` nicht begruendet ist. Ohne diesen Test koennte die Probe gruen ueber
genau die Tuer laufen, die sie finden soll.

**Ist-Aufnahme vom 2026-08-02** gegen `https://app.sundartha.com`, Commit `44a7d09`
(16 Commits hinter dem lokalen `master`, ohne P1): **59 Routen, 0 Abweichungen,
Exit 0**. Alle 21 Gate-Routen antworten mit der Basic-Challenge, alle 12
Sitzungs-Routen ohne sie (der Web-Login-Block ist gemountet, `guardedBoot` hat nichts
verschluckt), `/api/plans` und `/healthz` sind wie vorgesehen oeffentlich, die drei
Negativkontrollen liefern 401 statt eines Treffers. **Kein Befund.**

**Getragene Restrisiken (benannt, nicht behoben).**
(1) Die erwarteten Statuscodes sind eine Momentaufnahme der **deployten Konfiguration**.
`TELNYX_AI_ASSISTANT_ENABLED` aus wuerde `/v1/chat/completions` von 403 auf 404 drehen,
`PAYMENT_ENABLED` aus den Stripe-Webhook von 400 auf 404 — die Probe meldet das als
Abweichung. Das ist gewollt (H10: die Tabelle wird bewusst nachgezogen, nie
weggeklickt), heisst aber: eine rote Zeile ist nicht automatisch ein Loch.
(2) Parametrisierte Routen werden mit einem Platzhalter angefragt. Gemessen wird damit
die Auth-Schicht, nicht der Handler dahinter.
(3) Die Probe laeuft **von Hand**, nicht automatisch. Sie ist der Abnahme-Nachweis jeder
Phase, die live geht (`docs/RUNBOOK-AUTH-REVIEW.md`); wird sie ausgelassen, meldet
nichts.
(4) Ein Lauf erzeugt `auth_failed`-Zeilen im Render-Log. Das ist erwartet und kein
Vorfall.

**Kein neuer Env-Schluessel, keine neue Dependency, keine DB-Aenderung.**

## AUTH-P3 — Bootstrap-Fallback nur noch fuer `isTrustedLocalCaller` (2026-08-02)

Dritte Phase von `PLAN-AUTH-GATE.md`. **Aendert Laufzeitverhalten fuer genau EINEN Pfad:**
den identitaetslosen Request. Bis hierher galt in `src/routes/_tenant.js` unkonditional
"keine Identitaet = Bootstrap-/Owner-Tenant" — an ZWEI Stellen (`MULTI_TENANT=false`-Zweig
und der Fallback in `requestTenant`, beide auf `singleTenantBootstrap()`). Dieser Satz war
nur wahr, solange das Basic-Auth-Gate jeden anonymen Request abfing (empirischer Befund,
PLAN-AUTH-GATE Abschnitt 1: ohne das Gate lieferte `GET /api/state` einem Request aus dem
Internet Owner-Daten UND ein `POST /api/calls` einen echten Outbound-Anruf).

**Der Fix.** Eine neue, EINE Funktion `operatorChannelTenant(req)` ersetzt beide
Aufrufstellen: `isTrustedLocalCaller(req) ? BOOTSTRAP_TENANT_ID : TENANT_REJECT`.
`isTrustedLocalCaller` ist KEINE neue Vertrauensquelle — es ist die bereits vorhandene,
security-reviewte AM1-Grenze (echter Loopback-Socket UND kein `X-Forwarded-For`), die
`internalIdentity`/`internalTenant` schon nutzten. Jeder identitaetslose Request, der
diese Grenze nicht erfuellt, faellt jetzt auf `TENANT_REJECT` statt auf den Owner-Tenant.

**Konsumenten-Enumeration (Pflichtschritt, vollstaendig gegrept).** Jeder
`requestTenant`/`requireTenant`-Aufrufer in `src/` (12 Fundstellen ueber
`api-read.js`, `api-calls.js`, `api-tenant-write.js`, `api-billing.js`, `routes/mcp.js`,
`outbound-gates.js`), jedes `scripts/*`, das die eigene REST-API ruft, `src/mcp-tools.js`
(In-Process-Hop) und alle Tests ohne Identitaet gegen tenant-gebundene Routen wurden
einzeln beurteilt. Ergebnis: **kein Konsument stirbt lautlos.**

- Der In-Process-Pfad (MCP-Tools -> eigene REST-API ueber `http://localhost`, stdio-
  Single-Operator) bleibt byte-identisch: echter Loopback-Socket, kein
  `X-Forwarded-For` (Node-`fetch` setzt ihn nie) -> weiterhin Bootstrap. Getestet, nicht
  behauptet (AUTH-P3-14/-15).
- `scripts/sweep-jetzt.sh` (der einzige lebende externe Credential-Nutzer) ruft
  `/api/billing/cost-truing/sweep` — eine Route OHNE Resolver. Unberuehrt.
- `POST /mcp` laeuft live unter `MCP_AUTH=oauth` (2026-08-02 gemessen: der 401 auf
  `https://app.sundartha.com/mcp` stammt ausschliesslich aus `verifyOauth`) — `req.auth`
  ist gesetzt, der geaenderte Zweig wird nicht betreten. **Restrisiko, nicht Code:** ein
  Ruecksprung auf `MCP_AUTH="" `/`token` (render.yaml-Blueprint traegt noch `value: ""`)
  wuerde den Connector nach dieser Phase stumm schalten (kein `req.auth`, externer
  Request -> `TENANT_REJECT`). Keine Boot-Sonde dafuer vorhanden.
- Legacy-Route `GET /api/billing/checkout-return`: ein *vor* dem Deploy geoeffneter
  Stripe-Checkout endet nach dieser Phase in 403 statt Karten-Bindung. Kein Live-Regress
  (die aktive Karten-Erfassung laeuft ueber `/api/self-service/billing/*`), aber genau
  der Live-Schwanz, den PLAN-AUTH-GATE Abschnitt 3 (b2)-7 fuer P9 beschreibt.

**Abnahmekriterium der Spec nicht wort-fuer-wort erreichbar (benannter Befund, keine
Abweichung).** `GET /api/state` ruft `requestTenant`, nicht `requireTenant` — es hat
keinen 403-Pfad. Nach dieser Phase liefert die Route einem externen Aufrufer weiterhin
200, aber ohne Owner-Daten (`MULTI_TENANT=true`: leere Listen, `agent.owner=""`) bzw.
bei `MULTI_TENANT=false` unveraendert die **ungefilterte** Liste (Restloch, geschlossen
erst durch P5 `internalOnly`). `/api/state` in P3 auf `requireTenant` zu heben haette
eine ZWEITE Verhaltensaenderung bedeutet und den Scope verletzt — bewusst nicht gemacht.
Test `AUTH-P3-16` pinnt den Restzustand explizit mit Verweis auf P5, statt ihn
unbemerkt verschwinden zu lassen.

**Vier Bestandstests kippen, jeder einzeln angepasst — keine Assertion abgeschwaecht:**
`test/request-tenant-unit.test.js` (drei Faelle: der reqWith-Default-Socket war extern,
die Tests meinten aber den Betreiber-Kanal bzw. pinnten genau die jetzt beseitigte
Eigenschaft) und `test/profiles.test.js` (der haerteste Fall: ein externer Aufruf ohne
Identitaet erzeugte frueher einen Call mit `requestedBy=owner` und endete an einem
Twilio-500; jetzt greift `tenant_reject` VOR dem Originate -> 403, gar kein Call — die
Spoof-Aussage wird frueher durchgesetzt, nicht schwaecher geprueft).

**Mutationsprobe gefahren** (`operatorChannelTenant` testweise auf den alten
unkonditionalen `BOOTSTRAP_TENANT_ID`-Return zurueckgedreht): genau die elf dafuer
gebauten AUTH-P3-Tests wurden rot (inkl. der beiden angepassten Bestandstest-Faelle,
die die Mutation als Gegenprobe ebenfalls faengt), die uebrige Suite blieb gruen.
Mutation von Hand zurueckgenommen (kein `git stash` — geteilt zwischen Worktrees),
`npm test` danach wieder vollstaendig gruen.

**16 neue Tests** in `test/auth-p3-bootstrap-fallback.test.js` (Praefix `AUTH-P3-N`,
bewusst NICHT im i18n-Katalog-Muster — sonst laeuft die Datei still im
`test:gates`-Lauf, wo Rot erlaubt ist und nichts meldet). Deckt `operatorChannelTenant`
tabellarisch (alle vier Kombinationen Loopback/extern x XFF/kein-XFF), `requestTenant`/
`requireTenant` in beiden Flag-Zustaenden sowie sieben Spawn-Beweise, dass das Basic-Auth-
Gate in diesen Tests nachweislich ABWESEND ist (nicht umgangen — `DASHBOARD_PASSWORD=""`
in `BASE_ENV`, jeder 403-Test prueft zusaetzlich `status !== 401` und
`www-authenticate === null`).

**Getragene Restrisiken (benannt, nicht behoben).**
(1) `/api/state` bleibt unter `MULTI_TENANT=false` ungefiltert und ohne 403 — schliesst
erst P5 (`internalOnly`).
(2) `MCP_AUTH` != `oauth` wuerde den MCP-Connector nach dieser Phase stumm schalten —
kein Code-Guard dagegen (waere neuer Scope), nur dieser Eintrag als Warnung.
(3) Fuer `GATEWAY_URL` auf einer oeffentlichen URL statt `localhost` existiert keine
Boot-Sonde; der In-Process-Hop liefe dann ueber den Render-Proxy (XFF gesetzt) und alle
MCP-Tools wuerden `TENANT_REJECT` sehen.

**Kein neuer Env-Schluessel, keine neue Dependency, keine DB-Aenderung.**
`src/route-policy.js`, `scripts/probe-auth.sh`, `src/wiring/auth-gate.js` unangetastet
(das ist P5/P6/P7).

## AUTH-P4 — tote Schreibflaeche entfernt (2026-08-02)

Vierte Phase von `PLAN-AUTH-GATE.md`. Loescht sechs Routen ersatzlos, statt sie
abzusichern: `POST /api/settings`, `POST /api/action-items/:id/toggle`,
`POST /api/calendar` (aus `src/routes/api-tenant-write.js`) sowie `GET /api/profiles`,
`POST /api/profiles`, `DELETE /api/profiles/:tenantId` (aus `src/routes/api-profiles.js`).
Beide Dateien entfallen vollstaendig, ebenso ihre Mounts/Importe in `src/app.js`.

**Der geschlossene Vektor.** `POST /api/profiles {"unrestricted":true}` konnte fuer eine
beliebige `tenantId` ein Profil mit `unrestricted: true` anlegen — genau das Feld, das
`src/telephony/outbound-gates.js` (`if (profile.unrestricted) return null;`) liest, um
das Verifikations-Gate (Abo+KYC) zu umgehen. Die Route war hinter Basic-Auth, aber
sonst ohne eigene Absicherung erreichbar (`nur Gate`, s. AUTH-P1-Inventar). Mit der
Loeschung existiert dieser HTTP-Weg zum Verifikations-Bypass nicht mehr. Test
`AUTH-P4-5` pinnt genau diesen Vektor.

**Der Profil-MECHANISMUS bleibt unangetastet.** `resolveProfile`, `PROFILES_JSON`
(Boot-Seed) und `src/telephony/outbound-gates.js` sind unveraendert — nur die
HTTP-Schreibflaeche darauf ist weg. Ein Profil entsteht danach ausschliesslich ueber
`PROFILES_JSON` beim Boot oder direkten DB-/Store-Eingriff.

**Pflicht-Umzug, sonst bricht der Boot.** `validIdentity`/`IDENTITY_MAX_LEN` wanderten
byte-identisch von `src/routes/api-profiles.js` nach `src/routes/_validation.js` (Anbau
an eine seit T4 Phase 2 bestehende Datei, keine Neuanlage). `src/routes/api-onboard.js`
importiert sie von dort — der einzige Konsument ueber Modulgrenze (verifiziert per
Grep vor der Loeschung). `AUTH-P4-7` beweist den Umzug ueber einen echten Server-Spawn
(nicht `node --check` — das prueft Syntax, nicht Modul-Aufloesung; ein fehlender Export
haette erst zur Ladezeit einen `SyntaxError` geworfen).

**Vollstaendige Aufrufer-Enumeration (Pflichtschritt, vollstaendig gegrept ueber
`src/`, `scripts/`, `apps/web/src/`, `public/`, `test/`, `docs/`,
`src/mcp-tools.js`).** Kein lebender Aufrufer der sechs Routen ausserhalb von Tests.
`src/mcp-tools.js` liest `s.actionItems`/Kalender nur lesend ueber `GET /api/state`
bzw. `get_calendar` — kein MCP-Tool ruft eine der sechs Routen. Zwei Doku-Stellen
(`tasks/al-testcall-checklist.md:110`, `tasks/al-env-changes.md:43`) beschreiben einen
manuellen Betriebsvorgang ueber `POST /api/settings` — kein Code-Aufrufer, aber siehe
Owner-Entscheidung unten.

**Owner-Entscheidung (Settings-Felder ausserhalb der Self-Service-Whitelist).** Mit
`POST /api/settings` faellt die einzige HTTP-Schreibflaeche fuer Settings-Felder, die
NICHT in der Self-Service-Whitelist stehen (`allowResearch`, `allowCallMemory`,
`smsSummaryOptIn` u.a., s. `src/self-service.js`). Der Owner hat das ausdruecklich
akzeptiert: diese Felder sind danach nur noch per direktem DB-/Store-Eingriff setzbar.
Betroffen sind zwei bekannte manuelle Vorgaenge (`tasks/al-testcall-checklist.md`
AL-P12: `allowCallMemory=true`; `tasks/al-env-changes.md`), beide Aufgaben-Notizen,
keine Runbooks — nicht editiert (Scope dieser Phase), der Ersatzweg (DB-Eingriff) ist
hier dokumentiert.

**Vier Mitzieh-Stellen im selben Commit (H10):** (1) `src/route-policy.js` —
die sechs Eintraege ersatzlos aus `GATE_ONLY_ROUTES` entfernt (21 → 15), NICHT nach
`PUBLIC_ROUTES` verschoben. (2) `test/route-auth-inventory.test.js` — `ROUTE_FINGERPRINT`
um die sechs Zeilen gekuerzt (52 → 46), sortiert. (3) `scripts/probe-auth.sh` — die
sechs Zeilen von `sitzung`/`gate` auf `fehlt`/`gate` gedreht, erwarteter Status bleibt
**401** (nicht 404): das Basic-Auth-Gate haengt vor Express' 404-Handler und maskiert
die geloeschte Route am heutigen Deploy weiterhin — messbar wird der Unterschied erst
mit P7. Die Zeilen bleiben als Negativkontrolle stehen, nicht geloescht. (4)
`docs/RUNBOOK-AUTH-REVIEW.md` — kein Edit noetig, verifiziert (keine der sechs Routen
und keine der beiden Dateien namentlich erwaehnt). `test/probe-auth-table.test.js`
haelt (1) und (3) zusammen; die neue `AUTH-P4-8` schliesst zusaetzlich die Richtung,
in der die Bestandsregeln allein nicht ausreichen (Route geloescht, Politik
nachgezogen, aber die Probe vergessen — dann ist `GATE_ONLY_ROUTES` bereits leer und
die Bestandsregeln schweigen).

**Acht neue Tests** in `test/auth-p4-deleted-routes.test.js` (Praefix `AUTH-P4-N`) plus
`AUTH-P4-8` in `test/probe-auth-table.test.js`. Der Diskriminator "Route wirklich weg"
ist der Antwort-Koerper (JSON = noch gemountet, `text/html` = echter Express-404), NICHT
allein der Status: `POST /api/action-items/:id/toggle` und
`DELETE /api/profiles/:tenantId` antworteten auch gemountet mit 404 bei unbekannter
id/tenantId — `AUTH-P4-2`/`AUTH-P4-6` zielen deshalb auf einen EXISTIERENDEN Datensatz.

**Neun Bestandstests entfallen/wandern, keiner ersatzlos ohne Grund (Detail in
`tasks/`-Historie, hier nur die Bilanz):** zwei ganze Dateien geloescht
(`test/api-routes.test.js`, `test/api-action-items-toggle.test.js` — die Route WAR die
Zusage). Innerhalb bestehender Dateien: `test/profiles.test.js` (Profil-Verwaltung +
Booking-Gate-HTTP-Tests entfallen, ersetzt durch `AUTH-P4-4/-5/-6`; die
`(e)`-Settings-Whitelist-Zusage auf `updateSettings` umgestellt), `test/api.test.js`
(Kalender-Validierung entfallen — war route-lokal; Settings-Whitelist auf
`updateSettings` umgestellt; `VOICE-09` entfallen — die Zusage haelt
`test/f1-geo-store.test.js` bereits store-seitig), `test/i6-write-scope.test.js` (zwei
Tests + ein Sub-Test entfallen — die HTTP-Naht, an der Cross-Tenant-Scoping fehlschlagen
konnte, ist weg; die Zusage wird gegenstandslos, nicht ungeprueft: der verbleibende
`/api/self-service/settings`-Pfad nimmt den Tenant strukturell aus der Session),
`test/language-switch-midcall.test.js` (E2E-03, Umstellung ueber den Seed statt eines
Live-Flips, verifiziert gruen), `test/auth-p3-bootstrap-fallback.test.js` (`AUTH-P3-12`
auf `POST /api/calls/:id/consult/answer` umgestellt — ID/Name bleiben, damit die
Zuordnung in diesem Dokument nicht rottet), `test/plans-route.test.js` (Auth-Kontrast
auf `GET /api/state` umgestellt).

**Zwei ehrliche Luecken, benannt statt verschwiegen:**
(1) `test/audit.test.js` — der `settings_update`-Audit-Test entfaellt ersatzlos
(das Event wurde ausschliesslich in `api-tenant-write.js` ausgeloest). Der
ueberlebende Schreibpfad (`/api/self-service/settings`) auditiert unter anderem Namen
(`self_service_settings`, `src/self-service-routes.js`) und loggt ebenfalls nur Keys —
aber dafuer existiert heute kein Test (braeuchte pglite + Web-Login, fremde Phase).
(2) Der `test:gates`-Katalog verliert mit `VOICE-09` einen gruenen Mechanismus-Test
(Regressionsschutz), weil die einzige HTTP-Naht, die er mass, weg ist; die materielle
Zusage lebt in `test/f1-geo-store.test.js` weiter.

**Drei benannte Reste (bewusst liegen gelassen, nicht uebersehen).** (1) Vier
Store-Fassaden-Funktionen (`listProfiles`, `deleteProfile`, `toggleActionItem`,
`addCalendarEvent`) verlieren ihren letzten `src/`-Aufrufer — Entfernung wuerde zwei
Backends (json/pg) anfassen und gehoert in einen eigenen Store-Aufraeum-Schritt, nicht
in diese chirurgische Auth-Loeschung. (2) `PROFILE_FIELDS.allowBooking` ist danach ein
Gate ohne gegatete Aktion (der einzige Konsument war `POST /api/calendar`) — das Feld
bleibt (Kommentar aktualisiert), weil `src/plans.js` jedes `PROFILE_FIELDS`-Feld
explizit setzt und ein Feld-Drop eine Migration mit Rollback-Risiko ohne funktionalen
Gewinn waere. (3) `src/routes/_tenant.js` nennt weiterhin `makeProfileRoutes` als
DI-Vorbild (toter Verweis) — die Datei steht unter explizitem Anfass-Verbot dieser
Phase (P3 ist fertig) und faellt in P5 mit, wo `internalOnly` ohnehin dort landet.

**Nichts am heutigen Deploy sichtbar anders.** Fuer einen Aufrufer ohne Credentials ist
die Antwort auf alle sechs Pfade vorher wie nachher 401 mit `WWW-Authenticate: Basic`
(das Basic-Auth-Gate deckt `/api/*` vollstaendig ab, vor Express' 404-Handler). Fuer
einen Aufrufer MIT dem Dashboard-Passwort aendert sich sehr wohl etwas (404 statt
Wirkung) — genau der beabsichtigte Effekt, und es gibt keinen solchen Aufrufer im Repo
(Enumeration oben), nur die zwei manuellen Vorgaenge, die der Owner akzeptiert hat.

**Absolute Regeln:** unberuehrt. Kein Safety-Gate faellt — im Gegenteil, ein
Umgehungsvektor auf das Verifikations-Gate wird geschlossen. `disclosureSentence`,
Signaturpruefung, `OUTBOUND_FROZEN`, pro-Tenant-Kostendecke, Denylist/Land/Stundenlimit:
nicht angefasst. Kein Secret beruehrt. Keine neue Dependency, kein Flag, keine
Env-Variable, keine DB-Aenderung. `src/wiring/auth-gate.js` (P7), `src/routes/_tenant.js`
(P3 fertig) und der Profil-Mechanismus (`resolveProfile`, `PROFILES_JSON`,
`src/telephony/outbound-gates.js`) unangetastet.

## AUTH-P5 — internalOnly + Audit-Ersatz (2026-08-02)

Fuenfte Phase von `PLAN-AUTH-GATE.md`. Macht die Vertrauensgrenze, die die sieben
MCP-Routen bisher nur als Nebeneffekt des Basic-Auth-Gates trugen, zu einer eigenen,
benannten Middleware — und legt den Audit-Ersatz an, den `PLAN-AUTH-GATE.md` fuer den
Gate-Wegfall (P7) voraussetzt.

**`internalOnly` (neu, `src/wiring/internal-only.js`).** `internalOnly(req, res, next)`:
`isTrustedLocalCaller(req) ? next() : 403 "Forbidden"`. **Keine neue Trust-Idee** —
`isTrustedLocalCaller` (`src/routes/_tenant.js`) ist dieselbe, bereits reviewte Grenze
aus AUTH-P3 (echter Loopback-Socket UND kein `X-Forwarded-For`), an genau EINER Stelle
formuliert. Haengt jetzt vor genau sieben Routen: `POST /api/calls`,
`POST /api/calls/:id/cancel`, `GET /api/calls/:id/consult`,
`POST /api/calls/:id/consult/answer` (`src/routes/api-calls.js`), `GET /api/state`,
`GET /api/calls/:id`, `GET /api/tenant-data/export` (`src/routes/api-read.js`) — der
einzige echte Aufrufer bleibt der In-Process-MCP-Pfad ueber Loopback
(`src/mcp-tools.js` → `resolveGatewayUrl()`).

**Audit-Ersatz (`AUTH_FAILED_GRUND` + `auditAuthFailed`, neu in `src/util.js`).** Bis
hierher schrieb NUR das Basic-Auth-Gate (`src/wiring/auth-gate.js`) eine
`auth_failed`-Zeile. Faellt das Gate (P7), verschwaende der einzige Meldeweg fuer
abgewiesene Zugriffe. Drei Nachfolger-Sicherungen schreiben ihn jetzt selbst — ueber
EINE Funktion, EINE feste Token-Menge:

| Token | Schreibstelle | Auslöser |
|---|---|---|
| `no_session` | `web-auth.js`, `webAuthGateMiddleware` (401) | kein/ungueltiges Cookie, keine/invalidierte/abgelaufene Session |
| `not_active` | `web-auth.js`, `webAuthGateMiddleware` (403) | Sitzung gueltig, Tenant-Status nicht erlaubt (suspended/closed) |
| `not_admin` | `web-auth.js`, `adminOnlyMiddleware` (403) | Sitzung gueltig, kein Admin |
| `not_local` | `wiring/internal-only.js` (403) | kein vertrauenswuerdiger In-Process-Aufrufer |

`expired` bleibt bewusst ohne Produzenten: der 403-Zweig von `webAuthGateMiddleware` ist
ein gesperrter Tenant, keine abgelaufene Sitzung — `expired` waere dort ein aktiv
irrefuehrendes Forensik-Label. Der `catch`-Zweig (Infrastruktur-Fehler, z.B. DB weg)
schreibt weiterhin NICHTS — er ist keine Auth-Entscheidung (Befund F2 unten).

**Zwei benannte Abweichungen von der urspruenglichen Spec (Owner kann vetoen).**
(1) Log-Schluessel `grund=` statt `reason=`: dasselbe Ereignis (`auth_failed`) traegt in
`src/auth.js` (mcpAuth) bereits `grund=` — zwei Schreibweisen fuer dasselbe Feld waeren
ein Log-Defekt. (2) Token `not_active` statt `expired` fuer den `webAuthGateMiddleware`-
403 (Begruendung s.o.).

**Regel 4 (kein Query im Forensik-Trail).** `auditAuthFailed` ist die EINZIGE Stelle, die
die Detail-Zeichenkette baut, und nutzt ausschliesslich `req.path` — `req.originalUrl`
(traegt OAuth-`code` bzw. Stripe-`session_id`) kommt im gesamten neuen Code nicht vor.
Test `AUTH-P5-3`/`-4`/`-6` (W9) beweisen das mit einem echten Query-String
(`?session_id=XYZ&code=ABC`) gegen den vollen Server bzw. eine echte Express-Route.

**`src/route-policy.js` mitgezogen (H10, selber Commit).** `AUTH_MIDDLEWARE_NAMES` +
`"internalOnly"` (vierter Eintrag, benannte Funktion — sonst waere sie im Express-Stack
`<anonymous>` und die Route saehe ungeschuetzt aus). Die sieben Zeilen mit
`plan: "P5 internalOnly"` fallen aus `GATE_ONLY_ROUTES` (15 → 8: 4× P6-Billing, 2× P9,
2× P6-Onboard). `ROUTE_FINGERPRINT` (`test/route-auth-inventory.test.js`) bleibt
UNVERAENDERT — es entsteht/verschwindet keine Route, nur ihre Einordnung wechselt von
`GATE_ONLY` auf `AUTH`.

**`scripts/probe-auth.sh` bleibt UNVERAENDERT (am Code nachgepruewft, nicht behauptet).**
`installAuthGate` mountet in `src/app.js` VOR `makeCallRoutes`/`makeReadRoutes`. Eine
Anfrage ohne Sitzung und ohne Credentials — genau das, was die Probe misst — bekommt vom
Basic-Auth-Gate 401, BEVOR `internalOnly` ueberhaupt in der Handler-Kette liegt. Die
sieben Zeilen bleiben faktisch `sitzung|…|401|gate`; der 403 wird erst mit P7 sichtbar
und ist in `test/probe-auth-table.test.js` (`AUTH-P5-7`) maschinell erzwungen (die
sieben Routen duerfen nicht mehr in `GATE_ONLY_ROUTES` stehen, die Probe-Zeile bleibt
`sitzung/401/gate`).

**Sieben neue Tests** in `test/auth-p5-internal-only.test.js` (Praefix `AUTH-P5-N`,
matcht keinen i18n-Katalog-Praefix → laeuft im Regressionslauf) plus `AUTH-P5-7` in
`test/probe-auth-table.test.js`: `AUTH-P5-1` (alle sieben Routen: 403 + genau eine
Audit-Zeile + kein Seiteneffekt, Spawn-Server ohne Dashboard-Passwort — Gate beweisbar
abwesend, nicht umgangen), `AUTH-P5-2` (Pre-Mortem-Gegenprobe: der In-Process-Pfad
inklusive eines echten MCP-`tools/call` bleibt offen), `AUTH-P5-3` (W9, gegen den vollen
Server), `AUTH-P5-4`/`-5`/`-6` (die drei Web-Auth-Ablehnungszweige gegen eine winzige
lokale Express-App mit injizierten Session-/Account-Fakes — echte `req.path`/
`req.originalUrl`-Semantik), `AUTH-P5-7` (Politik-/Probe-Konsistenz). `assertGateAbsent`
wanderte additiv nach `test/helpers.js` (geteilt mit `auth-p3-bootstrap-fallback.test.js`,
S2).

**Mutationsprobe (vorgefuehrt, zurueckgenommen).** `internalOnly` auf `next()` gedreht →
alle sieben `AUTH-P5-1`-Subtests + `AUTH-P5-3` + `AUTH-P3-16` + die zwei umgestellten
`security.test.js`-Faelle rot, `route-auth-inventory` bleibt gruen (korrekt — die
Middleware existiert weiter). Eine Route (`GET /api/state`) ohne `internalOnly` →
`route-auth-inventory` meldet `UNPROTECTED`. `auditAuthFailed` auf `req.originalUrl`
gedreht → genau die drei W9-Tests rot. `isTrustedLocalCaller` → `isLocalSocket` in
`internal-only.js` → alle sieben Routen wieder offen (AM1-Regression). Die sieben
Zeilen in `GATE_ONLY_ROUTES` stehen gelassen → `AUTH-P5-7` rot.

**Kippende Bestandstests, jeder einzeln behandelt.** `AUTH-P3-16` (200 → 403, Titel und
Assertions umgestellt — die in P3 bewusst offen gelassene Luecke ist jetzt geschlossen).
`security.test.js`: die beiden „…mit korrekten Credentials → 200"-Faelle (extern bzw.
Loopback+XFF) messen jetzt explizit „das Gate hat die Credentials akzeptiert und
durchgereicht" (kein 401, kein `www-authenticate`) statt „die Route liefert 200" — das
SUBJEKT der Tests ist das Gate, nicht die Route dahinter; die Zusage wird praeziser, nicht
schwaecher. `route-auth-inventory.test.js`: Titel „drei" → „vier" Auth-Middlewares (der
Test selbst iteriert `AUTH_MIDDLEWARE_NAMES` und deckt `internalOnly` automatisch ab).
`profiles.test.js`: Kommentar ergaenzt (403 kommt jetzt von `internalOnly`, nicht mehr
vom `tenant_reject`-Gate im Handler — Status/Store-Assertion bleiben unveraendert wahr).
`test/call-termination-order.test.js`: ein Quelltext-Marker
(`router.post("/api/calls", async...`) traf durch die neue `internalOnly`-Position
nicht mehr; Marker auf `router.post("/api/calls", internalOnly, async...` nachgezogen
(reiner Substring-Anker, keine neue Zusage). `test/audit.test.js`,
`test/plans-route.test.js`, `test/mcp-server-icon.test.js`,
`test/single-origin-serving.test.js`: KEIN Eingriff — `DASHBOARD_PASSWORD` ist dort
gesetzt, das Gate antwortet vor `internalOnly` (Mount-Reihenfolge, am Code verifiziert).

**Befunde, die diese Phase bewusst NICHT repariert (benannt, nicht verschwiegen):**
(F1) `npm run check` (Setup-Check) vergleicht `/api/state` durch den Tunnel gegen den
Loopback-Wert — ab P5 antwortet die Route Aussenverkehr mit 403, die Pruefung meldet
falsch-positiv `PUBLIC_URL antwortet nicht`. Fix bereitliegend (Vergleich auf
`/healthz` umstellen), eigene Mini-Phase. (F2) Der `catch`-Zweig von
`webAuthGateMiddleware` bleibt stumm (kein Audit, kein `console.error`) — ein
DB-Ausfall im Session-Store sieht aus wie ein fehlendes Cookie. (F3)
`scripts/convo-bench/consult-pump.mjs` kennt nur 401 als Abbruchsignal, nicht 403 —
bleibt funktionsfaehig (laeuft gegen Loopback ohne XFF), aber ein kuenftiger
Fehlkonfigurationsfall wuerde still leerlaufen. (F4) `docs/RUNBOOK-RESTORE.md` nennt
`GET /api/state` als manuellen Probe-Read — von aussen liefert das ab P7 403. (F5)
Ein undokumentierter `GATEWAY_URL`-Override (`src/mcp-tools.js`/`src/mcp-server.js`)
wuerde bei Zeigen auf einen entfernten Gateway alle sieben Routen fuer den stdio-MCP-
Server 403 machen — nicht in `.env.example`, als Restrisiko benannt.

**Absolute Regeln:** unberuehrt. Die Kette wird ENGER, nie weiter — `internalOnly` laeuft
vor jedem der sieben Handler und kann kein Gate ueberspringen. `disclosureSentence`,
Signaturpruefung, `OUTBOUND_FROZEN`, pro-Tenant-Kostendecke, Denylist/Land/Stundenlimit:
nicht angefasst. Kein Secret beruehrt. Keine neue Dependency, kein Flag, keine
Env-Variable, keine DB-Aenderung. `src/wiring/auth-gate.js` (P7) unangetastet.
`/api/tenant-data/export` bekommt `internalOnly`, NICHT `webAuthMw` (Owner-Entscheidung,
kein Ersatz fuer den DSGVO-Auskunftsweg, s. `PLAN-TENANT-EXPORT.md`).

**Abbruchsignal live (falls dieser Schritt falsch war):** MCP-Tools in claude.ai liefern
Fehler statt Daten → sofortiger Rollback (Revert, ein Commit). Sekundär: `grund=not_local`
taucht im Render-Log fuer `path=/api/state` auf, obwohl niemand von aussen anfragt —
`AUTH-P5-2` pinnt den In-Process-Pfad inklusive eines echten MCP-`tools/call` genau
dagegen.

## AUTH-P6 — Betreiber-Routen auf Admin-Session (2026-08-02)

Sechste Phase von `PLAN-AUTH-GATE.md`. Sechs Betreiber-Routen — `POST /api/onboard`,
`POST /api/onboard/retry` (`src/routes/api-onboard.js`), `POST /api/billing/flush-meters`,
`POST /api/billing/cost-truing/sweep`, `GET /api/billing/cost-drift`,
`GET /api/billing/platform-costs` (`src/routes/api-billing.js`) — haengen jetzt zusaetzlich
zur Basic-Auth hinter einer echten Admin-Browser-Sitzung (`webAuthMw`+`adminMw`).
`/api/tenant-data/export` bleibt AUSSEN VOR (AUTH-P5, `internalOnly`, Plan-Entscheidung 1
— nicht neu aufgerollt). Das Legacy-Checkout-Paar (`setup-checkout`, `checkout-return`)
bleibt UNVERAENDERT (P9, Karenz).

**Die harte Invariante.** `webAuthMw`/`adminMw` entstehen HEUTE nur im
`guardedBoot`-Block (`src/wiring/web-login.js`, `wireWebLogin`), der fail-OPEN ist
(`src/boot-guard.js`). `wireWebLogin` gibt seit dieser Phase `{ webAuthMw, adminMw }`
zurueck — als ALLERLETZTE Anweisung, NACH dem Boot-Marker `console.log("[boot]
Web-Login aktiv")`. Wirft ein Mount-Schritt vorher, faengt `guardedBoot` es fail-open
ab und gibt nichts zurueck. `src/app.js` haelt eine Bindung `let operatorAuth = null`,
die NUR im `guardedBoot`-Callback zugewiesen wird — laeuft der Block gar nicht (kein
`sessionSecret`/`pg`) oder wirft er, bleibt `operatorAuth === null`: fail-closed by
construction, kein Zweig, den man vergessen kann. `guardedBoot` selbst bleibt
UNVERAENDERT (liefert weiterhin `boolean`, kein Vertragsbruch mit `boot-guard.test.js`).

**`operatorRoutes` (neu, `src/wiring/operator-routes.js`).** Die EINE Stelle (G5/G27),
an der die Bedingung "Sicherung da → mounten, sonst NICHT mounten" steht — nicht an
sechs Registrierungsstellen. `operatorRoutes({ router, operatorAuth })` liefert `get`/
`post`-Wrapper, die `if (!operatorAuth) return;` VOR jeder Registrierung pruefen; ist
`operatorAuth` da, haengt die Registrierung `operatorAuth.webAuthMw, operatorAuth.adminMw`
UNVERAENDERT (keine Wrapper-Arrow) vor den Handler — `AUTH_MIDDLEWARE_NAMES`
(`src/route-policy.js`) erkennt beide weiterhin als benannte Funktionen im Express-
Stack. `makeBillingRoutes`/`makeOnboardRoutes` bekommen `operatorAuth` als neuen Dep und
mounten ihre vier bzw. zwei Betreiber-Zeilen ueber `operator.post`/`operator.get` statt
`router.post`/`router.get`; alle anderen Zeilen (Legacy-Checkout-Paar) bleiben auf dem
rohen `router`.

**Die zweite, von Disziplin unabhaengige Sicherung.** Wer kuenftig eine Betreiber-Route
mit dem rohen `router` statt ueber `operatorRoutes` mountet, landet in
`ROUTE_CLASS.UNPROTECTED` (`src/route-policy.js`) und macht
`test/route-auth-inventory.test.js` rot — Struktur UND Messung, nicht nur eine der
beiden.

**Mount-Position bewusst UNVERAENDERT (hinter dem Basic-Auth-Gate).** `installAuthGate`
mountet in `src/app.js` VOR `makeBillingRoutes`/`makeOnboardRoutes` — unveraendert seit
P0. Einem anonymen externen Aufrufer antwortet weiterhin das Basic-Auth-Gate (401 MIT
`WWW-Authenticate: Basic`), nicht `webAuthGateMiddleware` (401 ohne Challenge) — die
Staffelung Gate+Sitzung bleibt bis P7 erhalten, der Diff bleibt klein, und Sicherung +
antwortende Schicht wechseln nicht im selben Commit (waere bei einem Live-Befund nicht
mehr trennbar, welche Aenderung ihn ausloeste). Folge: `scripts/probe-auth.sh` aendert
fuer die sechs Zeilen NUR die Begruendungs-Spalte (`... (P6: webAuth+adminOnly)`) — ART
bleibt `sitzung`, STATUS bleibt `401`, ANTWORTET bleibt `gate`. Maschinell erzwungen
durch `AUTH-P6-9` (`test/probe-auth-table.test.js`): die sechs Zeilen duerfen nicht mehr
in `GATE_ONLY_ROUTES` stehen, die Probe-Zeile bleibt unveraendert, UND `GATE_ONLY_ROUTES`
enthaelt danach GENAU das Legacy-Checkout-Paar (der Zwischenstand, den P7 vorfindet).

**`src/route-policy.js` mitgezogen (H10, selber Commit).** Die sechs Zeilen mit
`plan: "P6 webAuthMw+adminMw"` fallen aus `GATE_ONLY_ROUTES` (8 → 2: nur noch das
Legacy-Checkout-Paar). `ROUTE_FINGERPRINT` bleibt UNVERAENDERT — die Routen existieren
weiter, nur ihre Einordnung wechselt von `GATE_ONLY` auf `AUTH`.

**Admin-Mechanismus (kein neuer Code, nur Betriebswissen).** `adminOnly`
(`src/web-auth.js`): `t.role === "admin" || (t.email && allow.includes(t.email))` — ODER,
nicht UND. `ADMIN_EMAILS` existiert bereits (`config.auth.adminEmails`), keine neue
Env-Variable. Vor diesem Deploy MUSS der Owner pruefen: (1) steht die eigene Login-
E-Mail in `ADMIN_EMAILS` im Render-Dashboard, ODER (2) `role='admin'` +
`status='active'` in der Produktions-`accounts`-Tabelle (`scripts/grant-admin.js`
existiert bereits). `status` ist die zweite Falle: `webAuth` ist active-only — ein
`suspended`-Admin-Account bekommt 403 VOR `adminOnly`, unabhaengig von der Rolle.

**Zwei operative Folgen, die mit dem Deploy sofort eintreten.**
`scripts/sweep-jetzt.sh` (curl mit Basic-Auth gegen `/api/billing/cost-truing/sweep`)
wird wirkungslos (403/401) — konsistent mit der Owner-Entscheidung, das Skript in P7
ersatzlos zu streichen; der Intervall-Sweep laeuft unveraendert weiter. Alle sechs
Routen sind ab jetzt NUR noch aus einem eingeloggten Browser mit Admin-Account
bedienbar — `curl` mit Basic-Auth reicht nicht mehr, auch nicht von localhost
(`isTrustedLocalCaller` traegt diese sechs Routen bewusst NICHT, anders als die sieben
P5-Routen).

**Neun neue Tests**, drei Dateien nach Ausfuehrungsart getrennt (Lehre: pglite nie mit
Kindprozess mischen). `test/auth-p6-operator-routes.test.js` (pglite, kein Spawn):
`AUTH-P6-1` (ohne Sitzung → 401 auf allen sechs Routen, kein `www-authenticate`, keine
Seiteneffekte), `AUTH-P6-2` (aktive Nicht-Admin-Sitzung → 403, keine Seiteneffekte),
`AUTH-P6-3`/`AUTH-P6-4` (Admin per `ADMIN_EMAILS` bzw. per `role='admin'` — beide
Zugangswege tragen, dieselbe Erfolgs-Assertion). `test/auth-p6-mount-gate.test.js`
(Spawn, kein pglite): `AUTH-P6-5` (json/kein `SESSION_SECRET` → alle sechs Routen 404,
Gate nachweisbar abwesend, `/healthz` lebt weiter), `AUTH-P6-5b` (`SESSION_SECRET`
ALLEIN, weiter json → weiterhin 404 — die Bedingung ist ein UND), `AUTH-P6-6` (externer
Aufrufer → 401 MIT `WWW-Authenticate: Basic` — die Zeile, die die Probe erwartet).
`test/route-auth-inventory.test.js` (+2): `AUTH-P6-7` (die sechs Routen tragen BEIDE
Middlewares, nicht nur eine — schliesst die in Abschnitt "Ehrliche Luecke" (`AUTH-P1`
oben) benannte Schwaeche von `classifyRoute` fuer diese sechs), `AUTH-P6-8` (Kehrseite
im mageren json-Graph: keiner der sechs Schluessel existiert dort). Plus `AUTH-P6-9` in
`test/probe-auth-table.test.js` (s.o.).

**Mutationsprobe (vorgefuehrt, zurueckgenommen).** `adminMw` aus der Kette entfernen
(`operator-routes.js`) → `AUTH-P6-2` (Nicht-Admin bekaeme 200 statt 403) UND `AUTH-P6-7`
(`adminOnlyMiddleware` fehlt in der Kette) rot — zwei unabhaengige Detektoren.
`webAuthMw` entfernen → `AUTH-P6-1` und `AUTH-P6-7` rot. Das `if (!operatorAuth) return;`
durch ungeschuetztes Mounten ersetzt → `AUTH-P6-5` (404 → 200/400) und `AUTH-P6-8` rot;
zusaetzlich meldet `route-auth-inventory.test.js` die sechs Routen als `UNPROTECTED`
(kein Auth-Middleware-Name, kein `GATE_ONLY`-Eintrag mehr). Die sechs Zeilen NICHT aus
`GATE_ONLY_ROUTES` entfernt → `AUTH-P6-9` rot.

**Kippende Bestandstests — 15 Dateien, je einzeln migriert (In-Process-Mount statt
Server-Spawn, dieselben Assertionen).** `test/billing-payment-gate.test.js` (1 Test:
`operatorAuth`-Durchreiche-Attrappe ergaenzt), `test/api-flush-meters.test.js` (4),
`test/api-cost-drift.test.js` (3 von 4, der externe-IP-Auth-Test bleibt Spawn),
`test/api-cost-truing-sweep.test.js` (2 von 3, dito, mit einer ECHTEN
`makeCostTruing`-Instanz), `test/api-platform-costs.test.js` (2 von 6, dito),
`test/onboarding-route.test.js` (8, inkl. Provisioning-Double statt echtem Telnyx-Kauf
— **Coverage-Delta B**, s.u.), `test/onboarding-identity.test.js` (6, plus die zwei
`AUTH-P4-7`-Assertionen aus `auth-p4-deleted-routes.test.js` uebernommen),
`test/f1-geo-onboard.test.js` (9, inkl. `setWorldDefaultLanguageEnabled(true)` explizit
gesetzt — s.u.), `test/fmt-11-onboard-privatenumber-country-gate.test.js` (1),
`test/onboard-persist-failure.test.js` (1, "Prozess lebt weiter" →
"kein `unhandledRejection`-Ereignis" — **Coverage-Delta C**), `test/p2-onboard-retry.test.js`
(3 von 4, NICHT 2 von 4 wie im Umsetzungsplan angenommen — s. Deviation unten; (d) bleibt
Spawn), `test/prov01-retry-redrive-http.test.js` (2, mit dem ECHTEN
`makeProvisioningOrchestrator` + dem ECHTEN Telnyx-Adapter gegen den lokalen Mock — der
Seed-Schritt "Tenant per HTTP anlegen" wird durch direkte `registerTenant`/
`requestNumber`/`queueProvisioning`-Aufrufe ersetzt, Setup statt Subjekt),
`test/p10-world-default-language-switch.test.js` (die zwei Wiring-Tests AUSGELAGERT nach
`test/p10-world-default-language-onboard.test.js`, NICHT im Bestand migriert — s.
Deviation unten), `test/e2e-05-us-launch-full-chain.test.js` (Spawn bleibt — Kette, kein
Routen-Test; der Onboard-HTTP-Schritt wird durch direkte Aufrufe derselben puren
Funktionen ersetzt, die die Route intern nutzt, PLUS einen Store-Seed mit dem
Ergebniszustand gegen einen echten Boot unter `prodEnv()`), `test/auth-p4-deleted-
routes.test.js` (AUTH-P4-7 auf den Boot-Beweis reduziert, s.o.).

**Zwei Deviationen vom Umsetzungsplan (Plan-Praemisse durch Messung widerlegt, nicht
stillschweigend uebernommen).**
(1) `test/p2-onboard-retry.test.js`: der Plan nannte "2 von 4" Tests fuer die Migration;
empirisch brauchen DREI der vier Tests ((a)/(b)/(c)) die Migration — sie antworten alle
DURCH die Route selbst (200/409/403), nicht durch das Gate davor. Nur (d) misst
tatsaechlich das Gate (401 vor jeder Route-Existenz-Frage) und blieb darum unveraendert.
(2) `test/p10-world-default-language-switch.test.js`: die zwei Wiring-Tests (Achse B)
mussten in eine EIGENE Datei wandern, nicht in derselben Datei migriert werden — sie
brauchen `withConfigNamespaces` und damit `src/config.js`, dessen Boot-Wiring-
Seiteneffekt (`setWorldDefaultLanguageEnabled(config.provisioning.
worldDefaultLanguageEnabled)`) beim blossen Import feuert und den allerersten Test der
Datei (Achse A, "Code-Default ist 'en', OHNE config.js geladen zu haben") seine Praemisse
entzogen haette.

**Drei benannte Coverage-Verluste (bewusst, nicht verschwiegen).**
**A** — die Kette `server.js (makeCostTruing/provisioning) → deps → buildApp → Route`
ist fuer die sechs Betreiber-Routen NICHT mehr ueber einen Spawn-Server gemessen (dafuer
braeuchte es pg im Spawn). Ersatz: ab P7 misst die Live-Probe sie — ein 404 auf diesen
Routen ist dort ein DURCHFALL. **B** — der Nummernkauf ueber HTTP (Telnyx-Mock, Warten
auf `active`) laeuft in `test/onboarding-route.test.js` nicht mehr durch den Router; die
Kauf-Kette selbst bleibt in `test/provisioning-worker.test.js` und
`test/onboarding-service.test.js` gedeckt (und weiterhin voll ueber
`test/prov01-retry-redrive-http.test.js`, das den echten Orchestrator+Adapter behaelt).
**C** — "der Prozess ueberlebt einen Save-Fehler" (`onboard-persist-failure.test.js`)
wurde zu "der Handler antwortet 503 ohne unhandled rejection"; der Prozess-/Boot-Aspekt
bleibt in den uebrigen Spawn-Tests gedeckt.

**Absolute Regeln:** unberuehrt. Die Kette wird ENGER, nie weiter — die sechs Routen
sind entweder admin-gesichert ODER existieren nicht, niemals ungeschuetzt.
`disclosureSentence`, Signaturpruefung, `OUTBOUND_FROZEN`, pro-Tenant-Kostendecke,
Denylist/Land/Stundenlimit: nicht angefasst. Kein Secret beruehrt (`ADMIN_EMAILS`
existiert bereits). Keine neue Dependency, kein Flag, keine Env-Variable, keine
DB-Aenderung. `src/wiring/auth-gate.js` (P7) unangetastet. Das Legacy-Checkout-Paar
(P9) unangetastet.

**Abbruchsignal live (falls dieser Schritt falsch war):** der Owner kommt nach dem
Deploy nicht mehr an das Onboarding (`/api/onboard`) → sofortiger Rollback (Revert, ein
Commit) — `/api/onboard` ist die einzige Flaeche zum Anlegen neuer Tenants, ohne
Admin-Zugang steht der Verkauf. Sekundär: `scripts/sweep-jetzt.sh` liefert 401/403 im
Cron-Log — erwartet (s.o.), kein Abbruchsignal fuer sich allein.

## AUTH-P7 — das Basic-Auth-Gate entfernt (2026-08-02)

Siebte Phase von `PLAN-AUTH-GATE.md`, der eigentliche Auftrag der Kette: `src/wiring/
auth-gate.js` (`makeAuthGate`, die Sammelsicherung samt neunteiliger Exemption-Liste)
ist geloescht. Jede Route traegt seither ihre eigene Sicherung oder steht mit
Begruendung in `PUBLIC_ROUTES` (`src/route-policy.js`) — genau der Zustand, den AUTH-P1
bis AUTH-P6 vorbereitet haben, ohne ihn scharfzuschalten.

**Befund B-1 (korrigiert vor der Umsetzung).** Die urspruengliche Abnahme-Regel
"`grep -rn "WWW-Authenticate" src/` → leer" war falsch. `src/auth.js` setzt bei fehlendem
MCP-Bearer-Token eine RFC-9728-Challenge (`WWW-Authenticate: Bearer resource_metadata=
"…"`) — die Discovery-Naht des Claude-Connectors, in `test/oauth.test.js` gepinnt. Wer
die Regel woertlich befolgt, loescht die Bearer-Challenge und macht den OAuth-Connector
still kaputt. Korrigierte Abnahme: `WWW-Authenticate` kommt in `src/` **ausschliesslich**
in `src/auth.js` vor (zwei Zeilen: Kommentar + Challenge); `basic realm` und
`makeAuthGate`/`installAuthGate`/`wiring/auth-gate` sind **leer**. `test/auth-p7-gate-
removed.test.js` (AUTH-P7-8) haelt beides als Positiv-/Negativ-Assertion fest.

**Was der Wegfall real freilegt: NICHTS.** Der Mount-Baum vor P7 hatte das Gate NACH
`registerPublicRoutes`, `wireWebLogin` und `registerStaticServing` — vier der neun
Exemptions (`/voice`, `/mcp`, `/.well-known/*`, `/healthz`, der Stripe-Webhook) waren
damit bereits wirkungslos, bevor diese Phase begann. Die einzige neu ungeschuetzte
Schicht ist `express.static(publicDir)` — und `public/` enthaelt seit der Owner-Removal-
Kette (P5) nur noch zwei Marken-Assets (`favicon.ico`, `brand/hermes-icon.png`), die
zuvor ohnehin per Exemption oeffentlich waren. Der vollstaendige, von aussen sichtbare
Blast-Radius: (a) die neun `internalOnly`-Routen wechseln 401→403, (b) die sechs
Betreiber-Routen (AUTH-P6) antworten weiter 401, nur ohne Basic-Challenge (Schichtwechsel
Gate→`webAuthGateMiddleware`), (c) jeder nicht existierende Pfad liefert 401→404 statt
maskiert zu werden — inklusive der sechs in AUTH-P4 geloeschten Routen, (d) sieben neue
302-Umleitungen, (e) keine Basic-Challenge mehr in irgendeiner Antwort.

**Das Legacy-Checkout-Paar traegt `internalOnly`.** `GATE_ONLY_ROUTES` (`src/route-
policy.js`) musste vor dem Gate-Wegfall leer sein — das war die harte Vorbedingung aus
AUTH-P5/P6. `POST /api/billing/setup-checkout` und `GET /api/billing/checkout-return`
(`src/routes/api-billing.js`) bekommen darum in diesem Commit dieselbe Middleware wie
die sieben P5-Routen (kein neuer Mechanismus). Begruendung: seit AUTH-P3 liefert
`requireTenant` jedem nicht-lokalen Aufrufer ohnehin 403 — `internalOnly` macht denselben
Zustand nur sichtbar und maschinell pruefbar. Geloescht wird das Paar weiterhin erst in
AUTH-P9 (Karenzfrist). `GATE_ONLY_ROUTES` ist jetzt `Object.freeze([])` — die Liste
bleibt als MECHANISMUS stehen (ein neuer Eintrag heisst: eine Route haengt wieder allein
an einer Sammelsicherung, die es nicht mehr gibt), nicht als Beweis fuer einen laufenden
Umbau.

**Sieben neue Umleitungen (Owner-Entscheidung 2026-08-02).** `/login`, `/signin`,
`/sign-in` → 302 `/auth/login`; `/dashboard`, `/account`, `/portal`, `/admin` → 302
`/app`. Die Pfade leben als benannte Konstanten in `src/portal-paths.js`
(`LOGIN_ALIAS_PATHS`/`APP_ALIAS_PATHS`) — NUR die Quell-Pfade, die Ziele bleiben, wo sie
schon standen (`APP_PATH`, das modul-lokale `LOGIN_PATH` in `src/app.js`), damit keine
vierte Definition von `"/auth/login"` entsteht (die drei bestehenden — `src/app.js`,
`src/web-auth.js:LOGIN_ROUTE`, ein Literal in `src/route-policy.js` — sind ein
**Bestands**-G5-Verstoss und bleiben in dieser Phase unangetastet, s. offener Befund
unten). `registerPathRedirects` (`src/app.js`) mountet mit `app.get` (nie `app.use` —
sonst Praefix-Shadowing) einzeln je Pfad (nie `app.get([...])` — sonst traegt
`layer.route.path` ein Array und der Inventar-Fingerprint/die Probe-Zuordnung brechen),
VOR `wireWebLogin` und beiden statischen Schichten. Shadowing-Pruefung (gemessen): keine
der sieben Adressen ist eine existierende Route, eine `apps/web/dist`-Seite oder eine
`public/`-Datei; `/admin` beschattet `/api/admin/*` NICHT (`app.get` matcht exakt, kein
Praefix). Akzeptiertes Restrisiko: legt `apps/web` spaeter eine gleichnamige Seite an,
gewinnt die Umleitung, und kein Mechanismus meldet das automatisch — Gegenmassnahme ist
der Kommentar in `src/portal-paths.js` plus der quartalsweise Durchgang in
`docs/RUNBOOK-AUTH-REVIEW.md`.

**`src/route-policy.js` mitgezogen.** Die sieben Umleitungen kommen als
`PUBLIC_ROUTES`-Eintraege dazu, abgeleitet aus `LOGIN_ALIAS_PATHS`/`APP_ALIAS_PATHS`
(keine achte Wiederholung der Pfade). `ROUTE_FINGERPRINT`
(`test/route-auth-inventory.test.js`) waechst um dieselben sieben Eintraege (46 → 53).

**`scripts/probe-auth.sh` auf den neuen Stand.** Der Vorgabe-Modus wechselt von
`ist-aufnahme` auf `nach-p7` (der Modus `ist-aufnahme` bleibt als Argument gueltig — er
ist der Rollback-Fall gegen einen Deploy vor AUTH-P7). Die Spalte `ANTWORTET` verliert
den Wert `gate` vollstaendig, `internal` kommt als neuer Wert fuer `internalOnly` dazu.
Die Erwartungstabelle waechst von 59 auf 64 Zeilen (+7 Umleitungen, davon zwei aus dem
`fehlt`-Block gewandert: `/login`, `/dashboard` waren vorher Negativkontrollen, sind jetzt
oeffentliche 302er). `test/probe-auth-table.test.js` zieht Enum und Widerspruchsregeln
nach; neu: eine `fehlt`-Zeile MUSS jetzt `antwortet=keine, status=404` tragen (die
maschinelle Fassung der P7-Zusage "nichts maskiert einen fehlenden Pfad mehr").

**Neue Tests.** `test/auth-p7-gate-removed.test.js` (AUTH-P7-1 bis -8): der
Datenleck-Riegel (`/api/state` ohne Sitzung → 403, nie 200), die 404-Zusage fuer
unbekannte Pfade, die sieben Umleitungen samt Vollstaendigkeits- und
Shadowing-Negativprobe, "keine Antwort traegt eine Basic-Challenge" ueber vier
Antwortklassen PLUS die Gegenprobe zu B-1 (`POST /mcp` behaelt seine Bearer-Challenge),
die Pre-Mortem-Gegenprobe (der In-Process-MCP-Pfad bleibt bei echtem Loopback
unversehrt), das Legacy-Checkout-Paar mit `internalOnly` (inkl. der Regel-4-Probe: keine
`session_id` in der Audit-Zeile) und der Quelltext-Scan gegen eine Wiederauferstehung.
`AUTH-P7-6` (`GATE_ONLY_ROUTES` ist leer) lebt in `test/probe-auth-table.test.js`, wo
bereits alle `GATE_ONLY`-Assertionen zu Hause sind.

**Elf Bestandstestdateien kippen (401→403/404, ohne Verhaltensverlust), elf weitere
sind gruen mit toter Praemisse (nur Kommentar/Testname).** `test/security.test.js` (3
Assertionen auf 403, zwei "Gate akzeptiert Credentials"-Untertests ersatzlos gestrichen
— das Subjekt entfaellt ohne Gate), `test/auth-p6-mount-gate.test.js` (AUTH-P6-6 auf die
W6-Negativkontrolle umgeschrieben: 404 ohne Basic-Challenge statt 401 mit),
`test/plans-route.test.js`, `test/single-origin-serving.test.js` (Kontrast-Ziel von
`GET /api/calls` — das es nie gab, das Gate maskierte den Bug — auf `GET /api/state`
gewechselt), `test/mcp-server-icon.test.js`, `test/api-cost-drift.test.js`,
`test/api-cost-truing-sweep.test.js`, `test/api-platform-costs.test.js`,
`test/p2-onboard-retry.test.js`, `test/did-07-onboard-retry-owner-gate.test.js` (liegt
im `test:gates`-Katalog), `test/audit.test.js` (Basic-Header entfernt, Erwartung 403,
Audit-Grund auf `not_local` geschaerft). Reine Text-/Namensfixes ohne Assertions-
Aenderung: `test/helpers.js` (`assertGateAbsent`-Kommentar), `test/auth-p3-bootstrap-
fallback.test.js`, `test/auth-p5-internal-only.test.js`, `test/oauth.test.js`,
`test/telnyx-shim-route.test.js`, `test/i6-write-scope.test.js`,
`test/config-self-service-live.test.js`, `test/web-login-wiring.test.js`. Zusaetzlich
(beim Testlauf gefunden, nicht im Umsetzungsplan vorgesehen):
`test/al-d3-consult-pump.test.js` (AL-D3-N7) — `scripts/convo-bench/consult-pump.mjs`
antwortet auf einen Auth-Fehlschlag seit AUTH-P7 mit 403 statt 401 (`internalOnly` statt
Gate), der Fake-Server und die Assertion im Test wandern mit. Unveraendert (Boot-Guard
bleibt bis P8): `test/boot-prod-footguns.test.js`, `test/config-prod-footguns.test.js`,
`test/prod-env.js`.

**`DASHBOARD_PASSWORD` bleibt — bewusst, nicht vergessen.** Die Variable steht
weiterhin in `src/config.js`, `render.yaml` und `.env.example`, aber ab diesem Commit
liest sie KEINE Route mehr. Sie bleibt bis AUTH-P8 (fruehestens 14 Tage nach dem
Live-Deploy) Boot-Pflicht in Produktion (`productionFootguns`, `src/config.js`) —
ausschliesslich als Rollback-Sicherung: ein Rollback auf einen Commit vor AUTH-P7 findet
damit ein scharfes Gate vor. Die Boot-Meldung ist entsprechend umformuliert (nennt
weiterhin den Variablennamen — `test/config-prod-footguns.test.js`/`test/boot-prod-
footguns.test.js` matchen nur den Namen, nicht den Wortlaut), der Guard-Mechanismus
selbst ist unveraendert.

**Erwartete Betriebsfolge: das Volumen der `auth_failed`-Zeilen faellt.** Nicht, weil
die Angriffe aufgehoert haben, sondern weil ein Bot-Scan auf `/.env` o.ae. kuenftig
einen 404 OHNE jede Middleware trifft, statt eine `auth_failed`-Zeile auszuloesen. Die
Rauschreduktion ist beabsichtigt (Plan Abschnitt 5, S4) und gehoert in den ersten
Nach-Deploy-Review, damit niemand sie faelschlich als "nichts scannt uns mehr" liest.

**Offener Befund (nicht Teil dieser Phase, gehoert vor die naechste Auth-Aenderung):**
`"/auth/login"` ist dreifach definiert — `src/app.js` (`LOGIN_PATH`, modul-lokal),
`src/web-auth.js` (`LOGIN_ROUTE`, exportiert), `src/route-policy.js` (Literal). Die
Vereinheitlichung ist ein Bestands-G5-Verstoss, kein AUTH-P7-Regress, und bewusst NICHT
in dieser Phase behoben (Absolute Regel 6, Scope).

**Absolute Regeln:** unberuehrt, aber Regel 3 ist neu gefasst (`CLAUDE.md`) — die
Begruendung fuer eine Auth-Ausnahme muss seit AUTH-P7 zusaetzlich maschinenlesbar in
`PUBLIC_ROUTES` stehen, sonst schlaegt `test/route-auth-inventory.test.js` fehl. Das ist
STRENGER als vorher, nicht schwaecher. Safety-Gates (Denylist/Land/Stundenlimit/
pro-Tenant-Kostendecke/Max-Dauer/Signaturpruefung/`OUTBOUND_FROZEN`/Abo+KYC): nicht
angefasst — das Basic-Auth-Gate war nie eines davon, sein Wegfall ist der ausdrueckliche
Auftrag dieser Phase. `disclosureSentence`: unangetastet. Keine neue Dependency, kein
neues Flag, keine DB-Aenderung.

**Rollback-Weg.** Deploy des Vorgaenger-Commits. `DASHBOARD_PASSWORD` steht in Render,
`config.js` und `render.yaml` weiterhin — das alte Gate ist damit sofort wieder scharf.
**Abbruchsignal live:** die Probe meldet 200 auf `/api/state` OHNE Sitzung → sofortiger
Rollback (der Datenleck-Fall). Der eigentliche Abnahmenachweis —
`scripts/probe-auth.sh <url> <sha> nach-p7` → Exit 0 — ist eine Owner-Handlung nach dem
Deploy und kann in der Umsetzungs-Session nicht erbracht werden.

## KV-P0 — Flush-Stichtag verriegelt die Nachmeldung an Stripe (2026-08-03)

> **Was hinzukommt.** `flushMeters` (`src/billing/meter.js`) meldet ab dieser Phase
> ausschliesslich Verbrauchsereignisse mit `occurredAt >= BILLING_FLUSH_EPOCH` an Stripe.
> Die Auswahl trifft **eine** Funktion an der Entstehung der Kandidatenliste —
> `flushableMeterEvents` in `src/store/state-ops.js`; der Aggregator daneben
> (`aggregateMeterEvents`) gruppiert nur noch eine ihm uebergebene Liste und sieht den
> Zustand gar nicht mehr. Ein zweiter Flush-Aufrufer kann den Riegel deshalb nicht
> umgehen, sondern hoechstens den Stichtag vergessen — und dann meldet er **nichts**.
>
> **Fail-Richtung, ausdruecklich.** Fehlt der Wert, ist er leer, unlesbar oder kein
> String, gehen **null** Ereignisse hinaus (`sent === 0`, `skipReason =
> "no_flush_epoch"`, `skipped` = Zahl der zurueckgehaltenen Zeilen). "Meldet nichts" ist
> der Ruhezustand; "meldet alles" ist per Konstruktion nicht erreichbar. Der Waechter auf
> den Argumenttyp ist nicht kosmetisch: `new Date(null)` ergibt in JavaScript ein
> gueltiges Datum (1970-01-01) — ohne ihn haette ausgerechnet der "nicht gesetzt"-Wert
> den gesamten Altbestand freigegeben.
>
> **Warum.** Der Ledger trug am 2026-08-03 **138 von 138** `usage_event`-Zeilen mit
> `stripe_meter_sent = false`, darunter Inbound-Minuten zum alten 300-ct-Worst-Case-Tarif
> und als `number_month` etikettierte Einrichtungsgebuehren, die keine Monatsmiete sind.
> `POST /api/billing/flush-meters` hat keinen Ausloeser, ist aber scharf
> (`PAYMENT_ENABLED` live `true`) und haette bei **einem** Aufruf — beim Debuggen, aus
> Neugier, per Skript — alles auf einmal an echte Kunden gemeldet. Das war ein
> Ein-Klick-Fehlbetrag, kein theoretisches Risiko (Pre-Mortem TOD 3,
> `tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md`).
>
> **Was sich NICHT aendert.** Keine Zeile in Prod wird geschrieben, geloescht,
> umetikettiert oder nachgebucht — die Altzeilen bleiben stehen und werden lediglich
> unerreichbar fuer den Flush. Die Auth des Endpunkts (Admin-Sitzung, `webAuthMw`+
> `adminMw`, ohne diese Infra gar nicht gemountet) und das `PAYMENT_ENABLED`-404 bleiben
> unveraendert; es entsteht keine neue oeffentliche Route und kein Eintrag in
> `src/route-policy.js`. Die Semantik von `stripe_meter_sent` bleibt unangetastet (nur
> tatsaechlich Gemeldetes flippt). Die Gate-Achse (`usage.costCents`/
> `spendMonthCostCents`, `bookCents`, `budgetExceeded`) ist von dieser Phase nicht
> beruehrt.
>
> **Betriebs-Vorbehalt.** Ein **gesetzter** Wert in falscher Form (ohne Zonenangabe,
> `"0"`, ein Datum in Landesschreibweise) verweigert den Boot (`assertConfig`, Muster
> `numEnv`/`boolEnv`) — bewusst laut statt still. Und: **der Wert wird nie
> zurueckdatiert.** Er ist ein Riegel vor den Altzeilen, kein Berichtsfenster; wer ihn
> nach hinten schiebt, hebt genau die Sicherung auf, die dieser Abschnitt beschreibt.
> Sichtbarer Indikator ist der Zaehler `skipped` in der Antwort und in der Audit-Zeile
> `meter_flush`: faellt er unerwartet auf 0, wurde der Stichtag bewegt.
>
> **Bewusst getragenes Restrisiko.** Der Riegel schuetzt vor der versehentlichen
> *Massen*-Meldung, nicht vor einer absichtlichen: ein Betreiber mit Admin-Sitzung, der
> den Stichtag zurueckdatiert und den Endpunkt aufruft, kann die Altzeilen weiterhin
> melden. Das ist die Grenze eines Konfigurationsriegels und wird als solche getragen;
> die eigentliche Aussage — es gibt keine nutzungsbasierte Weiterbelastung
> (Owner-Entscheidung 2a) — steht in `README.md`.

## KV-P3 — Inbound erreicht den Ist-Abgleich (2026-08-03)

> **Was sich aendert.** Der Ist-Abgleich (`src/billing/cost-truing.js`) verliert seinen
> Richtungsfilter: `isEndedOutbound` heisst jetzt `isEndedCall` und prueft nur noch
> `!!call.endedAt`. Damit werden beendete INBOUND-Calls Kandidaten von
> `isTruingCandidate`, bekommen `cost_trued_at`, `actual_cost_micro_cents` und eine
> Delta-Buchung auf der pro-Tenant-Kostendecke. Der Name trug die Richtung mit; beides
> ist weg. `OUTBOUND_DIRECTION` faellt als toter Code. Der Telnyx-Adapter ist NICHT
> angefasst — geprueft per `grep -n "direction" src/telephony/adapters/telnyx/voice.js`
> (0 Treffer); die Beleg-Zuordnung (Anker `call_control_id`, Session-Felder
> `telnyx_session_id`/`call_session_id`) kennt das Feld `direction` nirgends.
>
> **Warum, mit Zahlen.** KV-P2 bucht seit dem 2026-08-03 eine Schaetzung von
> `VOICE_TARIFF_INBOUND_CENTS` = 6 EUR-Cent je angefangener Minute auf die Gate-Achse.
> Der an KV-M1 gemessene Ist-Satz (Ankeranruf `call_msczw0irl06s`, 79,6 s = 2 angefangene
> Minuten, 13 zugeordnete Belege, 3.731.030 USD-Mikro-Cent) betraegt 1,87 US-Cent je
> angefangener Minute, umgerechnet mit `providerToBucketRateMicro` = 920000 rund 1,72
> EUR-Cent. Ohne diesen Abgleich belastet KV-P2 den Kunden dauerhaft um etwa das
> Dreieinhalbfache der realen Kosten. Das ist der Zweck dieser Phase.
>
> **Erwartete Korrekturrichtung: NEGATIV.** Am KV-M1-Anker: 12 ct gebucht (2 angefangene
> Minuten x 6 ct) gegen 3 ct Ist (Bucket-Cent, ganzzahlig, mit Rest-Uebertrag in
> `costCorrectionMicroCentsRem`) = -9 ct. Eine negative Korrektur laeuft ueber
> `applyCreditCents` (`state-ops.js`) und verlangt vorher den vollen Beweis:
> `refundProven` (vollstaendige Pflicht-Menge, `billedSecTotal > 0`, buchbarer
> Schaetzbetrag). Ohne diesen Beweis wird sie verworfen und der Mikro-Cent-Rest bleibt
> bit-gleich — die Nachforderung (positives Delta) wird dagegen bedingungslos gebucht.
> Diese Asymmetrie ist unveraendert (LCT P4).
>
> **Der Periodengrenzen-Riegel bleibt UNVERAENDERT (KS-P5).** Trifft die Gutschrift nach
> einem Monats- oder Periodenwechsel ein, wirkt sie ausschliesslich auf der
> Lebenszeit-Achse: `creditHitsSpendMonth` verlangt einen passenden, noch laufenden
> Monatsanker, und `creditHitsBudgetPeriod` verschiebt bei fremder Periode die Baseline
> mit, damit das laufende Fenster nicht aufgeweitet wird. Ohne diese Kompensation
> vergroesserte jede alte Gutschrift die Perioden-Decke — auf DIESER Achse gibt es sonst
> keinen Missbrauchsschutz. Es zu "reparieren" waere ein Scope-Bruch dieser Phase.
>
> **RESTRISIKO (TOD 4), bewusst getragen, mit Zahl.** Zwischen der Buchung der Schaetzung
> (1 ms nach Gespraechsende) und ihrer Korrektur liegen `COST_TRUING_DELAY_MINUTES` (30)
> plus ein Sweep-Takt `COST_TRUING_SWEEP_INTERVAL_MS` (1 h), also bis zu rund 1,5
> Stunden, in denen das Gate NUR die Schaetzung sieht. Die Fail-Richtung ist bewusst
> "im Zweifel teurer": der Kunde wird in diesem Fenster zu hoch belastet, nie zu niedrig.
> Die Exposition eines EINZELNEN Legs deckelt `MAX_CALL_DURATION_CAP_S` (1800 s) auf
> hoechstens 30 x 6 = 180 Cent Schaetzung gegen rund 52 Cent Ist. Faellt dieses Fenster
> ueber eine Monats-/Periodengrenze, bleibt die Ueberzahlung auf der gate-tragenden Achse
> stehen und wird nur auf der Lebenszeit-Achse gutgeschrieben — maximal rund 128 Cent je
> betroffenem Anruf.
>
> **BETRIEBLICHE VORBEDINGUNG, ALS OFFENER BEFUND (nicht in dieser Phase abschliessbar).**
> `refundProven` verlangt, dass JEDER Typ aus `COST_TRUING_REQUIRED_RECORD_TYPES` unter
> den zugeordneten Belegen des Calls vorkommt. KV-M1 hat fuer den Inbound-Anker gemessen:
> `sip-trunking` 1, `call-control` 1, `speech-to-text` 5, `text-to-speech` 5, `recording`
> 1, `ai-voice-assistant` 0. Steht `ai-voice-assistant` in der LIVE gesetzten
> Pflicht-Menge, landet jeder Inbound-Call dauerhaft auf `incomplete`, bekommt NIE eine
> Gutschrift und drueckt die Deckungsquote. Der Live-Wert konnte fuer diesen Bericht
> NICHT gelesen werden: `.env.example`/`render.yaml` fuehren ihn leer (leer = FATAL
> Boot-Refusal, `costTruingBookingFindings`, also laeuft live ein anderer, im
> Render-Dashboard gesetzter Wert), ein Render-Werkzeug zum Lesen von Env-Variablen
> existiert nicht (nur Schreiben), und der seit KV-M0 vorgesehene Boot-Banner
> (`costTruingTypesBannerLine`) ist im aktuell deployten Commit noch nicht enthalten
> (Produktion liegt 45 Commits hinter `master`). Ein indirektes Log-Indiz (eine live
> gebuchte NEGATIVE Korrektur auf einem — vor KV-P2 zwangslaeufig outbound — Call, was
> `dataComplete=true` voraussetzt) spricht dafuer, dass `ai-voice-assistant` heute NICHT
> in der Pflicht-Menge steht, ist aber kein Beweis. **Vor dem Deploy dieser Phase ist der
> Wert im Render-Dashboard von Hand zu pruefen**; enthaelt er `ai-voice-assistant`, ist das
> vor dem Deploy als Owner-Entscheidung zu klaeren (kein Code-Fix in dieser Phase). Details:
> `tasks/kv-p3-lastrechnung.md` Abschnitt 8.
>
> **Lastrechnung (TOD 5): kein Blocker.** Der Bruchpunkt-Waechter warnt ab 1441 Anfragen
> je Sweep (`SWEEP_REQUESTS_WARN_THRESHOLD` = 1440, strikt `>`). KV-P3 erhoeht die
> Anfragezahl NICHT: der Belegabruf laeuft genau EINMAL je Provider (nicht je Kandidat),
> die Query kennt keine Call-Referenz, und die Belege eines Inbound-Calls liegen im
> konto-weiten Pool bereits heute — sie werden nur nie zugeordnet. Obergrenze eines
> Sweeps: 6 Belegtypen x 10 Seiten x 2 Versuche x 1 belegfaehiger Provider = 120
> Anfragen, Faktor 12 unter der Schwelle. Vollstaendige Rechnung:
> `tasks/kv-p3-lastrechnung.md`.
>
> **Deckungsquote (N4).** Beendete Inbound-Calls kommen in den Nenner von
> `costTruingCoveragePercent`. Kurzfristig sinkt die Quote (unabgeglichener Bestand,
> `no_estimate`-Altzeilen), nach ein bis zwei Sweeps steigt sie wieder, sofern die
> Zuordnung so gut greift wie an KV-M1 gemessen. Rechne mit
> `coverage_below_threshold`-WARN-Befunden nach dem Deploy — WARN, KEIN Boot-Refusal.
> Die FORMEL bleibt unveraendert; der strukturell zu weite Nenner ist KV-M3.
>
> **Absolute Regel 1 unberuehrt.** Diese Phase macht die Zahl der pro-Tenant-Kostendecke
> GENAUER, sie schwaecht deren Sperrwirkung nicht — die Decke sperrt weiterhin BEIDE
> Richtungen. Die Inbound-Abweisung in `src/routes/voice.js` ist NICHT angefasst (E11
> bleibt zurueckgezogen).
>
> **Unberuehrt:** `src/routes/voice.js`, `metering.js` (Sofortbuchung/Inbound-Satz aus
> KV-P2), der Gutschrift-Riegel gegen Periodengrenzen, die Deckungsquoten-Formel (KV-M3),
> die DID-Miete (KV-P4), der Telnyx-Adapter, `MAX_BUDGET_EUR`, `OUTBOUND_FROZEN`, Abo+KYC
> als Outbound-Permit, Denylist, Land-Gate, Stundenlimit, Signaturpruefung,
> `disclosureSentence`. Keine neue DB-Spalte, kein Backfill, keine neue Route, kein
> `route-policy.js`-Eintrag, kein zweiter Sweep, kein Timer, kein Cron, keine neue
> Dependency, keine neue Env-Variable.
>
> **Kein rueckwirkendes Buchen.** Historische Inbound-Calls ohne persistierte Schaetzung
> landen in `cost_trued_source = 'no_estimate'`, bewegen keinen Cent und werfen nicht
> (Abnahme KV-P3-3). Sie werden NICHT nachtraeglich bebucht.
>
> **Rollback.** `call.direction === "outbound" &&` in `isEndedCall` wieder einsetzen.
> Bereits korrigierte Inbound-Calls bleiben korrekt (`costTruedAt` gesetzt, keine
> Doppelbuchung moeglich — der Riegel ist richtungsblind).

## KV-P2 — Inbound-Carrier-Minuten erreichen die Gate-Achse (2026-08-03, Owner-Entscheidung 1a)

> **Was sich aendert.** `reconcileOutboundVoiceBudget` verliert seinen Richtungsfilter und
> seinen Namen: `reconcileVoiceBudget` (`src/billing/metering.js`) bucht die Ist-Minuten
> eines beendeten Calls BEIDER Richtungen auf die pro-Tenant-Kostendecke
> (`addVoiceUsageCostCents` -> `bookCents` -> `usage.costCents`/`spendMonthCostCents`) und
> persistiert Betrag plus beide Achsen-Anker an der `call`-Zeile. Die Kosten-Landkarte
> (`src/billing/cost-ledger-map.js`) kippt dafuer GENAU EINE Zeile: `voice_minute_inbound`
> von `gate: false` auf `gate: true`.
>
> **Warum.** Bis hierher erreichte von einem eingehenden Anruf KEINE Carrier-Kostenart die
> Gate-Achse, waehrend dieselbe Achse eingehende Anrufe bereits abwies
> (`store.budgetExceeded` in `src/routes/voice.js`). Die Asymmetrie lief in beide falschen
> Richtungen: der Kunde verlor die Funktion, fuer die er zahlt, und die Kosten, die er dabei
> erzeugte, zahlte jemand anders. Die Hermes-Nummer ist oeffentlich waehlbar; die einzige
> Bremse war der KI-Token-Akku.
>
> **Der Satz, mit Zahlen.** `VOICE_TARIFF_INBOUND_CENTS`, Default **6 EUR-Cent je
> angefangener Minute**. Kalibriert an KV-M1 (2026-08-03): ein kontrollierter Inbound-Anruf
> (`call_msczw0irl06s`, 79,6 s = 2 angefangene Minuten) kostete real **1,87 US-Cent je
> angefangener Minute** (3,731 US-Cent gesamt; 71 % speech-to-text, 17 % sip-trunking,
> 11 % call-control, 1,4 % text-to-speech), umgerechnet 1,72 EUR-Cent. 6 traegt damit
> 3,5x Sicherheitsaufschlag ueber dem Ist und liegt 5x unter dem Outbound-Worst-Case (30).
>
> **KONFIGURATIONSGRENZE DER MESSUNG (kein Nebensatz).** Die Zahl gilt AUSSCHLIESSLICH fuer
> die Konfiguration, in der sie erhoben wurde: US-DID, `VOICE_ENGINE=budget`, Sprache `de`,
> ElevenLabs-TTS aktiv, Assistant-Pfad NICHT beteiligt (null `ai-voice-assistant`-Belege),
> EIN Anruf. Fuer eine +49-DID ist der Satz UNGEMESSEN — es existiert derzeit keine
> +49-DID im Bestand. Der teuerste Posten (speech-to-text) skaliert mit der SPRECHZEIT,
> nicht mit der Verbindungsdauer; ein dichtes Gespraech ist teurer als das gemessene.
> Eine zweite Messung an einer +49-DID und eine am Assistant-Pfad stehen aus.
>
> **Fail-Richtung.** Fehlt der Wert oder ist er leer, greift der Code-Fallback 6 — **nie 0**.
> Ein gesetzter, aber unbrauchbarer Wert (Muell, negativ) landet in `fatalConfigErrors` und
> verweigert den Boot (`numEnv`/`assertConfig`). Ein ausdrueckliches `0` schaltet die
> Inbound-Kosten-Achse ab, genau wie `VOICE_TARIFF_DEFAULT_CENTS=0` die Outbound-Achse —
> ein sichtbarer Betreiber-Akt, kein stiller Ausfall.
>
> **Der Live-Zaehler zieht mit (Owner-Entscheidung 3b).** `activeOutboundCallsFor` heisst
> jetzt `activeCallsFor` (`src/store/state-ops.js`) und liefert alle laufenden Legs des
> Tenants. EINE Abfrage, keine zweite Liste. Der Mid-Call-Abbruch ist dadurch KEIN Zuwachs:
> `blockingBudgetAxis` laeuft schon vorher richtungsblind in jeder Schleifenrunde und
> beendet ein Inbound-Gespraech bei erschoepfter Decke ueber `budgetHangupOutcome`. Neu ist
> allein, dass die Pruefung die eigenen, noch ungebuchten Minuten des laufenden Inbound-Legs
> sieht. Keine Doppelzaehlung: `persistEnd()` schreibt den Status vor `bill()` von `active`
> weg (`src/telephony/call-termination.js`).
>
> **Decken-Kalibrierung (Vorbedingung des Merges, TOD 1).** Starter: Decke 1500 ct, 250
> Inbound-Minuten bis zur Sperre, die 30 gekauften Minuten kosten 180 ct = 12 % der Decke.
> Business: 4500 ct, 750 Inbound-Minuten, 120 gekaufte Minuten = 720 ct = 16 %. Ein Kunde
> kann seine gekauften Minuten also vollstaendig eingehend telefonieren; die Decke wurde
> NICHT angehoben und NICHT gesenkt. Vollstaendige Rechnung:
> `tasks/kv-p2-decken-rechnung.md`.
>
> **Absolute Regel 1 unberuehrt.** Diese Phase FUETTERT ein geschuetztes Gate, sie schwaecht
> es nicht. Die Sperrwirkung der pro-Tenant-Decke bleibt unveraendert, inklusive der in
> `CLAUDE.md` festgehaltenen Aussage, dass sie BEIDE Richtungen sperrt. Die
> Inbound-Abweisung in `src/routes/voice.js` ist NICHT angefasst (jede Beruehrung waere die
> Wiederaufnahme der zurueckgezogenen Entscheidung E11 und braeuchte eine schriftliche
> `CLAUDE.md`-Aenderung).
>
> **Unberuehrt:** `cost-truing.js` (der Inbound-Ist-Abgleich ist KV-P3), die DID-Miete
> (KV-P4), SMS, Play-TTS, das Minuten-Kontingent-Gate, Tarif/Marge/Abo-Preis, Denylist,
> Land-Gate, Stundenlimit, Per-Target-Cap, Signaturpruefung, `OUTBOUND_FROZEN`, Abo+KYC als
> Outbound-Permit, `MAX_NUMBERS`, `disclosureSentence`. Keine neue Route, kein
> `route-policy.js`-Eintrag, keine neue DB-Spalte, kein Backfill, keine neue Dependency.
>
> **Kein rueckwirkendes Buchen.** Die zwei historischen Inbound-Calls (2026-07-10 und
> `call_mrntu643cvc2`, 2026-07-16) bleiben ungebucht. Sie tragen im Ledger 300 bzw. 600 ct
> zum alten Worst-Case-Tarif und sind ueber den KV-P0-Stichtag von der Stripe-Meldung
> ausgeschlossen.
>
> **Zwei bewusst getragene Restrisiken.**
> 1. **Der Ist-Abgleich fehlt fuer Inbound noch (TOD 4).** Bis KV-P3 steht die Schaetzung
>    von 6 ct/min gegen ein gemessenes Ist von 1,72 EUR-Cent — der Kunde wird in diesem
>    Fenster um Faktor 3,5 zu hoch belastet. Die Richtung ist bewusst gewaehlt ("im Zweifel
>    teurer"), die Korrektur kommt mit KV-P3.
> 2. **Ein einzelnes sehr langes Inbound-Gespraech zwischen zwei Sweeps.** Zwischen
>    Buchung und Korrektur liegen `COST_TRUING_DELAY_MINUTES` (30) plus ein Sweep-Takt
>    (1 h), also bis zu ~1,5 Stunden, in denen das Gate nur die Schaetzung sieht. Die
>    Exposition eines EINZELNEN Legs ist durch `MAX_CALL_DURATION_CAP_S` (1800 s) hart
>    gedeckelt: hoechstens 30 x 6 = **180 Cent**, bei realen Kosten von rund 52 Cent. Der
>    Live-Term begrenzt es zusaetzlich, seit er Inbound sieht.

## KV-M3 — Deckungsquote misst nur noch belegbare Calls (2026-08-03, Owner-Entscheidung 5a)

> **Was sich aendert.** `costTruingCoveragePercent` (`src/billing/cost-truing.js`) zaehlt im
> Nenner nicht mehr JEDEN beendeten Call, sondern nur noch BELEGBARE: beantwortet, mit
> persistierter buchbarer Schaetzung, beendet innerhalb des Provider-Belegfensters (GEMESSEN
> 7 Tage, `tasks/kosten-inventar.md:546` - existierte vor dieser Phase an KEINER Stelle im
> Code). Die drei ausgeschlossenen Gruppen bekommen eigene, IMMER gedruckte Zaehler in der
> Sweep-Log-Zeile (`ohne_schaetzung=`, `nie_beantwortet=`, `ausserhalb_fenster=`) sowie im
> Sweep-Rueckgabewert (`coverageNoEstimate`, `coverageNeverAnswered`, `coverageOutsideWindow`).
>
> **Warum das eine Sicherheits-relevante Aenderung ist, obwohl kein Sperrpfad angefasst wird.**
> `voiceTariffFloorFindings` (Boot-Guard, WARN, kein exit(1)) haengt an genau dieser Quote:
> `belowFloor && coveragePercent < minCoveragePercent`. Springt die Quote (im Prod-Datenbestand
> laut Plan von 25 % auf 100 %, Nenner 31 -> 8) ueber die Schwelle (80 %), wird `thinCoverage`
> `false`, die Konjunktion `false`, `findings` leer, kein `console.warn` mehr in
> `warnVoiceTariffBelowFullCost`. Kein Code in `boot.js`/`boot-guard.js` wird veraendert - der
> Wirkungsweg laeuft ausschliesslich ueber den geaenderten Rueckgabewert von
> `costTruingCoveragePercent`.
>
> **Owner-Entscheidung 5 (2026-08-03): (a), ja, MIT den drei Nebenzaehlern.** Begruendung:
> eine Warnung, die strukturell nie gruen werden kann (der Nenner enthielt bis zu dieser
> Phase Calls, die NIE einen Beleg haben koennen), ist keine Warnung mehr, sondern Tapete -
> sie trainiert darauf, die Zeile zu ueberlesen. Alternative (b) (Schwelle absenken) haette
> eine Zahl behalten, die etwas anderes misst als ihr Name sagt. Bedingung der Zustimmung:
> die drei Nebenzaehler bleiben SICHTBAR, auch wenn die Quote ueber der Schwelle liegt und
> die WARN selbst nicht feuert - genau dann waere ein Belegausfall sonst am unauffaelligsten.
>
> **Restrisiko, bewusst getragen:** ein spaeter auftretender echter Belegausfall (z. B.
> Adapter-Regression, die Records leise verwirft) druect die Quote weiterhin unter die
> Schwelle und loest die WARN weiterhin aus - DAS bleibt unveraendert scharf. Was sich
> aendert, ist ausschliesslich die Zusammensetzung des Nenners, nicht der Melde-Mechanismus.
> Der monatliche Gegenprobe-Mechanismus (KV-M4, Provider-Rechnung gegen gebuchte Summe) ist
> der strukturelle Schutz gegen einen Belegausfall, der sich NICHT ueber die Coverage-Quote
> zeigt (z. B. wenn er gleichmaessig alle drei Nebenzaehler anhebt, statt die proven-Zahl zu
> senken) - er bleibt unveraendert Teil der Kette.
>
> **Unberuehrt:** die pro-Tenant-Kostendecke, `OUTBOUND_FROZEN`, Signaturpruefung,
> `disclosureSentence`, `COST_TRUING_MIN_COVERAGE_PERCENT` (Schwelle selbst NICHT
> geaendert), der Ist-Abgleich-Mechanismus selbst (Kandidatenauswahl, Delta-Buchung,
> Gate-Achse). Keine neue DB-Spalte, kein Backfill, keine neue Env-Variable (das
> Belegfenster ist eine benannte Code-Konstante, KEIN Env-Hebel - dieselbe Begruendung wie
> `SWEEP_REQUESTS_WARN_THRESHOLD`: ein Wert, den ein Operator herunterdrehen kann, um Calls
> vorzeitig aus dem Nenner zu nehmen, ist die Sicherung, die an ihre eigene Verletzung
> angepasst wird).
>
> **Rollback.** `coverageBucketOf` durch eine Fassung ersetzen, die fuer jeden beendeten Call
> `ELIGIBLE` liefert (= alte Formel). Keine Datenwirkung, reine Log-/WARN-Verhaltensaenderung.

## B4A — Preisstaffel je Token-Sorte + Boot-Abbruch (2026-08-08)

> **Geschlossene Luecke (zwei Haelften):**
> 1. Die Preistabelle kannte GENAU ZWEI Raten (Eingabe/Ausgabe). Alle drei Eingabe-Sorten
>    des Port-Vertrags (`src/llm/ports.js` `LlmTokenUsage`) wurden zur vollen Eingabe-Rate
>    gebucht - bei einem Cache-Treffer um ein Vielfaches zu teuer (Cache-Lesen kostet ein
>    Zehntel der Eingabe-Rate).
> 2. Eine flache Tabelle kann einen TERMINIERTEN Preiswechsel nicht ausdruecken. Fuer
>    `claude-sonnet-5` gibt es keine einzelne Zahl, die heute richtig ist: 2.00/10.00 gilt
>    bis 2026-08-31, 3.00/15.00 ab 2026-09-01. Der Befund war nie "eine Zahl ist falsch".
>
> **Neu:** `MODEL_PRICE_SCHEDULES` (`src/config.js`) haelt je Modell-ID eine Liste von
> Staffeln mit `validFrom`/`asOf`/`source` und VIER Pflicht-Raten (`inPerMTok`,
> `cacheWritePerMTok`, `cacheReadPerMTok`, `outPerMTok`). `resolveModelPrices` loest sie
> GENAU EINMAL, beim Boot, auf den heutigen Kalendertag auf; `config.llm.modelPricesUsd`
> bleibt fuer alle Leser eine flache Abbildung Modell-ID -> Raten. Die Buchungskante bleibt
> zeitfrei (kein `nowIso` in `tokenCostUsd` - das waere eine zweite Uhr an derselben
> Buchung). Die Schreib-Rate ist die 5-MINUTEN-Rate, weil `CACHE_CONTROL_EPHEMERAL`
> (`src/claude.js`) kein `ttl` traegt; ein Gate-Test liest dafuer den Quelltext.
>
> **Boot-Abbruch, Ausloeser ABSCHLIESSEND** (ein Dienst, der nicht startet, nimmt keine
> Anrufe an):
> - `CLAUDE_MODEL` oder `PRECALL_BRIEFING_MODEL` ohne Staffel - letzteres AUCH bei
>   `PRECALL_BRIEFING_ENABLED=false` (unveraendertes Bestandsverhalten der geprueften
>   Liste, nur die Schwere aendert sich); eine datierte Snapshot-ID ist ein anderer
>   Schluessel. `assertPricedModels`, `exit(1)`.
> - Unvollstaendige/formfremde Staffel, kein faelliger `validFrom`, leere Staffel-Tabelle:
>   `resolveModelPrices` wirft beim Modul-Laden von `config.js`. Diese drei sind ueber die
>   Umgebung NICHT erreichbar (nur per Quelltext-Aenderung) - deshalb bewusst ein `throw`
>   an der fruehestmoeglichen Stelle statt eines zweiten Meldekanals.
>
> **Ausdrueckliche NICHT-Ausloeser** (je ein Test): ein ueberzaehliger Tabellen-Eintrag;
> `REALTIME_MODEL` ohne Preis (dieser Pfad bucht keine Token - ein Abbruch waere ein
> Abbruch ohne Schutzwirkung, s. WF-4); eine noch nicht faellige spaetere Staffel; ein
> veraltetes `asOf` (WARN, nie fatal - ein Kalendertag darf die Telefonie nicht lahmlegen).
>
> **Fail-closed geschaerft:** `mostExpensivePrice` ("der teuerste EINTRAG") ist
> `worstCasePrice` geworden - das PUNKTWEISE Maximum jeder der vier Raten ueber alle
> Staffeln. Mit vier Raten und einem zweiten Anbieter kann kein einzelner Eintrag mehr
> garantieren, in jeder Rate der teuerste zu sein; die Obergrenze kann es. Die leere
> Tabelle wirft weiterhin benannt (Preis 0 waere fail-open).
>
> **Kein Store-Eingriff (keine Migration, kein Backfill, keine Schema-Aenderung).** Tragende
> Tatsache, am Code verifiziert: die Gate-Kette (`budgetExceeded` -> `liveBudgetExceeded` ->
> `tenantSpendOrDeny` -> `tenantUsageAxes`) liest ausschliesslich CENT-Achsen
> (`gateUsageCents`, `usageFor(...).costCents`) - kein Token-Zaehler kommt darin vor. Die
> Bucket-Zaehler `usage.inputTokens`/`outputTokens` und `usage_event.quantity` bleiben
> Summen mit IDENTISCHEM Zahlenwert; aufgeschluesselt wird nur die Preisrechnung.
>
> **Akzeptierte Restrisiken:**
> - Der gebuchte Betrag SINKT bei Cache-Treffern (Fixture-Probe: 6975 statt 14880
>   Mikro-Cent, -53 %). Auf der Gate-Achse heisst "weniger" spaeter sperren. Das ist
>   gewollt (der bisherige Betrag war schlicht falsch), aber die unsichere Richtung -
>   deshalb bleibt die Messung an echtem Verkehr (B4b) Pflicht, sobald wieder Verkehr
>   laeuft. Zusaetzliche Deckung unabhaengig davon: Outbound setzt Abo+KYC voraus,
>   `OUTBOUND_FROZEN` bleibt der Notaus.
> - Ein Prozess, der ohne Neustart ueber den 2026-08-31 hinweg laeuft, bucht weiter mit
>   2.00/10.00 - zu wenig. Gegenmassnahmen: die Banner-Zeile `Preisstaffeln:` (gewaehlte +
>   naechste `validFrom`), ein Test auf `todayIso = "2026-09-01"` und die Kalenderzeile in
>   `STATUS.md`.
>
> **Unberuehrt:** die pro-Tenant-Kostendecke (sperrt weiter BEIDE Richtungen, Inbound
> eingeschlossen), `OUTBOUND_FROZEN`, Denylist/Land-Gate/Stundenlimit, Max-Dauer,
> Signaturpruefung, `disclosureSentence`, `usdToEur`, `MAX_BUDGET_EUR`, `src/bridge.js`.
> Keine neue Env-Variable.

## P6 (Werkzeugwahl) — `allowLookup` fuer beide bezahlten Tarife (2026-08-11, Owner-Entscheidung)

**Was sich aendert:** `PAID_PLAN_PROFILE.allowLookup` geht von `false` auf `true`
(`src/plans.js`). Der Vorbehalt aus AL-P10b ("bleibt Owner-Faehigkeit, bis Testanruf und
Datenschutzerklaerung durch sind") ist damit aufgehoben. `starter` und `business` teilen ein
Profil-Objekt — die Freischaltung trifft **beide** Tarife und alle kuenftigen Aktivierungen.
Owner-Entscheidung, bewusst so gewaehlt.

**Warum das nicht als Gate-Aufweichung zaehlt:** `look_up` ist keine Sicherung, sondern eine
Faehigkeit. Kein geschuetztes Gate wird beruehrt — Outbound-Permit (Abo+KYC), `OUTBOUND_FROZEN`,
Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, Max-Gespraechsdauer,
Signaturpruefung und `disclosureSentence` bleiben unveraendert. Inbound ist strukturell
ausgeschlossen (`research/in-call.js` verlangt `direction === "outbound"`).

**Kostenflaeche, gedeckelt:** ~1 Cent je Suche, Deckel `LOOKUP_MAX_PER_CALL = 2` ohne
Env-Knopf, also hoechstens ~2 Cent je Anruf. Gebucht wird **vor** dem Absenden auf genau die
Achse, die die pro-Tenant-Kostendecke liest (`llm-usage.js`) — die Decke sperrt also auch
diesen Verbrauch. Notaus bleibt `LOOKUP_ENABLED=false` (Env, wirkt sofort).

### BEWUSST AKZEPTIERTE RESTFLAECHE: kein Namensfilter in der Suchanfrage

Exa ist ein **zweiter Auftragsverarbeiter**. `sanitizeLookupQuery`
(`src/research/lookup-guard.js`) verwirft Ziffernfolgen ab fuenf Stellen, E-Mails, die
Zielrufnummer und woertliche Transkript-Zitate und kappt auf 120 Zeichen. Es gibt aber
**keinen Namensfilter und keine Schlagwortliste** — ein Personenname kann die Suchanfrage
erreichen. Die Datei dokumentiert diese Restflaeche selbst.

> **Owner-Entscheidung 2026-08-11: so belassen, Risiko notiert.** Ein Namensfilter wurde
> ausdruecklich NICHT zur Vorbedingung der Freischaltung gemacht. Die Datenschutzabwaegung
> traegt der Owner; die Datenschutzerklaerung bleibt offener Punkt und wurde bewusst nicht
> im selben Zug angefasst (Repo-Regel: Rechtstexte nicht auf eigene Faust schreiben).

Was den Dienst erreicht: `{query, type, numResults: 3, contents}` an `api.exa.ai/search`.
Kein Transkript, keine Rufnummer, keine Tenant-IDs. Zurueck kommen hoechstens drei Zeilen
"Titel: Auszug" ohne URL.

**Wenn diese Restflaeche spaeter geschlossen werden soll,** ist der Ort `sanitizeLookupQuery`
— nicht das Plan-Profil.

### Wirksamkeit: der Flip allein tut NICHTS

`resolveProfileFrom` (`src/store/defaults.js`) liest `PLAN_PROFILE` **nie**. Bestehende Tenants
behalten ihr gespeichertes Profil, bis es neu geschrieben wird (`billing/activation.js` bei
Stripe `customer.subscription.created/updated`+active bzw. Self-Service-Subscribe, oder
`scripts/backfill-plan-profiles.js`). Ein Code-Flip ohne diesen Rewrite ist ein Schein-Fix —
und derselbe Vorbehalt gilt fuer den **Rueckweg**: ein Code-Rollback ohne Rewrite ist ebenso
wirkungslos. Der sofort wirksame Notaus ist deshalb `LOOKUP_ENABLED=false`, nicht der Rollback.

**Harte Reihenfolge-Bedingung:** P1 (rekonstruierte `tool_calls` tragen `type:"function"`,
`src/llm/adapters/deepseek.js`) MUSS vorher live sein. Ohne P1 laeuft `look_up` in Runde 2 in
einen HTTP 400 des Anbieters — fuer den Anrufer Stille, und der Fehler sieht aus wie ein
Modellproblem. Beide Aenderungen liegen deshalb auf demselben Branch und gehen zusammen live.

## EL-P5 — der Rueckfragekanal wird von aussen erreichbar (2026-08-17)

**Was sich sicherheitsrelevant geaendert hat**, in einer Zeile: ein Endpunkt, der bisher nur theoretisch
existierte, ist ab dem naechsten Deploy von jedem Punkt im Internet aufrufbar — und der Anbieter, der ihn
rufen soll, kann ihn ab heute auch erreichen.

### 1. Neuer Aussen-Angriffspunkt: `POST /webhooks/elevenlabs/consult`

Der Endpunkt existiert im Code seit dem 15.08. und stand bis heute **ins Leere**: das Werkzeug am
ElevenLabs-Agenten zeigte auf `https://consult-endpoint-not-yet-built.invalid/...` und trug keinen
Auth-Header. Beides ist jetzt gesetzt (URL `https://app.sundartha.com/webhooks/elevenlabs/consult`,
Header `x-hermes-tool-token`).

**Die einzige Sicherung ist ein geteiltes Geheimnis.** Das ist keine Nachlaessigkeit, sondern eine
Anbieter-Grenze: ElevenLabs SIGNIERT Werkzeug-Webhooks nicht (kein HMAC, keine Ed25519 wie bei Telnyx), es
gibt ausschliesslich frei konfigurierbare Request-Header. Was daraus folgt und hier festgehalten wird:

| Eigenschaft | Zustand |
|---|---|
| Vergleich | timing-sicher (`safeEqual`), VOR jeder anderen Verarbeitung |
| leerer `ELEVENLABS_TOOL_TOKEN` | lehnt **jeden** Aufruf ab (fail-closed, nie offen) |
| Ablage des Geheimnisses | `.env` bzw. Render-Env auf unserer Seite; **Workspace-Secret** im ElevenLabs-Konto auf der anderen (`secret_id PAQCzq5QVZtRX8mBscJh`) |
| im Repo | **nur die `secret_id`**, nie der Wert (Absolute Regel 4) |
| Replay | **NICHT geschuetzt** — wer den Header einmal sieht, kann ihn wiederverwenden. Kein Zeitstempel, keine Nonce, keine Signatur. |
| Rotation | nicht gebaut. Wechsel heisst: neues Konto-Secret, `secret_id` im Werkzeug tauschen, Env setzen, neu starten. |

**Was den Schaden begrenzt, wenn das Geheimnis doch abfliesst** — die Reihenfolge der Sicherungen im
Handler ist bindend und jede weitere Stufe ist unabhaengig vom Token:
1. Geheimnis (403) → 2. **Bindung an einen LAUFENDEN Anruf** ueber die opake Anbieter-Kennung (404) →
3. Faehigkeits-Tor `consultAllowedFor` (403) → 4. Geld (402) → 5. Wirkung.
Ohne einen gerade laufenden Anruf ist der Endpunkt mit gueltigem Token **wirkungslos**; er kann keinen Anruf
ausloesen, keine Nummer waehlen, kein Geld bewegen. Am 17.08. gemessen: ohne Header 403, falscher Token 403,
richtiger Token ohne laufenden Anruf 404, richtiger Token mit Muell-Nutzlast 404.
Zusaetzlich deckelt `MAX_IN_CALL_CONSULTS_PER_CALL=1` die Zahl der kostenden Rueckfragen je Anruf.

**Bewusst akzeptiertes Restrisiko:** kein Replay-Schutz, keine Rotation. Beides ist erst dann mehr als
theoretisch, wenn der Endpunkt live ist UND ein Anruf laeuft. Vor dem ersten Fremdkunden gehoert wenigstens
die Rotation gebaut — bis dahin steht sie hier als benannte Luecke.

### 2. Die Uebersteuerungs-Erlaubnisse des Agenten sind ENGER geworden

Am Live-Agenten gepusht (17.08.), `platform_settings.overrides.conversation_config_override`:

| Pfad | vorher | nachher | Wirkung |
|---|---|---|---|
| `conversation.text_only` | **true** | **false** | eine offene Tuer ist zu: ein Sprachanruf liess sich pro Anruf in einen Text-Anruf verwandeln |
| `tts.voice_id` | false | **true** | die Stimme ist pro Anruf setzbar — beabsichtigt, s. Eigentuemer-Entscheidung 16.08. (Weg A) |
| alles Uebrige | false | false | unveraendert |

Die geschuetzte Eigenschaft ("niemand baut den Agenten pro Anruf unbemerkt um") ist damit **staerker**
durchgesetzt als vorher: unser Code lehnt einen Anfragekoerper mit Fremdfeldern fail-closed ab, BEVOR er das
Netz sieht (`convai.js#assertOverrideWhitelisted`), und der Anbieter akzeptiert seit dem Push ohnehin nur
noch zwei Pfade statt drei.

### 3. Der Offenlegungssatz je Sprache — eine Pflichtaussage bekommt einen zweiten Traeger

Bis heute stand der Satz an genau einer Stelle (`agent.first_message`). Ab jetzt tragen ihn zusaetzlich die
`language_presets` fuer `de` und `fr`. **Eine Pflichtaussage an mehr Orten ist erst einmal ein Risiko**, und
so ist es abgesichert:
- Der Wortlaut kommt WOERTLICH aus `src/i18n/locales.js`; ein Test (T5 e) haelt beide Presets byte-identisch
  am Code fest und wird rot, sobald eine Sprache aus `LOCALES` ohne Preset bleibt **oder** ein Preset einen
  Text traegt, den der Code nicht kennt.
- Der Drift-Lauf vergleicht den Wert am Live-Agenten (Besitz-Eintrag `language_presets_offenlegung`).
- Die vom ANBIETER erzeugte Uebersetzung (`first_message_translation.text`) bleibt **verboten** — eine
  Rechtsaussage, die niemand kuratiert hat, darf nicht gesprochen werden.
Die frueher hier wirksame Regel "ein Preset darf den ersten Satz gar nicht setzen" ist damit ERSETZT, nicht
gelockert: ein Anwesenheits-Verbot ist genau dann erfuellt, wenn ein deutscher Angerufener den englischen
Satz hoert — es schuetzt gegen den falschen Satz und laesst den fehlenden durch.

### 4. Der Torzustand des Rueckfragekanals reist als Daten mit

`{{consult_available}}` traegt pro Anruf, ob der Kanal offen ist. Sicherheitsrelevant daran ist nur eins:
der Wert kommt aus **derselben** Torkette (`consultAllowedFor`), die der Webhook fragt, bevor er eine
Rueckfrage annimmt. Zwei Quellen koennten auseinanderlaufen — der Agent saegte dann eine Rueckfrage zu, die
der Webhook ablehnt. Fail-closed an vier unbekannten Zustaenden gemessen; ohne verdrahtetes Tor faellt die
Fabrik auf "nein".

### 5. Was NICHT geaendert wurde

Aufbewahrung (`retention_days = -1`) und Mitschnitt (`record_voice = true`) stehen unveraendert auf dem
Stand der Eigentuemer-Entscheidung vom 15.08. Beide sind im Push-Kommando **gesperrt** (nicht nennbar,
Abbruch vor jedem Netzzugriff) und bleiben im Drift-Lauf sichtbar rot. Der 90-Tage-Riegel an der Ausnahme
erzwingt, dass die Entscheidung nicht unbefristet gruen durchgeht.

## EL-P6 — der Rueckfragekanal am echten Anruf gemessen (2026-08-18)

EL-P5 schloss mit dem Satz "WAS OFFEN BLEIBT: ob ElevenLabs den Header aus dem Konto-Secret wirklich
mitschickt. Das misst nur der Anruf." Der Anruf ist gelaufen (`call_msyexvu3q5r9`,
`conv_3701m0a0fxnzen79mjd8qfcp6k00`). Drei sicherheitsrelevante Ergebnisse.

### 1. Das geteilte Geheimnis TRAEGT — erstmals am echten Aufruf belegt

Der Agent rief `get_consult` zweimal. Beide Aufrufe kamen an und passierten **Schritt 1**; sie starben erst
an Schritt 2 (`grund=kein_laufender_anruf`, nicht `grund=token`). Da die Reihenfolge der Sicherungen bindend
ist, ist damit bewiesen: der Anbieter sendet den Header aus dem Workspace-Secret wirklich mit, und
`safeEqual` gegen `ELEVENLABS_TOOL_TOKEN` gibt ihn frei. Der Anbieter-Datensatz fuehrt ihn als
`headers: {"x-hermes-tool-token":"<REDACTED>"}` — **er protokolliert den Wert nicht**, was fuer uns die
bessere Nachricht ist.

### 2. Die Bindung war GEBROCHEN — und der Grund entwertet die Kettenprobe vom 17.08.

Der Koerper, den ein ElevenLabs-**Webhook**-Werkzeug sendet, live gemessen:
```
{"question": "The workshop is asking for the car's make, model, and year …"}
```
**Kein `conversation_id`, kein `parameters`-Umschlag.** Beides hatte der Handler erwartet; die Annahme
stammte aus `agents/references/client-tools.md`, dem Abschnitt fuer **CLIENT**-Tools.

Sicherheitsrelevant ist daran weniger der Ausfall (fail-closed hat gehalten: der unbindbare Aufruf wurde
mit 404 abgewiesen, es entstand kein Datensatz) als die **Beweislage**: die am 17.08. protokollierte Kette
(403/403/404/404) sah aus wie eine Positiv-Kontrolle und war keine. Fall 3 ("richtiger Token -> 404
kein_laufender_anruf") galt als Beleg "das Geheimnis wurde AKZEPTIERT und der Lauf faellt erst an der
naechsten Sicherung" — er war in Wahrheit derselbe Fehlschlag, den der echte Anruf zeigte, nur mit einem
selbstgeschriebenen Koerper erzeugt. **Eine selbstgebaute Nutzlast beweist die Form eines fremden Vertrags
nicht.** Das gilt ueber diesen Fall hinaus fuer jede Webhook-Absicherung in diesem Repo.

**Reparatur (18.08.):** `payloadQuestion` liest die gemessene flache Form; die Pruefung ist dabei
STRENGER geworden als vorher — der Bestand pruefte nur die Existenz des Umschlags, nie Typ oder Leere von
`question`. Jetzt: kein String / leer / nur Leerraum -> 400 `keine_frage`, kein Consult. Kein Doppelweg
("von hier ODER von da"), die alte Umschlag-Form wird ab sofort ABGELEHNT. Reihenfolge der Sicherungen,
Schritt 2 und die inhaltsfreie Log-Zeile unveraendert. Rotprobe gefahren: alte Lesart zurueckgedreht ->
genau der Positiv-Fall und der Umschlag-Fall werden rot, die reinen Fail-closed-Faelle bleiben gruen (sie
unterscheiden die Leserichtung nicht).

Die Gegenseite — `conversation_id` als Body-Parameter aus `system__conversation_id` — ist
Anbieter-Konfiguration und wird getrennt gesetzt. **Bis dahin ist der Kanal weiterhin wirkungslos**, aber
fail-closed wirkungslos.

### 3. Die Offenlegung ist zur Laufzeit NICHT garantiert (Art. 50 EU AI Act)

Am selben Anruf gemessen:
```
original_message: "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Antonio Fotiadis. …"
message:          "Guten Tag, hier spricht ein KI-Assistent im Auftrag von ..."
interrupted:      true
```
Der Angerufene hat Auftraggeber-Namen und Zusammenfassungs-Hinweis **nie gehoert**. Ausloeser war ein
Phantom-Turn des ASR bei 3 s. Ein Anruf zuvor lief bei identischer Konfiguration vollstaendig durch.

**Absolute Regel 2 sichert den WORTLAUT, nicht die ZUSTELLUNG.** Alle drei bestehenden Sicherungen (Test
gegen `locales.js`, Drift-Lauf, Wert-Vergleich am Preset) pruefen, was gespeichert ist — keine kann das
fangen. Gegenmittel am Anbieter: `disable_first_message_interruptions` (Default false). Dazu stand bis
2026-09-04 `transcribe_on_disabled_interruptions=true`, damit waehrend der Offenlegung Gesagtes nicht
verloren geht; dieser Zusatz ist mit SP1-B auf `false` GEDREHT, weil ueber ihn ein Phantom-Turn der
Erkennung als echter Zug beim Modell ankam und den Anruf in eine fremde Sprache kippte
(`tasks/UEBERGABE-SPRACHDEFEKT.md`). Die Offenlegung selbst ist davon unberuehrt: sie haengt an
`disable_first_message_interruptions`, das unveraendert `true` bleibt.
Maschinell pruefbares Rotsignal je Anruf: `transcript[0].interrupted === true`.

### 4. Nebenbefund: die Vertrauensgrenze haelt gegen einen fremden Proxy

Fuer die Messung lief ein cloudflared-Tunnel auf den lokalen Server. Gegenprobe von aussen:
`GET /healthz` -> 200, `GET /api/state` -> **403**. `isTrustedLocalCaller` verlangt Loopback-Socket UND
kein `X-Forwarded-For`; cloudflared setzt den Header wie jeder Reverse-Proxy. Damit ist die
topologie-basierte Grenze erstmals gegen einen ANDEREN Proxy als Render belegt.

**Offen und vorgemerkt:** die Werkzeug-URL steht derzeit auf der Wegwerf-Tunnel-Adresse. Sie MUSS nach der
Abnahme auf `https://app.sundartha.com/webhooks/elevenlabs/consult` zurueckgedreht werden — eine
trycloudflare-Adresse am Live-Agenten ist ein Endpunkt, den ein Fremder uebernehmen kann, sobald der Tunnel
faellt.

## EL-P7 — der Recherche-Webhook (look_up) am ElevenLabs-Weg (2026-08-19)

Thema B des Owner-Auftrags vom 19.08.: der Agent kann waehrend des Gespraechs
oeffentlich nachschlagbare Fakten beim Suchdienst (Exa) holen. Neuer Endpunkt
`POST /webhooks/elevenlabs/lookup` (src/routes/webhooks-elevenlabs.js), WORTGLEICHE
Bauart wie der Rueckfrage-Webhook EL-P5: gleiches Geheimnis (`x-hermes-tool-token`,
timing-sicher, fail-closed bei leerem Wert), gleiche Bindung (conversation_id ->
laufender Anruf -> Mandant), gleiche Reihenfolge (Geheimnis -> Bindung -> Faehigkeit ->
Geld -> Nutzlast -> Wirkung), Eintrag in src/route-policy.js.

### Die Gates, in dieser Reihenfolge

1. Token 403 (fail-closed, Empty-Secret-Trap gedeckt).
2. Bindung 404 `kein_laufender_anruf` (kein Existenz-Leck).
3. Faehigkeit 404 `kanal_nicht_freigegeben`: Richtung outbound + Master-Schalter
   `LOOKUP_ENABLED` + `EXA_API_KEY` + per-Tenant `allowLookup`
   (research/registry.js#elevenLabsLookupProviderFor — DIESELBE Torkette speist die
   dynamische Variable `{{lookup_available}}` am Anrufstart; kein zweiter Nachbau,
   Lehre BL-2).
4. Geld 402: die pro-Tenant-Kostendecke sperrt auch diesen Weg (Absolute Regel 1).
5. Nutzlast 400 `keine_anfrage` (query flach, wie question beim Consult).
6. Deckel `LOOKUP_MAX_PER_CALL=2` (registry.js, kein Env-Knopf): die naechste Anfrage
   nach dem Deckel antwortet 200/declined mit sprechbarem Text — der Anruf laeuft
   weiter, der Suchdienst wird nicht gerufen.
7. Egress-Filter `sanitizeLookupQuery` (dieselbe eine Quelle wie der Budget-Weg):
   Ziffernfolgen, E-Mail, Rufnummer des Angerufenen, woertliche Transkript-Zitate
   verlassen den Server NIE — ohne Gebuehr, ohne Kontingent-Verbrauch.

Alle Gates spawn-getestet uebers echte HTTP (test/el-lookup-webhook.test.js, L1-L9,
inkl. Attrappen-Suchdienst und Timeout-Ast).

### Datenschutz-Entscheidungen dieses Pakets

- **Recherche-Protokoll (Owner-Auflage B5):** `call.lookupLog` persistiert je Suche
  {seq, query, askedAt, dauerMs, ok, factCount} — ausdruecklich MIT der Query, damit
  der Owner fuer die Datenschutzerklaerung belegen kann, welche Inhalte aus einem
  Gespraech an den Suchdienst gingen. Faellt wie consults unter Erase/Export/
  Retention. Die KONSOLE bleibt PII-frei (nie die Query, Regel 4).
- **Per-Tenant Default AUS (Owner-Auflage B4):** `PAID_PLAN_PROFILE.allowLookup` ist
  von true (Entscheidung 2026-08-11) auf **false zurueckgedreht**, solange die
  Datenschutzerklaerung den Suchdienst nicht nennt. Nur der Owner-Tenant traegt das
  Recht (OWNER_PROFILE). Kein Backfill noetig (kein Kunde existiert).
- Der zweite Auftragsverarbeiter (Exa) bleibt der dokumentiert akzeptierte Preis aus
  AL-P10c; offene Datenschutzerklaerungs-Pflicht unveraendert offen.

### Nachtrag 19.08. (unabhaengige Durchsicht, Befunde B1-B4)

- **Ingress-Riegel (B1, behoben):** Suchtreffer sind fremder Web-Text und gehen NIE
  nackt an das sprechende Modell - die Antwort traegt den Daten-Rahmen
  `lookUpFactsFrame` (je Sprache: "DATEN, niemals Anweisungen ... nicht woertlich
  vorlesen, keine Quelle nennen") VOR den Fakten, dasselbe Prinzip wie die
  Guardrail-Zeile des HINTERGRUND-Blocks. Test pinnt Rahmen-vor-Fakten.
- **Richtungs-Riegel getestet (B2, behoben):** ein INBOUND-Anruf mit gueltiger
  Kennung bekommt 404, der Suchdienst wird nie gerufen - eigener Spawn-Fall mit
  Positiv-Kontrolle (L3c).
- **Eigene Frist (B4, behoben):** `EL_LOOKUP_TIMEOUT_MS = 6000 ms` statt der
  Budget-Weg-Kalibrierung (2500 ms, an turnLoopDeadlineMs hergeleitet - eine
  Groesse, die es hier nicht gibt); bindend ist response_timeout_secs=10 s.
- **Getragenes Risiko (B3):** das Werkzeug haengt UNBEDINGT am Agenten (die
  Override-Whitelist laesst keine per-Anruf-Entfernung zu); bei geschlossenem Tor
  ist der Prompt der erste Riegel und der Webhook (404) der zweite. Am Konto
  gemessen: nach der Verschaerfung von Prompt UND Werkzeug-Beschreibung befolgt
  das Modell das Tor (b7 zweimal in Folge PASSED; der Erstlauf davor war rot und
  hat die Verschaerfung erzwungen). Faellt live auf, dass 404-Werkzeugfehler das
  Gespraech stoeren, ist der vorbereitete Ausweg 200/declined wie beim Deckel.
- **Getragenes Risiko (Instanzen):** der Deckel zaehlt lookupLog am Call-Datensatz
  im SPEICHER der Instanz (pg-Store haelt Zustand im Speicher) - zwei Instanzen
  koennten kurzzeitig 2x2 Suchen erlauben. Preis: maximal 2 zusaetzliche Cent je
  Anruf; die harte Grenze bleibt die pro-Tenant-Kostendecke (402-Gate hier).

### Bewusste Abweichungen vom Consult-Muster, je ein Satz

- Deckel und Egress antworten 200/declined statt 4xx: ein Werkzeug-FEHLER liesse den
  Anbieter-Agenten mitten im bezahlten Gespraech stocken; der sprechbare Text ist das
  Muster des Budget-Wegs (performLookupRequest) und laesst ihn weiterreden (B2/B3).
- `response_timeout_secs=10` statt 60: serverseitig deckelt `LOOKUP_TIMEOUT_MS=2500 ms`
  die Suche; am anderen Ende wartet kein Mensch.
- Kein Slot-Halter (consultSlots): der Aufruf haelt keine 47-s-Rueckfrage offen,
  sondern antwortet binnen ~3 s; die Gleichzeitigkeit deckelt der Deckel je Anruf.

## OUTBOUND-E2 — Anbieter-Fehlergrund am Datensatz, PII-frei by construction (2026-08-28)

Der Anbieter-Fehler (`metadata.error.reason`) ist FREITEXT und kann Rufnummern tragen
("Invalid destination number ..."). Er wird deshalb WEDER gespeichert NOCH geloggt. Was den
Klassifizierer verlaesst, ist ausschliesslich ein Token aus geschlossener Menge:
`<basis>:<quelle>-<code>[-<carrier>]` mit basis ∈ {not-placed, unreachable, result-unknown,
…}, quelle ∈ {start, invite, provider, poll}, code = validierte 3-stellige Ganzzahl,
carrier = Treffer von /\bD\d{2}\b/. Dasselbe Sicherheitsniveau wie `safeCauseToken`
(adapters/telnyx/webhook-events.js). Gepinnt durch den PII-Fall in
test/fehlergrund-vokabular.test.js (Grundtext mit eingebetteter fiktiver Rufnummer ->
Token traegt keine Ziffer daraus, Form-Regex).

Wer den Volltext braucht, holt ihn per Anbieter-Abfrage ueber die bereits gespeicherte
Gespraechs-Kennung — Forensik auf Anfrage statt Dauer-Speicherung von Fremdtext.

Unberuehrt: alle Safety-Gates, `disclosureSentence`, `calleeIsOwner`, Provider-
Signaturpruefung, Auth. Der Call-Status bleibt `failed` (kein neuer Status). Die
Kostenbuchung ist unveraendert und per Test gepinnt (Anker + gebuchte Minuten an derselben
Fixture, inkl. Anbieterfehler bei Dauer > 0).

## OUTBOUND-E4 — der ANI-Riegel: neues Gate-Glied, Default AUS (2026-08-28)

Neues Glied in der Outbound-Gate-Kette (`src/telephony/outbound-gates.js`, Name
`ani_ownership`, Position: direkt hinter `resolve_outbound`, vor `budget`). Es lehnt einen
Outbound-Call mit 503 ab, wenn der Drift-Waechter (E-6, F4) eine FRISCHE, LIVE
nachgemessene `ownership_lost`-Messung fuer die Plattform-Absendernummer haelt — der
27.08.2026-Fall (die ANI gehoerte dem Telnyx-Konto nicht mehr, vier Outbound-Versuche
scheiterten unbemerkt).

**Default `OUTBOUND_ANI_GATE_ENABLED=false` — bewusst.** Der Drift-Waechter selbst laeuft
unabhaengig davon bereits scharf (Boot + Stundentakt + externer GitHub-Actions-Workflow)
und meldet jeden Fund ueber den bestehenden Betreiber-Meldeweg (WARN→Audit→Mail→SMS). Das
Gate ist eine ZUSAETZLICHE, optionale Verschaerfung, die echte Anrufe verhindern KANN — und
genau deshalb ist ein falsch-positiver Auslöser hier teurer als ein spät erkannter
Ausfall: ein Gate, das faelschlich auslöst, schaltet das Produkt fuer den Auftraggeber ab
(PM-2), waehrend eine Meldung ohne Gate ihn nur informiert.

**Drei unabhaengige Schutzschichten gegen einen Fehlalarm, alle muessen gleichzeitig
zutreffen:**
1. Frische-Grenze (`OUTBOUND_ANI_GATE_MAX_AGE_MS`, Default 15 min) — eine alte Messung
   gated nie (auf `plan:free` steht der Prozess still; eine stundenalte Messung darf nicht
   ablehnen, obwohl der Eigentuemer laengst eine neue DID gekauft hat). Review-Blocker
   2026-08-29 (Runde 2, Folge des Blocker-3-Fixes/Mail-Entprellung): eine erste Fassung
   liess `marker.lastSeenAt` genau dann einfrieren, wenn der VOLLE Meldeweg wegen der
   Versand-Entprellung (`OUTAGE_ALERT_DEBOUNCE_MS`, Default 6h) ausgesetzt war — die
   Frische-Grenze haette einen 27.08.-artigen, mehrtaegigen Ausfall dadurch nur rund 15
   von 360 Minuten je Entprellungszyklus scharf gesehen statt durchgehend. Fix: der
   Drift-Waechter (`outbound-drift-watch.js#laufeDrift`) beansprucht den Marker
   (`lastSeenAt`) bei JEDEM Lauf unabhaengig vom Versand — entprellt wird NUR Mail/SMS,
   nie die Messfrische selbst (per Test gepinnt, `test/outbound-drift-watch.test.js`
   W-6b).
2. Eine LIVE-Nachmessung (derselbe GET wie Pruefung 3 des Waechters, eigener kurzer
   Timeout) MUSS den Verlust im Moment des Anrufs BESTAETIGEN — eine durable, aber
   inzwischen behobene Messung gated nicht. Die Nachmessung zielt IMMER auf die
   **Plattform-ANI** (`config.provisioning.platformAniE164`, dieselbe Nummer, die
   Pruefung 3 des Waechters misst) — NICHT auf `ctx.fromNumber` (die aktive DID des
   ANRUFENDEN Tenants). Review-Blocker 2026-08-29: eine erste Fassung mass versehentlich
   die Tenant-DID nach, wodurch der Riegel im echten 27.08.-Fall inert gewesen waere (die
   Tenant-DID gehoerte dem Konto weiterhin) — per Test byte-genau gepinnt
   (`test/outbound-ani-gate.test.js` G-2b).
3. Fail-open bei jeder Unsicherheit: keine Messung, unbekannt, ein werfender Recheck
   (Timeout/Netzfehler, im Gate selbst per try/catch abgefangen — nicht nur in der
   server.js-Wiring-Disziplin) — jeder dieser Faelle laesst den Anruf durch, NIE ab.

`OUTBOUND_FROZEN` wird von keinem Codepfad dieser Etappe automatisch gesetzt (per Test
gepinnt, `test/outbound-ani-gate.test.js` G-5) — der bewusste Notaus bleibt beim
Eigentuemer, kein Selbstabschalter.

**Rueckbau: eine Env-Zeile** (`OUTBOUND_ANI_GATE_ENABLED=false`, ohnehin der Default) —
das Gate verschwindet, der Drift-Waechter meldet unveraendert weiter.

## OUTBOUND-E5 — je Tenant-DID eine eigene ElevenLabs-Nummernregistrierung (2026-08-29)

**Der Datenschutz-Grund der Etappe:** bis zum 12.08.2026 sendete jeder Outbound-Anruf die
DID des anrufenden Tenants als Absender (Telnyx-Zweige, unveraendert). Seit dem Umstieg
auf den ElevenLabs-Weg (19.08.) traegt `startCallBody` (`elevenlabs/outbound.js`) nur noch
`agent_id`/`agent_phone_number_id`/`to_number` — die gesendete Absendernummer haengt
ausschliesslich an EINER global registrierten ElevenLabs-SIP-Nummer, fuer ALLE Tenants
gleich. Ein Angerufener, der zurueckruft, landete damit ueber
`store.numberRecordByE164(to)` beim BESITZER dieser geteilten Nummer — nicht beim
anrufenden Tenant. Bei einem echten Kunden waere das ein Datenschutz-Vorfall (fremde
Rueckrufe landen im falschen Assistenten). Befund + Herleitung:
`tasks/befund-outbound-ausfall-2026-08-27.md` Abschnitt 3 (F3) und Abschnitt 5.

**Der erste Anbieter-SCHREIBZUGRIFF dieser Etappe ausserhalb des Nummernkaufs:** das
Anlegen einer ElevenLabs-SIP-Trunk-Nummernregistrierung (`POST /v1/convai/phone-numbers`,
`src/elevenlabs/convai.js#createPhoneNumber`) je aktiver Tenant-DID. Bislang schrieb dieses
Repo beim Anbieter ausschliesslich Telnyx-Nummernkaeufe; dies ist der erste Schreibzugriff
gegen die ElevenLabs-API (bisher nur GET/POST-Anrufstart/DELETE-Beende-Versuch, alles
Bestandsverhalten).

**Dreifach-Gate, alle drei muessen gleichzeitig zutreffen** (`worker/
provisioning-orchestrator.js#runProvisioningDrain`):
1. `PROVISIONING_ENABLED` — derselbe Schalter wie der Telnyx-Nummernkauf.
2. `ELEVENLABS_OUTBOUND_ENABLED` — ohne aktiven EL-Weg waere eine Registrierung zwecklos.
3. `ELEVENLABS_NUMBER_REGISTRATION_ENABLED` — Default **AUS**, EIGENER Schalter. Der Merge
   ist damit inert: ohne diesen dritten Schalter entsteht KEINE einzige neue Registrierung,
   unabhaengig davon, wie die beiden anderen Flags stehen.

**Neues Secret: `TELNYX_SIP_TRUNK_PASSWORD`.** Digest-Passwort der SIP-Trunk-FQDN-Connection
(`fqdn_authentication_method: "credential-authentication"`, gemessen 2026-08-29), reist als
`outbound_trunk_config.credentials.password` im Anlege-Koerper. Nie geloggt, nie in einer
API-/MCP-Antwort, nie in einem Fehlertext (Regel 4) — per Test gepinnt
(`test/absender-registrierung-anlegen.test.js` C6).

**Fail-closed bei fehlenden Zugangsdaten (Review-Blocker Runde 1, Blocker 1/2/G4):** das
Dreifach-Gate im Orchestrator prueft NUR PROVISIONING_ENABLED/ELEVENLABS_OUTBOUND_ENABLED/
ELEVENLABS_NUMBER_REGISTRATION_ENABLED — nicht ob apiKey/agentId/SIP-Zugangsdaten gesetzt
sind. Die Pruefung sitzt deshalb in `makeElSipRegistrar#ensureRegistration`
(`elevenlabs/nummern-registrierung.js`) selbst und wirft VOR jedem Netzzugriff, wenn
ELEVENLABS_API_KEY, der Agent oder TELNYX_SIP_TRUNK_USERNAME/-PASSWORD fehlen. Damit greift
sie fuer JEDEN Aufrufer (Orchestrator wie den CLI-Reparaturlauf), nicht nur einen — und es
entsteht KEINE Registrierung mit leeren `credentials`/`agent_id`.

**Idempotent, fehlertolerant:** zwei eigene Schloesser statt einer unbelegten
Anbieter-Garantie — Schloss 1 (Zustand): eine Nummer mit bereits gesetzter Kennung loest
keinen Anbieter-Aufruf aus. Schloss 2 (Wiederanlauf): existiert die e164 bereits beim
Anbieter (GET-Liste), wird ihre Kennung uebernommen statt neu angelegt. Ein Fehlschlag
(z.B. Anbieter-5xx) reisst die Nummern-Provisionierung NICHT — die DID bleibt `active` und
nutzbar (faellt LAUT auf die globale Rueckfall-Registrierung zurueck), die Registrierung
wird ueber den Reparaturlauf nachholbar (`npm run elevenlabs:nummern`).

**Waisen-Risiko, VERDRAHTET (Review-Blocker Runde 3 / E5-01 — zweite Korrektur dieses
Abschnitts):** `release-reconcile.js#performNumberRelease` nimmt einen `sipRegistrar`-
Parameter entgegen und loest bei gesetzter Kennung fail-soft einen EL-Loeschversuch
(`DELETE /v1/convai/phone-numbers/{id}`) aus. Eine fruehere Fassung dieses Abschnitts
behauptete, KEIN Produktions-Aufrufer reiche ihn durch — das stimmte fuer Runde 1, ist aber
seit Runde 3 (E5-01) UEBERHOLT und war am HEAD dieser Etappe bereits falsch (Doku-an-Code-
Pflicht, E4-Lehre 2, hier ein zweites Mal verletzt). Die gemeinsame Konstruktions-Naht
`sipRegistrarWennAktiv(config)` (`src/elevenlabs/nummern-registrierung.js:100`) wird jetzt
tatsaechlich injiziert: `wiring/web-login.js` (Zeilen 191/218/357/375, sowohl der
Grace-Reconcile- als auch der sofortige Erase-Pfad) UND `billing/webhook.js` (:276/:424) ->
`billing/contract-end-cleanup.js#attemptContractEndCleanup` (:82/:93/:125/:136) reichen den
Registrar durch. Belegt durch `test/e5-01-sipregistrar-produktionspfad.test.js` (6 Tests,
darunter eine Positiv-Kontrolle "ohne Registrar -> 0 EL-Aufrufe, byte-identisch zum
Bestand"), selbst nachgefahren: `node --test test/e5-01-sipregistrar-produktionspfad.test.js`
-> `pass 6 fail 0`.

**Ehrlicher Restpunkt:** `removeRegistration` (`makeElSipRegistrar`) ist wie der gesamte
EL-Loeschpfad bewusst FAIL-SOFT (`src/elevenlabs/convai.js#fireAndForgetDelete` wirft nie,
Owner-Auftrag 15.08.2026) — ein Anbieter-5xx, ein Timeout oder eine 4xx-Ablehnung beim
DELETE hinterlaesst weiterhin eine Waise beim Anbieter, jetzt aber nur noch als Fehlschlag-
Fall (nicht mehr strukturell, da der Aufruf nie ausgeloest wurde). Das ist Absicht (eine
haengende ElevenLabs-API darf eine Kuendigung/Art.-17-Loeschung nicht blockieren) und bleibt
auffindbar ueber denselben manuellen Pruefmodus (`npm run elevenlabs:nummern -- --pruefen`),
nie automatisch aufgeraeumt.

**Was NICHT in diesem Merge ausgefuehrt wurde:** kein einziger echter Anbieter-Schreibzugriff
(Tests laufen ausschliesslich gegen lokale Attrappen). Der Telnyx-ANI-Override
(`ani_override_type: "always"` auf der SIP-Trunk-Connection) ueberschreibt bis zum
Owner-Cutover weiterhin JEDE gesendete Absendernummer — der neue Code ist bis dahin korrekt
und folgenlos, wirkt aber ohne weitere Code-Aenderung, sobald der Cutover gefahren ist
(`docs/RUNBOOK-OUTBOUND.md`, Abschnitt "ANI-Cutover und Nummern-Registrierung").

## Owner-Entscheidung 2026-08-19: Prod-DB-IP-Allowlist auf 0.0.0.0/0

Die Render-Postgres-Allowlist (hermes-db) stand auf einzelnen Heim-IPs; die
Heim-IP wechselt dynamisch, jede Session brauchte einen Dashboard-Handgriff.
Der Owner hat die Liste am 2026-08-19 SELBST (per eigenem API-Aufruf) auf
`0.0.0.0/0` gestellt. Bewusst akzeptiertes Risiko: die DB ist aus dem ganzen
Internet erreichbar; verbleibender Schutz ist TLS-Pflicht + das lange
Zufallspasswort (Render-generiert) - bei geleaktem Passwort gibt es keine
zweite Huerde mehr. Gegenmassnahme bei Verdacht: Passwort-Rotation im
Render-Dashboard. Der Render-API-Key fuer solche Infra-Handgriffe liegt lokal
in `~/.config/hermes/render-api-key` (nie committen, nie loggen).

## Offen (Launch-Blocker): Besitz-Verifikation der eigenen Nummer

Seit der Owner-Entscheidung 2026-08-20 (OC, s. CLAUDE.md Regel 2) entscheidet
`tenant.privateNumber` darueber, ob der volle Offenlegungssatz gesprochen wird. Das Feld
ist Format- und land-validiert (`normalizePrivateNumber`, `src/store/state-ops.js:2127`),
aber NICHT eigentums-verifiziert, und es ist ueber
`POST /api/self-service/private-number` von JEDEM eingeloggten Tenant setzbar
(`src/self-service-routes.js:401`, nur `webAuthMw`). Wer eine fremde Nummer eintraegt,
erhielte einen KI-Anruf ohne den vollen Offenlegungssatz an einen Dritten (Artikel 50 EU
AI Act, Bussgeld bis 15 Mio. EUR).

Heute verhindert das die Tenant-Allowlist `OWNER_SELF_CALL_TENANT_IDS` (Default leer):
nur ausdruecklich gepinnte Tenants loesen die Ausnahme aus. Das ist eine
Betriebsdisziplin-Schranke, KEINE Verifikation — sie skaliert nicht ueber unsere eigenen
Accounts hinaus.

Akzeptiert AUSSCHLIESSLICH vor dem Launch, solange in der Allowlist ausschliesslich
Accounts stehen, die uns gehoeren.

Bedingung fuer den Launch, alternativ:
(a) Besitz-Verifikation gebaut (Bestaetigungscode an genau diese Nummer, Zeitstempel am
    Tenant, Praedikat haengt daran, Aenderung setzt zurueck), ODER
(b) `OWNER_SELF_CALL_ENABLED=false` — die Ausnahme ist dann wirkungslos und der
    Offenlegungssatz gilt wieder ausnahmslos.

Ein Eintrag eines fremden Accounts in `OWNER_SELF_CALL_TENANT_IDS` vor (a) ist selbst die
Rechtsverletzung, gegen die dieser Eintrag steht. Ein Schliessen dieses Eintrags ohne (a)
oder (b) ebenfalls — es ist kein Aufraeumen.

Unberuehrt davon bleibt die KI-Kennzeichnung: auch im Ausnahmefall nennt die Eroeffnung
die Maschine ("hier ist dein KI-Assistent"), und der Prompt verpflichtet den Agenten, den
vollen Offenlegungssatz sofort nachzuholen, wenn am Apparat nicht der Auftraggeber ist.

## SEC-TEST — Sicherheits-Testplan + drei bewusst getragene Risiken (2026-09-07)

`PLAN-SICHERHEITSTEST.md` (Repo-Wurzel) ist der vollstaendige Sicherheits-Testplan:
15 Angriffspfade, 54 pruefbare Faelle, Wellen W0-W5. Er ersetzt diesen Eintrag nicht,
sondern speist ihn: was dort als Risiko akzeptiert wird, steht hier.

Drei Owner-Entscheidungen vom 07.09.2026 (Herleitung: `PLAN-SICHERHEITSTEST.md` 8.4/8.5)
sind bewusst getragene Risiken und KEINE offenen Aufgaben:

**(1) Der SMS-Weg der unverifizierten eigenen Nummer bleibt vorerst ohne Allowlist.**
Neuer Befund, vom Eintrag "Offen (Launch-Blocker): Besitz-Verifikation der eigenen Nummer"
NICHT gedeckt: jener Eintrag sichert den ANRUF-Weg (`OWNER_SELF_CALL_ENABLED` Default false
plus Tenant-Allowlist, `src/callee-is-owner.js`). Der SMS-Weg hat keine solche Bindung -
`setPrivateNumber` (`src/store/state-ops.js:2471`) prueft nur E.164-Form, Denylist und
Laendercode, und die Summary-SMS nach jedem Inbound-Call geht an genau diesen Wert
(`src/sms-summary.js:26`). Jeder eingeloggte Tenant kann dort eine fremde Nummer eintragen
(`src/self-service-routes.js:401`, nur `webAuthMw`) und erhaelt damit Zusammenfassungen von
Gespraechen Dritter an eine Nummer, die ihm nicht gehoert.
Warum trotzdem akzeptiert: alle aktiven Accounts sind wir selbst (siehe unten).
**Ausloeser, der das Risiko zum Befund macht: der erste Fremdkunde.** Bis dahin ist die
Gegenmassnahme klein (dieselbe Allowlist wie am Anruf-Weg), danach ist sie Pflicht -
zusammen mit der Besitz-Verifikation aus dem Eintrag darueber.

**(2) Der Repo-Split bleibt: Render deployt aus `jonas986/vodafone-agent` (Upstream), nicht
aus `origin`.** Es gibt kein belegtes Merge-Gate und keine geprueften Zugriffsrechte auf
diesem Konto; die in `.github/workflows/ci.yml:8` genannte `docs/RUNBOOK-BRANCH-PROTECTION.md`
existiert im Repo nicht. Wer dort schreiben kann, deployt an jeder Pruefung vorbei.
Warum trotzdem akzeptiert: Owner-Entscheidung, Aufwand einer Konsolidierung ueberwiegt
heute den Nutzen. Konsequenz, die mitgetragen wird: jede Aussage ueber den
PRODUKTIONS-Stand ist nur so belastbar wie der Zugriffsschutz dieses Kontos. Die Messung
(MFA-Status, Schreibrechte, Branch-Protection) laeuft trotzdem und ist read-only.

**(3) Kein externer Pentest, kein Bug-Bounty.** Die Ausfuehrung des Testplans uebernimmt der
Assistent. Bewusst mitgetragen: der Pruefende teilt die blinden Flecken des Geprueften -
der Plan ist aus derselben Code-Lektuere entstanden, gegen die er prueft. `security.txt`/VDP
wird unabhaengig davon angelegt (0 EUR, legaler Meldeweg).

**Die gemeinsame Sicherungsannahme aller drei Punkte** ist die Praemisse aus
`PLAN-SICHERHEITSTEST.md` 1.1: **alle aktiven Accounts sind wir selbst.** Sie ist ab hier
kein Kontext mehr, sondern eine tragende Annahme - faellt sie, fallen (1) und (2) sofort
mit, ohne dass eine Code-Aenderung noetig waere.

### Messstand des Testplans (Laeufe 1+2, 2026-09-08)

Belege: `tasks/sicherheitstest-befunde.md`. Die Funde unten sind **noch keine akzeptierten
Risiken** - ob und was gefixt wird, entscheidet der Owner separat. Sie stehen hier, damit
Sicherheitsarbeit sie nicht uebersieht.

- **REPLAY-02 (Geld, schwerster neuer Fund):** ein byte-identisch wiederholter
  `/voice/turn`-Webhook (EIN Body, EIN Zeitstempel, EINE Signatur) loest eine ZWEITE
  Modellrunde aus und bucht ein zweites Mal - gemessen 828 -> 1656 Cent auf genau der Achse,
  die `budgetExceeded` als Tenant-Decke liest; das Transkript verdoppelt sich (2 -> 4 Zeilen).
  Kein Angreifer noetig: ein Anbieter-Retry nach Timeout genuegt. Das Gegenstueck
  `/voice/status` ist ueber den persistierten `billedAt`-Marker sauber idempotent
  (`src/telephony/call-finish.js:258-266`) - die Luecke liegt allein auf der KI-Token-Achse.
- **Gate-Kette im Fehlerfall (GATE-02):** stirbt die Datenquelle eines Outbound-Gates, wird
  in **17 von 17** gemessenen Faellen NICHT gewaehlt und kein Anruf-Datensatz angelegt - das
  Sicherheitsversprechen haelt. Aber 14 der 17 Faelle enden ohne jede Antwort (der Request
  haengt bis zum Client-Timeout, `[guard] unhandledRejection` im Log), weil Express 4
  async-Rejections nicht faengt und die Gate-Schleife (`src/routes/api-calls.js:331-341`)
  keinen try/catch hat. `/voice/incoming` hat genau diesen Schutz (`src/routes/voice.js:279`).
- **`scripts/spike2-anruf.mjs`** loest einen echten Anruf direkt beim Anbieter aus und laeuft
  dabei an der GESAMTEN Gate-Kette vorbei (keine Denylist, kein Land-Gate, keine Kostendecke,
  kein `OUTBOUND_FROZEN`). Committet, Ziel aus `argv`, Schluessel aus `.env`. Verstaerkt (2).
- **Gehalten und belegt:** Inbound-Kostendecke sperrt bei korrupter UND werfender Datenquelle
  fail-closed (GATE-03); je Wahlweg genau ein Aufrufer, alle hinter der Kette (GATE-01);
  Routen-Fuzzing und Pfad-Traversal finden nichts (L-03); Render-Logs werden ~7 Tage
  aufbewahrt, was das Zeitfenster einer versehentlich geloggten PII-Zeile begrenzt (OPS-03).

## SEC-P1 — Webhook-Idempotenz: Anker, Vorhaltezeit, Restrisiken (2026-09-08)

Ausgang (gemessen, `PLAN-SEC-FIX.md` § SEC-P1): ein byte-identischer, gueltig signierter
Request, zweimal zugestellt, erzeugte auf `/voice/incoming` ZWEI Anruf-Datensaetze
(REPLAY-01) und auf `/voice/turn` eine ZWEITE Modellrunde (REPLAY-02: Token 4M/1M ->
8M/2M, 828 -> 1656 Cent, Transkript 2 -> 4 Zeilen). `/voice/status` war bereits gedeckt
(persistierter `billedAt`-Marker).

Vor beiden Routen haengt jetzt ein Wiederholungs-Riegel
(`src/telephony/webhook-idempotenz.js`), registriert PRO ROUTE und damit strukturell
HINTER der Ed25519-Signatur-MW: ein unsignierter Request kann keinen Anker beanspruchen.
**Kein Safety-Gate wird beruehrt** — der Riegel fuegt hinzu, er nimmt nichts weg, und er
VERWIRFT NIE (ein Anbieter-Retry ist legitim und bekommt 200, kein 4xx).

### Woraus der Anker gebildet wird

| Route | Anker | Warum |
|---|---|---|
| `/voice/incoming` | `in:<CallSid>` — der Anruf-Datensatz SELBST ist der persistierte Anker (`createCall` legt `twilioSid` an, `getCall` matcht darauf) | Telnyx liefert genau EIN "a call comes in"-Ereignis je Leg. Kein neues Feld noetig; das ist die `billedAt`-Bauart, nur dass der Marker schon existiert |
| `/voice/turn` | ZWEI Anker: **A** `t:<turnToken>` (frische Marke, die WIR je gerendertem Gather in die Action-/Redirect-URL setzen und die der Anbieter zurueckreicht) und **B** `e:sha256(telnyx-timestamp \| rawBody)` (Fingerabdruck des SIGNIERTEN Umschlags) | Der TeXML-Gather-Callback traegt KEIN anbieterseitiges Ereignis-Merkmal. `CallSid` allein waere der teuerste Fehler: die zweite Runde desselben Anrufs saehe wie ein Duplikat aus, der Agent verstummte |

Duplikat = **einer** der beiden Anker ist bereits beansprucht. Vollstaendigkeit:

| Fall | A | B | Ergebnis |
|---|---|---|---|
| Anbieter-Retry, gleiche URL, gleiche Signatur | Treffer | Treffer | Wiederholung |
| Anbieter-Retry, gleiche URL, NEU signiert | Treffer | frei | Wiederholung |
| Angreifer, byte-identisch, Marke gestrichen/geraten | frei | Treffer | Wiederholung |
| Echte 2. Runde, Anrufer sagt WORTGLEICH dasselbe | frei (neuer Gather = neue Marke) | frei (neue Sekunde -> neuer Fingerabdruck) | normal verarbeitet |

Die Marke wird beim EINTREFFEN beansprucht, nicht beim Rendern — eine wiederholt
ausgelieferte Antwort traegt deshalb eine Marke, die noch niemand eingeloest hat, und die
naechste echte Runde kommt durch (kein Livelock).

### Was eine Wiederholung als Antwort bekommt

- Prozess-Cache getroffen -> die erste Antwort **byte-identisch** (Status/Content-Type/Body).
- Erste Zustellung laeuft noch -> die Wiederholung WARTET auf sie (Deckel
  `PROVIDER_WEBHOOK_HARDCUT_MS`) und liefert sie aus.
- Nur der persistierte Anker getroffen (Prozess-Neustart) -> Folge-Gather OHNE Prompt:
  Mikrofon offen, frische Marke, **keine Modellrunde, keine Synthese, kein Cent**.
- Gar keine Antwort erzeugt (Absturz) -> die Wiederholung laeuft normal durch; es wurde
  nichts doppelt gebucht, und der Anrufer braucht eine Antwort.

### Vorhaltezeit

| Schicht | Inhalt | Wie es verschwindet |
|---|---|---|
| Prozess-Cache (`Map` im Abschluss der Fabrik) | Anker -> Antwort | LRU-Deckel `ANSWER_CACHE_MAX` (200); aelteste Eintraege fallen raus; stirbt mit dem Prozess |
| Persistiert am Call (`call.webhookAnchors`, nur `/voice/turn`) | NUR die Anker-Strings (Zufallsmarke bzw. Hash, PII-FREI) | Ringpuffer `WEBHOOK_ANCHOR_HISTORY` (6); der Rest stirbt mit dem Call-Datensatz ueber die bestehende `RETENTION_DAYS`-Loeschung |
| `/voice/incoming` | nichts Neues — der Call-Datensatz selbst | wie oben |

Kein neuer Aufraeum-Job, keine neue Env-Variable, keine neue npm-Abhaengigkeit. Der
Antwort-WORTLAUT (PII) verlaesst den Prozess nie; persistiert werden ausschliesslich
Hashes/Zufallsmarken — also keine neue PII-Senke neben `transcript` und keine Kollision
mit der kuerzeren `DIAGNOSTIC_RETENTION_DAYS`-Transkript-Loeschung. `webhookAnchors` ist in
`views.publicCall` gestrippt und verlaesst die API nicht.

### Bewusst getragene Restrisiken

| # | Restrisiko | Warum getragen |
|---|---|---|
| R1 | Ein Angreifer mit gueltiger Signatur, der `callId` auf einen anderen, ihm bekannten aktiven Anruf umbiegt, umgeht den call-gebundenen Anker | Ein globales Ledger waere eine neue, quer-mandantige PII-/Datensenke. Der Angreifer braucht bereits eine abgefangene gueltige Signatur UND eine fremde `callId`; die Signatur gilt nur 300 s |
| R2 | Zweite Zustellung NACH Prozess-Neustart bekommt den Wortlaut nicht zurueck, nur ein offenes Mikrofon | Der Wortlaut ist PII und wuerde die kuerzere Transkript-Loeschung ueberleben. Der Anruf ueberlebt, es kostet nichts |
| R3 | Request ganz OHNE ableitbaren Anker (kein `CallSid`, keine Marke, kein signierter Umschlag — lokaler Skip-Modus, in-flight-Leg ueber einen Deploy) laeuft wie bisher | Fail-open genau dort, wo heute schon nichts geschuetzt ist; kein Gate wird geschwaecht. In Produktion liegt immer mindestens der Umschlag-Anker vor |
| R4 | pg flusht asynchron: stirbt der Prozess zwischen Antwort und Flush, ist der Anker weg | Geerbt von `billedAt`, kein neuer Defekt |
| R5 | `/voice/outbound` bleibt ohne Riegel (doppelte Zustellung -> zweite Opening-Zeile im Transkript) | Nicht gemessen, nicht Teil dieser Phase. Als Befund benannt, nicht gebaut |
| R6 | Prozessuebergreifende Beanspruchung (`deliveries` lebt im Prozess) | = GATE-04 in `PLAN-SEC-FIX.md` § 4, ausdruecklich draussen, solange `numInstances=1`. Der pg-Store ist ein Spiegel mit asynchronem Flush, kein synchroner DB-Schreiber — ein `ON CONFLICT` waere hier wirkungslos |
| R7 | Zwei GLEICHZEITIGE Anrufe, deren Turn-Webhook-Body UND Zeitstempel byte-identisch waeren, teilten sich Anker B | In Produktion unerreichbar: der TeXML-Body traegt je Leg die eigene `CallSid`. Der Ausgang waere ausserdem harmlos (eine wiederholte Antwort, Mikrofon bleibt offen, naechste Runde laeuft) |

Belegt durch `test/sec-p1-webhook-idempotenz.test.js` (echte Ed25519-Signatur, EIN Body,
EIN Zeitstempel, zweimal zugestellt; LLM-Aufrufe gezaehlt) und
`test/sec-p1-webhook-anker-persistenz.test.js` (Round-Trip in BEIDEN Store-Backends,
Ringpuffer-Deckel, kein API-Leck).

## SEC-P2 — Lieferkette: gezieltes Update statt `npm audit fix` (2026-09-09)

Zwei Commits, 0 Zeilen Anwendungslogik, kein `--force`, keine neue Abhaengigkeit.

**Commit 1 (nicht-brechend):** `npm update ip-address fast-uri hono @hono/node-server
body-parser brace-expansion` — alle sechs transitiv, alle innerhalb bestehender Ranges,
`package.json` unveraendert. Bewusst NICHT `npm audit fix`: das haette `express` von
4.22.2 auf 4.22.1 zurueckgestuft, um dem `qs`-Advisory auszuweichen, und das Advisory
dabei nicht einmal behoben (`qs` bleibt in beiden Faellen im verwundbaren Bereich
2.2.5-6.15.3, nur an einer anderen Stelle im Baum). Ein Downgrade eines Live-Frameworks
als Nebenwirkung eines Sicherheitsschritts wird hier nicht getragen.

**Commit 2 (brechend, `nodemailer` Major):** `nodemailer` `^7.0.13` -> `^10.0.1`. Einziger
Breaking Change laut Anbieter-CHANGELOG: `Node.js >= 20` erforderlich — wir fahren
`>=22 <23`, vertraeglich. Kein Quellcode-Edit in `src/smtp-mail.js` /
`src/mail-boot-probe.js` noetig (Default-Export, `createTransport`, `sendMail`, `verify`
unveraendert). Neuer Test `test/nodemailer-lernvertrag.test.js` (Clean-Code P10) faengt
genau das ab, was die attrappenbasierten Bestandstests per Konstruktion nicht sehen
koennen: er laeuft gegen die ECHTE Bibliothek (lokaler `net`-Server ohne STARTTLS) und
sichert die Invariante "TLS ist ERZWUNGEN" — kein `DATA`-Kommando erreicht den Server,
solange `requireTLS` respektiert wird.

### Owner-bindende Entscheidungen (gelten bis widerrufen)

1. **`nodemailer` faehrt ab jetzt auf `^10`.** `Node >= 20` ist damit harte Untergrenze
   der Mail-Faehigkeit (heute `>=22 <23` — Puffer vorhanden). Ein Rueckschritt auf `^7`
   holt sechs hohe Advisories zurueck (SMTP-Command-Injection, CRLF-Injection, fehlende
   TLS-Pruefung beim OAuth2-Token-Abruf, `raw`/`jsonTransport` umgehen
   `disableFileAccess`/`disableUrlAccess`).
2. **Das `qs`-Advisory (moderat, via `express@4.22.2` -> `qs@~6.15.1`) wird bewusst
   getragen**, solange es moderat bleibt — der einzige Ausweg ist ein `express`-Downgrade
   oder ein `overrides`-Zwang, beides ein brechender Sprung an einem Live-Framework fuer
   einen moderaten Befund. Wird das Advisory je auf `high` hochgestuft, faellt die Abnahme
   dieser Phase von selbst rot; der `express`-5-Sprung (oder `overrides`) ist dann als
   eigene Entscheidung zu treffen, nicht nebenbei.

### Zustand nach beiden Commits (gemessen)

```
npm audit --omit=dev --audit-level=high   -> exit 0   (Abnahme)
npm audit --audit-level=high              -> exit 0   (CI-Gate-Paritaet, ci.yml auditiert ohne --omit=dev)
npm audit --omit=dev                      -> 2 moderate severity vulnerabilities (qs, s.o.)
```

`apps/web` hat ein eigenes Lockfile, 0 Verwundbarkeiten, nicht angefasst.
`.github/dependabot.yml` bereits versioniert, nicht Teil dieser Phase.
