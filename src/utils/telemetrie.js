import { MS_PER_MINUTE } from "./timer.js";

const ANFRAGE_DAUER_NAME = "hermes.http.server.duration";
const ANBIETER_AUFRUFE_NAME = "hermes.anbieter.aufrufe";
const ANBIETER_DAUER_NAME = "hermes.anbieter.dauer";
const DAUER_GRENZEN_MS = Object.freeze({
  blitz: 10,
  sehrSchnell: 50,
  schnell: 100,
  normal: 250,
  spuerbar: 500,
  langsam: 1000,
  sehrLangsam: 2500,
  nahAmAbbruch: 10_000,
});
const EXPORT_INTERVALL_MS = MS_PER_MINUTE;
const EXPORT_FRIST_MS = 5000;
const METRIKEN_PFAD = "/v1/metrics";
const DIENST_NAME = "hermes";
const UNBEKANNT = "unbekannt";
const ANDERE = "andere";
const ERLAUBTE_METHODEN = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const STATUS_KLASSEN_ANZAHL = 6;
const STATUS_KLASSE_STELLE = 100;
export const NANOSEKUNDEN_JE_MS = 1_000_000;

export const KEINE_TELEMETRIE = Object.freeze({
  aktiv: false,
  messeAnfrage() {},
  messeAnbieter() {},
  async spuele() {},
  async stoppe() {},
});

let laufendeTelemetrie = KEINE_TELEMETRIE;

export const anbieterMesser = Object.freeze({
  messeAnbieter: (aufruf) => laufendeTelemetrie.messeAnbieter(aufruf),
});

function routenMuster(req) {
  const pfad = req.route?.path;
  return typeof pfad === "string" ? pfad : UNBEKANNT;
}

function statusKlasse(code) {
  const stelle = Math.floor(code / STATUS_KLASSE_STELLE);
  return stelle >= 1 && stelle < STATUS_KLASSEN_ANZAHL ? `${stelle}xx` : ANDERE;
}

function anfrageLabels({ route, method, status }) {
  return {
    route,
    method: ERLAUBTE_METHODEN.has(method) ? method : ANDERE,
    status_class: statusKlasse(status),
  };
}

export function anfrageMessung(telemetrie) {
  return function anfrageMessungMiddleware(req, res, next) {
    if (!telemetrie.aktiv) return next();
    const beginn = process.hrtime.bigint();
    res.once("close", () => {
      const dauerMs = Number(process.hrtime.bigint() - beginn) / NANOSEKUNDEN_JE_MS;
      telemetrie.messeAnfrage({ route: routenMuster(req), method: req.method, status: res.statusCode, dauerMs });
    });
    next();
  };
}

function basicAnmeldung(benutzer, token) {
  return `Basic ${Buffer.from(`${benutzer}:${token}`).toString("base64")}`;
}

async function otlpAusfuehrer({ url, benutzer, token }) {
  const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
  return new OTLPMetricExporter({
    url: `${url.replace(/\/+$/, "")}${METRIKEN_PFAD}`,
    headers: { Authorization: basicAnmeldung(benutzer, token) },
    timeoutMillis: EXPORT_FRIST_MS,
  });
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

function sichereAdresse(text) {
  let adresse;
  try {
    adresse = new URL(text);
  } catch {
    return false;
  }
  if (adresse.username || adresse.password) return false;
  if (adresse.protocol === "https:") return true;
  return adresse.protocol === "http:" && LOOPBACK_HOSTS.has(adresse.hostname);
}

function otlpKonfiguriert({ url, token }) {
  return typeof url === "string" && sichereAdresse(url) && Boolean(token);
}

export async function starteTelemetrie({
  url = "",
  benutzer = "",
  token = "",
  instanzKennung,
  version = "",
  intervallMs = EXPORT_INTERVALL_MS,
} = {}) {
  if (!otlpKonfiguriert({ url, token })) return KEINE_TELEMETRIE;
  const [{ MeterProvider, PeriodicExportingMetricReader }, { resourceFromAttributes }] = await Promise.all([
    import("@opentelemetry/sdk-metrics"),
    import("@opentelemetry/resources"),
  ]);
  const leser = new PeriodicExportingMetricReader({
    exporter: await otlpAusfuehrer({ url, benutzer, token }),
    exportIntervalMillis: intervallMs,
    exportTimeoutMillis: Math.min(EXPORT_FRIST_MS, intervallMs),
  });
  const anbieter = new MeterProvider({
    readers: [leser],
    resource: resourceFromAttributes({
      "service.name": DIENST_NAME,
      "service.instance.id": instanzKennung,
      "service.version": version,
    }),
  });
  const messer = anbieter.getMeter(DIENST_NAME);
  const histogramm = (name) =>
    messer.createHistogram(name, {
      unit: "ms",
      advice: { explicitBucketBoundaries: Object.values(DAUER_GRENZEN_MS) },
    });
  const dauer = histogramm(ANFRAGE_DAUER_NAME);
  const anbieterDauer = histogramm(ANBIETER_DAUER_NAME);
  const anbieterAufrufe = messer.createCounter(ANBIETER_AUFRUFE_NAME);
  const telemetrie = {
    aktiv: true,
    meter: messer,
    messeAnfrage(anfrage) {
      dauer.record(anfrage.dauerMs, anfrageLabels(anfrage));
    },
    messeAnbieter({ anbieter: name, vorgang, ergebnis, dauerMs }) {
      anbieterAufrufe.add(1, { anbieter: name, vorgang, ergebnis });
      anbieterDauer.record(dauerMs, { anbieter: name, vorgang });
    },
    spuele: () => anbieter.forceFlush(),
    async stoppe() {
      if (laufendeTelemetrie === telemetrie) laufendeTelemetrie = KEINE_TELEMETRIE;
      await anbieter.shutdown();
    },
  };
  laufendeTelemetrie = telemetrie;
  return telemetrie;
}
