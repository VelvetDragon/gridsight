/**
 * A drawn, survey-map style illustration: a river border, two service areas,
 * planned lines with towers, stations as small squares, and a hatched shared
 * corridor where the two plans meet. Pure SVG, no data.
 */
export function GridIllustration({ className }: { className?: string }) {
  const towers: [number, number][] = [
    [96, 452],
    [150, 402],
    [206, 360],
    [262, 330],
  ];
  const towersB: [number, number][] = [
    [468, 180],
    [430, 238],
    [396, 292],
    [360, 340],
  ];
  return (
    <svg
      viewBox="0 0 560 620"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      role="img"
      aria-label="Drawing of two utilities' planned lines meeting across a river"
    >
      <defs>
        <pattern id="gi-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="#15181E" strokeOpacity="0.32" strokeWidth="1.1" />
        </pattern>
        <pattern id="gi-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="#15181E" strokeOpacity="0.05" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="560" height="620" fill="#F2EEE6" />
      <rect width="560" height="620" fill="url(#gi-grid)" />
      {/* Two service areas either side of the river. */}
      <path
        d="M0 0 H300 C290 90 330 150 300 230 S250 360 290 450 S260 560 280 620 H0 Z"
        fill="#C2410C"
        opacity="0.07"
      />
      <path
        d="M300 0 H560 V620 H280 C260 560 290 450 290 450 S250 360 300 230 S290 90 300 0 Z"
        fill="#0E7C7B"
        opacity="0.08"
      />
      {/* River. */}
      <path
        d="M300 -4 C290 90 330 150 300 230 S250 360 290 450 S260 560 280 624"
        fill="none"
        stroke="#3B82C4"
        strokeOpacity="0.22"
        strokeWidth="16"
        strokeLinecap="round"
      />
      <path
        d="M300 -4 C290 90 330 150 300 230 S250 360 290 450 S260 560 280 624"
        fill="none"
        stroke="#3B82C4"
        strokeOpacity="0.7"
        strokeWidth="1.6"
      />
      {/* Contour-like context lines. */}
      <path d="M20 130 C120 110 180 160 250 120" fill="none" stroke="#15181E" strokeOpacity="0.12" />
      <path d="M340 520 C400 480 470 530 540 500" fill="none" stroke="#15181E" strokeOpacity="0.12" />
      <path d="M40 560 C110 520 170 580 240 540" fill="none" stroke="#15181E" strokeOpacity="0.1" />
      {/* Shared corridor where the plans meet. */}
      <path
        d="M246 318 C268 300 300 296 322 312 C338 324 352 348 338 364 C320 384 282 382 258 368 C238 356 232 330 246 318 Z"
        fill="url(#gi-hatch)"
        stroke="#15181E"
        strokeOpacity="0.55"
        strokeWidth="1.2"
        strokeDasharray="1 0"
      />
      {/* Georgia-side planned line with towers. */}
      <path
        d="M70 480 C110 440 150 400 200 364 S250 330 268 326"
        fill="none"
        stroke="#FAF8F4"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        d="M70 480 C110 440 150 400 200 364 S250 330 268 326"
        fill="none"
        stroke="#C2410C"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      {towers.map(([x, y]) => (
        <g key={`${x}-${y}`} stroke="#C2410C" strokeWidth="1.4" strokeLinecap="round">
          <line x1={x} y1={y - 9} x2={x} y2={y + 6} />
          <line x1={x - 5} y1={y - 5} x2={x + 5} y2={y - 5} />
        </g>
      ))}
      {/* South Carolina-side planned line. */}
      <path
        d="M500 140 C470 190 430 240 396 292 S350 350 332 360"
        fill="none"
        stroke="#FAF8F4"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        d="M500 140 C470 190 430 240 396 292 S350 350 332 360"
        fill="none"
        stroke="#0E7C7B"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeDasharray="10 6"
      />
      {towersB.map(([x, y]) => (
        <g key={`${x}-${y}`} stroke="#0E7C7B" strokeWidth="1.4" strokeLinecap="round">
          <line x1={x} y1={y - 9} x2={x} y2={y + 6} />
          <line x1={x - 5} y1={y - 5} x2={x + 5} y2={y - 5} />
        </g>
      ))}
      {/* Stations as small squares. */}
      <rect x="62" y="472" width="14" height="14" fill="#C2410C" stroke="#fff" strokeWidth="2" />
      <rect x="493" y="132" width="14" height="14" fill="#0E7C7B" stroke="#fff" strokeWidth="2" />
      <rect x="420" y="430" width="12" height="12" fill="none" stroke="#0E7C7B" strokeWidth="2" />
      {/* The current running along the shared stretch. */}
      <path
        className="gs-current"
        d="M70 480 C110 440 150 400 200 364 S250 330 268 326"
        fill="none"
        stroke="#F2B544"
        strokeWidth="2"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="4 96"
      />
      <text
        x="36"
        y="600"
        fontSize="13"
        fill="#15181E"
        fillOpacity="0.55"
        fontStyle="italic"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Savannah River, the border
      </text>
      <text
        x="304"
        y="404"
        fontSize="12"
        fill="#15181E"
        fillOpacity="0.7"
        style={{ fontFamily: "var(--font-sans-ui)" }}
      >
        shared corridor
      </text>
    </svg>
  );
}
