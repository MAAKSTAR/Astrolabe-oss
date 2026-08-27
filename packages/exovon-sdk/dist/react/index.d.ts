export interface ExovonSpeedInsightsProps {
    /** Custom endpoint URL if not using the default edge router (e.g. for custom proxies) */
    endpoint?: string;
    /** Custom sample rate between 0 and 1 (default: 1) */
    sampleRate?: number;
}
export declare function ExovonSpeedInsights({ endpoint, sampleRate }?: ExovonSpeedInsightsProps): null;
