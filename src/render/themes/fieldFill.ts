/**
 * Extracts a tile's field fill — the flat full-bleed rect painted first. Shipped
 * theme art follows a first-fill invariant: the first hex fill in a tile is that
 * rect, so this stays a simple first-match parse. Callers pass a tile string,
 * wrapper included; the fill search does not care.
 */
export function fieldFillOf(tileContent: string): string | null {
  const match = tileContent.match(/fill="(#[0-9a-fA-F]{3,8})"/);
  const fillColor = match?.[1];
  return fillColor ?? null;
}

/**
 * Parses a 3- or 6-digit hex color into its three channels. Alpha forms (#rgba,
 * #rrggbbaa) and anything unparseable return null so callers can fall back
 * instead of painting an invalid value.
 */
export function hexChannels(color: string): [number, number, number] | null {
  const hexDigits = color.trim().replace(/^#/, "");
  const expanded = hexDigits.length === 3 ? hexDigits.replace(/./g, (digit) => digit + digit) : hexDigits;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  return [red, green, blue];
}
