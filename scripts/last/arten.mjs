export const ART_KURZ = "kurz";

const ABLAUF = "anruf";
const GLEICHZEITIGE_ANRUFE = 20;
const SPITZE_ANRUFE = 40;
const AUSLAUF = "120s";

const ARTEN = Object.freeze({
  last: { executor: "constant-vus", vus: GLEICHZEITIGE_ANRUFE, duration: "10m", gracefulStop: AUSLAUF },
  spitze: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "30s", target: SPITZE_ANRUFE },
      { duration: "2m", target: SPITZE_ANRUFE },
      { duration: "30s", target: 0 },
    ],
    gracefulRampDown: AUSLAUF,
    gracefulStop: AUSLAUF,
  },
  dauer: { executor: "constant-vus", vus: GLEICHZEITIGE_ANRUFE, duration: "60m", gracefulStop: AUSLAUF },
});

export function waehleArt(art) {
  const name = art === undefined || art === "" ? ART_KURZ : art;
  if (name !== ART_KURZ && !Object.hasOwn(ARTEN, name)) throw new Error("Staging-Lastlauf abgebrochen: art_unbekannt");
  return name;
}

export function szenarienFuerArt(basis, art) {
  if (waehleArt(art) === ART_KURZ) return basis;
  return { ...basis, [ABLAUF]: { ...ARTEN[art], exec: ABLAUF } };
}
