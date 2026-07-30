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

## AL-P2-SSESPIKE — befristete SSE-Verzoegerung im Antwortpfad (2026-07-29)

**Das Loch.** Ob Telnyx unseren SSE-Strom **inkrementell** konsumiert oder bis `data:[DONE]`
puffert, war unbelegt — an dieser einen Tatsache haengen fuenf spaetere Phasen der AL-Kette
(AL-P7, AL-P7b, AL-P10b, AL-P14, AL-P15). Messbar ist sie nur am laufenden, oeffentlich
erreichbaren Shim: eine kuenstliche Verzoegerung zwischen dem ersten Sprech-Chunk und dem
Rest EINER Antwort, gemessen an `audio_first_token_duration_ms` plus Aufnahme.

**Der Fix.** Der Schalter (`sseSpikeDelayMsFor` in `src/telnyx-llm-shim.js`) ist die EINE
Stelle, die ueber Betroffenheit entscheidet, und er ist dreifach eingegrenzt: er greift nur,
wenn `TELNYX_SSE_SPIKE_DELAY_MS > 0` **und** `TELNYX_SSE_SPIKE_CALLEE` gesetzt ist **und**
`call.to` exakt dieser Wegwerf-Nummer entspricht — jede andere Konstellation liefert 0 und
damit die byte-identische Bestands-Chunk-Sequenz. Die Notaus-Pfade (Rate-Gate, Budget-Kill,
Loop-Guard, Degradations-Catch) uebergeben ausdruecklich **keine** Pause und bleiben sofortig.
Drei unabhaengige Sonden verhindern, dass der Schalter unbemerkt weiterlaeuft: ein
`productionFootguns`-Boot-Refusal (Verzoegerung ohne Zielnummer ist im Hosting fatal), eine
Boot-Banner-Zeile bei jedem Start und eine `sse_spike_delay`-Logzeile bei JEDER verzoegerten
Antwort. Banner, Log und Konfig-Diagnose nennen nur Var-Namen und `delayMs`, nie die
Rufnummer (PII). `TELNYX_SSE_SPIKE_CALLEE` wird ueber `e164Env` validiert: gesetzt, aber
kein E.164 -> Boot-Refusal statt eines lautlos nie greifenden Schalters.

**Benannte Folge (bewusst akzeptiert).** Ein Diagnose-Schalter bleibt bis zur Messung im
Produktiv-Antwortpfad stehen — die Messung braucht Infrastruktur und den Owner und war
dieser Phase untersagt. Im Hosting ist er ohne Zielnummer fail-closed gesperrt, ohne gesetzte
Env-Vars vollstaendig inert. Der **ersatzlose Rueckbau** (Schalter, beide Env-Vars, Footgun,
Banner-Zeile, Log-Kanal, Tests) ist Teil der Abnahme und steht als Schritt 6 in
`tasks/al-testcall-checklist.md`.

**Ausdruecklich NICHT geaendert:** alle Safety-Gates (Denylist/Land-Gate/Stundenlimit/
Budget-Guard/Max-Gespraechsdauer/Provider-Signaturpruefung), der Offenlegungssatz, jede
Auth-Kante (Existenz-Gate, Bearer-Pruefung, ccid-Korrelation, Call-Resolve — der Schalter
sitzt hinter allen vieren), die Budget-Achsen und `latencyMs` in der `turn_ok`-Zeile (misst
weiterhin nur `agentTurn`, die Verzoegerung faelscht die Zahl nicht).

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
| `TWILIO_AUTH_TOKEN`  | Twilio Console                  | Voice/SMS-API **und** Webhook-HMAC-Schluessel                  | Calls/SMS auf deine Kosten + Signatur-Faelschung |
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
   testen (z.B. Test-Call fuer Twilio/Telnyx, Login fuer OIDC).
4. **Alten Wert widerrufen/loeschen** beim Anbieter — erst NACH bestaetigter Verifikation.
5. **Rotation protokollieren** (Datum + welches Secret + Anlass) im privaten Rotation-Log
   (nie ins Repo). Anlass = Quartals-Routine **oder** Verdacht/Personalwechsel.

**Empfohlene Kadenz:** vierteljaehrlich routinemaessig; **sofort** bei Verdacht auf Leak,
ausgeschiedenem Teammitglied oder kompromittiertem Geraet.

### Rotation — Besonderheiten pro Secret

| Secret                                 | Rotations-Besonderheit                                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TWILIO_AUTH_TOKEN`                    | Twilio fuehrt **Primary + Secondary Auth Token**. Secondary erzeugen → in Env eintragen → Primary "promote/regenerate". Echtes Zero-Downtime, da kurzzeitig beide gueltig sind. Achtung: derselbe Token validiert auch die Webhook-HMAC — nach Rotation Test-Inbound pruefen. |
| `STRIPE_SECRET_KEY`                    | Im Stripe-Dashboard **"Roll key"** mit Ablauf-Frist (alter Key laeuft kontrolliert aus) statt Sofort-Widerruf. Test- (`sk_test`) und Live-Key (`sk_live`) **getrennt** rotieren.                                                                                              |
| `SESSION_SECRET`                       | Rotation **invalidiert alle aktiven Browser-Sessions** (User muessen neu einloggen). Geplant ausserhalb der Stosszeit, ggf. ankuendigen. Kein Ueberlappungs-Mechanismus.                                                                                                      |
| `DATABASE_URL`                         | Postgres-Passwort in Render rotieren (Render Postgres → Rotate) → URL in der Env des Web-Service nachziehen. Kurzer Reconnect; Pool baut neu auf.                                                                                                                             |
| `MCP_AUTH_TOKEN`                       | Bei `MCP_AUTH=oauth` **nicht in Benutzung** — dann ganz aus der Env nehmen statt rotieren. Im Legacy-/`token`-Modus: Client (z.B. curl-Skripte) und Env **gleichzeitig** umstellen (keine Ueberlappung moeglich).                                                             |
| `OIDC_CLIENT_SECRET`                   | In WorkOS AuthKit ein neues Client-Secret erzeugen (WorkOS erlaubt Ueberlappung) → Env tauschen → altes in WorkOS loeschen.                                                                                                                                                   |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Zweiten Key erstellen → Env tauschen → ersten widerrufen. Ueberlappung trivial.                                                                                                                                                                                               |

### Twilio-/Telnyx-Subaccount auf minimale Rechte

**Ziel:** Hermes laeuft nie mit Master-/Account-weiten Vollrechten — ein geleaktes Token darf nur
den Hermes-Kontext betreffen, nicht den ganzen Provider-Account.

**Twilio:**

- [ ] **Subaccount** anlegen (Twilio Console → Account → Subaccounts); Hermes nutzt **nur** dessen
      `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`. Master-Auth-Token nie in Hermes.
- [ ] Im Subaccount **nur** die genutzten Produkte aktiv: **Voice** + **Messaging**. Ungenutzte
      (Verify, Lookup, etc.) nicht freischalten.
- [ ] **Usage-Trigger / Spend-Limit** auf dem Subaccount setzen (zweite Kostenbremse zusaetzlich
      zum app-internen Budget-Guard — die Provider-Add-on-Minuten laufen ausserhalb).
- [ ] Geo-Permissions auf die benoetigten Laender beschraenken (passt zum Kauf-Land-Gate).

**Telnyx:**

- [ ] **Scoped API Key** (V2, least-privilege) statt Account-weitem Key; nur die fuer Voice/SMS
      noetigen Scopes. Pro Umgebung (Staging/Prod) eigener Key.
- [ ] API-Key/TeXML-App an die **eine** genutzte Connection/Nummerngruppe binden.
- [ ] Outbound-Voice-/Messaging-Profile mit Land-/Ziel-Restriktionen (die Notruf-/Premium-Sperre
      bleibt zusaetzlich app-seitig hardcoded, s. Absolute Regel 1 in `CLAUDE.md`).
- [ ] Spend-/Concurrency-Limits im Telnyx-Portal als zweite Bremse.

**Akzeptanz:** Inventar oben stimmt mit der gesetzten Render-Env ueberein; fuer jedes Secret ist
die Rotations-Besonderheit verstanden; Twilio-Subaccount + Telnyx-Scoped-Key sind mit Spend-Limit
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
