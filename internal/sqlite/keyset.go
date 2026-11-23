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
	predicates := append([]string(nil), where...)
	bound := append([]any(nil), args...)

	if params.Unread {
		predicates = append(predicates, cols.read+` = 0`)
	}

	comparison, order := pageDirection(params.Order)
	if params.Cursor != nil {
		predicates = append(predicates, cols.id+` `+comparison+` ?`)
		bound = append(bound, *params.Cursor)
	}

	whereClause := ""
	if len(predicates) > 0 {
		whereClause = ` WHERE ` + strings.Join(predicates, ` AND `)
	}

	orderLimitClause := ` ORDER BY ` + cols.id + ` ` + order + ` LIMIT ?`
	bound = append(bound, params.Limit+1)

	return whereClause, orderLimitClause, bound
}

// finalizeKeysetPage trims the lookahead row (limit+1) and computes the next cursor.
func finalizeKeysetPage[T any](items []T, limit int, idOf func(T) string) domain.PageResult[T] {
	result := domain.PageResult[T]{Items: items}
	if result.Items == nil {
		result.Items = []T{}
	}

	if len(items) <= limit {
		return result
	}

	trimmed := items[:limit]
	cursor := idOf(trimmed[len(trimmed)-1])
	result.Items = trimmed
	result.Cursor = &cursor

	return result
}
