CREATE TABLE "relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"type" text DEFAULT 'references' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relations_type_check" CHECK ("relations"."type" in ('located_in','references','voiced_by','part_of','depicts','derived_from','counterpart','other'))
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "register" text DEFAULT 'narrative' NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "known_by" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "corruption" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "asset_ref" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "is_canon_firme" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "counterpart_id" uuid;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_source_id_files_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_target_id_files_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "relations_source_target_type_uniq" ON "relations" USING btree ("source_id","target_id","type");--> statement-breakpoint
CREATE INDEX "relations_source_idx" ON "relations" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "relations_target_idx" ON "relations" USING btree ("target_id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_counterpart_id_files_id_fk" FOREIGN KEY ("counterpart_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_kind_check" CHECK ("files"."kind" is null or "files"."kind" in ('character','place','scene','fragment','poem','track','video','document','note'));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_register_check" CHECK ("files"."register" in ('narrative','biography','screenplay','architecture','transmedia','notes'));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_visibility_check" CHECK ("files"."visibility" in ('public','hidden','protected'));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_corruption_check" CHECK ("files"."corruption" >= 0 and "files"."corruption" <= 1);