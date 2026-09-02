import { createContext, useContext } from "react";

export type TourContextValue = {
  isActive: boolean;
  canWalkthrough: boolean;
  startWalkthrough: () => void;
};

export const TourContext = createContext<TourContextValue | null>(null);

export const useTour = (): TourContextValue => {
  const ctx = useContext(TourContext);
  if (!ctx) {
    return {
      isActive: false,
      canWalkthrough: false,
      startWalkthrough: () => undefined,
    };
  }
  return ctx;
};
