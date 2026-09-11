import type { TitleSummary } from "@/types/catalog";
import { Card } from "./Card";

interface RowProps {
  title: string;
  items: TitleSummary[];
  progressMap?: Record<string, number>;
  resume?: boolean;
}

export function Row({ title, items, progressMap, resume }: RowProps) {
  if (!items.length) return null;
  return (
    <div className="row">
      <div className="row-title">{title}</div>
      <div className="row-track">
        {items.map((t) => (
          <Card key={t.id} title={t} progressPct={progressMap?.[t.id]} resume={resume} />
        ))}
      </div>
    </div>
  );
}
