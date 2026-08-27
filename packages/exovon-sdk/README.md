# @exovon/sdk

The official Node.js / TypeScript SDK and CLI for the Exovon Infrastructure Ecosystem (The Gateway Protocol). 
Designed for enterprise CI/CD automation and Autonomous AI Agents.

## Installation
```bash
npm install @exovon/sdk
```

## AI Agent Integration (llms.txt)
If you are building an AI Agent (like a GPT, Claude, or custom LLM integration), this SDK provides dedicated self-healing, infrastructure-as-code, and introspection methods.

Please see our globally crawlable AI docs at `https://exovon.in/llms.txt` to train your agent on how to use this SDK dynamically.

## CLI Usage
You can run zero-config deployments directly from your terminal:
```bash
export EXOVON_API_KEY="exo_live_..."
npx exovon deploy --project "my-app"
```

## Programmatic Usage

### 1. Initialization
```typescript
import { ExovonClient } from '@exovon/sdk';

const client = new ExovonClient({
    apiKey: process.env.EXOVON_API_KEY
});
```

### 2. Autonomous Deployments & Rollbacks
```typescript
// Deploy
await client.deployments.deploy({ sourceDir: './dist', projectId: 'prod' });

// Fetch Crash Logs (for AI Debugging)
const { logs } = await client.deployments.getCrashLogs('prod', 60);

// Auto-Rollback if tests fail
await client.deployments.rollback('prod');
```

### 3. Agentic Infrastructure
```typescript
// Provision a PostgreSQL DB dynamically
const db = await client.infrastructure.provisionDatabase('prod', { type: 'postgres' });
```

### 4. Secrets Management
```typescript
// Introspect configured keys
const { keys } = await client.secrets.listKeys('prod');

// Update Secrets (4KB Limit)
await client.secrets.update('prod', {
    STRIPE_KEY: 'sk_live_123...'
});
```

---

## ⚡ React & Next.js Core Web Vitals (Speed Insights)

Automatically collect and stream Google-standard $p75$ Core Web Vitals (LCP, INP, CLS, TTFB, FCP) directly to your Exovon project dashboard with zero configuration:

```tsx
// app/layout.tsx or src/App.tsx
import { ExovonSpeedInsights } from '@exovon/sdk/react';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ExovonSpeedInsights />
      </body>
    </html>
  );
}
```

## License
MIT

