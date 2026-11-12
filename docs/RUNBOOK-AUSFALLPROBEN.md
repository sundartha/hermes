# Runbook: Ausfallproben

Belegt vor dem Launch, wie sich Hermes bei Ausfall und Last verhaelt. Das Werkzeug `scripts/ausfallproben.mjs` startet Hermes lokal als Kindprozess, betreibt Anbieter und Datenbank hinter einer eigenen Stoerweiche und beobachtet nur von aussen (HTTP und Prozessstatus). Es aendert nichts unter `src/`.

## Aufruf

```
node scripts/ausfallproben.mjs <probe>
```

Proben: `elevenlabs-aus`, `elevenlabs-langsam`, `postgres-neustart`, `instanz-tod`, `deploy-bei-anruf`, `alle`.

Ausgabe je Probe eine JSON-Zeile mit `probe`, `ergebnis` (`gruen` oder `rot`), `schwelle`, `gemessen`, `grund` und bei Messungen `beleg`. `alle` fuehrt die fuenf Proben nacheinander aus und schliesst mit einer Zusammenfassung. Exit 0 nur bei Gruen, Exit 1 bei Rot oder fehlender Messung, Exit 2 bei einem abgelehnten Aufruf (unbekannte Probe, Ziel ausser 127.0.0.1).

## Schwellen

Die festen Schwellen stehen in `scripts/ausfallproben/schwellen.mjs`, je Probe unter ihrem Namen. Sie sind aus der Umgebung nicht aenderbar. Im Zweifel meldet eine Probe rot.

## Postgres

`postgres-neustart`, `instanz-tod` und `deploy-bei-anruf` brauchen ein lokales Postgres: Adresse in `HERMES_TEST_POSTGRES_URL` (Host `127.0.0.1` oder `localhost`, wie in `test/gemeinsam/echtes-postgres.js`). Ohne sie sind genau diese Proben rot mit Grund, sie werden nie uebersprungen. Die Proben legen eine eigene Datenbank an und loeschen sie wieder; `deploy-bei-anruf` legt dazu eine Rolle ohne Superuser an, weil der Web-Login von Hermes einen Superuser ablehnt (`src/boot-guard.js`, Portal-Pool).

`deploy-bei-anruf` haelt ueber `GET /auth/callback` eine eingehende Anfrage offen (der Code-Tausch mit dem Login-Anbieter haengt an der Weiche), sendet SIGTERM und prueft Exit 0, die Zeile `[shutdown] Finaler Store-Flush abgeschlossen` und die Frist. Die Abschaltung wartet auf offene HTTP-Anfragen (`src/abschalten.js`), nicht auf Gespraeche beim Anbieter.

## Grenzen

- Die Proben laufen nur gegen Prozesse, die das Werkzeug selbst startet. Es gibt keine Option fuer ein fremdes Ziel; weder Staging noch Produktion werden beruehrt.
- Das Kind bekommt eine leere Umgebung mit erfundenen Schluesseln, `OUTBOUND_FROZEN=true` und Adressen der Weiche. Kein Anruf, keine SMS, keine Zahlung kann entstehen. Schluessel des Aufrufers erreichen das Kind nie.
- Die Wirkung auf Staging belegt ein Mensch: Er loest die echten Testanrufe aus (zum Beispiel waehrend eines Deploys oder bei gestoertem Anbieter) und gibt vorher die Kosten frei. Das Werkzeug ersetzt das nicht und startet nie einen Anruf.
