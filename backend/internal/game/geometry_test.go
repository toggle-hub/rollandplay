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
func TestDistanceAndCone(t *testing.T) {
	if MeasureDistanceMeters(Point{0, 0}, Point{3, 4}) != 5 {
		t.Fatal("distance")
	}
	if !InCone(Point{0, 0}, 0, 90, 10, Point{5, 1}) {
		t.Fatal("point should be in cone")
	}
	if InCone(Point{0, 0}, 0, 45, 10, Point{0, 5}) {
		t.Fatal("point should be outside cone")
	}
}
