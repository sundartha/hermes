export function gatewayUrlForPort(port) {
  return `http://localhost:${port}`;
}

export function gatewayUrlMit({ umgebung, stripTrailingSlash, standardPort }) {
  let boundGatewayUrl = null;
  return {
    setBoundGatewayPort(port) {
      boundGatewayUrl = gatewayUrlForPort(port);
    },
    resolveGatewayUrl() {
      return stripTrailingSlash(
        umgebung.GATEWAY_URL || boundGatewayUrl || gatewayUrlForPort(standardPort()),
      );
    },
  };
}
