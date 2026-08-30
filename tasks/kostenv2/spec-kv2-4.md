<!-- Auftragsblatt KV2-4. Geschnitten aus tasks/PLAN-KOSTEN-V2.md (Zeilen 1079-1110). -->

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

### KV2-4 - Der ElevenLabs-Beleg, synchron und vorlaeufig

**Ziel.** `persistProviderResult` liest `metadata.cost_fiat` und legt eine Belegzeile
`traeger=elevenlabs_convai`, `reife=vorlaeufig` an - ohne zusaetzliches Netz-IO, weil die
Antwort dort bereits vollstaendig im Speicher liegt. Zusaetzlich wird die Zeile
`traeger=telnyx_sip` als `erwartet` angelegt.

**Betroffene Dateien.** `src/elevenlabs/outbound.js` (neuer Aufruf direkt neben
`store.recordSipCallId`, `:1312`; damit sind BEIDE Aufrufer bedient - regulaeres Ende
`:1332` und Abbruch `:1452`), Fixtures, Tests.

**Abnahmekriterium (ohne echten Anruf).**
(a) Fixture aus den 8 gemessenen Anrufen: genau eine `vorlaeufig`-Zeile mit exaktem
Mikro-Cent-Integer und `waehrung="USD"`; `charging.llm_price` / `charging.platform_price` /
`charging.analysis.price` landen im `detail`, nicht als eigene Buchungsposten (eine Zahl,
ein Rundungspfad).
(b) Fehlt `cost_fiat`, ist es kein Float, ist es negativ, oder ist es `0` bei
`call_duration_secs > 0` -> es entsteht KEINE Zeile (nicht eine 0-Zeile) und eine
WARN-Zeile. `0` bei `call_duration_secs === 0` -> gueltige Zeile mit Betrag 0.
(c) Der Abbruchweg legt dieselbe Zeile an und markiert sie zusaetzlich als strukturell
nicht nachreifbar (der `endConversation`-DELETE, `outbound.js:1452-1460`).
(d) Zweiter Aufruf mit derselben callId legt keine zweite Zeile an.
(e) `usage.costCents`, `usage_event` und `usage.costCorrectionMicroCentsRem` sind vor und
nach dem Aufruf byte-identisch.

**Was diese Phase NICHT tut.** Keine Buchung, kein Gate-Zugriff, keine Erstattung, kein
zweiter Abruf beim Anbieter.

**Abhaengigkeit.** KV2-3.

---

