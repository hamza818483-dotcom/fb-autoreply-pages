"use client";
export const runtime = "edge";
import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const sb = React.useMemo(() => createClient(), []);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [mode, setMode] = React.useState<"login" | "forgot">("login");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(error.message);
    else router.push("/");
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setMsg("ইমেইলে পাসওয়ার্ড রিসেট লিংক পাঠানো হয়েছে, চেক করুন");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-5">
      <div className="w-full max-w-[380px]">
        <div className="text-center mb-7">
          <div className="w-13 h-13 w-[52px] h-[52px] rounded-2xl mx-auto mb-4 flex items-center justify-center text-white shadow-md bg-gradient-to-br from-primary to-indigo-900" style={{ background: "linear-gradient(135deg, var(--primary), var(--indigo))" }}>
            <MessageCircle size={24} />
          </div>
          <h1 className="text-[22px] font-bold tracking-tight">FB Auto-Reply</h1>
          <p className="text-muted-foreground text-[13.5px] mt-1">Comment keyword ও reply নিয়ন্ত্রণ করুন এখান থেকে</p>
        </div>
        <Card>
          {mode === "login" ? (
            <form onSubmit={handleLogin} className="flex flex-col gap-1">
              {err && (
                <div className="text-[13px] px-3.5 py-2.5 rounded-xl mb-3 bg-destructive/10 text-destructive border border-destructive/20">
                  {err}
                </div>
              )}
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="mb-3.5" />
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required className="mb-2" />
              <button
                type="button"
                onClick={() => { setMode("forgot"); setErr(null); setMsg(null); }}
                className="text-[13px] text-primary text-right mb-3.5 hover:underline"
              >
                পাসওয়ার্ড ভুলে গেছেন?
              </button>
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "..." : "লগইন"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleForgot} className="flex flex-col gap-1">
              {err && (
                <div className="text-[13px] px-3.5 py-2.5 rounded-xl mb-3 bg-destructive/10 text-destructive border border-destructive/20">
                  {err}
                </div>
              )}
              {msg && (
                <div className="text-[13px] px-3.5 py-2.5 rounded-xl mb-3 bg-success/10 text-success border border-success/20">
                  {msg}
                </div>
              )}
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="mb-4" />
              <Button type="submit" disabled={busy} className="w-full mb-2.5">
                {busy ? "..." : "রিসেট লিংক পাঠান"}
              </Button>
              <button
                type="button"
                onClick={() => { setMode("login"); setErr(null); setMsg(null); }}
                className="text-[13px] text-muted-foreground text-center hover:underline"
              >
                লগইনে ফিরে যান
              </button>
            </form>
          )}
        </Card>
        <p className="text-center text-[13px] text-muted-foreground mt-3">
          অ্যাকাউন্ট শুধু admin দিতে পারবে — access না থাকলে যোগাযোগ করুন
        </p>
      </div>
    </div>
  );
}
