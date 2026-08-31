// OUTBOUND-E4 Review-Blocker (G5): sollAusConfig/schwellenAusConfig/bedienteLaenderAus
// standen woertlich zweimal da (outbound-drift-watch.js + scripts/check-outbound-drift.mjs).
// Dieser Test pinnt die EINE verbliebene Quelle (outbound-config-soll.js) und belegt per
// Quelltext-Grep, dass beide Aufrufer sie tatsaechlich importieren statt eine eigene
// Kopie zu tragen.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sollAusConfig, schwellenAusConfig, bedienteLaenderAus } from "../src/telephony/outbound-config-soll.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("E4-Soll: S-1 bedienteLaenderAus - bekannte Praefixe -> ISO-Codes, unbekannte/gemischte Vorwahl -> leere Menge", () => {
  assert.deepEqual(bedienteLaenderAus(["+49", "+33"]), ["DE", "FR"]);
  assert.deepEqual(bedienteLaenderAus(["+49", "+1"]), [], "eine einzige unbekannte Vorwahl macht die GANZE Menge unbestimmbar");
  assert.deepEqual(bedienteLaenderAus(["*"]), []);
  assert.deepEqual(bedienteLaenderAus(undefined), []);
});

test("E4-Soll: S-2 sollAusConfig/schwellenAusConfig lesen die sechs bzw. zwei geteilten Felder aus config", () => {
  const config = withConfigNamespaces({
    elevenLabsOutbound: { agentId: "agent_x", agentPhoneNumberId: "phnum_x" },
    platformAniE164: "+15739090177",
    telnyxFqdnConnectionId: "conn_1",
    telnyxOutboundVoiceProfileId: "ovp_1",
    allowedCountryCodes: ["+49"],
    outboundDriftStaleMs: 999,
    outboundDriftBalanceMinHours: 42,
  });
  assert.deepEqual(sollAusConfig(config), {
    elAgentId: "agent_x",
    elPhoneNumberId: "phnum_x",
    platformAniE164: "+15739090177",
    fqdnConnectionId: "conn_1",
    ovpId: "ovp_1",
    bedienteLaender: ["DE"],
  });
  assert.deepEqual(schwellenAusConfig(config), { staleMs: 999, balanceMinHours: 42 });
});

test("E4-Soll: S-3 beide Aufrufer importieren AUS outbound-config-soll.js, keine getippte Zweitkopie (G5)", () => {
  const watchSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "telephony", "outbound-drift-watch.js"), "utf8");
  const cliSrc = fs.readFileSync(path.join(REPO_ROOT, "scripts", "check-outbound-drift.mjs"), "utf8");
  assert.match(watchSrc, /from\s*"\.\/outbound-config-soll\.js"/, "outbound-drift-watch.js muss aus outbound-config-soll.js importieren");
  assert.match(cliSrc, /from\s*"\.\.\/src\/telephony\/outbound-config-soll\.js"/, "der CLI-Weg muss aus outbound-config-soll.js importieren");
  // Gegenprobe (Blocker-Vermeidungsliste 2): eine getippte Zweitkopie wuerde HIER nicht
  // auffallen, wenn wir nur auf die Werte pruefen - deshalb zusaetzlich sicherstellen,
  // dass keiner der beiden Aufrufer noch eine eigene PREFIX_ISO-Tabelle traegt.
  assert.doesNotMatch(watchSrc, /PREFIX_ISO/, "outbound-drift-watch.js darf keine eigene Praefix-Tabelle mehr tragen");
  assert.doesNotMatch(cliSrc, /PREFIX_ISO/, "der CLI-Weg darf keine eigene Praefix-Tabelle mehr tragen");
});

// Blocker 7 (Review Runde 2, G5): dieselbe Duplizierung am EL-GET (elRead-Closure) - vorher
// wortgleich in server.js UND scripts/check-outbound-drift.mjs. EINE Fabrik statt zweier
// getippter Kopien; die Gegenprobe stellt sicher, dass keiner der beiden Aufrufer noch
// eine eigene "fetchPhoneNumber({ fetchImpl: fetch, account: ..." Formulierung traegt.
test("E4-Soll: S-4 beide Aufrufer bauen elRead ueber makeElConfigRead, keine getippte Zweitkopie der Closure (Blocker 7)", () => {
  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "server.js"), "utf8");
  const cliSrc = fs.readFileSync(path.join(REPO_ROOT, "scripts", "check-outbound-drift.mjs"), "utf8");
  assert.match(serverSrc, /makeElConfigRead/, "server.js muss makeElConfigRead verwenden");
  assert.match(cliSrc, /makeElConfigRead/, "der CLI-Weg muss makeElConfigRead verwenden");
  const eigeneClosure = /fetchPhoneNumber\(\{\s*fetchImpl:\s*fetch/;
  assert.doesNotMatch(serverSrc, eigeneClosure, "server.js darf die EL-Closure nicht mehr selbst formulieren");
  assert.doesNotMatch(cliSrc, eigeneClosure, "der CLI-Weg darf die EL-Closure nicht mehr selbst formulieren");
});
