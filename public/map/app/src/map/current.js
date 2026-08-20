// Which continent the current page is showing, read from the URL path - the
// one thing every one of public/map/<mapId>/{index,static}.html shares by
// construction, so no page has to say its own id twice (once in its own
// path, once in a script it loads). "/map/sarducaa/index.html" -> "sarducaa".
//
// A path that does not look like /map/<id>/... has nothing to fall back to:
// this module is only ever loaded from inside one of those directories, by a
// published map's own index.html/static.html - see public/map/registry.js.
export function currentMapId() {
  const m = /\/map\/([^/]+)\//.exec(window.location.pathname);
  return m ? m[1] : null;
}
