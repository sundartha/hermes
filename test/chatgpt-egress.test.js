import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isChatGptEgressIp } from "../src/ui/chatgpt-egress.js";

const RANGES = JSON.parse(
  fs.readFileSync(new URL("../src/ui/chatgpt-egress-ranges.json", import.meta.url), "utf8"),
);

const [firstPrefix, secondPrefix] = RANGES.prefixes;
const firstIp = firstPrefix.ipv4Prefix.split("/")[0];
const secondIp = secondPrefix.ipv4Prefix.split("/")[0];

const SUBNET23_NET = "199.47.142.0";
const SUBNET23_LAST = "199.47.143.255";
const SUBNET23_BELOW = "199.47.141.255";
const SUBNET23_ABOVE = "199.47.144.0";

test("Treffer: zwei unterschiedliche echte Eintraege aus der Liste sind true", () => {
  assert.equal(isChatGptEgressIp(firstIp), true, firstIp);
  assert.equal(isChatGptEgressIp(secondIp), true, secondIp);
});

test("Treffer: IPv4-gemapptes IPv6-Literal (Express req.ip-Form) matcht dieselbe Regel", () => {
  assert.equal(isChatGptEgressIp(`::ffff:${firstIp}`), true);
});

test("Grenzfall Subnetz (199.47.142.0/23): Netz-Adresse und letzte Adresse drin, je ein Schritt aussen raus", () => {
  assert.ok(
    RANGES.prefixes.some((prefix) => prefix.ipv4Prefix === "199.47.142.0/23"),
    "Positiv-Kontrolle: das erwartete Subnetz steht wirklich in der Liste",
  );
  assert.equal(isChatGptEgressIp(SUBNET23_NET), true, SUBNET23_NET);
  assert.equal(isChatGptEgressIp(SUBNET23_LAST), true, SUBNET23_LAST);
  assert.equal(isChatGptEgressIp(SUBNET23_BELOW), false, SUBNET23_BELOW);
  assert.equal(isChatGptEgressIp(SUBNET23_ABOVE), false, SUBNET23_ABOVE);
});

test("Kein Treffer: bekannte oeffentliche IPv4/IPv6-Adressen ausserhalb der Liste", () => {
  assert.equal(isChatGptEgressIp("8.8.8.8"), false);
  assert.equal(isChatGptEgressIp("::ffff:8.8.8.8"), false, "gemappt, aber nicht gelistet");
  assert.equal(isChatGptEgressIp("2001:4860:4860::8888"), false, "echte IPv6, nicht gelistet");
});

const NICHT_STRING_ZAHL = 12345;

test("fail-closed: Muell/fehlende Eingabe liefert false, nie true und nie throw", () => {
  const muell = [
    null,
    undefined,
    "",
    "   ",
    "not-an-ip",
    "999.999.999.999",
    "::1::2",
    NICHT_STRING_ZAHL,
    {},
    [],
  ];
  for (const wert of muell) {
    assert.equal(isChatGptEgressIp(wert), false, `Eingabe: ${JSON.stringify(wert)}`);
  }
});

const EGRESS_LISTE_MAX_ALTER_TAGE = 180;
const MS_JE_TAG = 86_400_000;

test("Egress-Liste ist nicht aelter als die Alarm-Schwelle (_fetchedAt)", () => {
  const fetchedAt = new Date(`${RANGES._fetchedAt}T00:00:00Z`);
  assert.ok(!Number.isNaN(fetchedAt.getTime()), `_fetchedAt unlesbar: ${RANGES._fetchedAt}`);
  const alterTage = (Date.now() - fetchedAt.getTime()) / MS_JE_TAG;
  assert.ok(
    alterTage <= EGRESS_LISTE_MAX_ALTER_TAGE,
    `src/ui/chatgpt-egress-ranges.json ist ${Math.floor(alterTage)} Tage alt (Grenze ` +
      `${EGRESS_LISTE_MAX_ALTER_TAGE}) - gegen _source neu abrufen und _fetchedAt/` +
      `_upstreamCreationTime nachziehen (Anleitung im _note-Feld der Datei).`,
  );
});
