import { clerkClient, getAuth } from "@clerk/express";
import {
  and,
  arrayContains,
  count,
  desc,
  eq,
  gte,
  ilike,
  or,
  type SQL,
} from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  chicagoPermits,
  contractorPreferences,
  db,
} from "@workspace/db";
import {
  CreateBillingPortalResponse,
  CreateCheckoutResponse,
  GetBillingStatusResponse,
  GetDashboardSummaryResponse,
  GetPermitParams,
  GetPermitResponse,
  GetPreferencesResponse,
  ListPermitsQueryParams,
  ListPermitsResponse,
  UpdatePreferencesBody,
  UpdatePreferencesResponse,
} from "@workspace/api-zod";
import {
  isPermitMatch,
  listRecentPermits,
  readSyncState,
} from "../lib/chicagoPermits";
import { stripeRequest } from "../lib/providerClients";

const router: IRouter = Router();
const MONTHLY_PRICE_ID = "price_1UVD2xGoTvMYeWlARuNu3BeR";
const ACTIVE_SUBSCRIPTION_STATES = new Set(["active", "trialing"]);

type StripeSubscription = {
  id: string;
  status: string;
  created?: number;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
};

function requireUserId(req: Request, res: Response): string | null {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue." });
    return null;
  }
  return userId;
}

async function requireActiveSubscriber(
  req: Request,
  res: Response,
): Promise<boolean> {
  const userId = requireUserId(req, res);
  if (!userId) return false;
  try {
    const preferences = await getOrCreatePreferences(userId);
    if (!preferences.stripeCustomerId) {
      res.status(402).json({
        error: "An active permitnative subscription is required.",
        code: "SUBSCRIPTION_REQUIRED",
      });
      return false;
    }
    const result = await stripeRequest<{ data?: StripeSubscription[] }>(
      `/v1/subscriptions?customer=${encodeURIComponent(preferences.stripeCustomerId)}&status=all&limit=100`,
    );
    if (!(result.data ?? []).some((subscription) =>
      ACTIVE_SUBSCRIPTION_STATES.has(subscription.status),
    )) {
      res.status(402).json({
        error: "An active permitnative subscription is required.",
        code: "SUBSCRIPTION_REQUIRED",
      });
      return false;
    }
    return true;
  } catch (error) {
    req.log.error({ err: error }, "Could not verify permit subscription access");
    res.status(503).json({ error: "Subscription access is temporarily unavailable." });
    return false;
  }
}

async function readClerkEmail(userId: string): Promise<string> {
  const user = await clerkClient.users.getUser(userId);
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress;
  if (!email) throw new Error("The signed-in account has no email address.");
  return email;
}

async function getOrCreatePreferences(userId: string) {
  const [existing] = await db
    .select()
    .from(contractorPreferences)
    .where(eq(contractorPreferences.clerkUserId, userId))
    .limit(1);
  if (existing) return existing;

  const email = await readClerkEmail(userId);
  const [created] = await db
    .insert(contractorPreferences)
    .values({
      clerkUserId: userId,
      email,
      trades: [],
      zipCodes: [],
      digestEnabled: true,
    })
    .onConflictDoUpdate({
      target: contractorPreferences.clerkUserId,
      set: { email },
    })
    .returning();
  return created;
}

function permitResponse(
  permit: typeof chicagoPermits.$inferSelect,
) {
  return {
    permitNumber: permit.permitNumber,
    permitType: permit.permitType,
    status: permit.status,
    address: permit.address,
    zipCode: permit.zipCode,
    description: permit.description,
    issueDate: permit.issueDate?.toISOString() ?? null,
    applicationDate: permit.applicationDate?.toISOString() ?? null,
    reportedCost: permit.reportedCost,
    latitude: permit.latitude,
    longitude: permit.longitude,
    trades: permit.trades,
    sourceUrl: permit.sourceUrl,
  };
}

function appOrigin(): string {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (domain) return `https://${domain}`;
  return "http://localhost";
}

function chicagoDayStartUtc(): Date {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${today}T00:00:00.000Z`);
}

function subscriptionStatus(
  subscriptions: StripeSubscription[],
): {
  status: "active" | "trialing" | "past_due" | "canceled" | "incomplete" | "inactive";
  active: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  subscriptionId: string | null;
} {
  const latest = [...subscriptions].sort(
    (left, right) => (right.created ?? 0) - (left.created ?? 0),
  )[0];
  if (!latest) {
    return {
      status: "inactive",
      active: false,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      subscriptionId: null,
    };
  }
  const allowedStatus = [
    "active",
    "trialing",
    "past_due",
    "canceled",
    "incomplete",
  ] as const;
  const status = allowedStatus.includes(
    latest.status as (typeof allowedStatus)[number],
  )
    ? (latest.status as (typeof allowedStatus)[number])
    : latest.status === "unpaid"
      ? "past_due"
      : latest.status === "incomplete_expired"
        ? "canceled"
        : "inactive";
  return {
    status,
    active: ACTIVE_SUBSCRIPTION_STATES.has(status),
    currentPeriodEnd: latest.current_period_end
      ? new Date(latest.current_period_end * 1000).toISOString()
      : null,
    cancelAtPeriodEnd: latest.cancel_at_period_end ?? false,
    subscriptionId: latest.id,
  };
}

router.get("/permits", async (req, res): Promise<void> => {
  if (!(await requireActiveSubscriber(req, res))) return;
  const parsed = ListPermitsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { q, trade, zipCode, days, limit, offset } = parsed.data;
  const conditions: SQL[] = [
    gte(
      chicagoPermits.issueDate,
      new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    ),
  ];
  if (trade) conditions.push(arrayContains(chicagoPermits.trades, [trade]));
  if (zipCode) conditions.push(eq(chicagoPermits.zipCode, zipCode));
  if (q?.trim()) {
    const term = `%${q.trim()}%`;
    conditions.push(
      or(
        ilike(chicagoPermits.address, term),
        ilike(chicagoPermits.permitNumber, term),
        ilike(chicagoPermits.description, term),
      )!,
    );
  }
  try {
    const where = and(...conditions);
    const [[totalRow], rows, state] = await Promise.all([
      db.select({ total: count() }).from(chicagoPermits).where(where),
      db
        .select()
        .from(chicagoPermits)
        .where(where)
        .orderBy(desc(chicagoPermits.issueDate))
        .limit(limit)
        .offset(offset),
      readSyncState(),
    ]);
    res.json(
      ListPermitsResponse.parse({
        items: rows.map(permitResponse),
        total: totalRow?.total ?? 0,
        lastSyncAt: state?.lastSyncAt?.toISOString() ?? null,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not list Chicago permits");
    res.status(500).json({ error: "Permit search is temporarily unavailable." });
  }
});

router.get("/permits/:permitNumber", async (req, res): Promise<void> => {
  if (!(await requireActiveSubscriber(req, res))) return;
  const parsed = GetPermitParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [permit] = await db
      .select()
      .from(chicagoPermits)
      .where(eq(chicagoPermits.permitNumber, parsed.data.permitNumber))
      .limit(1);
    if (!permit) {
      res.status(404).json({ error: "Permit not found." });
      return;
    }
    res.json(GetPermitResponse.parse(permitResponse(permit)));
  } catch (error) {
    req.log.error({ err: error }, "Could not load Chicago permit");
    res.status(500).json({ error: "Permit details are temporarily unavailable." });
  }
});

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  if (!(await requireActiveSubscriber(req, res))) return;
  try {
    const [preferences, state] = await Promise.all([
      getOrCreatePreferences(userId),
      readSyncState(),
    ]);
    const permits = await listRecentPermits(
      new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    );
    const todayCutoff = chicagoDayStartUtc().getTime();
    res.json(
      GetDashboardSummaryResponse.parse({
        newPermitsToday: permits.filter(
          (permit) =>
            permit.issueDate && permit.issueDate.getTime() >= todayCutoff,
        ).length,
        matchingPermits: permits.filter((permit) =>
          isPermitMatch(permit, preferences),
        ).length,
        recentPermits: permits.length,
        lastSyncAt: state?.lastSyncAt?.toISOString() ?? null,
        digestEnabled: preferences.digestEnabled,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not load contractor dashboard");
    res.status(500).json({ error: "Dashboard data is temporarily unavailable." });
  }
});

router.get("/preferences", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const preferences = await getOrCreatePreferences(userId);
    res.json(
      GetPreferencesResponse.parse({
        email: preferences.email,
        trades: preferences.trades,
        zipCodes: preferences.zipCodes,
        digestEnabled: preferences.digestEnabled,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not load contractor preferences");
    res.status(500).json({ error: "Preferences are temporarily unavailable." });
  }
});

router.put("/preferences", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const parsed = UpdatePreferencesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const email = await readClerkEmail(userId);
    const [preferences] = await db
      .insert(contractorPreferences)
      .values({
        clerkUserId: userId,
        email,
        trades: parsed.data.trades,
        zipCodes: parsed.data.zipCodes,
        digestEnabled: parsed.data.digestEnabled,
      })
      .onConflictDoUpdate({
        target: contractorPreferences.clerkUserId,
        set: {
          email,
          trades: parsed.data.trades,
          zipCodes: parsed.data.zipCodes,
          digestEnabled: parsed.data.digestEnabled,
          updatedAt: new Date(),
        },
      })
      .returning();
    res.json(
      UpdatePreferencesResponse.parse({
        email: preferences.email,
        trades: preferences.trades,
        zipCodes: preferences.zipCodes,
        digestEnabled: preferences.digestEnabled,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not save contractor preferences");
    res.status(500).json({ error: "Preferences could not be saved." });
  }
});

router.get("/billing/status", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const preferences = await getOrCreatePreferences(userId);
    if (!preferences.stripeCustomerId) {
      res.json(
        GetBillingStatusResponse.parse({
          status: "inactive",
          active: false,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        }),
      );
      return;
    }
    const data = await stripeRequest<{ data?: StripeSubscription[] }>(
      `/v1/subscriptions?customer=${encodeURIComponent(preferences.stripeCustomerId)}&status=all&limit=100`,
    );
    const current = subscriptionStatus(data.data ?? []);
    await db
      .update(contractorPreferences)
      .set({ stripeSubscriptionId: current.subscriptionId })
      .where(eq(contractorPreferences.clerkUserId, userId));
    res.json(
      GetBillingStatusResponse.parse({
        status: current.status,
        active: current.active,
        currentPeriodEnd: current.currentPeriodEnd,
        cancelAtPeriodEnd: current.cancelAtPeriodEnd,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not load Stripe subscription");
    res.status(503).json({ error: "Billing status is temporarily unavailable." });
  }
});

router.post("/billing/checkout", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const preferences = await getOrCreatePreferences(userId);
    if (!preferences.trades.length || !preferences.zipCodes.length) {
      res.status(400).json({
        error: "Choose at least one trade and one ZIP code before subscribing.",
      });
      return;
    }
    let customerId = preferences.stripeCustomerId;
    if (!customerId) {
      const customer = await stripeRequest<{ id: string }>("/v1/customers", {
        email: preferences.email,
        "metadata[userId]": userId,
      });
      customerId = customer.id;
      await db
        .update(contractorPreferences)
        .set({ stripeCustomerId: customerId })
        .where(eq(contractorPreferences.clerkUserId, userId));
    }
    const origin = appOrigin();
    const checkout = await stripeRequest<{ url?: string }>(
      "/v1/checkout/sessions",
      {
        customer: customerId,
        mode: "subscription",
        "line_items[0][price]": MONTHLY_PRICE_ID,
        "line_items[0][quantity]": "1",
        success_url: `${origin}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/settings?checkout=cancelled`,
        client_reference_id: userId,
        "metadata[userId]": userId,
        "subscription_data[metadata][userId]": userId,
      },
    );
    if (!checkout.url) throw new Error("Stripe did not return a checkout URL.");
    res.json(CreateCheckoutResponse.parse({ url: checkout.url }));
  } catch (error) {
    req.log.error({ err: error }, "Could not start Stripe checkout");
    res.status(503).json({ error: "Checkout is temporarily unavailable." });
  }
});

router.post("/billing/portal", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    const preferences = await getOrCreatePreferences(userId);
    if (!preferences.stripeCustomerId) {
      res.status(400).json({ error: "No Stripe customer account is available." });
      return;
    }
    const portal = await stripeRequest<{ url?: string }>(
      "/v1/billing_portal/sessions",
      {
        customer: preferences.stripeCustomerId,
        return_url: `${appOrigin()}/settings`,
      },
    );
    if (!portal.url) throw new Error("Stripe did not return a portal URL.");
    res.json(CreateBillingPortalResponse.parse({ url: portal.url }));
  } catch (error) {
    req.log.error({ err: error }, "Could not open Stripe billing portal");
    res.status(503).json({ error: "Billing management is temporarily unavailable." });
  }
});

export default router;
