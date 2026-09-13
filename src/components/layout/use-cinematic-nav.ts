import {
  createContext,
  useContext,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";

export const CinematicNavContext = createContext(false);
export const CinematicNavSetContext = createContext<Dispatch<SetStateAction<number>>>(
  () => undefined,
);

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
