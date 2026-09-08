# Kettenstand: Behebungskette Sicherheitstest (SEC-P0..SEC-P6)

Manifest: `PLAN-SEC-FIX.md`. Belege: `tasks/sicherheitstest-befunde.md`.
Kickoff (Lead-Rolle): `tasks/sec-fix-kickoff.md`.

## Stand je Phase

| Phase | Titel | Merge-Commit | Abnahme erfuellt | Bemerkung |
|---|---|---|---|---|
| SEC-P0 | Testbank gruen | — | — | laeuft |
| SEC-P1 | Webhook-Idempotenz | — | — | wartet auf gruene Bank |
| SEC-P2 | Lieferkette | — | — | — |
| SEC-P3 | Eingabegrenzen + CSRF | — | — | — |
| SEC-P4 | EL-Token je Mandant | — | — | — |
| SEC-P5 | Web-Haertung | — | — | — |
| SEC-P6 | Antwort statt Haenger + Waechter | — | — | — |

## Ausgangsmessung des Leads (voller Lauf, vor SEC-P0)

`npm test` -> Exit 1, `# tests 5803 / # pass 5801 / # fail 2 / # skipped 0`.
Rot: `KV2-10 (d1)` und `KV2-10 (d2)` aus `test/kv2-10-tarifpaar.test.js`.
Die fuenf bekannten Flake-Dateien haben in diesem Lauf NICHT gefeuert.

## Offene Befunde

(noch keine)

## Owner-Blocker (nicht vom Assistenten baubar, s. PLAN-SEC-FIX.md Abschnitt 3)

1. Vier Repo-Secrets `TELNYX_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`,
   `PLATFORM_ANI_E164` auf `jonas986/vodafone-agent` — ohne sie hat der
   Art.-50-Offenlegungs-Drift-Waechter NIE gelaufen und scheitert stuendlich.
2. Render-Zugang fuer den Owner (Produktions-Workspace gehoert `jonas@kroh-willich.de`) —
   DB-05 (Backup + Drill) und der OPS-03-Rest sind ohne ihn nicht messbar.
3. Rotation des Render-API-Schluessels (liegt literal in `~/.claude.json`, Schreibrechte auf
   Produktion, ohne Ablauf).
4. Stripe-Zugang (`team@sundartha.com`) — OPS-04 offen.
5. Zwei-Faktor am Render-Konto des Owners ist aus.

## Ausdruecklich nicht Teil der Kette

ID-01 (Besitznachweis eigene Nummer, Owner-Entscheidung 2026-09-08), L-04, GATE-04, W4.
