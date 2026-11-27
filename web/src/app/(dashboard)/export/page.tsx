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
  const [stats, setStats] = React.useState<{ total: number; unique: number; withId: number; top: string } | null>(null);
  const csvRef = React.useRef<{ csv: string; postId: string } | null>(null);

  async function run() {
    if (!currentPageId) { setMsg({ text: "Please select a page first", ok: false }); return; }
    if (!postUrl.trim()) { setMsg({ text: "Enter a post link or ID", ok: false }); return; }
    setStats(null); setBusy(true);
    setMsg({ text: "Collecting comments...", ok: true });
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(`/api/export-comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_url: postUrl.trim(), page_id: currentPageId, access_token: session?.access_token }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setMsg({ text: data.error || "Failed", ok: false }); return; }
      csvRef.current = { csv: data.csv, postId: data.post_id };
      setStats({
        total: data.total_comments,
        unique: data.unique_commenters,
        withId: data.commenters_with_id || 0,
        top: data.top_commenter ? `${data.top_commenter.name} (${data.top_commenter.count} বার)` : "—",
      });
      setMsg({ text: "Done — download the CSV now", ok: true });
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
      <FeatureHeader icon={Download} title="Comment Collector" desc="Export post comments to CSV" />
      <Card>
        <p className="text-xs text-muted-foreground mb-3.5 leading-relaxed">Enter a post link or ID to collect commenter names, Facebook IDs, and comments into a CSV file.</p>
        <Input value={postUrl} onChange={(e) => setPostUrl(e.target.value)} placeholder="Facebook post URL or ID" disabled={isExpired} className="mb-3.5" />
        <Button onClick={run} disabled={busy || isExpired}><Download size={16} /> Collect Comments</Button>
        {msg && (
          <div className={`text-[13px] mt-3 px-3 py-2 rounded-xl border ${msg.ok ? "bg-success/10 text-success border-success/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}>
            {msg.text}
          </div>
        )}
        {stats && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="grid grid-cols-2 gap-2.5 mb-3.5">
              <div className="bg-muted rounded-xl p-3 text-center"><div className="font-bold text-lg">{stats.total}</div><div className="text-[11px] text-muted-foreground">Total Comments</div></div>
              <div className="bg-muted rounded-xl p-3 text-center"><div className="font-bold text-lg">{stats.unique}</div><div className="text-[11px] text-muted-foreground">Unique Commenters</div></div>
              <div className="bg-muted rounded-xl p-3 text-center"><div className="font-bold text-lg">{stats.withId}</div><div className="text-[11px] text-muted-foreground">Facebook IDs Found</div></div>
              <div className="bg-muted rounded-xl p-3 text-center col-span-2"><div className="font-bold text-sm">{stats.top}</div><div className="text-[11px] text-muted-foreground">Top Commenter</div></div>
            </div>
            <Button variant="secondary" onClick={download}><FileDown size={16} /> Download CSV</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
