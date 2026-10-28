CREATE TABLE `connections` (
	`service` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` integer NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`avatar_url` text,
	`extra` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `id_map` (
	`mal_id` integer PRIMARY KEY NOT NULL,
	`anilist_id` integer,
	`resolved_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `id_map_anilist_id_unique` ON `id_map` (`anilist_id`);