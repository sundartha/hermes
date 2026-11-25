# Notruf N1: Kill-Switch OUTBOUND_FROZEN setzen und lösen

Prüfliste: Kennung N1 in `docs/betrieb/launch-pruefliste.md`. Der Schalter `OUTBOUND_FROZEN` sperrt alle ausgehenden Anrufe sofort (Beschreibung und Default in `.env.example`). Er wird nie umgangen und nie per Code gelockert; diese Seite beschreibt nur die Bedienung.

## Symptom

Hermes ruft unerwartet oder zu oft an, Kosten laufen unkontrolliert, ein Anbieter verhält sich falsch, oder eine Bereitschaftsseite verlangt „zuerst sperren“.

## Prüfen

1. Im Render-Dashboard die Umgebung des Dienstes öffnen und den aktuellen Wert von `OUTBOUND_FROZEN` ansehen.
2. Im Dashboard `docs/betrieb/grafana/dashboard.json` ansehen, ob noch neue Anrufe entstehen (Kennzahlen `hermes.call.*`).
3. Hinweise zu gesperrten Anrufen: `docs/RUNBOOK-OUTBOUND.md`.

## Beheben

1. Setzen: `OUTBOUND_FROZEN` im Render-Dashboard auf `true`, speichern. Kein Deploy nötig (Quelle: `.env.example`).
2. Prüfen: Ein neuer Outbound-Versuch wird mit 403 abgewiesen. Laufende Gespräche enden nicht von selbst; sie begrenzt die Max-Gesprächsdauer.
3. Ursache beheben (andere Notrufseite oder Anbieter).
4. Lösen: erst wenn die Ursache behoben und von einer zweiten Person bestätigt ist, `OUTBOUND_FROZEN` auf `false` setzen. Danach einen einzelnen Testanruf an die eigene Nummer auslösen und den Verlauf beobachten.

Die Probe für die Prüfliste (Setzen und Lösen) macht Antonio auf der echten Umgebung und trägt Wert, Datum und Beleg selbst in die Prüfliste ein.

## Eskalieren

Lässt sich der Schalter nicht setzen oder wirkt er nicht, den Dienst im Render-Dashboard anhalten und die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen (`docs/betrieb/bereitschaft.md`).
