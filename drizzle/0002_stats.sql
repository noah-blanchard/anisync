CREATE TABLE `list_snapshots` (
	`service` text NOT NULL,
	`day` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`service`, `day`)
);
--> statement-breakpoint
CREATE TABLE `stats_media` (
	`anilist_id` integer PRIMARY KEY NOT NULL,
	`payload` text,
	`fetched_at` integer NOT NULL
);
