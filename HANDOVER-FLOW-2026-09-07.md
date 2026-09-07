# HANDOVER — "Der Flow laeuft immer noch nicht" (Stand 2026-09-07)

Fuer die naechste Session. Alles hier ist an Produktion GEMESSEN, nicht abgeleitet. Jede Zahl in
Abschnitt 2 stammt aus der Render-Postgres bzw. den Live-Logs; wo etwas Vermutung ist, steht es dabei.

## 1. Was bereits erledigt ist (nicht noch einmal machen)

Phase **CL1** ist gebaut, gemergt (`47104eb1`), gepusht und **live deployed**
(`dep-daf4jpht0dsc73chobn0`, 2026-09-07 05:22 UTC). Sie behebt den Aussperrungs-Zustand
"gekuendigt = `suspended` + stehengebliebene `stripeSubscriptionId`":

| Baustein | Inhalt |
|---|---|
| B1/B2 | `customer.subscription.deleted` entwertet die Abo-Referenz, `invoice.payment_failed` NICHT (Doppelabbuchungs-Schutz) |
| B3 | `scripts/reconcile-stale-subscriptions.js` heilt Bestandsdaten gegen Stripe (Trockenlauf-Default) |
| B4 | "Vielleicht spaeter" hinterlaesst keine Ansicht ohne Bedienelement mehr |
| B5 | `accountByTenant` liefert bei mehreren Zeilen gleicher Email die juengste statt `null` |

Analyse und Begruendungen: `PLAN-CANCEL-LOCKOUT.md`. Testlage: 5707 pass / 2 fail; die zwei roten
sind vorbestehend (`test/kv2-10-tarifpaar.test.js`, auf unveraendertem `master` reproduziert).

**Warum der Owner trotzdem sagt, es laufe nicht:** der Code-Fix wirkt nur auf KUENFTIGE Ereignisse.
Der betroffene Datensatz traegt die tote Referenz weiter — siehe F1.

## 2. Gemessener Produktionszustand

> **Falle, die eine neue Session sonst in die Irre fuehrt:** auf `call`, `number`,
> `number_assignment`, `provisioning_job` und `usage_event` ist **RLS aktiv**, und der DB-User hat
> kein `BYPASSRLS`. Eine schlichte Abfrage liefert dort **0 Zeilen** und sieht aus wie "es gibt
> nichts". Der Tenant-Kontext muss zuerst gesetzt werden, sonst misst man Luft:
> ```sql
> with s as (select set_config('app.current_tenant','<tenant_id>',true) as x)
> select (select count(*) from number) as numbers, (select count(*) from call) as calls from s;
> ```
> `tenant` und `account` sind RLS-frei und deshalb ohne Kontext lesbar.

| Tenant | Status | Abo-Ref | Nummer | Anrufe | Befund |
|---|---|---|---|---|---|
| `t_user_01KXH2B75W…` (Owner-Account) | `suspended` seit 2026-08-24 | **gesetzt (tot)** | `num_mryvwncasbmb` = `released` | 0 | **ausgesperrt, F1** |
| `t_user_01KZRNWDJA…` | `active` | gesetzt | 1× `active`, 1× `failed` | 5 (August) | funktioniert; ein Provisioning-Versuch scheiterte an Telnyx-402 (F4) |
| `t_user_01KX6008…` (Admin) | `active` | gesetzt | `active` | 54, zuletzt 2026-09-06 | funktioniert technisch, aber **F2** trifft die Gespraeche |
| `owner` | `active` | — | — | — | interner Bootstrap-Tenant |

Der Owner-Account hat **zwei** `account`-Zeilen derselben Email (alter `sub` vom 2026-07-24, neuer
vom 2026-09-06) — Folge der WorkOS-Loeschung beim Vertragsende. B5 faengt das jetzt ab.

## 3. Befunde, nach Wirkung sortiert

### F1 — Owner-Account bleibt ausgesperrt, bis der Bestandsheiler einmal laeuft (BLOCKER)

Belegt im Live-Log **nach** dem Deploy:
`2026-09-07T07:05:11Z [audit] self_service_subscribe_rejected tenant=t_user_01KXH2B75W… reason=already_subscribed`

Der Code ist richtig, die Daten sind es nicht. Zu tun:

```bash
export STORE_BACKEND=pg
export DATABASE_URL='<External Database URL, Render-Dashboard>'
export STRIPE_SECRET_KEY='<sk_live_… aus den Service-Env-Vars>'
node scripts/reconcile-stale-subscriptions.js            # Trockenlauf, schreibt nichts
node scripts/reconcile-stale-subscriptions.js --apply    # entwertet nur, was Stripe als beendet meldet
```

Erwartete Trockenlauf-Zeile: `clear t_user_01KXH2B75W… (stripe=canceled)`. Meldet der Lauf
stattdessen `keep` oder `skip`, **nicht** `--apply` fahren — dann sagt Stripe etwas anderes als
angenommen, und das ist der naechste Untersuchungsgegenstand.

**Warum lokal und nicht in der Render-Shell:** der Service `vodafone-agent`
(`srv-d8m0fhflk1mc73bno570`) laeuft auf dem **Free-Plan** — dort ist Shell/SSH nach Render-Doku
nicht verfuegbar (nicht selbst verifiziert; wenn der Shell-Tab sich oeffnen laesst, geht derselbe
Befehl auch dort). Die DB ist von ueberall erreichbar (`ipAllowList 0.0.0.0/0`), der lokale Lauf
funktioniert in jedem Fall. Vorbedingungen des Skripts sind exakt die drei Env-Variablen oben — am
unveraenderten Skript gegen eine Dummy-DB geprueft (es bricht sauber am DB-Connect ab, nicht vorher).

### F2 — Der Gespraechs-Brain hat kein Guthaben: jeder Turn scheitert mit HTTP 402 (PRODUKT-BLOCKER)

Das ist mit hoher Wahrscheinlichkeit das, was der Owner als "Flow laeuft nicht" erlebt, und es hat
mit CL1 nichts zu tun.

Live-Log, wiederkehrend ueber Tage, zuletzt waehrend eines **echten Anrufs** am 2026-09-06:
```
12:42:30  call inbound  (Tenant t_user_01KX6008…)
12:42:57  [turn]    DeepSeek-Adapter: HTTP 402 - Insufficient Balance
12:43:03  [summary] DeepSeek-Adapter: HTTP 402 - Insufficient Balance
```
Ebenso laufend `[precall-briefing] uebersprungen` und `[opening-line] uebersprungen`, gleiche Ursache.

Wirkung im Code: der Fehler landet im `catch` von `/voice/turn` (`src/routes/voice.js:435-446`) und
fuehrt zu `degradedSpeechFor(...)` **mit `endCall: true`** — der Agent verabschiedet sich und legt
auf, statt zu sprechen. Aus Kundensicht: der Assistent nimmt ab und beendet das Gespraech.

Es gibt **keinen automatischen Anbieter-Fallback**: `LLM_PROVIDER` waehlt prozessweit einen Anbieter
(`src/llm/provider.js:4-10`, `src/llm/registry.js:20-43`); faellt der aus, faellt er ganz aus.

Zwei Wege, Entscheidung gehoert dem Owner:
1. DeepSeek-Guthaben aufladen (schnellster Weg, Ursache bleibt strukturell).
2. `LLM_PROVIDER=anthropic` setzen (Default laut `provider.js:7`) — kostet mehr pro Turn, aber der
   Anthropic-Key ist ohnehin Boot-Pflicht.

Danach zwingend pruefen, ob eine dauerhafte Loesung noetig ist: ein Zahlungsausfall beim
LLM-Anbieter legt heute die gesamte Gespraechsfaehigkeit still, ohne Alarm.

### F3 — Webhook stirbt an unbekannten Tenants (unhandledRejection, 2× allein heute)

```
2026-09-07T02:07:04Z  [guard] unhandledRejection: Error: setTenantSubscription: Tenant t_user_01KWSDW4JZ… nicht gefunden
2026-09-07T04:54:54Z  [guard] unhandledRejection: Error: setTenantSubscription: Tenant t_user_01KWKZS92G… nicht gefunden
```
Beide Tenant-IDs existieren in der `tenant`-Tabelle **nicht**. Stripe sendet also Ereignisse fuer
Tenants, die diese Datenbank nicht kennt (alte/geloeschte Datensaetze oder eine fremde Umgebung).
Der Prozess ueberlebt (`src/process-guards.js:24-32` laesst bewusst weiterlaufen), aber das Ereignis
wird nie verarbeitet und Stripe wiederholt es.

**Nicht von CL1 verursacht** — die Vorfaelle liegen VOR dem Deploy, und der neue Pfad
(`clearSubscriptionReference`) ist gegen genau diesen Fall abgesichert: `tenantSubscription` liefert
fuer unbekannte Tenants `null` statt zu werfen (`src/store/state-ops.js:2299-2313`), der Aufruf ist
dann ein No-Op. Der werfende Aufruf sitzt im Geld-Ereignis-Pfad (`src/billing/webhook.js:308/:345`).

Zu klaeren: sollen Ereignisse fuer unbekannte Tenants sauber verworfen (mit Audit-Zeile) statt in
einen unhandledRejection laufen? Das ist eine kleine, klar abgrenzbare Phase.

### F4 — Telnyx-Plattform-Guthaben: harte Vorbedingung fuer JEDEN neuen Nummernkauf

`provisioning_job` beim Tenant `t_user_01KZRNWDJA…`:
`status=failed`, `last_error="Telnyx orderNumber fehlgeschlagen: HTTP 402 (20100 Insufficient Funds…)"`,
`attempts=1`. Ein zweiter Job lief spaeter `done` durch, die Nummer ist aktiv.

Telnyx-Code **20100 betrifft das Guthaben UNSERES Plattform-Accounts**, nicht die Karte des Kunden.
Solange es nicht aufgeladen ist, scheitert jeder erneute Kaufversuch mit demselben 402 — auch der
des Owners nach F1. **Deshalb: Telnyx-Guthaben pruefen, BEVOR neu abgeschlossen wird.**

Verhalten drumherum (am Code belegt):
- Order-Fehler -> `failNumber` + Hold-Freigabe, Fehler wird geworfen (`src/onboarding.js:128-135`).
- **Kein Retry, kein Backoff:** `drain()` laeuft jeden QUEUED-Job genau einmal
  (`src/queue/adapters/memory/queue.js:24-38`), der Fehlschlag ist terminal `FAILED`
  (`src/worker/provisioning-orchestrator.js:189-206`); der Reconciler fasst nur `QUEUED`-Jobs an.
  Der Kunde sieht `NUMBER_DISPLAY_STATUS.FAILED` (`src/store/views.js:119`).
- Kein Lockout: eine `failed`-Nummer zaehlt nicht gegen den Cap (`src/store/state-ops.js:2463-2464`),
  ein neuer Checkout fragt automatisch eine frische Nummer an (`src/billing/provision-trigger.js:60`).

### F4b — Der Setup-Fee-Hold wird NIE rabattiert (latent)

Der Hold laeuft immer ueber den vollen Provider-Preis (`src/onboarding.js:107,254-278`); der
Gutschein wirkt erst NACH dem Kauf (`cancelHold` statt `captureHold`, `:284-292`), gesteuert ueber
`stripeNumberSetupFeeExempt` aus der echten Stripe-Invoice-Summe (`src/billing/stripe.js:407-424`).
Der historische Gutschein-Bug ist damit sauber geloest — aber lehnt die Karte den vollen Hold ab,
stoppt das **gesamte** Provisioning, nicht nur die Gebuehr. Alle drei Tenants stehen aktuell auf
`stripe_number_setup_fee_exempt = true`; die Karte muss den Hold trotzdem tragen.

### F8 — Asymmetrie: `billingHold`/`periodCreditRevoked` werden nur im Webhook zurueckgesetzt (latent)

`clearBillingHold` und `periodCreditRevoked: false` laufen ausschliesslich im Stripe-Webhook-Zweig
(`src/billing/webhook.js:414-417`, gated `if (activated)`), NICHT im Self-Service-Rueckkehrpfad
(`src/billing/subscribe.js`, `src/self-service-routes.js`), den ein Rueckkehrer tatsaechlich
durchlaeuft. Ein Tenant mit vorheriger Zahlungsbeanstandung waere danach `status=active`, aber das
Outbound-Gate bliebe zu (`src/store/state-ops.js:2360-2367`) bzw. die Periodenminuten stuenden auf 0
(`src/billing/plan-caps.js:58`).

**Fuer den aktuellen Fall ausgeschlossen** (an der Produktionsdatenbank geprueft): alle drei Tenants
haben `stripe_billing_hold = null`, der Owner-Tenant zusaetzlich kein `period_credit_revoked`. Bleibt
als latenter Befund fuer den ersten echten Chargeback.

### F9 — Der Reaktivierungspfad selbst ist in Ordnung (Entwarnung, damit niemand dort sucht)

Ende-zu-Ende nachgezeichnet: `setup-checkout` -> `/billing/return` ->
`activateSubscriptionFromCheckoutSession` -> `activatePaidTenant` -> Nummern-Provisioning ist
idempotent und korrekt verdrahtet. Die freigegebene alte Nummer blockiert nichts (`released` ist
terminal, `occupiesCapacity` zaehlt sie nicht), `tenantMayRequestNumber` ist ueber
`activationPending` offen, bevor der Status-Flip passiert. Einziger Punkt, an dem der Rest still
uebersprungen wird: `provisionCleared(provisioned)` (`src/billing/activation.js:110`) — schlaegt das
Provisioning fehl, bleibt der Tenant inaktiv mit stehendem `activationPending`. Genau dorthin fuehrt
ein ungedecktes Telnyx-Konto (F4).

### F5 — `FORCE_NUMBER_COUNTRY=US` bei Plattform-Land DE

Boot-Warnung bei jedem Start: jede neue Rufnummer wird in den USA gekauft, obwohl
`PROVISIONING_COUNTRY=DE`. Kunden telefonieren unter auslaendischer Absenderkennung
(Zustellrate/Reputation). Falls das ein Testrest ist: vor dem naechsten echten Onboarding entfernen —
sonst bekommt der Owner nach F1 wieder eine US-Nummer.

### F6 — Betriebswissen: der API-Service deployt NICHT automatisch

`vodafone-agent` steht auf `autoDeploy: no`. Ein Push nach `master` liefert nichts aus; der Deploy
muss ausgeloest werden. Nur die Website `hermes-web` deployt automatisch aus `master`. Das hat in
dieser Session schon einmal Zeit gekostet.

### F7 — Aufraeumen: zwei Worktrees aus gescheiterten Laeufen

Unter `.claude/worktrees/` liegen `wf_631d8245-92c-3` und `wf_d583d899-784-2` (letzterer haelt den
Branch `phase/cl1-cancel-lockout`, dessen Arbeit gemergt ist). Ihre `node_modules` sind Symlinks ins
Haupt-Repo — die bekannte Falle, die dort schon einmal die Dependencies zerschossen hat. Vor dem
naechsten Phasenlauf entfernen.

## 4. Offene Owner-Entscheidungen (aus CL1, unbeantwortet)

1. **Lebenszyklus:** bleibt ein durch Kuendigung beendeter Vertrag `suspended` ("geparkt", Historie
   bleibt, aktuelle Umsetzung) oder wird er `closed` (Rueckkehrer bekommt frischen Tenant)?
2. **Admin-Notausgang:** `POST /api/admin/tenants/:id/approve` haengt selbst hinter dem
   active-only-Gate (`src/web-auth.js:813`). Ein suspendierter einziger Admin sperrt sich damit aus
   dem eigenen Notausgang aus.

## 5. Empfohlene Reihenfolge fuer die naechste Session

Die ersten drei Punkte sind **Konto-Arbeit, kein Code** — und ohne sie bringt jeder Code-Schritt
nichts.

1. **F2 zuerst** — ohne funktionierenden LLM-Anbieter ist jedes andere Ergebnis wertlos: der
   Assistent legt bei jedem Anruf auf. Guthaben oder `LLM_PROVIDER=anthropic`, dann mit einem echten
   Testanruf verifizieren (Log auf `[turn]` pruefen, nicht nur "es klingelt").
2. **F4 pruefen** — Telnyx-Plattform-Guthaben. Ist es leer, scheitert Schritt 4 an der Nummer, und
   der Tenant bleibt mit stehendem `activationPending` inaktiv (F9).
3. **F5 entscheiden** — `FORCE_NUMBER_COUNTRY=US` entfernen, wenn der Owner keine US-Nummer will.
   Danach ist die Reihenfolge wichtig: erst Env aendern, dann kaufen.
4. **F1 heilen** — Trockenlauf, Ergebnis lesen, dann `--apply`. Danach: Owner loggt sich ein, waehlt
   einen Tarif, Checkout muss durchlaufen (kein 409 mehr) und eine neue Nummer bekommen.
5. **F3** als eigene kleine Phase (Webhook-Ereignisse fuer unbekannte Tenants sauber verwerfen).
6. **F7** aufraeumen, bevor der naechste `phase-impl-lean`-Lauf startet.
7. **F8** offen halten, bis der erste Chargeback kommt — dann ist es ein Blocker.

## 6. Wie man den Zustand selbst nachmisst

- Tenant-Uebersicht (RLS-frei): `select id, status, stripe_subscription_id is not null, suspended_at from tenant;`
- Pro-Tenant-Daten: das `set_config`-Muster aus Abschnitt 2.
- Live-Logs ueber die Render-MCP-Tools, Service `srv-d8m0fhflk1mc73bno570`; nuetzliche Textfilter:
  `already_subscribed`, `402`, `unhandledRejection`, `provision`.
- Deploy-Stand: `list_deploys` auf denselben Service — die Commit-ID in der Antwort ist die Wahrheit,
  nicht der lokale `master`.
