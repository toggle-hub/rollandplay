package game

import "math"

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}
type Segment struct {
	A Point `json:"a"`
	B Point `json:"b"`
}
type Polygon struct {
	Points []Point `json:"points"`
}

func DistanceMeters(a, b Point) float64        { return math.Hypot(a.X-b.X, a.Y-b.Y) }
func MeasureDistanceMeters(a, b Point) float64 { return math.Round(DistanceMeters(a, b)*100) / 100 }

func SegmentIntersects(a, b Segment) bool {
	const eps = 1e-9
	d1 := orient(a.A, a.B, b.A)
	d2 := orient(a.A, a.B, b.B)
	d3 := orient(b.A, b.B, a.A)
	d4 := orient(b.A, b.B, a.B)
	if ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps)) {
		return true
	}
	return math.Abs(d1) <= eps && onSegment(a.A, b.A, a.B) || math.Abs(d2) <= eps && onSegment(a.A, b.B, a.B) || math.Abs(d3) <= eps && onSegment(b.A, a.A, b.B) || math.Abs(d4) <= eps && onSegment(b.A, a.B, b.B)
}

func orient(a, b, c Point) float64 { return (b.X-a.X)*(c.Y-a.Y) - (b.Y-a.Y)*(c.X-a.X) }
func onSegment(a, p, b Point) bool {
	return p.X >= math.Min(a.X, b.X)-1e-9 && p.X <= math.Max(a.X, b.X)+1e-9 && p.Y >= math.Min(a.Y, b.Y)-1e-9 && p.Y <= math.Max(a.Y, b.Y)+1e-9
}

func PointInPolygon(p Point, poly Polygon) bool {
	inside := false
	n := len(poly.Points)
	for i, j := 0, n-1; i < n; j, i = i, i+1 {
		pi, pj := poly.Points[i], poly.Points[j]
		if ((pi.Y > p.Y) != (pj.Y > p.Y)) && (p.X < (pj.X-pi.X)*(p.Y-pi.Y)/(pj.Y-pi.Y)+pi.X) {
			inside = !inside
		}
	}
	return inside
}

func InCone(origin Point, rotationDeg, angleDeg, rangeM float64, target Point) bool {
	d := DistanceMeters(origin, target)
	if d > rangeM+1e-9 {
		return false
	}
	if angleDeg >= 360 {
		return true
	}
	ang := math.Atan2(target.Y-origin.Y, target.X-origin.X) * 180 / math.Pi
	diff := math.Mod(ang-rotationDeg+540, 360) - 180
	return math.Abs(diff) <= angleDeg/2+1e-9
}

func RaySegmentIntersection(origin Point, angleRad float64, seg Segment) (Point, bool, float64) {
	r := Point{math.Cos(angleRad), math.Sin(angleRad)}
	s := Point{seg.B.X - seg.A.X, seg.B.Y - seg.A.Y}
	den := r.X*s.Y - r.Y*s.X
	if math.Abs(den) < 1e-9 {
		return Point{}, false, 0
	}
	qp := Point{seg.A.X - origin.X, seg.A.Y - origin.Y}
	t := (qp.X*s.Y - qp.Y*s.X) / den
	u := (qp.X*r.Y - qp.Y*r.X) / den
	if t >= 0 && u >= -1e-9 && u <= 1+1e-9 {
		return Point{origin.X + t*r.X, origin.Y + t*r.Y}, true, t
	}
	return Point{}, false, 0
}
