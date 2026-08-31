ALTER TABLE "projects" ADD COLUMN "git_modified" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "git_untracked" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "git_ahead" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "git_behind" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "git_stashes" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "git_own_repo" boolean;