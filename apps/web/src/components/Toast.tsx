import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface ToastData {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

const Ctx = createContext<(t: Omit<ToastData, 'id'>) => void>(() => undefined);

/** Aviso rápido no rodapé, com ação opcional ("Desfazer"). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastData | null>(null);
  const seq = useRef(0);
  const show = useCallback((t: Omit<ToastData, 'id'>) => {
    seq.current += 1;
    setToast({ ...t, id: seq.current });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite">
        {toast && (
          <div className="toast" role="status" key={toast.id}>
            <span>{toast.text}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.run();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
