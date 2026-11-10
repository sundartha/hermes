const fs = require("node:fs");
const path = require("node:path");

const BEREICHE_DATEI = path.join(__dirname, "tools/bereiche.json");
const BEREICHE = fs.existsSync(BEREICHE_DATEI) ? require(BEREICHE_DATEI) : [];
const vorhanden = (datei) => fs.existsSync(path.join(__dirname, datei));
const vorhandenesModul = (modul) => {
  const zwilling = modul.replace(/\.js$/, ".ts");
  return !vorhanden(modul) && vorhanden(zwilling) ? zwilling : modul;
};
const SERVER_PFLICHT_MODULE = [
  ["ausfall-meldung", "src/telephony/outage-report.js"],
  ["bezahlt-ohne-nummer", "src/billing/paid-without-number-watch.js"],
  ["preisdrift", "src/billing/price-drift-watch.js"],
  ["bereitstellung-wiederholen", "src/billing/provision-retry-sweep.js"],
  ["absender-besitz", "src/telephony/ani-ownership-recheck.js"],
].map(([name, modul]) => [name, vorhandenesModul(modul)]);
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
        "Innereien aus src/store/ nicht direkt importieren, sondern über die Speicher-Fassade src/store.js; Begriffe kommen direkt aus src/store/begriffe-<thema>.js (#3478).",
      from: { path: "^src/", pathNot: "^src/(store/|store\\.[jt]s$)" },
      to: {
        path: "^src/store/",
        pathNot: "^src/store/begriffe-[a-z-]+\\.js$",
      },
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
        "Tests greifen nur über die öffentlichen Eingänge eines Bereichs zu (MCP-Werkzeug, HTTP-Route, Anbieter-Webhook, Fassade, Port, Registry, Konfiguration) oder prüfen reine Fachlogik als Tabelle. Interne Module nicht direkt importieren. Schreibe den Test über den Eingang des Bereichs (die Eingänge stehen je Bereich unter eingaenge in tools/bereiche.json). Die Liste ändert nur Engineering; hilft der Eingang nicht weiter, halte an und melde es im Issue.",
      from: { path: "^test/" },
      to: { path: "^src/", pathNot: TEST_ZIELE_ERLAUBT },
    },
    {
      name: "src-nicht-nach-apps-web",
      severity: "error",
      comment:
        "Der Dienst unter src/ importiert nichts aus der Website apps/web/; geteilte Werte liegen unter src/ und die Website liest sie von dort.",
      from: { path: "^src/" },
      to: { path: "^apps/web/" },
    },
  ],
  required: SERVER_PFLICHT_MODULE.map(([name, modul]) => ({
    name: `server-baut-${name}`,
    severity: "error",
    comment: `src/server.js baut beim Start ${modul} und reicht es in die Abläufe weiter; ohne diesen Import fehlt der Wächter im laufenden Dienst.`,
    module: { path: "^src/server\\.js$" },
    to: { path: `^${modul.replace(/\./g, "\\.")}$` },
  })),
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^src/.*\\.test\\.js$" },
    tsPreCompilationDeps: true,
  },
};
