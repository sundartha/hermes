import { parseArgs } from "node:util";

import {
  INTERNE_ROUTEN,
  WEBHOOKS,
  anbieter,
  bestaetigen,
  flaechen,
  intern,
  webhook,
  werkzeug,
  zustandLesen,
} from "./hermes-ctl/befehle.mjs";
import { starten, stoppen } from "./hermes-ctl/lebenszyklus.mjs";
import {
  ERSTES_ARGUMENT,
  EXIT_FEHLER,
  HermesCtlFehler,
  STANDARD_SITZUNG,
} from "./hermes-ctl/sitzung.mjs";
import { aufrufe } from "./hermes-ctl/zugriff.mjs";

const EXIT_OK = 0;
const EXIT_AUFRUF = 2;
const INTERN_NAMEN = [...INTERNE_ROUTEN.keys()].join("|");
const WEBHOOK_NAMEN = [...WEBHOOKS.keys()].join("|");
const WEBHOOK_AUFRUF = ["webhook <", WEBHOOK_NAMEN, "> '<json>' [--falsche-signatur]"].join("");

const hilfe = () => ({
  befehle: [
    {
      aufruf: "start [--sitzung <name>]",
      zweck: "Startet PGlite, Anbieter-Attrappen und Hermes als Hintergrundprozesse.",
    },
    { aufruf: "werkzeug <name> '<json>'", zweck: "Ruft ein MCP-Werkzeug im Legacy-Profil auf." },
    {
      aufruf: "bestaetigen '<json>'",
      zweck: "prepare_call und place_call mit dem Code aus _meta; gibt call_id aus.",
    },
    {
      aufruf: WEBHOOK_AUFRUF,
      zweck: "Sendet einen Anbieter-Webhook mit gültigem Token oder gültiger Ed25519-Signatur.",
    },
    {
      aufruf: 'anbieter elevenlabs-ende \'{"call_id"|"conversation_id":…}\'',
      zweck: "Lässt die ElevenLabs-Attrappe das Gespräch als beendet melden.",
    },
    {
      aufruf: "zustand <call_id> [--warten-auf <status>]",
      zweck: "Liest den Anruf über die lokale Route, wartet auf Wunsch auf einen Status.",
    },
    {
      aufruf: `intern <${INTERN_NAMEN}>`,
      zweck:
        "Ruft eine interne Route mit dem Bearer-Schlüssel der Sitzung auf; gibt Status und Antwort aus.",
    },
    {
      aufruf: "flaechen",
      zweck: "Werkzeuge, Routen und Webhooks wie node tools/katalog-pruefen.mjs --flaechen.",
    },
    {
      aufruf: "stopp [--sitzung <name>]",
      zweck: "Beendet alle Prozesse der Sitzung und löscht die Zustandsdatei.",
    },
    { aufruf: "hilfe", zweck: "Diese Liste." },
  ],
});

const BEFEHLE = new Map(
  Object.entries({
    start: starten,
    stopp: stoppen,
    werkzeug: (aufruf) =>
      werkzeug({ ...aufruf, argumente: [aufruf.argumente[0], jsonArgument(aufruf.argumente[1])] }),
    bestaetigen: (aufruf) =>
      bestaetigen({ ...aufruf, argumente: [jsonArgument(aufruf.argumente[0])] }),
    webhook: (aufruf) =>
      webhook({ ...aufruf, argumente: [aufruf.argumente[0], jsonArgument(aufruf.argumente[1])] }),
    anbieter: (aufruf) =>
      anbieter({ ...aufruf, argumente: [aufruf.argumente[0], jsonArgument(aufruf.argumente[1])] }),
    zustand: zustandLesen,
    intern,
    flaechen,
    hilfe,
  }),
);

function jsonArgument(text) {
  if (text === undefined) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HermesCtlFehler(
      `Kein gültiges JSON: ${text}`,
      "Übergib das Argument als JSON in einfachen Anführungszeichen.",
    );
  }
}

function aufrufLesen(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      sitzung: { type: "string", default: STANDARD_SITZUNG },
      "falsche-signatur": { type: "boolean", default: false },
      "warten-auf": { type: "string" },
    },
  });
  const [befehl = "hilfe", ...argumente] = positionals;
  return {
    befehl,
    aufruf: {
      sitzung: values.sitzung,
      argumente,
      falscheSignatur: values["falsche-signatur"],
      wartenAuf: values["warten-auf"],
    },
  };
}

function ausgeben(zeile) {
  process.stdout.write(`${JSON.stringify(zeile)}\n`);
}

async function hauptprogramm() {
  const beginn = performance.now();
  const dauer = () => Math.round(performance.now() - beginn);
  let befehl;
  try {
    const gelesen = aufrufLesen(process.argv.slice(ERSTES_ARGUMENT));
    befehl = gelesen.befehl;
    const ausfuehren = BEFEHLE.get(befehl);
    if (ausfuehren === undefined) {
      ausgeben({
        ok: false,
        befehl,
        ms: dauer(),
        fehler: `Unbekannter Befehl: ${befehl}`,
        tun: "Rufe „npm run hermes-ctl -- hilfe“ auf und nimm einen der Befehle.",
      });
      return EXIT_AUFRUF;
    }
    const ergebnis = await ausfuehren(gelesen.aufruf);
    ausgeben({ ok: true, befehl, ms: dauer(), ...ergebnis, aufrufe: aufrufe() });
    return EXIT_OK;
  } catch (fehler) {
    const tun =
      fehler instanceof HermesCtlFehler
        ? fehler.tun
        : "Prüfe den Aufruf mit „npm run hermes-ctl -- hilfe“.";
    ausgeben({ ok: false, befehl, ms: dauer(), fehler: fehler.message, tun, aufrufe: aufrufe() });
    return EXIT_FEHLER;
  }
}

process.exitCode = await hauptprogramm();
