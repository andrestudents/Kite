CREATE TABLE "channels" (
	"id" numeric PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"pubkey" text NOT NULL,
	"active" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drips" (
	"wallet" text PRIMARY KEY NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"rate" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isas" (
	"isa_id" numeric PRIMARY KEY NOT NULL,
	"seeker" text NOT NULL,
	"backer" text NOT NULL,
	"principal" bigint NOT NULL,
	"share_bps" integer NOT NULL,
	"cap_mult" integer NOT NULL,
	"remaining" bigint NOT NULL,
	"status" text NOT NULL,
	"term_end" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchase_id" uuid NOT NULL,
	"account" text NOT NULL,
	"side" text NOT NULL,
	"amount_ausd" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_transitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchase_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" numeric NOT NULL,
	"isa_id" numeric NOT NULL,
	"purchase_ref" text NOT NULL,
	"gross_ausd" bigint NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"mill_sig" jsonb NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"failed_reason" text
);
--> statement-breakpoint
CREATE TABLE "recon_daily" (
	"day" date PRIMARY KEY NOT NULL,
	"backend_total" bigint NOT NULL,
	"chain_total" bigint NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relayer_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"nonce" bigint,
	"attempts" integer DEFAULT 0 NOT NULL,
	"client_ref" text,
	"last_error" text,
	"terminal_at" timestamp with time zone,
	CONSTRAINT "relayer_jobs_client_ref_unique" UNIQUE("client_ref")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"phone" text,
	"kyc_status" text DEFAULT 'unverified' NOT NULL,
	"identity_hash" text,
	"locale" text DEFAULT 'id' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_wallet_unique" UNIQUE("wallet")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"provider_event_id" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_transitions" ADD CONSTRAINT "purchase_transitions_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_channel_ref_uq" ON "purchases" USING btree ("channel_id","purchase_ref");