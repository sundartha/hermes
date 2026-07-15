# PLAN-SECURITY.md — Sicherheits-Plan (Launch-Fixes)

Sammlung der sicherheitsrelevanten Einträge der Launch-Blocker-Kette (OUT-05/PROV-01/A6,
PLAN-LAUNCH-FIXES.md). Jede sicherheitsrelevante Phase ergänzt hier ihren Eintrag (Pflicht,
CLAUDE.md). Aeltere Phasen-Historie liegt in Git.

## OUT-05 — Budget-/Reserve-Race bei parallelen place_call (nach F2)

> OUT-05 (Reserve-Race): Worst-Case-Reserven pro place_call in einem strukturell ephemeren
> In-Prozess-Ledger (`s.reservations`, nie serialisiert/hydriert); Check+Reserve atomar unter
> `withStoreLock` (Schnittmenge Tenant+global), fail-closed try/catch (Body-Throw = Denial 402).
> Freigabe bei jedem Endzustand: Erfolg via `finishCall`, Fehler via `catch`, UND — unabhaengig vom
> Provider-Callback — via beim Originate armiertem Reserve-Release-Timer (beide Engines) bei
> `maxDur + RESERVE_RELEASE_GRACE_MS`. Restrisiken (akzeptiert, bounded): (a) Multi-Prozess nicht
> abgedeckt (OT-3, single-instance); (b) Freigabe braucht die Live-Call-Referenz -> cross-instance
> blind (OT-3); (c) Hung-Originate laesst eine Reserve bis Boot stehen (selten, boot-begrenzt);
> (d) Ist-Kosten koennen die Reserve um <= 1 Minutentakt (Rundung/Hangup-Latenz) uebersteigen,
> fail-forward. `FAKE_ORIGINATE` ist ein boot-gehaerteter Test-Seam (nur zulaessig wenn
> Signaturpruefung geskippt -> in Prod unmoeglich), keine abgeschaltete Sicherung.

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
  -> `hold` (manuell). Es gibt keinen `adapters/twilio/numbers.js`, also nie einen Twilio-Release-
  Versuch. Der Release laeuft ueber den bestehenden NumberProvisioning-Port (registry-Dispatch),
  kein neuer Provider-Einstieg.
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
