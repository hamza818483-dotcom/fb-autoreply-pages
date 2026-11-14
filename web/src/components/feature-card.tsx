"use client";
import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function FeatureCard({
  href,
  icon: Icon,
  title,
  desc,
  badge,
  badgeVariant = "success",
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  badge?: string;
  badgeVariant?: "success" | "off";
}) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col gap-3.5 rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg hover:border-primary/30 text-left"
    >
      {badge && (
        <Badge variant={badgeVariant} className="absolute top-4 right-4">
          {badge}
        </Badge>
      )}
      <div className="w-12 h-12 rounded-[14px] flex items-center justify-center bg-secondary text-primary">
        <Icon size={24} />
      </div>
      <div className="text-[16px] font-bold tracking-tight">{title}</div>
      <div className="text-[13px] text-muted-foreground leading-relaxed -mt-1.5">{desc}</div>
      <div className="flex items-center gap-1.5 text-primary text-xs font-semibold mt-auto">
        পরিচালনা করুন
        <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}
