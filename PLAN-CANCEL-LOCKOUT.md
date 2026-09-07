# PLAN-CANCEL-LOCKOUT — Gekündigter Tenant ist dauerhaft ausgesperrt

Status: **Analyse abgeschlossen, B1–B5 umgesetzt und auf `master` gemergt** (2026-09-07, Phase CL1,
Suite 5707 pass / 2 fail — beide Fehler vorbestehend in `test/kv2-10-tarifpaar.test.js`, auf
`master` identisch reproduziert). Analyse 2026-09-06 (4 parallele Read-only-Agenten + eigene
Nachprüfung am Code; alle Zeilenangaben gegen den damaligen `master` verifiziert).

**Noch offen — der Code-Fix allein entsperrt niemanden:**
1. Push + Deploy stehen aus (Owner-Freigabe).
2. Der Bestandsheiler muss einmal gegen Produktion laufen:
   `node scripts/reconcile-stale-subscriptions.js` (Trockenlauf), dann `--apply`.
   Erst danach ist der betroffene Datensatz frei.
3. Owner-Entscheidungen 2 und 4 in Abschnitt 7 sind unbeantwortet.

## 1. Symptom (Owner-Report)

Account mit Abo, Abo gekündigt, ausgeloggt. Beim erneuten Login erscheint statt des Dashboards
die Plan-Auswahl. "Vielleicht später" führt in eine Ansicht ohne jedes Bedienelement. Erneuter
Login + Plan-Klick antwortet "Du hast bereits ein Abo". Kein Weg ins Dashboard, kein Weg zu
einem neuen Abo.

## 2. Ursache: ein Zustand, den das System nicht mehr verlassen kann

Zwei Prädikate beantworten dieselbe Frage ("braucht/hat dieser Tenant ein Abo?") aus **zwei
verschiedenen Feldern, die nie synchron gehalten werden**:

| Wer fragt | Liest | Ergebnis nach Kündigung |
|---|---|---|
| Dashboard-Zugang (`webAuth`, active-only, `src/web-auth.js:760`) | `account.status` | `suspended` → **403** → Client zeigt Plan-Picker (`apps/web/src/lib/api.js:742-753`) |
| Checkout-Gate (`hasActiveSubscription`, `src/billing/subscribe.js:82-84`) | `stripeSubscriptionId` | truthy → **409 `already_subscribed`** |

Der verbindende Defekt liegt im Schreibpfad: der SUSPEND-Zweig des Stripe-Webhooks
(`src/billing/webhook.js:395-429`) setzt `status=suspended` (`:408`), invalidiert alle Sessions
(`:414`) — ruft aber **an keiner Stelle `store.setTenantSubscription`** auf. Auch
`attemptContractEndCleanup` (`src/billing/contract-end-cleanup.js`) fasst die Abo-Felder nicht an
(es gibt nur Rufnummer frei und löscht die WorkOS-Identität). Nachgeprüft: **kein einziger
Aufrufer von `setTenantSubscription` im gesamten `src/` nullt `subscriptionId`.**

Damit behauptet das Feld dauerhaft "es gibt ein Stripe-Abo", obwohl bei Stripe keines mehr
existiert. Das Guard-Prädikat ist nicht falsch — **die Daten lügen**.

## 2a. Live-Beleg (Render-Postgres, gelesen 2026-09-06 mit Owner-Freigabe)

Der betroffene Tenant `t_user_01KXH2B75W…` steht exakt im vorhergesagten Zustand:

| Feld | Wert | Bedeutung |
|---|---|---|
| `status` | `suspended` | → 403 auf `/state` → Plan-Picker |
| `stripe_subscription_id` | gesetzt | → 409 `already_subscribed` |
| `stripe_cancel_at_period_end` | `true` | Vertrag endete durch **Kündigung**, nicht durch Zahlungsausfall |
| `suspended_at` | 2026-08-24 | Vertragsende |
| `number_release_pending` / `workos_delete_pending` | `false` / `false` | Vertragsende-Cleanup ist **vollständig durchgelaufen** |

Konsequenz: die Rufnummer ist freigegeben (Tabelle `number` ist leer) und die WorkOS-Identität
wurde gelöscht. Die Diagnose aus Abschnitt 2 ist damit nicht Theorie, sondern der gemessene
Produktionszustand.

## 2b. Dritte Schicht (nur an den Live-Daten sichtbar): der neue Login erbt den toten Tenant

Weil die WorkOS-Identität beim Vertragsende gelöscht wurde, erzeugte der Login-Versuch am
2026-09-06 eine **neue** Identität (neuer `sub`). Der Email-Dedup am Web-Login
(`resolveOrCreateTenant`, `src/web-auth.js:520-536`) hängt diesen neuen `sub` an den
**alten, toten Tenant** — denn er schließt als Merge-Ziel nur `closed` aus, nicht `suspended`.

Der Code-Kommentar an genau dieser Stelle (`src/web-auth.js:497-505`) beschreibt diesen Ausgang
wörtlich als das, was verhindert werden sollte: *"landet ein brandneuer sub dauerhaft auf einem
toten Tenant und bekommt nach jedem Login 403 ohne Ausweg."* Die Schutzregel deckt nur `closed` —
ein durch Kündigung beendeter Vertrag bleibt aber `suspended`.

Damit stehen jetzt **zwei `account`-Zeilen** derselben Email auf demselben Tenant (alter, gelöschter
`sub` + neuer). Das ist nicht folgenlos: `accountByTenant` (`src/web-auth.js:632-639`) liefert bei
mehr als einer Zeile `null`. Email-abhängige Funktionen degradieren dadurch still — der
Dashboard-Prefill (`src/self-service-routes.js:289`) und der Empfänger-Lookup
(`:473`). Der Vertragsende-Cleanup löscht den WorkOS-User, räumt die zugehörige
`account`-Zeile aber nicht ab.

**Lebenszyklus-Frage, die dahinter steckt (Owner-Entscheidung, s. Abschnitt 7):** `suspended` trägt
heute zwei unvereinbare Bedeutungen — "vorübergehend, erholt sich" (Dunning) und "Vertrag beendet,
Identität und Nummer sind weg". Solange beides denselben Status hat, kann weder der Dedup noch das
Checkout-Gate das eine vom anderen unterscheiden.

## 3. Warum keiner der drei Auswege trägt

1. **Neu abonnieren** — blockiert von `already_subscribed` (`src/self-service-routes.js:657-658`,
   `src/billing/subscribe.js:99/158/182`), Client-Text `apps/web/src/lib/subscribe.js:68`.
2. **`POST /api/self-service/billing/resume`** (`src/self-service-routes.js:861-890`) — hängt
   hinter `webAuthMw` (active-only) → 403, bevor der Handler läuft. Setzt außerdem nur
   `cancel:false` auf ein noch lebendes Abo, nicht auf ein gelöschtes.
3. **Stripe-Billing-Portal** — im Code nicht vorhanden (0 Treffer für `billing_portal` in `src/`
   und `apps/web/src/`).

Zusatzbefund (eigener Fehler, eigener Fix): **"Vielleicht später"**
(`apps/web/src/pages/app/index.astro:69` → `dismissPlanChoice`,
`apps/web/src/lib/subscribe.js:316-321`) ist rein kosmetisch — kein API-Call, blendet die
Plan-Kacheln und sich selbst aus und hinterlässt eine Ansicht ohne Link, Button oder Retry.
Einziger Rückweg: manueller Reload, der nirgends angeboten wird.

Zusatzbefund 2 (eigene Entscheidung nötig): `POST /api/admin/tenants/:id/approve`
(`src/web-auth.js:813`) — der manuelle Reaktivierungspfad — hängt selbst hinter `webAuth`
(active-only). Ist der einzige Admin suspendiert, sperrt er sich aus dem eigenen Notausgang aus.

## 4. Fix-Design

**Wurzel liegt auf der Schreibseite. Dort wird repariert, nicht am Guard.**

Warum nicht am Guard: `hasActiveSubscription` auf `status` umzustellen, würde einen Tenant im
Dunning (`invoice.payment_failed` → ebenfalls `suspended`, dessen Stripe-Abo aber **weiterlebt**)
ein zweites Abo kaufen lassen. Das ist genau der Doppelabbuchungs-Schutz, den der Kommentar
`src/billing/subscribe.js:87-90` benennt. Geld-Risiko, nicht akzeptabel.

| # | Baustein | Inhalt |
|---|---|---|
| B1 | **Ereignis-Typ trennen** | `interpretStripeEvent` (`webhook.js:109`) faltet `customer.subscription.deleted` und `invoice.payment_failed` beide auf `action=suspend` und verliert dabei den Typ. Der Typ muss bis in den SUSPEND-Zweig durchgereicht werden. |
| B2 | **Referenz nur beim echten Ende entwerten** | Bei `deleted` (= Abo existiert bei Stripe nicht mehr): `setTenantSubscription(tenant, { subscriptionId: null, ... })`. Bei `payment_failed`: **an den Referenzen nichts ändern**. |
| B3 | **Bestandsdaten heilen** | Reconcile gegen Stripe: für jeden Tenant mit `subscriptionId` + `status != active` die Subscription abrufen; nur bei "existiert nicht / canceled / incomplete_expired" das Feld leeren. **Kein Blind-Update.** |
| B4 | **Sackgasse schließen** | "Vielleicht später" bekommt einen echten Ausgang (Logout / zurück zur Website) oder entfällt. Kein Zustand ohne Bedienelement. |
| B5 | **Verwaiste `account`-Zeile** (aus 2b) | Der Vertragsende-Cleanup löscht den WorkOS-User, lässt dessen `account`-Zeile aber stehen → `accountByTenant` wird mehrdeutig und liefert `null`. Zeile mit-abräumen **oder** `accountByTenant` deterministisch machen (jüngste Zeile gewinnt). Owner-Entscheidung, s. Abschnitt 7. |

Offene Implementierungsdetails, die beim Bauen zu klären sind (nicht raten, am Code prüfen):
`planSlug` mit-leeren? — er speist `deriveTenantBudgetFromPlan` (`src/store/pg.js:699`) und
`showTiles` im Billing-Tab (`apps/web/src/components/app/BillingIsland.astro:238`). Und: akzeptiert
`setTenantSubscription` (`src/store/state-ops.js:2174-2219`) `null` im Patch, oder ist der Setter
fail-closed gegen Null-Werte?

Nach dem Fix ist die Schleife geschlossen: `webAuthAllowPending` (`src/web-auth.js:767`) lässt
`suspended` auf `setup-checkout`/`subscribe` durch, und `activatePaidTenant`
(`src/billing/activation.js:86-112`) setzt `clearSuspendedAt` + `status=active` — der bezahlende
Rückkehrer landet wieder im Dashboard.

## 5. Pre-Mortem (ein Jahr später, der Fix war falsch)

| Was passiert wäre | Gegenmaßnahme im Plan |
|---|---|
| `subscriptionId` auch bei `payment_failed` geleert → Kunden im Dunning kaufen ein zweites Abo, doppelte Abbuchung, Chargebacks | B1+B2: nur der `deleted`-Zweig entwertet; eigener Regressionstest für `payment_failed` |
| Guard auf `status` umgestellt statt Daten repariert → derselbe Doppelabbuchungspfad | bewusst verworfen, s. Abschnitt 4 |
| Bestand blind bereinigt → ein Tenant mit **lebendem** Abo verliert die Referenz; Kündigung/Resume unmöglich, Stripe bucht weiter ab | B3 reconciled gegen Stripe statt zu raten |
| Nur die UI gefixt (Picker versteckt) → Lockout bleibt, nur unsichtbar | Fix sitzt im Schreibpfad |

## 6. Verifikation (jeder Punkt ein Test, `node:test`)

1. `customer.subscription.deleted` → `status=suspended` **und** `subscriptionId === null`.
2. `invoice.payment_failed` → `subscriptionId` **unverändert** (Doppelabbuchungs-Schutz).
3. Nach (1): `POST /api/self-service/billing/setup-checkout` liefert **nicht** 409.
4. Nach (2): `setup-checkout` liefert **weiterhin** 409 `already_subscribed`.
5. Reconcile (B3) lässt ein lebendes Abo unangetastet.
6. Smoke: Server lokal, `curl` auf `/api/self-service/state` + `setup-checkout`.

Danach `npm test` (muss grün bleiben), `node --check` auf die berührten Dateien.

## 7. Offene Entscheidungen (Owner)

1. ~~Live-Zustand lesen?~~ **erledigt 2026-09-06**, Ergebnis in Abschnitt 2a/2b.
2. **Lebenszyklus nach Vertragsende (die eigentliche Architekturfrage, aus 2b):** ist ein durch
   Kündigung beendeter Vertrag *beendet* (`closed` → der Rückkehrer bekommt einen frischen
   Tenant, verliert aber Gesprächshistorie) oder *geparkt* (`suspended` → derselbe Tenant lebt
   weiter und wird durch ein neues Abo reaktiviert, Historie bleibt)? Heute macht der Code
   keines von beidem konsistent. Empfehlung: **geparkt** — mit B1/B2 funktioniert die
   Reaktivierung, `activatePaidTenant` (`src/billing/activation.js:86-112`) setzt
   `clearSuspendedAt` + `active`, ein neues Abo bringt eine neue Nummer, die Historie bleibt.
   Dann ist B5 Pflicht (sonst wächst die Mehrdeutigkeit bei jeder Rückkehr).
3. **Sofort-Entsperrung deines Accounts:** der Code-Fix allein reicht für dich nicht — dein
   Datensatz trägt die tote `subscriptionId` weiterhin. Nötig ist B3 (Reconcile) gegen die
   Produktionsdatenbank. Alternative Sofortmaßnahme: `POST /api/admin/tenants/<id>/approve` über
   den vorhandenen aktiven Admin-Account (`role=admin`, Adresse steht im `account`-Table) — das
   setzt dich auf `active` und öffnet das Dashboard, lässt aber die tote `subscriptionId` stehen
   (du wärst drin, aber ohne laufendes Abo und ohne Nummer).
4. **Admin-Notausgang** (Zusatzbefund 2): soll `approve` aus dem active-only-Gate raus? Eigene
   Sicherheitsentscheidung, nicht Teil dieses Fixes.
