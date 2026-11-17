import http from "node:http";
import { mitAntwortfrist } from "./antwortfrist.mjs";

const KOERPER = "SpeechResult=Hallo";
const ERSTER_TEIL = KOERPER.slice(0, 5);
const REST = KOERPER.slice(5);

export function haengendeAnfrage(srv, anruf = "call_haengend") {
  const anfrage = mitAntwortfrist(
    http.request(`${srv.localUrl}/voice/turn?callId=${anruf}`, {
      method: "POST",
      agent: false,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(KOERPER.length),
      },
    }),
  );
  const ausgang = new Promise((fertig) => {
    anfrage.on("response", (antwort) => {
      antwort.resume();
      antwort.on("end", () => fertig("beantwortet"));
    });
    anfrage.on("error", () => fertig("abgebrochen"));
  });
  anfrage.write(ERSTER_TEIL);
  return { ausgang, vervollstaendige: () => anfrage.end(REST) };
}
