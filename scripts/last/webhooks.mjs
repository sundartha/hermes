import crypto from "node:crypto";

export const WEBHOOKS_JE_LAUF = 200;

export function baueWebhooks(signer, anzahl, zeitpunktS) {
  return Array.from({ length: anzahl }, (leer, nummer) => {
    const koerper = new URLSearchParams({ CallSid: `CAlast${nummer}`, CallStatus: "ringing" }).toString();
    const zeit = String(zeitpunktS);
    return {
      koerper,
      kopf: { "telnyx-signature-ed25519": signer.sign(zeit, koerper), "telnyx-timestamp": zeit },
    };
  });
}

function signerMit(schluessel) {
  return {
    sign: (zeit, koerper) => crypto.sign(null, Buffer.from(`${zeit}|${koerper}`), schluessel).toString("base64"),
  };
}

export function signerAusPem(pem) {
  return signerMit(crypto.createPrivateKey(pem));
}

export function fremderSigner() {
  return signerMit(crypto.generateKeyPairSync("ed25519").privateKey);
}
