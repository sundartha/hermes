import { afterEach } from "node:test";

export const EINGANG_URL = "https://eingang.example.test/geheimer-eingang-q7x9";

const echtesFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = echtesFetch;
});

export function fangeVorfaelle({ status = 200 } = {}) {
  const vorfaelle = [];
  globalThis.fetch = async (adresse, anfrage) => {
    const koerper = JSON.parse(anfrage.body);
    vorfaelle.push({ adresse, id: koerper.incident.id, status: koerper.incident.status, text: koerper.text });
    return new Response(null, { status });
  };
  return vorfaelle;
}
