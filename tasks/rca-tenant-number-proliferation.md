# RCA: Tenant- und Nummern-Proliferation (derselbe Mensch, mehrere Tenants + DIDs)

Stand: 2026-07-10. Read-only-Analyse (Code + Render-Logs + Telnyx-API + Stripe-Test-API).
Live-Postgres war nicht abfragbar (SSL/TLS required) und der Live-Stripe-Key war nicht
einsehbar. Belegte Aussagen und offene Annahmen sind unten scharf getrennt.

---

## 1. TL;DR

**Was passiert:** Ein und derselbe Mensch (mutmasslich Antonio,
<owner-mail>) taucht am 2026-07-10 unter drei verschiedenen
Tenant-IDs auf (`t_user_01KWKXZ3...`, `t_user_01KX5TCC...`, `t_user_01KX600834...`), plus
ein vierter aelterer aus dem 07-06 (`user_01KWSDW4...`). Jeder Tenant startet bei Null:
kein geerbtes Budget, kein KYC, keine Nummer. Sobald einer davon ein Abo **aktiviert**,
kauft Hermes automatisch eine **neue, echte Telnyx-DID** und oeffnet das Outbound-Gate.

**Wurzel:** Die Tenant-Identitaet ist 1:1 an den rohen OIDC-`sub`-Claim gekoppelt
(`tenantId = t_<sub>`, `src/store/defaults.js:141`). Es gibt **nirgends** eine
Email-Deduplizierung. Ein neuer WorkOS-`sub` fuer dieselbe Person erzeugt garantiert einen
komplett neuen Tenant. WARUM WorkOS mehrere subs pro Person ausgibt, liegt **ausserhalb
dieses Codes** (WorkOS/Login-Schicht) und ist von hier nicht belegbar.

**Was Geld kostet (belegt):**
- **Telnyx: 4 aktive US-local-DIDs** (`+18643028341`, `+17403094880`, `+15597576128`,
  `+17067101036`), Listenpreis ab **1 USD/Monat/Nummer** -> Untergrenze **ca. 4 USD/Monat
  (~3,7 EUR/Monat)**. Die tatsaechlich abgerechnete Miete pro DID liefert kein Telnyx-API-Feld.
  Telnyx-Restguthaben: **3,97 USD** (nahe Erschoepfung).
- **Stripe:** Der einsehbare Key ist **TEST-Mode** (`livemode=false`). Dort: 45 Customer-Objekte,
  **13 gleichzeitig aktive Abos** (8x Business 999 EUR-Cent, 5x Starter 499 EUR-Cent), mehrfach
  auf dieselbe Email (<firmen-mail> 4x, <kunde-a> 3x). Das ist **kein echtes
  Geld** und **nicht** dieselbe Umgebung wie die Live-Vorgaenge vom 07-10. Der reale
  Live-Stripe-Betrag ist **unbekannt** (Live-Key nicht einsehbar).

**Monatliche Ist-Kosten des Leaks:** Telnyx **ca. 4 USD/Monat (belegt, Floor)**. Stripe-Anteil
**unbekannt** (Live nicht messbar). Jede weitere Abo-Aktivierung unter neuer Identitaet fuegt
eine weitere DID-Miete hinzu; bei Kuendigung wird **keine** DID freigegeben (siehe Nebenbefund).

---

## 2. Kausalkette: "neuer Claude-Connector / neuer Login" -> "neue DID gekauft"

Jeder Schritt mit Datei:Zeile. Belegt aus Code; der WorkOS-Trigger (Schritt 1) ist Annahme.

1. **Neue Auth-Identitaet entsteht.** Antonio meldet sich erneut an (neuer Connector, anderes
   Login-Verfahren, abgebrochener Signup o.ae.). WorkOS gibt einen **neuen `user.id`/`sub`** aus.
   *Warum WorkOS das tut, ist hier nicht belegbar* — reine Identitaets-Schicht, ausserhalb Hermes.
   Wichtig: Ein Re-Login mit DEMSELBEN WorkOS-Account liefert DENSELBEN sub -> DENSELBEN Tenant.
   Ein neuer Tenant entsteht NUR bei neuem sub.

2. **Web-Login mappt den sub deterministisch auf einen frischen Tenant.**
   `src/web-auth.js:445-462` `upsertOnFirstLogin({sub, email})`:
   `const tenantId = tenantIdForSubject(sub)` ->
   `INSERT INTO tenant (id, status, idp_subject) VALUES ($1,'suspended',$2)
   ON CONFLICT (id) DO UPDATE ...`. Der Konflikt-Schluessel ist die **tenantId** (bzw. `sub`),
   **nie die email**. Die email landet nur im `account`-Record, fliesst in **keinen** Dedup-Check.
   - `src/store/defaults.js:141` `tenantIdForSubject = (sub) => t_${sub}` — nur der sub zaehlt.
   - Schema `src/db/schema.sql:356-365`: `account.email` hat **keine** UNIQUE-Constraint;
     `tenant_id` ist absichtlich nicht-unique (Multi-Account-pro-Tenant vorgesehen, aber nie fuer
     Identitaets-Merge verdrahtet).

3. **MCP-/REST-Kanal loest identisch auf.** `src/server.js:2350-2361`,
   `src/routes/_tenant.js:131-154`: `const sub = req.auth ? req.auth.sub : null;
   store.resolveTenant(sub)`. `src/store/state-ops.js:1600-1604` `resolveTenant` sucht **nur**
   Exact-Match auf `t.idpSubject === idpSubject`, sonst `null` -> TENANT_REJECT. Auch hier
   **kein** Email-Fallback. (Beide Kanaele teilen denselben WorkOS-Issuer und liefern fuer
   denselben User denselben sub — die "getrennte Identitaets-Pools"-These ist widerlegt, s. 5.)

4. **Der neue Tenant erbt nichts.** `src/store/state-ops.js:743-764` `registerTenant`: bei
   fehlendem Tenant wird ein komplett neuer Record `{id, status: ACTIVE}` erzeugt +
   `seedTenantDefaultBudget(...)`. Kein Uebernahme-Pfad vom alten Tenant: kein Budget-Verbrauch,
   kein kycLevel, keine Nummer, keine Call-Historie (die bleibt an der ALTEN tenantId haengen und
   ist fuer die Person unsichtbar, weil sie nie wieder denselben sub bekommt).

5. **Self-Service-Checkout laeuft ueber den Session-Cookie-Tenant.**
   `src/self-service-routes.js:304-306`
   `router.post('/api/self-service/billing/setup-checkout', webAuthPendingMw, ...)` — Identitaet
   kommt ausschliesslich aus `req.tenant.tenantId` (Session), nicht aus MCP. Beide 07-10-Vorfaelle
   (10:50 `...149KPR`, 12:28 `...KWZMTH`) liefen ueber genau diesen Endpunkt.

6. **Ohne Karte: Ablehnung, kein Kauf.** `self_service_subscribe_rejected reason=no_card` (10:50,
   Tenant `...149KPR`). Dieser Tenant provisioniert NICHTS. (Kauf haengt an der Aktivierung, nicht
   an der Tenant-Erzeugung.)

7. **Mit Karte + Abo-Aktivierung: Stripe-Webhook macht den Tenant scharf.**
   `src/billing/activation.js:47-71`: Reihenfolge `KYC -> Status -> provision -> Profil`.
   `store.setKycLevel(tenant, KYC_LEVEL.CARD)` (Z.62) **oeffnet das Outbound-Gate**, gefolgt von
   automatischem Provisioning ueber `src/billing/provision-trigger.js:25-63`
   `requestNumberForPaidTenant`. Log-Beleg: `stripe_webhook_activate tenant=...KWZMTH` 12:29:26Z.

8. **Stripe-Customer wird ohne Dedup angelegt.** `src/billing/card-setup.js:15-22` `ensureCustomer`:
   liest `store.tenantStripe(tenant).customerId`, legt bei Fehlen einen neuen Customer an. Dedup
   ist **pro tenant_ref**, nicht pro Mensch/Email. `src/billing/stripe.js:164-173` `createCustomer`
   sendet **weder email noch name** an Stripe, nur `metadata[tenant_ref]` — Email-Dedup strukturell
   unmoeglich. (Belegt im Test-Mode: 3 Customer-Objekte fuer dieselbe Email; selber Code, andere
   Umgebung als Live.)

9. **Provisioning kauft eine echte, neue DID.** Der neue Tenant hat 0 Nummern.
   `src/store/state-ops.js:1043-1052` `requestNumber`: globaler Cap
   `liveNumbers(s).length >= maxNumbers` + per-Tenant-Cap
   `liveNumbers(s, tenantId).length >= maxNumbersPerTenant` — beide zaehlen pro Tenant/global,
   **nie pro Mensch**. Der frische Tenant startet bei 0, also greift der per-Tenant-Cap nicht.
   `src/onboarding.js:70,84`: Idempotency-Key `order_${numberId}` schuetzt nur Retry desselben
   Jobs, nicht neue Bestellungen. Ergebnis: **Telnyx-Nummernkauf** `+17067101036` 12:29:29Z
   (3 Sekunden nach dem Webhook, sekundengenau korreliert).

10. **Outbound offen.** 12:31:49Z `place_call ... requestedBy=user_01KX600834...` — der neue Tenant
    telefoniert. Der Guard `MAX_NUMBERS_PER_TENANT` (strikt 1 Nr/Tenant) war wirkungslos, weil er
    pro tenantId zaehlt, und die tenantId ist neu.

**Netto:** Ein neuer sub -> neuer Tenant -> (falls Abo aktiviert) neuer Stripe-Customer + neue DID.
Am 07-10 real **einmal** vollzogen (`...KWZMTH` -> `+17067101036`); die anderen beiden Tenants des
Tages kauften nichts (einer no_card, einer nur MCP-Session).

---

## 3. Kostenbild

### Stripe (nur TEST-Mode einsehbar)
- Key aus lokalem `.env` ist **Test-Mode** — belegt via `livemode=false` in jeder API-Antwort.
- **45 Customer-Objekte** (`limit=100`, `has_more=false` -> vollstaendig). Davon **30 ohne Email,
  15 mit Email** (explizit None-vs-Leerstring nachgezaehlt; None=30, gesetzt=15). Drei Emails auf
  mehreren Customer-Ids: <firmen-mail> (5x), <owner-mail> (3x:
  cus_<redigiert>, cus_<redigiert>, cus_<redigiert>), <kunde-a> (3x).
- **13 gleichzeitig aktive Abos** (`status=all`, `has_more=false`), ALLE `active`: 8x
  `Hermes Business monthly` (price_1TmqEL..., 999 EUR-Cent), 5x `Hermes Starter monthly`
  (price_1TmqEK..., 499 EUR-Cent). Summe 10487 EUR-Cent = **104,87/Monat testmode-Einheiten**.
  <firmen-mail> haelt 4 parallele Abos (34,96), <kunde-a> 3 (19,97).
- **Modus:** test. **Echtes Geld: 0** auf dieser Achse. Der Live-Stripe-Stand (die eigentlichen
  07-10-Vorgaenge liefen gegen den Live-Key) ist **nicht messbar** -> **unbekannt**.
- Randbefund: Test-Preise lauten auf **EUR**, die Memory-Notiz dokumentiert **USD** (Starter $4.99 /
  Business $9.99). Test/Live-Katalog-Drift oder Absicht — ungeprueft.

### Telnyx (via API verifiziert)
- **4 aktive DIDs**, alle `phone_number_type=local` (nicht toll-free), alle an Connection
  `Hermes` (`2982643896460248193`):

  | DID | Status | Gekauft | Tenant-Zuordnung |
  |-----|--------|---------|------------------|
  | +18643028341 | active | 2026-06-14T09:22:08Z | **offen** (keine Log-/Memory-Evidenz) |
  | +17403094880 | active | 2026-07-01T08:22:15Z | **offen** (keine Log-/Memory-Evidenz) |
  | +15597576128 | active | 2026-07-06T09:08:42Z | schwach: Memory `user_01KWSDW4...` (nicht primaer belegt) |
  | +17067101036 | active | 2026-07-10T12:29:29Z | **stark**: `t_user_01KX600834...` (sekundengenau, place_call bestaetigt) |

- **Miete:** Listenpreis ab **1 USD/Monat/Nummer** (local). Floor gesamt **~4 USD/Monat
  (~3,7 EUR)**. Exakte Ist-Miete liefert kein API-Feld (`/v2/phone_numbers`,
  `/voice`, `/billing_groups` alle ohne Rent-Feld; `/v2/billing_groups` total_results=0).
- **Guthaben:** 3,97 USD.
- **Apps:** `/v2/call_control_applications` LEER. `/v2/texml_applications` = 5 Apps: die produktive
  `Hermes` (2982643896460248193, alle 4 DIDs) + 4x `ai-assistant-<uuid>`.
  `/v2/ai/assistants` = 4 (1x `Hermes` assistant-dcf48d08, 3x `Blank`/Kimi-K2.6).

---

## 4. Nebenbefunde

**(a) Webhook-Race `already_subscribed`/`profile=none` — bekannt und gefixt, NICHT die Leak-Ursache.**
Das Muster `subscribe_rejected reason=no_card` -> `setup_checkout` -> `stripe_webhook_activate` ->
`subscribe outcome=already_subscribed profile=none` entsteht **innerhalb EINES tenant_ref**: der
Stripe-Webhook und der Browser-Return-Call schreiben gegen dieselbe Ressource.
`src/billing/subscribe.js:92` (hasActiveSubscription-Gate) und `:145-151` (customerMatches +
hasCardOnFile-No-op-Return, profile-frei) fangen den zweiten Schreiber ab -> **kein** zweites Abo
pro tenant_ref. Das ist der dokumentierte Race (Memory `bill-race-webhook-card-bind`, Fix 0d3d110).
Einschraenkung: Bei einem Cross-Plan-Race mit abweichender subscriptionId KANN ein zweites Abo pro
tenant_ref entstehen (`subscribe.js:177-180`, reason=subscription_conflict) — in den 07-10-Logs
tritt dieser Zweig nicht auf. Kosten dieses Mechanismus selbst: **0**.

**(b) Kein DID-Release-Lifecycle bei Kuendigung/Loeschung — struktureller, latenter Leak.**
`grep -rn releaseNumber src/` liefert genau einen Aufrufer: `src/onboarding.js:178-179`, im
**Provisioning-FAILED-Rollback**. Der Stripe-Suspend-Pfad
(`src/billing/webhook.js:121-126` DELETED->SUSPEND, `:228-240`) macht NUR
`accounts.setStatus(tenant,'suspended')` + `sessions.invalidateByTenant` + Audit — **kein**
Release. Auch der Store-Level-`releaseNumber` (`state-ops.js:1117`) haengt nur am Failed-Rollback;
kein manueller Admin/CLI-Pfad. Folge: Jede gekaufte DID bleibt bei Telnyx `active` und
mietkostenpflichtig, auch nach Kuendigung/Suspend. Env- und Stripe-Mode-unabhaengig (reine
Struktur). In den 07-10-Logs LATENT (kein subscription.deleted-Event) — der sichtbare Treiber ist
die Multi-Identitaet, nicht eine Kuendigung. Pro Tenant auf 1 verwaiste DID begrenzt (Cap 1/Tenant);
Multiplikator ist die Zahl distinkter Tenants.

**(c) DSGVO / eraseTenantData gibt die DID NICHT frei.** `src/store/state-ops.js:240-275`
`eraseTenantData` (Art. 17) mutiert explizit NUR calls/actionItems/notifications/tenant.privateNumber;
Kommentar `:245-246` sagt woertlich, dass settings/profiles/**numbers**/calendar/usage bewusst
UNANGETASTET bleiben. Konsequenz: Auch bei Loeschung eines Tenants bleibt seine aktive DID bei
Telnyx bestehen und kostet weiter — zusaetzlich zum Aspekt (b).

**(d) Verwaiste ai-assistant-TeXML-Apps — KEIN Geld-Leak, aber Config-Muell.**
`/v2/texml_applications` zeigt 4x `ai-assistant-<uuid>`, je 1:1 an einen `/v2/ai/assistants`-Eintrag
gekoppelt. Keine der 4 aktiven DIDs zeigt auf eine dieser Apps (alle -> `Hermes`
2982643896460248193). Laut Telnyx-Pricing (Conversational AI, $0.05/min, kein Setup-/Fixkosten-Feld)
kosten inaktive Assistants/Apps ohne Anrufvolumen **0**. **Wichtig:** Nur **3** der 4 sind echte
Waisen (die `Blank`/Kimi-K2.6-Assistants + ihre `ai-assistant-*`-Apps, alle 2026-06-15, NICHT von
unserem Skript). Das 4. Paar (assistant-dcf48d08 `Hermes` 2026-07-09 + zugehoerige
`ai-assistant-dcf48d08`-App) ist das **absichtlich gestagte** Hermes-AI-Assistant-Artefakt aus der
P1-P10-Kette fuer den ausstehenden P11-Cutover (Flag AUS). **Nicht loeschen.**

**(e) Globaler Cap ist Owner-Phasen-Notbremse, kein Mensch-Schutz.** `src/config.js:348-363`:
`MAX_NUMBERS` (lokaler Default 5) ist laut Code-Kommentar bewusst als globaler Blast-Radius fuer die
zahlungsfreie Onboarding-Phase gedacht, kein Payment-Gate. `state-ops.js:1047-1050` zaehlt
plattformweit (`liveNumbers(s)` ohne tenantId-Filter), inkl. requested/provisioning/active/suspended
(`occupiesCapacity`, `:989-990`). Der Live-Wert von `MAX_NUMBERS` ist **nicht bestaetigbar**
(`get_service` liefert keine Env-Werte). Der erfolgreiche 4.-Kauf am 07-10 beweist nur
`maxNumbers >= 4` zum Kaufzeitpunkt. Natuerlicher Backstop: Telnyx-Guthaben 3,97 USD (historisch
HTTP 402 -> Provisioning-Stop).

---

## 5. Ausgeschlossen (geprueft und widerlegt)

- **"MCP-OAuth und Web-Login bedienen verschiedene Identitaets-Pools, daher die abweichenden subs."**
  **Widerlegt.** Die Codepfade sind zwar strukturell verschieden (MCP = Resource-Server-JWT-Verify
  ohne Code-Exchange, `src/auth.js:74-92`; Web = eigener Code-Exchange gegen
  `/user_management/authenticate` mit `sub=user.id`, `src/web-auth.js:385-424`), aber beide loesen
  den Tenant IDENTISCH auf (`t_<sub>` via `tenantIdForSubject`) ueber denselben Schluessel
  `idp_subject`. Beide teilen denselben WorkOS-AuthKit-Issuer (`OAUTH_ISSUER_URL`). Kommentar
  `web-auth.js:407-410` fixiert genau das als Design: user.id == access_token-sub == EINE
  Identitaetsquelle fuer Web UND MCP. Fuer denselben WorkOS-User liefern beide denselben Tenant.
  Kein Per-Kanal-Pool-Split. Die abweichenden subs stammen aus der WorkOS-Schicht, nicht aus einem
  Hermes-Kanal-Split.

- **"Der billing-Webhook-Race erzeugt das zweite Abo."** Ausgeschlossen fuer den beobachteten Fall
  (s. 4a): pro tenant_ref maximal 1 aktives Abo (13 Subs auf 13 verschiedene Customer-Ids, keine
  Customer-Id doppelt in der Sub-Liste). Der Race ist ein No-Op, keine Kostenursache.

- **"createCustomer ohne email/name ist die Wurzel des 3-Tenant-Leaks."** Ausgeschlossen als
  *Wurzel*: Das ist ein **Downstream-Symptom**. Selbst mit email/name im Customer blieben es drei
  Tenants (drei subs). Die Wurzel liegt in der sub-basierten Tenant-Ableitung
  (`store/defaults.js:141`), nicht in Stripe.

---

## 6. Fix-Plan (priorisiert)

Safety-Gates (CLAUDE.md Regel 1-7) bleiben unangetastet: Allowlist/Denylist/Budget/Max-Dauer/
Signaturpruefung, Offenlegungssatz, Auth-fail-closed, Disclosure. Keiner der Fixes weicht diese auf.

### Fix 1 (WURZEL, hoechste Prio): Identitaets-Aufloesung ueber verifizierte Email statt blind ueber sub
**Dateien:** `src/web-auth.js:445-462` (upsertOnFirstLogin), `src/server.js:1949-1961` (Onboard),
zusaetzlich MCP-Arm: `src/store/state-ops.js:1600-1604` (resolveTenant) + Mapping-Tabelle/Schema
`src/db/schema.sql:356-365`, Gate-Logik `src/web-auth.js:316-333` (claimsFromPayload).
**Aenderung:** Vor dem Anlegen eines neuen Tenants zuerst
`SELECT tenant_id FROM account WHERE email=$1 LIMIT 1` (nur bei `email_verified===true`); bei Treffer
die bestehende tenantId wiederverwenden und den neuen sub als **zusaetzliche** account-Zeile auf
denselben tenant_id mappen (Schema erlaubt das bereits, `tenant_id` nicht-unique). Fuer den MCP-Arm
reicht der Web-Fix NICHT: `resolveTenant` loest ueber die einwertige `tenant.idp_subject`-Spalte auf
— es braucht einen mehrwertigen sub->tenant-Resolver (Mapping-Tabelle), sonst rejectet ein gemergter
sub im MCP-Kanal. Deterministische Merge-Regel (z.B. **aeltester Tenant gewinnt**), damit
bestehende MCP-Tokens mit altem sub weiter denselben kanonischen Tenant treffen.
**Risiko / Account-Takeover (explizit):** Email-basiertes Merging ist ein **Account-Takeover-Vektor,
wenn die email nicht wirklich verifiziert ist**. Eine ungeprueft akzeptierte Email wuerde fremde
Konten (Anrufhistorie, aktive Nummer, laufendes Abo, Outbound-Berechtigung) fuer jeden
uebernehmbar machen, der dieselbe Adresse behauptet (verwaiste/wiederverwendete Mailbox,
Tippfehler-Domain). **Mitigation, nicht verhandelbar:** Merge NUR bei
`email_verified===true` (`claimsFromPayload`-Gate `web-auth.js:321` wiederverwenden, NICHT
aufweichen). Ist die Email nicht verifiziert -> KEIN Merge, normaler neuer Tenant.
**Pre-Mortem (ein Jahr spaeter, Fix war falsch):** (i) Jemand hat ueber eine unverifizierte oder
recycled Mailbox einen fremden Tenant inkl. aktiver DID + Abo uebernommen -> Ursache waere ein
aufgeweichtes email_verified-Gate; deshalb hart gaten. (ii) Der Merge war nicht deterministisch,
zwei subs mergten in unterschiedliche Richtungen -> Ketten-Divergenz, MCP-Token rejectet;
deshalb "aeltester gewinnt" + Transitivitaet. (iii) Der Fix ist **praeventiv, nicht retroaktiv** —
die 4 bereits existierenden Tenants/DIDs bleiben (siehe Aufraeum-Checkliste). (iv) Wirksamkeit
haengt an der (hier unverifizierbaren) Annahme, dass alle subs dieselbe verifizierte Email tragen —
vor Rollout an der Live-DB gegenpruefen.

### Fix 2 (Kosten-Bremse, hohe Prio): DID-Release im Suspend-/Loesch-Pfad
**Dateien:** `src/billing/webhook.js:228-240` (SUSPEND-Zweig), optional
`src/store/state-ops.js:240-275` (eraseTenantData), Release-Port
`src/telephony/adapters/telnyx/numbers.js` + Store-`releaseNumber` (`state-ops.js:1117`).
**Aenderung:** Bei `customer.subscription.deleted` / final gescheiterter Zahlung (nach Karenzzeit!)
die aktive DID des Tenants freigeben — ODER, sicherer, ein **Reconcile-Runbook/Job**, der active-DIDs
suspendierter Tenants auflistet und nach Bestaetigung freigibt (nicht sofort-hart im Webhook).
**Risiko / Rufnummern-Verlust (explizit):** Ein Auto-Release ist ein **Rufnummern-Verlust-Risiko fuer
zahlende Kunden**. Eine voruebergehend gescheiterte Zahlung (Karte laeuft ab, wird erneuert) wuerde
sonst die Nummer des Kunden unwiederbringlich loeschen — Telnyx gibt dieselbe DID nach Release nicht
garantiert zurueck. **Mitigation:** Release NIE beim ersten payment_failed, sondern erst nach
definierter Grace-Period + Reaktivierungs-Fenster; bevorzugt manuell/reconcile statt sofort im
Webhook. Idempotent + Audit.
**Pre-Mortem:** (i) Ein Kunde verlor seine seit Monaten genutzte Geschaeftsnummer wegen einer
2-Tage-Zahlungsluecke -> zu aggressives Release ohne Grace; deshalb Karenz + Reconcile statt
Sofort-Delete. (ii) Race: Release laeuft, waehrend der Kunde gerade reaktiviert -> Idempotenz +
Status-Recheck vor dem DELETE.

### Fix 3 (Guard, mittlere Prio): Mensch-Dimension in den Provisioning-Cap
**Dateien:** `src/store/state-ops.js:1043-1052` (requestNumber), `src/billing/card-setup.js:15-22`
(ensureCustomer), `src/billing/stripe.js:164-173` (createCustomer).
**Aenderung:** Nachgelagerter Schutz, falls Fix 1 nicht greift: `createCustomer` sollte email+name
mitsenden (Stripe-seitige Sichtbarkeit + Basis fuer Dedup); ensureCustomer optional per
`GET /v1/customers/search?email=` vor Anlegen pruefen. requestNumber koennte zusaetzlich gegen die
verifizierte Email/kanonische Identitaet cappen statt nur gegen tenantId.
**Risiko:** Gering, aber ohne Fix 1 nur Symptom-Daempfung (die drei Tenants blieben getrennt).
**Pre-Mortem:** Falls email an Stripe geschickt wird, ohne dass Fix 1 die Tenants merged, entstehen
weiter getrennte Customer — die Massnahme allein loest den Leak NICHT, nur mit Fix 1 zusammen.

### Fix 4 (Governance, niedrige Prio): Aufraeumen + Cap-Neubewertung
Verwaiste Blank-Assistants/TeXML-Apps loeschen (s. Checkliste), `MAX_NUMBERS` auf einen
skalierungs-tauglichen Wert heben, sobald Payment-Gate + Fix 1 stehen (der globale Cap blockiert
sonst auch legitime neue Kunden). Kein Safety-Gate betroffen.

---

## 7. Aufraeum-Checkliste fuer Antonio

Jede Zeile [sicher] oder [pruefen]. **NICHT anfassen:** die produktiv genutzten Artefakte.

### Telnyx-DIDs (`/v2/phone_numbers`)
- **[NICHT ANFASSEN] +17067101036** — juengste, aktiv genutzte DID des lebenden Tenants
  `t_user_01KX600834...` (place_call 07-10 belegt). Das ist die aktuell produktive Nummer.
- **[pruefen] +15597576128** — mutmasslich `user_01KWSDW4...` (07-06), Zuordnung nur aus Memory,
  nicht primaer belegt. Vor Release den Tenant-/Abo-Status in der Live-DB pruefen; nicht blind loeschen.
- **[pruefen] +17403094880** (Kauf 07-01) — **keine** Tenant-/Abo-Evidenz. Live-DB pruefen: gehoert
  die einem aktiven Abo oder ist sie verwaist? Nur bei bestaetigter Verwaisung freigeben.
- **[pruefen] +18643028341** (Kauf 06-14, aelteste) — **keine** Tenant-/Abo-Evidenz. Gleiche Pruefung.

  Hinweis: Guthaben 3,97 USD. Release senkt laufende Miete, aber Telnyx gibt eine freigegebene DID
  nicht garantiert zurueck — vor jedem Release Nutzungs-/Abo-Status verifizieren.

### Stripe-Abos (nur TEST-Mode einsehbar!)
- **[pruefen] Alle Duplikat-Abos im LIVE-Mode** — der eigentlich relevante Live-Bestand ist mit dem
  vorliegenden Key **nicht** sichtbar. Zuerst im Stripe-Live-Dashboard nach mehrfachen aktiven Abos
  pro Email suchen (v.a. <owner-mail>, <firmen-mail>,
  <kunde-a>), das jeweils juengste/genutzte behalten, die Duplikate kuendigen.
- **[sicher] Test-Mode-Abos (13 aktive)** — reine Testdaten (livemode=false), kein echtes Geld;
  koennen im Test-Dashboard bereinigt werden, ohne Live-Auswirkung. Kein Produktions-Risiko.

### Telnyx TeXML-Apps (`/v2/texml_applications`) und AI Assistants (`/v2/ai/assistants`)
- **[NICHT ANFASSEN] TeXML-App `Hermes` (2982643896460248193)** — traegt ALLE 4 aktiven DIDs. Loeschen
  wuerde die produktive Telefonie killen.
- **[NICHT ANFASSEN] AI Assistant `Hermes` assistant-dcf48d08 (2026-07-09) + zugehoerige
  `ai-assistant-dcf48d08`-TeXML-App** — absichtlich gestagtes P11-Cutover-Artefakt (Flag AUS).
- **[sicher] 3x AI Assistant `Blank` (model Kimi-K2.6, erstellt 2026-06-15) + ihre 3
  `ai-assistant-<uuid>`-TeXML-Apps** — echte Waisen, NICHT von unserem Provisioning-Skript, an keine
  DID gebunden, keine Kosten. Loeschbar (Governance/Klarheit). Vor dem Loeschen der TeXML-Apps
  bestaetigen, dass keine DID `connection_id` darauf zeigt (verifiziert: keine tut es).

---

## Offene Punkte (nicht verifizierbar, read-only)
- **Live-Postgres:** `query_render_postgres` scheitert an `FATAL: SSL/TLS required` (alle 3 IPs,
  einmal versucht, kein Workaround). Reale account/tenant-Zeilen (welche email/idpSubject je sub)
  **nicht** direkt einsehbar — nur aus Code + Render-Log rekonstruiert. Die Gleichsetzung
  "3-4 subs = 1 Mensch" ist auf Log-Ebene **inferiert**, nicht daten-/code-seitig bewiesen.
- **Live-Stripe:** Lokaler Key ist TEST-Mode; Live-Key nicht einsehbar
  (`update_environment_variables` verboten, `get_service` liefert keine Env-Werte). Reale
  Live-Customer/Abo-Population **unbekannt**.
- **Live-Env-Werte** (`MAX_NUMBERS`, `MAX_NUMBERS_PER_TENANT`, `PROVISIONING_ENABLED`): nicht
  bestaetigbar; nur lokale `.env`-Defaults zitiert (5 / 1 / false), die nachweislich NICHT die
  Live-Quelle sind (live wurden real 4 Nummern gekauft -> PROVISIONING_ENABLED live = true).
- **WorkOS-interner Trigger** (warum ein neuer sub pro Person): Dashboard/Connections nicht einsehbar
  -> nur PLAUSIBEL, nicht belegt.
