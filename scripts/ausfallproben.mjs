import { env } from "node:process";
import { anbieterStoerung } from "./ausfallproben/proben/anbieter-stoerung.mjs";
import { GESAMT_FRIST_MS, SCHWELLEN } from "./ausfallproben/schwellen.mjs";
import { leseAufruf } from "./ausfallproben/ziel.mjs";

const PROBEN = Object.fromEntries(
  ["elevenlabs-aus", "elevenlabs-langsam"].map((name) => [
    name,
    (kontext) => anbieterStoerung(kontext, SCHWELLEN[name]),
  ]),
);
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_AUFRUF = 2;
const ARGUMENTE_AB = 2;

function frist() {
  return new Promise((resolve) => {
    setTimeout(
      () =>
        resolve({
          ergebnis: "rot",
          schwelle: null,
          gemessen: null,
          grund: "Zeitueberschreitung der Probe",
        }),
      GESAMT_FRIST_MS,
    ).unref();
  });
}

function kontextAusUmgebung(umgebung) {
  return {
    aufraeumer: [],
    messVerzugMs: Number(umgebung.AUSFALLPROBE_MESSWEICHE_VERZUG_MS) || 0,
    ohneSaat: umgebung.AUSFALLPROBE_OHNE_SAAT === "1",
  };
}

async function laufe(probe, kontext) {
  try {
    return await Promise.race([PROBEN[probe](kontext), frist()]);
  } catch (fehler) {
    return {
      ergebnis: "rot",
      schwelle: null,
      gemessen: null,
      grund: `Probe gescheitert: ${fehler.name}`,
    };
  } finally {
    for (const raeume of kontext.aufraeumer.reverse())
      await Promise.resolve(raeume()).catch(() => {});
  }
}

const aufruf = leseAufruf(process.argv.slice(ARGUMENTE_AB), Object.keys(PROBEN));
if (aufruf.fehler) {
  console.error(`Aufruf abgelehnt: ${aufruf.fehler}`);
  process.exit(EXIT_AUFRUF);
}
const ergebnis = await laufe(aufruf.probe, kontextAusUmgebung(env));
console.log(JSON.stringify({ probe: aufruf.probe, ...ergebnis }));
process.exit(ergebnis.ergebnis === "gruen" ? EXIT_GRUEN : EXIT_ROT);
