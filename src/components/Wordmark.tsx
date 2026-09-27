/** Product name, used everywhere it is shown to people. */
export const PRODUCT_NAME = "Mr.Gridy";

/**
 * The mark: a power line drawn as one loose, hand-drawn wave (sagging between
 * two invisible poles), with a small spark resting at its end. The splash
 * screen animates this same path; everywhere else it is static.
 */
export const MARK_PATH = "M3 15 C6.5 6.5 10.5 6 13.5 12.5 S21 19.5 24.5 11.5 S30 5.5 33 8";

export const SPARK = { x: 33, y: 8 };

export function LogoMark({ size = 26, spark = true }: { size?: number; spark?: boolean }) {
  return (
    <svg width={size * (36 / 22)} height={size} viewBox="0 0 36 22" aria-hidden className="shrink-0">
      <path d={MARK_PATH} fill="none" stroke="#15181E" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      {spark ? (
        <>
          <circle cx={SPARK.x} cy={SPARK.y} r="3.4" fill="#F2B544" opacity="0.28" />
          <circle cx={SPARK.x} cy={SPARK.y} r="1.9" fill="#D98A1A" />
        </>
      ) : null}
    </svg>
  );
}

/** Wordmark: the mark plus "Mr.Gridy" in Fraunces. */
export function Wordmark({ size = 21 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2 select-none">
      <LogoMark size={Math.round(size * 0.95)} />
      <span className="display leading-none font-semibold text-ink" style={{ fontSize: size }}>
        <span className="font-normal">Mr.</span>Gridy
      </span>
    </span>
  );
}
