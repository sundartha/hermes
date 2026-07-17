# Prompt für die nächste Session — Clean-Code-Strategie-Doc via Workflow

> In frische Session pasten. Alles unterhalb der Linie ist der Prompt.

---

Entwirf einen **token-effizienten dynamischen Workflow** (Workflow-Tool), der aus dem
bestehenden Clean-Code-Audit eine **mehrphasige Strategie-Doku** erzeugt, deren
Umsetzung `src/` am Ende in Einklang mit den Clean-Code-Richtlinien bringt.
**Kein Produktionscode wird in dieser Session geändert — nur Verifikation + Planung.**

## Kontext neu einlesen (nicht auf Zusammenfassungen verlassen)
- Audit-Bericht: `tasks/clean-code-audit.md` — 129 Befunde (17 S1, 21 S2, 73 S3, 18 S4),
  Ampel GELB. Erzeugt von einem Sonnet-Workflow; S1/S2 wurden **im Lauf** adversarial
  gegengeprüft, aber **nicht** unabhängig von einem zweiten Durchgang am aktuellen Code
  bestätigt. Der Kopf des Berichts hat einen Datums-Bug ("unbekannt") — inhaltlich egal.
- Maßstab: `.claude/refs/clean-code.md` (Prüfkatalog, Schweregrade S1–S4).
- Repo-Regeln: `CLAUDE.md` (Absolute Regeln, Pre-Mortem, Wurzel-statt-Symptom),
  `.claude/refs/workflow.md`, `PLAN-SECURITY.md`.
- Der Audit deckte nur **47 von 130** Dateien tief ab; **83 wurden nur gemessen**
  (Liste in Abschnitt 7 des Berichts).

## Harte Regel: erst verifizieren, dann planen
Die Strategie darf **nur auf Befunden aufbauen, die du am aktuellen Code bestätigt hast.**
Für jeden S1/S2-Befund, auf den sich die Strategie stützt: die zitierte `Datei:Zeile`
lesen und prüfen, ob der Defekt **heute noch existiert** und die Beschreibung stimmt.
- **bestätigt** → geht in die Strategie, mit echter Wurzel (nicht nur dem Symptom aus dem Bericht).
- **widerlegt/veraltet** → raus, separat als „nicht bestätigt" mit Begründung listen.
S3/S4 werden nicht einzeln verifiziert (Token-Effizienz) — dafür genügt eine **Stichprobe**
(z. B. 1–2 pro ID-Typ), um zu prüfen, dass die Kategorien real sind; der Rest wird als
gebündelte Politur-Phase geführt.

## Gewünschte Workflow-Struktur (token-effizient, Opus sparsam)
Pipeline/Fan-out statt Barrieren, wo möglich. Modelle **explizit pro `agent()` pinnen**,
Subagenten **nie** Fable erben lassen (siehe Memory `workflow-model-policy`):
1. **Verify (Sonnet):** Fan-out über die ~38 S1/S2-Befunde → je `{bestätigt|widerlegt,
   echte Wurzel, minimaler Fix-Ansatz, welcher Test schließt es}`. Plus die 4
   Querschnitts-Befunde (Kopplung, Duplizierung, Abhängigkeiten, Erweiterbarkeit).
2. **Cluster (deterministisch im Skript + ggf. 1 Agent):** bestätigte Befunde zu
   kohärenten Remediation-Phasen bündeln (nach Subsystem/Thema/Abhängigkeit), nicht 129
   Mikro-Tasks. S3/S4 → **eine** Politur-Phase.
3. **Design (Opus, wenige Agenten):** pro Remediation-Phase den Ansatz entwerfen —
   Wurzel-Fix statt Symptom, Test-Strategie, **Pre-Mortem/Risiken**, Reihenfolge-
   Abhängigkeiten, Einhaltung der Absoluten Regeln.
4. **Safety-Review (Opus, 1):** adversariale Gesamtprüfung der Strategie — schwächt irgend
   ein vorgeschlagener Umbau ein Safety-/Auth-/Budget-Gate? Ist die Reihenfolge sicher?
   Sind die Pre-Mortems echt? Stimmen die Wurzel-Diagnosen?
5. **Synthese (Sonnet oder Opus):** die Strategie-Doku schreiben.

Effizienz-Leitplanken: nur S1/S2 einzeln verifizieren; Opus nur für Design + Safety-Review;
Verify/Synthese auf Sonnet; keine ganzen Dateien mehrfach lesen (gezielt `Datei:Zeile`).

## Struktur der Strategie-Doku (`PLAN-CLEAN-CODE.md` im Repo-Root)
- Kurzer Überblick + Ist-Zustand (aus dem Audit, GELB, 4 Achsen).
- **Geordnete Phasen**, Priorität zuerst: Money-Gates (S1-1/6/7) + `withStoreLock`
  (S1-11) vor allem anderen. Jede Phase mit:
  `ID · Ziel · abgedeckte Befund-IDs · betroffene Dateien · echte Wurzel · Fix-Ansatz ·
  Tests · Pre-Mortem/Risiken · Abhängigkeiten/Reihenfolge · Definition-of-Done
  (verifizierbar) · grober Aufwand`.
- Jede Phase so geschnitten, dass sie **später als ein `phase-impl-lean`-Lauf** umsetzbar ist.
- Abschnitt „nicht bestätigt / verworfen" (widerlegte Audit-Befunde).
- Explizite Entscheidung zur **Audit-Lücke** (83 ungeprüfte Dateien): entweder eine
  „Phase 0: Audit-Vervollständigung" oder als bewusst akzeptiertes Risiko festhalten —
  keine Scheinvollständigkeit.

## Constraints (CLAUDE.md)
- **Absolute Regeln** gelten: kein Vorschlag darf ein Safety-Gate, die Offenlegung, Auth-
  fail-closed, Secret-Handhabung oder die Audio-über-MCP-Regel aufweichen — nur **härten**.
- **Wurzel statt Symptom.** **Pre-Mortem** pro Phase (was, wenn dieser Umbau in einem Jahr
  als Fehler dasteht — Fehl-Anruf, Kosten-Explosion, Transkript-Leak?).
- **Scope:** nur `src/`. Kein Code ändern. Nicht raten — bei echter Unsicherheit fragen.

## Rückgabe
Kompakt: Pfad der Doku, Anzahl Phasen, Zahl bestätigt/widerlegt, die 3 zuerst umzusetzenden
Phasen. Den Doku-Inhalt nicht in den Chat kippen.
