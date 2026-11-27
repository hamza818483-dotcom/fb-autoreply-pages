"use client";
export const runtime = "edge";
import { Shield, Video, MessageSquare, Sparkles, Download } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { usePages } from "@/components/providers/pages-provider";
import { PageSwitcher } from "@/components/page-switcher";
import { FeatureCard } from "@/components/feature-card";
import { PagesSection } from "@/components/sections/pages-section";
import { TeamSection } from "@/components/sections/team-section";

export default function HomePage() {
  const { profile } = useAuth();
  const { isExpired } = usePages();

  return (
    <div>
      <PageSwitcher />

      {isExpired && (
        <div className="text-[13px] px-3.5 py-3 rounded-xl mb-4 bg-destructive/10 text-destructive border border-destructive/20">
          এই পেজের সাবস্ক্রিপশন মেয়াদোত্তীর্ণ — ফিচার ব্যবহার বন্ধ আছে। পুনরায় চালু করতে যোগাযোগ করুন।
        </div>
      )}

      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3.5">Features</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3.5">
        {profile?.role === "super_admin" && (
          <FeatureCard href="/admin" title="Admin Panel" icon={Shield} />
        )}
        {profile?.role === "super_admin" && (
          <FeatureCard href="/video-saver" title="Video Saver" icon={Video} />
        )}
        <FeatureCard href="/keywords" title="Keyword Reply" icon={MessageSquare} />
        <FeatureCard href="/ai" title="AI Reply" icon={Sparkles} />
        <FeatureCard href="/export" title="Comment Collector" icon={Download} />
      </div>

      <PagesSection />
      <TeamSection />
    </div>
  );
}
