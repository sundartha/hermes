# Spec AUTH-P9a — Cache-Header fuer die statische Auslieferung

Autoritative Definition der Phase. Vorrang vor `PLAN-AUTH-GATE.md` (dort Abschnitt 7,
`### P9`). Was hier nicht steht, ist nicht Teil der Phase.

## Warum diese Phase getrennt vom Rest von P9 laeuft

P9 hat im Plan zwei Haelften mit **verschiedenen** Vorbedingungen:

- **Cache-Header** — unabhaengig, jederzeit machbar. Das ist diese Phase (P9a).
- **Legacy-Checkout-Paar loeschen** — fruehestens **30 Tage nach dem Live-Deploy von
  P7**. Das ist P9b und bleibt offen, bis der Kalender es erlaubt.

Sie zusammen zu machen hiesse, die fertige Haelfte einen Monat liegen zu lassen.

## Warum die Cache-Header hierher gehoeren

Sie sind der eigentliche Ausloeser eines Vorfalls vom 2026-07-28: nach einem Deploy mit
neuen Content-Hashes forderte der Browser des Owners einen Chunk aus dem **vorherigen**
Build an (altes HTML im Cache). Die Datei war weg -> das Basic-Auth-Gate antwortete mit
401 + Basic-Challenge -> mitten in der eingeloggten Anwendung ging ein nativer
Passwort-Dialog auf. Die Ursache war **nicht** der Login-Pfad, sondern Deploy + fehlende
Cache-Header.

Nach P7 gibt es keinen Passwort-Dialog mehr — aber das Grundproblem bleibt: veraltetes
HTML zeigt auf Chunks, die es nicht mehr gibt. Heute tragen **beide**, HTML und Chunks,
`Cache-Control: public, max-age=0`.

## Ziel

`express.static` fuer `WEB_DIST_DIR` (`src/app.js`, `registerStaticServing`) bekommt
`setHeaders`:

| Pfad | Header | Warum |
| --- | --- | --- |
| unter `/_astro/` | `public, max-age=31536000, immutable` | fingerprinteter Dateiname; der Inhalt kann sich unter demselben Namen nie aendern |
| `*.html` | `no-cache` | muss bei jedem Deploy neu geholt werden, sonst zeigt es auf tote Chunks |

`src/middleware.js` (`no-store` fuer `/api/`) bleibt **unberuehrt**.

**Strikt nur fingerprintete Pfade duerfen `immutable` bekommen.** Ein faelschlich als
`immutable` ausgeliefertes Asset ueberlebt einen Rollback im Browser des Nutzers — kein
Deploy holt es zurueck. Das ist der teuerste Fehler, den diese Phase machen kann.

## Abnahme (maschinell)

1. Spawn-Test mit gesetztem `WEB_DIST_DIR` (Temp-Verzeichnis mit einer `index.html`,
   einer `app/index.html` und einer Datei unter `_astro/`):
   - `GET /app/` -> `Cache-Control` enthaelt `no-cache`
   - `GET /_astro/<datei>.js` -> `Cache-Control` enthaelt `immutable` und `max-age=31536000`
   - `GET /api/plans` -> unveraendert `no-store` (die API-Regel wurde nicht beruehrt)
2. `npm test` gruen.
3. Rot-vor-Fix: die `setHeaders`-Funktion testweise entfernen -> genau die neuen Tests
   werden rot. Mutation zuruecknehmen.

## Nicht-Ziele (bindend)

- **Kein** Loeschen des Legacy-Checkout-Paars (P9b, 30 Tage Karenz).
- **Keine** Aenderung an `src/middleware.js`.
- **Keine** Cache-Header fuer `express.static(publicDir)` (die Marken-Assets) — das ist
  ein anderer Mount mit anderem Lebenszyklus und nicht Teil dieser Phase.
- **Keine** neue Env-Variable, **kein** neues Flag, **keine** neue Dependency.

## Risiko, das benannt gehoert (Pre-Mortem)

Ein Jahr spaeter, die Entscheidung war falsch: ein Pfad, der wie `/_astro/` aussah, war
**nicht** fingerprintet — die Nutzer bekamen ein Jahr lang eine kaputte Datei, die kein
Deploy und kein Rollback erreichen konnte. Gegenmassnahme: der Praefix wird **exakt**
gematcht (nicht "enthaelt `_astro`"), und der Test belegt beide Richtungen — eine Datei
unter `/_astro/` bekommt `immutable`, eine daneben liegende Datei **nicht**.
