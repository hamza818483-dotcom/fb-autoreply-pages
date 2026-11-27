"use client";
export const runtime = "edge";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Download, Menu, MessageCircle, MessageSquareText, ShieldCheck, Sparkles, Video, X } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { PagesProvider } from "@/components/providers/pages-provider";
import { createClient } from "@/lib/supabase";

function Topbar() {
  const { profile, session } = useAuth();
  const router = useRouter();
  const sb = React.useMemo(() => createClient(), []);
  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-md border-b border-border flex items-center gap-2 px-3 py-1.5 overflow-visible"
      style={{ paddingTop: "calc(5px + env(safe-area-inset-top, 0px))", maxWidth: "100vw", boxSizing: "border-box" }}
    >
      <div className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center text-white shrink-0 overflow-hidden" style={{ background: "linear-gradient(135deg, var(--primary), var(--indigo))" }}>
        {profile?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.logo_url} alt="" className="w-full h-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/app-icon.svg" alt="" className="w-full h-full object-cover" />
        )}
      </div>
      <span className="font-bold text-[15px] tracking-tight flex-1 truncate min-w-0">
        {profile?.business_name || "FB Auto-Reply"}
      </span>
      <div className="relative ml-auto shrink-0">
        <button
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="w-9 h-9 rounded-lg border border-border bg-card flex items-center justify-center text-foreground"
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-12 z-50 w-64 max-h-[min(75vh,520px)] overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-xl">
            <div className="px-3 py-2 text-xs text-muted-foreground break-all border-b border-border mb-2">
              {session?.user?.email}
            </div>
            <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Dashboard
            </div>
            {profile?.role === "super_admin" && (
              <>
                <button type="button" onClick={() => { setMenuOpen(false); router.push("/admin"); }} className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-muted">
                  <ShieldCheck size={17} /> Admin Panel
                </button>
                <button type="button" onClick={() => { setMenuOpen(false); router.push("/video-saver"); }} className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-muted">
                  <Video size={17} /> Video Saver
                </button>
              </>
            )}
            <button type="button" onClick={() => { setMenuOpen(false); router.push("/keywords"); }} className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-muted">
              <MessageSquareText size={17} /> Keyword Reply
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); router.push("/ai"); }} className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-muted">
              <Sparkles size={17} /> AI Reply
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); router.push("/export"); }} className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-muted">
              <Download size={17} /> Comment Collector
            </button>
            <div className="my-2 border-t border-border" />
            <button
              type="button"
              onClick={async () => { setMenuOpen(false); await sb.auth.signOut(); }}
              className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-destructive hover:bg-destructive/10"
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
        style={{ paddingTop: "calc(49px + env(safe-area-inset-top, 0px))", boxSizing: "border-box" }}
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
