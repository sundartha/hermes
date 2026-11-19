import { abrufMitFrist } from "./antwortfrist.mjs";

const SCHLEIFE = "127.0.0.1";

export function abrufOhnePool(url, optionen = {}) {
  const ziel = new URL(url);
  if (ziel.hostname === "localhost") ziel.hostname = SCHLEIFE;
  return abrufMitFrist(ziel, {
    ...optionen,
    headers: { ...optionen.headers, connection: "close" },
  });
}
