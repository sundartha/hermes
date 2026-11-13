import { enumOrNull } from "./provider-enum.ts";

const DECLINE_FIELDS = Object.freeze({
  code: "code",
  declineCode: "decline_code",
  type: "type",
});

export type Decline = Readonly<Record<string, string | null>>;

export function declineOf(errorBody: { error?: Record<string, unknown> } | null | undefined): Decline {
  const err = errorBody?.error ?? {};
  const sicht: Record<string, string | null> = {};
  for (const [feld, stripeName] of Object.entries(DECLINE_FIELDS)) sicht[feld] = enumOrNull(err[stripeName]);
  return Object.freeze(sicht);
}

export function declineDetail(decline: Decline): string {
  const gesetzteFelder = Object.entries(DECLINE_FIELDS).flatMap(([feld, stripeName]) => {
    const wert = decline[feld];
    return wert ? [`${stripeName}=${wert}`] : [];
  });
  return gesetzteFelder.join(" ");
}

export function attachProviderDecline<E extends object>(err: E, decline: Decline): E & { providerDecline: Decline } {
  return Object.assign(err, { providerDecline: decline });
}
