"use client";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export function FeatureCard({
  href,
  title,
  icon: Icon,
}: {
  href: string;
  title: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="flex min-w-0 min-h-[82px] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-3 shadow-sm text-center transition-colors hover:border-primary/40 hover:bg-muted/40"
    >
      <Icon size={22} strokeWidth={1.8} className="text-primary" />
      <span className="text-[14px] font-bold leading-tight tracking-tight break-words text-foreground">
        {title}
      </span>
    </Link>
  );
}
