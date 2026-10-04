package httpapi

import (
	"encoding/json"
	"testing"
)

func TestKeyOrderOfKeepsWrittenOrderAtEveryDepth(t *testing.T) {
	raw := []byte(`{"strength":10,"level":1,"saves":{"wisdom":true,"charisma":false},"tags":["a","b"],"attacks":[{"name":"Bite","damage":"1d4"},3],"empty":{}}`)
	order, err := keyOrderOf(raw)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := json.Marshal(order)
	want := `{"keys":["strength","level","saves","tags","attacks","empty"],"children":{"attacks":{"items":[{"keys":["name","damage"]},null]},"saves":{"keys":["wisdom","charisma"]}}}`
	if string(got) != want {
		t.Fatalf("key order:\n got %s\nwant %s", got, want)
	}
	if scalar, err := keyOrderOf([]byte(`12`)); err != nil || scalar != nil {
		t.Fatalf("scalars have no order: %v %v", scalar, err)
	}
}

func TestKeyOrderOfRepeatedKeyKeepsFirstPositionAndLastValue(t *testing.T) {
	order, err := keyOrderOf([]byte(`{"a":{"x":1,"y":2},"b":1,"a":5}`))
	if err != nil {
		t.Fatal(err)
	}
	got, _ := json.Marshal(order)
	if string(got) != `{"keys":["a","b"]}` {
		t.Fatalf("repeated key: %s", got)
	}
}

func TestWithMissingKeysAppendsFallbackKeysInFallbackOrder(t *testing.T) {
	primary, _ := keyOrderOf([]byte(`{"name":"Ada","saves":{"wisdom":true}}`))
	fallback, _ := keyOrderOf([]byte(`{"strength":10,"saves":{"strength":false,"wisdom":false},"level":1,"name":""}`))
	got, _ := json.Marshal(withMissingKeys(primary, fallback))
	want := `{"keys":["name","saves","strength","level"],"children":{"saves":{"keys":["wisdom","strength"]}}}`
	if string(got) != want {
		t.Fatalf("merged order:\n got %s\nwant %s", got, want)
	}
}
