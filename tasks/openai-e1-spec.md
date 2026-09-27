# E1: Sonde fuer die Authorization-Server-Faehigkeiten (+ Messungen F1-F4)

Erste Etappe der OpenAI-Sanierung. Sie beantwortet eine Frage, die die gesamte Einreichung
kippen kann, und zwar BEVOR irgendjemand Produktionscode anfasst.

## Woher die Vorgabe stammt (in dieser Reihenfolge lesen)

1. `tasks/openai-fix/S5-authorization-server.md` - das vollstaendige Spec. Fuer DIESE Etappe
   gelten NUR die Punkte **A4 (die Sonde)** und **F1-F4 (die Messungen)**. Alles andere aus S5
   (A1, A2, A3) ist eine SPAETERE Etappe und wird hier NICHT gebaut.
2. Im selben Spec die Abschnitte **"## Pre-Mortem"** und **"## Pre-Mortem (zweiter Durchgang,
   additiv)"**. Die dort genannten Nachbesserungen sind Teil dieser Vorgabe, nicht optional.
   Fuer A4 ausdruecklich: ein 404 auf dem Discovery-Pfad muss FAIL mit Exit != 0 ergeben (kein
   stilles Gruen), und die Sonde ist gegen `scripts/check-setup.js:138-186` abzugrenzen, damit
   keine dritte Kopie derselben Discovery-Logik entsteht.
3. `PLAN-OPENAI.md`, Abschnitt "### Etappe 1" - dort steht die verbindliche Abnahme.

## Was gebaut wird

- `scripts/probe-as-faehigkeiten.mjs` - die Sonde (Groessenordnung 80 Zeilen).
- `docs/RUNBOOK-AS-METADATA.md` - Runbook mit datierter Rohausgabe und den Live-Werten, die
  F1 und F2 beantworten.

## Abnahme (aus PLAN-OPENAI.md, Etappe 1)

- `node scripts/probe-as-faehigkeiten.mjs` OHNE Argument endet mit Exit != 0 und macht KEINE
  Netzanfrage.
- Gegen den Live-Host ausgefuehrt traegt jede der acht Zeilen PASS, FAIL oder UNKNOWN;
  `S256` steht auf PASS.
- Ein 404 auf dem Discovery-Pfad ergibt FAIL mit Exit != 0.
- `docs/RUNBOOK-AS-METADATA.md` enthaelt eine datierte Rohausgabe und die Live-Werte zu F1/F2.
- `npm test -- --test-concurrency=4` bleibt gruen.

## Harte Grenzen

- **Keine Datei unter `src/` aendern.** Diese Etappe beruehrt keinen Laufzeitpfad. Wer eine
  Quelldatei anfasst, hat den Auftrag verlassen.
- Die Sonde liest ausschliesslich OEFFENTLICHE Discovery-Metadaten per GET. Sie schreibt
  nichts, authentifiziert sich nicht und braucht kein Secret. Kommt sie ohne Host-Argument,
  darf sie NICHTS tun ausser mit Exit != 0 abzubrechen.
- Kein Secret und kein Token in die Sonde, ins Runbook oder in eine Ausgabe. Das Runbook
  dokumentiert Faehigkeiten und URLs, keine Zugangsdaten.
- Kein Scope-Zuwachs: keine Haertung, kein Boot-Riegel, keine Aenderung an `src/auth.js`.
  Diese Etappe STELLT FEST, sie repariert nicht.
- `node scripts/probe-as-faehigkeiten.mjs https://app.sundartha.com` gegen den Live-Host
  auszufuehren ist erlaubt und erwuenscht (reiner Lesezugriff auf oeffentliche Metadaten);
  das Ergebnis gehoert datiert ins Runbook.

## Konventionen

ESM, kein Build-Step. Deutsch ohne Umlaute in Kommentaren und Doku. Neues Verhalten braucht
einen Test - fuer die Sonde heisst das mindestens: Aufruf ohne Argument bricht ab, und ein
404-Discovery-Fall ergibt FAIL mit Exit != 0 (per Attrappe, ohne echtes Netz).
