RLS-Test nur unter NOBYPASSRLS beweiskraeftig (Superuser umgeht FORCE RLS).
`kennzahlen.sql` ist keine nummerierte Migration: `migrate.js` wendet sie bei jedem Start an, aber nur, wenn die Rolle `KENNZAHLEN_LESER_ROLLE` existiert; jede Anweisung muss wiederholbar sein. Scheitert sie mit SQLSTATE `42501`, wird zurückgerollt, eine Zeile auf stderr geschrieben und der Start läuft weiter; jeder andere Fehler und jedes `42501` einer nummerierten Migration bricht den Start ab.

## Baustein speicher (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck und Darf nutzen: stehen in `src/store/CLAUDE.md`, dem ersten Ordner von speicher.
- Ort für Neues: Neue Dateien in `src/db/` gehören zu speicher, solange tools/bausteine.json sie keinem anderen Baustein nennt. Weitere Ordner von speicher: `src/store/`.
- Eingang: Kein Eingang liegt in `src/db/`.
