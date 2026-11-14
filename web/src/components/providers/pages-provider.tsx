"use client";
import * as React from "react";
import { createClient } from "@/lib/supabase";
import type { FbPage, Subscription } from "@/lib/types";
import { useAuth } from "./auth-provider";

type PagesCtx = {
  pages: FbPage[];
  currentPageId: string | null;
  setCurrentPageId: (id: string) => void;
  subscription: Subscription | null;
  isExpired: boolean;
  reloadPages: () => Promise<void>;
  reloadSubscription: () => Promise<void>;
};

const Ctx = React.createContext<PagesCtx>({
  pages: [],
  currentPageId: null,
  setCurrentPageId: () => {},
  subscription: null,
  isExpired: false,
  reloadPages: async () => {},
  reloadSubscription: async () => {},
});

export function PagesProvider({ children }: { children: React.ReactNode }) {
  const sb = React.useMemo(() => createClient(), []);
  const { session } = useAuth();
  const [pages, setPages] = React.useState<FbPage[]>([]);
  const [currentPageId, setCurrentPageId] = React.useState<string | null>(null);
  const [subscription, setSubscription] = React.useState<Subscription | null>(null);

  const reloadPages = React.useCallback(async () => {
    if (!session) return;
    const { data } = await sb.from("fb_pages").select("*").order("created_at");
    const rows = (data as FbPage[]) || [];
    setPages(rows);
    setCurrentPageId((prev) => prev && rows.some((p) => p.page_id === prev) ? prev : rows[0]?.page_id || null);
  }, [sb, session]);

  const reloadSubscription = React.useCallback(async () => {
    if (!currentPageId) { setSubscription(null); return; }
    const { data } = await sb.from("subscriptions").select("*").eq("page_id", currentPageId).maybeSingle();
    setSubscription((data as Subscription) || null);
  }, [sb, currentPageId]);

  React.useEffect(() => { reloadPages(); }, [reloadPages]);
  React.useEffect(() => { reloadSubscription(); }, [reloadSubscription]);

  const isExpired = subscription?.status === "expired";

  return (
    <Ctx.Provider value={{ pages, currentPageId, setCurrentPageId, subscription, isExpired, reloadPages, reloadSubscription }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePages() {
  return React.useContext(Ctx);
}
