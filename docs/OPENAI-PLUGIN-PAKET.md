# OpenAI-Plugin-Paket (ChatGPT-Plugin-Verzeichnis)

Stand: 2026-11-17. Quelle aller Feldregeln: https://developers.openai.com/plugins/deploy/submission
(Abschnitt "Automatically provide submission and review information") und
https://developers.openai.com/plugins/build/plugins (Abschnitt "Configure MCP authentication").

## Inhalt von `openai-plugin/`

| Datei             | Zweck                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin.json`     | Agent-Plugins-Manifest: Listing (`extensions.com.openai.interface`), Review-Testfälle (5 positiv, 3 negativ), `publication` (Release Notes, de-DE-Übersetzung)         |
| `mcp.json`        | genau ein Remote-Server `hermes`, `streamable-http`, URL = `MCP_URL` aus `apps/web/src/lib/agent-docs.js`, OAuth mit CIMD-Registrierung (DCR als Rückfall laut Quelle) |
| `assets/logo.png` | Kopie von `public/brand/hermes-icon.png` (quadratisch, 1024 px); dient als `logo` und `composerIcon`                                                                   |

Bewusst nicht im Paket:

- Zugangsdaten, Reviewer-Anleitung, Testnummer: gehören laut Quelle in das Dashboard
  ("ZIP metadata rejects `test_credentials` and `reviewer_instructions`"). Positiv-Fall 5 verweist
  deshalb auf "the test number from the review instructions" (`docs/OPENAI-REVIEWER-ACCESS.md`, Abschnitt 7).
- `review.demo_recording_url` und `publication.countries`: fehlen im ZIP, damit sie im Dashboard
  editierbar bleiben (Weglassen erhält gespeicherte Werte, laut Quelle).
- Skills, `onboardingSkill`, `.app.json`, Hooks: `.app.json` und Hooks machen ein Paket laut Quelle
  nicht einreichbar; Skills kämen mit eigenem Skill-Scan dazu.

Die Testfälle nennen nur Werkzeuge, die in jeder OAuth-Konfiguration registriert sind
(Tabelle B in `docs/OPENAI-TOOL-INVENTORY.md`), also keine Consult-Werkzeuge.

## ZIP bauen

```bash
cd openai-plugin && zip --recurse-paths -X "$TMPDIR/hermes-openai-plugin.zip" plugin.json mcp.json assets
```

Das ZIP wird nicht committet. Bei jeder Änderung an Listing, Testfällen oder Assets: `version` in
`plugin.json` erhöhen, neues ZIP hochladen ("Upload plugin to make changes"), neues Review.
Werkzeug-Änderungen am Server brauchen kein neues ZIP (`docs/RUNBOOK-MCP-UPDATE.md`, Abschnitt 8).

## Bekannte Abweichung

Das öffentliche Schema `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json` (abgerufen
2026-11-17) erlaubt an einem `streamable-http`-Server kein Feld `extensions`; die OpenAI-Quelle
verlangt die Auth-Angabe genau dort (`extensions["com.openai"].auth`). Das Paket folgt der
OpenAI-Quelle. Lehnt der Upload `mcp.json` deswegen ab: den Block `extensions` entfernen; die
OAuth-Erkennung läuft dann über `/.well-known/oauth-protected-resource` und den 401 mit
`WWW-Authenticate` (`src/auth.js`).

`category` ist `Productivity`; eine Liste der zulässigen Kategorien nennt die Quelle nicht
("category title from the dashboard"). Im Dashboard prüfen.
