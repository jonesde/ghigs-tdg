// The document URL at the moment this module is first evaluated. main.ts imports
// it for that evaluation, which is before Vue Router's initial navigation.
// Later path-only navigations (router.push("/game"), the /game guard's
// next("/map-select")) drop the search string before SvgGameRoot is created.
export function perfRequested(search: string): boolean {
  return new URLSearchParams(search).get("perf") === "1";
}

export const perfEnabled = import.meta.env.DEV && perfRequested(window.location.search);
