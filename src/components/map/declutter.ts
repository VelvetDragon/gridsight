/**
 * Keeps map labels (DOM markers) from sitting on top of each other.
 *
 * Markers that opt in carry the classes `gs-declutter` and `gs-rank-<n>` on
 * their element. Lower ranks keep their place; each later label is
 * nudged, via the CSS `translate` property on its content, to the nearest spot
 * that clears everything placed before it. The label's own `transform` (its
 * above/below/right placement) is left alone.
 */

const GAP = 6;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const offsets = new WeakMap<HTMLElement, [number, number]>();

function hits(a: Box, b: Box): boolean {
  return a.left < b.right + GAP && a.right + GAP > b.left && a.top < b.bottom + GAP && a.bottom + GAP > b.top;
}

function shifted(b: Box, dx: number, dy: number): Box {
  return { left: b.left + dx, top: b.top + dy, right: b.right + dx, bottom: b.bottom + dy };
}

export function declutter(container: HTMLElement): void {
  const items = [...container.querySelectorAll<HTMLElement>(".gs-declutter")]
    .map((marker) => {
      const el = marker.firstElementChild as HTMLElement | null;
      if (!el) return null;
      const [ox, oy] = offsets.get(el) ?? [0, 0];
      // The label and its direct children: an inline pill's padding spills outside its parent.
      const rects = [el, ...el.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
      if (!rects.length) return null;
      // Where the label would sit with no nudge.
      const box = {
        left: Math.min(...rects.map((r) => r.left)) - ox,
        top: Math.min(...rects.map((r) => r.top)) - oy,
        right: Math.max(...rects.map((r) => r.right)) - ox,
        bottom: Math.max(...rects.map((r) => r.bottom)) - oy,
      };
      const rank = Number(/gs-rank-(\d+)/.exec(marker.className)?.[1] ?? 0);
      return { el, box, rank };
    })
    .filter((x) => x !== null)
    .sort((a, b) => a.rank - b.rank);

  const placed: Box[] = [];
  for (const { el, box } of items) {
    let best: [number, number] = [0, 0];
    if (placed.some((p) => hits(box, p))) {
      // Candidate spots: just past each placed label, on each of its four sides.
      const tries: [number, number][] = [];
      for (const p of placed) {
        tries.push(
          [0, p.bottom + GAP - box.top],
          [0, p.top - GAP - box.bottom],
          [p.right + GAP - box.left, 0],
          [p.left - GAP - box.right, 0],
        );
      }
      tries.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
      best = tries.find(([dx, dy]) => !placed.some((p) => hits(shifted(box, dx, dy), p))) ?? [0, 0];
    }
    placed.push(shifted(box, best[0], best[1]));
    const [ox, oy] = offsets.get(el) ?? [0, 0];
    if (ox !== best[0] || oy !== best[1]) {
      offsets.set(el, best);
      el.style.translate = best[0] || best[1] ? `${best[0]}px ${best[1]}px` : "";
    }
  }
}
