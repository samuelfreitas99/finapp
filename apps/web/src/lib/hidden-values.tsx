import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

const KEY = 'finapp.hideValues';

interface HiddenValues {
  hidden: boolean;
  toggle: () => void;
}

const Ctx = createContext<HiddenValues>({ hidden: false, toggle: () => undefined });

function initial(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Ocultar valores (o "olho" do topo), lembrado neste aparelho. */
export function HiddenValuesProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(initial);
  const toggle = useCallback(() => {
    setHidden((h) => {
      try {
        localStorage.setItem(KEY, h ? '0' : '1');
      } catch {
        // ignora
      }
      return !h;
    });
  }, []);
  const value = useMemo(() => ({ hidden, toggle }), [hidden, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useHiddenValues = () => useContext(Ctx);
