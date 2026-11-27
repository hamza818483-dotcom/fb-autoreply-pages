"use client";
import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

export function FeatureCard({
  href,
  icon: Icon,
  title,
  desc,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex min-w-0 flex-col gap-3.5 rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg hover:border-primary/30 text-left"
    >
      <div className="w-12 h-12 rounded-[14px] flex items-center justify-center bg-secondary text-primary">
        <Icon size={24} />
      </div>
      <div className="text-[16px] font-bold tracking-tight break-words">{title}</div>
      <div className="text-[13px] text-muted-foreground leading-relaxed -mt-1.5">{desc}</div>
      <div className="flex items-center gap-1.5 text-primary text-xs font-semibold mt-auto">
        পরিচালনা করুন
        <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}
