# Runbook: Cookie-Einwilligung und Reichweitenmessung (Website)

Gilt fuer die Marketing-Site (`apps/web`, Static-Services `hermes-web` und
`hermes-web-staging`). Der eingeloggte Kundenbereich (`/app`, Gateway-Origin)
hat KEINE Reichweitenmessung und deshalb auch keinen Banner — dort gibt es nur
das notwendige Sitzungs-Cookie.

## Was heute laeuft

- `components/site/CookieConsent.astro` + `scripts/consent.js` (+ die reinen
  Entscheidungen in `scripts/consent-core.js`) + `styles/consent.css`: Banner auf der
  Startseite und allen `Hermes.astro`-Seiten. Entscheidung in
  `localStorage["hermes.consent"]` = `{version, id, ts, necessary, statistics, marketing}`
  (`id` = Zufalls-UUID des Browsers, bleibt ueber Aenderung und Widerruf gleich).
- Der Banner erscheint **ungefragt, solange noch keine Entscheidung vorliegt** - beim
  ersten Besuch also immer, auch wenn heute nur Notwendiges laeuft (Owner-Entscheidung
  2026-09-27). Danach oeffnet ihn "Cookie-Einstellungen" (Fussband, Rechts-Blatt).
- **Widerruf:** wird eine Kategorie abgewaehlt, deren Skript auf der Seite schon laeuft,
  laedt die Seite neu (ein geladenes Skript laesst sich nicht entladen).
- Notwendig (ohne Einwilligung, § 25 Abs. 2 Nr. 2 TDDDG): `hermes.lang.v2`
  (Sprachwahl), `hermes.consent` (die Entscheidung selbst), Sitzungs-Cookie im Kundenbereich.
- Statistik / Marketing: heute KEIN Dienst aktiv. Der Banner ist die Vorsorge,
  damit ein spaeterer Dienst nicht ohne Einwilligung startet.

## Einwilligungs-Protokoll (Nachweis, Art. 7 Abs. 1 DSGVO)

Jede Entscheidung (Zustimmung, Ablehnung, Aenderung, Widerruf) schickt `consent.js` per
`navigator.sendBeacon` (Typ `text/plain`, kein CORS-Preflight) an
`POST <PUBLIC_GATEWAY_URL>/api/cookie-consent` (Ziel steht als `data-consent-log` an der
Karte, Quelle `lib/routes.js`). Der Gateway (`src/cookie-consent-log.js`, gemountet im
pg-Block `src/wiring/web-login.js`) schreibt eine append-only Zeile in
`cookie_consent_log`: `at, consent_id, version, statistics, marketing, site`.
**Keine IP, kein User-Agent, kein Account/Tenant.** `site` = Host aus dem Origin-Header
(unterscheidet sundartha.com vom Labor, das denselben Gateway nutzt). Aufbewahrung
3 Jahre (§ 195 BGB), taeglicher Sweep + Boot-Lauf.

Voraussetzung: die CSP der Static Site muss den Gateway-Origin in `connect-src` fuehren,
sonst blockiert der Browser den Beacon still. Die Static-Services sind dashboard-managed:
den Wert aus `render.yaml` (hermes-web, Header `Content-Security-Policy`) im
Render-Dashboard bei **hermes-web und hermes-web-staging** eintragen
(`test/cookie-consent-client.test.js` haelt render.yaml und PUBLIC_GATEWAY_URL gleich).

Nachweis im Streitfall (die Kennung steht im localStorage des Besuchers,
`hermesConsent.get().id` in der Browser-Konsole):

```sql
SELECT at, version, statistics, marketing, site
  FROM cookie_consent_log WHERE consent_id = '<id>' ORDER BY at;
```

## Wie ein Dienst angebunden wird

Skripte, die Einwilligung brauchen, stehen als Platzhalter im HTML:

```html
<script type="text/plain" data-consent="statistics" data-src="https://host/script.js" data-domain="sundartha.com" defer></script>
```

`consent.js` verwandelt den Platzhalter genau einmal in ein echtes `<script>`,
sobald die Kategorie freigegeben ist (sofort, wenn eine gespeicherte
Entscheidung das erlaubt; sonst beim Klick). Alle weiteren Attribute wandern
mit. Inline-Code geht NICHT (CSP `script-src 'self'`) — nur `data-src`.
Zusaetzlich: `document`-Event `hermes:consent` (detail = Entscheidung) und
`window.hermesConsent.get()` / `.open()`.

## Reichweitenmessung einschalten (Plausible oder Umami)

`components/site/AnalyticsSlot.astro` rendert den Platzhalter aus drei
Build-Zeit-Variablen (Astro inlinet `PUBLIC_*`). Ohne sie wird nichts gerendert.

1. Konto beim Anbieter anlegen (datenschutzfreundlich, kein Cookie: Plausible
   oder Umami; beide EU-Hosting-Optionen). Website-Kennung notieren.
2. In `render.yaml` beim Static-Service (erst `hermes-web-staging`, dann `hermes-web`)
   unter `envVars` ergaenzen:
   ```yaml
   - key: PUBLIC_ANALYTICS_PROVIDER
     value: plausible            # oder umami
   - key: PUBLIC_ANALYTICS_HOST
     value: https://plausible.io # Umami: https://cloud.umami.is oder eigener Host
   - key: PUBLIC_ANALYTICS_ID
     value: sundartha.com        # Plausible: data-domain; Umami: Website-ID
   ```
3. **CSP nachziehen** (sonst blockiert der Browser das Skript still): im selben
   Service unter `headers` den Host in `script-src` UND `connect-src` aufnehmen:
   ```
   default-src 'self'; script-src 'self' https://plausible.io; connect-src 'self' https://app.sundartha.com https://plausible.io; frame-ancestors 'none'; base-uri 'self'; object-src 'none'
   ```
   (`https://app.sundartha.com` bleibt fuer das Einwilligungs-Protokoll drin.)
4. Datenschutzerklaerung (`src/data/legal/privacy.de.json`, Abschnitt "Cookies und
   lokale Speicherung"): den Satz "Statistik- oder Marketing-Dienste ... setzen wir
   derzeit nicht ein" durch den konkreten Anbieter ersetzen (Name, Sitz, Zweck,
   Datenkategorien, Rechtsgrundlage Art. 6 Abs. 1 lit. a DSGVO, Widerruf ueber
   "Cookie-Einstellungen"). Anbieter in "Empfaenger" und "Drittlaender" ergaenzen.
5. Banner-Texte nachziehen und neu fragen: in `components/site/CookieConsent.astro`
   (und im DE-Woerterbuch von `scripts/hermes-scroll.js`, Praefix `ck`) "Derzeit nicht im
   Einsatz" durch den Anbieter ersetzen, dann `CONSENT_VERSION` in
   `scripts/consent-core.js` um 1 erhoehen. Grund: wer frueher "Alle akzeptieren"
   geklickt hat, stimmte einem Dienst zu, den es noch nicht gab - das ist keine
   informierte Einwilligung fuer den konkreten Anbieter. Die hoehere Version verwirft
   alle alten Entscheidungen, jeder wird neu gefragt (und neu protokolliert).
6. Auf staging pruefen: Banner ablehnen -> kein Request an den Host; "Alle
   akzeptieren" -> Skript laedt (Network-Tab), Seitenaufruf erscheint beim Anbieter;
   in beiden Faellen ein Beacon an `/api/cookie-consent` (204). Statistik danach in
   "Cookie-Einstellungen" abwaehlen -> Seite laedt neu, Skript laedt nicht mehr.
   Dann Live nach Lab->Live-Runbook.

## Hinweis zur Rechtslage (kein Rechtsrat)

Ein cookieloser Zaehler (Plausible/Umami ohne Cookie) braucht nach
herrschender Meinung weiterhin eine Einwilligung, weil das Skript auf das
Endgeraet zugreift (§ 25 Abs. 1 TDDDG) — deshalb laeuft er hier hinter der
Kategorie "Statistik". Die Einwilligung muss vor dem ersten Laden vorliegen,
Ablehnen muss so leicht sein wie Zustimmen (beides ist im Banner so gebaut).
