import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

const CinematicNavContext = createContext(false);
const CinematicNavSetContext = createContext<Dispatch<SetStateAction<number>>>(
  () => undefined,
);

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

export function useCinematicNav() {
  return useContext(CinematicNavContext);
}

export function useRegisterCinematicNav() {
  const setCount = useContext(CinematicNavSetContext);
  useEffect(() => {
    setCount((n) => n + 1);
    return () => setCount((n) => Math.max(0, n - 1));
  }, [setCount]);
}
