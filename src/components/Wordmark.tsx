/** Product name, used everywhere it is shown to people. */
export const PRODUCT_NAME = "MrGridy";

/**
 * Wordmark: "MrGridy" in Fraunces with a small line-and-dot glyph, a power line
 * sagging between two poles whose tops carry the two company colours.
 */
export function Wordmark({ size = 21 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2 select-none">
      <svg width="22" height="20" viewBox="0 0 22 20" aria-hidden>
        <path d="M4 7 V18 M18 7 V18" stroke="#15181E" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M4 7 Q11 13 18 7" fill="none" stroke="#15181E" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="4" cy="6" r="2.6" fill="#0E7C7B" stroke="#fff" strokeWidth="1" />
        <circle cx="18" cy="6" r="2.6" fill="#C2410C" stroke="#fff" strokeWidth="1" />
      </svg>
      <span className="display leading-none font-semibold text-ink" style={{ fontSize: size }}>
        <span className="font-normal">Mr</span>Gridy
      </span>
    </div>
  );
}
