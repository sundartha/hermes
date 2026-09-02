# Runbook: Cookie-Einwilligung und Reichweitenmessung (Website)

Gilt fuer die Marketing-Site (`apps/web`, Static-Services `hermes-web` und
`hermes-web-staging`). Der eingeloggte Kundenbereich (`/app`, Gateway-Origin)
hat KEINE Reichweitenmessung und deshalb auch keinen Banner — dort gibt es nur
das notwendige Sitzungs-Cookie.

## Was heute laeuft

- `components/site/CookieConsent.astro` + `scripts/consent.js` + `styles/consent.css`:
  Banner auf der Startseite und allen `Hermes.astro`-Seiten. Entscheidung in
  `localStorage["hermes.consent"]` = `{version, ts, necessary, statistics, marketing}`.
  Ohne Eintrag erscheint der Banner; "Cookie-Einstellungen" im Fussband oeffnet ihn erneut.
- Notwendig (ohne Einwilligung, § 25 Abs. 2 Nr. 2 TDDDG): `hermes.lang`
  (Sprachwahl), `hermes.consent` (die Entscheidung selbst), Sitzungs-Cookie im Kundenbereich.
- Statistik / Marketing: heute KEIN Dienst aktiv. Der Banner ist die Vorsorge,
  damit ein spaeterer Dienst nicht ohne Einwilligung startet.

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
   default-src 'self'; script-src 'self' https://plausible.io; connect-src 'self' https://plausible.io; frame-ancestors 'none'; base-uri 'self'; object-src 'none'
   ```
4. Datenschutzerklaerung (`src/data/legal/privacy.de.json`, Abschnitt "Cookies und
   lokale Speicherung"): den Satz "Statistik- oder Marketing-Dienste ... setzen wir
   derzeit nicht ein" durch den konkreten Anbieter ersetzen (Name, Sitz, Zweck,
   Datenkategorien, Rechtsgrundlage Art. 6 Abs. 1 lit. a DSGVO, Widerruf ueber
   "Cookie-Einstellungen"). Anbieter in "Empfaenger" und "Drittlaender" ergaenzen.
5. Auf staging pruefen: Banner ablehnen -> kein Request an den Host; "Alle
   akzeptieren" -> Skript laedt (Network-Tab), Seitenaufruf erscheint beim Anbieter.
   Dann Live nach Lab->Live-Runbook.

## Hinweis zur Rechtslage (kein Rechtsrat)

Ein cookieloser Zaehler (Plausible/Umami ohne Cookie) braucht nach
herrschender Meinung weiterhin eine Einwilligung, weil das Skript auf das
Endgeraet zugreift (§ 25 Abs. 1 TDDDG) — deshalb laeuft er hier hinter der
Kategorie "Statistik". Die Einwilligung muss vor dem ersten Laden vorliegen,
Ablehnen muss so leicht sein wie Zustimmen (beides ist im Banner so gebaut).
