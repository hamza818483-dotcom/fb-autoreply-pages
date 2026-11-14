"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { PagesProvider } from "@/components/providers/pages-provider";
import { createClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

function Topbar() {
  const { profile, session } = useAuth();
  const sb = React.useMemo(() => createClient(), []);
  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-background/90 backdrop-blur-md border-b border-border flex items-center gap-3 px-5 py-3.5" style={{ paddingTop: "calc(14px + env(safe-area-inset-top, 0px))" }}>
      <div className="w-8.5 h-[34px] w-[34px] rounded-[10px] flex items-center justify-center text-white shrink-0 overflow-hidden" style={{ background: "linear-gradient(135deg, var(--primary), var(--indigo))" }}>
        {profile?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.logo_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <MessageCircle size={18} />
        )}
      </div>
      <span className="font-bold text-[15px] tracking-tight flex-1 truncate">
        {profile?.business_name || "FB Auto-Reply"}
      </span>
      <span className="text-muted-foreground text-xs hidden sm:inline truncate max-w-[160px]">{session?.user?.email}</span>
      <Button variant="secondary" size="sm" onClick={() => sb.auth.signOut()}>
        লগআউট
      </Button>
    </header>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  if (loading || !session) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">লোড হচ্ছে...</div>;
  }

  return (
    <PagesProvider>
      <Topbar />
      <main className="max-w-[640px] mx-auto px-5 pb-20" style={{ paddingTop: "calc(64px + env(safe-area-inset-top, 0px))" }}>
        {children}
      </main>
    </PagesProvider>
  );
}
