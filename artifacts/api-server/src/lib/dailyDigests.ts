import { and, eq, gte } from "drizzle-orm";
import {
  contractorPreferences,
  db,
  digestDeliveries,
} from "@workspace/db";
import { logger } from "./logger";
import {
  isPermitMatch,
  listRecentPermits,
  markScheduledSync,
  readSyncState,
  syncChicagoPermits,
} from "./chicagoPermits";
import { sendResendEmail, stripeRequest } from "./providerClients";

const ACTIVE_SUBSCRIPTION_STATES = new Set(["active", "trialing"]);

type StripeSubscription = {
  id: string;
  status: string;
};

function chicagoDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function previousChicagoDayStart(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1));
}

function chicagoHour(date: Date): number {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;
  return Number(value ?? "0");
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

async function hasActiveSubscription(customerId: string): Promise<boolean> {
  const result = await stripeRequest<{ data?: StripeSubscription[] }>(
    `/v1/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=100`,
  );
  return (result.data ?? []).some((subscription) =>
    ACTIVE_SUBSCRIPTION_STATES.has(subscription.status),
  );
}

function digestMarkup(
  date: string,
  permits: Awaited<ReturnType<typeof listRecentPermits>>,
): { html: string; text: string } {
  if (permits.length === 0) {
    const message =
      "No new Chicago permits matched your trades and ZIP codes today. We'll keep checking the city feed.";
    return {
      html: `<p>${escapeHtml(message)}</p>`,
      text: message,
    };
  }
  const rows = permits
    .map((permit) => {
      const tags = permit.trades.join(", ") || "No trade tags";
      return `<li style="margin:0 0 18px"><strong>${escapeHtml(permit.address)}${permit.zipCode ? `, ${escapeHtml(permit.zipCode)}` : ""}</strong><br>${escapeHtml(permit.permitType)} · ${escapeHtml(tags)}<br>${escapeHtml(permit.description ?? "No work description provided")}<br><a href="${escapeHtml(permit.sourceUrl)}">View permit in Chicago's data portal</a></li>`;
    })
    .join("");
  const textRows = permits
    .map(
      (permit) =>
        `${permit.address}${permit.zipCode ? `, ${permit.zipCode}` : ""}\n${permit.permitType} · ${permit.trades.join(", ") || "No trade tags"}\n${permit.description ?? "No work description provided"}\n${permit.sourceUrl}`,
    )
    .join("\n\n");
  return {
    html: `<p>Here are your new Chicago permit matches for ${escapeHtml(date)}.</p><ul>${rows}</ul><p>Permit details are from the City of Chicago Open Data Portal.</p>`,
    text: `Your Chicago permit matches for ${date}:\n\n${textRows}\n\nPermit details are from the City of Chicago Open Data Portal.`,
  };
}

async function deliverDigest(
  preference: typeof contractorPreferences.$inferSelect,
  date: string,
  permits: Awaited<ReturnType<typeof listRecentPermits>>,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(digestDeliveries)
    .where(
      and(
        eq(digestDeliveries.clerkUserId, preference.clerkUserId),
        eq(digestDeliveries.digestDate, date),
      ),
    )
    .limit(1);
  if (existing?.status === "sent") return;
  if (existing && existing.attempts >= 3) return;
  if (
    existing &&
    Date.now() - existing.sentAt.getTime() < 30 * 60 * 1000
  ) {
    return;
  }

  const selected = permits.filter((permit) =>
    isPermitMatch(permit, preference),
  );
  const attempt = (existing?.attempts ?? 0) + 1;
  if (existing) {
    await db
      .update(digestDeliveries)
      .set({
        status: "pending",
        attempts: attempt,
        lastError: null,
        sentAt: new Date(),
      })
      .where(
        and(
          eq(digestDeliveries.clerkUserId, preference.clerkUserId),
          eq(digestDeliveries.digestDate, date),
        ),
      );
  } else {
    const reserved = await db
      .insert(digestDeliveries)
      .values({
        clerkUserId: preference.clerkUserId,
        digestDate: date,
        status: "pending",
        attempts: attempt,
        permitNumbers: [],
      })
      .onConflictDoNothing()
      .returning({ clerkUserId: digestDeliveries.clerkUserId });
    if (reserved.length === 0) return;
  }

  try {
    const content = digestMarkup(date, selected);
    const dayKey = date.replaceAll("-", "");
    const userDigestKey = Buffer.from(preference.clerkUserId).toString("base64url");
    await sendResendEmail({
      from:
        process.env.PERMIT_CENTRAL_FROM_EMAIL ??
        "permitnative <onboarding@resend.dev>",
      to: preference.email,
      subject:
        selected.length > 0
          ? `${selected.length} new Chicago permit${selected.length === 1 ? "" : "s"} for you`
          : "Your Chicago permit update",
      html: content.html,
      text: content.text,
      idempotencyKey: `permit-central-${dayKey}-${userDigestKey}`,
    });
    await db
      .update(digestDeliveries)
      .set({
        status: "sent",
        sentAt: new Date(),
        lastError: null,
        permitNumbers: selected.map((permit) => permit.permitNumber),
      })
      .where(
        and(
          eq(digestDeliveries.clerkUserId, preference.clerkUserId),
          eq(digestDeliveries.digestDate, date),
        ),
      );
    logger.info(
      { userId: preference.clerkUserId, matchedPermits: selected.length },
      "Daily permit digest sent",
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message.slice(0, 500) : "Unknown email error";
    await db
      .update(digestDeliveries)
      .set({ status: "failed", sentAt: new Date(), lastError: errorMessage })
      .where(
        and(
          eq(digestDeliveries.clerkUserId, preference.clerkUserId),
          eq(digestDeliveries.digestDate, date),
        ),
      );
    logger.error(
      { err: error, userId: preference.clerkUserId, attempt },
      "Daily permit digest could not be sent",
    );
  }
}

export async function sendDailyDigests(date = chicagoDate(new Date())): Promise<void> {
  // The City publishes issue_date as a date-only value at midnight UTC.
  // Include the previous Chicago calendar day so a 7 a.m. digest does not
  // drop permits issued yesterday just because their timestamp is midnight.
  const cutoff = previousChicagoDayStart(date);
  const [preferences, permits] = await Promise.all([
    db
      .select()
      .from(contractorPreferences)
      .where(eq(contractorPreferences.digestEnabled, true)),
    listRecentPermits(cutoff),
  ]);
  for (const preference of preferences) {
    if (
      !preference.stripeCustomerId ||
      preference.trades.length === 0 ||
      preference.zipCodes.length === 0
    ) {
      continue;
    }
    try {
      if (!(await hasActiveSubscription(preference.stripeCustomerId))) continue;
      await deliverDigest(preference, date, permits);
    } catch (error) {
      logger.error(
        { err: error, userId: preference.clerkUserId },
        "Unable to check subscription or send daily digest",
      );
    }
  }
}

export async function runScheduledJob(): Promise<void> {
  const now = new Date();
  if (chicagoHour(now) < 7) return;
  const today = chicagoDate(now);
  const syncState = await readSyncState();
  if (syncState?.lastScheduledDate !== today) {
    // A fresh database has nothing yet, so backfill two weeks the first time.
    await syncChicagoPermits(syncState?.lastSyncAt ? 3 : 14);
    await markScheduledSync(today);
    logger.info({ scheduledDate: today }, "Morning Chicago permit refresh completed");
  }
  await sendDailyDigests(today);
}

export function startDailyPermitJobs(): void {
  const runSafely = (): void => {
    void runScheduledJob().catch((error) => {
      logger.error({ err: error }, "Daily permit workflow failed");
    });
  };
  runSafely();
  setInterval(runSafely, 15 * 60 * 1000);
}
