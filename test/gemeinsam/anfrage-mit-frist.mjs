import http from "node:http";
import { mitAntwortfrist } from "./antwortfrist.mjs";

export default function anfrageMitFrist(optionen, antwort, wartezeit) {
  return mitAntwortfrist(http.request(optionen, antwort), wartezeit);
}
