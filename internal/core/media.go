package core

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	"github.com/gofrs/uuid/v5"
	"github.com/knadh/listmonk/internal/media"
	"github.com/knadh/listmonk/models"
	"github.com/labstack/echo/v5"
	"github.com/lib/pq"
	"gopkg.in/volatiletech/null.v6"
)

// QueryMedia returns media entries optionally filtered by a query string.
func (c *Core) QueryMedia(provider string, s media.Store, query string, prefixes, tags []string, offset, limit int) ([]media.Media, int, error) {
	out := []media.Media{}
	if tags == nil {
		tags = []string{}
	}

	if query != "" {
		query = strings.ToLower(query)
	}

	if prefixes == nil {
		prefixes = []string{}
	}
	if tags == nil {
		tags = []string{}
	}

	if err := c.q.QueryMedia.Select(&out, fmt.Sprintf("%%%s%%", query), provider, offset, limit, pq.StringArray(prefixes), pq.StringArray(tags)); err != nil {
		return out, 0, echo.NewHTTPError(http.StatusInternalServerError,
			c.i18n.Ts("globals.messages.errorFetching",
				"name", "{globals.terms.media}", "error", pqErrMsg(err)))
	}

	total := 0
	if len(out) > 0 {
		total = out[0].Total

		for i := 0; i < len(out); i++ {
			out[i].URL = s.GetURL(out[i].Filename)

			if out[i].Thumb != "" {
				out[i].ThumbURL = null.String{Valid: true, String: s.GetURL(out[i].Thumb)}
			}
		}
	}

	return out, total, nil
}

// GetMedia returns a media item.
func (c *Core) GetMedia(id int, uuid, fileName string, s media.Store) (media.Media, error) {
	var uu any
	if uuid != "" {
		uu = uuid
	}

	var out media.Media
	if err := c.q.GetMedia.Get(&out, id, uu, fileName); err != nil {
		// If it's ` sql: no rows in result set`, return a 404.
		if err == sql.ErrNoRows {
			return out, ErrNotFound
		}

		return out, echo.NewHTTPError(http.StatusInternalServerError,
			c.i18n.Ts("globals.messages.errorFetching", "name", "{globals.terms.media}", "error", pqErrMsg(err)))
	}

	out.URL = s.GetURL(out.Filename)
	if out.Thumb != "" {
		out.ThumbURL = null.String{Valid: true, String: s.GetURL(out.Thumb)}
	}

	return out, nil
}

// GetMediaTags returns tags for the given provider, limited to the media
// filename prefixes the user is permitted to see (same guard as QueryMedia).
func (c *Core) GetMediaTags(provider string, prefixes []string) ([]media.Tag, error) {
	out := []media.Tag{}
	if prefixes == nil {
		prefixes = []string{}
	}
	if err := c.q.GetMediaTags.Select(&out, provider, pq.StringArray(prefixes)); err != nil {
		return nil, echo.NewHTTPError(http.StatusInternalServerError,
			c.i18n.Ts("globals.messages.errorFetching", "name", "{globals.terms.tags}", "error", pqErrMsg(err)))
	}

	return out, nil
}

// InsertMedia inserts a new media file into the DB.
func (c *Core) InsertMedia(fileName, thumbName, contentType string, meta models.JSON, tags []string, provider string, s media.Store) (media.Media, error) {
	uu, err := uuid.NewV4()
	if err != nil {
		c.log.Printf("error generating UUID: %v", err)
		return media.Media{}, echo.NewHTTPError(http.StatusInternalServerError,
			c.i18n.Ts("globals.messages.errorUUID", "error", err.Error()))
	}

	// Write to the DB.
	var newID int
	if err := c.q.InsertMedia.Get(&newID, uu, fileName, thumbName, contentType, provider, meta, pq.StringArray(normalizeTags(tags))); err != nil {
		c.log.Printf("error inserting uploaded file to db: %v", err)
		return media.Media{}, echo.NewHTTPError(http.StatusInternalServerError,
			c.i18n.Ts("globals.messages.errorCreating", "name", "{globals.terms.media}", "error", pqErrMsg(err)))
	}

	return c.GetMedia(newID, "", "", s)
}

// UpdateMedia updates a media item's tags. The update is scoped to the
// active provider and, when prefixes is non-empty, to the media filename
// prefixes the user is permitted to see (same guard as QueryMedia), so a
// list-restricted user cannot modify another list's media by ID. An item
// outside that scope yields ErrNotFound.
func (c *Core) UpdateMedia(id int, provider string, prefixes, tags []string, s media.Store) (media.Media, error) {
	if prefixes == nil {
		prefixes = []string{}
	}
	res, err := c.q.UpdateMedia.Exec(id, provider, pq.StringArray(prefixes), pq.StringArray(normalizeTags(tags)))
	if err != nil {
		return media.Media{}, echo.NewHTTPError(http.StatusInternalServerError,
			c.i18n.Ts("globals.messages.errorUpdating", "name", "{globals.terms.media}", "error", pqErrMsg(err)))
	}

	if n, _ := res.RowsAffected(); n == 0 {
		return media.Media{}, ErrNotFound
	}

	return c.GetMedia(id, "", "", s)
}

// DeleteMedia deletes a given media item and returns the filename of the deleted item.
func (c *Core) DeleteMedia(id int) (string, error) {
	var fname string
	if err := c.q.DeleteMedia.Get(&fname, id); err != nil {
		c.log.Printf("error inserting uploaded file to db: %v", err)
		return "", echo.NewHTTPError(http.StatusInternalServerError,
			c.i18n.Ts("globals.messages.errorCreating", "name", "{globals.terms.media}", "error", pqErrMsg(err)))
	}

	return fname, nil
}
