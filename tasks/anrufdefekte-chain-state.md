# Kettenstand: PLAN-ANRUFDEFEKTE (Stand 07.09.2026)

Auftrag: die Phasen P1, P2, P3, P4, P6, P7 aus `PLAN-ANRUFDEFEKTE.md` autonom fahren.
P5 wurde nicht gebaut (Owner hat F-3 am 06.09. zurueckgestellt), P8/P9/P10 waren nicht Teil
des Auftrags.

## Was gemergt und damit im Code ist

| Phase | Merge | Wirkung |
|---|---|---|
| P1 | `c535566` | `consultAllowedForCall(call, profile)` in `src/consult/gate.js` - Anrufstart UND Rueckfrage-Webhook fragen dasselbe Praedikat. Ein `get_consult` auf einem Owner-Anruf wird mit 404 abgelehnt, bevor etwas gehalten oder geschrieben wird. Schliesst W1. |
| P2 | `fb5defb` | Dreistufiger Halt am EL-Rueckfrage-Webhook: `EL_CONSULT_DELIVERY_MS` / `EL_CONSULT_ACK_MS` / `EL_CONSULT_ANSWER_MS` (5000/5000/30000, env-aenderbar, nach oben geklemmt). `answer_consult` hat einen leichten Quittungs-Modus (`status=working`) - kein neues Werkzeug, damit keine zweite Connector-Berechtigung entsteht. Neue Consult-Marker `askDeliveredAt`/`ackedAt`/`timeoutReason` in beiden Store-Backends. Schliesst W2. |
| P3 | `5ea4526` | Jeder Abbruch schreibt genau einen durablen Audit-Eintrag `consult_timeout` mit `tenantId`/`callId`/`consultId`/`holdMs` und den Zeitspannen bis Zustellung und Quittung - ohne Fragetext (per Marker-Test nachgewiesen). Schliesst N-10. |
| P4a | `81629a6` | `place_call` fuehrt wieder ein optionales `language` (LANG-15 aufgehoben). Ohne Angabe gilt die Sprache des Auftraggebers statt der des Ziellandes; ein unbekannter Code wird mit 400 `unsupported_language` abgelehnt. **Die Offenlegungssprache folgt weiter dem Angerufenen** (`disclosureLanguageOf` vs. `conversationLanguageOf`, Bestandskette byte-identisch) und ist serverseitig verriegelt: weicht die Gespraechssprache ab, laesst ein Waechter `agent.first_message` nur durch, wenn sie mit dem Pflichtsatz der Offenlegungssprache beginnt - sonst wirft er vor jedem Netzzugriff. Schliesst W5 mechanisch. |
| P6 | `153a73a` | `scripts/anruf-unterbrechungen.mjs` (read-only, GET-only): Agenten-Turns, unterbrochene Turns, ausgelieferter Zeichenanteil, Recap-Heuristik, Gespraechsdauer. Positiv-Kontrolle gegen `test/fixtures/anruf-unterbrechungen.js` (echte, inhaltsfreie Aufzeichnung der drei belegten Anrufe). |
| P7 | `8dcf698` | EIN Feld `conversation_config.turn.turn_eagerness = "patient"` (Rueckfall `"normal"`) in der Agenten-Vorlage, eng in den Besitz aufgenommen (9 besessene Pfade unter `turn`, 0 unter `vad`/`asr`). Wirksam erst nach dem Push. |

## Was OFFEN ist

### 1. P4b (Portugiesisch) - Branch `phase/p4b-portugiesisch-fix3`, NICHT gemergt

Gate BLOCKED nach drei Fix-Runden. Zwei Punkte, die nur der Eigentuemer entscheiden kann;
beide standen als owner-pflichtig in `tasks/p4b-spec.md` und wurden trotzdem in der
Umsetzung vorweggenommen:

- **Die pt-Stimme ist geraten.** `src/telephony/adapters/telnyx/render.js` traegt
  `Azure.pt-PT-RaquelNeural` - nicht per Synthese und nicht am Anbieter-Katalog belegt.
  Erreichbarer Pfad: `state-ops.js` validiert `settings.language` gegen
  `SUPPORTED_LANGUAGES`, ein Tenant kann also `pt` als Default setzen; dann wird die
  **Inbound-Pflichtansage** (KI-Kennzeichnung) mit diesem ungepruefen Attribut gerendert.
  Lehnt Telnyx den Namen ab, faellt sie aus - und der Fehlerpfad kann das strukturell nicht
  fangen, weil das XML erst beim Anbieter scheitert.
- **Der pt-Offenlegungssatz ist nicht freigegeben.** Wortlaut im Branch: *"Ola, fala um
  assistente de IA em nome de ${ownerName}. Esta conversa sera resumida para o meu
  mandante."* Sein eigener Test heisst woertlich "Freigabe AUSSTEHEND". **Der Merge schaltet
  ihn sofort scharf, ohne Anbieter-Push**: `CALLEE_LANGUAGE_FOR_COUNTRY.PT` setzt fuer jede
  +351-Nummer `disclosureLanguage = 'pt'`, und die Eroeffnung geht als per-Call-Override raus.

Ohne P4b wird `language: "pt"` sauber mit 400 abgelehnt - der heutige Zustand ist also
korrekt und nicht gefaehrlich, nur unvollstaendig.

### 2. Zwei rote Tests, die es vor dieser Kette schon gab

`KV2-10 (d1)` und `(d2)` in `test/kv2-10-tarifpaar.test.js` scheitern identisch auf
`bf96a94` - dem Commit, auf dem die Kette startete. In einem abgetrennten Worktree auf genau
diesem Stand nachgemessen, nicht aus dem Diff geschlossen. Ursache nicht untersucht (war
nicht Teil des Auftrags). **Solange sie rot sind, verdeckt `npm test` jede echte Regression.**

### 3. Was am Live-System noch fehlt

Alles unten ist Owner-Arbeit; die Kette hat den Anbieter nicht angefasst.

## Reihenfolge fuer das Livebringen (bindend)

**Server-Code zuerst, Vorlage danach.** Umgekehrt rendert der Anbieter nackte Platzhalter
und die Offenlegung faellt aus.

1. **Deploy des Server-Codes.** `autoDeploy` hat in diesem Projekt schon zweimal gewechselt -
   den Stand frisch messen, ein Push allein macht nichts live.
2. **Push der Agenten-Vorlage** (`npm run elevenlabs:push`), erst danach. Drei Felder warten,
   gemessen mit `npm run elevenlabs:drift` am 07.09.:

   | Feld | Vorlage | Live | aus |
   |---|---|---|---|
   | `turn.turn_eagerness` | `patient` | `normal` | P7 |
   | `get_consult.interruption_mode` | `allow` | `disable_during_tool` | P2 |
   | `get_consult.tool_call_sound` | `null` | `typing` | P2 |

   **Erst den Trockenlauf fahren.** Er druckt den PATCH-Koerper mit genau den Blatt-Pfaden,
   die gesendet wuerden - was dort fehlt, kann den Agenten nicht erreichen. Zu pruefen ist
   dabei, ob die zwei `get_consult`-Felder ueberhaupt schreibbar sind: ihre Vergleichsart
   fasst mehrere Werkzeuge zu einer Menge zusammen, und Mengen meldet das Werkzeug als
   "NICHT SCHREIBBAR" (aus einer Menge folgt kein einzelner Zielwert). Sind sie es nicht,
   gehoeren sie ins Dashboard.
   Der Push fasst nur an, was per `--felder=` benannt ist; abweichende, nicht benannte
   Felder meldet er als "AUSGELASSEN" und laesst sie in Ruhe.
3. **Die zwei bewusst ausgenommenen Drift-Abweichungen** (`retention_days`, `record_voice`)
   sind Bestandsentscheidungen vom 15.08. und gehoeren NICHT in diesen Push.

## Nachher-Messung fuer P7 (die Abnahme, die noch aussteht)

Vorher-Werte: `tasks/p7-vorher-messung.md` - **24,8 % unterbrochene Agenten-Turns bei 72,1 s
mittlerer Dauer** ueber 9 gefuehrte Gespraeche einer einzigen Konfiguration
(`agtvrsn_5901m1q67m31f22ar8vptava9skp`).

Nach dem Push mindestens fuenf Testanrufe unter vergleichbaren Bedingungen, dann:

```
node scripts/anruf-unterbrechungen.mjs <die neuen conversation_ids>
```

**Dieselbe Ausschlussregel anwenden** (nur Anrufe mit >= 3 Agenten-Turns), sonst vergleicht
man zwei verschiedene Dinge: drei der 13 Vorher-Anrufe hatten genau einen Agenten-Turn und
zaehlen als "100 % unterbrochen", ohne dass je ein Gespraech stattfand.

**Und die Dauer mitlesen** (PM-4): sinkt der Unterbrechungsanteil, steigt aber die mittlere
Dauer deutlich ueber 72,1 s, ist das kein Erfolg, sondern ein Tausch - bei 30 ct/min schlaegt
das auf die Kostendecke durch.

## Kalibrierung der P2-Fristen (sobald Daten da sind)

5000/5000/30000 ms sind **vorlaeufig**. Fuer Stufe 0 und 1 gab es keine Messung, weil genau
diese Zeitpunkte nicht protokolliert wurden. P3 schliesst das: der Audit-Eintrag
`consult_timeout` traegt die Zeitspannen bis Zustellung und Quittung. Nach ein paar echten
Rueckfragen daraus nachziehen - die Werte sind env-aenderbar, kein Code noetig.

## Kosten dieser Kette

1.332,6M Token ueber sieben Workflow-Laeufe (`node scripts/workflow-kosten.mjs`). Die vom
Workflow-Werkzeug gemeldete `subagent_tokens` haette ~9M behauptet - Faktor ~150, wie in
`.claude/refs/workflow.md` beschrieben. Teuerster Einzelposten: P4b mit 429,7M, ohne
Ergebnis (s. `tasks/lessons.md`, Eintrag vom 07.09.).
