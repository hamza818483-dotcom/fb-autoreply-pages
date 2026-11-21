"use client";
import * as React from "react";
import { Webhook, Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/components/providers/auth-provider";
import { usePages } from "@/components/providers/pages-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export function PagesSection() {
  const sb = React.useMemo(() => createClient(), []);
  const { session } = useAuth();
  const { pages, reloadPages } = usePages();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [pageId, setPageId] = React.useState("");
  const [token, setToken] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);

  // Which existing page (by page_id) is currently showing its inline
  // "token আপডেট" form, and that form's own fields/error.
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editToken, setEditToken] = React.useState("");
  const [editErr, setEditErr] = React.useState<string | null>(null);

  async function save() {
    if (!pageId.trim() || !token.trim()) { setErr("Page ID ও Access Token দিন"); return; }
    const { error } = await sb.from("fb_pages").insert({
      owner_id: session!.user.id,
      page_id: pageId.trim(),
      page_name: name.trim(),
      page_access_token: token.trim(),
    });
    if (error) { setErr(error.message); return; }
    setName(""); setPageId(""); setToken(""); setErr(null); setOpen(false);
    await reloadPages();
  }

  function startEdit(id: string) {
    setEditingId(id);
    setEditToken("");
    setEditErr(null);
  }

  async function saveToken(id: string) {
    if (!editToken.trim()) { setEditErr("নতুন Access Token দিন"); return; }
    const { error } = await sb
      .from("fb_pages")
      .update({ page_access_token: editToken.trim() })
      .eq("page_id", id);
    if (error) { setEditErr(error.message); return; }
    setEditingId(null); setEditToken(""); setEditErr(null);
    await reloadPages();
  }

  async function removePage(id: string) {
    if (!confirm("এই পেজটা তালিকা থেকে মুছে ফেলতে চান?")) return;
    const { error } = await sb.from("fb_pages").delete().eq("page_id", id);
    if (!error) await reloadPages();
  }

  return (
    <section className="mt-7">
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3.5">Page</h2>

      {pages.length > 0 && (
        <div className="mb-4 space-y-2.5">
          {pages.map((p) => (
            <Card key={p.page_id}>
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[15px] truncate">{p.page_name || p.page_id}</p>
                  <p className="text-[12px] text-muted-foreground truncate">Page ID: {p.page_id}</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => startEdit(p.page_id)} className="shrink-0 whitespace-nowrap">
                  <Pencil size={14} /> টোকেন আপডেট
                </Button>
                <Button variant="secondary" size="sm" onClick={() => removePage(p.page_id)} className="shrink-0">
                  <Trash2 size={14} />
                </Button>
              </div>

              {editingId === p.page_id && (
                <div className="mt-3.5 pt-3.5 border-t border-border">
                  {editErr && (
                    <div className="text-[13px] px-3 py-2 rounded-xl mb-3 bg-destructive/10 text-destructive border border-destructive/20">
                      {editErr}
                    </div>
                  )}
                  <p className="text-[12px] text-muted-foreground mb-2">
                    নাম/কমেন্ট (from) না আসলে, পুরনো টোকেন পারমিশন ঠিক নেই — Graph API
                    Explorer থেকে <code>pages_read_engagement</code>, <code>pages_show_list</code>,{" "}
                    <code>read_page_mailboxes</code> সহ নতুন Page Access Token বানিয়ে এখানে বসান।
                  </p>
                  <Label>নতুন Page Access Token</Label>
                  <Textarea
                    value={editToken}
                    onChange={(e) => setEditToken(e.target.value)}
                    placeholder="EAAG..."
                    className="mb-3.5"
                  />
                  <div className="flex gap-2.5">
                    <Button onClick={() => saveToken(p.page_id)}>সেভ করুন</Button>
                    <Button variant="secondary" onClick={() => setEditingId(null)}>বাতিল</Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div className="flex items-center gap-2.5 mb-0 flex-wrap">
          <h2 className="flex-1 min-w-0 font-bold text-[15px] flex items-center gap-1.5 truncate">
            <Webhook size={16} className="text-primary shrink-0" /> Facebook Page যোগ করুন
          </h2>
          <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)} className="shrink-0 whitespace-nowrap">
            + নতুন পেজ
          </Button>
        </div>
        {open && (
          <div className="mt-4">
            {err && <div className="text-[13px] px-3 py-2 rounded-xl mb-3 bg-destructive/10 text-destructive border border-destructive/20">{err}</div>}
            <Label>Page নাম (identification-এর জন্য)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="যেমনঃ ATLAS Quiz Page" className="mb-3.5" />
            <Label>Page ID</Label>
            <Input value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="1025072427250422" className="mb-3.5" />
            <Label>Page Access Token</Label>
            <Textarea value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAG..." className="mb-3.5" />
            <div className="flex gap-2.5">
              <Button onClick={save}>সেভ করুন</Button>
              <Button variant="secondary" onClick={() => setOpen(false)}>বাতিল</Button>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
