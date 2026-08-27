/**
 * MotionIR.ts — Intermediate Representation for Astrolabe Motion Studio
 *
 * Serves as the decoupled seam between Theatre.js JSON exports and the ts-morph code emitter.
 */

export interface Keyframe {
  time: number;          // in seconds
  value: number | number[];
  easing: string;        // e.g. "power2.inOut", "power1.in", "none"
}

export interface MotionObject {
  refName: string;       // Matches an editable.* ref in R3F scene
  property: string;      // 'position' | 'rotation' | 'scale' | 'opacity' | custom
  keyframes: Keyframe[];
}

export interface ScrollTriggerConfig {
  sceneId: string;
  startTime: number;
  endTime: number;
  scrollStart: string;    // e.g. "top top"
  scrollEnd: string;      // e.g. "bottom top"
  scrub: boolean | number;
  pin: boolean;
}

export interface MotionIR {
  sceneId: string;
  objects: MotionObject[];
  triggers: ScrollTriggerConfig[];
}

/**
 * Parses raw Theatre.js project JSON or structured Motion JSON into MotionIR.
 * Deterministic mapping with zero LLM involvement.
 */
export function parseTheatreJsonToMotionIR(rawJson: any): MotionIR {
  if (!rawJson || typeof rawJson !== 'object') {
    throw new Error('Invalid Motion Studio JSON input: payload must be a non-null object.');
  }

  // If payload is already structured as MotionIR format
  if (rawJson.sceneId && Array.isArray(rawJson.objects)) {
    return {
      sceneId: String(rawJson.sceneId),
      objects: rawJson.objects.map(parseObject),
      triggers: Array.isArray(rawJson.triggers) ? rawJson.triggers.map(parseTrigger) : []
    };
  }

  // Standard Theatre.js Sheet State export parser
  const sceneId = rawJson.id || rawJson.name || 'defaultScene';
  const objects: MotionObject[] = [];
  const triggers: ScrollTriggerConfig[] = [];

  const sheetsById = rawJson.sheetsById || rawJson.sheets || {};
  for (const sheetKey of Object.keys(sheetsById)) {
    const sheet = sheetsById[sheetKey];
    const staticTracks = sheet?.staticTracksBySequence?.default || {};
    const sequenceTracks = sheet?.sequence?.tracksBySequence?.default || {};

    for (const trackId of Object.keys(sequenceTracks)) {
      const track = sequenceTracks[trackId];
      if (!track) continue;

      // Extract object refName and property from track key (e.g. "boxRef/position/x" or "camera/rotation")
      const parts = trackId.split('/');
      const refName = parts[0] || 'targetRef';
      const property = parts.slice(1).join('.') || 'transform';

      const keyframes: Keyframe[] = [];
      const keyframeData = track.keyframes || track.keyframesByTime || [];

      if (Array.isArray(keyframeData)) {
        for (const kf of keyframeData) {
          keyframes.push({
            time: Number(kf.position ?? kf.time ?? 0),
            value: kf.value,
            easing: mapTheatreEasingToGSAP(kf.handles || kf.easing)
          });
        }
      }

      keyframes.sort((a, b) => a.time - b.time);

      objects.push({
        refName,
        property,
        keyframes
      });
    }
  }

  return {
    sceneId,
    objects,
    triggers
  };
}

function parseObject(obj: any): MotionObject {
  return {
    refName: String(obj.refName || 'meshRef'),
    property: String(obj.property || 'position'),
    keyframes: Array.isArray(obj.keyframes) ? obj.keyframes.map(parseKeyframe) : []
  };
}

function parseKeyframe(kf: any): Keyframe {
  return {
    time: Number(kf.time ?? 0),
    value: kf.value,
    easing: String(kf.easing || 'power1.inOut')
  };
}

function parseTrigger(trig: any): ScrollTriggerConfig {
  return {
    sceneId: String(trig.sceneId || 'mainScene'),
    startTime: Number(trig.startTime ?? 0),
    endTime: Number(trig.endTime ?? 1),
    scrollStart: String(trig.scrollStart || 'top top'),
    scrollEnd: String(trig.scrollEnd || 'bottom top'),
    scrub: trig.scrub ?? true,
    pin: Boolean(trig.pin)
  };
}

/**
 * Maps Theatre.js cubic-bezier handles to GSAP easing strings
 */
function mapTheatreEasingToGSAP(handles: any): string {
  if (!handles || typeof handles !== 'string') {
    return 'power2.inOut';
  }
  if (handles.includes('ease-in-out') || handles.includes('inOut')) return 'power2.inOut';
  if (handles.includes('ease-in') || handles.includes('in')) return 'power2.in';
  if (handles.includes('ease-out') || handles.includes('out')) return 'power2.out';
  if (handles.includes('linear')) return 'none';
  return 'power2.inOut';
}
