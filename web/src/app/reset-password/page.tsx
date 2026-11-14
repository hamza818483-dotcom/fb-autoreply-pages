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

export default function ResetPasswordPage() {
  const router = useRouter();
  const sb = React.useMemo(() => createClient(), []);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    // Supabase's email link sets a recovery session client-side via the
    // URL hash; wait for that session before allowing the form to submit.
    sb.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, [sb]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 6) { setErr("পাসওয়ার্ড কমপক্ষে ৬ ক্যারেক্টার হতে হবে"); return; }
    if (password !== confirm) { setErr("দুটো পাসওয়ার্ড মিলছে না"); return; }
    setBusy(true);
    const { error } = await sb.auth.updateUser({ password });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone(true);
    setTimeout(() => router.push("/"), 1500);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-5">
      <div className="w-full max-w-[380px]">
        <div className="text-center mb-7">
          <div className="w-13 h-13 w-[52px] h-[52px] rounded-2xl mx-auto mb-4 flex items-center justify-center text-white shadow-md" style={{ background: "linear-gradient(135deg, var(--primary), var(--indigo))" }}>
            <MessageCircle size={24} />
          </div>
          <h1 className="text-[22px] font-bold tracking-tight">নতুন পাসওয়ার্ড সেট করুন</h1>
        </div>
        <Card>
          {done ? (
            <div className="text-[13px] px-3.5 py-2.5 rounded-xl bg-success/10 text-success border border-success/20 text-center">
              পাসওয়ার্ড পরিবর্তন হয়েছে, ড্যাশবোর্ডে নিয়ে যাওয়া হচ্ছে...
            </div>
          ) : !ready ? (
            <div className="text-[13px] text-muted-foreground text-center py-4">লিংক যাচাই হচ্ছে...</div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-1">
              {err && (
                <div className="text-[13px] px-3.5 py-2.5 rounded-xl mb-3 bg-destructive/10 text-destructive border border-destructive/20">
                  {err}
                </div>
              )}
              <Label htmlFor="password">নতুন পাসওয়ার্ড</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required className="mb-3.5" />
              <Label htmlFor="confirm">পাসওয়ার্ড আবার লিখুন</Label>
              <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" required className="mb-4" />
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "..." : "পাসওয়ার্ড সেট করুন"}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
