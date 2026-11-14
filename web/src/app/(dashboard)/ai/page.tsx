"use client";
export const runtime = "edge";
import * as React from "react";
import { Sparkles, Bell } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { usePages } from "@/components/providers/pages-provider";
import type { AiSettings } from "@/lib/types";
import { FeatureHeader } from "@/components/feature-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const DEFAULTS: Omit<AiSettings, "page_id"> = {
  ai_enabled: false, system_prompt: "", gemini_keys: "", groq_keys: "",
  gemini_enabled: true, groq_enabled: true, debug_alerts_enabled: false,
};

export default function AiPage() {
  const sb = React.useMemo(() => createClient(), []);
  const { currentPageId, isExpired } = usePages();
  const [s, setS] = React.useState<Omit<AiSettings, "page_id">>(DEFAULTS);
  const [loading, setLoading] = React.useState(true);
  const [msg, setMsg] = React.useState<{ text: string; ok: boolean } | null>(null);

  const load = React.useCallback(async () => {
    if (!currentPageId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await sb.from("ai_settings").select("*").eq("page_id", currentPageId).maybeSingle();
    const d = data as AiSettings | null;
    setS({
      ai_enabled: d ? !!d.ai_enabled : false,
      system_prompt: d?.system_prompt || "",
      gemini_keys: d?.gemini_keys || "",
      groq_keys: d?.groq_keys || "",
      gemini_enabled: d ? d.gemini_enabled !== false : true,
      groq_enabled: d ? d.groq_enabled !== false : true,
      debug_alerts_enabled: d ? d.debug_alerts_enabled === true : false,
    });
    setLoading(false);
  }, [sb, currentPageId]);

  React.useEffect(() => { load(); }, [load]);

  async function save() {
    if (!currentPageId) { setMsg({ text: "প্রথমে একটা পেজ সিলেক্ট করুন", ok: false }); return; }
    const { error } = await sb.from("ai_settings").upsert(
      { page_id: currentPageId, ...s, system_prompt: s.system_prompt?.trim(), gemini_keys: s.gemini_keys?.trim(), groq_keys: s.groq_keys?.trim(), updated_at: new Date().toISOString() },
      { onConflict: "page_id" }
    );
    if (error) { setMsg({ text: error.message, ok: false }); return; }
    setMsg({ text: "সেভ হয়েছে", ok: true });
  }

  if (loading) return <div className="text-muted-foreground text-sm text-center py-10">লোড হচ্ছে...</div>;

  return (
    <div>
      <FeatureHeader icon={Sparkles} title="AI Reply" desc="Keyword match না হলে AI দিয়ে রিপ্লাই দিন" />
      <Card>
        <div className="flex items-center justify-between mb-4.5">
          <Label className="mb-0">AI reply চালু করুন</Label>
          <Switch checked={s.ai_enabled} onCheckedChange={(v) => setS({ ...s, ai_enabled: v })} disabled={isExpired} />
        </div>
        <Label>System Prompt (bot কেমন reply দেবে তা লিখুন)</Label>
        <Textarea value={s.system_prompt || ""} onChange={(e) => setS({ ...s, system_prompt: e.target.value })} placeholder="তুমি একটা Facebook page assistant। বাংলায় সংক্ষেপে, ভদ্রভাবে reply দেবে..." disabled={isExpired} className="mb-4 min-h-[90px]" />

        <div className="flex items-center justify-between mb-1.5">
          <Label className="mb-0">Gemini API Keys (কমা দিয়ে একাধিক)</Label>
          <Switch checked={s.gemini_enabled} onCheckedChange={(v) => setS({ ...s, gemini_enabled: v })} disabled={isExpired} />
        </div>
        <Input value={s.gemini_keys || ""} onChange={(e) => setS({ ...s, gemini_keys: e.target.value })} placeholder="AIzaSy..., AIzaSy..." disabled={isExpired} className="mb-4" />

        <div className="flex items-center justify-between mb-1.5">
          <Label className="mb-0">Groq API Keys (কমা দিয়ে একাধিক)</Label>
          <Switch checked={s.groq_enabled} onCheckedChange={(v) => setS({ ...s, groq_enabled: v })} disabled={isExpired} />
        </div>
        <Input value={s.groq_keys || ""} onChange={(e) => setS({ ...s, groq_keys: e.target.value })} placeholder="gsk_..., gsk_..." disabled={isExpired} className="mb-4" />

        <Button onClick={save} disabled={isExpired}>সেভ করুন</Button>
        {msg && (
          <div className={`text-[13px] mt-3 px-3 py-2 rounded-xl border ${msg.ok ? "bg-success/10 text-success border-success/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}>
            {msg.text}
          </div>
        )}

        <div className="flex items-center justify-between mt-4.5 pt-4 border-t border-border">
          <Label className="mb-0 flex items-center gap-1.5"><Bell size={14} /> Debug alert (Telegram-এ error/status message)</Label>
          <Switch checked={s.debug_alerts_enabled} onCheckedChange={(v) => setS({ ...s, debug_alerts_enabled: v })} disabled={isExpired} />
        </div>
        <p className="text-xs text-muted-foreground mt-2">বন্ধ করলে keyword/AI match না হলে বা কোনো সমস্যা হলে Telegram-এ বার্তা যাবে না</p>
      </Card>
    </div>
  );
}
