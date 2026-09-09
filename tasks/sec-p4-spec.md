# SEC-P4 — Ergaenzung zum Phasenabschnitt in PLAN-SEC-FIX.md

ERGAENZT `PLAN-SEC-FIX.md` -> "SEC-P4 — ElevenLabs-Werkzeug-Token je Mandant". Ersetzt ihn
nicht.

## Der Anbieter-Fakt, an dem die naheliegende Loesung scheitert

Der Auftrag lautet "dem Token eine Mandanten-Dimension geben". Wer das als "je Mandant ein
eigener Header-Token" liest, plant gegen eine Wand:

- Es gibt **EINE** geteilte Agent-Konfiguration (`elevenlabs/agent_configs/outbound-agent.template.json`),
  nicht eine je Mandant.
- Der Token liegt als **EIN Workspace-Secret** im ElevenLabs-Konto (`hermes_tool_token`) und
  wird in der Konfiguration nur ueber seine `secret_id` referenziert; der Agent sendet ihn im
  Header `x-hermes-tool-token`. Beide Werkzeuge (`get_consult`, `look_up`) teilen ihn
  bewusst — "ein zweites Geheimnis waere ein zweiter Rotationsfall ohne Sicherheitsgewinn".
- Ein Header-Wert in dieser Konfiguration ist damit **statisch fuer alle Mandanten**. Eine
  per-Mandant unterschiedliche Kopfzeile ist ohne per-Mandant-Agenten nicht konfigurierbar.

**Der Plan muss also zuerst benennen, WOHER die Mandanten-Dimension kommt**, und die Wahl
gegen diesen Fakt begruenden. Was der Anbieter je Gespraech tatsaechlich mitschickt bzw. was
wir ihm beim Anrufstart mitgeben koennen, ist am Code UND an der Vorlage zu ERMITTELN — nicht
anzunehmen.

**Gotcha, dokumentiert und teuer gelernt:** die Form des Werkzeug-Anfragekoerpers ist
ueberraschend (flach; die `client-tools`-Doku des Anbieters gilt fuer diesen Weg NICHT). Was
genau ankommt, wird an `src/routes/webhooks-elevenlabs.js` und an der Live-Vorlage abgelesen,
nicht aus der Anbieter-Doku uebernommen.

## Diese Kette deployt NICHT — daraus folgt eine harte Bauvorgabe

Es wird nicht gepusht, nicht deployt und kein Live-Wert am Anbieter geaendert. `scripts/push-elevenlabs.mjs`
schreibt ausserdem die GANZE Live-Konfiguration aus der lokalen `.env` (bekannte Falle) — ein
unbedachter Push ist ein Live-Eingriff, kein Test.

**Daraus folgt:** der Server darf nach dieser Phase NICHTS verlangen, was die heutige
Anbieter-Konfiguration nicht schon schickt. Sonst gilt am naechsten Deploy: `look_up` und
`get_consult` antworten 403, die In-Call-Recherche stirbt, und der Agent steht im Gespraech
stumm da — und Stille ist im Anruf der schlimmste Ausgang (Bestandslehre
`in-call-research-is-mandatory`).

Zulaessig sind deshalb nur Bauarten, die **entweder** ohne jede Anbieter-Aenderung wirken
**oder** additiv sind (neues Merkmal wird geprueft, wenn vorhanden; fehlt es, gilt das
heutige Verhalten) und den scharfen Zustand hinter einem Schalter mit dem HEUTIGEN Verhalten
als Default tragen. Braucht die Endstufe einen Anbieter-Push, gehoert dieser Schritt als
Owner-Blocker in den Kettenstand — er wird nicht heimlich vorweggenommen.

## Pre-Mortem (Pflicht nach CLAUDE.md)

1. **Die In-Call-Werkzeuge sind tot.** Der Server verlangt ein Merkmal, das der Anbieter nicht
   sendet. Jeder Anruf verliert Recherche und Rueckfrage. Siehe Absatz oben — das ist der
   teuerste Ausgang und der wahrscheinlichste.
2. **Die Vereinheitlichung der Ablehnung hat die Diagnose mit begraben.** Aussen duerfen
   Fall (a) und Fall (b) nicht mehr unterscheidbar sein — im LOG muessen sie es bleiben,
   sonst ist der naechste echte Vorfall nicht mehr aufklaerbar.
3. **Das Praedikat ist zu streng und trifft den berechtigten Mandanten.** Deshalb ist die
   Positiv-Kontrolle nicht Kuer: der richtige Mandant muss unveraendert durchkommen.
4. **Der Fix hat nur die Auskunft geglaettet, nicht die Reichweite genommen.** Gleiche
   Fehlermeldung, aber der fremde Anruf ist weiterhin ansprechbar — dann ist der Befund
   kosmetisch behoben. Der Test muss belegen, dass die BINDUNG scheitert, nicht nur dass der
   Text gleich aussieht.
5. **Ein zweites Geheimnis wurde eingefuehrt**, wo das Haus bewusst eins hat. Das verdoppelt
   den Rotationsfall ohne Gewinn; wenn doch, muss der Plan es begruenden.

## Ausgangsmessung (aus dem Abschnitt, hier zur Bequemlichkeit)

Gegen `POST /webhooks/elevenlabs/lookup`, zwei Mandanten mit je einem laufenden Anruf:

| Fall | Eingabe | Antwort heute |
|---|---|---|
| 0 | falsches Token | `403 token` |
| a | erfundene `conversation_id` | `404 kein_laufender_anruf` |
| b | `conversation_id` des Anrufs von Tenant B | **`404 kanal_nicht_freigegeben`** |

Der ABWEICHENDE Grund in (b) ist der Beweis: die Bindung an den fremden Anruf gelang, gestoppt
hat allein die Konfiguration des Opfers. `activeCallBoundTo` sucht ueber ALLE Anrufe und matcht
nur `elevenlabsConversationId` + `status==='active'` — kein Mandanten-Praedikat.

## Abnahme

1. Derselbe Differential-Aufbau als Regressionstest: Fall (b) liefert **denselben**
   Ablehnungsgrund wie Fall (a).
2. **Positiv-Kontrolle:** der BERECHTIGTE Mandant kommt unveraendert durch (200 + die
   erwartete Auskunft) — sonst misst der Test eine tote Route.
3. Aus Pre-Mortem 4: der Test belegt die gescheiterte BINDUNG, nicht nur den gleichen Text.
4. Aus Pre-Mortem 1: ein Aufruf in der HEUTIGEN Anbieter-Form (ohne ein etwaiges neues
   Merkmal) wird weiterhin bedient, solange der scharfe Schalter aus ist.
