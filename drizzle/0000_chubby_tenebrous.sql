CREATE TABLE `cloud_files` (
	`storage_key` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `workspace_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cloud_files_fingerprint_idx` ON `cloud_files` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `workspace_backups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state_json` text NOT NULL,
	`saved_at` text NOT NULL,
	`saved_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_backups_workspace_idx` ON `workspace_backups` (`workspace_id`,`revision`);--> statement-breakpoint
CREATE TABLE `workspace_state` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `workspace_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspace_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_active_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "workspace_users_role_check" CHECK("workspace_users"."role" IN ('admin', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_users_email_idx` ON `workspace_users` (`email`);