/** Small drawn illustrations for the Switchboard choices (pure SVG, survey-map style). */

const INK = "#15181E";
const TEAL = "#0E7C7B";
const ORANGE = "#C2410C";
const RIVER = "#3B82C4";

export function CrosswireArt() {
  return (
    <svg viewBox="0 0 320 180" className="h-full w-full" aria-hidden>
      <defs>
        <pattern id="sw-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
          <line x1="0" y1="0" x2="0" y2="6" stroke={INK} strokeOpacity="0.35" strokeWidth="1" />
        </pattern>
      </defs>
      <path
        d="M150 -5 C140 40 175 80 152 120 S140 170 160 190"
        fill="none"
        stroke={RIVER}
        strokeOpacity="0.2"
        strokeWidth="12"
      />
      <path
        d="M150 -5 C140 40 175 80 152 120 S140 170 160 190"
        fill="none"
        stroke={RIVER}
        strokeOpacity="0.65"
        strokeWidth="1.3"
      />
      <path
        d="M128 78 C140 66 164 64 178 74 C190 84 190 102 176 110 C160 120 138 116 128 104 C120 96 120 86 128 78 Z"
        fill="url(#sw-hatch)"
        stroke={INK}
        strokeOpacity="0.55"
        strokeWidth="1.1"
      />
      <path d="M20 150 C60 124 100 104 150 92" fill="none" stroke={ORANGE} strokeWidth="3.2" strokeLinecap="round" />
      <path
        d="M300 30 C262 52 214 74 166 92"
        fill="none"
        stroke={TEAL}
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeDasharray="9 5"
      />
      <rect x="13" y="143" width="12" height="12" fill={ORANGE} stroke="#fff" strokeWidth="2" />
      <rect x="294" y="23" width="12" height="12" fill={TEAL} stroke="#fff" strokeWidth="2" />
      {[
        [58, 128],
        [98, 108],
      ].map(([x, y]) => (
        <g key={x} stroke={ORANGE} strokeWidth="1.3" strokeLinecap="round">
          <line x1={x} y1={y - 8} x2={x} y2={y + 5} />
          <line x1={x - 4} y1={y - 4} x2={x + 4} y2={y - 4} />
        </g>
      ))}
    </svg>
  );
}

export function StormlineArt() {
  return (
    <svg viewBox="0 0 320 180" className="h-full w-full" aria-hidden>
      <path
        d="M40 170 C70 130 90 110 130 96 S200 60 240 20"
        fill="none"
        stroke="#334155"
        strokeWidth="2"
        strokeDasharray="3 4"
      />
      <circle cx="130" cy="96" r="54" fill="none" stroke="#B42318" strokeOpacity="0.5" strokeWidth="1.2" />
      <g transform="translate(130 96)">
        <path
          d="M0 -14 C10 -14 14 -6 8 0 C2 6 -10 4 -12 -4"
          fill="none"
          stroke="#334155"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M0 14 C-10 14 -14 6 -8 0 C-2 -6 10 -4 12 4"
          fill="none"
          stroke="#334155"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle r="3" fill="#B42318" />
      </g>
      <path d="M20 60 C80 70 180 80 300 140" fill="none" stroke="#D08C2B" strokeWidth="3" strokeLinecap="round" />
      <path d="M150 72 C180 86 210 102 240 118" fill="none" stroke="#A1261B" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M40 120 C90 118 150 130 200 150" fill="none" stroke="#E2C27E" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function LedgerArt() {
  const rows = [0, 1, 2, 3, 4];
  return (
    <svg viewBox="0 0 320 180" className="h-full w-full" aria-hidden>
      <rect
        x="54"
        y="18"
        width="212"
        height="148"
        rx="6"
        fill="#FFFFFF"
        fillOpacity="0.7"
        stroke={INK}
        strokeOpacity="0.25"
      />
      <line x1="54" y1="44" x2="266" y2="44" stroke={INK} strokeOpacity="0.3" />
      <line x1="104" y1="18" x2="104" y2="166" stroke="#B42318" strokeOpacity="0.35" />
      {rows.map((r) => (
        <g key={r}>
          <line x1="54" y1={66 + r * 22} x2="266" y2={66 + r * 22} stroke={INK} strokeOpacity="0.1" />
          <rect x="66" y={51 + r * 22} width="8" height="8" rx="1.5" fill="none" stroke={INK} strokeOpacity="0.5" />
          {r === 1 || r === 3 ? (
            <path d={`M67 ${55 + r * 22} l2.5 2.5 l4 -5`} fill="none" stroke={INK} strokeWidth="1.4" />
          ) : null}
          <line
            x1="114"
            y1={56 + r * 22}
            x2={170 + ((r * 37) % 60)}
            y2={56 + r * 22}
            stroke={INK}
            strokeOpacity="0.45"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="240" cy={56 + r * 22} r="3" fill={r % 2 ? ORANGE : TEAL} />
        </g>
      ))}
      <path
        d="M232 150 l10 10 l18 -26"
        fill="none"
        stroke={TEAL}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
