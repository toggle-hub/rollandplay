package ws

import (
	"math"
	"testing"

	"rollandplay/backend/internal/game"
)

func TestIsRigidTransform(t *testing.T) {
	line := []game.Point{{X: 6, Y: 0}, {X: 6, Y: 10}}
	triangle := []game.Point{{X: 0, Y: 0}, {X: 4, Y: 0}, {X: 1, Y: 2}}
	tests := []struct {
		name          string
		current, next []game.Point
		want          bool
	}{
		{"translation", line, []game.Point{{X: 7, Y: 2}, {X: 7, Y: 12}}, true},
		{"quarter turn", line, []game.Point{{X: 11, Y: 5}, {X: 1, Y: 5}}, true},
		{"rounded fifteen degrees", line, []game.Point{{X: 7.29, Y: 0.17}, {X: 4.71, Y: 9.83}}, true},
		{"translated rotated polygon", triangle, []game.Point{{X: 8, Y: 3}, {X: 8, Y: 7}, {X: 6, Y: 4}}, true},
		{"closed polygon with repeated vertex", []game.Point{{X: 0, Y: 0}, {X: 4, Y: 0}, {X: 1, Y: 2}, {X: 0, Y: 0}}, []game.Point{{X: 8, Y: 3}, {X: 8, Y: 7}, {X: 6, Y: 4}, {X: 8, Y: 3}}, true},
		{"single point", []game.Point{{X: 1, Y: 2}}, []game.Point{{X: 3, Y: 4}}, true},
		{"coincident points", []game.Point{{X: 1, Y: 2}, {X: 1, Y: 2}}, []game.Point{{X: 3, Y: 4}, {X: 3, Y: 4}}, true},
		{"resize", line, []game.Point{{X: 6, Y: 0}, {X: 6, Y: 11}}, false},
		{"deformation", triangle, []game.Point{{X: 0, Y: 0}, {X: 4, Y: 0}, {X: 2, Y: 2}}, false},
		{"reflection", triangle, []game.Point{{X: 0, Y: 0}, {X: -4, Y: 0}, {X: -1, Y: 2}}, false},
		{"collapsed line", line, []game.Point{{X: 6, Y: 5}, {X: 6, Y: 5}}, false},
		{"new vertex", line, append(append([]game.Point{}, line...), game.Point{X: 6, Y: 12}), false},
		{"empty", nil, nil, false},
		{"nonfinite target", line, []game.Point{{X: math.NaN(), Y: 0}, {X: 6, Y: 10}}, false},
		{"nonfinite source", []game.Point{{X: math.Inf(1), Y: 0}}, []game.Point{{X: 0, Y: 0}}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isRigidTransform(tt.current, tt.next); got != tt.want {
				t.Fatalf("isRigidTransform(%v, %v) = %v, want %v", tt.current, tt.next, got, tt.want)
			}
		})
	}
}
