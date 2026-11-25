CREATE TABLE "entry_watch_buddies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entry_watch_buddies_entry_id_user_id_unique" UNIQUE("entry_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "seasons" integer[];--> statement-breakpoint
ALTER TABLE "entry_watch_buddies" ADD CONSTRAINT "entry_watch_buddies_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_watch_buddies" ADD CONSTRAINT "entry_watch_buddies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_watch_buddies_entry_id_idx" ON "entry_watch_buddies" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "entry_watch_buddies_user_id_idx" ON "entry_watch_buddies" USING btree ("user_id");