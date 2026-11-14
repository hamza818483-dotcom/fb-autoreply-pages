"use client";
import * as React from "react";
import { UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/components/providers/auth-provider";
import { usePages } from "@/components/providers/pages-provider";
import type { PageAccess } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TeamSection() {
  const sb = React.useMemo(() => createClient(), []);
  const { session } = useAuth();
  const { currentPageId } = usePages();
  const [email, setEmail] = React.useState("");
  const [rows, setRows] = React.useState<PageAccess[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [msg, setMsg] = React.useState<{ text: string; ok: boolean } | null>(null);

  const load = React.useCallback(async () => {
    if (!currentPageId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await sb.from("page_access").select("*").eq("page_id", currentPageId).order("created_at", { ascending: false });
    setRows((data as PageAccess[]) || []);
    setLoading(false);
  }, [sb, currentPageId]);

  React.useEffect(() => { load(); }, [load]);

  async function invite() {
    if (!currentPageId) { setMsg({ text: "প্রথমে একটা পেজ সিলেক্ট করুন", ok: false }); return; }
    const e = email.trim().toLowerCase();
    if (!e) { setMsg({ text: "ইমেইল দিন", ok: false }); return; }
    await sb.from("allowed_emails").insert({ email: e });
    const { error } = await sb.from("page_access").insert({
      page_id: currentPageId, invited_email: e, granted_by: session!.user.id,
    });
    if (error) { setMsg({ text: error.message, ok: false }); return; }
    setEmail("");
    setMsg({ text: `${e} কে access দেওয়া হয়েছে। সে এখন এই email দিয়ে signup করলেই এই পেজ readymade পাবে।`, ok: true });
    await load();
  }

  async function revoke(id: string) {
    if (!confirm("এই ব্যক্তির অ্যাক্সেস বাতিল করবেন?")) return;
    await sb.from("page_access").delete().eq("id", id);
    await load();
  }

  return (
    <section className="mt-1.5">
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3.5 pt-6">Team Access</h2>
      <Card>
        <h2 className="font-bold text-[15px] flex items-center gap-1.5 mb-0"><UserPlus size={16} className="text-primary" /> নতুন Admin যোগ করুন</h2>
        <p className="text-xs text-muted-foreground mt-0 mb-3.5 leading-relaxed">এই email দিয়ে signup করলে সে সরাসরি এই পেজের access পেয়ে যাবে, নতুন করে পেজ সেটআপ করতে হবে না।</p>
        <Label>Email</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@example.com" className="mb-3.5" />
        <Button onClick={invite}>Access দিন</Button>
        {msg && (
          <div className={`text-[13px] mt-3 px-3 py-2 rounded-xl border ${msg.ok ? "bg-success/10 text-success border-success/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}>
            {msg.text}
          </div>
        )}
      </Card>
      <Card className="mt-3.5">
        <h2 className="font-bold text-[15px] mb-3.5">যাদের access আছে</h2>
        {loading ? (
          <div className="text-muted-foreground text-sm text-center py-6">লোড হচ্ছে...</div>
        ) : rows.length === 0 ? (
          <div className="text-muted-foreground text-sm text-center py-6">এখনো কাউকে access দেওয়া হয়নি</div>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <div key={r.id} className="border border-border rounded-xl p-4">
                <div className="font-bold text-primary text-xs mb-1.5">{r.invited_email}</div>
                <div className="text-sm text-muted-foreground mb-2.5">
                  {r.user_id ? "সক্রিয় — লগইন করেছে" : "অপেক্ষমাণ — এখনো signup করেনি"}
                </div>
                <Button variant="destructive" size="sm" onClick={() => revoke(r.id)}>অ্যাক্সেস বাতিল করুন</Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
