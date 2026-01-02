-- name: get-dashboard-charts
SELECT data FROM mat_dashboard_charts;

-- name: get-dashboard-counts
SELECT data FROM mat_dashboard_counts;

-- name: get-settings
SELECT JSON_OBJECT_AGG(key, value) AS settings FROM (SELECT * FROM settings ORDER BY key) t;

-- name: update-settings
UPDATE settings AS s SET value = c.value
    -- For each key in the incoming JSON map, update the row with the key and its value.
    FROM(SELECT * FROM JSONB_EACH($1)) AS c(key, value) WHERE s.key = c.key;

-- name: update-settings-by-key
UPDATE settings SET value = $2, updated_at = NOW() WHERE key = $1;

-- name: get-db-info
SELECT JSON_BUILD_OBJECT('version', (SELECT VERSION()),
                        'size_mb', (SELECT ROUND(pg_database_size((SELECT CURRENT_DATABASE()))/(1024^2)))) AS info;

-- name: get-campaign-dashboard-charts
WITH clicks AS (
    SELECT JSON_AGG(ROW_TO_JSON(row))
    FROM (
        WITH viewDates AS (
            SELECT TIMEZONE('UTC', created_at)::DATE AS to_date,
                    TIMEZONE('UTC', created_at)::DATE - INTERVAL '30 DAY' AS from_date
                    FROM link_clicks WHERE campaign_id = $1 ORDER BY id DESC LIMIT 1
        )
        SELECT COUNT(*) AS count, created_at::DATE as date FROM link_clicks
            WHERE campaign_id = $1 AND TIMEZONE('UTC', created_at)::DATE BETWEEN (SELECT from_date FROM viewDates) AND (SELECT to_date FROM viewDates)
            GROUP by date ORDER BY date
    ) row
),
views AS (
    SELECT JSON_AGG(ROW_TO_JSON(row))
    FROM (
        WITH viewDates AS (
            SELECT TIMEZONE('UTC', created_at)::DATE AS to_date,
                    TIMEZONE('UTC', created_at)::DATE - INTERVAL '30 DAY' AS from_date
                    FROM campaign_views WHERE campaign_id = $1 ORDER BY id DESC LIMIT 1
        )
        SELECT COUNT(*) AS count, created_at::DATE as date FROM campaign_views
            WHERE campaign_id = $1 AND TIMEZONE('UTC', created_at)::DATE BETWEEN (SELECT from_date FROM viewDates) AND (SELECT to_date FROM viewDates)
            GROUP by date ORDER BY date
    ) row
)
SELECT NOW() AS updated_at, JSON_BUILD_OBJECT('link_clicks', COALESCE((SELECT * FROM clicks), '[]'),
                                'campaign_views', COALESCE((SELECT * FROM views), '[]')
                            ) AS data;

-- name: get-campaign-dashboard-counts
WITH camp AS (
    SELECT status, sent, to_send FROM campaigns WHERE id = $1
)
SELECT NOW() AS updated_at,
    JSON_BUILD_OBJECT(
        'subscribers', JSON_BUILD_OBJECT(
            'total', (SELECT sent FROM camp),
            'blocklisted', 0,
            'orphans', 0
        ),
        'lists', JSON_BUILD_OBJECT(
            'total', 0,
            'private', 0,
            'public', 0,
            'optin_single', 0,
            'optin_double', 0
        ),
        'campaigns', JSON_BUILD_OBJECT(
            'total', 1,
            'by_status', (
                SELECT JSON_BUILD_OBJECT(status, 1) FROM camp
            )
        ),
        'messages', (SELECT sent FROM camp)
    ) AS data;
