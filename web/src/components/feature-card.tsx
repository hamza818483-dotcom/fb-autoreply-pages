"use client";
import Link from "next/link";

export function FeatureCard({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-w-0 min-h-[82px] flex-col justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-3 shadow-sm text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
    >
      <span className="text-[14px] font-bold leading-tight tracking-tight break-words text-foreground">
        {title}
      </span>
      <span className="text-[10px] leading-snug text-muted-foreground break-words">
        {desc}
      </span>
    </Link>
  );
}
