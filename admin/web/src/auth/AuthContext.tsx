import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchMe, login as apiLogin, TOKEN_KEY, type Me } from '../api/client';

interface AuthContextValue {
  me: Me | null;
  initializing: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setInitializing(false);
      return;
    }
    fetchMe()
      .then(setMe)
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setInitializing(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      me,
      initializing,
      async login(username, password) {
        const user = await apiLogin(username, password);
        setMe(user);
      },
      logout() {
        localStorage.removeItem(TOKEN_KEY);
        setMe(null);
      },
    }),
    [me, initializing],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 必须在 AuthProvider 内使用');
  }
  return ctx;
}
