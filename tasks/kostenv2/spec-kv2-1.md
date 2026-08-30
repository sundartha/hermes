<!-- Auftragsblatt KV2-1. Geschnitten aus tasks/PLAN-KOSTEN-V2.md (Zeilen 716-750). -->

# Pflichtlektuere vor der Umsetzung

Dieses Blatt ist der Auftrag, aber NICHT der ganze Kontext. Vor dem ersten Edit zu lesen:

- `tasks/PLAN-KOSTEN-V2.md` Abschnitt 2 (Zielbild), Abschnitt 3 (Kostenarten-Tabelle, inkl. 3.5 Einheiten und
  3.6 die ID-Falle), Abschnitt 4 (Architektur-Entscheidung, insbesondere 4.3
  Durchsetzungsstelle, 4.5 Settlement, 4.6 Matrix, 4.7 Schliessregel) und
  **Abschnitt 7 (Eigentuemer-Entscheidungen) vollstaendig**.
- `tasks/kostenv2/befund-code.md`, `befund-elevenlabs.md`, `befund-gate.md`,
  `befund-telnyx.md` - der gemessene Ist-Zustand. Keine Annahme ueber Bestandscode ohne
  Beleg aus diesen Befunden ODER aus dem Code selbst.
- `CLAUDE.md` (Absolute Regeln) und `.claude/refs/clean-code.md`.

# Harte Randbedingungen dieser Kette

1. **Safety-Gates, Offenlegungssatz und `callee_is_owner` werden NICHT angefasst.** Beruehrt
   die Umsetzung eines davon, ist das ein Abbruchgrund mit Meldung an den Lead - keine
   eigenmaechtige Aenderung, auch keine "harmlose" Umformulierung.
2. **Abschnitt 7, Punkte 1-9 und 13 sind entschieden** - umsetzen wie dort festgelegt.
   **Die Punkte 10, 11, 12, 14, 15 und 16 laufen auf Default und sind so gekennzeichnet.**
   Verlangt die Phase, einen davon scharf zu stellen, wird er auf dem dokumentierten
   Default gebaut und der Punkt im Report als Rueckfrage an den Owner gemeldet -
   NICHT eigenmaechtig festgelegt.
3. Neue Env-Variable: sofort in `src/config.js`, `.env.example` UND in `BASE_ENV` der
   Test-Helfer (sonst leakt die echte `.env` in Spawn-Tests).
4. Neues Verhalten braucht einen Test. Geldrechnung braucht einen Test, der die Rechnung
   pinnt, nicht nur ihre Existenz.

---

### KV2-1 - Alarm-Naht scharf machen

**Ziel.** Der Kostenpfad bekommt einen Meldeweg, der wirklich ankommt: durabler
Audit-Eintrag, Mail, SMS, entprellt, mit einem Marker, der einen Neustart ueberlebt. Ohne
diese Phase scheitert jede folgende genauso still wie der Bestand.

**Betroffene Dateien.** `src/server.js` (Erzeugung von `makeCostTruing` hinter
`selectMailer`, `mailer` und Audit-Sink injizieren), `src/billing/cost-truing.js`
(`emitFinding` laeuft ueber das `meldeVollBefund`-Muster statt ueber `audit()`;
`sweepsBelowThreshold` ersetzt durch `openOutageAlert(...).firstSeenAt`),
`src/boot-guard.js` (Befund "Kosten-Alarm ohne Ziel"), `.env.example` (Doku der
Alarm-Ziele), Tests.

**Abnahmekriterium (ohne echten Anruf).**
(a) Mit Stub-Audit-Store: ein Deckungsbefund erzeugt genau einen Eintrag mit einer eigenen
`action`, nachweisbar am Stub statt nur im Log.
(b) Mit Stub-Mailer und Stub-`messaging`: der erste Befund erzeugt genau eine Mail und genau
eine SMS; ein zweiter Sweep im Entprellfenster erzeugt KEINE weitere Mail, aber einen
Notiz-Eintrag (`_entprellt`), und `marker.lastSeenAt` ist fortgeschrieben.
(c) Simulierter Neustart (neue Store-Instanz, gleiche Daten): der Marker ist noch offen und
`firstSeenAt` unveraendert - der Zaehler wird nicht genullt.
(d) Ohne konfiguriertes Alarm-Ziel: der Boot erzeugt einen benannten Befund, und die
Sweep-Zeile nennt "kanaele=keine".
(e) Erste Handlung dieser Phase, vor dem Code: pruefen, ob in der Produktion ein Alarm-Ziel
gesetzt ist. Ist keines gesetzt, ist das Ergebnis der Phase eine Owner-Meldung, kein
gruener Test.

**Was diese Phase NICHT tut.** Sie aendert `sendeUeberBeideKanaele` nicht (das ist der
Ausfall-Melder, nicht der Kostenpfad, s. 4.9). Sie legt keine Kostenart an, sie bewegt keinen
Cent, sie fasst kein Gate an.

**Abhaengigkeit.** Keine. Erste Phase.

---

