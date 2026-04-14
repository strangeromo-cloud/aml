"use client";

// Convert ISO-2 to a flag emoji via regional indicator letters
export function CountryFlag({ code, className }: { code: string; className?: string }) {
  if (!code || code.length !== 2) return null;
  const up = code.toUpperCase();
  const flag = String.fromCodePoint(
    ...[...up].map((c) => 0x1f1e6 + c.charCodeAt(0) - "A".charCodeAt(0)),
  );
  return (
    <span className={className} title={up} aria-label={up}>
      {flag}
    </span>
  );
}
