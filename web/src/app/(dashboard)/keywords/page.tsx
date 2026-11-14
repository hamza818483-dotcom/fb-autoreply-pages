"use client";
export const runtime = "edge";
import * as React from "react";
import { MessageSquareText } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { usePages } from "@/components/providers/pages-provider";
import type { KeywordReply } from "@/lib/types";
import { FeatureHeader } from "@/components/feature-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export default function KeywordsPage() {
  const sb = React.useMemo(() => createClient(), []);
  const { currentPageId, isExpired } = usePages();
  const [rows, setRows] = React.useState<KeywordReply[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [kw, setKw] = React.useState("");
  const [reply, setReply] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ text: string; ok: boolean } | null>(null);

  const load = React.useCallback(async () => {
    if (!currentPageId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await sb.from("keyword_replies").select("*").eq("page_id", currentPageId).order("created_at", { ascending: false });
    setRows((data as KeywordReply[]) || []);
    setLoading(false);
  }, [sb, currentPageId]);

  React.useEffect(() => { load(); }, [load]);

  function startEdit(row: KeywordReply) {
    setEditingId(row.id); setKw(row.keyword); setReply(row.reply);
  }
  function cancelEdit() {
    setEditingId(null); setKw(""); setReply(""); setMsg(null);
  }

  async function submit() {
    if (!currentPageId) { setMsg({ text: "প্রথমে একটা পেজ সিলেক্ট করুন", ok: false }); return; }
    if (!kw.trim() || !reply.trim()) { setMsg({ text: "Keyword ও Reply দুটোই দিন", ok: false }); return; }
    if (editingId) {
      const { error } = await sb.from("keyword_replies").update({ keyword: kw.trim(), reply: reply.trim() }).eq("id", editingId);
      if (error) { setMsg({ text: error.message, ok: false }); return; }
      setMsg({ text: "আপডেট হয়েছে", ok: true });
    } else {
      const { error } = await sb.from("keyword_replies").insert({ keyword: kw.trim(), reply: reply.trim(), page_id: currentPageId });
      if (error) { setMsg({ text: error.message, ok: false }); return; }
      setMsg(null);
    }
    setKw(""); setReply(""); setEditingId(null);
    await load();
  }

  async function remove(id: string) {
    if (!confirm("এই keyword ডিলিট করবেন?")) return;
    await sb.from("keyword_replies").delete().eq("id", id);
    if (editingId === id) cancelEdit();
    await load();
  }

  return (
    <div>
      <FeatureHeader icon={MessageSquareText} title="Keyword Reply" desc="নির্দিষ্ট শব্দ অনুযায়ী অটো রিপ্লাই সেট করুন" />
      <Card>
        <h2 className="font-bold text-[15px] mb-3.5">{editingId ? "Keyword এডিট করুন" : "Keyword → Reply যোগ করুন"}</h2>
        <Label>Keyword (কমা দিয়ে একাধিক লিখুন)</Label>
        <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="exam, পরীক্ষা, suggestion" disabled={isExpired} className="mb-3.5" />
        <Label>Reply মেসেজ</Label>
        <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="এই কমেন্টে যা রিপ্লাই যাবে..." disabled={isExpired} className="mb-3.5" />
        <div className="flex gap-2.5">
          <Button onClick={submit} disabled={isExpired}>{editingId ? "আপডেট করুন" : "যোগ করুন"}</Button>
          {editingId && <Button variant="secondary" onClick={cancelEdit}>বাতিল</Button>}
        </div>
        {msg && (
          <div className={`text-[13px] mt-3 px-3 py-2 rounded-xl border ${msg.ok ? "bg-success/10 text-success border-success/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}>
            {msg.text}
          </div>
        )}
      </Card>
      <Card className="mt-3.5">
        <h2 className="font-bold text-[15px] mb-3.5">বর্তমান Keywords</h2>
        {loading ? (
          <div className="text-muted-foreground text-sm text-center py-6">লোড হচ্ছে...</div>
        ) : rows.length === 0 ? (
          <div className="text-muted-foreground text-sm text-center py-6">এখনো কোনো keyword যোগ করা হয়নি</div>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <div key={row.id} className="border border-border rounded-xl p-4 hover:shadow-sm transition-shadow">
                <div className="font-bold text-primary text-xs mb-2">{row.keyword}</div>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap mb-3 leading-relaxed">{row.reply}</div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => startEdit(row)} disabled={isExpired}>এডিট করুন</Button>
                  <Button variant="destructive" size="sm" onClick={() => remove(row.id)} disabled={isExpired}>ডিলিট করুন</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
