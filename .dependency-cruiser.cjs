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
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^src/.*\\.test\\.js$" },
  },
};
