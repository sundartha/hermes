import {
  KUERZLISTEN,
  geloeschtSeit,
  textGekuerzt,
  versioniertIn,
} from "./auftrag/listen-kuerzen.mjs";
import { fileAt } from "./pruefungen-messen.mjs";

const KOPF = "HEAD";
const GEAENDERT = "M";

function nurGekuerzt(basis, pfad, dateistand) {
  const nachher = fileAt(KOPF, pfad);
  const gekuerzt = textGekuerzt(pfad, fileAt(basis, pfad), dateistand);
  return nachher !== undefined && gekuerzt?.neu === nachher;
}

export function listenkuerzungen(basis, changes) {
  const geaendert = changes
    .filter(({ status, path }) => status === GEAENDERT && KUERZLISTEN.includes(path))
    .map(({ path }) => path);
  if (geaendert.length === 0) return new Set();
  const geloescht = geloeschtSeit(basis, { ziel: KOPF });
  if (geloescht.length === 0) return new Set();
  const dateistand = { geloescht, jetzt: versioniertIn(KOPF) };
  return new Set(geaendert.filter((pfad) => nurGekuerzt(basis, pfad, dateistand)));
}
