import type { ChangeEvent } from "react";
import { RATES } from "./constants";

export function RateSelect({
  rate,
  onChange,
}: {
  rate: number;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <div className="rate-select-wrap">
      <select className="rate-select" value={rate} onChange={onChange} aria-label="Velocidade de reprodução">
        {RATES.map((r) => (
          <option key={r} value={r}>
            {r}x
          </option>
        ))}
      </select>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}
