# RUNBOOK: Stripe Sandbox -> Live (voller Scope)

Ziel: Echtes Geld. Abos (Starter/Pro) UND Hold/Capture beim Onboarding inkl.
echtem Nummernkauf. Kein Code-Change noetig — der Wechsel ist ein reiner
Konfigurations-Cutover (Stripe-Dashboard + Render-Env).

Hinweis Auszahlung: Stripe zahlt auf das im Stripe-Account hinterlegte **Bankkonto**
aus (Standard: automatisch, rollierend). Render ist nur Hosting und bekommt kein Geld.

---

## 0. Vorbedingungen (einmal pruefen)

- [ ] Stripe-Account ist LIVE-aktiviert (Geschaeftsdaten verifiziert, Bankkonto hinterlegt) — laut Owner: ja.
- [ ] Du bist im Stripe-Dashboard und **oben rechts steht NICHT "Testmodus"** (Toggle aus). Alle folgenden Stripe-Schritte passieren im Live-Modus.
- [ ] Render-Zugriff auf den Service `vodafone-agent` (Env-Vars aendern + Deploy ansehen).

## 1. ENTSCHEIDUNGEN (getroffen 2026-07-03)

| # | Entscheidung | Wert | Begruendung |
|---|---|---|---|
| E1 | **Waehrung** | **eur** | Owner-Wunsch EUR; passt zur internen Kosten-Achse (Budget-Guard/`costEur` rechnen bereits EUR) und zu `PAYMENT_CURRENCY=eur` in `render.yaml`. Der Katalog (`src/plans.js` + Spiegel `apps/web/src/lib/plans.js`) wurde auf `eur` umgestellt (Commit noetig, deployt Gateway UND Static-Site). Preise bleiben 499/999 Cents -> 4,99 EUR / 9,99 EUR. |
| E2 | **Setup-Gebuehr pro Nummer** | **500** (= 5,00 EUR) | Deckt die Provider-Nummernkosten (~1 USD/Monat) plus Puffer, niedrige Einstiegshuerde, Ganzzahl > 0. Jederzeit per Env aenderbar, kein Code. |

> Voraussetzung fuer den Cutover: der EUR-Katalog-Commit ist gemergt und beide
> Render-Services (Gateway + hermes-web) sind damit deployt — sonst zeigt die
> Seite USD, waehrend Stripe EUR abbucht.

## 2. Stripe Live: Produkte + Preise anlegen

Dashboard -> Produktkatalog -> Produkt anlegen (2x):

| Produkt | Preis | Intervall | Waehrung |
|---|---|---|---|
| Hermes Starter | 4,99 EUR (= 499 Cents) | monatlich (recurring) | EUR (E1) |
| Hermes Pro | 9,99 EUR (= 999 Cents) | monatlich (recurring) | EUR (E1) |

- Betraege MUESSEN zu `PLAN_CATALOG` in `src/plans.js` passen (amountCents 499/999) — der Katalog liest Stripe nicht, Uebereinstimmung ist Owner-Verantwortung.
- Beide **`price_...`-IDs notieren** (Live-IDs, nicht die Test-IDs!).

**Check:** Beide Preise erscheinen im Live-Produktkatalog als "Wiederkehrend / Monatlich".

## 3. Stripe Live: die 3 Meter anlegen

Dashboard -> Abrechnung/Billing -> Zaehler (Meters) -> 3 Meter anlegen. Der
**event_name muss EXAKT** so heissen (Mapping in `src/billing/stripe.js`,
`STRIPE_METER_EVENT_NAME` — sonst HTTP 400 beim Meter-Flush):

| Meter (Anzeigename frei) | event_name (exakt) | Aggregation |
|---|---|---|
| Voice-Minuten | `voice_minutes` | Summe (sum) ueber `value` |
| AI-Tokens | `ai_tokens` | Summe (sum) ueber `value` |
| Nummern-Monate | `number_months` | Summe (sum) ueber `value` |

**Check:** `POST /api/billing/flush-meters` (Schritt 8) meldet `failed: 0`.

## 4. Stripe Live: Webhook-Endpoint anlegen

Dashboard -> Entwickler -> Webhooks -> Endpoint hinzufuegen (im LIVE-Modus):

- URL: `https://vodafone-agent.onrender.com/webhooks/stripe`
- Events (genau diese 4, siehe `src/billing/webhook.js`):
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- Das **Signing-Secret `whsec_...` notieren** (Live-Secret; das Test-Secret ist ein anderes!).

**Check:** Endpoint steht im Live-Modus auf "Aktiv".

## 5. Stripe Live: Secret-Key holen

Dashboard -> Entwickler -> API-Schluessel (Live-Modus) -> `sk_live_...` kopieren.

- **NIEMALS committen, loggen oder in Chat/Tickets einfuegen** (Repo-Regel 4).
- Einziger Bestimmungsort: Render-Dashboard (Schritt 6).
- Rotation spaeter: "Roll key" mit Ablauf-Frist (siehe `PLAN-SECURITY.md`, Abschnitt
  `SECRETS-HYGIENE`).

## 6. Render: Env umstellen

Render-Dashboard -> Service `vodafone-agent` -> Environment. ALLE Werte in einem
Rutsch setzen, dann EIN Deploy (sonst Boot-Refusal wegen halber Konfiguration):

| Env-Var | Wert |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` (Schritt 5) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (Schritt 4, Live!) |
| `STRIPE_STARTER_PRICE_ID` | `price_...` Starter (Schritt 2, Live!) |
| `STRIPE_PRO_PRICE_ID` | `price_...` Pro (Schritt 2, Live!) — bis zum Bestandsumzug liest `config.js` ersatzweise noch `STRIPE_BUSINESS_PRICE_ID` (letzter Abschnitt) |
| `PAYMENT_CURRENCY` | `eur` (E1; steht schon so in render.yaml) |
| `NUMBER_SETUP_FEE_CENTS` | `500` (E2) |
| `PAYMENT_ENABLED` | `true` |
| `PROVISIONING_ENABLED` | `true` (sonst ist PAYMENT_ENABLED wirkungslos: kein Kauf -> kein Capture) |
| `STRIPE_API_BASE` | bleibt `https://api.stripe.com` |

Boot-Gates (assertConfig verweigert sonst den Start — gewollt, fail-closed):
`PAYMENT_ENABLED=true` erzwingt `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
und `NUMBER_SETUP_FEE_CENTS > 0`.

**Check:** Deploy wird gruen; `curl https://vodafone-agent.onrender.com/healthz` -> 200.
Im Render-Log KEINE `[Konfiguration]`/Boot-Refusal-Zeilen zu Payment.

## 7. Live-Smoke (echtes Geld, eigene Karte)

> Es gibt im Live-Modus keine Testkarten. Smoke = ein echter Durchlauf mit der
> eigenen Karte, danach Storno/Refund. Ablauf wie der Test-Mode-Smoke in Schritt 7,
> nur eben live.

1. Onboarding-Flow als neuer Tenant durchlaufen: Karte im Checkout (setup-Mode) speichern.
2. Abo buchen (Starter reicht). Erwartung: Abbuchung ueber den Live-Price, Tenant-Plan aktiv.
3. Stripe-Dashboard -> Webhook-Endpoint -> Ereignisse: `customer.subscription.created` mit **HTTP 2xx** zugestellt (nicht "Fehlgeschlagen"). Ein 4xx heisst fast immer: Test-`whsec` statt Live-`whsec` in Render.
4. Nummern-Onboarding: Hold ueber `NUMBER_SETUP_FEE_CENTS` erscheint als PaymentIntent (`requires_capture`), nach Nummernkauf `succeeded` mit `livemode: true`.
5. Nummer existiert real beim Provider (Telnyx-Portal) — echter Kauf, echte Kosten.
6. `POST /api/billing/flush-meters` (Admin-Session im Browser; Basic-Auth reicht seit AUTH-P6 nicht mehr) -> `{ sent: >0, failed: 0 }`; Meter-Events im Stripe-Dashboard sichtbar.
7. Aufraeumen: Test-Abo im Stripe-Dashboard kuendigen, Zahlung(en) refunden, ggf. Nummer wieder freigeben.

## 8. Rollback

`PAYMENT_ENABLED=false` + `PROVISIONING_ENABLED=false` in Render -> Deploy.
Keys/Preise/Webhook koennen stehen bleiben (Gate aus = byte-identisches Verhalten,
kein Hold/Capture, kein Kauf). Kein Stripe-Rueckbau noetig.

## 9. Bekannte Risiken (Pre-Mortem, bewusst akzeptiert oder offen)

1. **SCA/3DS (OFFEN, STATUS.md Punkt 4):** `placeHold` laeuft `off_session` — echte
   Karten koennen `authentication_required` werfen (Testkarten nie). Es gibt noch
   KEINEN Recovery-Flow; betroffenes Onboarding schlaegt fehl (fail-closed, kein
   halber Zustand). Akzeptiert fuer den Start; Recovery-Flow als Follow-up.
2. **Echte Nummernkaeufe:** `PROVISIONING_ENABLED=true` kauft echte Nummern
   (gedeckelt durch maxNumbers + Auth + Gates). Kosten laufen beim Provider auf.
3. **Falsches whsec:** Webhook ist fail-closed — mit Test-Secret werden ALLE
   Live-Events abgelehnt, Abos aktivieren nie. Symptom: 4xx in der
   Webhook-Zustellliste (Schritt 7.3).
4. **Preis-Drift:** Stripe-Live-Preis vs. `PLAN_CATALOG` gleicht niemand
   automatisch ab. Bei jeder Preisaenderung BEIDE Stellen pflegen (+ Spiegel
   `apps/web/src/lib/plans.js`).

## 10. Rabattcode fuer den Owner-Smoke (Coupon + Promotion Code)

Seit dem Discount-Umbau laeuft der Erst-Abschluss (Kachel-Flow MIT Plan) ueber
Stripe-Checkout im **subscription-Mode**: Karte + Abo entstehen in EINEM gehosteten
Schritt, und Stripe zeigt dort ein natives Rabattcode-Feld. Damit laesst sich
Schritt 7 ohne echte Belastung fahren. Alles Folgende ist NUR Stripe-Dashboard
(Live-Modus), kein Code:

1. Dashboard -> Produktkatalog -> **Coupons** -> "+ Neuer Coupon":
   - Typ: Prozentrabatt, **100 %**
   - Dauer (duration): **Einmalig (once)** — rabattiert NUR die erste Rechnung.
     Das Abo verlaengert sich danach zum vollen Preis (fuer den Smoke egal:
     Abo wird in Schritt 7.7 sowieso gekuendigt).
2. Im Coupon -> **"Promotion Code hinzufuegen"**:
   - Code: z.B. `OWNER100`
   - **Maximale Einloesungen: 1** (oder den Code an den eigenen Stripe-Customer
     binden), optional Ablaufdatum (z.B. +7 Tage).
3. Smoke (Schritt 7): im Stripe-Checkout unter dem Kartenformular
   "Gutscheincode hinzufuegen" -> `OWNER100` -> erste Rechnung 0,00 EUR;
   Karte wird trotzdem gespeichert, Abo + Webhook-Events laufen normal.
4. Restriktion lebt KOMPLETT in Stripe (Design-Entscheidung 2026-07-03):
   die App validiert keine Codes. Leakt ein Code, begrenzen NUR
   max_redemptions/Ablauf/Customer-Bindung den Schaden -> Codes knapp halten.

Hinweis zu 7.1/7.2: mit getragenem Plan speichert der Checkout die Karte UND legt
das Abo direkt an (subscription-Mode) — Schritt 7.2 ("Abo buchen") passiert also
schon im Checkout selbst. Der reine "Karte hinzufuegen"-Flow ohne Plan bleibt
setup-Mode wie beschrieben. Das SCA/3DS-Risiko aus 9.1 ist damit NUR fuer den
Erst-Abschluss geloest (Checkout ist on-session); fuer den Plan-Wechsel ueber
`/subscribe` (Karte on-file) bleibt es offen.

## Tarif-Umbenennung Business -> Pro (2026-09-15)

Der zweite Abo-Tarif heisst seit dem 15.09.2026 **Pro** (Slug `pro`) statt Business
(Slug `business`). Preis (9,99 EUR) und Leistungen (120 Minuten, 1 Nummer,
ausgehende Anrufe, Priority-Support) sind UNVERAENDERT — es ist ein reiner Rename.
Der Code traegt den Bestand uebergangsweise mit: `LEGACY_PLAN_SLUG_ALIASES`
(`src/plans.js`) uebersetzt `business` -> `pro`, und `config.js` liest
`STRIPE_BUSINESS_PRICE_ID` als Rueckfall, solange `STRIPE_PRO_PRICE_ID` fehlt.
Beides sind Uebergangs-Kruecken; dieser Abschnitt ist der Weg, sie loszuwerden.

Reihenfolge ist NICHT optional — jeder Schritt setzt den vorigen voraus:

- [ ] **1. Stripe-Produkt umbenennen.** Dashboard (Live!) -> Produktkatalog ->
      "Hermes Business" -> Name auf "Hermes Pro" aendern. NUR der Produktname.
      **KEIN neues Produkt, KEIN neuer Price** — die `price_...`-ID bleibt
      identisch, sonst haengen die laufenden Abos an einem Price, den niemand mehr
      kennt, und brechen.
- [ ] **2. `metadata.plan_slug` auf den laufenden Subscriptions umstellen.** Je Abo
      im Dashboard (oder per API) `metadata.plan_slug` von `business` auf `pro`
      setzen. Stand 15.09.2026 sind das **zwei Abos**. Ohne diesen Schritt liefert
      jeder Webhook weiter den alten Slug — dann traegt allein der Alias.
- [ ] **3. Render-Env setzen.** Service `vodafone-agent` -> Environment:
      `STRIPE_PRO_PRICE_ID` anlegen, **gleicher Wert wie
      `STRIPE_BUSINESS_PRICE_ID`** (Schritt 1 hat die Price-ID nicht veraendert).
      Den alten Key **erst nach dem naechsten gruenen Deploy** entfernen — bis dahin
      laeuft die alte Instanz noch und braucht ihn.
- [ ] **4. Datenbank nachziehen.**
      `UPDATE tenant SET stripe_plan_slug = 'pro' WHERE stripe_plan_slug = 'business';`
- [ ] **5. Erst danach die Uebergangs-Kruecken entfernen.** `LEGACY_PLAN_SLUG_ALIASES`
      in `src/plans.js` und den Env-Rueckfall auf `STRIPE_BUSINESS_PRICE_ID` in
      `src/config.js` loeschen (plus die Hinweise in `.env.example` und
      `render.yaml`). Vorher nicht: solange irgendwo noch `business` steht, waere
      das Entfernen eine Sperre fuer zahlende Kunden.

**Check:** Nach Schritt 4 liefert
`SELECT stripe_plan_slug, count(*) FROM tenant GROUP BY 1;` keine `business`-Zeile
mehr; im Stripe-Dashboard tragen beide Abos `plan_slug=pro`. Erst wenn beides
stimmt, ist Schritt 5 gefahrlos.

**Rollback:** Schritt 5 ist der einzige, der etwas kaputtmacht — er ist ein
Code-Change und wird per Revert zurueckgenommen. Die Schritte 1-4 sind
rueckwaertskompatibel, solange der Alias steht: ein Abo mit `plan_slug=pro` und
eines mit `business` laufen gleichzeitig durch.
