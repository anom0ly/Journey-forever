import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Me } from "./api";

// Who's signed in, for pages deep in the tree (report buttons, "You" rows).
export const MeContext = createContext<Me | null>(null);

export function useMe(): Me | null {
  return useContext(MeContext);
}
