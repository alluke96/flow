import type { TitleSummary } from "@/types/catalog";
import { Card } from "./Card";

interface RowProps {
  title: string;
  items: TitleSummary[];
  progressMap?: Record<string, number>;
}

export function Row({ title, items, progressMap }: RowProps) {
  if (!items.length) return null;
  return (
    <div className="row">
      <div className="row-title">{title}</div>
      <div className="row-track">
        {items.map((t) => (
          <Card key={t.id} title={t} progressPct={progressMap?.[t.id]} />
        ))}
      </div>
    </div>
  );
}
