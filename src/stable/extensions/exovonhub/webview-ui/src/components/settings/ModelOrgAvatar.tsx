import { useEffect, useState } from 'react';

export const KNOWN_ORG_LOGOS: Record<string, string> = {
  // Foundation Labs (Authentic Hugging Face CDN Logos)
  'qwen': 'https://cdn-avatars.huggingface.co/v1/production/uploads/6215ca5692c0ecfba9186921/hrRM50-6XcdWgg2AKpENG.jpeg',
  'alibaba': 'https://cdn-avatars.huggingface.co/v1/production/uploads/6215ca5692c0ecfba9186921/hrRM50-6XcdWgg2AKpENG.jpeg',
  'nvidia': 'https://cdn-avatars.huggingface.co/v1/production/uploads/65df9200dc3292a8983e5017/Vs5FPVCH-VZBipV3qKTuy.png',
  'meta': 'https://cdn-avatars.huggingface.co/v1/production/uploads/646cf8084eefb026fb8fd8bc/oCTqufkdTkjyGodsx1vo1.png',
  'meta-llama': 'https://cdn-avatars.huggingface.co/v1/production/uploads/646cf8084eefb026fb8fd8bc/oCTqufkdTkjyGodsx1vo1.png',
  'google': 'https://cdn-avatars.huggingface.co/v1/production/uploads/5dd96eb166059660ed1ee413/WtA3YYitedOr9n02eHfJe.png',
  'deepseek': 'https://cdn-avatars.huggingface.co/v1/production/uploads/6538815d1bdb3c40db94fbfa/xMBly9PUMphrFVMxLX4kq.png',
  'deepseek-ai': 'https://cdn-avatars.huggingface.co/v1/production/uploads/6538815d1bdb3c40db94fbfa/xMBly9PUMphrFVMxLX4kq.png',
  'mistral': 'https://cdn-avatars.huggingface.co/v1/production/uploads/634c17653d11eaedd88b314d/9OgyfKstSZtbmsmuG8MbU.png',
  'mistralai': 'https://cdn-avatars.huggingface.co/v1/production/uploads/634c17653d11eaedd88b314d/9OgyfKstSZtbmsmuG8MbU.png',
  'microsoft': 'https://cdn-avatars.huggingface.co/v1/production/uploads/1583646260758-5e64858c87403103f9f1055d.png',
  'bonsai': 'https://cdn-avatars.huggingface.co/v1/production/uploads/6920b71747acb07530915d41/mEaEo0tgAYZn-NB6S-nuP.png',
  'prism-ml': 'https://cdn-avatars.huggingface.co/v1/production/uploads/6920b71747acb07530915d41/mEaEo0tgAYZn-NB6S-nuP.png',
  'liquidai': 'https://cdn-avatars.huggingface.co/v1/production/uploads/61b8e2ba285851687028d395/EsTgVtnM2IqVRKgPdfqcB.png',
  'poolside': 'https://cdn-avatars.huggingface.co/v1/production/uploads/699484cbe85a4b61cbc5ee0f/GpYWuz-CovEFgbPOW21dZ.png',
  'laguna': 'https://cdn-avatars.huggingface.co/v1/production/uploads/699484cbe85a4b61cbc5ee0f/GpYWuz-CovEFgbPOW21dZ.png',
  'flux': 'https://cdn-avatars.huggingface.co/v1/production/uploads/633f7a8f4be90e06da248e0f/m5YoF33abJ09vcwFxt1Mj.png',
  'black-forest-labs': 'https://cdn-avatars.huggingface.co/v1/production/uploads/633f7a8f4be90e06da248e0f/m5YoF33abJ09vcwFxt1Mj.png',
  'bfl': 'https://cdn-avatars.huggingface.co/v1/production/uploads/633f7a8f4be90e06da248e0f/m5YoF33abJ09vcwFxt1Mj.png',
  'stabilityai': 'https://cdn-avatars.huggingface.co/v1/production/uploads/643feeb67bc3fbde1385cc25/7vmYr2XwVcPtkLzac_jxQ.png',
  'openai': 'https://cdn-avatars.huggingface.co/v1/production/uploads/68783facef79a05727260de3/UPX5RQxiPGA-ZbBmArIKq.png',

  // Community Creators & Top Model Providers
  'bartowski': 'https://cdn-avatars.huggingface.co/v1/production/uploads/6435718aaaef013d1aec3b8b/XKf-8MA47tjVAM6SCX0MP.jpeg',
  'mradermacher': 'https://huggingface.co/avatars/96d0c12e8eb411b44ecefc1b6508a420.svg',
  'pollardweights': 'https://cdn-avatars.huggingface.co/v1/production/uploads/644df00416703fd6702ce0b7/8C9kV10RCy_HUuNFJTwo-.jpeg',
  'capibara-llm': 'https://cdn-avatars.huggingface.co/v1/production/uploads/603c35633ffb859aa2a154f2/g-B_D7vutJEjElDEyl5Dq.png',
  'thebloke': 'https://cdn-avatars.huggingface.co/v1/production/uploads/6426d3f3a7723d62b53c259b/tvPikpAzKTKGN5wrpadOJ.jpeg',
  'unsloth': 'https://cdn-avatars.huggingface.co/v1/production/uploads/62ecdc18b72a69615d6bd857/E4lkPz1TZNLzIFr_dR273.png',
  'lmstudio-community': 'https://cdn-avatars.huggingface.co/v1/production/uploads/64445e5f1bc692d87b27e183/Quwh3tlKXa1y7aduVfxZi.png',
  'cohere': 'https://cdn-avatars.huggingface.co/v1/production/uploads/660eb9ff338e9556c90a6bbc/9DrmMdvUZKoHP3hRTngvc.png',
  'cohereforai': 'https://cdn-avatars.huggingface.co/v1/production/uploads/660eb9ff338e9556c90a6bbc/9DrmMdvUZKoHP3hRTngvc.png',
  'allenai': 'https://cdn-avatars.huggingface.co/v1/production/uploads/652db071b62cf1f8463221e2/CxxwFiaomTa1MCX_B7-pT.png',
  '01-ai': 'https://cdn-avatars.huggingface.co/v1/production/uploads/6536187279f1de44b5e02d0f/-T8Xw0mX67_R73b7Re1y-.png',
  'thudm': 'https://cdn-avatars.huggingface.co/v1/production/uploads/63033dc4e1e7f0e03a5e1a31/0BibmRdezvN6v6d2CEtd5.png',
  'snowflake': 'https://cdn-avatars.huggingface.co/v1/production/uploads/64dc52cf858f8a41c12fc819/O9-MWzRjWzbNP_DQlMb-7.png',
  'readyart': 'https://cdn-avatars.huggingface.co/v1/production/uploads/6759e155bc947d6070775cb9/uA_aXyXpBtK9M77jSv0aP.png',
};

const globalAvatarCache: Record<string, string> = { ...KNOWN_ORG_LOGOS };
const inFlightRequests = new Set<string>();

function getFoundationLogoUrl(modelId: string, author?: string): string | null {
  const lowerId = modelId.toLowerCase();
  const lowerAuthor = (author || '').toLowerCase();
  const combined = `${lowerId} ${lowerAuthor}`;

  if (combined.includes('qwen') || combined.includes('alibaba') || combined.includes('tongyi')) {
    return KNOWN_ORG_LOGOS['qwen'];
  }
  if (combined.includes('nemotron') || combined.includes('nvidia') || combined.includes('megatron')) {
    return KNOWN_ORG_LOGOS['nvidia'];
  }
  if (combined.includes('llama') || combined.includes('meta-llama') || combined.includes('meta') || combined.includes('muse-') || combined.includes('opt-')) {
    return KNOWN_ORG_LOGOS['meta'];
  }
  if (combined.includes('gemma') || combined.includes('google') || combined.includes('paligemma') || combined.includes('gecko')) {
    return KNOWN_ORG_LOGOS['google'];
  }
  if (combined.includes('deepseek') || combined.includes('deep-seek')) {
    return KNOWN_ORG_LOGOS['deepseek'];
  }
  if (combined.includes('mistral') || combined.includes('mixtral') || combined.includes('ministral') || combined.includes('codestral') || combined.includes('pixtral')) {
    return KNOWN_ORG_LOGOS['mistral'];
  }
  if (combined.includes('phi-') || combined.includes('phi3') || combined.includes('phi4') || combined.includes('microsoft') || combined.includes('wizardlm')) {
    return KNOWN_ORG_LOGOS['microsoft'];
  }
  if (combined.includes('bonsai') || combined.includes('prism-ml')) {
    return KNOWN_ORG_LOGOS['bonsai'];
  }
  if (combined.includes('liquidai') || combined.includes('liquid') || combined.includes('lfm')) {
    return KNOWN_ORG_LOGOS['liquidai'];
  }
  if (combined.includes('poolside') || combined.includes('laguna')) {
    return KNOWN_ORG_LOGOS['poolside'];
  }
  if (combined.includes('flux') || combined.includes('black-forest-labs') || combined.includes('bfl')) {
    return KNOWN_ORG_LOGOS['flux'];
  }
  if (combined.includes('stability') || combined.includes('stable-diffusion') || combined.includes('sdxl') || combined.includes('sd-') || combined.includes('sd_')) {
    return KNOWN_ORG_LOGOS['stabilityai'];
  }
  if (combined.includes('whisper') || combined.includes('openai') || combined.includes('gpt')) {
    return KNOWN_ORG_LOGOS['openai'];
  }
  return null;
}

export function HuggingFaceLogo({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 95 88" className={className} fill="none">
      <path fill="#FFD21E" d="M47.21 76.5a34.75 34.75 0 1 0 0-69.5 34.75 34.75 0 0 0 0 69.5Z" />
      <path fill="#FF9D0B" d="M81.96 41.75a34.75 34.75 0 1 0-69.5 0 34.75 34.75 0 0 0 69.5 0Zm-73.5 0a38.75 38.75 0 1 1 77.5 0 38.75 38.75 0 0 1-77.5 0Z" />
      <path fill="#3A3B45" d="M58.5 32.3c1.28.44 1.78 3.06 3.07 2.38a5 5 0 1 0-6.76-2.07c.61 1.15 2.55-.72 3.7-.32ZM34.95 32.3c-1.28.44-1.79 3.06-3.07 2.38a5 5 0 1 1 6.76-2.07c-.61 1.15-2.56-.72-3.7-.32Z" />
      <path fill="#FF323D" d="M46.96 56.29c9.83 0 13-8.76 13-13.26 0-2.34-1.57-1.6-4.09-.36-2.33 1.15-5.46 2.74-8.9 2.74-7.19 0-13-6.88-13-2.38s3.16 13.26 13 13.26Z" />
    </svg>
  );
}

export interface ModelOrgAvatarProps {
  modelId: string;
  author?: string;
  className?: string;
}

export function ModelOrgAvatar({ modelId, author, className = 'w-8 h-8' }: ModelOrgAvatarProps) {
  const parts = modelId.split('/');
  const resolvedAuthor = (author || (parts.length > 1 ? parts[0] : '')).toLowerCase().trim();

  // Initial candidate URL resolution:
  // 1. Direct author match in static known logos
  // 2. Cached dynamic author resolution
  // 3. Known foundation lab keyword match
  const initialUrl = resolvedAuthor && globalAvatarCache[resolvedAuthor]
    ? globalAvatarCache[resolvedAuthor]
    : getFoundationLogoUrl(modelId, author);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialUrl);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setLoadError(false);
    if (!resolvedAuthor) {
      setAvatarUrl(getFoundationLogoUrl(modelId, author));
      return;
    }

    if (globalAvatarCache[resolvedAuthor]) {
      setAvatarUrl(globalAvatarCache[resolvedAuthor]);
      return;
    }

    // Check if author matches foundation lab directly
    const foundationLogo = getFoundationLogoUrl(modelId, author);
    if (foundationLogo) {
      setAvatarUrl(foundationLogo);
    }

    if (inFlightRequests.has(resolvedAuthor)) return;
    inFlightRequests.add(resolvedAuthor);

    // Dynamic resolution via Hugging Face API: org first, then user
    (async () => {
      try {
        const orgRes = await fetch(`https://huggingface.co/api/organizations/${encodeURIComponent(resolvedAuthor)}/avatar`);
        if (orgRes.ok) {
          const data = await orgRes.json();
          if (data?.avatarUrl) {
            const finalUrl = data.avatarUrl.startsWith('http') ? data.avatarUrl : `https://huggingface.co${data.avatarUrl}`;
            globalAvatarCache[resolvedAuthor] = finalUrl;
            setAvatarUrl(finalUrl);
            return;
          }
        }

        const userRes = await fetch(`https://huggingface.co/api/users/${encodeURIComponent(resolvedAuthor)}/avatar`);
        if (userRes.ok) {
          const data = await userRes.json();
          if (data?.avatarUrl) {
            const finalUrl = data.avatarUrl.startsWith('http') ? data.avatarUrl : `https://huggingface.co${data.avatarUrl}`;
            globalAvatarCache[resolvedAuthor] = finalUrl;
            setAvatarUrl(finalUrl);
            return;
          }
        }

        // If not found dynamically and no foundation logo, fallback to null
        if (!foundationLogo) {
          setAvatarUrl(null);
        }
      } catch {
        // Network fallback
        if (!foundationLogo) {
          setAvatarUrl(null);
        }
      } finally {
        inFlightRequests.delete(resolvedAuthor);
      }
    })();
  }, [modelId, author, resolvedAuthor]);

  if (avatarUrl && !loadError) {
    return (
      <img
        src={avatarUrl}
        alt={resolvedAuthor || modelId}
        className={`${className} object-contain rounded-md shrink-0`}
        onError={() => setLoadError(true)}
      />
    );
  }

  // Fallback: Clean frameless official Hugging Face logo
  return (
    <div className={`${className} flex items-center justify-center shrink-0`} title={resolvedAuthor || 'Hugging Face'}>
      <HuggingFaceLogo className="w-6 h-6" />
    </div>
  );
}

export default ModelOrgAvatar;
