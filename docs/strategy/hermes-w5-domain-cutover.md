# Hermes W5 — Domain-Cutover-Runbook (PLAN, kein Ausfuehren)

> Status: **Plan-Dokument.** Dies beschreibt den gestaffelten Produktions-Cutover
> auf das neue Frontend. Es wird hier NICHTS ausgefuehrt: keine DNS-/Cloudflare-/
> Env-Aenderung, kein `PUBLIC_URL`-Flip, keine `render.yaml`-Aenderung. Der
> tatsaechliche Cutover ist eine eigene, vom Owner freigegebene Operation in einem
> Wartungsfenster.
>
> Quelle/Bezug: `docs/strategy/hermes-frontend.md` — Abschnitt 2.4 (Domain/CORS),
> Pre-Mortem (e), Einwaende 1 & 3, Restrisiken R1/R6/R7/R10, Leitplanken 8/9,
> Abschnitt 6 (Owner-Entscheidungen). Verifiziert gegen `src/self-service-routes.js`
> (Billing-Return-Ziel) und das `config.publicUrl`-Verhalten.

---

## 0. Ziel & Endzustand

Eine einzige Browser-Origin (die Produktdomain) liefert beide Services per
Pfad-Routing aus:

- `/`, Marketing-Pfade, `/app/*` → **Static Site** (`hermes-web`, CDN)
- `/auth/*`, `/api/*`, `/voice/*`, `/.well-known/*`, `/mcp`, `/healthz` → **Gateway**

Same-origin haelt die strikteste Sicherheits-Konfiguration intakt: Cookie bleibt
`HttpOnly; Secure; SameSite=Lax; Path=/`, KEIN CORS, CSP `connect-src 'self'`
unveraendert. Das Backend bleibt fail-closed; kein Auth-/Signatur-Pfad wird
angefasst (Leitplanke 2).

**Die eine Variable, an der alles haengt: `PUBLIC_URL`.** `config.publicUrl`
(gespeist aus `PUBLIC_URL || RENDER_EXTERNAL_URL`) steuert DREI externe Vertraege
gleichzeitig (Pre-Mortem e):

1. **Twilio-Inbound-Signatur**: `config.publicUrl + req.originalUrl` →
   `twilio.validateRequest`, **fail-closed**. Falscher Host → HMAC-Mismatch →
   `403` auf JEDEN eingehenden Anruf (korrektes fail-closed-Verhalten; nur die
   Config luegt). Der Boot-Guard faengt nur "PUBLIC_URL leer", NICHT "gesetzt,
   aber falscher Host" — dagegen hilft ausschliesslich der Signaturtest (Schritt 4).
2. **OIDC-redirectUri**: `config.publicUrl + "/auth/callback"` → bei IdP-Mismatch
   kann sich niemand einloggen.
3. **Stripe-Return-URLs**: `config.publicUrl + "/api/self-service/billing/return..."`
   → Karte wird nie gebunden.

Darum: **gestaffelt, bewiesen, Telefonie zuletzt, Test-Nummer vor Produktionsnummer.**

---

## 1. Cloudflare-Pfad-Routing (deklarativ, versioniert, getestet)

Das Routing gehoert in Versionskontrolle und unter denselben Guard-Test-Anspruch
wie `render.yaml` (Einwand 2): eine ungetestete Routing-Regel vor einem
sicherheitskritischen System ist eine unsichtbare SPOF-Schicht.

| Pfad                                                  | Ziel                  | Cache                   | WAF/Bot                        | Anmerkung                                                                   |
| ----------------------------------------------------- | --------------------- | ----------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| `/`, `/preise`, `/so-funktionierts`, statische Assets | Static (`hermes-web`) | cachebar                | normal                         | reines CDN                                                                  |
| `/app/*`                                              | Static (`hermes-web`) | cachebar (HTML noindex) | normal                         | App-Shell, SPA-Fallback bleibt am Static-Service                            |
| `/auth/*`                                             | Gateway               | **Cache-Bypass**        | normal                         | OIDC-Flow + Cookie-Ausstellung                                              |
| `/api/*`                                              | Gateway               | **Cache-Bypass** (R6)   | normal                         | `no-store` darf NIE durch CDN-Cache umgangen werden — sonst Transkript-Leak |
| `/.well-known/*`                                      | Gateway               | Cache-Bypass            | normal                         | OAuth-Metadata                                                              |
| `/mcp`, `/healthz`                                    | Gateway               | Cache-Bypass            | normal                         | MCP-HTTP, Health                                                            |
| `/voice/*`                                            | Gateway               | **Cache aus**           | **WAF/Bot aus — Pass-Through** | Twilio/Telnyx-Webhooks, fail-closed Signatur (R10)                          |

**`/voice/*` ist der teuerste Pfad durch die neue Schicht (Einwand 1, R10).**
Bedingungen, sonst 403 auf echte Anrufe:

- (a) `/voice/*` von WAF/Bot-Management/Caching ausgenommen (reiner Pass-Through);
  aggressive Bot-/WAF-Regeln auf POST-Webhooks kappen die Telefonie und sehen
  nach "Twilio-Problem" aus.
- (b) Der weitergereichte **Host + Protokoll** entsprechen exakt der Signatur-URL
  (`config.publicUrl`). Aendert Cloudflare Host/Protokoll im Forward, passt die
  rekonstruierte HMAC-URL nicht mehr → 403.
- (c) `PUBLIC_URL` zeigt auf die gemeinsame Domain (Schritt 3).
- (d) Monitoring auf die **403/5xx-Rate an `/voice/*`** (Frueh-Warnung; ein
  stiller Anstieg = Routing-/Signatur-Bruch).

**Cache-Bypass-Begruendung (R6):** `/api/*`-Antworten tragen `no-store`
(`src/middleware.js`); Transkripte/Kalender kommen ausschliesslich ueber `/api/*`.
Cachet Cloudflare diese Pfade, wird `no-store` umgangen → Tenant-Daten im
CDN-Cache. Nur `/` und statische Assets duerfen cachebar sein.

---

## 2. `PUBLIC_URL` wird Pflicht — `render.yaml`-Korrektur (PLAN, nicht jetzt)

Heute steht in `render.yaml` (Gateway-Service):

```yaml
# PUBLIC_URL nicht noetig: Render setzt RENDER_EXTERNAL_URL automatisch
```

Dieser Kommentar wird mit dem Shared-Domain-Modell **FALSCH** (Einwand 3):
`RENDER_EXTERNAL_URL` zeigt auf `*.onrender.com`, nicht auf die Produktdomain.
Bliebe er stehen, ist er die wahrscheinlichste Praxis-Ursache fuer Pre-Mortem (e):
der naechste Bearbeiter setzt `PUBLIC_URL` nicht, die Signatur-URL bleibt auf
`*.onrender.com`, und sobald Twilio auf die neue Domain zeigt → 403 auf alle Anrufe.

**Noetige Korrektur (im Cutover-PR, NICHT in dieser W5-Implementierungsphase):**

```yaml
# PUBLIC_URL ist PFLICHT (Shared-Domain-Cutover, W5): RENDER_EXTERNAL_URL zeigt
# auf *.onrender.com, NICHT auf die Produktdomain. publicUrl steuert Twilio-
# Signatur + OIDC-redirectUri + Stripe-Return gleichzeitig — falscher Host =
# 403 auf alle Inbound-Anrufe (Pre-Mortem e / R1).
- key: PUBLIC_URL
  sync: false # Produktdomain, manuell im Render-Dashboard gesetzt
```

`sync:false` = der Wert wird NICHT aus dem Blueprint geseedet, sondern manuell im
Render-Dashboard auf die finale Produktdomain gesetzt. Diese `render.yaml`-Aenderung
ist Teil der eigenen Cutover-Operation; sie wird **hier nicht ausgefuehrt**
(harte Grenze der W5-Implementierungsphase: kein tatsaechlicher Cutover).

---

## 3. Gestaffelter Cutover (Reihenfolge ist Sicherheit)

Reihenfolge so, dass die Telefonie zuletzt und nur bewiesen umgestellt wird.
Waehrend des GESAMTEN Cutovers: `/healthz` am Gateway durchgehend gruen — kein
Telefonie-Ausfall (DoD W5 (3), Leitplanke 8).

### Schritt 0 — Vorbereitung (kein Live-Effekt)

- Alle W3/W4/W5-Sichten gegen die echte API in Staging gruen (W5 ist die letzte
  Phase, damit genau das vorher steht).
- Cloudflare-Routing-Regeln (Abschnitt 1) als versionierte Konfig vorbereitet +
  Guard-Test (analog `render.yaml`-Guard): assertiert die Pfad→Ziel-Zuordnung,
  `/voice/*`-Pass-Through und `/api/*`+`/auth/*`+`/voice/*`-Cache-Bypass.
- Wartungsfenster terminiert (niedriges Anruf-Aufkommen). Rollback-Runbook
  (Abschnitt 4) bereit, DNS-TTL niedrig gesetzt (schneller Rollback).

### Schritt 1 — Cloudflare-Routing einrichten, `PUBLIC_URL` noch UNVERAENDERT

- Routing aktivieren; `PUBLIC_URL` zeigt weiter auf die alte URL.
- Verifizieren: `/` liefert Static, `/api/*`+`/auth/*` erreichen das Gateway,
  `/healthz` gruen. Telefonie laeuft unveraendert (Twilio zeigt noch auf alt).

### Schritt 2 — IdP-redirect_uri ADDITIV registrieren (R7)

- Beim IdP (WorkOS/OIDC-Provider) die neue `https://<produktdomain>/auth/callback`
  **zusaetzlich** zur alten eintragen (alt + neu gleichzeitig gueltig).
- Die alte URI wird ERST nach voller Verifikation (Schritt 6) entfernt. So gibt es
  kein Login-Totalausfall-Fenster (R7): waehrend der Umstellung sind beide gueltig.

### Schritt 3 — `PUBLIC_URL` auf die Produktdomain setzen (Staging-Gateway zuerst)

- Zuerst auf einem **Staging-Gateway** mit einer **Test-Nummer**: `PUBLIC_URL` =
  Produktdomain (bzw. Staging-Domain hinter demselben Routing-Muster).
- Das aendert dort gleichzeitig Twilio-Signatur-URL, OIDC-redirectUri und
  Stripe-Return — darum jetzt der Signaturtest, BEVOR irgendeine Konsole umgestellt
  wird.

### Schritt 4 — Twilio-Signaturtest gegen die NEUE URL (ohne echten Anruf)

- Ein Test bildet mit dem echten `TWILIO_AUTH_TOKEN` eine Signatur ueber die NEUE
  URL (`PUBLIC_URL + /voice/...`) und schickt sie durch `verifyInboundSignature`
  → muss **gruen** sein. Dieser Test gegen die exakte Cloudflare-weitergereichte
  URL ist die EINZIGE Absicherung gegen "PUBLIC_URL gesetzt, aber falscher Host"
  (der Boot-Guard faengt das nicht — R1).
- Gegenprobe: eine Signatur ueber die ALTE URL muss jetzt rot sein (Beleg, dass die
  Pruefung wirklich am neuen Host haengt).

### Schritt 5 — Test-Nummer auf neue URL, echter Test-Anruf gruen

- Erst jetzt in der Twilio-Konsole die **Test-Nummer** auf die neue
  `/voice/*`-URL stellen. Echten Test-Anruf fuehren → muss durchlaufen
  (Signatur ok, Gespraech ok). Login + W3/W4/W5-Sichten end-to-end same-origin
  gegen das Staging-Gateway pruefen (Cookie traegt, Settings-Speichern wirkt).
- **Niemals die produktive Nummer als ersten Versuch** (Leitplanke 8).

### Schritt 6 — Produktion umstellen (im Wartungsfenster)

- `PUBLIC_URL` am Produktions-Gateway auf die Produktdomain (Render-Dashboard,
  `sync:false`). `/healthz` gruen abwarten.
- Signaturtest (Schritt 4) gegen die Produktions-URL gruen.
- ERST DANN die **Produktionsnummer** in der Twilio-Konsole auf die neue
  `/voice/*`-URL stellen. Echten Anruf auf die Produktionsnummer verifizieren.
- Login + Billing-Return + Settings-Speichern end-to-end auf der Produktdomain.

### Schritt 7 — Aufraeumen

- Nach voller Verifikation: alte IdP-redirect_uri entfernen (Schritt 2 rueckgaengig
  fuer die alte URL). Monitoring auf `/voice/*`-403/5xx weiter scharf halten.
- Verbleib der alten `public/tenant.html` entscheiden (siehe Abschnitt 6, offen).

---

## 4. Rollback-Pfad

Jeder Schritt ist einzeln reversibel; der schnellste Rollback ist der DNS-/Routing-
Rueckweg (niedrige TTL aus Schritt 0):

- **Telefonie kaputt (403 auf Anrufe):** Twilio-Nummer(n) zurueck auf die alte
  `/voice/*`-URL — sofortige Wiederherstellung, unabhaengig vom Rest. (Darum
  Telefonie zuletzt und Test-Nummer zuerst: der Blast-Radius eines Fehlers ist
  die Test-Nummer, nicht die Produktion.)
- **Login kaputt (redirectUri-Mismatch):** alte IdP-URI ist noch registriert
  (additiv, Schritt 2) → `PUBLIC_URL` zurueck auf alt, Login laeuft wieder.
- **Routing kaputt:** Cloudflare-Routing deaktivieren / DNS zurueck auf den
  direkten Render-Eintrag — Endzustand = Bestand vor Cutover.
- **Billing-Return kaputt:** siehe Abschnitt 5 — haengt am selben `PUBLIC_URL`,
  rollt mit dem `PUBLIC_URL`-Rueckweg zurueck.

Akzeptanz: ein vollstaendiger Rollback fuehrt zurueck auf den heutigen Zustand
(Gateway liefert `public/tenant.html` direkt, Twilio spricht direkt mit Render).

---

## 5. W3-Befund: Billing-Return zielt auf `/tenant.html?card=ok`

Verifiziert in `src/self-service-routes.js`:

```
CARD_RETURN_OK       = "/tenant.html?card=ok"
CARD_RETURN_CANCELED = "/tenant.html?card=canceled"
```

`GET /api/self-service/billing/return` antwortet nach erfolgreicher Karten-Bindung
mit `res.redirect("/tenant.html?card=ok")`; `cancelUrl` ist
`config.publicUrl + "/tenant.html?card=canceled"`. Beides zeigt auf die **alte**
`public/tenant.html`, nicht auf die neue Astro-App (`/app`).

**Konsequenz fuer den Cutover (Routing muss das fuehren):**

- Solange `public/tenant.html` am Gateway liegt, MUSS `/tenant.html` im Routing
  weiter zum Gateway aufloesen (sonst landet der Stripe-Rueckkehrer auf einer
  404-Static-Seite). Der `?card=ok|canceled`-Parameter wird heute von
  `tenant.html` gelesen; die neue `BillingIsland` liest denselben Parameter, aber
  unter `/app`.
- Drei saubere Optionen (Owner-Entscheidung, Abschnitt 6):
  1. **Routing-Weiche (kein Backend-Touch):** `/tenant.html` → 301/Rewrite auf
     `/app?card=...` an der Cloudflare-Schicht, Query erhalten. Die `BillingIsland`
     zeigt die Rueckmeldung bereits (`?card=ok|canceled` → kurze Meldung). Kein
     `src/**`-Touch — bevorzugt, weil W5 backend-frei bleiben soll.
  2. **Backend-Konstanten umbiegen:** `CARD_RETURN_OK`/`CARD_RETURN_CANCELED` +
     `cancelUrl` auf `/app?card=...` aendern. Das ist ein `src/**`-Eingriff —
     **separater Backend-Commit/-PR**, NICHT Teil dieser W5-Frontend-Phase, und
     deployt den Gateway (gemischter Commit deployt beide Services).
  3. **`tenant.html` als Fallback halten:** `/tenant.html` bleibt erreichbar, der
     Return landet weiter dort; `/app` ist die neue Hauptsicht. Uebergangsweise ok,
     fuehrt aber zwei Kundensichten parallel.

Empfehlung fuer den Cutover: **Option 1** (Routing-Weiche) — backend-frei,
reversibel, kein Gateway-Redeploy. Owner bestaetigt die Wahl vor dem Cutover.

---

## 6. Owner-Entscheidungen (offen — vor dem Cutover zu klaeren)

Aus `hermes-frontend.md` Abschnitt 6 (Vor W5 zu klaeren) plus Befunde dieses Plans:

- **Produktdomain + Cloudflare.** Welche exakte Domain? Steht Cloudflare (oder ein
  anderer Reverse-Proxy) als Routing-Layer bereit und unter Versionskontrolle?
  Ohne same-origin traegt das Cookie nicht.
- **`PUBLIC_URL`-Cutover-Ausfuehrung.** Wer fuehrt den gestaffelten Flip aus?
  Wartungsfenster (Datum/Zeit, niedriges Anruf-Aufkommen)? Wer haelt waehrenddessen
  das `/voice/*`-403/5xx-Monitoring im Blick?
- **`render.yaml`-Korrektur.** Der Gateway-Kommentar "PUBLIC_URL nicht noetig:
  Render setzt RENDER_EXTERNAL_URL automatisch" MUSS im Cutover-PR korrigiert und
  `PUBLIC_URL` als Pflicht (`sync:false`, Produktdomain) aufgenommen werden
  (Abschnitt 2, Einwand 3).
- **Billing-Return-Ziel.** Welche der drei Optionen aus Abschnitt 5? (Empfehlung:
  Routing-Weiche, backend-frei.)
- **Verbleib der alten `public/tenant.html`.** Nach dem Cutover entfernen oder als
  Fallback halten? (Owner-`index.html` bleibt am Gateway, ist NICHT Teil des
  Produkt-Frontends.)
- **Staging-Gateway-Flags.** `SESSION_SECRET` + `STORE_BACKEND=pg` +
  `MULTI_TENANT=true` + `SELF_SERVICE_ENABLED=true` (+ IdP-Client) muessen in der
  Test-Instanz gesetzt sein, damit die Self-Service-Routen erreichbar sind
  (sonst 404). Env-Konfiguration, kein Code.

---

## 7. Definition-of-Done des Cutovers (Abnahme)

1. Unter der finalen Domain: `/` liefert die Astro-App, `/api/*`+`/auth/*` erreichen
   den Gateway, Cookie traegt, Login + alle W3/W4/W5-Sichten funktionieren
   end-to-end same-origin.
2. `/voice/*`-Signaturtest gegen die NEUE URL gruen (Schritt 4), echter Test-Anruf
   auf die Test-Nummer gruen VOR der Produktionsnummer (Schritt 5).
3. Gateway-`/healthz` waehrend des gesamten Cutovers durchgehend gruen (kein
   Telefonie-Ausfall).
4. `/api/*`+`/auth/*`+`/voice/*` sind Cache-Bypass; nur `/`/Assets cachebar
   (R6, kein Transkript-Leak ueber CDN).
5. IdP-redirect_uri war additiv migriert; die alte URI wird erst nach voller
   Verifikation entfernt (R7).
6. `render.yaml` korrigiert (PUBLIC_URL Pflicht), Routing-Konfig versioniert +
   Guard-Test gruen.
7. Billing-Return (`?card=ok|canceled`) landet auf einer existierenden Sicht
   (Abschnitt 5, gewaehlte Option), kein 404.
8. Rollback-Pfad einmal trocken durchgespielt (DNS-/Twilio-/`PUBLIC_URL`-Rueckweg).
