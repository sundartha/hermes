export function gatewayUrlForPort(port) {
  return `http://localhost:${String(port)}`;
}

export function gatewayUrlMit({ umgebung, stripTrailingSlash, standardPort }) {
  let boundGatewayUrl = null;
  return {
    setBoundGatewayPort(port) {
      boundGatewayUrl = gatewayUrlForPort(port);
    },
    resolveGatewayUrl() {
      const konfiguriert = umgebung.GATEWAY_URL;
      if (konfiguriert) {
        return stripTrailingSlash(konfiguriert);
      }
      return stripTrailingSlash(boundGatewayUrl ?? gatewayUrlForPort(standardPort()));
    },
  };
}
