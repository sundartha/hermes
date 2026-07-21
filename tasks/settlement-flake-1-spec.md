# SETTLEMENT-FLAKE-1 — Doppelbuchungs-Test ist unzuverlaessig

Vorbestehender Flake auf `master` (NICHT von LCT-FIX-1 eingeschleppt — auf beiden
Staenden gemessen). Betrifft den Geldpfad.

## 1. Symptom + Basismessung

`test/telnyx-event-ingest-route.test.js`, Test
`"call.hangup: Settlement idempotent - billedAt + reserveReleased gesetzt, zweites hangup bucht NICHT doppelt"`

```
Basismessung master @ 69ec7cd, isoliert:  4 von 15 Laeufen ROT (~27 %)

AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  false !== true
  at test/telnyx-event-ingest-route.test.js:74
```

Zeile 74 ist `assert.equal(state1.calls[0].reserveReleased, true)`.

## 2. Die Wurzel-Frage — ZUERST beantworten, NICHT umgehen

Zeile 71 wartet ausschliesslich darauf, dass `billedAt` gesetzt ist:

```js
const state1 = await waitForStoreState(srv, (s) => Boolean(s.calls[0].billedAt));
```

Zeile 74 prueft danach `reserveReleased`. Der Test kann also einen **halb
abgeschlossenen** Zustand beobachten. Daraus folgen zwei konkurrierende Hypothesen —
welche zutrifft, ist **am Code zu belegen**, nicht zu vermuten:

**H1 (Testschuld):** Abrechnung und Reserve-Freigabe passieren in EINER synchronen
Mutation; nur die Wartebedingung des Tests ist zu eng bzw. der beobachtete Snapshot
faellt zwischen zwei Persistenz-Schreibvorgaenge. -> Fix im Test: auf BEIDE Felder
warten.

**H2 (Produktdefekt):** `finishCall` setzt `billedAt` und `reserveReleased` in
getrennten, nacheinander persistierten Schritten. Dann ist der Flake das ehrliche
Signal eines echten Fensters: bricht der Prozess dazwischen ab (Render-Free-Tier
startet regelmaessig neu), bleibt eine **Reserve dauerhaft gebunden** — sie blockiert
das Tenant-Budget, ohne je freigegeben zu werden. -> Fix im Produkt.

**Verboten:** die Wartebedingung verbreitern, ein `setTimeout` verlaengern oder den
Test retryen, OHNE H1 vorher belegt zu haben. Das waere eine abgeschaltete Sicherung
(CLAUDE.md, hart verboten): der Test sichert genau die Zusicherung ab, dass ein Anruf
nicht doppelt abgerechnet wird. Ein gruener Test, der eine echte Race verdeckt, ist
schlechter als ein roter.

Relevante Stellen (Startpunkte, nicht abschliessend): `src/telephony/call-finish.js`,
`src/telephony/call-termination.js`, `src/store/state-ops.js` (`releaseReserve`,
`billedAt`), `src/telnyx-call-control-ingest.js` (`onHangup`).

## 3. Deterministisches Abnahmekriterium

| | |
| --- | --- |
| **Rot (heute)** | 4 von 15 isolierten Laeufen rot |
| **Gruen (Ziel)** | **30 von 30** isolierten Laeufen gruen: `for i in $(seq 1 30); do node --test test/telnyx-event-ingest-route.test.js; done` |
| Zusaetzlich | `npm test` vollstaendig gruen |

30 Laeufe sind bewusst gewaehlt: bei ~27 % Fehlerrate ist die Wahrscheinlichkeit,
dass 30 Laeufe zufaellig alle gruen sind, verschwindend (~0,01 %). Weniger Laeufe
beweisen nichts.

## 4. Randbedingungen

1. **Faellt die Entscheidung auf H2**, ist die Zusicherung im Produkt herzustellen
   (eine Mutation, ein Save) — und der bestehende Test bleibt als Nachweis erhalten.
   Ein Regressionstest, der das Fenster gezielt trifft, ist erwuenscht.
2. **Faellt sie auf H1**, ist im Test-Kommentar zu begruenden, WARUM die Reihenfolge
   der beiden Felder keine Crash-Sicherheits-Frage ist (mit Verweis auf die Codestelle,
   die die Atomaritaet garantiert). Eine blosse Verbreiterung der Wartebedingung ohne
   diese Begruendung ist NICHT ausreichend.
3. Der zweite Teil des Tests (zweites `hangup` bucht nicht doppelt, Zeile 77-82) bleibt
   inhaltlich unangetastet.
4. Kein neues Timing-Konstrukt als Loesung: kein laengeres `setTimeout`, kein Retry-
   Wrapper, kein `--test-retries`.

## 5. Verifikation

- `node --check` auf jede geaenderte Quelle
- 30 isolierte Laeufe des betroffenen Tests, alle gruen (Zaehlung im Report belegen)
- `npm test` vollstaendig gruen
