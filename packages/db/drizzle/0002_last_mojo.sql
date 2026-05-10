CREATE TABLE `plaid_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` text NOT NULL,
	`institution_name` text NOT NULL,
	`institution_id` text,
	`access_token` text NOT NULL,
	`cursor` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plaid_items_item_id_unique` ON `plaid_items` (`item_id`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `plaid_account_id` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `plaid_item_id` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `subtype` text;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_plaid_idx` ON `accounts` (`plaid_account_id`);--> statement-breakpoint
CREATE INDEX `accounts_plaid_item_idx` ON `accounts` (`plaid_item_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `plaid_transaction_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_plaid_idx` ON `transactions` (`plaid_transaction_id`);