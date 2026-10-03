package game

import "testing"

func TestSegmentIntersection(t *testing.T) {
	if !SegmentIntersects(Segment{Point{0, 0}, Point{2, 2}}, Segment{Point{0, 2}, Point{2, 0}}) {
		t.Fatal("expected intersection")
	}
	if SegmentIntersects(Segment{Point{0, 0}, Point{1, 0}}, Segment{Point{0, 1}, Point{1, 1}}) {
		t.Fatal("unexpected intersection")
	}
}
func TestDistance(t *testing.T) {
	if MeasureDistanceMeters(Point{0, 0}, Point{3, 4}) != 5 {
		t.Fatal("distance")
	}
}
