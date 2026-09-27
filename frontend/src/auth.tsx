// Emergent-managed Google sign-in for Expo (mobile + web preview).
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { api, setAuthToken, type AuthUser } from "@/src/api";
import { storage } from "@/src/utils/storage";

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = "session_token";

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signingIn: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState>({
  user: null,
  loading: true,
  signIn: async () => {},
  signingIn: false,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(Ctx);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const processed = useRef<Set<string>>(new Set());

  const exchange = useCallback(async (sessionId: string) => {
    if (!sessionId || processed.current.has(sessionId)) return;
    processed.current.add(sessionId);
    try {
      const res = await api.authSession(sessionId);
      if (res?.session_token) {
        await storage.secureSet(TOKEN_KEY, res.session_token);
        setAuthToken(res.session_token);
        setUser(res.user);
      }
    } catch {
      /* silent — user stays on login */
    } finally {
      setSigningIn(false);
    }
  }, []);

  const handleUrl = useCallback(
    (url: string | null | undefined) => {
      if (!url) return;
      const m = url.match(/[?#&]session_id=([^&#]+)/);
      if (m) exchange(decodeURIComponent(m[1]));
    },
    [exchange],
  );

  useEffect(() => {
    let sub: { remove: () => void } | undefined;
    (async () => {
      // 1) Process an incoming session_id FIRST (avoids races with token check).
      if (Platform.OS === "web") {
        const href = typeof window !== "undefined" ? window.location.href : "";
        const m = href.match(/[?#&]session_id=([^&#]+)/);
        if (m) {
          await exchange(decodeURIComponent(m[1]));
          try {
            const u = new URL(window.location.href);
            u.hash = "";
            u.searchParams.delete("session_id");
            window.history.replaceState(window.history.state, "", u.toString());
          } catch {
            /* noop */
          }
        }
      } else {
        handleUrl(await Linking.getInitialURL());
      }

      // 2) Otherwise restore an existing session.
      if (!processed.current.size) {
        const tok = await storage.secureGet<string | null>(TOKEN_KEY, null);
        if (tok) {
          setAuthToken(tok);
          const me = await api.authMe();
          if (me?.user) setUser(me.user);
          else {
            await storage.secureRemove(TOKEN_KEY);
            setAuthToken(null);
          }
        }
      }
      setLoading(false);
    })();

    sub = Linking.addEventListener("url", (e) => handleUrl(e.url));
    return () => sub?.remove();
  }, [exchange, handleUrl]);

  const signIn = useCallback(async () => {
    setSigningIn(true);
    const redirect = Platform.OS === "web" ? window.location.origin + "/" : Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
    if (Platform.OS === "web") {
      window.location.href = authUrl;
      return;
    }
    try {
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
      if (result.type === "success" && result.url) handleUrl(result.url);
      else handleUrl(await Linking.getInitialURL());
    } catch {
      setSigningIn(false);
    }
  }, [handleUrl]);

  const signOut = useCallback(async () => {
    try {
      await api.authLogout();
    } catch {
      /* noop */
    }
    await storage.secureRemove(TOKEN_KEY);
    setAuthToken(null);
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, signIn, signingIn, signOut }}>{children}</Ctx.Provider>;
}
