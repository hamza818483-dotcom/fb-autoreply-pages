"use client";
export const runtime = "edge";
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
          <FeatureCard href="/admin" title="Admin Panel" desc="কাস্টমার তৈরি, অ্যাক্সেস ও সাবস্ক্রিপশন নিয়ন্ত্রণ করুন" />
        )}
        {profile?.role === "super_admin" && (
          <FeatureCard href="/video-saver" title="Video Saver" desc="ভিডিও লিংক সেভ করুন অথবা ভিডিও ক্লিপ কেটে নিন" />
        )}
        <FeatureCard href="/keywords" title="Keyword Reply" desc="নির্দিষ্ট শব্দ কমেন্টে এলে অটো রিপ্লাই পাঠান" />
        <FeatureCard href="/ai" title="AI Reply" desc="Keyword না মিললে AI দিয়ে স্মার্ট রিপ্লাই জেনারেট করুন" />
        <FeatureCard href="/export" title="Comment Collector" desc="পোস্টের সব কমেন্ট CSV করে Random Winner-এ ব্যবহার করুন" />
      </div>

      <PagesSection />
      <TeamSection />
    </div>
  );
}
