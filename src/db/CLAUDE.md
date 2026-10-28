RLS-Test nur unter NOBYPASSRLS beweiskraeftig (Superuser umgeht FORCE RLS).

## Baustein speicher (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck und Darf nutzen: stehen in `src/store/CLAUDE.md`, dem ersten Ordner von speicher.
- Ort für Neues: Neue Dateien in `src/db/` gehören zu speicher, solange tools/bausteine.json sie keinem anderen Baustein nennt. Weitere Ordner von speicher: `src/store/`.
- Eingang: Kein Eingang liegt in `src/db/`.
