import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { fuehreLastlaufAus } from "../../scripts/last/lauf.mjs";

const K6_ATTRAPPE = fileURLToPath(new URL("./k6-attrappe.mjs", import.meta.url));
const ergebnis = { fehlerquoteProzent: 0, verloreneAnrufe: 0, wartezeitSekunden: 1, routen: [{ name: "r", istMs: 1, budgetMs: 2 }] };

const SPIEGEL = [
  'const fs = require("node:fs");',
  "const werte = Object.fromEntries(process.argv.flatMap((a, i) => (process.argv[i - 1] === \"-e\" ? [a.split(/=(.*)/s).slice(0, 2)] : [])));",
  'const konfig = JSON.parse(fs.readFileSync(werte.LAST_KONFIG, "utf8"));',
  "fs.writeFileSync(werte.LAST_ERGEBNIS, JSON.stringify({ ...konfig.ergebnis, ziele: konfig.ziele }));",
].join("\n");

function umgebungMit(ziele, konfiguration) {
  const stand = { geschlossen: 0 };
  const starte = async () => ({ ziele, konfiguration, schliessen: async () => void (stand.geschlossen += 1) });
  return { stand, starte };
}

test("H2a Zielsperre: ein fremdes Ziel nur in konfiguration.ziele bricht vor dem k6-Start ab", async () => {
  const umgebung = umgebungMit(["http://localhost:3999"], { ziele: ["http://localhost:3999", "https://fremd.example"], k6Exit: 7, ergebnis });
  await assert.rejects(
    fuehreLastlaufAus({ k6Befehl: [process.execPath, K6_ATTRAPPE], starte: umgebung.starte }),
    /^Error: Lastlauf abgebrochen: ziel_nicht_erlaubt$/,
  );
  assert.equal(umgebung.stand.geschlossen, 1);
});

test("H2a Zielsperre: k6 bekommt in konfiguration.ziele die geprueften Origins, der Rest der Konfiguration bleibt", async () => {
  const umgebung = umgebungMit(["http://localhost:3999/pfad", "http://127.0.0.1:3998"], {
    ziele: ["http://localhost:3999/pfad", "http://127.0.0.1:3998"],
    ergebnis,
  });
  const urteil = await fuehreLastlaufAus({ k6Befehl: [process.execPath, "-e", SPIEGEL], starte: umgebung.starte });
  assert.deepEqual(urteil.ergebnis.ziele, ["http://localhost:3999", "http://127.0.0.1:3998"]);
  assert.equal(urteil.ergebnis.fehlerquoteProzent, 0);
});
