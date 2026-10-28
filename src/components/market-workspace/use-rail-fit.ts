import { type RefCallback, useCallback } from "react";

/** Below this much room the rail keeps its stuck size and the page scrolls it into view. */
const MIN_ROOM_REM = 20;

/**
 * Sizes the trade rail's scroll box to the room below where it sits now, so
 * the ticket's pinned action (trade-ticket.module.css → .submitBar) is on
 * screen at first paint. The stylesheet sizes the rail for its stuck position
 * under the header; until the page scrolls it there, the quote band above
 * pushes that box past the fold. Once stuck, the inline size equals the
 * stylesheet's.
 */
export function useRailFit(): RefCallback<HTMLElement> {
  return useCallback((rail: HTMLElement | null) => {
    if (rail === null) return;
    let frame = 0;
    const size = () => {
      frame = 0;
      // The phone layout hides the rail; its sheet scrolls on its own.
      if (rail.offsetParent === null) return;
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      const top = Math.max(
        rail.getBoundingClientRect().top,
        Number.parseFloat(getComputedStyle(rail).top),
      );
      rail.style.maxHeight =
        window.innerHeight - top >= MIN_ROOM_REM * rem
          ? `calc(100dvh - ${Math.round(top)}px - var(--rail-gap))`
          : "";
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(size);
    };
    size();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Content above the rail (the demo banner, a stale notice) moves it without a scroll.
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      rail.style.maxHeight = "";
    };
  }, []);
}
