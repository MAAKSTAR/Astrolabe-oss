"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExovonSpeedInsights = ExovonSpeedInsights;
const react_1 = require("react");
const web_vitals_1 = require("web-vitals");
function ExovonSpeedInsights({ endpoint = '/_exovon/vitals', sampleRate = 1 } = {}) {
    const hasSent = (0, react_1.useRef)(false);
    const vitals = (0, react_1.useRef)({});
    (0, react_1.useEffect)(() => {
        // Only track in browser environments
        if (typeof window === 'undefined')
            return;
        // Sample rate filter
        if (sampleRate < 1 && Math.random() > sampleRate)
            return;
        const reportVitals = () => {
            if (hasSent.current || Object.keys(vitals.current).length === 0)
                return;
            hasSent.current = true;
            const payload = JSON.stringify(vitals.current);
            // Primary: fetch with keepalive: true and explicit application/json header
            if (typeof fetch === 'function') {
                try {
                    fetch(endpoint, {
                        body: payload,
                        method: 'POST',
                        keepalive: true,
                        headers: { 'Content-Type': 'application/json' },
                        mode: 'cors'
                    }).catch(() => {
                        // Fallback: sendBeacon
                        if (navigator.sendBeacon) {
                            navigator.sendBeacon(endpoint, payload);
                        }
                    });
                    return;
                }
                catch {
                    // Fall through to sendBeacon
                }
            }
            // Secondary Fallback: navigator.sendBeacon
            if (navigator.sendBeacon) {
                navigator.sendBeacon(endpoint, payload);
            }
        };
        (0, web_vitals_1.onLCP)((metric) => { vitals.current.lcp = metric.value; });
        (0, web_vitals_1.onINP)((metric) => { vitals.current.inp = metric.value; });
        (0, web_vitals_1.onCLS)((metric) => { vitals.current.cls = metric.value; });
        (0, web_vitals_1.onFCP)((metric) => { vitals.current.fcp = metric.value; });
        (0, web_vitals_1.onTTFB)((metric) => { vitals.current.ttfb = metric.value; });
        // Send metrics when page unloads or becomes hidden
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                reportVitals();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('pagehide', reportVitals);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('pagehide', reportVitals);
        };
    }, [endpoint, sampleRate]);
    return null;
}
