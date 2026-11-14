"use client";
import * as React from "react";
import { ShieldCheck, UserPlus } from "lucide-react";
import { createClient, WORKER_BASE_URL } from "@/lib/supabase";
import { useAuth } from "@/components/providers/auth-provider";
import type { AdminCustomer } from "@/lib/types";
import { FeatureHeader } from "@/components/feature-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AdminPage() {
  const sb = React.useMemo(() => createClient(), []);
  const { profile } = useAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [business, setBusiness] = React.useState("");
  const [msg, setMsg] = React.useState<{ text: string; ok: boolean } | null>(null);
  const [customers, setCustomers] = React.useState<AdminCustomer[]>([]);
  const [loading, setLoading] = React.useState(true);

  async function authedFetch(path: string, init: RequestInit = {}) {
    const { data: { session } } = await sb.auth.getSession();
    return fetch(`${WORKER_BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}`, ...(init.headers || {}) },
    });
  }

  const loadCustomers = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/admin/customers");
      const data = await res.json();
      setCustomers(data.customers || []);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => { loadCustomers(); }, [loadCustomers]);

  async function createCustomer() {
    if (!email.trim() || !password.trim()) { setMsg({ text: "email ও password দিন", ok: false }); return; }
    const res = await authedFetch("/api/admin/customers", {
      method: "POST",
      body: JSON.stringify({ email: email.trim(), password: password.trim(), business_name: business.trim() || null }),
    });
    const data = await res.json();
    if (!res.ok || data.error) { setMsg({ text: data.error || "ব্যর্থ হয়েছে", ok: false }); return; }
    setEmail(""); setPassword(""); setBusiness("");
    setMsg({ text: "কাস্টমার তৈরি হয়েছে", ok: true });
    await loadCustomers();
  }

  async function toggleSub(customerId: string, pageId: string, status: "active" | "expired") {
    await authedFetch("/api/admin/customers", {
      method: "PATCH",
      body: JSON.stringify({ customer_id: customerId, page_id: pageId, status }),
    });
    await loadCustomers();
  }

  async function removeCustomer(customerId: string) {
    if (!confirm("এই কাস্টমার সম্পূর্ণ মুছে ফেলতে চান? এই অ্যাকশন ফেরানো যাবে না।")) return;
    await authedFetch("/api/admin/customers", { method: "DELETE", body: JSON.stringify({ customer_id: customerId }) });
    await loadCustomers();
  }

  if (profile && profile.role !== "super_admin") {
    return <div className="text-muted-foreground text-sm text-center py-10">এই পেজের অ্যাক্সেস নেই</div>;
  }

  return (
    <div>
      <FeatureHeader icon={ShieldCheck} title="Admin Panel" desc="কাস্টমার তৈরি ও সাবস্ক্রিপশন নিয়ন্ত্রণ" />
      <Card>
        <h2 className="font-bold text-[15px] mb-3.5 flex items-center gap-1.5"><UserPlus size={16} className="text-primary" /> নতুন কাস্টমার তৈরি করুন</h2>
        <Label>Email</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com" className="mb-3.5" />
        <Label>পাসওয়ার্ড (customer-কে দিয়ে দিন)</Label>
        <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="কমপক্ষে ৬ ক্যারেক্টার" className="mb-3.5" />
        <Label>ব্যবসার নাম (dashboard-এ দেখাবে)</Label>
        <Input value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="যেমনঃ Rahim's Shop" className="mb-3.5" />
        <Button onClick={createCustomer}>কাস্টমার তৈরি করুন</Button>
        {msg && (
          <div className={`text-[13px] mt-3 px-3 py-2 rounded-xl border ${msg.ok ? "bg-success/10 text-success border-success/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}>
            {msg.text}
          </div>
        )}
      </Card>

      <Card className="mt-3.5">
        <h2 className="font-bold text-[15px] mb-3.5">সব কাস্টমার</h2>
        {loading ? (
          <div className="text-muted-foreground text-sm text-center py-6">লোড হচ্ছে...</div>
        ) : customers.length === 0 ? (
          <div className="text-muted-foreground text-sm text-center py-6">কোনো কাস্টমার নেই</div>
        ) : (
          <div className="flex flex-col gap-3">
            {customers.map((c) => (
              <div key={c.id} className="border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-bold text-sm">{c.business_name || c.email}</div>
                  <Button variant="destructive" size="sm" onClick={() => removeCustomer(c.id)}>মুছুন</Button>
                </div>
                <div className="text-xs text-muted-foreground mb-3">{c.email}</div>
                {c.pages.length === 0 ? (
                  <div className="text-xs text-muted-foreground">কোনো পেজ যোগ করেনি</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {c.pages.map((p) => {
                      const sub = c.subscriptions.find((s) => s.page_id === p.page_id);
                      const active = !sub || sub.status === "active";
                      return (
                        <div key={p.page_id} className="flex items-center justify-between bg-muted rounded-lg px-3 py-2">
                          <div className="text-xs font-semibold">{p.page_name || p.page_id}</div>
                          <Button
                            size="sm"
                            variant={active ? "secondary" : "default"}
                            onClick={() => toggleSub(c.id, p.page_id, active ? "expired" : "active")}
                          >
                            {active ? "সক্রিয় — বন্ধ করুন" : "মেয়াদোত্তীর্ণ — চালু করুন"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
