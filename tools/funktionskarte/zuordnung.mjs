import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const OFFEN_PFAD = "tools/basis/funktionskarte-offen.json";
const COMMIT = "commit";
const VORNE = (links, rechts) => links.localeCompare(rechts, "en");

function offenLesen(wurzel) {
  const pfad = join(wurzel, OFFEN_PFAD);
  return existsSync(pfad) ? JSON.parse(readFileSync(pfad, "utf8")) : [];
}

function offenAnDerBasis(wurzel, basis) {
  if (basis === undefined) return undefined;
  const art = spawnSync("git", ["cat-file", "-t", basis], { cwd: wurzel, encoding: "utf8" });
  if (art.stdout.trim() !== COMMIT) {
    throw new Error(`Die Basis ${basis} ist kein Commit in diesem Checkout.`);
  }
  const gezeigt = spawnSync("git", ["show", `${basis}:${OFFEN_PFAD}`], {
    cwd: wurzel,
    encoding: "utf8",
  });
  return gezeigt.status === 0 ? new Set(JSON.parse(gezeigt.stdout)) : undefined;
}

function listenFehler(offen, basisOffen) {
  const fehler = [];
  const geordnet = [...new Set(offen)].sort(VORNE);
  if (JSON.stringify(geordnet) !== JSON.stringify(offen)) {
    fehler.push(`${OFFEN_PFAD}: eine Fläche je Eintrag, sortiert, ohne Doppelte.`);
  }
  if (basisOffen === undefined) return fehler;
  const neu = offen.filter((flaeche) => !basisOffen.has(flaeche));
  return [
    ...fehler,
    ...neu.map(
      (flaeche) =>
        `${OFFEN_PFAD}: ${flaeche} ist neu; die Liste darf nur kürzer werden, schreibe eine Karte.`,
    ),
  ];
}

function zustaendigkeit(karten) {
  const zustaendig = new Map();
  const fehler = [];
  for (const { pfad, rezept } of karten) {
    for (const flaeche of rezept.flaechen) {
      if (zustaendig.has(flaeche)) {
        fehler.push(
          `${pfad}: ${flaeche} steht schon in ${zustaendig.get(flaeche)}; genau eine Karte je Fläche.`,
        );
      } else {
        zustaendig.set(flaeche, pfad);
      }
    }
  }
  return { zustaendig, fehler };
}

function unbekannteFlaechen(zustaendig, bekannt) {
  return [...zustaendig]
    .filter(([flaeche]) => !bekannt.has(flaeche))
    .map(([flaeche, pfad]) => `${pfad}: nennt ${flaeche}, das Hermes nicht registriert.`);
}

function veralteteEintraege(offen, bekannt) {
  return offen
    .filter((flaeche) => !bekannt.has(flaeche))
    .map((flaeche) => `${OFFEN_PFAD}: ${flaeche} gibt es nicht mehr; streiche den Eintrag.`);
}

function eintraegeMitKarte(offen, zustaendig) {
  return offen
    .filter((flaeche) => zustaendig.has(flaeche))
    .map(
      (flaeche) =>
        `${OFFEN_PFAD}: ${flaeche} hat jetzt eine Karte (${zustaendig.get(flaeche)}); streiche den Eintrag.`,
    );
}

function flaechenOhneKarte(bekannt, zustaendig, offen) {
  const offenSet = new Set(offen);
  return [...bekannt]
    .filter((flaeche) => !zustaendig.has(flaeche) && !offenSet.has(flaeche))
    .map((flaeche) => `${flaeche} hat keine Funktionskarte unter docs/funktionen/.`);
}

export function zuordnungPruefen({ wurzel, karten, flaechen, basis }) {
  const offen = offenLesen(wurzel);
  const bekannt = new Set(flaechen.map(({ flaeche }) => flaeche));
  const formFehler = karten.flatMap(({ pfad, fehler }) => fehler.map((text) => `${pfad}: ${text}`));
  const lesbar = karten.filter(
    ({ rezept }) => rezept !== undefined && Array.isArray(rezept.flaechen),
  );
  const { zustaendig, fehler } = zustaendigkeit(lesbar);
  return [
    ...formFehler,
    ...fehler,
    ...listenFehler(offen, offenAnDerBasis(wurzel, basis)),
    ...unbekannteFlaechen(zustaendig, bekannt),
    ...veralteteEintraege(offen, bekannt),
    ...eintraegeMitKarte(offen, zustaendig),
    ...flaechenOhneKarte(bekannt, zustaendig, offen),
  ];
}
