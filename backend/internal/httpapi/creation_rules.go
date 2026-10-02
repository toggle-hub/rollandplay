package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strings"
)

type creationChoice struct {
	Attribute string   `json:"attribute"`
	Label     string   `json:"label"`
	Count     int      `json:"count"`
	Options   []string `json:"options"`
}
type creationClass struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Description string           `json:"description,omitempty"`
	Defaults    map[string]any   `json:"defaults"`
	Choices     []creationChoice `json:"choices,omitempty"`
}
type pointBuyRules struct {
	Attributes  []string       `json:"attributes"`
	Min         int            `json:"min"`
	Max         int            `json:"max"`
	Budget      int            `json:"budget"`
	Costs       map[string]int `json:"costs"`
	BonusBudget int            `json:"bonus_budget"`
	BonusMax    int            `json:"bonus_max"`
}

func (p *pointBuyRules) UnmarshalJSON(raw []byte) error {
	var wire struct {
		Attributes  []string        `json:"attributes"`
		Min         *int            `json:"min"`
		Max         *int            `json:"max"`
		Budget      *int            `json:"budget"`
		Costs       map[string]*int `json:"costs"`
		BonusBudget *int            `json:"bonus_budget"`
		BonusMax    *int            `json:"bonus_max"`
	}
	if err := decodeStrictObject(raw, &wire); err != nil {
		return err
	}
	if wire.Min == nil || wire.Max == nil || wire.Budget == nil || wire.BonusBudget == nil || wire.BonusMax == nil || wire.Costs == nil {
		return fmt.Errorf("point allocation requires integer scores, budgets, bonus cap and costs")
	}
	p.Attributes, p.Min, p.Max, p.Budget, p.BonusBudget, p.BonusMax = wire.Attributes, *wire.Min, *wire.Max, *wire.Budget, *wire.BonusBudget, *wire.BonusMax
	p.Costs = make(map[string]int, len(wire.Costs))
	for score, cost := range wire.Costs {
		if cost == nil {
			return fmt.Errorf("score %s requires an integer cost", score)
		}
		p.Costs[score] = *cost
	}
	return nil
}

type creationRules struct {
	Classes  []creationClass `json:"classes,omitempty"`
	PointBuy *pointBuyRules  `json:"point_buy,omitempty"`
}
type characterCreation struct {
	ClassID string              `json:"class_id,omitempty"`
	Scores  map[string]any      `json:"scores,omitempty"`
	Bonuses map[string]any      `json:"bonuses,omitempty"`
	Choices map[string][]string `json:"choices,omitempty"`
}

func decodeStrictObject(raw json.RawMessage, dst any) error {
	if len(raw) == 0 {
		raw = json.RawMessage(`{}`)
	}
	if len(bytes.TrimSpace(raw)) == 0 || bytes.TrimSpace(raw)[0] != '{' {
		return fmt.Errorf("must be a JSON object")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	return decoder.Decode(dst)
}

func distinctNames(names []string) bool {
	seen := make(map[string]bool, len(names))
	for _, name := range names {
		if strings.TrimSpace(name) == "" || seen[name] {
			return false
		}
		seen[name] = true
	}
	return true
}

func parseCreationRules(raw json.RawMessage, attributes map[string]any) (creationRules, error) {
	var rules creationRules
	var wire struct {
		Classes  json.RawMessage `json:"classes"`
		PointBuy json.RawMessage `json:"point_buy"`
	}
	if err := decodeStrictObject(raw, &wire); err != nil {
		return rules, fmt.Errorf("creation rules: %w", err)
	}
	if wire.Classes != nil {
		if bytes.TrimSpace(wire.Classes)[0] != '[' {
			return rules, fmt.Errorf("classes must be a list")
		}
		decoder := json.NewDecoder(bytes.NewReader(wire.Classes))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&rules.Classes); err != nil {
			return rules, fmt.Errorf("classes: %w", err)
		}
	}
	if wire.PointBuy != nil {
		rules.PointBuy = &pointBuyRules{}
		if err := decodeStrictObject(wire.PointBuy, rules.PointBuy); err != nil {
			return rules, fmt.Errorf("point allocation: %w", err)
		}
	}
	owned := map[string]bool{"class": true}
	ids, names := make(map[string]bool), make(map[string]bool)
	for _, class := range rules.Classes {
		if strings.TrimSpace(class.ID) == "" || strings.TrimSpace(class.Name) == "" || ids[class.ID] || names[class.Name] {
			return rules, fmt.Errorf("class IDs and names must be nonblank and unique")
		}
		ids[class.ID], names[class.Name] = true, true
		if class.Defaults == nil {
			return rules, fmt.Errorf("%s: defaults must be an object", class.Name)
		}
		for key := range class.Defaults {
			if strings.TrimSpace(key) == "" || key == "class" {
				return rules, fmt.Errorf("%s: default attributes must be named and cannot be class", class.Name)
			}
			owned[key] = true
		}
		groups := make(map[string]bool)
		for _, choice := range class.Choices {
			if strings.TrimSpace(choice.Attribute) == "" || choice.Attribute == "class" || groups[choice.Attribute] || strings.TrimSpace(choice.Label) == "" {
				return rules, fmt.Errorf("%s: choice groups need unique attributes and labels", class.Name)
			}
			groups[choice.Attribute], owned[choice.Attribute] = true, true
			if choice.Count < 1 || choice.Count > len(choice.Options) || !distinctNames(choice.Options) {
				return rules, fmt.Errorf("%s: invalid choice count or repeated options", choice.Label)
			}
			baseline, exists := class.Defaults[choice.Attribute]
			if !exists {
				baseline, exists = attributes[choice.Attribute]
			}
			if exists {
				group, ok := baseline.(map[string]any)
				if !ok {
					return rules, fmt.Errorf("%s: choice defaults must be a boolean object", choice.Label)
				}
				for _, value := range group {
					if _, ok := value.(bool); !ok {
						return rules, fmt.Errorf("%s: choice defaults must be boolean", choice.Label)
					}
				}
			}
		}
	}
	if p := rules.PointBuy; p != nil {
		if len(p.Attributes) == 0 || !distinctNames(p.Attributes) {
			return rules, fmt.Errorf("point allocation requires unique named attributes")
		}
		for _, key := range p.Attributes {
			if owned[key] {
				return rules, fmt.Errorf("point attribute %s overlaps a class-controlled field", key)
			}
		}
		if p.Min < -1000000 || p.Max > 1000000 || p.Max < p.Min || p.Max-p.Min >= 100 {
			return rules, fmt.Errorf("point allocation range must contain 1 to 100 scores")
		}
		if p.Budget < 0 || p.Budget > 1000000 || p.BonusBudget < 0 || p.BonusBudget > 1000000 || p.BonusMax < 0 || p.BonusMax > 100 {
			return rules, fmt.Errorf("budgets must be 0 to 1000000 and bonus cap 0 to 100")
		}
		if len(p.Costs) != p.Max-p.Min+1 {
			return rules, fmt.Errorf("provide a cumulative cost for every score in the range")
		}
		previous := -1
		for score := p.Min; score <= p.Max; score++ {
			cost, exists := p.Costs[fmt.Sprint(score)]
			if !exists || cost < 0 || cost > 1000000 || cost <= previous || (score == p.Min && cost != 0) {
				return rules, fmt.Errorf("score %d: costs must start at zero and strictly increase", score)
			}
			previous = cost
		}
	}
	return rules, nil
}

func creationInteger(value any) (int, bool) {
	number, ok := value.(float64)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number || number < -1000000 || number > 1000000 {
		return 0, false
	}
	return int(number), true
}

func applyCharacterCreation(attributes map[string]any, rules creationRules, data map[string]any, raw json.RawMessage) (map[string]any, characterCreation, error) {
	var creation characterCreation
	if err := decodeStrictObject(raw, &creation); err != nil {
		return nil, creation, fmt.Errorf("character creation: %w", err)
	}
	result := make(map[string]any, len(attributes)+len(data))
	for key, value := range attributes {
		result[key] = value
	}
	for key, value := range data {
		result[key] = value
	}
	managed := make(map[string]any)
	var selected *creationClass
	for index := range rules.Classes {
		if rules.Classes[index].ID == creation.ClassID {
			selected = &rules.Classes[index]
			break
		}
	}
	if (len(rules.Classes) > 0 || creation.ClassID != "") && selected == nil {
		return nil, creation, fmt.Errorf("choose a valid class from this rule book")
	}
	allowedChoices := make(map[string]bool)
	if selected != nil {
		for key, value := range selected.Defaults {
			managed[key] = value
		}
		managed["class"] = selected.Name
		for _, choice := range selected.Choices {
			allowedChoices[choice.Attribute] = true
			chosen := creation.Choices[choice.Attribute]
			if len(chosen) != choice.Count || !distinctNames(chosen) {
				return nil, creation, fmt.Errorf("%s: choose exactly %d different options", choice.Label, choice.Count)
			}
			options := make(map[string]bool, len(choice.Options))
			baseline, exists := selected.Defaults[choice.Attribute]
			if !exists {
				baseline = attributes[choice.Attribute]
			}
			group := make(map[string]any)
			if values, ok := baseline.(map[string]any); ok {
				for key, value := range values {
					group[key] = value
				}
			}
			for _, option := range choice.Options {
				options[option] = true
				group[option] = false
			}
			for _, option := range chosen {
				if !options[option] {
					return nil, creation, fmt.Errorf("%s: %s is not an eligible option", choice.Label, option)
				}
				group[option] = true
			}
			managed[choice.Attribute] = group
		}
	}
	for key := range creation.Choices {
		if !allowedChoices[key] {
			return nil, creation, fmt.Errorf("unknown choice group %s", key)
		}
	}
	if p := rules.PointBuy; p != nil {
		if len(creation.Scores) != len(p.Attributes) {
			return nil, creation, fmt.Errorf("provide base scores for every point allocation attribute")
		}
		spent, bonusSpent := 0, 0
		allowed := make(map[string]bool, len(p.Attributes))
		for _, attribute := range p.Attributes {
			allowed[attribute] = true
			score, ok := creationInteger(creation.Scores[attribute])
			if !ok || score < p.Min || score > p.Max {
				return nil, creation, fmt.Errorf("%s: base score must be an integer from %d to %d", attribute, p.Min, p.Max)
			}
			bonus := 0
			if value, exists := creation.Bonuses[attribute]; exists {
				bonus, ok = creationInteger(value)
				if !ok || bonus < 0 || bonus > p.BonusMax {
					return nil, creation, fmt.Errorf("%s: bonus must be an integer from 0 to %d", attribute, p.BonusMax)
				}
			}
			spent += p.Costs[fmt.Sprint(score)]
			bonusSpent += bonus
			managed[attribute] = float64(score + bonus)
		}
		for key := range creation.Scores {
			if !allowed[key] {
				return nil, creation, fmt.Errorf("unknown point attribute %s", key)
			}
		}
		for key := range creation.Bonuses {
			if !allowed[key] {
				return nil, creation, fmt.Errorf("unknown bonus attribute %s", key)
			}
		}
		if spent > p.Budget {
			return nil, creation, fmt.Errorf("base scores cost %d points; the budget is %d", spent, p.Budget)
		}
		if bonusSpent > p.BonusBudget {
			return nil, creation, fmt.Errorf("bonuses cost %d points; the bonus budget is %d", bonusSpent, p.BonusBudget)
		}
	} else if len(creation.Scores) > 0 || len(creation.Bonuses) > 0 {
		return nil, creation, fmt.Errorf("this rule book does not define point allocation")
	}
	for key, expected := range managed {
		if value, exists := data[key]; exists && !reflect.DeepEqual(value, expected) {
			return nil, creation, fmt.Errorf("%s is controlled by class or point allocation; use the creation controls", key)
		}
		result[key] = expected
	}
	return result, creation, nil
}

func requestObject(req map[string]any, key string) (map[string]any, error) {
	value, exists := req[key]
	if !exists {
		return map[string]any{}, nil
	}
	object, ok := value.(map[string]any)
	if !ok || object == nil {
		return nil, fmt.Errorf("%s must be a JSON object", key)
	}
	return object, nil
}
