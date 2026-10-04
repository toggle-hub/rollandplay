package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// Postgres jsonb and Go maps both discard object key order, so rule books and sheets keep the
// order their author wrote in a key_order column ({field: keyOrder}) next to the data. Responses
// include it and the web client re-applies it; storage and game logic never depend on it.

// keyOrder is the key order of one JSON value. Objects list their Keys (and Children for nested
// values that have an order of their own); arrays list one entry per item in Items. Scalars, empty
// objects and arrays without objects have no order and are represented by nil.
type keyOrder struct {
	Keys     []string             `json:"keys,omitempty"`
	Children map[string]*keyOrder `json:"children,omitempty"`
	Items    []*keyOrder          `json:"items,omitempty"`
}

// keyOrderOf reads the key order of a JSON value as written in raw.
func keyOrderOf(raw []byte) (*keyOrder, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	return readKeyOrder(decoder)
}

func readKeyOrder(decoder *json.Decoder) (*keyOrder, error) {
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	delim, isDelim := token.(json.Delim)
	if !isDelim {
		return nil, nil
	}
	switch delim {
	case '{':
		order := &keyOrder{}
		seen := map[string]bool{}
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return nil, err
			}
			key, ok := keyToken.(string)
			if !ok {
				return nil, fmt.Errorf("unexpected object key %v", keyToken)
			}
			child, err := readKeyOrder(decoder)
			if err != nil {
				return nil, err
			}
			// A repeated key keeps its first position; its last value wins, as in jsonb.
			if !seen[key] {
				seen[key] = true
				order.Keys = append(order.Keys, key)
			}
			if child != nil {
				if order.Children == nil {
					order.Children = map[string]*keyOrder{}
				}
				order.Children[key] = child
			} else {
				delete(order.Children, key)
			}
		}
		if _, err := decoder.Token(); err != nil {
			return nil, err
		}
		if len(order.Keys) == 0 {
			return nil, nil
		}
		if len(order.Children) == 0 {
			order.Children = nil
		}
		return order, nil
	case '[':
		var items []*keyOrder
		ordered := false
		for decoder.More() {
			child, err := readKeyOrder(decoder)
			if err != nil {
				return nil, err
			}
			items = append(items, child)
			ordered = ordered || child != nil
		}
		if _, err := decoder.Token(); err != nil {
			return nil, err
		}
		if !ordered {
			return nil, nil
		}
		return &keyOrder{Items: items}, nil
	}
	return nil, fmt.Errorf("unexpected delimiter %v", delim)
}

// withMissingKeys appends, in fallback's order, the object keys fallback has and primary lacks,
// recursively. Sheets use it to place rule book defaults the request did not send.
func withMissingKeys(primary, fallback *keyOrder) *keyOrder {
	if fallback == nil || len(fallback.Keys) == 0 {
		return primary
	}
	if primary == nil {
		return fallback
	}
	if len(primary.Keys) == 0 {
		return primary
	}
	merged := &keyOrder{Keys: append([]string(nil), primary.Keys...), Children: map[string]*keyOrder{}}
	present := make(map[string]bool, len(primary.Keys))
	for _, key := range primary.Keys {
		present[key] = true
		if child := withMissingKeys(primary.Children[key], fallback.Children[key]); child != nil {
			merged.Children[key] = child
		}
	}
	for _, key := range fallback.Keys {
		if present[key] {
			continue
		}
		merged.Keys = append(merged.Keys, key)
		if child := fallback.Children[key]; child != nil {
			merged.Children[key] = child
		}
	}
	if len(merged.Children) == 0 {
		merged.Children = nil
	}
	return merged
}

// readJSONWithRaw decodes a JSON object body and also returns each top-level field's raw bytes,
// which still carry the key order the decoded maps lose.
func readJSONWithRaw(r *http.Request) (map[string]any, map[string]json.RawMessage, error) {
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return nil, nil, err
	}
	var req map[string]any
	if err := json.Unmarshal(body, &req); err != nil {
		return nil, nil, err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, nil, err
	}
	return req, raw, nil
}

// requestKeyOrders returns {field: keyOrder} for the listed fields present in the request. A field
// sent without any order is recorded as null so a later merge replaces its stale order.
func requestKeyOrders(raw map[string]json.RawMessage, fields ...string) (json.RawMessage, error) {
	orders := map[string]*keyOrder{}
	for _, field := range fields {
		value, exists := raw[field]
		if !exists {
			continue
		}
		order, err := keyOrderOf(value)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", field, err)
		}
		orders[field] = order
	}
	return json.Marshal(orders)
}

// sheetKeyOrder is a new sheet's key_order: the data in the order the request wrote it, then the
// rule book defaults it did not send, in the book's order.
func sheetKeyOrder(rawData json.RawMessage, bookOrderJSON json.RawMessage) (json.RawMessage, error) {
	var dataOrder, bookOrder *keyOrder
	if len(rawData) > 0 {
		order, err := keyOrderOf(rawData)
		if err != nil {
			return nil, err
		}
		dataOrder = order
	}
	if len(bookOrderJSON) > 0 {
		if err := json.Unmarshal(bookOrderJSON, &bookOrder); err != nil {
			return nil, err
		}
	}
	return json.Marshal(map[string]*keyOrder{"data": withMissingKeys(dataOrder, bookOrder)})
}
