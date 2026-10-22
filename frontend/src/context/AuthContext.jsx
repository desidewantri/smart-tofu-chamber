'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from '@/services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const token = tokenStore.get();
    if (!token) {
      setReady(true);
      return undefined;
    }
    api
      .me()
      .then((u) => alive && setUser(u))
      .catch(() => tokenStore.clear())
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (email, password, remember) => {
    const { token, user: u } = await api.login(email, password, remember);
    tokenStore.set(token);
    setUser(u);
    return u;
  }, []);

  const register = useCallback(async (body) => {
    const { token, user: u } = await api.register(body);
    tokenStore.set(token);
    setUser(u);
    return u;
  }, []);

  const loginWithGoogle = useCallback(async (credential) => {
    const { token, user: u } = await api.googleLogin(credential);
    tokenStore.set(token);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    if (typeof window !== 'undefined') window.google?.accounts?.id?.disableAutoSelect?.();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, setUser, ready, login, register, loginWithGoogle, logout }), [user, ready, login, register, loginWithGoogle, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
