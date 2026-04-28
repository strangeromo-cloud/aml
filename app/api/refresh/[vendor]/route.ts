import { NextRequest, NextResponse } from "next/server";
import { fetchNvidia } from "@/lib/fetch/nvidia";
import { fetchAmd } from "@/lib/fetch/amd";
import type { AmdMeta, FetchResult, NvidiaMeta } from "@/lib/fetch/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// PDF parsing for AMD takes 5-10s; give us headroom.
export const maxDuration = 60;

type CacheEntry = {
  result: FetchResult<NvidiaMeta | AmdMeta>;
  fetchedAt: number;
};

// Simple per-vendor in-memory cache; matches the 60s client throttle so a meta
// request followed by an xlsx request in the same minute reuses the same fetch.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();
// Per-vendor in-flight promise so concurrent requests don't double-fetch.
const inflight = new Map<string, Promise<CacheEntry>>();
// Per-vendor server-side throttle — stops abusive clients from hitting upstream
// more than once per 60s, regardless of how many concurrent tabs they open.
const lastSuccess = new Map<string, number>();

const FETCHERS: Record<string, () => Promise<FetchResult<NvidiaMeta | AmdMeta>>> = {
  nvidia: fetchNvidia as any,
  amd: fetchAmd as any,
};

async function getOrFetch(vendor: string, allowCache: boolean): Promise<CacheEntry> {
  const now = Date.now();
  if (allowCache) {
    const c = cache.get(vendor);
    if (c && now - c.fetchedAt < CACHE_TTL_MS) return c;
  }
  const pending = inflight.get(vendor);
  if (pending) return pending;

  const fn = FETCHERS[vendor];
  if (!fn) throw new Error("unknown vendor");

  const p = (async () => {
    const result = await fn();
    const entry: CacheEntry = { result, fetchedAt: Date.now() };
    cache.set(vendor, entry);
    lastSuccess.set(vendor, entry.fetchedAt);
    return entry;
  })().finally(() => inflight.delete(vendor));
  inflight.set(vendor, p);
  return p;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { vendor: string } },
) {
  const vendor = params.vendor;
  if (!FETCHERS[vendor]) {
    return NextResponse.json({ error: "unknown vendor" }, { status: 404 });
  }
  const type = req.nextUrl.searchParams.get("type") ?? "meta";

  // Defensive throttle: if a successful fetch happened <60s ago, don't re-hit
  // upstream — just serve the cache. This is independent of the meta/xlsx type.
  const since = Date.now() - (lastSuccess.get(vendor) ?? 0);
  const cached = cache.get(vendor);
  const allowCache = !!cached && since < CACHE_TTL_MS;

  try {
    const entry = await getOrFetch(vendor, allowCache);
    if (type === "xlsx") {
      const filename = `${vendor}-eccn.xlsx`;
      return new Response(new Uint8Array(entry.result.xlsxBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    // Default: meta JSON
    return NextResponse.json({
      meta: entry.result.meta,
      cacheAgeSeconds: Math.round((Date.now() - entry.fetchedAt) / 1000),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "fetch failed" },
      { status: 502 },
    );
  }
}
