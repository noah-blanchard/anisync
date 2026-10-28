CREATE TABLE `booster_swipes` (
	`anilist_id` integer PRIMARY KEY NOT NULL,
	`decision` text NOT NULL,
	`rarity` text NOT NULL,
	`swiped_at` integer NOT NULL
);
