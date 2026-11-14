# Aufbewahrung und Aufräumläufe

Jede Zeile nennt Tabelle oder Archiv, was gelöscht wird und wo Frist und Aufräumlauf stehen. Werte stehen nur an der genannten Quelle.

## Einstellungen mit dem Wert 0

| Einstellung | Bedeutung von `0` | Quelle |
| --- | --- | --- |
| `RETENTION_DAYS` | Aufbewahrung aus: nichts wird gelöscht, beendete Anrufe, Benachrichtigungen und erledigte Action Items bleiben unbegrenzt liegen. | `.env.example`, `src/store/state-ops.js` (`pruneExpiredRecords`) |
| `DIAGNOSTIC_RETENTION_DAYS` | Diagnosemodus aus: kein Anruf wird neu markiert, bereits markierte Roh-Transkripte werden beim nächsten Lauf gelöscht. | `.env.example`, `src/diagnostic-retention.ts`, `src/store/state-ops.js` (`purgeExpiredDiagnosticTranscripts`) |
| `EVIDENCE_RETENTION_DAYS` | Zitate aus: es werden keine Zitate erhoben, vorhandene werden beim nächsten Lauf entfernt. | `.env.example`, `src/call-result.ts`, `src/store/state-ops.js` (`purgeExpiredResultEvidence`) |

Die drei Läufe starten beim Boot und danach im Takt `RETENTION_SWEEP_INTERVAL_MS` über `starteAufbewahrung` (`src/zeitsteuerung.js`, Aufruf in `src/boot.js`). Mit `QUEUE_BACKEND=pgboss` ist der Takt ein pg-boss-Zeitplan (`plane` in `src/queue/adapters/pgboss/queue.ts`) und läuft bei mehreren Instanzen je Takt einmal; mit `memory` läuft er im Prozess.

Dieselbe Regel gilt für die Session-Aufbewahrung (`src/wiring/session-aufbewahrung.js`), den Löschtakt der Webhook-Ablage (`planeLoeschtakt` in `src/store/webhook-zustellung.js`) und die vier Sweeps des Web-Logins (`src/wiring/web-login.js`: did-release, contract-end, cancellation-mail, stripe-reconcile); Namen und Takte stehen dort. Ein pg-boss-Zeitplan kennt nur Takte in ganzen Minuten oder Stunden, die 24 h teilen (`cronFuerTakt` in `src/queue/adapters/pgboss/queue.ts`); ein anderer Takt lässt den Start scheitern.

Die neun Teilläufe des Sweep-Takts (`TEILLAEUFE` in `src/zeitsteuerung.js`, Aufruf `starteSweepTakt` in `src/boot.js`) sind je ein eigener Zeitplan im Takt `costTruingSweepIntervalMs` (`src/konfiguration/rohwerte-billing.js`) und gelten nach derselben Regel; die Frist des Herzschlags steht in `src/queue/zeitplan-frist.ts`.

## Tabellen mit Frist und Aufräumlauf

| Tabelle oder Archiv | Frist und Lauf | Quelle |
| --- | --- | --- |
| `call`, Benachrichtigungen, erledigte Action Items | `RETENTION_DAYS` | `src/config.js` (`privacy.retentionDays`), `src/store/state-ops.js` |
| `session` | `SESSION_AUFBEWAHRUNG_TAGE` nach Ungültigmachen, ohne Ungültigmachen nach Ablauf; Lauf beim Start und alle 6 Stunden | `src/wiring/session-aufbewahrung.js` |
| `cookie_consent_log` | `COOKIE_CONSENT_RETENTION_DAYS`, täglicher Lauf | `src/cookie-consent-log.js` |
| `leitungsplatz`, `webhook_zustellung`, `login_bremse`, `instanz_lebenszeichen` | eigener Ablauf je Zeile, Löschen im jeweiligen Store | `src/store/leitungsplaetze-pg.js`, `src/store/webhook-zustellung.js`, `src/store/login-bremse.js`, `src/store/instanz-besitz.js` |
| Archiv der Warteschlange (pg-boss) | Aufbewahrung, Löschen nach Erledigung und Totpost-Aufbewahrung als Konstanten `RETENTION_SECONDS`, `DELETE_AFTER_SECONDS`, `DEAD_LETTER_RETENTION_SECONDS`; Pflege durch pg-boss | `src/queue/adapters/pgboss/queue.ts` |

## Bewusst unbegrenzt, Entscheidung offen

Diese Tabellen haben keinen Aufräumlauf. Geld- und Nachweisdaten werden nicht ohne ausdrückliche Entscheidung je Tabelle gelöscht (Issue #3373):

- `audit_log` (Compliance, `src/db/migrations/0001_ausgang.sql`)
- `usage_event`
- `call_cost_evidence`
- `cost_cross_check`
- `stripe_ereignis_register`
