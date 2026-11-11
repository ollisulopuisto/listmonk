-- media
-- name: insert-media
INSERT INTO media (uuid, filename, thumb, content_type, provider, meta, tags, created_at) VALUES($1, $2, $3, $4, $5, $6, COALESCE($7::TEXT[], '{}'), NOW()) RETURNING id;

-- name: query-media
SELECT COUNT(*) OVER () AS total, * FROM media
    WHERE ($1 = '' OR filename ILIKE $1 OR EXISTS (SELECT 1 FROM UNNEST(tags) AS tag WHERE tag ILIKE $1))
<<<<<<< HEAD
        AND provider=$2
        AND (COALESCE(CARDINALITY($5::TEXT[]), 0) = 0 OR filename ILIKE ANY($5))
        AND (COALESCE(CARDINALITY($6::TEXT[]), 0) = 0 OR tags @> $6::TEXT[])
=======
        AND provider=$2 AND (CARDINALITY($5::TEXT[]) = 0 OR tags @> $5::TEXT[])
>>>>>>> upstream/master
    ORDER BY created_at DESC OFFSET $3 LIMIT $4;

-- name: get-media-tags
SELECT tag, COUNT(DISTINCT id) AS count
    FROM media CROSS JOIN UNNEST(tags) AS tag
<<<<<<< HEAD
    WHERE provider=$1 AND (COALESCE(CARDINALITY($2::TEXT[]), 0) = 0 OR filename ILIKE ANY($2))
    GROUP BY tag ORDER BY tag;
=======
    WHERE provider=$1 GROUP BY tag ORDER BY tag;
>>>>>>> upstream/master

-- name: get-media
SELECT * FROM media WHERE
    CASE
        WHEN $1 > 0 THEN id = $1
        WHEN $2 != '' THEN uuid = $2::UUID
        WHEN $3 != '' THEN filename = $3    
        ELSE false
    END;

-- name: update-media
<<<<<<< HEAD
-- Scoped to the active provider and, when $3 carries permitted filename
-- prefixes (same guard as query-media), to items the user may see. An item
-- outside that scope matches no row and the caller returns 404, so a
-- list-restricted user cannot modify another list's media by ID.
UPDATE media SET tags=$4::TEXT[]
    WHERE id=$1
        AND provider=$2
        AND (COALESCE(CARDINALITY($3::TEXT[]), 0) = 0 OR filename ILIKE ANY($3));
=======
UPDATE media SET tags=$2::TEXT[] WHERE id=$1;
>>>>>>> upstream/master

-- name: delete-media
DELETE FROM media WHERE id=$1 RETURNING filename;

