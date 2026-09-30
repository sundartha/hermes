// Kuendigungsformular ohne Anmeldung (§ 312k BGB): die reinen Bausteine aus
// lib/cancel-form.js und die Pflichtteile im Markup von CancelInfo.astro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  FORM_MESSAGE,
  PAYLOAD_FIELDS,
  formatReceivedAt,
  formatWishDate,
  isAccepted,
  messageForStatus,
  payloadFrom,
} from "../src/lib/cancel-form.js";
import { CANCELLATION_URL } from "../src/lib/routes.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(WEB_ROOT, path), "utf8");
const HTTP = Object.freeze({ OK: 200, BAD_REQUEST: 400, TOO_MANY: 429, UNAVAILABLE: 503 });

test("Kuendigungsformular: Antwortcode -> Meldung (alles Unbekannte verweist auf die E-Mail)", () => {
  assert.equal(isAccepted(HTTP.OK), true);
  assert.equal(messageForStatus(HTTP.BAD_REQUEST), FORM_MESSAGE.INVALID);
  assert.equal(messageForStatus(HTTP.TOO_MANY), FORM_MESSAGE.RATE);
  assert.equal(messageForStatus(HTTP.UNAVAILABLE), FORM_MESSAGE.UNAVAILABLE);
});

test("Kuendigungsformular: nur die Gateway-Felder reisen mit, getrimmt, fehlende leer", () => {
  const payload = payloadFrom([
    ["name", "  Kim Kunde "],
    ["email", "kim@beispiel.de"],
    ["kind", "ordinary"],
    ["timing", "next"],
    ["unbekannt", "x"],
  ]);
  assert.deepEqual([...payload.keys()], PAYLOAD_FIELDS);
  assert.equal(payload.get("name"), "Kim Kunde");
  assert.equal(payload.get("reason"), "");
});

test("Kuendigungsformular: Eingang in deutscher Zeit, Wunschtermin landesueblich", () => {
  assert.equal(
    formatReceivedAt("2026-10-01T08:05:00Z", "de"),
    "1. Oktober 2026 um 10:05 Uhr (deutsche Zeit)",
  );
  assert.equal(formatWishDate("2026-12-31", "de"), "31.12.2026");
  assert.equal(formatWishDate("2026-12-31", "en"), "31/12/2026");
});

test("Kuendigungsformular: Ziel ist der Gateway-Pfad aus dem Wurzelprojekt", () => {
  assert.ok(CANCELLATION_URL.endsWith("/api/cancellation"));
});

test("CancelInfo: Formular mit allen § 312k-Angaben und dem Knopf 'Jetzt kündigen' aus der Konstante", () => {
  const markup = read("src/components/site/CancelInfo.astro");
  for (const field of [
    "name",
    "email",
    "reference",
    "kind",
    "reason",
    "timing",
    "date",
    "website",
  ]) {
    assert.match(markup, new RegExp(`name="${field}"`), `Feld ${field} fehlt`);
  }
  assert.match(markup, /confirm: CONFIRM_CANCEL_BUTTON_LABEL,/);
  assert.match(markup, /confirm: CONFIRM_CANCEL_BUTTON_LABEL_EN,/);
  assert.match(markup, /data-cancel-done/, "Bestaetigungsseite fehlt");
  assert.match(markup, /data-cf-print/, "Speichern/Drucken fehlt");
  assert.doesNotMatch(
    markup,
    /webAuth|LOGIN_URL\}>\{T\.confirm/,
    "Kuendigen darf keine Anmeldung verlangen",
  );
});
