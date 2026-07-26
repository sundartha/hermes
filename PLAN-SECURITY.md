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
> das normalisierte Ziel exakt der `privateNumber` des anrufenden Tenants entspricht. Der
> Body-/MCP-Wert ist ein Wunsch, keine Wahrheit; die Pruefung ist strikt (`=== true`,
> String-Truthiness kann sie nicht aufweichen). Fremde Gespraechsinhalte koennen damit
> nicht laenger liegen als versprochen. Fail-closed in jeder Richtung: kein Flag, kein
> Treffer oder `DIAGNOSTIC_RETENTION_DAYS=0` ergibt exakt das Bestandsverhalten.
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
> Begrenzt wird die Exposition allein durch den harten `MAX_CALL_DURATION_S`-Cap - Worst
> Case sind `maxCallDurationS` statt eines frueheren Auflegens. **Vertretbar nur mit
> `MAX_EMPTY_TURNS` auf dem konservativen Default 3. Wer den Wert hochdreht, kauft
> Hoeflichkeit mit Carrier-Minuten, die kein Gate sieht.**
>
> **Nicht beruehrt (Regel 1):** `CAP_FAREWELL_LEAD_MS` (P3.1) verlaengert den Max-Dauer-Cap
> NICHT. Der Abschluss-Satz wird INNERHALB der Frist gerendert; `terminateCappedCall`,
> `armMaxDurationTimer` und `POST /api/calls/:id/cancel` (Owner-Notaus ohne Ansage) bleiben
> unveraendert. `CAP_FAREWELL_LEAD_MS=0` schaltet die Ansage aus, ohne den Cap anzufassen.

## P7A-MODELPRICE — Budget-Guard rechnet pro Modell (fail-closed, 2026-07-19)

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
> da keine Gate-Entscheidung daran haengt; bewusst ausgeklammerte Folgephase).

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
> 2. Eine verspaetete Kostenkorrektur aus der Vorperiode faellt positiv ins neue Fenster
>    bzw. wird negativ auf 0 geklemmt (`Math.max(0, ...)`, sonst waere sie ein Guthaben,
>    das das Gate aufweitet). Identische Asymmetrie wie die bestehende Spend-Monat-Achse
>    (`bookCostCorrectionCents`) - kein neuer Sachverhalt.
> 3. `tenantBudgetSnapshot` (Anzeige/Ablehnungstexte) bleibt eine LEBENSZEIT-Sicht neben
>    einer Perioden-Entscheidung. Bekannte, seit P7 bestehende Anzeige/Gate-Divergenz -
>    irrefuehrend, aber nicht unsicher (keine Gate-Entscheidung haengt daran). Bewusst
>    ausserhalb des Scopes dieser Phase.
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
> 3. `BLOCKED_PARAMS` — leere ODER unbrauchbare Parameter (E.164-Regex + `twilio|telnyx`).
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
