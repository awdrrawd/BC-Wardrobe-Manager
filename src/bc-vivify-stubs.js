/**
 * Auto-vivifying proxies for BC dialog/menu structures that ECHO restraint
 * components deep-access at init (e.g. DialogMenuMapping.items.clickStatusCallbacks).
 * Any nested get returns another auto-vivifying proxy; sets are stored. This lets
 * ECHO's component setup run to completion (so ALL components, including clothing,
 * register) without throwing on BC menu internals we don't implement.
 * Loaded after the other stub files, before the ECHO extension.
 */
"use strict";
(function () {
  function autoVivify() {
    const target = function () {};
    return new Proxy(target, {
      get(t, p) {
        if (p === Symbol.toPrimitive) return () => "";
        if (p === Symbol.iterator) return undefined;
        if (p === "then") return undefined; // don't look thenable to await/Promise
        if (typeof p === "symbol") return undefined;
        if (!(p in t)) t[p] = autoVivify();
        return t[p];
      },
      set(t, p, v) { t[p] = v; return true; },
      apply() { return autoVivify(); },
      construct() { return autoVivify(); },
    });
  }
  // BC menu/dialog structures ECHO reaches into at registration time.
  const names = ["DialogMenuMapping", "DialogSelfMenuMapping"];
  for (const n of names) window[n] = autoVivify();
  window.__bcAutoVivify = autoVivify;
})();
