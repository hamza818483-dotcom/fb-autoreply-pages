"use client";
import * as React from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

type AuthCtx = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
};

const Ctx = React.createContext<AuthCtx>({
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const sb = React.useMemo(() => createClient(), []);
  const [session, setSession] = React.useState<Session | null>(null);
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [loading, setLoading] = React.useState(true);

  const loadProfile = React.useCallback(
    async (uid: string) => {
      const { data } = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
      setProfile((data as Profile) || null);
    },
    [sb]
  );

  const refreshProfile = React.useCallback(async () => {
    if (session?.user?.id) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  React.useEffect(() => {
    sb.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user?.id) await loadProfile(data.session.user.id);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange(async (_e, sess) => {
      setSession(sess);
      if (sess?.user?.id) await loadProfile(sess.user.id);
      else setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [sb, loadProfile]);

  return (
    <Ctx.Provider value={{ session, profile, loading, refreshProfile }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return React.useContext(Ctx);
}
