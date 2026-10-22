import { z } from "zod";

const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/);
const instantSchema = z.iso.datetime({ offset: true });
const httpUrlSchema = z
  .string()
  .max(2_048)
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Must be an HTTP(S) URL");
const markdownSchema = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !value.includes("\0"));
const handleSchema = z.string().regex(/^[A-Za-z0-9_]{1,50}$/);
/** A profile slug: an X handle, or `~username` for a password account. */
const profileSlugSchema = z.string().regex(/^~?[A-Za-z0-9_]{1,50}$/);
/** Trimmed, 1–60 characters, printable; empty or null clears it. */
const affiliationSchema = z
  .string()
  .trim()
  .max(60)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "Affiliation has invalid characters")
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

/** Up to 64 buckets; every entry a finite non-negative number. */
export const forecastInputSchema = z
  .object({
    probs: z.array(z.number().finite().min(0).max(1.000001)).min(2).max(64),
    client_hash: z.string().min(1).max(128).optional(),
  })
  .strict();

const questionFields = {
  slug: slugSchema,
  title: z.string().trim().min(1).max(200),
  description_md: markdownSchema(20_000),
  rulebook_md: markdownSchema(20_000),
  rulebook_version: z.number().int().min(1).max(1_000),
  opens_at: instantSchema,
  closes_at: instantSchema,
  min_account_age_days: z.number().int().min(0).max(3_650).optional(),
  extremization: z.number().finite().positive().max(10).optional(),
  x_thread_url: httpUrlSchema.optional(),
} as const;

const numericQuestionSchema = z
  .object({
    ...questionFields,
    unit: z.enum(["USD_B", "USD_T"]),
    expiry_at: instantSchema,
    buckets: z
      .object({
        edges: z.array(z.number().finite()).min(1).max(62),
        floor_label: z.string().trim().min(1).max(200),
        labels: z.array(z.string().trim().min(1).max(60).nullable()).max(63).optional(),
      })
      .strict(),
  })
  .strict();

const binaryQuestionSchema = z
  .object({
    ...questionFields,
    unit: z.literal("bool"),
  })
  .strict();

export const questionInputSchema = z.discriminatedUnion("unit", [
  numericQuestionSchema,
  binaryQuestionSchema,
]);

export const emptyBodySchema = z.object({}).strict();

export const closeQuestionSchema = z
  .object({
    /** The resolution document's public timestamp; defaults to now. */
    closed_at: instantSchema.optional(),
  })
  .strict();

export const resolveQuestionSchema = z
  .object({
    /** After the rulebook's rounding; null resolves the floor (or a binary by index). */
    resolved_value: z.number().finite().nullable(),
    /** The bucket the resolver confirms; must equal the one the system computes. */
    winning_bucket_index: z.number().int().min(0).max(63),
    rung_fired: z.number().int().min(1).max(9).nullable(),
    source_url: httpUrlSchema.nullable(),
    source_excerpt: z.string().trim().min(1).max(500).nullable(),
    note_md: markdownSchema(10_000),
  })
  .strict();

export const voidQuestionSchema = z.object({ note_md: markdownSchema(10_000) }).strict();

export const resolutionNoteSchema = z.object({ note_md: markdownSchema(10_000) }).strict();

export const flagUserSchema = z
  .object({
    handle: profileSlugSchema,
    flagged: z.boolean(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine((input) => !input.flagged || input.reason !== undefined, {
    message: "A flag needs a reason",
    path: ["reason"],
  });

export const devSignInSchema = z.object({ handle: handleSchema }).strict();

export const affiliationInputSchema = z.object({ affiliation: affiliationSchema }).strict();

export const adminAffiliationSchema = z
  .object({ handle: profileSlugSchema, affiliation: affiliationSchema })
  .strict();

const plainTextSchema = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "Text has invalid characters");

/**
 * Evidence a forecaster submits on a linked question: the `event_flags`
 * terms shape (decision 0001) minus the fields only ingest fills.
 */
export const evidenceInputSchema = z
  .object({
    source_url: httpUrlSchema,
    kind: z.enum(["scoop", "release", "s1_public"]),
    published_at: instantSchema.optional(),
    terms: z
      .object({
        valuation_usd: z.number().finite().positive().max(1e15).optional(),
        valuation_basis: z.enum(["pre", "post", "unknown"]),
        amount_usd: z.number().finite().positive().max(1e15).optional(),
        outlet: plainTextSchema(100).optional(),
      })
      .strict()
      .refine((terms) => terms.valuation_basis === "unknown" || terms.valuation_usd !== undefined, {
        message: "A pre- or post-money basis needs a valuation",
        path: ["valuation_usd"],
      })
      .optional(),
  })
  .strict();

export const evidenceReviewSchema = z
  .object({
    decision: z.enum(["confirmed", "rejected"]),
    /** The later independent flag that confirms the evidence; required to confirm. */
    confirming_flag_id: z.uuid().optional(),
    note: plainTextSchema(1_000).optional(),
  })
  .strict()
  .refine(
    (input) => (input.decision === "confirmed") === (input.confirming_flag_id !== undefined),
    {
      message: "A confirmation names the confirming flag; a rejection names none",
      path: ["confirming_flag_id"],
    },
  );

/** The listed names a forecaster is employed by, a director of, or invested in; empty clears. */
export const restrictionsInputSchema = z
  .object({ companies: z.array(slugSchema).max(50) })
  .strict();

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export const passwordAccountSchema = z
  .object({
    username: z.string().regex(/^[A-Za-z0-9_]{3,20}$/),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

export const passwordSignInSchema = z
  .object({
    username: z.string().min(1).max(20),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

export type ForecastInput = z.infer<typeof forecastInputSchema>;
export type QuestionInput = z.infer<typeof questionInputSchema>;
export type CloseQuestionInput = z.infer<typeof closeQuestionSchema>;
export type ResolveQuestionInput = z.infer<typeof resolveQuestionSchema>;
export type VoidQuestionInput = z.infer<typeof voidQuestionSchema>;
export type ResolutionNoteInput = z.infer<typeof resolutionNoteSchema>;
export type FlagUserInput = z.infer<typeof flagUserSchema>;
export type AdminAffiliationInput = z.infer<typeof adminAffiliationSchema>;
export type PasswordAccountInput = z.infer<typeof passwordAccountSchema>;
export type PasswordSignInInput = z.infer<typeof passwordSignInSchema>;
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;
export type EvidenceReviewInput = z.infer<typeof evidenceReviewSchema>;
