import { useLayoutEffect, useState } from "react";

/**
 * Height in pixels from the top of the element given to the returned ref callback to the bottom of
 * the window, less `bottomGap`, never below `minHeight`. Kept current while the window resizes or
 * anything above the element changes height (the header wrapping, a menu opening), so the element
 * can fill the screen without making the page scroll. Null until measured.
 */
export function useViewportFill<T extends HTMLElement>(bottomGap: number, minHeight: number): [(element: T | null) => void, number | null] {
  const [element, setElement] = useState<T | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(minHeight, Math.floor(window.innerHeight - top - bottomGap)));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = "ResizeObserver" in window ? new ResizeObserver(measure) : null;
    observer?.observe(document.body);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [element, bottomGap, minHeight]);

  return [setElement, height];
}
