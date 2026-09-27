/** The four places in Mr.Gridy, in keyboard-shortcut order (1–4). */
export const NAV = [
  {
    href: "/home",
    name: "Switchboard",
    tagline: "What do you want to do?",
  },
  {
    href: "/compare",
    name: "Crosswire",
    tagline: "Where two utilities' plans cross, on the map and on the calendar.",
  },
  {
    href: "/storm",
    name: "Stormline",
    tagline: "Where the next storm meets both grids.",
  },
  {
    href: "/data",
    name: "The Ledger",
    tagline: "Every project, overlap and source. Export to Excel.",
  },
] as const;

export type NavItem = (typeof NAV)[number];
