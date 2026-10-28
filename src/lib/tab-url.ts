// A page's open tab kept in its URL (?tab=<key>), so a refresh or a shared
// link opens the same tab. Used by the opportunity page and the client page.
// No React and no database imports.

export const TAB_PARAM = "tab"

// The tab the URL asks for, when it is one of keys (the tabs this user can
// see); otherwise the default
export function readTabParam<K extends string>(params: { get(name: string): string | null }, keys: readonly K[], fallback: K): K {
  const asked = params.get(TAB_PARAM)
  return keys.find((k) => k === asked) ?? fallback
}

// The page's URL with a tab chosen. Other parameters are kept, except the
// ones listed in drop (parameters that only mean something when a link
// lands, such as a row to highlight). The default tab leaves the parameter
// out.
export function tabHref<K extends string>(pathname: string, search: string, key: K, fallback: K, drop: readonly string[] = []): string {
  const params = new URLSearchParams(search)
  for (const name of drop) params.delete(name)
  if (key === fallback) params.delete(TAB_PARAM)
  else params.set(TAB_PARAM, key)
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}
