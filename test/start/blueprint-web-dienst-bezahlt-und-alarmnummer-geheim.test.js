import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RENDER_YAML = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");

const DIENST_BEGINN = /\n(?= {2}- type: )/;
const ENV_BEGINN = /\n(?= {6}- key: )/;
const ALARM_SMS_SCHLUESSEL = "PLATFORM_ALERT_SMS_TO";
const ALARM_MAIL_SCHLUESSEL = "PLATFORM_ALERT_MAIL_TO";
const GEHEIMER_EINTRAG = "sync: false";

function dienstBloecke() {
  return RENDER_YAML.split(DIENST_BEGINN).filter((block) => block.startsWith("  - type: "));
}

function webDienstBloecke() {
  return dienstBloecke().filter(
    (block) => block.startsWith("  - type: web") && !/\n\s+runtime:\s*static\b/.test(block),
  );
}

function dienstName(block) {
  return /\n\s+name:\s*(\S+)/.exec(block)?.[1] ?? "?";
}

function envEintrag(schluessel) {
  const eintraege = RENDER_YAML.split(ENV_BEGINN).filter((teil) =>
    teil.startsWith(`      - key: ${schluessel}\n`),
  );
  assert.equal(eintraege.length, 1, `${schluessel} muss genau einmal in render.yaml stehen`);
  const folgezeilen = eintraege[0].split("\n").slice(1);
  return folgezeilen
    .map((zeile) => zeile.trim())
    .filter((zeile) => zeile !== "" && !zeile.startsWith("#"))
    .slice(0, 1);
}

test("Blueprint (B11): ein Web-Dienst laeuft nie auf plan:free", () => {
  const web = webDienstBloecke();
  assert.ok(web.length > 0, "render.yaml muss mindestens einen Web-Dienst enthalten");
  const kostenlos = web
    .filter((block) => /\n\s+plan:\s*free\b/.test(block))
    .map((block) => dienstName(block));
  assert.deepEqual(
    kostenlos,
    [],
    "ein Web-Dienst auf plan:free schlaeft nach Leerlauf ein und verpasst Anrufe und Webhooks; " +
      `betroffen: ${kostenlos.join(", ")}`,
  );
});

test("Blueprint (B11): der Web-Dienst traegt einen ausdruecklich bezahlten plan", () => {
  const plaene = webDienstBloecke().map((block) => /\n\s+plan:\s*(\S+)/.exec(block)?.[1] ?? null);
  assert.deepEqual(plaene, ["starter"]);
});

test("Blueprint (B11): die Alarm-SMS-Nummer ist ein Geheimnis ohne Wert im Repo", () => {
  assert.deepEqual(envEintrag(ALARM_SMS_SCHLUESSEL), [GEHEIMER_EINTRAG]);
});

test("Blueprint (B11): die Alarm-SMS-Nummer ist genau so hinterlegt wie die Alarm-Mail", () => {
  assert.deepEqual(envEintrag(ALARM_SMS_SCHLUESSEL), envEintrag(ALARM_MAIL_SCHLUESSEL));
});
