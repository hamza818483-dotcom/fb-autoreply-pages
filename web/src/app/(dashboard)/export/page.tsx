"use client";
export const runtime = "edge";
import * as React from "react";
import { Download, FileDown } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { usePages } from "@/components/providers/pages-provider";
import { FeatureHeader } from "@/components/feature-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ExportPage() {
  const sb = React.useMemo(() => createClient(), []);
  const { currentPageId, isExpired } = usePages();
  const [postUrl, setPostUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ text: string; ok: boolean } | null>(null);
  const [stats, setStats] = React.useState<{ total: number; unique: number; top: string } | null>(null);
  const csvRef = React.useRef<{ csv: string; postId: string } | null>(null);

  async function run() {
    if (!currentPageId) { setMsg({ text: "প্রথমে একটা পেজ সিলেক্ট করুন", ok: false }); return; }
    if (!postUrl.trim()) { setMsg({ text: "পোস্ট লিংক/আইডি দিন", ok: false }); return; }
    setStats(null); setBusy(true);
    setMsg({ text: "কমেন্ট আনা হচ্ছে...", ok: true });
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(`/api/export-comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_url: postUrl.trim(), page_id: currentPageId, access_token: session?.access_token }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setMsg({ text: data.error || "ব্যর্থ হয়েছে", ok: false }); return; }
      csvRef.current = { csv: data.csv, postId: data.post_id };
      setStats({
        total: data.total_comments,
        unique: data.unique_commenters,
        top: data.top_commenter ? `${data.top_commenter.name} (${data.top_commenter.count} বার)` : "—",
      });
      setMsg({ text: "সম্পন্ন — এখন CSV ডাউনলোড করুন", ok: true });
    } catch (e) {
      setMsg({ text: (e as Error).message || "ব্যর্থ হয়েছে", ok: false });
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!csvRef.current) return;
    const blob = new Blob([csvRef.current.csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `comments_${csvRef.current.postId || "post"}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <FeatureHeader icon={Download} title="Comment Collector" desc="পোস্টের কমেন্ট CSV করুন (Random Winner-এর জন্য)" />
      <Card>
        <p className="text-xs text-muted-foreground mb-3.5 leading-relaxed">পোস্টের লিংক বা আইডি দিন — সব কমেন্টারের নাম + কমেন্ট একটা CSV ফাইলে পাবেন, যেটা lms-1 এর Random Winner-এ আপলোড করে স্পিন করে বিজয়ী বাছাই করা যাবে।</p>
        <Input value={postUrl} onChange={(e) => setPostUrl(e.target.value)} placeholder="https://www.facebook.com/.../posts/123456789 অথবা শুধু আইডি" disabled={isExpired} className="mb-3.5" />
        <Button onClick={run} disabled={busy || isExpired}><Download size={16} /> কমেন্ট আনুন</Button>
        {msg && (
          <div className={`text-[13px] mt-3 px-3 py-2 rounded-xl border ${msg.ok ? "bg-success/10 text-success border-success/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}>
            {msg.text}
          </div>
        )}
        {stats && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="grid grid-cols-2 gap-2.5 mb-3.5">
              <div className="bg-muted rounded-xl p-3 text-center"><div className="font-bold text-lg">{stats.total}</div><div className="text-[11px] text-muted-foreground">মোট কমেন্ট</div></div>
              <div className="bg-muted rounded-xl p-3 text-center"><div className="font-bold text-lg">{stats.unique}</div><div className="text-[11px] text-muted-foreground">ইউনিক কমেন্টকারী</div></div>
              <div className="bg-muted rounded-xl p-3 text-center col-span-2"><div className="font-bold text-sm">{stats.top}</div><div className="text-[11px] text-muted-foreground">সর্বোচ্চ কমেন্ট</div></div>
            </div>
            <Button variant="secondary" onClick={download}><FileDown size={16} /> CSV ডাউনলোড করুন</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
