"use client";
import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";

export function FeatureHeader({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <div>
      <Link href="/" className="inline-flex items-center gap-1.5 text-muted-foreground text-[13.5px] font-semibold mb-4.5 hover:text-primary transition-colors">
        <ArrowLeft size={16} /> Dashboard-এ ফিরুন
      </Link>
      <div className="flex items-center gap-3 mb-5.5">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-secondary text-primary shrink-0">
          <Icon size={20} />
        </div>
        <div>
          <h1 className="text-[19px] font-bold m-0">{title}</h1>
          <p className="text-[12.5px] text-muted-foreground m-0 mt-0.5">{desc}</p>
        </div>
      </div>
    </div>
  );
}
