ALTER TABLE "comments" ADD COLUMN "anchor_quote" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "anchor_prefix" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "anchor_suffix" text DEFAULT '' NOT NULL;