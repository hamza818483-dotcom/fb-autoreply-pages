"use client";
export const runtime = "edge";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Menu, MessageCircle, X } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { PagesProvider } from "@/components/providers/pages-provider";
import { createClient } from "@/lib/supabase";

function Topbar() {
  const { profile, session } = useAuth();
  const sb = React.useMemo(() => createClient(), []);
  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-40 bg-background/90 backdrop-blur-md border-b border-border flex items-center gap-3 px-5 py-3.5 overflow-visible"
      style={{ paddingTop: "calc(14px + env(safe-area-inset-top, 0px))", maxWidth: "100vw", boxSizing: "border-box" }}
    >
      <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center text-white shrink-0 overflow-hidden" style={{ background: "linear-gradient(135deg, var(--primary), var(--indigo))" }}>
        {profile?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.logo_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <MessageCircle size={18} />
        )}
      </div>
      <span className="font-bold text-[15px] tracking-tight flex-1 truncate min-w-0">
        {profile?.business_name || "FB Auto-Reply"}
      </span>
      <div className="relative shrink-0">
        <button
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="w-10 h-10 rounded-xl border border-border bg-card flex items-center justify-center text-foreground"
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-12 z-50 w-56 rounded-xl border border-border bg-card p-2 shadow-xl">
            <div className="px-3 py-2 text-xs text-muted-foreground break-all border-b border-border mb-2">
              {session?.user?.email}
            </div>
            <button
              type="button"
              onClick={async () => { setMenuOpen(false); await sb.auth.signOut(); }}
              className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold hover:bg-muted"
            >
              লগআউট
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  if (loading || !session) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">লোড হচ্ছে...</div>;
  }

  return (
    <PagesProvider>
      <Topbar />
      <main
        className="w-full min-w-0 max-w-[640px] mx-auto px-5 pb-20 overflow-x-hidden"
        style={{ paddingTop: "calc(62px + env(safe-area-inset-top, 0px))", boxSizing: "border-box" }}
      >
        {pathname !== "/" && (
          <div className="mb-3">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground shadow-sm hover:bg-muted"
            >
              <ArrowLeft size={16} /> Back
            </button>
          </div>
        )}
        {children}
      </main>
    </PagesProvider>
  );
}
