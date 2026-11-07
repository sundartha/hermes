import { starteAttrappe } from "./attrappen-server.js";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_SERVER_ERROR = 500;
const VERSAND_PFAD = "/v3/smtp/email";
const BREVO_ADRESSE = "https://api.brevo.com";
const API_SCHLUESSEL = "mail-attrappe-schluessel";
const ABSENDER = "hermes@mail-attrappe.invalid";

function umleitungNachBrevo(ziel) {
  return [
    "const echt = globalThis.fetch;",
    `globalThis.fetch = (url, optionen) => echt(String(url).replace(${JSON.stringify(BREVO_ADRESSE)}, ${JSON.stringify(ziel)}), optionen);`,
  ].join("\n");
}

function antworte(res, status) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end("{}");
}

export async function starteMailAttrappe() {
  const angekommen = [];
  let versuche = 0;
  let abzulehnen = 0;
  const attrappe = await starteAttrappe((req, res) => {
    let roh = "";
    req.on("data", (stueck) => (roh += stueck));
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== VERSAND_PFAD) return antworte(res, HTTP_OK);
      versuche += 1;
      if (abzulehnen > 0) {
        abzulehnen -= 1;
        return antworte(res, HTTP_SERVER_ERROR);
      }
      const mail = JSON.parse(roh);
      angekommen.push({ an: mail.to[0].email, betreff: mail.subject, text: mail.textContent });
      return antworte(res, HTTP_CREATED);
    });
  });
  return {
    umgebung: {
      BREVO_API_KEY: API_SCHLUESSEL,
      MAIL_FROM: ABSENDER,
      NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(umleitungNachBrevo(attrappe.url))}`,
    },
    lehneNaechsteAb: (anzahl = 1) => {
      abzulehnen = anzahl;
    },
    versuche: () => versuche,
    an: (adresse) => angekommen.filter((mail) => mail.an === adresse),
    schliessen: attrappe.close,
  };
}
