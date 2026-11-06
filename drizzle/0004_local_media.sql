DELETE FROM connections WHERE service = 'simkl';--> statement-breakpoint
CREATE TABLE `media_entries` (
	`kind` text NOT NULL,
	`tmdb_id` integer NOT NULL,
	`title` text NOT NULL,
	`original_title` text,
	`poster_path` text,
	`year` integer,
	`status` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	PRIMARY KEY(`kind`, `tmdb_id`)
);
--> statement-breakpoint
CREATE TABLE `tmdb_media` (
	`kind` text NOT NULL,
	`tmdb_id` integer NOT NULL,
	`payload` text,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`kind`, `tmdb_id`)
);
