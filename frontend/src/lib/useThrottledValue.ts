import { useEffect, useMemo, useState } from "react";
import { createFrameThrottle } from "./frameThrottle";

/**
 * Follows `value` at most once per `ms`: the first change shows at once, later changes within the
 * wait collapse into the newest one, shown when the wait ends.
 */
export function useThrottledValue<T>(value: T, ms: number): T {
  const [throttled, setThrottled] = useState(value);
  const throttle = useMemo(() => createFrameThrottle<T>((next) => setThrottled(() => next), ms), [ms]);
  useEffect(() => () => throttle.cancel(), [throttle]);
  useEffect(() => throttle.push(value), [throttle, value]);
  return throttled;
}
