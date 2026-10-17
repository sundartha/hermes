import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const FUNKTIONSKARTE = join(REPO, "tools", "funktionskarte.mjs");
const TEST_FRIST = { timeout: 170000 };
const LAUF_FRIST_MS = 160000;
const EXIT_ROT = 1;
const EXIT_AUFRUF = 2;
const EXIT_BLOCKIERT = 3;
const STATUS_SIGNATUR_ABGELEHNT = 403;
const OFFEN = "tools/basis/funktionskarte-offen.json";
const FLAECHEN = [
  { art: "Werkzeug", flaeche: "get_agent_number" },
  { art: "Werkzeug", flaeche: "get_agent_status" },
  { art: "Route", flaeche: "POST /mcp", path: "/mcp" },
  { art: "Route", flaeche: "GET /healthz", path: "/healthz" },
];
const ABSCHNITTE = [
  "Unterfunktionen",
  "Wie ein Nutzer hinkommt",
  "Steuerung mit hermes-ctl",
  "Stolperfallen",
];
const NUMMER_LESEN = {
  befehl: ["werkzeug", "get_agent_number", {}],
  merke: "nummer",
  erwarte: [{ pfad: "ergebnis.number", typ: "string" }],
};
const STATUS_LESEN = {
  befehl: ["werkzeug", "get_agent_status", {}],
  erwarte: [{ pfad: "ergebnis.number", gleich: "{{nummer.ergebnis.number}}" }],
};
const NUMMER_KARTE = {
  flaechen: ["get_agent_number", "get_agent_status", "POST /mcp"],
  schritte: [NUMMER_LESEN, STATUS_LESEN],
};

const ordner = [];
after(() => {
  for (const pfad of ordner) rmSync(pfad, { recursive: true, force: true });
});

function karteText(rezept) {
  const abschnitte = ABSCHNITTE.map((titel) => `## ${titel}\n\nText.\n`);
  abschnitte[2] += `\n\`\`\`json rezept\n${JSON.stringify(rezept, null, 2)}\n\`\`\`\n`;
  return `# Karte\n\n${abschnitte.join("\n")}`;
}

function dateienSchreiben(wurzel, dateien) {
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(join(wurzel, pfad, ".."), { recursive: true });
    writeFileSync(
      join(wurzel, pfad),
      typeof inhalt === "string" ? inhalt : `${JSON.stringify(inhalt, null, 2)}\n`,
    );
  }
}

function git(wurzel, ...argumente) {
  execFileSync("git", argumente, { cwd: wurzel, stdio: "ignore" });
}

function bestand({ vorher, nachher = {}, flaechen = FLAECHEN }) {
  const wurzel = mkdtempSync(join(tmpdir(), "funktionskarte-test-"));
  ordner.push(wurzel);
  git(wurzel, "init", "-q");
  git(wurzel, "config", "user.email", "test@example.invalid");
  git(wurzel, "config", "user.name", "Test");
  dateienSchreiben(wurzel, { "flaechen.json": flaechen, ...vorher });
  git(wurzel, "add", "-A");
  git(wurzel, "commit", "-q", "-m", "vorher");
  dateienSchreiben(wurzel, nachher);
  return wurzel;
}

function aufrufen(wurzel, argumente, env = process.env) {
  return new Promise((fertig) => {
    execFile(
      process.execPath,
      [FUNKTIONSKARTE, ...argumente],
      { cwd: wurzel, env, timeout: LAUF_FRIST_MS },
      (fehler, stdout, stderr) => fertig({ exit: fehler?.code ?? 0, stdout, stderr }),
    );
  });
}

function pruefen(wurzel, env = process.env) {
  return aufrufen(wurzel, ["pruefen", "--basis", "HEAD", "--flaechen-datei", "flaechen.json"], env);
}

const sauberVorher = (karte = NUMMER_KARTE) => ({
  "docs/funktionen/nummer.md": karteText(karte),
  [OFFEN]: ["GET /healthz"],
});

test(
  "eine Karte, deren Rezept jede ihrer Flächen aufruft und die Antwort prüft, ist sauber",
  TEST_FRIST,
  async () => {
    const lauf = await pruefen(bestand({ vorher: sauberVorher() }));
    assert.equal(lauf.exit, 0, `${lauf.stdout}${lauf.stderr}`);
    assert.match(lauf.stdout, /docs\/funktionen\/nummer\.md: sauber/);
    assert.match(lauf.stdout, /Funktionskarte: sauber/);
  },
);

test(
  "eine neu registrierte Fläche ohne Karte und ohne Listeneintrag ist rot",
  TEST_FRIST,
  async () => {
    const flaechen = [
      ...FLAECHEN,
      { art: "Route", flaeche: "GET /api/beispiel", path: "/api/beispiel" },
    ];
    const lauf = await pruefen(bestand({ vorher: sauberVorher(), flaechen }));
    assert.equal(lauf.exit, EXIT_ROT);
    assert.match(lauf.stderr, /GET \/api\/beispiel hat keine Funktionskarte/);
  },
);

test(
  "ein neuer Eintrag in der Liste offener Flächen ist rot, die Liste darf nur kürzer werden",
  TEST_FRIST,
  async () => {
    const karte = { ...NUMMER_KARTE, flaechen: ["get_agent_number", "POST /mcp"] };
    const wurzel = bestand({
      vorher: { "docs/funktionen/nummer.md": karteText(NUMMER_KARTE), [OFFEN]: ["GET /healthz"] },
      nachher: {
        "docs/funktionen/nummer.md": karteText(karte),
        [OFFEN]: ["GET /healthz", "get_agent_status"],
      },
    });
    const lauf = await pruefen(wurzel);
    assert.equal(lauf.exit, EXIT_ROT);
    assert.match(lauf.stderr, /get_agent_status ist neu; die Liste darf nur kürzer werden/);
  },
);

test("eine Karte, die eine nicht registrierte Fläche nennt, ist rot", TEST_FRIST, async () => {
  const karte = { ...NUMMER_KARTE, flaechen: [...NUMMER_KARTE.flaechen, "get_unbekannt"] };
  const lauf = await pruefen(bestand({ vorher: sauberVorher(karte) }));
  assert.equal(lauf.exit, EXIT_ROT);
  assert.match(lauf.stderr, /nummer\.md: nennt get_unbekannt, das Hermes nicht registriert/);
});

test(
  "eine Fläche, die zugleich eine Karte hat und auf der Liste steht, ist rot",
  TEST_FRIST,
  async () => {
    const vorher = { ...sauberVorher(), [OFFEN]: ["GET /healthz", "get_agent_status"] };
    const lauf = await pruefen(bestand({ vorher }));
    assert.equal(lauf.exit, EXIT_ROT);
    assert.match(
      lauf.stderr,
      /get_agent_status hat jetzt eine Karte \(docs\/funktionen\/nummer\.md\); streiche den Eintrag/,
    );
  },
);

test("ein Schritt ohne Erwartung an die Antwort ist rot", TEST_FRIST, async () => {
  const ohneErwartung = { befehl: STATUS_LESEN.befehl };
  const karte = { ...NUMMER_KARTE, schritte: [NUMMER_LESEN, ohneErwartung] };
  const lauf = await pruefen(bestand({ vorher: sauberVorher(karte) }));
  assert.equal(lauf.exit, EXIT_ROT);
  assert.match(lauf.stderr, /Schritt 2: braucht mindestens eine Erwartung an die Antwort/);
});

test(
  "eine Fläche, die die Karte nennt, deren Rezept sie aber nicht aufruft, ist rot",
  TEST_FRIST,
  async () => {
    const karte = { ...NUMMER_KARTE, schritte: [NUMMER_LESEN] };
    const lauf = await pruefen(bestand({ vorher: sauberVorher(karte) }));
    assert.equal(lauf.exit, EXIT_ROT);
    assert.match(
      lauf.stderr,
      /nummer\.md: kein Schritt ruft get_agent_status auf und prüft die Antwort/,
    );
  },
);

test(
  "eine Erwartung von einem Anruf, wo eine frische Sitzung 0 Anrufe meldet, ist rot mit Karte und Schritt",
  TEST_FRIST,
  async () => {
    const falsch = { ...STATUS_LESEN, erwarte: [{ pfad: "ergebnis.calls", gleich: 1 }] };
    const karte = { ...NUMMER_KARTE, schritte: [NUMMER_LESEN, falsch] };
    const lauf = await pruefen(bestand({ vorher: sauberVorher(karte) }));
    assert.equal(lauf.exit, EXIT_ROT);
    assert.match(lauf.stderr, /nummer\.md Schritt 2: ergebnis\.calls ist 0, erwartet 1/);
  },
);

test(
  "eine Erwartung an ein Feld von hermes-ctl, einen freien Typ oder leeren Text ist rot",
  TEST_FRIST,
  async () => {
    const leer = {
      ...STATUS_LESEN,
      erwarte: [
        { pfad: "befehl", typ: "string" },
        { pfad: "ergebnis.gibt_es_nicht", typ: "undefined" },
        { pfad: "ergebnis.owner", enthaelt: "" },
      ],
    };
    const karte = { ...NUMMER_KARTE, schritte: [NUMMER_LESEN, leer] };
    const lauf = await pruefen(bestand({ vorher: sauberVorher(karte) }));
    assert.equal(lauf.exit, EXIT_ROT);
    assert.match(lauf.stderr, /Schritt 2: „befehl“ ist ein Feld von hermes-ctl/);
    assert.match(lauf.stderr, /Schritt 2: „typ“ muss eines von string, number/);
    assert.match(lauf.stderr, /Schritt 2: „enthaelt“ braucht einen nicht leeren Text/);
  },
);

test(
  "ein Platzhalter, den kein früherer Schritt gemerkt hat, ist rot, auch wenn der Pfad fehlt",
  TEST_FRIST,
  async () => {
    const ungemerkt = {
      ...STATUS_LESEN,
      erwarte: [{ pfad: "ergebnis.gibt_es_nicht", gleich: "{{niemand.ergebnis.number}}" }],
    };
    const karte = { ...NUMMER_KARTE, schritte: [NUMMER_LESEN, ungemerkt] };
    const lauf = await pruefen(bestand({ vorher: sauberVorher(karte) }));
    assert.equal(lauf.exit, EXIT_ROT);
    assert.match(
      lauf.stderr,
      /Schritt 2: Platzhalter \{\{niemand\.ergebnis\.number\}\} nennt nichts/,
    );
  },
);

test(
  "eine Erwartung oder ein Platzhalter an ein geerbtes Feld wie constructor ist rot",
  TEST_FRIST,
  async () => {
    const geerbt = {
      ...STATUS_LESEN,
      erwarte: [{ pfad: "constructor.name", gleich: "Object" }],
    };
    const karte = { ...NUMMER_KARTE, schritte: [NUMMER_LESEN, geerbt] };
    const lauf = await pruefen(bestand({ vorher: sauberVorher(karte) }));
    assert.equal(lauf.exit, EXIT_ROT);
    assert.match(lauf.stderr, /nummer\.md Schritt 2: constructor\.name fehlt in der Antwort/);
    const platzhalter = {
      ...STATUS_LESEN,
      erwarte: [{ pfad: "ergebnis.number", gleich: "{{constructor.name}}" }],
    };
    const zweite = { ...NUMMER_KARTE, schritte: [NUMMER_LESEN, platzhalter] };
    const rot = await pruefen(bestand({ vorher: sauberVorher(zweite) }));
    assert.equal(rot.exit, EXIT_ROT);
    assert.match(rot.stderr, /Schritt 2: Platzhalter \{\{constructor\.name\}\} nennt nichts/);
  },
);

test(
  "ein abgelehnter HTTP-Aufruf deckt seine Fläche nur ab, wenn der Schritt den Status prüft",
  TEST_FRIST,
  async () => {
    const lookup = "POST /webhooks/elevenlabs/lookup";
    const flaechen = [
      ...FLAECHEN,
      { art: "Webhook", flaeche: lookup, path: "/webhooks/elevenlabs/lookup" },
    ];
    const ablehnung = (erwarte) => ({
      flaechen: [lookup],
      schritte: [
        {
          befehl: [
            "webhook",
            "elevenlabs-lookup",
            { conversation_id: "x", query: "y" },
            "--falsche-signatur",
          ],
          erwarte,
        },
      ],
    });
    const vorher = (erwarte) => ({
      ...sauberVorher(),
      "docs/funktionen/ablehnung.md": karteText(ablehnung(erwarte)),
    });
    const rot = await pruefen(
      bestand({ vorher: vorher([{ pfad: "koerper.error", gleich: "token" }]), flaechen }),
    );
    assert.equal(rot.exit, EXIT_ROT);
    assert.match(
      rot.stderr,
      /ablehnung\.md: kein Schritt ruft POST \/webhooks\/elevenlabs\/lookup auf/,
    );
    const gruen = await pruefen(
      bestand({
        vorher: vorher([{ pfad: "status", gleich: STATUS_SIGNATUR_ABGELEHNT }]),
        flaechen,
      }),
    );
    assert.equal(gruen.exit, 0, `${gruen.stdout}${gruen.stderr}`);
  },
);

test("ein Hintergrund-Schritt, den kein Schritt abwartet, ist rot", TEST_FRIST, async () => {
  const offen = { befehl: STATUS_LESEN.befehl, hintergrund: "status" };
  const karte = { ...NUMMER_KARTE, schritte: [NUMMER_LESEN, STATUS_LESEN, offen] };
  const lauf = await pruefen(bestand({ vorher: sauberVorher(karte) }));
  assert.equal(lauf.exit, EXIT_ROT);
  assert.match(lauf.stderr, /Hintergrund status wird von keinem Schritt abgewartet/);
});

test("eine unsortierte oder doppelte Liste offener Flächen ist rot", TEST_FRIST, async () => {
  const flaechen = [...FLAECHEN, { art: "Route", flaeche: "GET /api/zwei", path: "/api/zwei" }];
  for (const offen of [
    ["GET /healthz", "GET /api/zwei"],
    ["GET /api/zwei", "GET /healthz", "GET /healthz"],
  ]) {
    const vorher = { ...sauberVorher(), [OFFEN]: offen };
    const lauf = await pruefen(bestand({ vorher, flaechen }));
    assert.equal(lauf.exit, EXIT_ROT);
    assert.match(
      lauf.stderr,
      /funktionskarte-offen\.json: eine Fläche je Eintrag, sortiert, ohne Doppelte/,
    );
  }
});

test("eine Fläche, für die zwei Karten zuständig sind, ist rot", TEST_FRIST, async () => {
  const zweite = {
    flaechen: ["get_agent_status"],
    schritte: [
      { befehl: STATUS_LESEN.befehl, erwarte: [{ pfad: "ergebnis.owner", typ: "string" }] },
    ],
  };
  const vorher = { ...sauberVorher(), "docs/funktionen/status.md": karteText(zweite) };
  const lauf = await pruefen(bestand({ vorher }));
  assert.equal(lauf.exit, EXIT_ROT);
  assert.match(
    lauf.stderr,
    /status\.md: get_agent_status steht schon in docs\/funktionen\/nummer\.md; genau eine Karte je Fläche/,
  );
});

test("ein Listeneintrag für eine Fläche, die es nicht mehr gibt, ist rot", TEST_FRIST, async () => {
  const vorher = { ...sauberVorher(), [OFFEN]: ["GET /alt", "GET /healthz"] };
  const lauf = await pruefen(bestand({ vorher }));
  assert.equal(lauf.exit, EXIT_ROT);
  assert.match(lauf.stderr, /GET \/alt gibt es nicht mehr; streiche den Eintrag/);
});

test(
  "startet die Sitzung von hermes-ctl nicht, ist die Prüfung blockiert",
  TEST_FRIST,
  async () => {
    const wurzel = bestand({ vorher: sauberVorher() });
    const tempOrdnerIstDatei = join(wurzel, "flaechen.json");
    const lauf = await pruefen(wurzel, { ...process.env, TMPDIR: tempOrdnerIstDatei });
    assert.equal(lauf.exit, EXIT_BLOCKIERT, `${lauf.stdout}${lauf.stderr}`);
    assert.match(lauf.stderr, /nummer\.md: hermes-ctl start scheiterte/);
    assert.match(lauf.stdout, /Funktionskarte: blockiert, 1 Befunde\./);
  },
);

test(
  "ein abgewarteter Hintergrund-Schritt deckt seine Fläche ab und wird an seiner Antwort geprüft",
  TEST_FRIST,
  async () => {
    const imHintergrund = { befehl: STATUS_LESEN.befehl, hintergrund: "status" };
    const abwarten = (erwarte) => ({
      ...NUMMER_KARTE,
      schritte: [NUMMER_LESEN, imHintergrund, { abwarten: "status", erwarte }],
    });
    const gruen = await pruefen(bestand({ vorher: sauberVorher(abwarten(STATUS_LESEN.erwarte)) }));
    assert.equal(gruen.exit, 0, `${gruen.stdout}${gruen.stderr}`);
    const falsch = abwarten([{ pfad: "ergebnis.calls", gleich: 1 }]);
    const rot = await pruefen(bestand({ vorher: sauberVorher(falsch) }));
    assert.equal(rot.exit, EXIT_ROT);
    assert.match(rot.stderr, /nummer\.md Schritt 3: ergebnis\.calls ist 0, erwartet 1/);
  },
);

test(
  "ein Rezept, ein Schritt oder eine Erwartung, die kein JSON-Objekt ist, ist ein Formfehler",
  TEST_FRIST,
  async () => {
    const faelle = [
      [null, /nummer\.md: Rezept muss ein JSON-Objekt sein/],
      [{ ...NUMMER_KARTE, schritte: [NUMMER_LESEN, null] }, /Schritt 2: muss ein JSON-Objekt sein/],
      [
        { ...NUMMER_KARTE, schritte: [NUMMER_LESEN, { ...STATUS_LESEN, erwarte: [null] }] },
        /Schritt 2: jede Erwartung muss ein JSON-Objekt sein/,
      ],
    ];
    for (const [karte, meldung] of faelle) {
      const lauf = await pruefen(bestand({ vorher: sauberVorher(karte) }));
      assert.equal(lauf.exit, EXIT_ROT, `${lauf.stdout}${lauf.stderr}`);
      assert.match(lauf.stderr, meldung);
    }
  },
);

test(
  "eine Anfrage an einen anderen Ursprung als die Sitzung deckt keine Route von Hermes ab",
  TEST_FRIST,
  async () => {
    const fremd = "POST /hermes-ctl/ende/:kennung";
    const flaechen = [
      ...FLAECHEN,
      { art: "Route", flaeche: fremd, path: "/hermes-ctl/ende/:kennung" },
    ];
    const karte = {
      flaechen: [fremd],
      schritte: [
        {
          befehl: ["anbieter", "elevenlabs-ende", { conversation_id: "conv_fremd" }],
          erwarte: [{ pfad: "conversation_id", gleich: "conv_fremd" }],
        },
      ],
    };
    const vorher = { ...sauberVorher(), "docs/funktionen/fremd.md": karteText(karte) };
    const lauf = await pruefen(bestand({ vorher, flaechen }));
    assert.equal(lauf.exit, EXIT_ROT, `${lauf.stdout}${lauf.stderr}`);
    assert.match(lauf.stderr, /fremd\.md: kein Schritt ruft POST \/hermes-ctl\/ende\/:kennung auf/);
  },
);

test(
  "ein falscher Aufruf oder eine Basis, die kein Commit ist, endet mit Exit 2",
  TEST_FRIST,
  async () => {
    const wurzel = bestand({ vorher: sauberVorher() });
    const ohneBefehl = await aufrufen(wurzel, []);
    assert.equal(ohneBefehl.exit, EXIT_AUFRUF);
    const falscheBasis = await aufrufen(wurzel, [
      "pruefen",
      "--basis",
      "gibt-es-nicht",
      "--flaechen-datei",
      "flaechen.json",
    ]);
    assert.equal(falscheBasis.exit, EXIT_AUFRUF);
    assert.match(falscheBasis.stderr, /Die Basis gibt-es-nicht ist kein Commit/);
  },
);

test(
  "fehlt die Liste offener Flächen im Basis-Commit, entfällt nur der Vergleich mit der Basis",
  TEST_FRIST,
  async () => {
    const { [OFFEN]: liste, ...ohneListe } = sauberVorher();
    const sauber = await pruefen(bestand({ vorher: ohneListe, nachher: { [OFFEN]: liste } }));
    assert.equal(sauber.exit, 0, `${sauber.stdout}${sauber.stderr}`);
    const unsortiert = { [OFFEN]: ["get_agent_status", "GET /healthz"] };
    const rot = await pruefen(bestand({ vorher: ohneListe, nachher: unsortiert }));
    assert.equal(rot.exit, EXIT_ROT);
    assert.match(
      rot.stderr,
      /funktionskarte-offen\.json: eine Fläche je Eintrag, sortiert, ohne Doppelte/,
    );
  },
);

test(
  "ein Routenmuster mit :param oder * deckt die passende Anfrage ab, ein längeres Muster nicht",
  TEST_FRIST,
  async () => {
    const werkzeuge = FLAECHEN.filter(({ art }) => art === "Werkzeug");
    const mitMuster = (flaeche, path) => [
      ...werkzeuge,
      { art: "Route", flaeche, path },
      { art: "Route", flaeche: "GET /healthz", path: "/healthz" },
    ];
    const karte = (flaeche) => ({
      ...NUMMER_KARTE,
      flaechen: ["get_agent_number", "get_agent_status", flaeche],
    });
    for (const [flaeche, path] of [
      ["POST /:pfad", "/:pfad"],
      ["POST /*", "/*"],
    ]) {
      const lauf = await pruefen(
        bestand({ vorher: sauberVorher(karte(flaeche)), flaechen: mitMuster(flaeche, path) }),
      );
      assert.equal(lauf.exit, 0, `${flaeche}: ${lauf.stdout}${lauf.stderr}`);
    }
    const laenger = "POST /mcp/:mehr";
    const rot = await pruefen(
      bestand({ vorher: sauberVorher(karte(laenger)), flaechen: mitMuster(laenger, "/mcp/:mehr") }),
    );
    assert.equal(rot.exit, EXIT_ROT);
    assert.match(rot.stderr, /nummer\.md: kein Schritt ruft POST \/mcp\/:mehr auf/);
  },
);

test(
  "eine Erwartung, die erst nach dem Einsetzen oder an null nichts mehr verlangt, ist rot",
  TEST_FRIST,
  async () => {
    const statusMerken = { ...STATUS_LESEN, merke: "status" };
    const zahlAlsText = {
      befehl: STATUS_LESEN.befehl,
      erwarte: [{ pfad: "ergebnis.number", enthaelt: "{{status.ergebnis.calls}}" }],
    };
    const karte = { ...NUMMER_KARTE, schritte: [NUMMER_LESEN, statusMerken, zahlAlsText] };
    const lauf = await pruefen(bestand({ vorher: sauberVorher(karte) }));
    assert.equal(lauf.exit, EXIT_ROT);
    assert.match(
      lauf.stderr,
      /Schritt 3: ergebnis\.number: „enthaelt“ braucht nach dem Einsetzen einen nicht leeren Text/,
    );
    const nullAlsObjekt = {
      ...STATUS_LESEN,
      erwarte: [{ pfad: "ergebnis.planUsagePercent", typ: "object" }],
    };
    const zweite = { ...NUMMER_KARTE, schritte: [NUMMER_LESEN, nullAlsObjekt] };
    const rot = await pruefen(bestand({ vorher: sauberVorher(zweite) }));
    assert.equal(rot.exit, EXIT_ROT);
    assert.match(rot.stderr, /Schritt 2: ergebnis\.planUsagePercent hat Typ null, erwartet object/);
  },
);
