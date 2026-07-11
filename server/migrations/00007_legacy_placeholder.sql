-- +goose Up
-- Version 7 was already applied before the project schema moved to version 9.
-- Keep this no-op file so Goose does not report a missing historical migration.
SELECT 1;

-- +goose Down
SELECT 1;
