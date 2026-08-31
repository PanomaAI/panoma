CREATE TABLE "project_links" (
	"project_id" text NOT NULL,
	"service_id" text NOT NULL,
	"service" text NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"kind" text NOT NULL,
	"evidence" text NOT NULL,
	"icon_slug" text,
	CONSTRAINT "project_links_project_id_service_id_pk" PRIMARY KEY("project_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;