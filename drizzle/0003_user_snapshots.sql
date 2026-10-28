CREATE TABLE `user_snapshots` (
	`user_id` integer NOT NULL,
	`user_name` text NOT NULL,
	`day` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`user_id`, `day`)
);
