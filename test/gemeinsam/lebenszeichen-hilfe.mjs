import { startServer, waitUntil } from "../helpers.js";
import { starteAnbieterServer } from "./anbieter-attrappe.mjs";

const WARTE_FRIST_MS = 3000;
const LOG_VORSILBE = "[lebenszeichen]";

export const MELDE_TOKEN = "erfundenes-lebenszeichen-token";
export const MELDE_PFAD = `/api/v1/heartbeat/${MELDE_TOKEN}`;

export const antwortetMit = (status) => (antwort) => {
  antwort.writeHead(status);
  antwort.end();
};

export const antwortetNie = () => {};

export async function wirdWahr(bedingung) {
  try {
    await waitUntil(bedingung, { timeoutMs: WARTE_FRIST_MS });
    return true;
  } catch {
    return false;
  }
}

export function lebenszeichenZeilen(dienst) {
  return dienst.stdout.split("\n").filter((zeile) => zeile.includes(LOG_VORSILBE));
}

export async function mitLebenszeichenDienst(umgebung, pruefung) {
  const dienst = await startServer({ env: umgebung });
  try {
    await pruefung(dienst);
  } finally {
    await dienst.stop();
  }
}

function meldeZiel(attrappenUrl) {
  const adresse = `${attrappenUrl}${MELDE_PFAD}`;
  return { adresse, adressTeile: [adresse, new URL(attrappenUrl).host, MELDE_TOKEN] };
}

export async function mitEmpfaenger(antworte, pruefung) {
  const verbindungen = { abgebrochen: 0 };
  const attrappe = await starteAnbieterServer(({ req, res, vermerke }) => {
    vermerke({ pfad: req.url, zeitMs: performance.now() });
    res.once("close", () => {
      if (!res.writableFinished) verbindungen.abgebrochen += 1;
    });
    antworte(res);
  });
  try {
    await pruefung({ ...meldeZiel(attrappe.url), meldungen: attrappe.anfragen, verbindungen });
  } finally {
    await attrappe.close();
  }
}

export async function mitGemeldetemDienst({ antworte, umgebung }, pruefung) {
  await mitEmpfaenger(antworte, (empfaenger) =>
    mitLebenszeichenDienst({ HERZSCHLAG_URL: empfaenger.adresse, ...umgebung }, (dienst) =>
      pruefung(dienst, empfaenger),
    ),
  );
}

export async function unerreichbaresMeldeZiel() {
  const attrappe = await starteAnbieterServer(() => {});
  await attrappe.close();
  return meldeZiel(attrappe.url);
}
