import {
  and,
  desc,
  eq,
  gte,
  sql,
} from "drizzle-orm";
import { db, chicagoPermits, permitSyncState } from "@workspace/db";
import { logger } from "./logger";

const PERMIT_DATASET = "https://data.cityofchicago.org/resource/ydr8-5enu.json";
const ZIP_BOUNDARIES =
  "https://data.cityofchicago.org/resource/unjd-c2ca.json";
const CHICAGO_DATASET_URL =
  "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu";

export const PERMIT_TRADES = [
  "fence",
  "landscaping",
  "pool",
  "gutters",
  "blinds",
] as const;

export type PermitTrade = (typeof PERMIT_TRADES)[number];

type SocrataPermit = Record<string, unknown> & {
  permit_?: string;
  permit_type?: string;
  permit_status?: string;
  permit_milestone?: string;
  issue_date?: string;
  application_start_date?: string;
  street_number?: string;
  street_direction?: string;
  street_name?: string;
  work_type?: string;
  work_description?: string;
  reported_cost?: string;
  latitude?: string;
  longitude?: string;
};

type ZipBoundary = {
  zip: string;
  polygons: number[][][][];
  bounds: [number, number, number, number];
};

type ZipBoundaryCache = {
  expiresAt: number;
  boundaries: ZipBoundary[];
};

let zipMapCache: ZipBoundaryCache | undefined;

function parseNumber(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function tagPermit(permit: SocrataPermit): PermitTrade[] {
  const text = [
    permit.permit_type,
    permit.work_type,
    permit.work_description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const matches: PermitTrade[] = [];
  const rules: Record<PermitTrade, RegExp> = {
    fence: /\bfenc(?:e|ing)\b|\bgate installation\b/,
    landscaping:
      /\blandscap(?:e|ing)\b|\blawn\b|\bgarden\b|\btree (?:planting|removal)\b|\birrigation\b|\bsprinkler\b|\bretaining wall\b/,
    pool: /\bpool\b|\bspa\b|\bhot tub\b/,
    gutters: /\bgutter(?:s|ing)?\b|\bdownspout(?:s)?\b|\bfascia\b|\bsoffit\b/,
    blinds:
      /\bblind(?:s)?\b|\bwindow treatment(?:s)?\b|\bwindow covering(?:s)?\b|\bshutter(?:s)?\b|\bshade(?:s)?\b/,
  };
  for (const trade of PERMIT_TRADES) {
    if (rules[trade].test(text)) matches.push(trade);
  }
  return matches;
}

async function getZipMap(): Promise<ZipBoundaryCache> {
  if (zipMapCache && zipMapCache.expiresAt > Date.now()) {
    return zipMapCache;
  }
  const url = new URL(ZIP_BOUNDARIES);
  url.searchParams.set("$select", "zip,the_geom");
  url.searchParams.set("$limit", "100");
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Chicago ZIP boundary lookup failed (${response.status})`);
  }
  const rows = (await response.json()) as Array<{
    zip?: string;
    the_geom?: {
      type?: string;
      coordinates?: number[][][][];
    };
  }>;
  const boundaries: ZipBoundary[] = [];
  for (const row of rows) {
    if (row.zip) {
      const zip = String(row.zip).padStart(5, "0");
      const polygons = row.the_geom?.coordinates;
      if (!polygons?.length) continue;
      const points = polygons.flat(2);
      const longitudes = points.map((point) => point[0]).filter(Number.isFinite);
      const latitudes = points.map((point) => point[1]).filter(Number.isFinite);
      if (longitudes.length === 0 || latitudes.length === 0) continue;
      boundaries.push({
        zip,
        polygons,
        bounds: [
          Math.min(...longitudes),
          Math.min(...latitudes),
          Math.max(...longitudes),
          Math.max(...latitudes),
        ],
      });
    }
  }
  if (boundaries.length === 0) {
    throw new Error("Chicago ZIP boundary dataset returned no polygons");
  }
  zipMapCache = {
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    boundaries,
  };
  return zipMapCache;
}

function pointInRing(longitude: number, latitude: number, ring: number[][]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    const intersects =
      y1 > latitude !== y2 > latitude &&
      longitude < ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(
  longitude: number,
  latitude: number,
  polygon: number[][][],
): boolean {
  if (!polygon[0] || !pointInRing(longitude, latitude, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(longitude, latitude, hole));
}

function zipFromCoordinates(
  longitude: number | null,
  latitude: number | null,
  zipData: ZipBoundaryCache,
): string | null {
  if (longitude === null || latitude === null) return null;
  const boundary = zipData.boundaries.find(
    (candidate) =>
      longitude >= candidate.bounds[0] &&
      latitude >= candidate.bounds[1] &&
      longitude <= candidate.bounds[2] &&
      latitude <= candidate.bounds[3] &&
      candidate.polygons.some((polygon) =>
        pointInPolygon(longitude, latitude, polygon),
      ),
  );
  return boundary?.zip ?? null;
}

function addressFrom(row: SocrataPermit): string {
  return [
    row.street_number,
    row.street_direction,
    row.street_name,
  ]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ");
}

export async function syncChicagoPermits(days = 14): Promise<number> {
  const safeDays = Math.max(1, Math.min(30, Math.floor(days)));
  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19);
  const params = new URLSearchParams();
  params.set(
    "$select",
    [
      "permit_",
      "permit_type",
      "permit_status",
      "permit_milestone",
      "issue_date",
      "application_start_date",
      "street_number",
      "street_direction",
      "street_name",
      "work_type",
      "work_description",
      "reported_cost",
      "latitude",
      "longitude",
    ].join(","),
  );
  params.set(
    "$where",
    `issue_date >= '${cutoff}' AND issue_date IS NOT NULL AND permit_ IS NOT NULL`,
  );
  params.set("$order", "issue_date DESC");
  params.set("$limit", "5000");

  const [response, zipData] = await Promise.all([
    fetch(`${PERMIT_DATASET}?${params.toString()}`, {
      signal: AbortSignal.timeout(45_000),
      headers: { Accept: "application/json" },
    }),
    getZipMap(),
  ]);
  if (!response.ok) {
    const message = (await response.text()).slice(0, 500);
    throw new Error(
      `Chicago building-permit feed failed (${response.status}): ${message}`,
    );
  }
  const records = (await response.json()) as SocrataPermit[];
  const mapped = records
    .filter(
      (row) =>
        typeof row.permit_ === "string" &&
        typeof row.permit_type === "string" &&
        addressFrom(row).length > 0,
    )
    .map((row) => {
      const zipCode = zipFromCoordinates(
        parseNumber(row.longitude),
        parseNumber(row.latitude),
        zipData,
      );
      const permitNumber = String(row.permit_);
      return {
        permitNumber,
        permitType: String(row.permit_type),
        status:
          typeof row.permit_status === "string"
            ? row.permit_status
            : typeof row.permit_milestone === "string"
              ? row.permit_milestone
              : null,
        address: addressFrom(row),
        zipCode,
        description:
          typeof row.work_description === "string"
            ? row.work_description
            : null,
        issueDate: parseDate(row.issue_date),
        applicationDate: parseDate(row.application_start_date),
        reportedCost: parseNumber(row.reported_cost),
        latitude: parseNumber(row.latitude),
        longitude: parseNumber(row.longitude),
        trades: tagPermit(row),
        sourceUrl: `${CHICAGO_DATASET_URL}?permit_=${encodeURIComponent(permitNumber)}`,
      };
    });

  for (let index = 0; index < mapped.length; index += 250) {
    const batch = mapped.slice(index, index + 250);
    await db
      .insert(chicagoPermits)
      .values(batch)
      .onConflictDoUpdate({
        target: chicagoPermits.permitNumber,
        set: {
          permitType: sql.raw("excluded.permit_type"),
          status: sql.raw("excluded.status"),
          address: sql.raw("excluded.address"),
          zipCode: sql.raw("excluded.zip_code"),
          description: sql.raw("excluded.description"),
          issueDate: sql.raw("excluded.issue_date"),
          applicationDate: sql.raw("excluded.application_date"),
          reportedCost: sql.raw("excluded.reported_cost"),
          latitude: sql.raw("excluded.latitude"),
          longitude: sql.raw("excluded.longitude"),
          trades: sql.raw("excluded.trades"),
          sourceUrl: sql.raw("excluded.source_url"),
          importedAt: sql`now()`,
        },
      });
  }

  await db
    .insert(permitSyncState)
    .values({ id: 1, lastSyncAt: new Date(), syncedCount: mapped.length })
    .onConflictDoUpdate({
      target: permitSyncState.id,
      set: {
        lastSyncAt: new Date(),
        syncedCount: mapped.length,
      },
    });
  logger.info(
    { imported: mapped.length, zipMapped: mapped.filter((p) => p.zipCode).length },
    "Chicago building permits synchronized",
  );
  return mapped.length;
}

export function isPermitMatch(
  permit: { zipCode: string | null; trades: string[] },
  preferences: { zipCodes: string[]; trades: string[] },
): boolean {
  return (
    permit.zipCode !== null &&
    preferences.zipCodes.includes(permit.zipCode) &&
    permit.trades.some((trade) => preferences.trades.includes(trade))
  );
}

export async function readSyncState() {
  const [state] = await db
    .select()
    .from(permitSyncState)
    .where(eq(permitSyncState.id, 1))
    .limit(1);
  return state;
}

export async function markScheduledSync(date: string): Promise<void> {
  await db
    .insert(permitSyncState)
    .values({
      id: 1,
      lastSyncAt: new Date(),
      lastScheduledDate: date,
      syncedCount: 0,
    })
    .onConflictDoUpdate({
      target: permitSyncState.id,
      set: { lastScheduledDate: date },
    });
}

export async function listRecentPermits(since: Date) {
  return db
    .select()
    .from(chicagoPermits)
    .where(
      and(
        gte(chicagoPermits.issueDate, since),
        sql`${chicagoPermits.zipCode} IS NOT NULL`,
      ),
    )
    .orderBy(desc(chicagoPermits.issueDate))
    .limit(5000);
}
