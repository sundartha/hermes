import { test } from "node:test";
import assert from "node:assert/strict";
import { SELF_SERVICE_FREE_FIELDS, SELF_SERVICE_RESTRICT_ONLY_FIELDS } from "../../src/self-service.js";
import {
  SETTINGS_FREE_FIELDS,
  SETTINGS_RESTRICT_ONLY_FIELDS,
  CALL_STATUS_LABELS,
  CALL_STATUS_LABELS_DE,
  TURN_ROLE_LABELS,
  TURN_ROLE_LABELS_DE,
  SETTINGS_LANGUAGE_LABELS_EN,
  SETTINGS_LANGUAGE_LABELS_DE,
  SETTINGS_PERMISSION_LABELS_EN,
  SETTINGS_PERMISSION_LABELS_DE,
  SETTINGS_PERMISSION_HINTS_EN,
  SETTINGS_PERMISSION_HINTS_DE,
  PRIVATE_NUMBER_MESSAGES,
  PRIVATE_NUMBER_MESSAGES_DE,
} from "../../apps/web/src/lib/api.js";
import { STATUS_PILL_LABELS, STATUS_PILL_LABELS_DE } from "../../apps/web/src/lib/render.js";
import {
  SUBSCRIBE_MESSAGES,
  SUBSCRIBE_MESSAGES_DE,
  CANCEL_MESSAGES,
  CANCEL_MESSAGES_DE,
  NEWSLETTER_MESSAGES,
  NEWSLETTER_MESSAGES_DE,
  PLAN_CHOICE_COPY,
  PLAN_CHOICE_COPY_DE,
  BILLING_STATUS_BADGE,
  BILLING_STATUS_BADGE_DE,
  CANCEL_BUTTON_LABEL,
  CONFIRM_CANCEL_BUTTON_LABEL,
} from "../../apps/web/src/lib/subscribe.js";

test("GAP-30 (SOLL, rot) - Frontend- und Server-Feldkatalog sind identisch", () => {
  assert.deepEqual(
    [...SETTINGS_FREE_FIELDS].sort(),
    [...SELF_SERVICE_FREE_FIELDS].sort(),
    "Frontend-FREE_FIELDS driftet vom Server-Vertrag - agentStyle fehlt der UI, allowCalendar/allowBooking kennt der Server nicht mehr",
  );
});

test("GAP-30 (Mechanismus, gruen) - die restrict-only-Liste ist zwischen beiden Paketen deckungsgleich", () => {
  assert.deepEqual(
    [...SETTINGS_RESTRICT_ONLY_FIELDS].sort(),
    [...SELF_SERVICE_RESTRICT_ONLY_FIELDS].sort(),
    "der Paritaets-Mechanismus traegt fuer restrict-only - der GAP-30-Befund betrifft genau EINE Liste (FREE_FIELDS), nicht beide",
  );
});

const DICT_PAIRS = [
  ["render.js STATUS_PILL_LABELS", STATUS_PILL_LABELS, STATUS_PILL_LABELS_DE],
  ["api.js CALL_STATUS_LABELS", CALL_STATUS_LABELS, CALL_STATUS_LABELS_DE],
  ["api.js TURN_ROLE_LABELS", TURN_ROLE_LABELS, TURN_ROLE_LABELS_DE],
  ["api.js SETTINGS_LANGUAGE_LABELS", SETTINGS_LANGUAGE_LABELS_EN, SETTINGS_LANGUAGE_LABELS_DE],
  ["api.js SETTINGS_PERMISSION_LABELS", SETTINGS_PERMISSION_LABELS_EN, SETTINGS_PERMISSION_LABELS_DE],
  ["api.js SETTINGS_PERMISSION_HINTS", SETTINGS_PERMISSION_HINTS_EN, SETTINGS_PERMISSION_HINTS_DE],
  ["api.js PRIVATE_NUMBER_MESSAGES", PRIVATE_NUMBER_MESSAGES, PRIVATE_NUMBER_MESSAGES_DE],
  ["subscribe.js SUBSCRIBE_MESSAGES", SUBSCRIBE_MESSAGES, SUBSCRIBE_MESSAGES_DE],
  ["subscribe.js CANCEL_MESSAGES", CANCEL_MESSAGES, CANCEL_MESSAGES_DE],
  ["subscribe.js NEWSLETTER_MESSAGES", NEWSLETTER_MESSAGES, NEWSLETTER_MESSAGES_DE],
  ["subscribe.js PLAN_CHOICE_COPY", PLAN_CHOICE_COPY, PLAN_CHOICE_COPY_DE],
  ["subscribe.js BILLING_STATUS_BADGE", BILLING_STATUS_BADGE, BILLING_STATUS_BADGE_DE],
];

test("dashboard-i18n Etappe 2: jede DE-Uebersetzung hat einen EN-Zwilling (Schluesselparitaet der dynamischen Woerterbuecher)", () => {
  for (const [name, en, de] of DICT_PAIRS) {
    assert.deepEqual(
      Object.keys(de).sort(),
      Object.keys(en).sort(),
      `${name}: DE-Woerterbuch driftet von den EN-Schluesseln (fehlender/ueberzaehliger Key)`,
    );
  }
});

test("dashboard-i18n Etappe 2: die gesetzlich vorgegebenen 312k-Knopftexte tauchen in KEINEM dynamischen Woerterbuch auf", () => {
  const forbiddenValues = [CANCEL_BUTTON_LABEL, CONFIRM_CANCEL_BUTTON_LABEL];
  for (const [name, en, de] of DICT_PAIRS) {
    for (const [dictLabel, dict] of [["EN", en], ["DE", de]]) {
      for (const key of Object.keys(dict)) {
        assert.ok(!forbiddenValues.includes(key), `${name} (${dictLabel}): 312k-Wortlaut als Schluessel "${key}"`);
      }
      for (const value of Object.values(dict)) {
        assert.ok(
          !forbiddenValues.includes(value),
          `${name} (${dictLabel}): enthaelt den gesetzlich vorgegebenen 312k-Wortlaut "${value}" als Wert - das darf nie uebersetzbar werden`,
        );
      }
    }
  }
});
