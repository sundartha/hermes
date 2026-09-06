# P1 - Das Torleck schliessen: eine Frage, ein Praedikat

Autoritative Spec fuer Phase P1 aus `PLAN-ANRUFDEFEKTE.md` (Abschnitt 4, P1). Diese Datei geht
dem Plan-Dokument vor. Umbrella-Kontext: W1 in Abschnitt 2 desselben Dokuments.

## Warum (in einem Satz)

Der Rueckfrage-Webhook `POST /webhooks/elevenlabs/consult` prueft die Owner-Bedingung NICHT,
waehrend der Anrufstart sie prueft. Dadurch nimmt der Webhook einen `get_consult` auf einem
Owner-Anruf an, haelt die Telefonverbindung 47 s und der Anrufer hoert Stille. Gemessen am
Anruf `call_mtq08ett4l3o` (06.09., `callee_is_owner = t`, `consults[0].status = "timed_out"`).

## SCOPE

| Datei | Aenderung |
|---|---|
| `src/consult/gate.js` | neue exportierte Funktion `consultAllowedForCall(call, profile)` = `consultAllowedFor(profile) && call.calleeIsOwner !== true`. EINE Stelle, die beide Tore benutzen (G5 - die Divergenz darf nicht wieder entstehen). Strikt `!== true`: ein Bestandsdatensatz ohne das Feld heisst NICHT-Owner, wie ueberall sonst. |
| `src/elevenlabs/outbound.js` (Stelle, an der `consult_available` fuer die dynamischen Variablen berechnet wird) | ersetzt den inline-Ausdruck durch `consultAllowedForCall(call, store.resolveProfile(call.tenantId))` - **verhaltensgleich**, reine Umverdrahtung |
| `src/routes/webhooks-elevenlabs.js` (Annahme-Bedingung des Consult-Webhooks) | `consultAllowedFor(store.resolveProfile(call.tenantId))` -> `consultAllowedForCall(call, store.resolveProfile(call.tenantId))`; der Kommentarblock direkt darueber bekommt den Satz, dass `calleeIsOwner` KEIN Turn-Fakt ist (anders als die dort bewusst ausgelassenen Turn-Fakten) und deshalb sehr wohl uebernommen wird |
| `test/elevenlabs-consult-webhook-guards.test.js` | neue Faelle (siehe Abnahme) |

Keine Zeilennummern aus dem Plan-Dokument uebernehmen - sie rotten. Symbole greppen.

## ENTSCHEIDUNGEN (bindend)

1. **Ein Praedikat, zwei Aufrufer.** Die Bedingung wird NICHT ein zweites Mal inline
   ausgeschrieben. Genau deshalb ist der Defekt entstanden.
2. **`!== true`, nicht `=== false`.** Ein Anruf-Datensatz aus der Zeit vor dem Feld traegt
   `undefined` und gilt als NICHT-Owner. Das ist die Bestandssemantik an allen anderen Stellen.
3. **Der Ablehnungsgrund heisst `kanal_nicht_freigegeben`** - derselbe Grund und derselbe
   Logsatz wie bei einer Ablehnung wegen fehlender Profilfreigabe. Kein neuer Grund, kein
   neuer HTTP-Status: **404**, wie der bestehende Ablehnungspfad.
4. **Die Ablehnung passiert VOR jedem Halten und vor jedem Schreiben.** Kein Consult-Datensatz,
   kein offener Slot, keine gehaltene Anbieter-Verbindung.

## INVARIANTEN (Verletzung = Blocker)

- **I-1:** `consult_available` in den dynamischen Variablen bleibt fuer JEDEN Anruf
  byte-identisch zum Bestand. Die Umverdrahtung in `src/elevenlabs/outbound.js` ist rein
  mechanisch; ein Verhaltensunterschied dort ist ein Fehler, kein Feature.
- **I-2:** Ein Consult auf einem Anruf mit `calleeIsOwner !== true` verhaelt sich in JEDER
  Hinsicht unveraendert (Status, Antwortkoerper, Logzeilen, Datensatz).
- **I-3:** Die Aenderung kann keinen zusaetzlichen Request durchlassen. Sie lehnt strikt mehr
  ab. Ein Diff, der irgendwo eine Bedingung lockert, ist falsch.
- **I-4:** Keine neue Route, kein Eintrag in `src/route-policy.js`, keine neue Auth-Ausnahme.
- **I-5:** Kein Fragetext, keine Antwort und kein Transkriptfragment gelangen in Logs
  (Absolute Regel 4/5).

## Abnahme (deterministisch)

1. `POST /webhooks/elevenlabs/consult` mit gueltigem Token, gueltiger `conversation_id` und
   gueltiger Frage auf einem Anruf mit `calleeIsOwner = true` antwortet **404** mit dem
   Ablehnungsgrund `kanal_nicht_freigegeben`; `call.consults` bleibt **leer**; es entsteht
   **keine** `[consult-raised] gestellt`-Zeile; die Antwort kommt in **unter 1 s** (kein Halt).
2. Derselbe Aufruf auf einem Anruf mit `calleeIsOwner = false` verhaelt sich unveraendert
   (200, `[consult-raised] gestellt`).
3. `consult_available` in den dynamischen Variablen bleibt byte-identisch zum Bestand
   (Regressionstest, deckt I-1).

## Verifikation

```
node --check src/consult/gate.js && node --check src/routes/webhooks-elevenlabs.js && node --check src/elevenlabs/outbound.js
node --test test/elevenlabs-consult-webhook-guards.test.js
node --test test/callee-is-owner-elevenlabs.test.js test/elevenlabs-anrufstart.test.js
npm test
grep -n "calleeIsOwner" src/routes/webhooks-elevenlabs.js src/consult/gate.js   # Positiv-Kontrolle: nicht-leere Ausgabe
```

## ABGRENZUNG (ausdruecklich NICHT in dieser Phase)

- **Keine Aenderung an der Haltefrist.** `CONSULT_OPEN_MS` und der gestaffelte Halt sind P2.
- **Keine Aenderung am Audit/an der Telemetrie.** Das ist P3.
- **Keine Aenderung an der OC-Ausnahme, am Offenlegungssatz oder an `calleeIsOwner` selbst.**
  P1 LIEST das Feld, es aendert es nicht und weitet nichts aus.
- **Keine Aenderung an der Agenten-Vorlage** (`elevenlabs/agent_configs/*`), kein Push.
- Kein neuer Env-Schalter. Kein neues npm-Paket.
