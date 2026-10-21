-- name: Ping :one
-- Database check for GET /api/health.
SELECT 1::integer AS ok;
