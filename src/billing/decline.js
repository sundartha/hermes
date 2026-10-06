import { enumOrNull } from "./provider-enum.js";

const DECLINE_FIELDS = Object.freeze({
  code: "code",
  declineCode: "decline_code",
  type: "type",
});

export function declineOf(errorBody) {
  const err = (errorBody && errorBody.error) || {};
  const sicht = {};
  for (const [feld, stripeName] of Object.entries(DECLINE_FIELDS))
    sicht[feld] = enumOrNull(err[stripeName]);
  return Object.freeze(sicht);
}

export function declineDetail(decline) {
  const gesetzteFelder = Object.entries(DECLINE_FIELDS).filter(([feld]) => decline[feld]);
  return gesetzteFelder.map(([feld, stripeName]) => `${stripeName}=${decline[feld]}`).join(" ");
}

export function attachProviderDecline(err, decline) {
  return Object.assign(err, { providerDecline: decline });
}
