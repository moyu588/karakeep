CREATE TABLE `tagAliases` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`aliasNormalizedName` text NOT NULL,
	`aliasName` text NOT NULL,
	`targetTagId` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`targetTagId`) REFERENCES `bookmarkTags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tagAliases_user_idx` ON `tagAliases` (`userId`);--> statement-breakpoint
CREATE INDEX `tagAliases_target_tag_idx` ON `tagAliases` (`targetTagId`);--> statement-breakpoint
CREATE UNIQUE INDEX `tagAliases_user_alias_unique` ON `tagAliases` (`userId`,`aliasNormalizedName`);--> statement-breakpoint
CREATE TABLE `tagReviewSuggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`candidateName` text NOT NULL,
	`candidateNormalizedName` text NOT NULL,
	`suggestedTagId` text,
	`confidence` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`createdAt` integer NOT NULL,
	`resolvedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`suggestedTagId`) REFERENCES `bookmarkTags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tagReviewSuggestions_user_status_idx` ON `tagReviewSuggestions` (`userId`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `tagReviewSuggestions_user_candidate_unique` ON `tagReviewSuggestions` (`userId`,`candidateNormalizedName`);