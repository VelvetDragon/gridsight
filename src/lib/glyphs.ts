/**
 * Map glyphs as tintable SVG icons (deck.gl IconLayer, mask mode): stations as
 * small squares (hollow once built), and a chevron showing a line's direction
 * of build (from its first place to its last).
 */
function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const S = 48;

export const ICON_STATION = {
  id: "station",
  url: svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><rect x="7" y="7" width="34" height="34" rx="3" fill="#000"/></svg>`,
  ),
  width: S,
  height: S,
  mask: true,
};

export const ICON_STATION_HOLLOW = {
  id: "station-hollow",
  url: svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><rect x="10" y="10" width="28" height="28" rx="2" fill="none" stroke="#000" stroke-width="7"/></svg>`,
  ),
  width: S,
  height: S,
  mask: true,
};

/** A paper-coloured square drawn under stations so they read on any background. */
export const ICON_STATION_HALO = {
  id: "station-halo",
  url: svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><rect x="2" y="2" width="44" height="44" rx="5" fill="#000"/></svg>`,
  ),
  width: S,
  height: S,
  mask: true,
};

/** Points right (east) at angle 0; rotate with the line's bearing. */
export const ICON_CHEVRON = {
  id: "chevron",
  url: svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><path d="M14 10 L34 24 L14 38" fill="none" stroke="#000" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  ),
  width: S,
  height: S,
  mask: true,
};
