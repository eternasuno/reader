package sqlite

import (
	"strings"

	"reader/internal/domain"
)

type keysetColumns struct {
	id   string
	read string
}

var (
	unqualifiedKeysetColumns = keysetColumns{id: "id", read: "read"}
	feedItemKeysetColumns    = keysetColumns{id: "feed_item.id", read: "feed_item.read"}
)

// pageDirection returns the keyset cursor comparison and ORDER BY direction.
func pageDirection(order domain.SortOrder) (string, string) {
	if order == domain.SortOrderOldest {
		return `>`, `ASC`
	}

	return `<`, `DESC`
}

// appendKeysetClauses appends optional unread and cursor predicates using trusted
// column identifiers, builds ORDER BY id ASC|DESC LIMIT ?, and binds parameters.
func appendKeysetClauses(cols keysetColumns, where []string, args []any, params domain.PageParams) (string, string, []any) {
	if params.Unread {
		where = append(where, cols.read+` = 0`)
	}

	comparison, order := pageDirection(params.Order)
	if params.Cursor != nil {
		where = append(where, cols.id+` `+comparison+` ?`)
		args = append(args, *params.Cursor)
	}

	whereClause := ""
	if len(where) > 0 {
		whereClause = ` WHERE ` + strings.Join(where, ` AND `)
	}

	orderLimitClause := ` ORDER BY ` + cols.id + ` ` + order + ` LIMIT ?`
	args = append(args, params.Limit+1)

	return whereClause, orderLimitClause, args
}

// finalizeKeysetPage trims the lookahead row (limit+1) and computes the next cursor.
func finalizeKeysetPage[T any](items []T, limit int, idOf func(T) string) domain.PageResult[T] {
	if len(items) <= limit {
		return domain.PageResult[T]{Items: items}
	}

	trimmed := items[:limit]
	cursor := idOf(trimmed[len(trimmed)-1])

	return domain.PageResult[T]{Items: trimmed, Cursor: &cursor}
}
