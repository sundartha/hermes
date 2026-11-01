import { withFetch } from "../helpers.js";

const HTTP_OK = 200;

export async function gesendeteAnfrage(antwortBody, run) {
  const urls = [];
  const antwort = (url) => {
    urls.push(new URL(url));
    return Promise.resolve({
      ok: true,
      status: HTTP_OK,
      json: async () => antwortBody,
      text: async () => JSON.stringify(antwortBody),
    });
  };
  const ergebnis = await withFetch(antwort, run);
  return { ergebnis, urls };
}
