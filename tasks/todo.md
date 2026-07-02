# Arbeits-Todo (Scratch)

Dieses File ist der Arbeits-Scratch fuer die jeweils laufende Phase (siehe
`.claude/refs/workflow.md`) und wird pro Aufgabe neu befuellt.

- Dauerhafter Ueberblick ueber offene Punkte: **`STATUS.md`**
- Lehren aus abgeschlossenen Aufgaben: **`tasks/lessons.md`**

---

# Task: Anrufqualitaet Runde 2 (Branch call-quality-2, Basis lokaler master 2c6c4e2)

Auftrag: NEXT-SESSION-CALL-QUALITY-2.md. Symptome S-A (Auflegen), S-B (hoelzerne
Eroeffnung), S-C (Natuerlichkeit). Constraints: kein Modellwechsel, Safety-Gates/
Offenlegung unantastbar, /voice/outbound LLM-frei, keine neuen Dependencies.

## Diagnose (abgeschlossen, Beleg: Render-Logs + Code)

- [x] D0 Deploy-Timing: Testanruf 1 (call_mr3dz9t9u5jm, 10:53:32Z) lief auf Commit
  0dca7ce (ALTER Stand, [boot]-Banner 09:34Z); c12c546 ging erst 14:01:42Z live.
  Testanruf 2 (call_mr3lg2g7t9zg, 14:22:33Z) lief auf c12c546, kollidierte aber mit
  dem manuellen Deploy dep-d9377ui (gestartet 14:21:46, Traffic-Switch 14:22:46).
  -> Owner hat die neue Gespraechsfuehrung nie vollstaendig gehoert.
- [x] D1 S-A-Wurzel: KEIN LLM-Fehler ([metrics] llm alle success, attempts=1,
  ~1.4s, breaker closed; kein [turn]-Error, kein end_call). Wurzel = Instanzwechsel
  mitten im Call: neue Instanz kennt den in-memory-Call nicht -> /voice/turn
  (server.js:906) antwortet still mit <Hangup/>. Verschaerfung: Reconcile-Flush der
  neuen Instanz loescht den Call aus pg (deleteMissing) -> Call fehlt in list_calls.
- [x] D2 Nebenbefund 10:53-Call: stt_gap 16172ms (Owner-Sprechpause/STT-Endpointing);
  hangupSource=callee (Gegenseite legte auf, kein Agent-Hangup).

## Umsetzung (jede Aenderung mit Erwartung + Verifikation)

- [x] T1 S-B(a) bridgePhrase natuerlicher (de/fr/en) + Ich-Satz-Passthrough:
  Erwartet: openingText("Den naechsten freien Termin erfragen") ==
  "<disclosure> Es geht um Folgendes: den naechsten freien Termin erfragen." und
  openingText("Ich moechte ... erfragen") == "<disclosure> Ich moechte ... erfragen."
  (kein Brueckentext). disclosure byte-identisch davor (Regel 2).
  Verifikation: neue Unit-Tests in test/f1-i18n-locale.test.js (DE-Pin bewusst
  justiert) + npm test gruen.
- [x] T2 S-B(b) place_call objective-Description: sprechbarer Ich-Satz gefordert
  (Beispiel im Text), Thema-Pflicht bleibt. Erwartet: Description enthaelt
  "Ich-Satz"-Anweisung; Token-Sync-Test (mcp-tools) bleibt gruen.
  Verifikation: npm test + grep.
- [x] T3 S-A Diagnose-Logging: /voice/turn + /voice/outbound loggen bei unbekanntem
  Call bevor sie fail-closed auflegen. Erwartet: Logzeile mit callId; Verhalten
  (Hangup-TeXML) unveraendert. Verifikation: neuer Test (unbekannte callId ->
  Hangup + Logzeile) + npm test.
- [x] T4 S-C Bench-getrieben iteriert (v1 Regression -> v2 -> v3 -> ABLATION, Prompt
  byte-identisch v6; final: judge 4.39/4.38 Paritaet, nat 3.83>=3.70, Checks 120/120;
  Ergebnis + Iterations-Historie in tasks/call-quality-2-report.md). Urspruenglich:
  der Runde-1-Laeufe minen (data/convo-bench/candidate-v6-fv u.a.), dann ENGE
  Aenderungen. Erwartet: gepoolt (n>=5/Seite) naturalness >= Baseline, kein
  deterministischer Check schlechter, Gesamt-Judge nicht signifikant schlechter.
  Verifikation: npm run convo-bench A/B (Baseline c12c546-Worktree, Candidate hier),
  compare + poolen.
- [ ] T5 Abschluss: npm test gruen (ganze Suite), Report
  tasks/call-quality-2-report.md, Memory-Update, Merge nach master NUR mit
  Bench-Beleg; KEIN Push (Owner-Ok steht aus).

## Folge-Tickets / Owner-only (nicht dieser Schnitt)

- FT1 (S1, strukturell): Call-State ueberlebt Instanzwechsel nicht (Zero-Downtime-
  Deploy toetet laufende Calls + pg-Reconcile loescht den Call-Row). Fix = eigener
  Store-Schnitt (read-through-Rehydrate im Webhook-Pfad + Reconcile-Schutz fuer
  aktive Calls) mit eigenem Review. NICHT im Gespraechsqualitaets-Scope.
- FT2 STT-Endpointing (16s-Gap): env-tunebar (speechTimeout), Owner-Live-Gate.
- Owner: nicht waehrend eines Render-Deploys testen; claude.ai cacht Tool-
  Descriptions pro Chat -> neue objective-Description erst in FRISCHEM Chat wirksam;
  Render always-on weiter offen.
