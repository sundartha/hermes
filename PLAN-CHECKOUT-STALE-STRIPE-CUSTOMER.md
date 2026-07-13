# PLAN: Checkout schlaegt fehl - Stripe "No such customer" direkt nach Anlage

Datum: 2026-07-13. Status: **Neu eingegrenzt (Nachtrag 3) - urspruengliche
"eine alte Zeile"-Diagnose war zu frueh geschlossen und widerlegt, echte
Ursache liegt ausserhalb des Codes, noch nicht gefixt.**

**WICHTIG:** die urspruengliche Root-Cause-Sektion unten (Stand: erster
Tenant) ist durch Nachtrag 3 ueberholt - dort erst weiterlesen fuer den
aktuellen Stand.

## Meldung

Neuer Account (`jdhj400.gmail.com`, verifiziert), Klick auf "Subscribe" (Starter 4,99
oder Business 9,99): Frontend zeigt sofort "Couldn't start checkout." Kein Checkout
erreichbar.

## Nachtrag: Gegenbeweis "hat doch vor ein paar Tagen noch funktioniert"

Jonas' Einwand (der Checkout hat neulich noch geklappt, das kann kein altes
Problem sein) ist berechtigt geprueft worden - Ergebnis: **das System bucht
nachweislich noch diese Woche echt durch, der Fehler ist trotzdem real und
isoliert.** Log-Beweis (Render-Audit-Log, `srv-d8m0fhflk1mc73bno570`):

- `t_user_01KWKXZ3H8D9G5B05R5RN88Z6J` (der Jul-4-Test-Tenant aus dem Handover-Doc):
  `self_service_setup_checkout ... plan=business` gefolgt von
  `self_service_subscribe ... plan=business outcome=ok profile=ok:6` -
  **2026-07-08 20:13-20:15 UTC**, echte erfolgreiche Buchung.
- Drei weitere Tenants (`t_user_01KX2YDQ7GKBP1AEYJTW2NS370` 9.7.,
  `t_user_01KX5TCCH4ZSG8SMVPAT149KPR` 10.7., `t_user_01KX600834GCJFV9GTZQKWZMTH`
  10.7.) haben `setup_checkout`-Sessions ohne `resource_missing`-Fehler erzeugt.

Kein anderer Tenant in der gesamten Log-Historie zeigt den `resource_missing`-
Fehler - nur der EINE neue Tenant von heute
(`t_user_01KW2FCC46GZVQ2CN1HZD4EH5W`), zehnmal identisch bei den Retry-Klicks.
Das ist kein flaechendeckender Ausfall, sondern ein einzelner kaputter
Datensatz. Auffaellig UND ungeklaert: dieser Tenant hat vor dem heutigen
Fehlschlag KEINE einzige Log-Zeile (kein Onboarding, kein frueherer Versuch) -
trotzdem war beim allerersten Checkout-Klick heute schon eine tote Customer-Id
gespeichert. Offene Frage an Jonas: wurde `jdhj400.gmail.com` wirklich zum
ALLERERSTEN Mal heute angelegt, oder gab es vorher schon einen (auch
abgebrochenen) Versuch mit dieser Mail?

## Nachtrag 2: WorkOS-User geloescht + neu angelegt - Fehler bleibt (geklaert)

Jonas hat den WorkOS-User geloescht und mit derselben Email neu angelegt, dann
nochmal versucht. Log-Beweis: **derselbe** Tenant `t_user_01KW2FCC46GZVQ2CN1HZD4EH5W`,
derselbe `resource_missing`-Fehler, 2026-07-13 10:55:54 UTC.

Erklaerung (Code gelesen, `src/web-auth.js:459-503`, `resolveOrCreateTenant`):
das System hat einen bewussten **Email-Dedup-Mechanismus** (Feature
"tenant-prolif-a"): gehoert eine (verifizierte) Email bereits einem Account mit
NICHT geschlossenem Tenant, wird bei jedem Login DIESER Tenant wiederverwendet -
unabhaengig vom WorkOS-`sub`. Zweck: verhindert, dass wiederholte Logins
staendig neue Tenants/Nummern anlegen. Nebenwirkung hier: WorkOS-User
loeschen+neu anlegen aendert nur die WorkOS-Seite (neuer `sub`); der
Account/Tenant in unserer eigenen Postgres-DB bleibt fuer dieselbe Email
bestehen (Status bleibt "aktiv", nicht "closed") und wird sofort wieder an den
neuen `sub` gebunden - samt der kaputten `stripe_customer_id`.

**Konsequenz:** "Account neu anlegen" ist als Workaround wirkungslos, solange
die Email gleich bleibt - das ist kein neuer/zweiter Bug, sondern derselbe
Datensatz, der sich ueber den Dedup-Pfad erneut meldet. Um mit dieser Email
weiterzutesten, hilft nur der DB-Fix (Ebene A unten). Ein Test mit einer
ANDEREN Email waere sofort moeglich (frischer Tenant, keine Stripe-Altlast).

## Nachtrag 3: Zweiter, komplett neuer Tenant (andere Email) - gleicher Fehler, ANDERE Customer-Id

Jonas hat mit einer komplett anderen Email (`jonascro2@gmail.com`) getestet -
genuiner neuer Tenant `t_user_01KW4J9AT7J11CS9FAQJPQ2FNW`. Ergebnis: **gleicher
Fehler**, aber mit einer ANDEREN Customer-Id (`cus_UmUkYv469yOdNx`),
2026-07-13 11:00:20 UTC:

```
self-service billing route failed: Stripe createSubscriptionCheckoutSession fehlgeschlagen: HTTP 400
  "error": { "code": "resource_missing", "message": "No such customer: 'cus_UmUkYv469yOdNx'", "param": "customer" }
```

Das widerlegt die urspruengliche Diagnose ("eine alte kaputte Zeile"): ein
komplett frischer Tenant trifft denselben Fehler, mit einer neuen, eigenen
Customer-Id. Nachrecherchiert, JEDE Schreibstelle von `stripe_customer_id`
im Repo (`grep setTenantStripe`, 6 Treffer total):

- `card-setup.js:20` (`ensureCustomer`) - die EINZIGE Stelle, die bei einem
  Tenant OHNE gespeicherte Id ueberhaupt eine neue anlegt.
- `card-setup.js:42`, `subscribe.js:159/182` - alle drei GATEN vorher ueber
  `customerMatches` (nur schreiben, wenn die Id zum bereits gespeicherten Wert
  passt) - koennen also nie eine FREMDE/neue Id in einen leeren Tenant
  schreiben.
- `webhook.js:225` - schreibt nur `paymentMethodId`, nie `customerId`.

Cross-Tenant-Leak, Webhook-Fehlzuordnung, ein zweiter unentdeckter
Schreibpfad: alle ausgeschlossen. Heisst: `ensureCustomer` hat bei BEIDEN
Tenants tatsaechlich einen neuen Stripe-Customer angelegt (kein
`createCustomer`-Fehler in den Logs - der wuerde als eigene Zeile
"Stripe createCustomer fehlgeschlagen: HTTP ..." auftauchen), Stripe hat eine
echte Id zurueckgegeben - und im SELBEN Request, denselben API-Key nutzend,
Sekundenbruchteile spaeter (`createCheckoutSession` direkt danach,
`self-service-routes.js:326-334`), sagt Stripe "gibt's nicht".

**Das zeigt aus unserem Code heraus, nicht mehr hinein.** Moegliche Ursachen,
die NICHT mehr per Code-Lesen einzugrenzen sind:

1. Stripe-seitige Verzoegerung/Replikation zwischen "Customer angelegt" und
   "fuer den naechsten Call sichtbar" (selten, aber bei manchen Accounts
   berichtet).
2. Etwas account-/key-seitig bei `acct_1Tki8x3d0y9L6Epq` selbst (Restricted-
   Key-Berechtigungen, Account-Status/Review, o.ae.).

**Sofort-Check (kein Code, 2 Minuten):** im Stripe-Live-Dashboard
(`https://dashboard.stripe.com/acct_1Tki8x3d0y9L6Epq/customers`) nach
`cus_UmUkYv469yOdNx` suchen. Taucht die Id dort NICHT auf -> Stripe hat die
Anlage nie durchgesetzt (Account-/Key-Problem, Stripe-Support-Fall). Taucht
sie dort AUF (existiert wirklich) -> reine Sichtbarkeits-/Replikations-
Verzoegerung zwischen den beiden API-Calls (dann wuerde ein kurzer Retry mit
Wartezeit das Problem umgehen).

Der weiter unten beschriebene strukturelle Fix (B: bei `resource_missing`
neu anlegen + retry) wuerde AUCH dieses Muster beheben, unabhaengig davon,
welche der beiden Ursachen zutrifft - nur ggf. mit kurzer Wartezeit vor dem
Retry, falls es Fall 1 ist.

## Root Cause (verifiziert, kein Rateversuch)

Betroffener Tenant: `t_user_01KW2FCC46GZVQ2CN1HZD4EH5W`. Beweis aus den Render-App-Logs
(`srv-d8m0fhflk1mc73bno570`, 2026-07-13 10:11:01-10:11:38 UTC, 10x identischer Fehler
bei wiederholten Klicks):

```
[audit] self_service_subscribe_rejected reason=no_card
self-service billing route failed: Stripe createSubscriptionCheckoutSession fehlgeschlagen: HTTP 400
  "error": { "code": "resource_missing", "message": "No such customer: 'cus_UmEeA1kbsYtEal'", "param": "customer" }
```

Ablauf (Code gelesen, `apps/web/src/lib/subscribe.js` + `src/self-service-routes.js` +
`src/billing/card-setup.js`):

1. `POST /billing/subscribe` -> 409 `no_card` (Tenant hat noch keine Karte) - korrektes
   Verhalten, das Frontend springt in den gefuehrten Karten-Flow (`guidedCardSetup`,
   `subscribe.js:149-159`).
2. `POST /billing/setup-checkout` -> `ensureCustomer()` (`card-setup.js:16-23`) liest die
   BEREITS gespeicherte `stripe_customer_id` dieses Tenants und nutzt sie ungeprueft
   weiter, statt eine neue anzulegen.
3. Stripe lehnt ab: die Customer-Id existiert im aktiven Live-Account
   (`acct_1Tki8x3d0y9L6Epq`) nicht (mehr) - `resource_missing`.
4. `asyncBilling`-Wrapper faengt den Fehler, antwortet `502 billing_unavailable`.
5. Frontend uebersetzt jeden Nicht-401/409-Fehler generisch zu
   `SUBSCRIBE_MESSAGES.checkoutFailed` = "Couldn't start checkout."
   (`subscribe.js:43`, `subscribe.js:154-157`) - daher die nichtssagende Meldung.

**Wichtig:** der `plan_unconfigured`-Gate (fehlende `STRIPE_STARTER_PRICE_ID`/
`STRIPE_BUSINESS_PRICE_ID`) ist NICHT die Ursache - der Fehler kommt erst NACH diesem
Gate, direkt vom Stripe-API-Call. Preise/Config sind korrekt gesetzt.

## Warum "hat doch neulich noch funktioniert" trotzdem stimmt UND kein Widerspruch ist

Kein Code-Regression: `git log origin/master` zeigt keine Aenderung an
`src/billing/*`, `src/self-service-routes.js`, `src/plans.js` oder `src/config.js`
seit dem Idempotency-Fix vom 2026-07-04 (`6406629`). Der live deployte Commit
(`3ad5342`, seit 2026-07-13 07:03 UTC) betrifft nur Gespraechsqualitaet
(K0-K3), keine Billing-Datei.

Stattdessen ist das exakt derselbe Fehlerpfad, der schon am 2026-07-04
aufgetreten und dokumentiert ist (`HANDOVER-STRIPE-LIVE-SMOKE.md`, Problem #2):
ein anderer Tenant hatte damals eine tote Test-Mode-Customer-Id gespeichert,
gefixt wurde das mit einem MANUELLEN SQL-`UPDATE` + Neustart - kein Code-Fix.
Die eigentliche Luecke (`ensureCustomer` prueft die gespeicherte Id nie gegen
Stripe) wurde damals nicht geschlossen. Sie ist jetzt bei einem ANDEREN,
neuen Tenant erneut aufgetreten. Das ist kein "das Repo ist kaputt", sondern
ein bekannter, bisher nur einmal manuell umschiffter struktureller Bug.

## Offene Frage (braucht Stripe-Dashboard, habe ich nicht)

Der allererste Checkout-Versuch dieser Session ist schon fehlgeschlagen - die
Customer-Id war also schon VOR dem heutigen Subscribe-Klick gespeichert.
`ensureCustomer` ist der einzige Code-Pfad, der ueberhaupt einen Stripe-Customer
anlegt (`onboarding.js:141` liest nur, legt nichts an) - der Customer wurde also
in einem frueheren Request erzeugt. Fuer Jonas zu pruefen:

- Wurde `cus_UmEeA1kbsYtEal` im Stripe-Live-Dashboard geloescht/aufgeraeumt
  (z.B. beim Cleanup von Test-Buchungen)?
- Gab es zwischen Customer-Anlage und jetzt einen Stripe-Key-/Account-Wechsel?

## Blast Radius

Log-Suche 2026-07-04 bis jetzt: **nur diese eine Customer-Id / dieser eine
Tenant** zeigt `resource_missing`. Kein Hinweis auf einen breiten Account-/
Key-Wechsel, der alle Bestandskunden treffen wuerde. Einschraenkung: der Fehler
wird nur sichtbar, wenn ein Tenant tatsaechlich einen Checkout versucht - eine
still betroffene Karte faellt sonst nicht auf. Ein DB-Read (wie viele Tenants
ueberhaupt `stripe_customer_id` gesetzt haben) wuerde das klaeren, wurde in
dieser Session vom Auto-Mode-Classifier geblockt (Produktions-DB ohne
explizite Freigabe) - **braucht Jonas' OK.**

## Empfehlung: zwei Ebenen

### A) Sofort-Fix fuer den wartenden Nutzer (operational, wie der Jul-4-Praezedenzfall)

```sql
UPDATE tenant SET stripe_customer_id = NULL, stripe_payment_method_id = NULL
WHERE id = 't_user_01KW2FCC46GZVQ2CN1HZD4EH5W';
```

Danach Service-Neustart (pg-Store hydriert den State nur beim Boot, siehe
Handover-Doc) - z.B. per harmlosem Env-Var-Touch-Redeploy. Erst DANACH kann der
Nutzer den Subscribe-Flow nochmal versuchen; `ensureCustomer` legt dann einen
frischen, gueltigen Customer an. Braucht Jonas' Freigabe (Produktions-DB-Write).

### B) Struktureller Fix (schliesst die Luecke dauerhaft)

`ensureCustomer`/`createCheckoutSession` faengt Stripes `resource_missing` mit
`param=customer` ab, loescht die stale Referenz
(`store.setTenantStripe(tenant, { customerId: null, paymentMethodId: null })`)
und legt EINMAL automatisch einen neuen Customer an, statt dem Nutzer einen 502
zu zeigen. Selbstheilend statt manuellem SQL-Patch pro betroffenem Tenant - kein
zweiter Vorfall dieser Art mehr, unabhaengig von der Ursache (Test/Live-Wechsel,
Dashboard-Cleanup, Account-Wechsel). TDD: Fake-Billing-Port, der beim ersten
Aufruf `resource_missing` wirft, zweiter Aufruf erfolgreich -> Test erwartet
frischen Customer + erfolgreiche Checkout-Session.

**Empfehlung:** B bauen (behebt die Bug-Klasse), A parallel als Sofortmassnahme
fuer den wartenden Nutzer.

## Naechste Schritte (aktualisiert nach Nachtrag 3)

1. **Jonas, sofort:** Stripe-Live-Dashboard pruefen, ob `cus_UmUkYv469yOdNx`
   (zweiter, frischer Tenant) dort existiert. Ergebnis entscheidet, ob es ein
   Stripe-Account-/Key-Problem (Id fehlt dort) oder eine reine
   Sichtbarkeits-Verzoegerung (Id existiert) ist.
2. Ebene A (SQL-Null fuer den urspruenglichen Tenant) bleibt sinnvoll, loest
   aber vermutlich NICHT das grundsaetzliche Muster - Nachtrag 3 zeigt, dass
   auch komplett frische Tenants treffen. Nur noch als Sofort-Entlastung fuer
   den ERSTEN wartenden Nutzer, nicht als generelle Loesung.
3. Struktureller Fix (B) bleibt Empfehlung, jetzt mit hoeherer Prioritaet -
   betrifft potenziell JEDEN neuen Signup, nicht nur einen Einzelfall.
4. Falls Dashboard-Check Fall 1 bestaetigt (Id existiert, nur verzoegert
   sichtbar): B um einen kurzen Retry-Delay (z.B. 1-2s) vor dem erneuten
   Checkout-Versuch ergaenzen.
