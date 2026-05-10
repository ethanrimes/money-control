ALTER TABLE `accounts` ADD `teller_enrollment_id` integer;--> statement-breakpoint
CREATE INDEX `accounts_enrollment_idx` ON `accounts` (`teller_enrollment_id`);