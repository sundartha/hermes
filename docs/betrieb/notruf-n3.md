# Notruf N3: Kostendecke eines Mandanten oder Kostenalarm

Prüfliste: Kennung N3 in `docs/betrieb/launch-pruefliste.md`. Die pro-Tenant-Kostendecke sperrt beide Richtungen, auch Inbound (Quelle: `src/konfiguration/rohwerte-billing.ts`, Schlüssel `MAX_BUDGET_EUR` und `DEFAULT_TENANT_BUDGET_CENTS`, Beschreibung in `.env.example`). Sie wird in diesem Notfall nie gelockert, umgangen oder per Datenbankeingriff ausgehebelt.

## Symptom

Ein Mandant meldet, dass Anrufe abgewiesen werden, oder eine Kostenwarnung (`PLATFORM_SPEND_WARN_PERCENT` in `.env.example`) kommt an, oder die Ausgaben eines Mandanten steigen ungewöhnlich.

## Prüfen

1. Den betroffenen Mandanten und seine Ausgaben im Betreiberbereich ansehen.
2. Prüfen, ob die Ausgaben echten Anrufen entsprechen (Verlauf der Anrufe, Ziele, Häufung auf dieselbe Nummer).
3. Bei Verdacht auf Missbrauch (Toll-Fraud, Schleifen): zuerst `docs/betrieb/notruf-n1.md`.

## Beheben

- Gesperrt durch die Decke und echte Nutzung: Die Sperre bleibt. Eine Änderung der Decke ist eine Entscheidung von Antonio, mit Kunde und Rechnungsgrundlage, nie unter Zeitdruck allein.
- Unerklärliche Ausgaben: `OUTBOUND_FROZEN` setzen, Ursache klären, erst dann lösen.
- Dem Mandanten sagen, warum gesperrt wurde und wann es weitergeht.

## Eskalieren

Über den Kontaktpunkt `bereitschaft` Antonio ansprechen, sobald Ausgaben nicht erklärbar sind oder mehrere Mandanten betroffen sind.
