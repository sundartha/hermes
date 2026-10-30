const SAFE_DUCK_TYPING_PROPS = new Set(["then", "toJSON"]);

export function guardedConfig(target, path = "config") {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "symbol" || prop in obj) {
        const value = Reflect.get(obj, prop, receiver);
        const isNestedGroup = value && typeof value === "object" && !Array.isArray(value);
        return isNestedGroup ? guardedConfig(value, `${path}.${String(prop)}`) : value;
      }
      if (SAFE_DUCK_TYPING_PROPS.has(prop)) return undefined;
      throw new TypeError(
        `${path}.${String(prop)} existiert nicht (verschobener/entfernter Config-Key? ` +
          "config.<namespace>.<key> nutzen - Gruppierung in src/config.js pruefen).",
      );
    },
    set(obj, prop, value) {
      if (typeof prop === "symbol" || prop in obj) return Reflect.set(obj, prop, value);
      throw new TypeError(
        `${path}.${String(prop)} kann nicht gesetzt werden (flache Oberflaeche entfernt; ` +
          "config.<namespace>.<key> nutzen).",
      );
    },
  });
}

function makeNamespaceGroup(keys, storage) {
  const group = {};
  for (const key of keys) {
    Object.defineProperty(group, key, {
      enumerable: true,
      get: () => storage[key],
      set: (value) => {
        Object.assign(storage, { [key]: value });
      },
    });
  }
  return group;
}

export function attachNamespaces(target, namespaces) {
  for (const [namespace, keys] of Object.entries(namespaces)) {
    Object.defineProperty(target, namespace, {
      enumerable: false,
      configurable: true,
      value: makeNamespaceGroup(keys, target),
    });
  }
}

export function buildNamespaceSurface(storage, namespaces) {
  const surface = {};
  for (const [namespace, keys] of Object.entries(namespaces)) {
    Object.defineProperty(surface, namespace, {
      enumerable: true,
      configurable: true,
      value: makeNamespaceGroup(keys, storage),
    });
  }
  return surface;
}
