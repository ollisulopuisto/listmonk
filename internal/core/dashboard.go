package core

import (
	"net/http"

	"github.com/jmoiron/sqlx/types"
	"github.com/labstack/echo/v4"
)

// GetDashboardCharts returns chart data points to render on the dashboard.
// If listID > 0, stats for that specific list are returned (aggregated from campaigns sent to that list).
func (c *Core) GetDashboardCharts(listID int) (types.JSONText, error) {
	var out types.JSONText

	if listID > 0 {
		q := `
		WITH clicks AS (
			SELECT JSON_AGG(ROW_TO_JSON(row))
			FROM (
				WITH viewDates AS (
					SELECT TIMEZONE('UTC', lc.created_at)::DATE AS to_date,
							TIMEZONE('UTC', lc.created_at)::DATE - INTERVAL '30 DAY' AS from_date
							FROM link_clicks lc
							JOIN campaign_lists cl ON (lc.campaign_id = cl.campaign_id)
							WHERE cl.list_id = $1
							ORDER BY lc.id DESC LIMIT 1
				)
				SELECT COUNT(lc.id) AS count, lc.created_at::DATE as date
					FROM link_clicks lc
					JOIN campaign_lists cl ON (lc.campaign_id = cl.campaign_id)
					WHERE cl.list_id = $1 AND TIMEZONE('UTC', lc.created_at)::DATE BETWEEN (SELECT from_date FROM viewDates) AND (SELECT to_date FROM viewDates)
					GROUP by date ORDER BY date
			) row
		),
		views AS (
			SELECT JSON_AGG(ROW_TO_JSON(row))
			FROM (
				WITH viewDates AS (
					SELECT TIMEZONE('UTC', cv.created_at)::DATE AS to_date,
							TIMEZONE('UTC', cv.created_at)::DATE - INTERVAL '30 DAY' AS from_date
							FROM campaign_views cv
							JOIN campaign_lists cl ON (cv.campaign_id = cl.campaign_id)
							WHERE cl.list_id = $1
							ORDER BY cv.id DESC LIMIT 1
				)
				SELECT COUNT(cv.id) AS count, cv.created_at::DATE as date
					FROM campaign_views cv
					JOIN campaign_lists cl ON (cv.campaign_id = cl.campaign_id)
					WHERE cl.list_id = $1 AND TIMEZONE('UTC', cv.created_at)::DATE BETWEEN (SELECT from_date FROM viewDates) AND (SELECT to_date FROM viewDates)
					GROUP by date ORDER BY date
			) row
		)
		SELECT JSON_BUILD_OBJECT('link_clicks', COALESCE((SELECT * FROM clicks), '[]'),
										'campaign_views', COALESCE((SELECT * FROM views), '[]')
									) AS data;
		`
		if err := c.db.Get(&out, q, listID); err != nil {
			return nil, echo.NewHTTPError(http.StatusInternalServerError,
				c.i18n.Ts("globals.messages.errorFetching", "name", "dashboard charts", "error", pqErrMsg(err)))
		}

		return out, nil
	}

	_ = c.refreshCache(matDashboardCharts, false)

	if err := c.q.GetDashboardCharts.Get(&out); err != nil {
		return nil, echo.NewHTTPError(http.StatusInternalServerError,
			c.i18n.Ts("globals.messages.errorFetching", "name", "dashboard charts", "error", pqErrMsg(err)))
	}

	return out, nil
}

// GetDashboardCounts returns stats counts to show on the dashboard.
// If listID > 0, stats for that specific list are returned.
func (c *Core) GetDashboardCounts(listID int) (types.JSONText, error) {
	var out types.JSONText

	if listID > 0 {
		q := `
		SELECT
			JSON_BUILD_OBJECT(
				'subscribers', JSON_BUILD_OBJECT(
					'total', (SELECT COUNT(*) FROM subscriber_lists WHERE list_id = $1),
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
					'total', (SELECT COUNT(*) FROM campaign_lists WHERE list_id = $1),
					'by_status', (
						-- Dummy status object to prevent frontend errors if it expects specific keys
						SELECT JSON_BUILD_OBJECT('sent', (SELECT COUNT(*) FROM campaign_lists WHERE list_id = $1))
					)
				),
				'messages', (
					SELECT COALESCE(SUM(c.sent), 0) FROM campaigns c
					JOIN campaign_lists cl ON c.id = cl.campaign_id
					WHERE cl.list_id = $1
				)
			) AS data;
		`
		if err := c.db.Get(&out, q, listID); err != nil {
			return nil, echo.NewHTTPError(http.StatusInternalServerError,
				c.i18n.Ts("globals.messages.errorFetching", "name", "dashboard stats", "error", pqErrMsg(err)))
		}

		return out, nil
	}

	_ = c.refreshCache(matDashboardCounts, false)

	if err := c.q.GetDashboardCounts.Get(&out); err != nil {
		return nil, echo.NewHTTPError(http.StatusInternalServerError,
			c.i18n.Ts("globals.messages.errorFetching", "name", "dashboard stats", "error", pqErrMsg(err)))
	}

	return out, nil
}
