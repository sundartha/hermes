# HANDOVER — "Der Flow laeuft immer noch nicht" (Stand 2026-09-07, abends)

Fortschreibung der Fassung von heute frueh. Alles hier ist an Produktion GEMESSEN oder am Code
belegt; wo etwas Vermutung ist, steht es dabei. Was seit der ersten Fassung erledigt wurde, steht
in Abschnitt 1 mit dem jeweiligen Beleg — nicht noch einmal machen.

## 0. Die kuerzeste Fassung

Der Owner erlebt "der Flow laeuft nicht" aus **zwei** Gruenden, die nichts miteinander zu tun
haben. Der erste ist heute behoben: der Gespraechs-Brain hatte kein Guthaben und legte bei jedem
Anruf auf. Der zweite ist offen und braucht Konto-Arbeit: der Owner-Account traegt eine tote
Abo-Referenz und das Telnyx-Plattform-Konto ist leer.

## 1. Erledigt und verifiziert (2026-09-07)

| Befund | Was getan wurde | Beleg |
|---|---|---|
| **F2 (akut)** | `LLM_PROVIDER=anthropic` am Render-Service gesetzt | Deploy `dep-dafdjj2d0e5s73bvvcl0`, Status `live` 15:36:39 UTC |
| **F5** | `FORCE_NUMBER_COUNTRY` geleert (leer == ungesetzt: `trimmedUpper("")` ist in allen vier Lesestellen falsy) | Boot-Warnung im Boot 15:36:29 **verschwunden**, vorher in JEDEM Boot |
| **F4** | Telnyx-Guthaben gemessen | **1,99 USD**, `credit_limit` 0,00, `available_credit` 1,99 — faktisch leer |
| **F7** | Worktree `wf_d583d899-784-2` + gemergter Branch `phase/cl1-cancel-lockout` entfernt | `git worktree list` sauber; `wf_631d8245-92c-3` existierte nicht mehr |
| **CL1** | unveraendert gueltig (gebaut, gemergt, live) | s. Abschnitt 5 |

Beide Env-Aenderungen liefen in EINEM Update, damit nur ein Deploy entsteht.

**Wichtig zur Reihenfolge:** F5 ist jetzt raus — der naechste Nummernkauf holt eine DE-Nummer.
Wer vorher kauft, bekommt weiter eine US-Nummer. Also erst F1/F4 klaeren, dann kaufen.

## 2. Offen — und zwar bei dir, nicht im Code

Diese drei Punkte kann keine Session fuer dich erledigen; ohne sie bringt jeder Code-Schritt
nichts.

### O1 — F1: der Owner-Account bleibt ausgesperrt, bis der Heiler einmal laeuft (BLOCKER)

Der CL1-Code-Fix wirkt nur auf KUENFTIGE Ereignisse. Der betroffene Datensatz traegt die tote
Referenz weiter. Belegt im Live-Log **nach** dem CL1-Deploy:
`[audit] self_service_subscribe_rejected tenant=t_user_01KXH2B75W… reason=already_subscribed`

```bash
export STORE_BACKEND=pg
export DATABASE_URL='<External Database URL, Render-Dashboard -> hermes-db>'
export STRIPE_SECRET_KEY='<sk_live_… aus den Service-Env-Vars>'
node scripts/reconcile-stale-subscriptions.js            # Trockenlauf, schreibt nichts
node scripts/reconcile-stale-subscriptions.js --apply    # entwertet nur, was Stripe als beendet meldet
```

Erwartete Trockenlauf-Zeile: `clear t_user_01KXH2B75W… (stripe=canceled)`. Meldet der Lauf
stattdessen `keep` oder `skip`, **nicht** `--apply` fahren — dann sagt Stripe etwas anderes als
angenommen, und das ist der naechste Untersuchungsgegenstand.

**Warum nicht durch eine Session erledigt:** dieser Klon hat keine Produktions-Zugangsdaten. Die
lokale `.env` enthaelt **weder `DATABASE_URL` noch `STRIPE_SECRET_KEY`** (`STORE_BACKEND=json`) —
das Skript bricht sauber am DB-Connect ab (`[store] FATAL: pg-Backend nicht initialisierbar`).
Das ist gute Hygiene, kein Defekt. Willst du es delegieren, trag die beiden Werte lokal ein; das
Skript liest sie selbst ueber `dotenv`, niemand muss sie in einen Chat kopieren.

**Warum lokal und nicht in der Render-Shell:** der Service laeuft auf dem Free-Plan, dort ist
Shell/SSH nach Render-Doku nicht verfuegbar (nicht selbst verifiziert). Die DB ist von ueberall
erreichbar (`ipAllowList 0.0.0.0/0`), der lokale Lauf funktioniert in jedem Fall.

### O2 — F4: Telnyx-Plattform-Guthaben aufladen (BLOCKER fuer JEDEN Nummernkauf)

Gemessen: **1,99 USD**. Telnyx-Code 20100 betrifft das Guthaben UNSERES Plattform-Accounts, nicht
die Karte des Kunden. Solange nicht aufgeladen ist, scheitert jeder Kaufversuch mit 402 — auch der
des Owners nach O1. Der Tenant bleibt dann mit stehendem `activationPending` inaktiv (s. F9).

**Deshalb: aufladen BEVOR der Owner neu abschliesst.**

### O3 — F2 Endbeweis fehlt noch

Dass Anthropic wirklich antwortet, beweist erst ein **echter Testanruf**. Das Ausbleiben der
402-Zeilen sagt ohne Verkehr nichts. Pruefen: Log auf `[turn]` ansehen, nicht nur "es klingelt".

Zur Wahl selbst: DeepSeek aufladen waere der guenstigere Weg pro Turn gewesen, ist aber nur ueber
dein Konto moeglich; `LLM_PROVIDER=anthropic` war der einzige sofort ausfuehrbare. Der
Anthropic-Key ist ohnehin Boot-Pflicht. Rueckweg jederzeit: Env-Wert zurueckstellen.

## 3. Code-Phasen dieser Session

Zwei Phasen wurden nach `tasks/fw1-spec.md` bzw. `tasks/fw2-spec.md` gebaut (Plan auf Opus,
Umsetzung auf Sonnet, `phase-impl-lean`).

### FW1 — `phase/fw1-webhook-haertung` (deckt F3 + F8)

- **F3 Wurzel, schaerfer als in der ersten Fassung:** der Wurf steckt NICHT in
  `setTenantSubscription`, sondern eine Ebene darueber. `metadata.tenant_ref` aus dem
  Stripe-Objekt wird ungeprueft als existierender Tenant uebernommen; nur der Fallback-Lookup
  (`findTenantBySubscription`/`findTenantByCustomer`) liefert garantiert eine existierende Zeile.
  Stripe traegt die Metadata dauerhaft am Objekt — auch nach dem Loeschen des Datensatzes.
- **Fix:** neues Praedikat `store.tenantExists` (state-ops -> json/pg -> Fassade) und ein
  Existenz-Gate an BEIDEN Aufloesungsstellen, ueber einen gemeinsamen Helfer, der die
  unterschiedliche Aufloesungs-REIHENFOLGE der Zweige nicht verwischt. Ergebnis: Audit-Zeile
  `unknown_tenant` + regulaere Rueckkehr, Route antwortet Stripe 200, Stripe hoert auf zu
  wiederholen. Kein `try/catch` als Ersatz (Symptom statt Wurzel).
- **F8 Fix:** `clearBillingHold` + `periodCreditRevoked:false` wandern aus dem Webhook-Zweig in
  `activatePaidTenant` — die EINE gemeinsame Aktivierung, die auch der Self-Service-Rueckkehrpfad
  durchlaeuft. Die BEDINGUNG wandert nicht mit (`activated===true` = bestaetigtes Abo plus
  geklaertes Provisioning). Zusaetzlich wird das Budget-Fenster nach dem Raeumen des Holds
  nachgestempelt — sonst faellt genau der Rueckkehrer-Fall auf die strengere Lebenszeit-Achse.
- **Selbst geprueft:** `findTenant` endet auf `|| null`, das Praedikat ist also nicht invertiert;
  der `no_tenant`-Pfad fasst den Store weiterhin nicht an (Katalogtest `gap-03` faehrt ihn mit
  `store={}`). Testfaelle A1–A7 und B1–B4 decken die Spec 1:1 ab.

### FW2 — `phase/fw2-llm-ausweichanbieter` (deckt F2 strukturell)

Kern-Entscheidung: **kein Zweitversuch im selben Turn.** Der Voice-Webhook hat einen harten
externen Deckel (`PROVIDER_WEBHOOK_HARDCUT_MS = 15000` minus Reserve und Synthese-Zeit,
`src/turn-budget.js`). Ein zweiter vollstaendiger Anbieter-Versuch verdoppelt die Worst-Case-Latenz
und laesst den Anruf in den Provider-Hardcut laufen — schlechter als der heutige Zustand.

Stattdessen ein **Guthaben-Latch**: der Turn, der am Guthaben scheitert, degradiert wie bisher und
setzt einen prozessweiten Vermerk; ab der NAECHSTEN Anfrage routet die Registry auf den
Ausweich-Anbieter. Null Zusatzlatenz, nie zwei Anbieter je Anfrage. Neue Env-Variablen
`LLM_PROVIDER_FALLBACK` (leer = Funktion AUS, byte-identisch zum Bestand) und
`LLM_BILLING_LATCH_COOLDOWN_MS` (Default 15 min, damit ein aufgeladenes Konto ohne Neustart
zurueckfaellt). Dazu die zweite Haelfte des Befunds: der Guthaben-Fall wird jetzt auf BEIDEN
Wegen alarmiert — der Budget-Weg (`/voice/turn`) kannte die Unterscheidung bisher nicht, obwohl
`isProviderBillingError` seit laengerem existiert.

## 4. Was noch entschieden werden muss (Code-Seite)

### E1 — Ratschen-Eintrag fuer `src/telnyx-llm-shim.js` (FW2)

Das repo-eigene Aufraeum-Gate verlangt fuer jede angefasste Datei mit Altlast-Befunden einen
gepinnten Eintrag in `eslint-legacy-exceptions.json`, und der Gate-Text sagt ausdruecklich: **kein
Bau-Agent setzt einen Eintrag ohne Freigabe.** FW2 fasst diese Datei erstmals an und hat den
Eintrag angelegt — offen dokumentiert und als freigabepflichtig markiert, statt ihn stillschweigend
zu setzen oder den Commit mit `--no-verify` durchzudruecken.

Sachlage laut Eintrag: `handleChatCompletion` traegt eine VORBESTEHENDE complexity von 50 (5x
Schwelle). FW2 aendert dort genau eine Zeile und **senkt** die Komplexitaet um 1 (50 -> 49).
Deine Entscheidung: Eintrag uebernehmen — oder verwerfen und die eine Zeile ueber einen eigenen,
gezielten Refactor bringen.

Der zweite Pin (`src/routes/voice.js`, `makeVoiceRoutes` 269 -> 270 Zeilen) ist dieselbe Klasse und
hat einen Praezedenzfall vom 2026-08-31.

### E2 — offene Owner-Entscheidungen aus CL1 (unveraendert unbeantwortet)

1. **Lebenszyklus:** bleibt ein durch Kuendigung beendeter Vertrag `suspended` ("geparkt",
   Historie bleibt, aktuelle Umsetzung) oder wird er `closed` (Rueckkehrer bekommt frischen
   Tenant)?
2. **Admin-Notausgang:** `POST /api/admin/tenants/:id/approve` haengt selbst hinter dem
   active-only-Gate (`src/web-auth.js`). Ein suspendierter einziger Admin sperrt sich damit aus
   dem eigenen Notausgang aus.

## 5. Bestand: was gilt weiterhin

**CL1 ist gebaut, gemergt (`47104eb1`), gepusht und live.** Sie behebt den Aussperrungs-Zustand
"gekuendigt = `suspended` + stehengebliebene `stripeSubscriptionId`":

| Baustein | Inhalt |
|---|---|
| B1/B2 | `customer.subscription.deleted` entwertet die Abo-Referenz, `invoice.payment_failed` NICHT (Doppelabbuchungs-Schutz) |
| B3 | `scripts/reconcile-stale-subscriptions.js` heilt Bestandsdaten gegen Stripe (Trockenlauf-Default) |
| B4 | "Vielleicht spaeter" hinterlaesst keine Ansicht ohne Bedienelement mehr |
| B5 | `accountByTenant` liefert bei mehreren Zeilen gleicher Email die juengste statt `null` |

Analyse und Begruendungen: `PLAN-CANCEL-LOCKOUT.md`.

**F9 — der Reaktivierungspfad selbst ist in Ordnung** (Entwarnung, damit dort niemand sucht):
`setup-checkout` -> `/billing/return` -> `activateSubscriptionFromCheckoutSession` ->
`activatePaidTenant` -> Nummern-Provisioning ist idempotent und korrekt verdrahtet. Die
freigegebene alte Nummer blockiert nichts (`released` ist terminal). Einziger Punkt, an dem der
Rest still uebersprungen wird: `provisionCleared(provisioned)` — schlaegt das Provisioning fehl,
bleibt der Tenant inaktiv mit stehendem `activationPending`. Genau dorthin fuehrt ein ungedecktes
Telnyx-Konto (O2).

**F4b — der Setup-Fee-Hold wird NIE rabattiert (latent).** Der Hold laeuft immer ueber den vollen
Provider-Preis; der Gutschein wirkt erst NACH dem Kauf (`cancelHold` statt `captureHold`). Der
historische Gutschein-Bug ist damit sauber geloest — aber lehnt die Karte den vollen Hold ab,
stoppt das **gesamte** Provisioning, nicht nur die Gebuehr.

**Gemessener Tenant-Zustand (Stand heute frueh, RLS-Falle beachten):**

| Tenant | Status | Abo-Ref | Nummer | Anrufe | Befund |
|---|---|---|---|---|---|
| `t_user_01KXH2B75W…` (Owner) | `suspended` seit 2026-08-24 | **gesetzt (tot)** | `num_mryvwncasbmb` = `released` | 0 | **ausgesperrt, O1** |
| `t_user_01KZRNWDJA…` | `active` | gesetzt | 1x `active`, 1x `failed` | 5 (August) | ein Provisioning-Versuch scheiterte an Telnyx-402 |
| `t_user_01KX6008…` (Admin) | `active` | gesetzt | `active` | 54 | funktioniert technisch |
| `owner` | `active` | — | — | — | interner Bootstrap-Tenant |

Der Owner-Account hat **zwei** `account`-Zeilen derselben Email (alter `sub` vom 2026-07-24, neuer
vom 2026-09-06) — Folge der WorkOS-Loeschung beim Vertragsende. B5 faengt das ab.

## 6. Betriebswissen (heute dazugelernt oder korrigiert)

- **`origin` IST hier das Deploy-Repo.** In diesem Klon zeigt `origin` auf `jonas986/vodafone-agent`
  — dasselbe Repo, aus dem Render baut. Die Notiz "ein Push nach origin macht nichts live" in
  `tasks/anrufdefekte-chain-state.md` stammt aus einem anderen Klon (dort war `origin` ein Fork und
  `upstream` das Deploy-Repo) und gilt hier NICHT. Vor jedem Push die Remotes pruefen.
- **`autoDeploy: no` gilt fuer Git-Pushes — nicht fuer Env-Aenderungen.** Ein Update der
  Environment-Variablen loest von sich aus einen Deploy aus (heute so passiert). Das ist bequem und
  gefaehrlich zugleich: der Deploy baut den **aktuellen Remote-Head**, nicht den Stand, den man
  gerade lokal hat.
- **Der lokale `master` kann weit hinterherhaengen.** Heute waren es 44 Commits — zwei
  Phasen-Laeufe bauten dadurch gegen veralteten Code und mussten verworfen und neu aufgesetzt
  werden. Vor jedem Phasenlauf: `git fetch` und `git rev-list --left-right --count master...origin/master`.
- **RLS-Falle beim Nachmessen** (unveraendert gueltig): auf `call`, `number`,
  `number_assignment`, `provisioning_job` und `usage_event` ist RLS aktiv und der DB-User hat kein
  `BYPASSRLS`. Eine schlichte Abfrage liefert dort **0 Zeilen** und sieht aus wie "es gibt nichts":
  ```sql
  with s as (select set_config('app.current_tenant','<tenant_id>',true) as x)
  select (select count(*) from number) as numbers, (select count(*) from call) as calls from s;
  ```
  `tenant` und `account` sind RLS-frei und ohne Kontext lesbar.

## 7. Wie man den Zustand selbst nachmisst

- Tenant-Uebersicht (RLS-frei): `select id, status, stripe_subscription_id is not null, suspended_at from tenant;`
- Pro-Tenant-Daten: das `set_config`-Muster oben.
- Live-Logs ueber die Render-MCP-Tools, Service `srv-d8m0fhflk1mc73bno570`; nuetzliche Textfilter:
  `already_subscribed`, `402`, `unhandledRejection`, `provision`, `FORCE_NUMBER_COUNTRY`.
- Telnyx-Guthaben: Telnyx-MCP, Endpunkt `retrieve_balance`.
- Deploy-Stand: `list_deploys` auf denselben Service — die Commit-ID in der Antwort ist die
  Wahrheit, nicht der lokale `master`.

## 8. Empfohlene Reihenfolge fuer die naechste Session

1. **O2 (Telnyx aufladen)** — ohne Guthaben scheitert Schritt 2 an der Nummer.
2. **O1 (Bestandsheiler)** — Trockenlauf, Ergebnis lesen, dann `--apply`. Danach: Owner loggt sich
   ein, waehlt einen Tarif, Checkout muss durchlaufen (kein 409 mehr) und eine DE-Nummer bekommen.
3. **O3 (Testanruf)** — beweist F2 endgueltig.
4. **E1 entscheiden**, dann FW1 + FW2 mergen, pushen und **manuell deployen** (`autoDeploy: no`).
5. **E2** beantworten, wenn Zeit ist — beides sind Produktentscheidungen, keine Bugs.
