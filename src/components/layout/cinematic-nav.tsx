import { useState, type ReactNode } from "react";
import {
  CinematicNavContext,
  CinematicNavSetContext,
} from "@/components/layout/use-cinematic-nav";

/**
 * Lets a Billboard tell the fixed top bar it is sitting on cinematic art,
 * so the nav can use a dark fade + white ink instead of a paper strip.
 */
export function CinematicNavProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  return (
    <CinematicNavSetContext.Provider value={setCount}>
      <CinematicNavContext.Provider value={count > 0}>{children}</CinematicNavContext.Provider>
    </CinematicNavSetContext.Provider>
  );
}
