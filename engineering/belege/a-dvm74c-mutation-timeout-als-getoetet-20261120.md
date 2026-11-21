# A-DVM74C — Mutation: Timeout am Mutanten zählt als getötet

## Auftrag
Pro Testdatei soll in der Mutationsprüfung eine kurze Frist gelten; läuft eine
Testdatei unter einem Mutanten in diese Frist, gilt der Mutant als **getötet**
statt wie bisher als „nicht geprüft (Frist)“. Der separate Basis-Lauf (ohne
Mutant) behält seine eigene, unveränderte (längere) Frist; läuft er in den
Timeout, bleibt das weiterhin sichtbar als „Basis rot“ und wird NICHT als
getötet verbucht. Keine neuen Pflicht-Checks/Stationen, keine Erhöhung der
CI-Zeit.

## Auslöser / Hintergrund
`~/Bereiche/sundartha/engineering/belege/pr5586-mutation-20261120.md`: Mutant
`src/store/zustand/grundlagen.js:21/6` (Endlosschleife in `newId()`) hing bis
zur CI-Frist (1500 s) und wurde als „nicht geprüft (Frist)“ statt als getötet
gemeldet, obwohl der Test die Endlosschleife inhaltlich bereits als Fehler
erkennen würde.

## Gelesene Vorgeschichte (geschlossene PRs zum Thema)
- `gh pr list -R sundartha/hermes --state closed --search mutation`
- **#3662** – führte den Zustand „nicht geprüft (Frist)“ als eigenen,
  nicht begründbaren Zustand ein (Matrix k/6). Genau diese Stelle
  (`mutantGegenTests` in `tools/pruefen.mjs`) wurde jetzt geändert — nur dafür,
  *wann* ein Hänger in „getötet“ statt in „nicht geprüft (Frist)“ fällt.
- **#3648** – Basis-Rot erst nach zwei Kontrollläufen, Testreihenfolge je
  Mutant. Bleibt unverändert; der Kontrolllauf (`mitMutant: false`) wird von
  der neuen Frist nicht berührt.
- **#3421** – Mutation beendet Restläufe, sobald ein Mutant getötet ist.
  Bleibt unverändert.
- **#5481** – feste Obergrenze für Testdateien je Mutant. Orthogonal, nicht
  berührt.

## Umsetzung (PR #5644)
https://github.com/sundartha/hermes/pull/5644
Branch `paket/mutation-timeout-als-getoetet` → `master`, offen, mergefähig,
keine Labels gesetzt, nicht gemergt.

- `tools/mutation-laeufe.mjs` – `starteLauf` nimmt `fristMs` entgegen und
  killt den Kindprozess per Timer über eine neue Hilfsfunktion `beendeLauf`
  (aus `beendeRestlaeufe` ausgelagert).
- `tools/pruefen.mjs` – neue Konstante `MUTANT_TESTDATEI_FRIST_MS` (3 Minuten,
  eigene Wahl des Bau-Agenten: kurz genug für schnelle Erkennung von
  Endlosschleifen-Mutanten, lang genug für normal laufende Tests). Die Frist
  wird nur beim Mutanten-Lauf (`mitMutant: true`) durchgereicht; der
  Kontrolllauf (`mitMutant: false`) bekommt weiterhin keine eigene, kürzere
  Frist und bleibt bei seiner bestehenden, längeren Frist.
- `CLAUDE.md` – Mutation-Abschnitt um die neue Pro-Testdatei-Frist ergänzt.
- `test/werkzeuge/mutation-haengende-testdatei.test.js` – bestehender Test für
  „Hänger nur unter Mutant“ zeigt jetzt „getötet“ statt „nicht geprüft
  (Frist)“; neuer Test für „Hänger auch ohne Mutant (Basis)“ zeigt weiterhin
  „nicht geprüft (Frist)“ und gilt ausdrücklich nicht als getötet.

## Lokale Prüfungen (grün, keine volle Suite)
- `npx eslint` auf allen geänderten Dateien
- `node tools/pruefen.mjs typen` → „Alles grün.“
- Gezielte `node --test` über die angepassten/neuen Mutation-Tests:
  10/10 bzw. 47/47 grün je Testdatei-Gruppe (u. a.
  `mutation-haengende-testdatei.test.js`,
  `mutation-zeilen-abdeckung.test.js`,
  `mutation-eingebettete-skripte.test.js`,
  `mutation-umgebung-testlaeufe.test.js`,
  `mutation-testobergrenze.test.js`,
  `mutation-restlauf-abbruch.test.js`).
- Ein vollständiger `npx eslint .` über das ganze Repo lief noch, wurde wegen
  Zeit nicht abgewartet (nicht Teil des Berichts-Gates; CI prüft das ohnehin).

## Offen
- CI/Mutation-Lauf auf GitHub für PR #5644 selbst noch nicht final abgewartet
  (schwere Läufe laufen laut Vorgabe nur dort, nicht lokal).
- Zahl 3 Minuten für die neue Frist ist eine selbst gewählte, im Code zentral
  benannte und in CLAUDE.md dokumentierte Annahme — bei Bedarf später leicht
  anpassbar.
- PR wurde absichtlich nicht gemergt und es wurden keine Labels gesetzt
  (z. B. nicht `verhalten-geaendert`) — das entscheidet der Prüfer/CI.
