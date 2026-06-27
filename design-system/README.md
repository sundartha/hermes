# Hermes Design System

Visuelle Komponenten-Bibliothek fuer **Hermes** (Produkt) / **Sundartha** (Firma).
Quelle der Wahrheit im Repo; gespiegelt nach `claude.ai/design` via DesignSync.

## Aufbau

```
design-system/
  _shared/
    tokens.css     Kanonische Design-Tokens (Light = App, Dark = Hero/Site)
    preview.css    Karten-Rahmen + Komponenten-Klassen (spiegelt apps/web/src/styles/app.css)
  foundation/      Tokens als sichtbare Spezimen (Farben, Typo, Spacing/Radien/Schatten)
  components/      Bausteine (Buttons, Forms, Karten, Badges/Status, Daten-Zeilen)
  app/             Eingeloggtes Dashboard (Inseln: Stats, Calls, Settings, Billing)
  site/            Oeffentliches Site-Chrome (Hero dunkel, Unterseite, Pricing)
  mcp/             MCP-Chatbot-UI — MOCKUPS (heute gibt der MCP nur Text zurueck)
  tenant/          Tenant-Self-Service-Dashboard, an den Hermes-Brand angeglichen
```

## Token-Provenienz (WICHTIG — Drift vermeiden)

`_shared/tokens.css` ist eine **selbst-tragende Kopie** der kanonischen Tokens aus
`apps/web/src/styles/tokens/` (`primitives.css` + `semantic.css` = Light/App,
`hero.css` = Dark/Site). Der Grund: claude.ai/design rendert jede Preview isoliert,
braucht also self-contained CSS und kann nicht in `apps/web/` hineinlinken.

Wenn sich die Tokens in `apps/web/src/styles/tokens/` aendern, **muss
`_shared/tokens.css` nachgezogen werden** (akzeptiertes Risiko, da die Marken-Tokens
stabil sind). `_shared/preview.css` spiegelt analog `apps/web/src/styles/app.css`.

## Karten-Index (@dsCard)

Jede Preview-HTML traegt in der ERSTEN Zeile einen Marker, aus dem das
Design-System-Pane die Karte indiziert:

```html
<!-- @dsCard group="Components" name="Buttons" subtitle="Primary / Ghost / CTA" -->
```

## Sync nach claude.ai/design

Wird ueber das `DesignSync`-Tool gepusht (Lese -> finalize_plan -> write_files),
`localDir` = dieses Verzeichnis. Inkrementell, eine Komponente nach der anderen.

## Status MCP-UI

Der MCP gibt heute ausschliesslich Text/JSON zurueck (`src/mcp-tools.js`,
`{type:"text"}`). Die Karten unter `mcp/` sind **Design-Entwuerfe**, wie eine
Rich-UI im Chatbot aussehen koennte — sie sind NICHT mit dem Server verdrahtet.
Die echte Implementierung (MCP-Resources/HTML) ist als separater Task vorgemerkt.
