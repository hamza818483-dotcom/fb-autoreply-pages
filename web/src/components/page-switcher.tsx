"use client";
import { usePages } from "@/components/providers/pages-provider";
import { Label } from "@/components/ui/label";

export function PageSwitcher() {
  const { pages, currentPageId, setCurrentPageId } = usePages();
  return (
    <div className="mb-5">
      <Label>সক্রিয় পেজ</Label>
      <select
        value={currentPageId || ""}
        onChange={(e) => setCurrentPageId(e.target.value)}
        className="flex h-11 w-full rounded-xl border border-input bg-card px-3.5 text-[15px] shadow-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15"
      >
        {pages.length === 0 && <option value="">কোনো পেজ যোগ করা নেই</option>}
        {pages.map((p) => (
          <option key={p.page_id} value={p.page_id}>
            {p.page_name || p.page_id}
          </option>
        ))}
      </select>
    </div>
  );
}
