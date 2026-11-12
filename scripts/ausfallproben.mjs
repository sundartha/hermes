import { env } from "node:process";
import { postgresNeustart } from "./ausfallproben/proben/postgres-neustart.mjs";
import { instanzTod } from "./ausfallproben/proben/instanz-tod.mjs";
import { anbieterStoerung } from "./ausfallproben/proben/anbieter-stoerung.mjs";
import { deployBeiAnruf } from "./ausfallproben/proben/deploy-bei-anruf.mjs";
import { GESAMT_FRIST_MS, SCHWELLEN } from "./ausfallproben/schwellen.mjs";
import { leseAufruf } from "./ausfallproben/ziel.mjs";

const PROBEN = {
  ...Object.fromEntries(
    ["elevenlabs-aus", "elevenlabs-langsam"].map((name) => [
      name,
      (kontext) => anbieterStoerung(kontext, SCHWELLEN[name]),
    ]),
  ),
  "postgres-neustart": (kontext) => postgresNeustart(kontext, SCHWELLEN["postgres-neustart"]),
  "instanz-tod": (kontext) => instanzTod(kontext, SCHWELLEN["instanz-tod"]),
  "deploy-bei-anruf": (kontext) => deployBeiAnruf(kontext, SCHWELLEN["deploy-bei-anruf"]),
};
const ALLE = "alle";
const EINZELPROBEN = Object.keys(PROBEN);
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
    postgresUrl: umgebung.HERMES_TEST_POSTGRES_URL || "",
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

async function meldeEinzelprobe(probe, umgebung) {
  const { kindAusgabeVoll, ...ergebnis } = await laufe(probe, kontextAusUmgebung(umgebung));
  console.log(JSON.stringify({ probe, ...ergebnis }));
  for (const zeile of (kindAusgabeVoll ?? "").trimEnd().split("\n").filter(Boolean))
    console.error(`kind> ${zeile}`);
  return { probe, ergebnis: ergebnis.ergebnis };
}

async function laufeAlle(umgebung) {
  const proben = [];
  for (const probe of EINZELPROBEN) proben.push(await meldeEinzelprobe(probe, umgebung));
  const rote = proben.filter((eintrag) => eintrag.ergebnis !== "gruen");
  const ergebnis = rote.length === 0 ? "gruen" : "rot";
  const grund =
    rote.length === 0
      ? "alle Proben gruen"
      : `rote Proben: ${rote.map((eintrag) => eintrag.probe).join(", ")}`;
  console.log(JSON.stringify({ probe: ALLE, ergebnis, grund, proben }));
  return ergebnis;
}

const aufruf = leseAufruf(process.argv.slice(ARGUMENTE_AB), [...EINZELPROBEN, ALLE]);
if (aufruf.fehler) {
  console.error(`Aufruf abgelehnt: ${aufruf.fehler}`);
  process.exit(EXIT_AUFRUF);
}
const gesamt =
  aufruf.probe === ALLE
    ? await laufeAlle(env)
    : (await meldeEinzelprobe(aufruf.probe, env)).ergebnis;
process.exit(gesamt === "gruen" ? EXIT_GRUEN : EXIT_ROT);
