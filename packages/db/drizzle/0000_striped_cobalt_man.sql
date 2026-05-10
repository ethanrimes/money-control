CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`teller_account_id` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`institution` text,
	`last_four` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_teller_idx` ON `accounts` (`teller_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_name_idx` ON `accounts` (`name`);--> statement-breakpoint
CREATE TABLE `balances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`as_of_date` text NOT NULL,
	`current` real NOT NULL,
	`available` real,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `balances_account_date_idx` ON `balances` (`account_id`,`as_of_date`);--> statement-breakpoint
CREATE TABLE `budget_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`monthly_savings_target` real NOT NULL,
	`effective_from` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	`type` text DEFAULT 'expense' NOT NULL,
	`color` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_parent_idx` ON `categories` (`name`,`parent_id`);--> statement-breakpoint
CREATE TABLE `categorization_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_text` text NOT NULL,
	`match_type` text DEFAULT 'exact' NOT NULL,
	`category_id` integer,
	`subcategory_id` integer,
	`priority` integer DEFAULT 100 NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	`last_used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`subcategory_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rules_match_idx` ON `categorization_rules` (`match_text`,`match_type`);--> statement-breakpoint
CREATE TABLE `teller_enrollments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`enrollment_id` text NOT NULL,
	`institution_name` text NOT NULL,
	`access_token` text NOT NULL,
	`user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teller_enrollments_enrollment_id_unique` ON `teller_enrollments` (`enrollment_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`teller_txn_id` text,
	`account_id` integer NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`raw_description` text NOT NULL,
	`amount` real NOT NULL,
	`category_id` integer,
	`subcategory_id` integer,
	`source` text NOT NULL,
	`source_file` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`subcategory_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_teller_idx` ON `transactions` (`teller_txn_id`);--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `transactions_account_date_idx` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `transactions_category_idx` ON `transactions` (`category_id`);