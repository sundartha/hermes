# P3 - Ein gescheiterter Consult hinterlaesst eine dauerhafte Spur

Autoritative Spec fuer Phase P3 aus `PLAN-ANRUFDEFEKTE.md` (Abschnitt 4, P3). Umbrella-Kontext:
N-10 und W8 in Abschnitt 2.

## Warum (in einem Satz)

Dass eine Rueckfrage gescheitert ist, war am 06.09. nur ueber rohe Prod-DB-Forensik sichtbar -
`call.consults` wird nirgends nach aussen gegeben, und der Zeitpunkt der Zustellung wurde gar
nicht festgehalten. Genau deshalb brauchte die Aufklaerung eine Zeugenaussage statt einer
Messung. Diese Phase liefert die Telemetrie, aus der die vorlaeufigen Fristen von P2 (Stufe 0
und 1) nachkalibriert werden.

## SCOPE

| Datei | Aenderung |
|---|---|
| `src/routes/webhooks-elevenlabs.js` | beim Ergebnis "Abbruch" (alle drei Gruende aus P2: `not_delivered`, `not_acked`, `timeout`) ein durabler Audit-Eintrag ueber den BESTEHENDEN `makeDurableAudit`-Weg. Aktion `consult_timeout`. |
| neu `test/el-consult-timeout-spur.test.js` | Nachweis |

### Felder des Audit-Eintrags

Pflicht: `tenantId`, `callId`, `consultId`, `holdMs` (die tatsaechlich gehaltene Dauer in ms),
`reason` (`not_delivered` / `not_acked` / `timeout`, aus P2 am Datensatz vorhanden).

Empfohlen, weil sie die Kalibrierung von Stufe 0/1 erst moeglich machen und alle drei
inhaltsfrei sind: die Zeitspannen `askedAt -> deliveredAt` und `deliveredAt -> ackedAt` in ms
(fehlend, wo die Stufe nicht erreicht wurde). Ohne sie ist die Frage "waren 5000 ms zu knapp?"
weiterhin nur ueber DB-Forensik beantwortbar.

**Verboten (Blocker):** Fragetext, Antworttext, Transkriptfragmente, Telefonnummern,
Briefing-/Zielinhalte. Der Fragetext ist Gespraechsinhalt (Absolute Regel 4/5).

## ENTSCHEIDUNGEN (bindend)

- **E-1: kein neuer Audit-Weg.** Der bestehende durable Audit-Mechanismus wird benutzt, nicht
  nachgebaut (G5).
- **E-2: genau EIN Eintrag je gescheitertem Consult.** Kein Eintrag bei Erfolg, kein zweiter
  Eintrag bei einer spaeten, verworfenen Antwort.
- **E-3: der Eintrag ist eine Beobachtung, keine Alarmklasse.** Kein Outage-Code, keine SMS,
  keine neue Alarmierung (Owner-Entscheidung F-5, sinngemaess: der SMS-Kanal ist derzeit
  ohnehin defekt, eine Klasse ohne Kanal ist Kosmetik).

## INVARIANTEN (Verletzung = Blocker)

- **I-1:** Keine neue Route, kein Eintrag in `src/route-policy.js`, keine neue Auth-Ausnahme.
- **I-2:** Kein Gespraechsinhalt im Audit-Eintrag. Der Test weist das mit einer
  Marker-Zeichenkette in der Frage nach, die im Eintrag NICHT vorkommen darf.
- **I-3:** Das Verhalten am Telefon aendert sich nicht. Diese Phase ist rein additiv; der
  Audit-Schreibvorgang darf den Halt nicht verlaengern und darf bei einem Schreibfehler den
  Anruf nicht beeintraechtigen (fail-soft, aber nicht still: eine Logzeile ohne Inhalt).

## Abnahme (deterministisch)

1. Nach einem Abbruch existiert genau EIN `audit_log`-Datensatz mit `action = 'consult_timeout'`
   und korrektem `tenant_id`/`call_id`.
2. Der Datensatz enthaelt an keiner Stelle den Fragetext (Marker-Zeichenketten-Test).
3. Bei einer beantworteten Rueckfrage entsteht KEIN solcher Eintrag.
4. Der Grund (`reason`) im Eintrag entspricht der Stufe, an der abgebrochen wurde - je ein Fall
   fuer `not_delivered`, `not_acked`, `timeout`.

## Verifikation

```
node --check src/routes/webhooks-elevenlabs.js
node --test test/el-consult-timeout-spur.test.js
node --test test/el-consult-staffelung.test.js
npm test
```

## ABGRENZUNG (ausdruecklich NICHT in dieser Phase)

- Keine Aenderung an den Fristen aus P2 (die Kalibrierung erfolgt spaeter, aus DIESEN Daten).
- Keine Alarmklasse, kein Outage-Code, kein SMS-Versand (F-5).
- Keine Aenderung an `call.consults` in den nach aussen gegebenen Views (`views.js`,
  `mcp-tools.js`) - die Sichtbarkeitsluecke aus W8 bleibt bewusst offen; hier entsteht die
  Spur im Audit, nicht eine neue Ausgabe.
- Keine Aenderung an der Agenten-Vorlage, kein Push.
