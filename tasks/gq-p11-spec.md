# GQ-P11 — Diagnose-Aufbewahrung haengt nicht mehr am Modell

## Warum (gemessen, nicht vermutet)

- **58 Calls in der Prod-DB, kein einziger mit `diagnostic=true`.** (SQL, 2026-08-06)
- **Kein Call hat Summary UND Transkript-Segmente** (0 von 58). Der Purge haengt am
  Summary-Abschluss (`keepsTranscriptForDiagnosis`, `src/diagnostic-retention.js:36`).
  Folge: **jeder sauber beendete Anruf verliert sein Rohtranskript.**
- Der einzige Ausweg ist `call.diagnostic`, und der verlangt heute, dass **das Modell**
  `diagnostic: true` an `place_call` haengt — bei einer Werkzeug-Beschreibung, die woertlich
  sagt *"Never set it unasked"* (`src/mcp-tools.js:636-641`).
- Damit haengt das Diagnose-Werkzeug an genau dem Defekt, den es diagnostizieren soll
  (B-4: angebotene Werkzeuge werden nicht gewaehlt — `look_up` 0/19, `get_consult` 0/4).

Owner-Entscheidung O-B vom 2026-08-06: **der Code hoert auf, das Modell-Opt-in zu
verlangen.** Den Env-Wert und die Datenschutzerklaerung zieht der Owner selbst nach; das
ist NICHT Teil dieser Phase.

## Aenderung 1 — `diagnosticRetentionGranted` wird server-entschieden

`src/diagnostic-retention.js:27`. Neue Regel:

```
granted  <=>  diagnosticRetentionEnabled(privacy)
              UND ownNumber ist gesetzt
              UND to === ownNumber
              UND der Aufrufer hat NICHT ausdruecklich abgelehnt
```

Der Wunsch des Aufrufers wird damit vom **Opt-in zum Opt-out**. Begruendung: ein Anruf an
die eigene verifizierte Nummer des Tenants IST ein Testanruf — beide Seiten der Leitung
gehoeren demselben Tenant. Das Ziel-Gate (`to === ownNumber`) bleibt unangetastet und ist
weiterhin die eigentliche Datenschutz-Grenze.

**Falle, die der Bestandskommentar bereits benennt — sie kehrt sich jetzt um.** Heute steht
dort `requested !== true`, weil ein urlencoded `"false"` ein nicht-leerer String und damit
truthy ist. Nach der Umkehrung ist der gefaehrliche Fall genau spiegelbildlich: ein
urlencoded `"false"` ist `!== false` und wuerde die Ablehnung **verschlucken**. Die
Ablehnung muss deshalb explizit gegen beide Formen pruefen (Boolean `false` UND den String
`"false"`), nicht per Truthiness. Der bestehende Kommentar ist entsprechend zu ersetzen,
nicht zu loeschen — er hat den Fall schon einmal richtig gesehen.

**Fail-closed bleibt:** kein `ownNumber`, falsches Ziel oder `DIAGNOSTIC_RETENTION_DAYS=0`
ergibt weiterhin exakt das heutige Verhalten (Purge nach der Summary).

## Aenderung 2 — Boot-Sonde fuer `DIAGNOSTIC_RETENTION_DAYS`

`capabilityProbeLines` (`src/boot.js:526`) fuehrt fuenf Sonden; Diagnose-Retention fehlt.
Die einzige Log-Zeile, die den Wert nennt (`boot.js:68`), druckt **nur, wenn der Sweep etwas
geloescht hat** — Abwesenheit beweist dort nichts. Der Live-Wert ist heute nicht ablesbar.

Neue Sonde nach dem Muster von `evidenceProbeLine` (`boot.js:509-517`) — kein Bool, sondern
eine Frist, der Aus-Zustand kommt aus `diagnosticRetentionEnabled`, damit dieselbe
Entscheidung die Sonde traegt wie den Code. Wortlaut analog:

```
Diagnose-Transkripte: AKTIV (DIAGNOSTIC_RETENTION_DAYS=7) - Rohtranskript ueberlebt die Summary bei Anrufen an die eigene Nummer, Loeschung nach 7 Tagen
Diagnose-Transkripte: aus (DIAGNOSTIC_RETENTION_DAYS=0) - 0 = kein Rohtranskript ueberlebt
```

Die Sonde darf im Aus-Zustand **nicht** verschwinden (Regel steht in `boot.js:452-454`).

## Was diese Phase NICHT tut

- **Keine Aenderung an `DIAGNOSTIC_RETENTION_DAYS` selbst** — weder in `render.yaml` noch
  sonstwo. Der Live-Wert ist eine Owner-/Dashboard-Sache mit rechtlicher Vorbedingung
  (Datenschutzerklaerung muss den Diagnosemodus und die Frist nennen).
- **Kein neuer Env-Schalter, kein neues Tenant-Feld, keine neue Route, keine UI.**
- **`keepsTranscriptForDiagnosis` bleibt unangetastet** — die zweite Linie (Defense in
  depth) und der Purge-Pfad aendern sich nicht.
- **Kein Anfassen des Ziel-Gates** `to === ownNumber`.

## Der MCP-Parameter

`diagnostic` in `src/mcp-tools.js:636` bleibt bestehen, seine **Beschreibung aendert sich**:
er ist kein Opt-in mehr, sondern ein Opt-out ("set to false to NOT keep the transcript of a
test call to your own number"). Kein toter Parameter — er wird weiterhin gelesen, nur in der
anderen Richtung. Falls die Umsetzung zu dem Schluss kommt, dass er dadurch wirklich tot
waere, ist das ein Blocker und gehoert gemeldet, nicht still geloest.

## Verifikation — deterministisch

`npm test` muss gruen bleiben (heute 3970/3970). Neue Tests, offline, ohne Spawn:

1. `diagnosticRetentionGranted` gewaehrt bei Frist>0 + `to === ownNumber` **ohne** jedes
   `requested` -> `true` (das ist der Kern der Phase; heute `false`).
2. Ablehnung wirkt: `requested: false` -> `false`. **Und** `requested: "false"` -> `false`
   (die umgekehrte Falle oben).
3. Fremdes Ziel -> `false`, auch mit `requested: true`.
4. `diagnosticRetentionDays: 0` -> `false`, unabhaengig von allem anderen.
5. Kein `ownNumber` (null/leer) -> `false`.
6. Boot-Sonde: `capabilityProbeLines` enthaelt bei `diagnosticRetentionDays: 7` eine Zeile
   mit `AKTIV (DIAGNOSTIC_RETENTION_DAYS=7)`, bei `0` eine Zeile mit
   `aus (DIAGNOSTIC_RETENTION_DAYS=0)` — die Zeile ist in **beiden** Faellen vorhanden.

**Die Zahl, an der die Phase live gemessen wird** (nach dem naechsten Testanruf an die
eigene Nummer, mit `DIAGNOSTIC_RETENTION_DAYS>0`): ein Call mit
`summary IS NOT NULL` **UND** `count(transcript_segment) > 0`. Heute gibt es davon
**0 von 58**.

## Absolute Regeln, die diese Phase beruehrt

- **SECRETS/PII**: die Phase verlaengert die Aufbewahrung personenbezogener Rohdaten. Das
  Ziel-Gate (`to === ownNumber`) ist die Grenze, die das rechtfertigt — sie darf nicht
  aufgeweicht werden. `PLAN-SECURITY.md` ist zu aktualisieren (Pflicht laut CLAUDE.md bei
  sicherheitsrelevanten Aenderungen).
- Keine Safety-Gate-Kette wird angefasst; `diagnosticRetentionGranted` ist ausdruecklich
  **kein** Gate in `outboundGates` (Begruendung steht in `src/routes/api-calls.js:144-146`)
  und wird das auch nicht.
