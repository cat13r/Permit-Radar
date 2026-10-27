import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  boolean,
  date,
  doublePrecision,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const chicagoPermits = pgTable("chicago_permits", {
  permitNumber: varchar("permit_number", { length: 32 }).primaryKey(),
  permitType: text("permit_type").notNull(),
  status: text("status"),
  address: text("address").notNull(),
  zipCode: varchar("zip_code", { length: 5 }),
  description: text("description"),
  issueDate: timestamp("issue_date", { withTimezone: true }),
  applicationDate: timestamp("application_date", { withTimezone: true }),
  reportedCost: real("reported_cost"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  trades: text("trades")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  sourceUrl: text("source_url").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const contractorPreferences = pgTable("contractor_preferences", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  email: text("email").notNull(),
  trades: text("trades")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  zipCodes: text("zip_codes")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  digestEnabled: boolean("digest_enabled").notNull().default(true),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const permitSyncState = pgTable("permit_sync_state", {
  id: integer("id").primaryKey().default(1),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastScheduledDate: date("last_scheduled_date", { mode: "string" }),
  syncedCount: integer("synced_count").notNull().default(0),
});

export const digestDeliveries = pgTable(
  "digest_deliveries",
  {
    clerkUserId: text("clerk_user_id").notNull(),
    digestDate: date("digest_date", { mode: "string" }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("sent"),
    attempts: integer("attempts").notNull().default(1),
    lastError: text("last_error"),
    permitNumbers: text("permit_numbers")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (table) => [primaryKey({ columns: [table.clerkUserId, table.digestDate] })],
);

export const insertChicagoPermitSchema = createInsertSchema(chicagoPermits).omit({
  importedAt: true,
});
export const insertContractorPreferencesSchema = createInsertSchema(
  contractorPreferences,
).omit({ updatedAt: true });
export const insertDigestDeliverySchema = createInsertSchema(digestDeliveries).omit({
  sentAt: true,
});

export type ChicagoPermitInput = z.infer<typeof insertChicagoPermitSchema>;
export type ChicagoPermit = typeof chicagoPermits.$inferSelect;
export type ContractorPreferences =
  typeof contractorPreferences.$inferSelect;
export type DigestDelivery = typeof digestDeliveries.$inferSelect;
