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
  const [privateReply, setPrivateReply] = React.useState("");
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
    setEditingId(row.id); setKw(row.keyword); setReply(row.reply); setPrivateReply(row.private_reply || "");
  }
  function cancelEdit() {
    setEditingId(null); setKw(""); setReply(""); setPrivateReply(""); setMsg(null);
  }

  async function submit() {
    if (!currentPageId) { setMsg({ text: "Please select a page first", ok: false }); return; }
    if (!kw.trim() || !reply.trim()) { setMsg({ text: "Please enter both Keyword and Reply", ok: false }); return; }
    if (editingId) {
      const { error } = await sb.from("keyword_replies").update({ keyword: kw.trim(), reply: reply.trim(), private_reply: privateReply.trim() || null }).eq("id", editingId);
      if (error) { setMsg({ text: error.message, ok: false }); return; }
      setMsg({ text: "Updated successfully", ok: true });
    } else {
      const { error } = await sb.from("keyword_replies").insert({ keyword: kw.trim(), reply: reply.trim(), private_reply: privateReply.trim() || null, page_id: currentPageId });
      if (error) { setMsg({ text: error.message, ok: false }); return; }
      setMsg(null);
    }
    setKw(""); setReply(""); setPrivateReply(""); setEditingId(null);
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this keyword?")) return;
    await sb.from("keyword_replies").delete().eq("id", id);
    if (editingId === id) cancelEdit();
    await load();
  }

  return (
    <div>
      <FeatureHeader icon={MessageSquareText} title="Keyword Reply" desc="Set automatic replies for specific keywords" />
      <Card>
        <h2 className="font-bold text-[15px] mb-3.5">{editingId ? "Edit Keyword" : "Add Keyword → Reply"}</h2>
        <Label>Keyword (separate multiple with commas)</Label>
        <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="exam, suggestion, admission" disabled={isExpired} className="mb-3.5" />
        <Label>Public Comment Reply</Label>
        <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply that will be posted on the comment..." disabled={isExpired} className="mb-3.5" />
        <Label>Private/Inbox Reply (leave blank to use the public reply)</Label>
        <Textarea value={privateReply} onChange={(e) => setPrivateReply(e.target.value)} placeholder="Message that will be sent to the inbox..." disabled={isExpired} className="mb-3.5" />
        <div className="flex gap-2.5">
          <Button onClick={submit} disabled={isExpired}>{editingId ? "Update" : "Add"}</Button>
          {editingId && <Button variant="secondary" onClick={cancelEdit}>Cancel</Button>}
        </div>
        {msg && (
          <div className={`text-[13px] mt-3 px-3 py-2 rounded-xl border ${msg.ok ? "bg-success/10 text-success border-success/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}>
            {msg.text}
          </div>
        )}
      </Card>
      <Card className="mt-3.5">
        <h2 className="font-bold text-[15px] mb-3.5">Current Keywords</h2>
        {loading ? (
          <div className="text-muted-foreground text-sm text-center py-6">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="text-muted-foreground text-sm text-center py-6">No keywords added yet</div>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row, index) => (
              <div key={row.id} className="border border-border rounded-xl p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-bold text-primary">{index + 1}</span>
                  <span className="font-bold text-primary text-xs break-all">{row.keyword}</span>
                </div>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap mb-3 leading-relaxed">{row.reply}</div>
                {row.private_reply && (
                  <div className="text-xs text-muted-foreground whitespace-pre-wrap mb-3 leading-relaxed">Inbox: {row.private_reply}</div>
                )}
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => startEdit(row)} disabled={isExpired}>Edit</Button>
                  <Button variant="destructive" size="sm" onClick={() => remove(row.id)} disabled={isExpired}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
