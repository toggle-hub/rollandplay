// Package telemetry wires OpenTelemetry metrics to a Prometheus scrape endpoint.
package telemetry

import (
	"context"
	"net/http"
	"strings"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/prometheus/otlptranslator"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	otelprom "go.opentelemetry.io/otel/exporters/prometheus"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.34.0"
)

const ServiceName = "rollandplay-backend"

// Setup installs the global MeterProvider. Its metrics, together with the Go runtime and
// process collectors of the default Prometheus registry, are served by the returned handler.
func Setup() (http.Handler, func(context.Context) error, error) {
	// Pin classic names (http_server_request_duration_seconds). Otherwise Prometheus 3 negotiates
	// UTF-8 and receives dotted OTel names, which the dashboards and PromQL do not use.
	exporter, err := otelprom.New(otelprom.WithoutScopeInfo(), otelprom.WithTranslationStrategy(otlptranslator.UnderscoreEscapingWithSuffixes))
	if err != nil {
		return nil, nil, err
	}
	provider := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(exporter),
		sdkmetric.WithResource(resource.NewSchemaless(semconv.ServiceName(ServiceName))),
		// otelhttp also records server.address/port from the client-controlled Host header and
		// protocol details; keep only bounded, useful dimensions.
		sdkmetric.WithView(sdkmetric.NewView(
			sdkmetric.Instrument{Name: "http.server.*"},
			sdkmetric.Stream{AttributeFilter: attribute.NewAllowKeysFilter(
				semconv.HTTPRequestMethodKey,
				semconv.HTTPResponseStatusCodeKey,
				semconv.HTTPRouteKey,
			)},
		)),
	)
	otel.SetMeterProvider(provider)
	return promhttp.Handler(), provider.Shutdown, nil
}

// HTTPHandler records http.server.* metrics for next. It must wrap the http.ServeMux without
// replacing the *http.Request in between, so the matched pattern is visible after serving.
func HTTPHandler(next http.Handler) http.Handler {
	return otelhttp.NewHandler(next, "http",
		otelhttp.WithMetricAttributesFn(func(r *http.Request) []attribute.KeyValue {
			if r.Pattern == "" {
				return nil
			}
			// ServeMux patterns look like "GET /api/rooms/{roomID}"; http.route is the path part.
			route := r.Pattern
			if _, path, ok := strings.Cut(route, " "); ok {
				route = path
			}
			return []attribute.KeyValue{semconv.HTTPRoute(route)}
		}),
	)
}
