# Hermes-Instanzen: sicherer Teilbeleg, 20.11.2026 23:20 (nur gelesen, keine Außenwirkung)

Korrektur: Meine Meldung 23:11 "Mac gesperrt" war pauschal falsch. Laut Antonio-Hinweis 23:15 hat der MacBook
um 23:13 system.which(date) über das Gateway beantwortet; mein eigener Mac-Aufruf scheiterte vor der Geräteliste.
Der Mac ist damit nicht grundsätzlich gesperrt.

Commit: 271821c70a84f38c5dc72b3dd8070339b322c286 (master, 20.11. 21:51Z)
GitHub-Lauf "staging" 44824018815: success
- Staging meldet erwarteten Commit 271821c (Render hermes-staging-erpv).
- /mcp ohne Anmeldung: 401 wie erwartet; fremd signierte Webhooks voice/outbound und voice/status: 403 wie erwartet.
- Staging-Status: HTTP 200, Datenbank, Flush und Commit stimmen: ja. Telnyx-Schlüssel ok: ja.
- Anrufprobe übersprungen (STAGING_PROBE_ZIEL nicht gesetzt) -> kein Anruf.
CI-Lauf 44824018833 auf demselben Commit: success.
render.yaml: keine numInstances -> Staging läuft laut Konfiguration mit einer Instanz.

Fehlt für den Nachweis mehrerer echter Instanzen:
1. Instanzzahl >1 auf Render (Kosten-/Zugangsänderung: nur Antonio).
2. Probe, die zwei verschiedene Instanzen im selben Staging belegt (z. B. Instanz-Kennung in /intern/status) - gibt es heute nicht, wäre ein Häppchen.
3. Echter Testanruf über Instanz-Wechsel - nicht erlaubt ohne Antonio.
Die Zwei-Instanzen-Tests (test/anrufe/zwei-instanzen-postgres.js u. a.) beweisen die Logik gegen Postgres in CI, nicht echte Render-Instanzen; deren Einzelergebnis habe ich hier nicht ausgelesen.
