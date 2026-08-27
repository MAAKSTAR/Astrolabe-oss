import React, { useEffect, useRef } from 'react';
import { onLCP, onINP, onCLS, onFCP, onTTFB } from 'web-vitals';

export interface ExovonSpeedInsightsProps {
  /** Custom endpoint URL if not using the default edge router (e.g. for custom proxies) */
  endpoint?: string;
  /** Custom sample rate between 0 and 1 (default: 1) */
  sampleRate?: number;
}

export function ExovonSpeedInsights({ endpoint = '/_exovon/vitals', sampleRate = 1 }: ExovonSpeedInsightsProps = {}) {
  const hasSent = useRef(false);
  const vitals = useRef<Record<string, number>>({});

  useEffect(() => {
    // Only track in browser environments
    if (typeof window === 'undefined') return;

    // Sample rate filter
    if (sampleRate < 1 && Math.random() > sampleRate) return;

    const reportVitals = () => {
      if (hasSent.current || Object.keys(vitals.current).length === 0) return;
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
        } catch {
          // Fall through to sendBeacon
        }
      }

      // Secondary Fallback: navigator.sendBeacon
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, payload);
      }
    };

    onLCP((metric) => { vitals.current.lcp = metric.value; });
    onINP((metric) => { vitals.current.inp = metric.value; });
    onCLS((metric) => { vitals.current.cls = metric.value; });
    onFCP((metric) => { vitals.current.fcp = metric.value; });
    onTTFB((metric) => { vitals.current.ttfb = metric.value; });

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

