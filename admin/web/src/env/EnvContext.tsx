import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Env } from '../api/client';

// 顶栏环境切换器的状态源：Context + localStorage 持久化，
// 所有需要 env 的查询把 env 放进 queryKey，切换后自动重新拉取。
const ENV_KEY = 'openelf_admin_env';

interface EnvContextValue {
  env: Env;
  setEnv: (env: Env) => void;
}

const EnvContext = createContext<EnvContextValue | null>(null);

function readInitial(): Env {
  return localStorage.getItem(ENV_KEY) === 'Sandbox' ? 'Sandbox' : 'Production';
}

export function EnvProvider({ children }: { children: ReactNode }) {
  const [env, setEnvState] = useState<Env>(readInitial);

  const value = useMemo<EnvContextValue>(
    () => ({
      env,
      setEnv(next) {
        localStorage.setItem(ENV_KEY, next);
        setEnvState(next);
      },
    }),
    [env],
  );

  return <EnvContext.Provider value={value}>{children}</EnvContext.Provider>;
}

export function useEnv(): EnvContextValue {
  const ctx = useContext(EnvContext);
  if (!ctx) {
    throw new Error('useEnv 必须在 EnvProvider 内使用');
  }
  return ctx;
}
