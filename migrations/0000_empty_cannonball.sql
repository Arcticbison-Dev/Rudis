CREATE TABLE "btc_address_derivations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" varchar NOT NULL,
	"address" text NOT NULL,
	"derivation_index" varchar(20) NOT NULL,
	"derivation_path" text NOT NULL,
	"amount_sats" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "btc_address_derivations_invoice_id_unique" UNIQUE("invoice_id")
);
--> statement-breakpoint
CREATE TABLE "btc_payment_states" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" varchar NOT NULL,
	"address" text NOT NULL,
	"state" varchar(20) NOT NULL,
	"txid" text,
	"confirmations" varchar(10) DEFAULT '0',
	"block_height" varchar(20),
	"amount_sats" varchar(20),
	"last_checked" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "btc_payment_states_invoice_id_unique" UNIQUE("invoice_id")
);
--> statement-breakpoint
CREATE TABLE "fee_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"merchant_id" varchar(100),
	"fee_percent" numeric(8, 4) DEFAULT '0' NOT NULL,
	"fixed_fee_atomic" varchar(30) DEFAULT '0' NOT NULL,
	"min_fee_atomic" varchar(30) DEFAULT '0' NOT NULL,
	"max_fee_atomic" varchar(30),
	"currency" varchar(10) DEFAULT 'BTC' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amount" numeric(18, 8) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"asset" varchar(10) NOT NULL,
	"description" text NOT NULL,
	"payment_address" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	"expires_at" timestamp,
	"amount_paid_atomic" varchar(20),
	"rail_type" varchar(20),
	"bolt11_invoice" text,
	"derived_address" text,
	"subaddress" text,
	"payment_source" varchar(20),
	"ln_payment_hash" text,
	"ln_checking_id" text,
	"merchant_id" varchar(100),
	"fee_policy_id" varchar,
	"fee_amount_atomic" varchar(30),
	"fee_percent" numeric(8, 4)
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" varchar NOT NULL,
	"rail" varchar(10),
	"transaction_id" text NOT NULL,
	"confirmations" varchar(10) NOT NULL,
	"block_height" varchar(20),
	"confirmed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_name" text NOT NULL,
	"asset" varchar(10) NOT NULL,
	"amount_usd" text,
	"interval" varchar(20),
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" varchar NOT NULL,
	"url" text NOT NULL,
	"status" varchar(20) NOT NULL,
	"status_code" varchar(10),
	"error_message" text,
	"attempt" varchar(10) DEFAULT '1',
	"retry_after" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "ln_checking_id_idx" ON "invoices" USING btree ("ln_checking_id");