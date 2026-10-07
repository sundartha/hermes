const fs = require("node:fs");
const path = require("node:path");

const BEREICHE_DATEI = path.join(__dirname, "tools/bereiche.json");
const BEREICHE = fs.existsSync(BEREICHE_DATEI) ? require(BEREICHE_DATEI) : [];
const TEST_ZIELE_ERLAUBT = BEREICHE.flatMap(({ eingaenge, fachlogik }) => [
  ...eingaenge,
  ...fachlogik,
]);

module.exports = {
  forbidden: [
    {
      name: "telefonie-nur-ueber-ports",
      severity: "error",
      comment:
        "Anbieter-Code aus src/telephony/adapters/ nur über die Telefonie-Ports ansprechen: den Adapter über src/telephony/registry.js holen, die Schnittstelle steht in src/telephony/ports.js.",
      from: { path: "^src/", pathNot: "^src/telephony/" },
      to: { path: "^src/telephony/adapters/" },
    },
    {
      name: "speicher-nur-ueber-fassade",
      severity: "error",
      comment:
        "Innereien aus src/store/ nicht direkt importieren, sondern über die Speicher-Fassade src/store.js.",
      from: { path: "^src/", pathNot: "^src/(store/|store\\.js$)" },
      to: { path: "^src/store/" },
    },
    {
      name: "keine-ordnerzyklen",
      severity: "error",
      comment:
        "Ordner unter src/ dürfen sich nicht gegenseitig importieren. Die gemeinsame Abhängigkeit gehört in einen eigenen Ordner, den beide Seiten importieren, oder die Richtung wird über eine Schnittstelle umgedreht.",
      scope: "folder",
      from: { path: "^src/" },
      to: { circular: true },
    },
    {
      name: "tests-nur-ueber-eingaenge",
      severity: "error",
      comment:
        "Tests greifen nur über die öffentlichen Eingänge eines Bereichs zu (MCP-Werkzeug, HTTP-Route, Anbieter-Webhook, Fassade, Port, Registry, Konfiguration) oder prüfen reine Fachlogik als Tabelle. Interne Module nicht direkt importieren. Die erlaubten Ziele stehen je Bereich unter eingaenge und fachlogik in tools/bereiche.json.",
      from: { path: "^test/", pathNot: "^test/werkzeuge/" },
      to: { path: "^src/", pathNot: TEST_ZIELE_ERLAUBT },
    },
    {
      name: "werkzeug-tests-ohne-src",
      severity: "error",
      comment:
        "Tests unter test/werkzeuge/ prüfen die Werkzeuge unter tools/ und importieren nichts aus src/.",
      from: { path: "^test/werkzeuge/" },
      to: { path: "^src/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^src/.*\\.test\\.js$" },
  },
};
