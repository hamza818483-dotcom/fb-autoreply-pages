"use client";
import * as React from "react";
import { Webhook } from "lucide-react";
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
  const { reloadPages } = usePages();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [pageId, setPageId] = React.useState("");
  const [token, setToken] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);

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

  return (
    <section className="mt-7">
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3.5">Page</h2>
      <Card>
        <div className="flex items-center gap-2.5 mb-0">
          <h2 className="flex-1 font-bold text-[15px] flex items-center gap-1.5">
            <Webhook size={16} className="text-primary" /> Facebook Page যোগ করুন
          </h2>
          <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
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
