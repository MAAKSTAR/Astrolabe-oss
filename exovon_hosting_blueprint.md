# Exovon Hosting — Master Platform Blueprint
**Version:** 1.0 | **Date:** June 2026 | **Author:** Ayan / Exovon Technologies  
**Status:** Pre-build reference. Every architectural decision in this document is final until explicitly revised.

---

## Table of Contents

1. [Platform Summary](#1-platform-summary)
2. [Technology Stack — Every Service](#2-technology-stack--every-service)
3. [IAM and Service Accounts](#3-iam-and-service-accounts)
4. [Architecture — All 7 Layers](#4-architecture--all-7-layers)
5. [Build Pipeline — Exact Steps](#5-build-pipeline--exact-steps)
6. [Deploy Pipeline — Exact Steps](#6-deploy-pipeline--exact-steps)
7. [Routing Architecture — Correct Implementation](#7-routing-architecture--correct-implementation)
8. [Static File Serving](#8-static-file-serving)
9. [Domain Management](#9-domain-management)
10. [SSL — Cloudflare for SaaS](#10-ssl--cloudflare-for-saas)
11. [Environment Variables and Secrets](#11-environment-variables-and-secrets)
12. [Health Checks and Auto-Rollback](#12-health-checks-and-auto-rollback)
13. [Rollback Mechanism](#13-rollback-mechanism)
14. [Project Deletion Pipeline](#14-project-deletion-pipeline)
15. [Security Checklist — Every Requirement](#15-security-checklist--every-requirement)
16. [Financial Safeguards — Every Cost Control](#16-financial-safeguards--every-cost-control)
17. [Build Caching](#17-build-caching)
18. [Free Tier Rules](#18-free-tier-rules)
19. [Cleanup Policies](#19-cleanup-policies)
20. [Firestore Data Model](#20-firestore-data-model)
21. [Monthly Cost Reference](#21-monthly-cost-reference)
22. [What Not to Build at Launch](#22-what-not-to-build-at-launch)

---

## 1. Platform Summary

Exovon Hosting is a Vercel-like web and web app deployment platform built entirely on GCP,
targeting Indian developers at rupee-denominated pricing. It is a wrapper platform — it does
not own server racks. All compute runs on GCP in the asia-south1 (Mumbai) region.

**Core value proposition:**
- Deploy any Node.js, static, or containerised project with one click from MobCode IDE, astrolabe (exovon extension)
- Custom domains with instant SSL (no 24-hour wait)
- Preview URLs for every deployment
- One-click rollback to any previous deployment
- INR pricing, UPI payment support, GCP Mumbai data residency

**What it is not:**
- It is not a Kubernetes platform
- It is not a database hosting service
- It does not host PHP, Python, or Ruby at launch (Node.js and static only)

---

## 2. Technology Stack — Every Service

### GCP Services

| Service | Role | Region |
|---|---|---|
| Cloud Run | Orchestrator, Router, and all user dynamic app services | asia-south1 |
| Cloud Build | Executes user build jobs in isolated private pool | asia-south1 |
| Cloud Storage (GCS) | Stores build zips, static site output, build logs | asia-south1 |
| Artifact Registry | Stores Docker container images for dynamic apps | asia-south1 |
| Firestore | Routing table, project metadata, build status, domain records | nam5 (multi-region) |
| Secret Manager | Stores user environment variables per project | asia-south1 |
| Pub/Sub | Carries build status and log events from Cloud Build to Orchestrator | asia-south1 |
| Cloud Monitoring | Alerts on billing, error rates, and infrastructure health | global |

### Cloudflare Services

| Service | Role |
|---|---|
| Cloudflare (zone for exovon.host) | DNS, global CDN, DDoS protection, rate limiting |
| Cloudflare for SaaS (Custom Hostnames) | SSL provisioning and routing for user custom domains |

### NOT used at launch

- Cloud CDN: Cloudflare handles edge caching. Cloud CDN is redundant.
- Cloud Load Balancer: Cloud Run services have native HTTPS endpoints. Not needed.
- GKE: Overkill. Cloud Run is sufficient.
- Cloud Functions: Pub/Sub subscription handled by Orchestrator on Cloud Run instead.
- Cloud Armor: Add later when DDoS becomes a real threat.
- Redis / Memorystore: Not needed until ISR is supported.

---

## 3. IAM and Service Accounts

This is the most security-critical section. Every service account is minimal by design.
Never use the Compute Engine default service account for anything.

### 3.1 Service Accounts to Create

```
SA-1: exovon-orchestrator-sa@PROJECT.iam.gserviceaccount.com
SA-2: exovon-router-sa@PROJECT.iam.gserviceaccount.com
SA-3: exovon-build-sa@PROJECT.iam.gserviceaccount.com
SA-4: exovon-user-app-sa@PROJECT.iam.gserviceaccount.com   (shared by ALL user Cloud Run services)
```

### 3.2 IAM Bindings — SA-1 (Orchestrator)

```
roles/run.admin                          # Deploy Cloud Run services
roles/cloudbuild.builds.editor           # Trigger Cloud Build jobs
roles/storage.objectAdmin                # Read/write GCS buckets
roles/artifactregistry.writer            # Push/delete images
roles/secretmanager.admin                # Create/delete/update secrets
roles/datastore.user                     # Read/write Firestore
roles/pubsub.publisher                   # Publish build events
roles/monitoring.viewer                  # Read Cloud Monitoring metrics for auto-rollback
```

### 3.3 IAM Bindings — SA-2 (Router)

```
roles/datastore.viewer                   # Read-only Firestore (routing table)
```

That is the complete list. Router reads Firestore. That is all it does.

### 3.4 IAM Bindings — SA-3 (Build Workers)

```
roles/artifactregistry.writer            # Push built container image
roles/storage.objectCreator              # Write build output to GCS static bucket
```

No other permissions. Build workers cannot read Firestore, cannot call Cloud Run API,
cannot access Secret Manager. If a user steals this token, they can push a container image
and write to one GCS bucket. Nothing else.

### 3.5 IAM Bindings — SA-4 (User App)

```
(no bindings)
```

Zero IAM roles. This service account exists only so that user Cloud Run services do not
run under the Compute Engine default SA. If a user's app exploits SSRF to hit the GCP
metadata server and steal this token, the token has zero permissions.

### 3.6 Org Policy to Enforce Private Pool Only

```
constraints/cloudbuild.allowedWorkerPools
  → allow: projects/YOUR_PROJECT_ID/workerPools/exovon-private-pool
```

This org policy prevents any Cloud Build trigger from using the default pool. Every build
must use the private pool. Non-negotiable.

---

## 4. Architecture — All 7 Layers

```
LAYER 1: DEPLOY TRIGGER
  MobCode IDE/astrolabe                    Git Webhook                  Exovon Dashboard
       |                               |                              |
       └───────────────────────────────┴──────────────────────────────┘
                                       |
                    POST /api/deploy/request → Orchestrator (Cloud Run)
                                       |
                    Response: { deployId, gcsUploadUrl }
                                       |
                    IDE streams zip → GCS pre-signed URL (bypasses Orchestrator)
                                       |
                    POST /api/deploy/start { deployId }

LAYER 2: BUILD PIPELINE
                    Orchestrator triggers Cloud Build job
                    Source: gs://exovon-builds/zips/{deployId}.zip
                    Private pool: exovon-private-pool
                    Service account: exovon-build-sa
                    Timeout: 600s (hard limit, non-negotiable)
                    Egress: NO_PUBLIC_EGRESS
                    npm registry: Artifact Registry npm proxy (internal)
                            |
                    Detect project type (static vs Node.js vs Dockerfile)
                            |
                    Run build command
                            |
                    Publish status → Pub/Sub topic: exovon-build-events

LAYER 3: ARTIFACT STORAGE
                    IF STATIC:
                      Upload dist/ → gs://exovon-static/deploys/{deployId}/
                    IF DYNAMIC:
                      Push image → asia-south1-docker.pkg.dev/PROJECT/apps/{userId}:{deployId}

LAYER 4: COMPUTE ACTIVATION
                    Orchestrator receives "build succeeded" from Pub/Sub

                    IF STATIC:
                      Write Firestore routing entry (type: static)
                      Cloudflare cache purge for affected domain paths

                    IF DYNAMIC:
                      Deploy Cloud Run revision:
                        --image={artifactRegistryPath}
                        --tag={deployId}          ← gives preview URL
                        --no-traffic              ← 0% traffic until health confirmed
                        --service-account=exovon-user-app-sa
                        --ingress=internal         ← CRITICAL: blocks direct .run.app access
                        --max-instances=10         ← per-tier limit, non-negotiable
                        --memory=512Mi
                        --cpu=1
                        --timeout=30
                        --set-secrets from Secret Manager
                        --startup-probe (TCP, port 8080)
                      Poll Cloud Run API: wait for revision status = READY
                      Shift 100% traffic to new revision
                      Monitor error rate for 60 seconds (auto-rollback threshold: 40%)
                      Write Firestore routing entry (type: dynamic)

LAYER 5: ROUTING (every user request)
                    Request hits Cloudflare edge
                      → SSL terminated at Cloudflare
                      → Cloudflare checks: is this a known custom hostname?
                      → Routes to Cloud Run Router (the single always-on proxy service)

                    Cloud Run Router (min-instances: 1, internal load never cold-starts):
                      Step 1: Check initialLoadComplete flag
                        → If false: return HTTP 503 with Retry-After: 2
                      Step 2: Lookup Host header in in-memory routing table
                        → If not found: return HTTP 404
                      Step 3a: If type = static
                        → Return HTTP 302 to public GCS URL
                        → gs://exovon-static/deploys/{deployId}/{path}
                      Step 3b: If type = dynamic
                        → Proxy request to Cloud Run service URL (internal GCP network)
                        → Return response to Cloudflare

LAYER 6: CDN
                    Static assets: Cloudflare caches GCS responses at 310+ global PoPs
                      → Cache-Control: max-age=31536000, immutable (hashed assets)
                      → Cache-Control: no-cache (index.html only)
                    Dynamic requests: pass through Cloudflare to Router to Cloud Run
                      → Not cached (user-specific)

LAYER 7: END USER
                    myapp.exovon.host          → wildcard subdomain → Cloudflare → Router
                    customer.com               → custom domain → Cloudflare for SaaS → Router
                    {deployId}.exovon.host     → preview URL → Router → specific revision
```

---

## 5. Build Pipeline — Exact Steps

### Step 1: Client requests upload URL

```
POST /api/deploy/request
Headers: { Authorization: Bearer <Firebase ID token> }
Body: { projectId, framework, buildCommand, outputDir }

Response:
{
  deployId: "d8a3f2c1",             // UUID v4, cryptographically random
  gcsUploadUrl: "<pre-signed URL>", // valid for 15 minutes, single use
  expiresAt: "2026-06-01T12:15:00Z"
}
```

Orchestrator writes to Firestore:
```
/deployments/{deployId}
  status: "awaiting_upload"
  userId: "uid_abc"
  projectId: "proj_xyz"
  createdAt: serverTimestamp()
  type: null  (unknown until build runs)
```

### Step 2: Client uploads zip directly to GCS

Client streams the project zip to the pre-signed GCS URL.
Orchestrator never touches the raw zip bytes.
Max zip size enforced by GCS pre-signed URL: 150MB hard limit.

### Step 3: Client signals upload complete

```
POST /api/deploy/start
Body: { deployId }
```

Orchestrator verifies the GCS object exists, then triggers Cloud Build.

### Step 4: Cloud Build job config

```yaml
steps:
  - name: gcr.io/cloud-builders/gsutil
    args: ['cp', 'gs://exovon-builds/zips/${_DEPLOY_ID}.zip', '/workspace/source.zip']

  - name: gcr.io/cloud-builders/gsutil
    args: ['cp', 'gs://exovon-builds/zips/${_DEPLOY_ID}.zip', '/tmp/source.zip']
    entrypoint: bash
    args:
      - -c
      - unzip /workspace/source.zip -d /workspace/app

  - name: 'gcr.io/google-cloudsdktool/cloud-sdk'
    entrypoint: bash
    args:
      - -c
      - |
        cd /workspace/app
        # Detect project type
        if [ -f "Dockerfile" ]; then
          echo "DOCKERFILE" > /workspace/project_type
        elif [ -f "package.json" ] && grep -q '"start"' package.json; then
          echo "NODEJS" > /workspace/project_type
        else
          echo "STATIC" > /workspace/project_type
        fi

  # For STATIC projects:
  - name: 'node:20-alpine'
    entrypoint: bash
    args:
      - -c
      - |
        cd /workspace/app
        npm ci --registry=https://asia-south1-npm.pkg.dev/PROJECT/npm-proxy/
        npm run build
        gsutil -m cp -r ${_OUTPUT_DIR}/** gs://exovon-static/deploys/${_DEPLOY_ID}/

  # For NODEJS/DOCKERFILE projects:
  - name: 'gcr.io/kaniko-project/executor:latest'
    args:
      - --destination=asia-south1-docker.pkg.dev/PROJECT/apps/${_USER_ID}:${_DEPLOY_ID}
      - --cache=true
      - --cache-repo=asia-south1-docker.pkg.dev/PROJECT/kaniko-cache
      - --context=/workspace/app

options:
  serviceAccount: projects/PROJECT/serviceAccounts/exovon-build-sa@PROJECT.iam.gserviceaccount.com
  pool:
    name: projects/PROJECT/locations/asia-south1/workerPools/exovon-private-pool
  env:
    - GOOGLE_CACHEBUCKET=gs://exovon-buildpack-cache

timeout: 600s

substitutions:
  _DEPLOY_ID: ""
  _USER_ID: ""
  _OUTPUT_DIR: "dist"

pubsubConfig:
  topic: projects/PROJECT/topics/exovon-build-events
```

### Step 5: Build status tracking

Cloud Build publishes to Pub/Sub on every status change.
Orchestrator subscribes and updates Firestore:

```
/deployments/{deployId}
  status: "building" | "succeeded" | "failed" | "timeout"
  buildId: "<Cloud Build build ID>"
  logPath: "gs://exovon-build-logs/{deployId}/log.txt"
  updatedAt: serverTimestamp()
```

### Step 6: Build log storage

Build logs stream to: `gs://exovon-build-logs/{deployId}/log.txt`
This path is never public. Served only via authenticated API endpoint.
Path is non-guessable because deployId is UUID v4.

---

## 6. Deploy Pipeline — Exact Steps

Triggered when Orchestrator receives "build succeeded" Pub/Sub message.

### Static Deploy

```
1. Verify GCS path exists: gs://exovon-static/deploys/{deployId}/index.html
2. Write Firestore routing entry:
   /projects/{userId}/{projectId}/deployments/{deployId}
     type: "static"
     gcsPath: "deploys/{deployId}"
     status: "ready"
     createdAt: serverTimestamp()

3. Update project production pointer:
   /projects/{userId}/{projectId}
     productionDeployId: "{deployId}"
     updatedAt: serverTimestamp()

4. Purge Cloudflare cache for affected domain (API call to Cloudflare)
5. Write deploy event to dashboard stream
6. Trigger cleanup: delete deployments older than last 5 (see Section 19)
```

### Dynamic Deploy

```
1. Deploy Cloud Run revision with --no-traffic:
   gcloud run deploy {serviceId} \
     --image=asia-south1-docker.pkg.dev/PROJECT/apps/{userId}:{deployId} \
     --region=asia-south1 \
     --tag={deployId} \
     --no-traffic \
     --service-account=exovon-user-app-sa@PROJECT.iam.gserviceaccount.com \
     --ingress=internal \
     --max-instances=10 \
     --memory=512Mi \
     --cpu=1 \
     --concurrency=80 \
     --timeout=30 \
     --set-secrets=ENV_VARS=projects/PROJECT/secrets/{userId}-{projectId}-envvars:latest \
     --startup-probe-type=tcp \
     --startup-probe-port=8080 \
     --startup-probe-period=1 \
     --startup-probe-failure-threshold=10

2. Poll Cloud Run revisions API every 2 seconds:
   GET /apis/serving.knative.dev/v1/namespaces/PROJECT/revisions/{revisionName}
   Wait for: status.conditions[Ready].status = "True"
   Timeout: 120 seconds. If timeout reached → mark deploy as failed.

3. Health check window: 60 seconds
   During this window, shift 10% traffic to new revision as a canary:
   gcloud run services update-traffic {serviceId} \
     --to-tags={deployId}=10,LATEST=90

4. Monitor error rate for 60 seconds:
   Query Cloud Monitoring:
     metric: run.googleapis.com/request_count
     filter: resource.labels.revision_name = "{revisionName}"
             AND metric.labels.response_code_class != "2xx"
   
   If (error_count / total_count) > 0.40 during the 60s window:
     → Auto-rollback (see Section 13)
     → Mark deploy as "failed_health_check"

5. If health check passes:
   Shift 100% traffic to new revision:
   gcloud run services update-traffic {serviceId} \
     --to-revisions={revisionName}=100

6. Write Firestore routing entry:
   /projects/{userId}/{projectId}/deployments/{deployId}
     type: "dynamic"
     cloudRunService: "https://{serviceId}-xxxxxx-el.a.run.app"
     cloudRunRevision: "{revisionName}"
     status: "ready"
     createdAt: serverTimestamp()

7. Update project production pointer:
   /projects/{userId}/{projectId}
     productionDeployId: "{deployId}"

8. Trigger cleanup: delete revisions older than last 5 (see Section 19)
```

---

## 7. Routing Architecture — Correct Implementation

The Router is a single Cloud Run service (min-instances: 1) that handles ALL incoming
traffic for ALL users. It runs under SA-2 (read-only Firestore access only).

### 7.1 Startup Sequence (Three-Layer Safety)

```javascript
// router/src/server.js

let routingTable = new Map()  // key: hostname, value: { type, gcsPath | cloudRunUrl, deployId }
let initialLoadComplete = false

async function loadRoutingTable() {
  // Layer 1: Fast REST fetch on startup (not onSnapshot — too slow for startup)
  const snapshot = await admin.firestore().collection('routing').get()
  snapshot.forEach(doc => {
    routingTable.set(doc.id, doc.data())
  })
  initialLoadComplete = true
  console.log(`Routing table loaded: ${routingTable.size} entries`)

  // Layer 2: Subscribe to live changes after initial load
  admin.firestore().collection('routing').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'removed') {
        routingTable.delete(change.doc.id)
      } else {
        routingTable.set(change.doc.id, change.doc.data())
      }
    })
  })
}

// Start loading immediately on boot
loadRoutingTable().catch(err => {
  console.error('Fatal: routing table load failed', err)
  process.exit(1)  // Let Cloud Run restart the container
})

// Readiness endpoint for startup probe
app.get('/readiness', (req, res) => {
  if (!initialLoadComplete) {
    return res.status(503).set('Retry-After', '2').send('Loading routing table')
  }
  res.status(200).send('OK')
})

// Main routing handler
app.use(async (req, res) => {
  // Layer 3: Runtime guard (belt-and-suspenders)
  if (!initialLoadComplete) {
    return res.status(503).set('Retry-After', '2').send('Starting')
  }

  const hostname = req.headers.host?.toLowerCase().split(':')[0]

  // Strip www prefix
  const lookupKey = hostname?.startsWith('www.')
    ? hostname.slice(4)
    : hostname

  const route = routingTable.get(lookupKey)

  if (!route) {
    return res.status(404).send('Domain not found')
  }

  if (route.type === 'static') {
    // 302 redirect to GCS — Router never proxies static bytes
    const gcsUrl = `https://storage.googleapis.com/exovon-static/${route.gcsPath}${req.path}`
    return res.redirect(302, gcsUrl)
  }

  if (route.type === 'dynamic') {
    // Proxy to Cloud Run service (internal GCP network, no egress charge)
    return proxyToCloudRun(route.cloudRunUrl, req, res)
  }

  return res.status(500).send('Invalid route configuration')
})
```

### 7.2 Cloud Run Router Configuration

```yaml
# router-service.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: exovon-router
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "1"
        autoscaling.knative.dev/maxScale: "20"
    spec:
      serviceAccountName: exovon-router-sa@PROJECT.iam.gserviceaccount.com
      containerConcurrency: 1000
      containers:
        - image: asia-south1-docker.pkg.dev/PROJECT/platform/router:latest
          ports:
            - containerPort: 8080
          resources:
            limits:
              memory: 512Mi
              cpu: "1"
          startupProbe:
            httpGet:
              path: /readiness
              port: 8080
            periodSeconds: 1
            failureThreshold: 30    # 30 seconds max startup time
            timeoutSeconds: 2
          livenessProbe:
            httpGet:
              path: /readiness
              port: 8080
            periodSeconds: 10
            failureThreshold: 3
```

### 7.3 Firestore Routing Collection Structure

```
/routing/{hostname}
  type: "static" | "dynamic"
  deployId: "d8a3f2c1"
  userId: "uid_abc"
  projectId: "proj_xyz"

  # For static:
  gcsPath: "deploys/d8a3f2c1"

  # For dynamic:
  cloudRunUrl: "https://svc-proj-xyz-xxxxxx-el.a.run.app"
  cloudRunRevision: "svc-proj-xyz-00005-abc"

  updatedAt: timestamp
```

Keys in this collection are exact hostnames:
- `myapp.exovon.host`
- `customer.com`
- `d8a3f2c1.exovon.host`

One document per domain. Router lookups are O(1) hashmap reads after initial load.

---

## 8. Static File Serving

**The Router NEVER proxies static file bytes. It only issues a 302 redirect.**

Flow for a static site request:
```
User requests: https://myapp.exovon.host/assets/main.a3f9c2.js
  ↓
Cloudflare: checks its cache for this URL
  ↓ (cache miss, first request)
Cloudflare forwards to Router
  ↓
Router: looks up myapp.exovon.host → type: static, gcsPath: "deploys/d8a3f2c1"
  ↓
Router: returns HTTP 302 to:
  https://storage.googleapis.com/exovon-static/deploys/d8a3f2c1/assets/main.a3f9c2.js
  ↓
Cloudflare follows redirect, fetches from GCS, caches the response at edge
  ↓ (all subsequent requests)
Cloudflare serves from cache. GCS is never hit again for this file.
Router is never hit again for this file.
```

### GCS Bucket Cache Headers

All static files must be uploaded with these metadata headers during the build step:

```bash
# Hashed asset files (JS, CSS, images with hash in filename)
gsutil -m setmeta \
  -h "Cache-Control:public, max-age=31536000, immutable" \
  "gs://exovon-static/deploys/${DEPLOY_ID}/assets/**"

# HTML files (never hash-named, must always revalidate)
gsutil -m setmeta \
  -h "Cache-Control:public, no-cache, must-revalidate" \
  "gs://exovon-static/deploys/${DEPLOY_ID}/*.html"
  "gs://exovon-static/deploys/${DEPLOY_ID}/**/*.html"
```

### GCS Bucket Configuration

```
Bucket name: exovon-static
Location: asia-south1
Storage class: Standard
Public access: Uniform — allUsers: roles/storage.objectViewer
  (Objects are public read but path structure is non-guessable via deployId)
Versioning: Disabled (immutable deploys, no need)
Lifecycle: See Section 19
```

---

## 9. Domain Management

### 9.1 Platform Subdomains (*.exovon.host)

Handled entirely via Cloudflare DNS. One wildcard CNAME record:

```
Type: CNAME
Name: *
Target: exovon-router-xxxxxx-el.a.run.app    ← Cloud Run Router URL
TTL: Auto
Proxy: Yes (orange cloud)
```

All subdomains (myapp.exovon.host, abc123.exovon.host, preview-id.exovon.host) resolve to
the Router automatically. No per-subdomain configuration ever needed.

### 9.2 User Custom Domain Flow

When a user adds their domain (e.g., customer.com) in the dashboard:

**Step 1: Platform registers the domain with Cloudflare for SaaS API**
```
POST https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/custom_hostnames
{
  "hostname": "customer.com",
  "ssl": {
    "method": "http",
    "type": "dv",
    "settings": { "min_tls_version": "1.2" }
  },
  "custom_origin_server": "exovon-router-xxxxxx-el.a.run.app"
}

Response: { "id": "abc-cf-hostname-id", "ownership_verification": { "type": "txt", "name": "_cf-custom-hostname.customer.com", "value": "XXXX" } }
```

**Step 2: Platform stores verification data in Firestore**
```
/domains/{hostname}
  status: "pending_verification"
  cloudflareHostnameId: "abc-cf-hostname-id"
  verificationTxtName: "_cf-custom-hostname.customer.com"
  verificationTxtValue: "XXXX"
  userId: "uid_abc"
  projectId: "proj_xyz"
  createdAt: timestamp
```

**Step 3: Dashboard shows user two DNS records to add**
```
Record 1 (CNAME — point domain to platform):
  Type: CNAME
  Name: customer.com (or @ for apex)
  Value: custom.exovon.host

Record 2 (TXT — prove domain ownership to Cloudflare):
  Type: TXT
  Name: _cf-custom-hostname.customer.com
  Value: XXXX
```

**Step 4: Orchestrator polls Cloudflare hostname status every 60 seconds**
```
GET /zones/{ZONE_ID}/custom_hostnames/{HOSTNAME_ID}

When status = "active":
  → Update Firestore /domains/{hostname}: status = "active"
  → Write routing entry: /routing/customer.com → { type, cloudRunUrl, ... }
  → Domain is live. SSL is already provisioned by Cloudflare.
```

### 9.3 Apex Domain Limitation

Apex domains (customer.com rather than sub.customer.com) require the user to use a DNS
provider that supports CNAME flattening (Cloudflare, Route53, DNSimple).

Standard DNS providers (GoDaddy, Namecheap default) cannot CNAME an apex domain.
Dashboard must warn users about this explicitly.

Recommended user instruction: "Transfer your domain's DNS nameservers to Cloudflare (free)
for instant apex domain support."

---

## 10. SSL — Cloudflare for SaaS

**Platform subdomains (*.exovon.host):**
Wildcard SSL certificate issued to Cloudflare for the exovon.host zone.
Zero setup. Covers all platform subdomains automatically.

**User custom domains:**
Cloudflare for SaaS provisions a DV SSL certificate per domain.
Provisioning time: under 5 minutes in most cases.
The user's site is available over HTTPS within minutes of DNS propagation.

**Pricing (June 2026):**
- First 100 custom hostnames: included free
- Additional: $0.10 per hostname per month
- At 500 users with 250 custom domains: 150 × $0.10 = $15/month

**What is NOT supported without Enterprise:**
- Wildcard custom hostnames (*.customer.com) — Enterprise only
- Apex CNAME at DNS providers that do not support flattening — user-side limitation

---

## 11. Environment Variables and Secrets

### 11.1 Storage Model

All environment variables for a project are stored as a **single JSON object** in one Secret
Manager secret. One secret per project. Never one secret per variable.

```
Secret name: {userId}-{projectId}-envvars
Secret value: {"DATABASE_URL":"postgres://...","API_KEY":"sk-...","NODE_ENV":"production"}
```

### 11.2 Version Management — Critical

Every time a user updates their environment variables, the pipeline MUST:

```
1. Create new secret version with updated JSON
2. Immediately disable the previous version
3. Delete the previous version after 24 hours (grace period for rollback)
4. Never accumulate more than 2 versions (current + 1 backup)
```

Why: Secret Manager charges $0.06 per active version per month. 10 versions of one secret
= $0.60/month for one user's project. At 500 users with average 5 version rotations = 2,500
extra versions × $0.06 = $150/month added cost from one bad practice.

### 11.3 Injection into Cloud Run

```bash
gcloud run deploy {serviceId} \
  --set-secrets=ENV_VARS=projects/PROJECT/secrets/{userId}-{projectId}-envvars:latest
```

The entire JSON blob is injected as a single env var `ENV_VARS`. The user's app must parse it:

```javascript
// In user's app entrypoint (injected by platform's base wrapper)
const envVars = JSON.parse(process.env.ENV_VARS || '{}')
Object.assign(process.env, envVars)
```

Alternatively, inject individual vars by expanding the JSON server-side and passing each
as a separate `--set-secrets` flag. Either approach is valid.

### 11.4 Build-Time vs Runtime Variables

Build-time env vars (needed during `npm run build`): passed as Cloud Build substitution
variables. They are NEVER logged to Cloud Logging. The `--no-substitution-variables-in-logs`
flag must be set.

Runtime env vars: injected via Secret Manager at Cloud Run deploy time (above).

---

## 12. Health Checks and Auto-Rollback

### 12.1 For User Apps (Dynamic)

Do NOT use HTTP health checks against user app endpoints. Users' apps may legitimately
return 401, 301, or 404 on their root path.

Use Cloud Run's native TCP startup probe only:
```yaml
startupProbe:
  tcpSocket:
    port: 8080
  initialDelaySeconds: 0
  periodSeconds: 1
  failureThreshold: 60    # 60 seconds total max startup time
```

**What TCP probe confirms:** The container process started and bound to port 8080.
**What TCP probe does NOT confirm:** The app is serving correct responses.

That gap is closed by post-deploy error rate monitoring (below).

### 12.2 Post-Deploy Error Rate Monitoring

After shifting traffic to a new revision, the Orchestrator monitors error rate for 60 seconds:

```javascript
async function monitorDeployHealth(revisionName, serviceId, previousRevisionName) {
  const startTime = Date.now()
  const MONITOR_DURATION_MS = 60_000
  const ERROR_THRESHOLD = 0.40   // 40% error rate triggers rollback

  while (Date.now() - startTime < MONITOR_DURATION_MS) {
    await sleep(5000)   // check every 5 seconds

    const metrics = await getRevisionMetrics(revisionName, '60s')

    if (metrics.totalRequests < 10) continue  // not enough data yet

    const errorRate = metrics.errorRequests / metrics.totalRequests

    if (errorRate > ERROR_THRESHOLD) {
      await rollback(serviceId, previousRevisionName)
      return { status: 'rolled_back', errorRate }
    }
  }

  return { status: 'healthy' }
}
```

Cloud Monitoring query for error rate:
```
metric.type="run.googleapis.com/request_count"
resource.type="cloud_run_revision"
resource.labels.revision_name="{revisionName}"
metric.labels.response_code_class!="2xx"
```

### 12.3 For the Router Service

Router uses HTTP probe (not TCP) because the Router itself must confirm the routing table
is loaded before accepting traffic:

```yaml
startupProbe:
  httpGet:
    path: /readiness
    port: 8080
  periodSeconds: 1
  failureThreshold: 30
livenessProbe:
  httpGet:
    path: /readiness
    port: 8080
  periodSeconds: 10
  failureThreshold: 3
```

---

## 13. Rollback Mechanism

### 13.1 Automatic Rollback (triggered by error rate monitor)

```javascript
async function rollback(serviceId, targetRevisionName) {
  // Shift 100% traffic back to previous revision instantly
  await cloudRun.updateTraffic(serviceId, [
    { revisionName: targetRevisionName, percent: 100 }
  ])

  // Update Firestore
  await db.collection('projects')
    .doc(userId).collection('projects').doc(projectId)
    .update({
      productionDeployId: previousDeployId,
      lastRollbackAt: admin.firestore.FieldValue.serverTimestamp(),
      rollbackReason: 'auto_health_check_failure'
    })
}
```

### 13.2 Manual Rollback (triggered by user in dashboard)

User clicks "Roll back to deploy d7b2e1a0" in dashboard.

For dynamic apps:
```
1. Find revision tagged with target deployId
2. gcloud run services update-traffic {serviceId} --to-tags={deployId}=100
3. Update Firestore productionDeployId
4. Update routing table in /routing/{hostname}: cloudRunRevision = targetRevisionName
```

For static apps:
```
1. Verify target deployId GCS path still exists
2. Update Firestore productionDeployId
3. Update routing table: gcsPath = "deploys/{targetDeployId}"
4. Purge Cloudflare cache for the domain
```

Time to complete rollback: under 3 seconds for both types.

---

## 14. Project Deletion Pipeline

**All steps must succeed or the deletion is marked failed and retried. No partial deletions.**

```javascript
async function deleteProject(userId, projectId) {
  const project = await getProject(userId, projectId)
  const deployments = await getProjectDeployments(userId, projectId)

  // Step 1: Remove all Cloudflare custom hostnames for this project
  if (project.customDomain) {
    await cloudflare.deleteCustomHostname(project.cloudflareHostnameId)
    // Wait for deletion confirmation before proceeding
  }

  // Step 2: Delete Cloud Run service (if dynamic project)
  if (project.type === 'dynamic' && project.cloudRunServiceId) {
    await cloudRun.deleteService(project.cloudRunServiceId)
  }

  // Step 3: Delete all Artifact Registry images for this project
  for (const deploy of deployments) {
    if (deploy.type === 'dynamic') {
      await artifactRegistry.deleteImage(
        `asia-south1-docker.pkg.dev/PROJECT/apps/${userId}:${deploy.deployId}`
      )
    }
  }

  // Step 4: Delete all GCS static files for this project
  await gcs.deletePrefix(`exovon-static/deploys/`, deployments.map(d => d.deployId))

  // Step 5: Delete Secret Manager secret
  await secretManager.deleteSecret(`${userId}-${projectId}-envvars`)

  // Step 6: Remove all routing table entries
  const routingEntries = await db.collection('routing')
    .where('projectId', '==', projectId).get()
  const batch = db.batch()
  routingEntries.docs.forEach(doc => batch.delete(doc.ref))
  await batch.commit()

  // Step 7: Delete all Firestore project documents (last step)
  await db.collection('projects').doc(userId)
    .collection('projects').doc(projectId).delete()

  // Step 8: Release subdomain back to available pool
  await db.collection('subdomains').doc(project.subdomain).delete()
}
```

---

## 15. Security Checklist — Every Requirement

### Build Security

- [ ] Cloud Build private pool with `NO_PUBLIC_EGRESS` enabled
- [ ] Artifact Registry npm proxy configured as internal registry for builds
- [ ] Custom build service account `exovon-build-sa` with minimum permissions only
- [ ] Org policy `constraints/cloudbuild.allowedWorkerPools` enforced to private pool only
- [ ] Build timeout: 600 seconds (10 minutes) hard limit on every Cloud Build job
- [ ] Build zip max size: 150MB enforced via GCS pre-signed URL upload size limit
- [ ] Build logs stored with non-guessable paths (UUID v4 deployId in path)
- [ ] Build logs served only via authenticated API, never as public GCS objects

### Runtime Security

- [ ] Every user Cloud Run service uses `exovon-user-app-sa` (zero IAM roles)
- [ ] Every user Cloud Run service has `--ingress=internal` (not reachable via direct URL)
- [ ] Every user Cloud Run service has `--max-instances=10` (per paid tier)
- [ ] Free tier services have `--max-instances=2`
- [ ] Router service uses `exovon-router-sa` (read-only Firestore only)
- [ ] Orchestrator uses `exovon-orchestrator-sa` (minimum required permissions)

### Data Security

- [ ] Firestore security rules: users can only read/write their own projects
- [ ] Firestore routing collection: writable only by Orchestrator service account, never by users
- [ ] Secret Manager: users cannot read other users' secrets (enforced by IAM on resource level)
- [ ] GCS static bucket: objects are public read but paths are non-guessable via UUID deployId
- [ ] Build logs: GCS objects are NOT public, served only via authenticated Orchestrator endpoint

### Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users can only access their own projects
    match /projects/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Routing table: read-only for all authenticated users, write only via Admin SDK
    match /routing/{hostname} {
      allow read: if false;   // Router uses Admin SDK, not client SDK
      allow write: if false;  // Only Orchestrator writes here via Admin SDK
    }

    // Deployments: users can read their own
    match /deployments/{deployId} {
      allow read: if request.auth != null &&
        resource.data.userId == request.auth.uid;
      allow write: if false;  // Only Orchestrator writes
    }
  }
}
```

### Domain Security

- [ ] Subdomain takeover prevention: project deletion ALWAYS removes Cloudflare hostname first
- [ ] Domain ownership in Firestore: `userId` field checked on every domain operation
- [ ] Orchestrator validates domain not already registered by another user before accepting
- [ ] Custom domain DNS verification required before domain goes live (TXT record check)

### Network Security

- [ ] Cloud Run user services: `--ingress=internal` (blocks all direct external access)
- [ ] Cloud Run Router: reachable only by Cloudflare IPs (configure Cloudflare IP allowlist)
- [ ] Cloud Run Orchestrator: reachable only by authenticated API clients (Firebase Auth)
- [ ] Cloudflare rate limiting: 500 req/min per domain on free tier, 5,000 req/min on paid
- [ ] Cloudflare DDoS protection: enabled on all zones (free tier includes basic protection)

---

## 16. Financial Safeguards — Every Cost Control

### 16.1 GCP Budget Alerts (configure before first user)

```
Alert 1: $5/month  → Email notification (unexpected baseline cost)
Alert 2: $20/month → Email + SMS (investigate immediately)
Alert 3: $50/month → Email + SMS + auto-disable free tier new deployments
Alert 4: $200/month → Email + SMS + PagerDuty equivalent
```

### 16.2 Per-User Spend Controls

Every Cloud Run service deployed for a user must have:
```
--max-instances: 10 (paid tier), 2 (free tier)
--memory: 512Mi (paid tier), 256Mi (free tier)
--cpu: 1 (paid tier), 0.5 (free tier)
--timeout: 30s (all tiers)
--concurrency: 80 (paid tier), 10 (free tier)
```

### 16.3 Build Minute Controls

```
Free tier: 3 builds per month per project (enforced in Orchestrator before Cloud Build trigger)
Paid tier: 30 builds per month per project
Timeout: 600 seconds (10 minutes) per build — hard limit in Cloud Build config
```

Build count tracked in Firestore:
```
/projects/{userId}/{projectId}
  buildsThisMonth: 3
  billingPeriodStart: "2026-06-01"
```

Reset on the 1st of each month via a scheduled Cloud Run job.

### 16.4 Secret Manager Cost Control

- Rule: never more than 2 active versions per secret (current + 1 backup)
- Enforced in Orchestrator: before creating new version, list existing versions, disable all but most recent
- Delete disabled versions after 24 hours via a scheduled cleanup job
- Monitor: set Cloud Monitoring alert if secret version count across project exceeds 2 × user count

### 16.5 Artifact Registry Cost Control

- Policy: keep last 5 container images per project
- Enforced in Orchestrator: after every successful deploy, list images for project, delete all but last 5
- Kaniko build cache images: separate repository `kaniko-cache`, lifecycle rule: delete after 7 days

```bash
# After each deploy, run cleanup:
gcloud artifacts docker images list \
  asia-south1-docker.pkg.dev/PROJECT/apps \
  --filter="tags:{userId}" \
  --sort-by="~CREATE_TIME" \
  --format="value(IMAGE)" | tail -n +6 | xargs -I{} gcloud artifacts docker images delete {} --quiet
```

### 16.6 GCS Storage Cost Control

- Static deployments: keep last 5 deploy folders per project
- Build zips: delete immediately after Cloud Build completes (retention: 1 day max)
- Build logs: delete after 30 days
- GCS lifecycle rules:

```json
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": {
        "matchesPrefix": ["builds/zips/"],
        "age": 1
      }
    },
    {
      "action": { "type": "Delete" },
      "condition": {
        "matchesPrefix": ["build-logs/"],
        "age": 30
      }
    }
  ]
}
```

### 16.7 Cloud Logging Cost Control

Default Cloud Run logging includes every HTTP request and every `console.log`. At scale
this is expensive. Configure logging exclusions:

```bash
gcloud logging sinks update _Default \
  --exclusion='name=health-checks,filter=resource.type="cloud_run_revision" AND httpRequest.requestUrl="/readiness"'
```

Set log retention to 30 days (default is much longer and costs more).

---

## 17. Build Caching

### 17.1 For Dockerfile-Based (Dynamic) Projects — Kaniko Cache

```yaml
# In Cloud Build step
- name: 'gcr.io/kaniko-project/executor:latest'
  args:
    - --cache=true
    - --cache-repo=asia-south1-docker.pkg.dev/PROJECT/kaniko-cache
    - --cache-ttl=168h    # 7 days
    - --snapshot-mode=redo
```

Result: `npm install` layer cached. If `package-lock.json` unchanged → layer reused.
Build time: 4 minutes → 40–60 seconds on cache hit.

### 17.2 For Buildpack-Based (Auto-Detected) Projects — GCS Cache

```yaml
env:
  - GOOGLE_CACHEBUCKET=gs://exovon-buildpack-cache
  - GOOGLE_CACHEBUCKET_PREFIX=${_USER_ID}-${_PROJECT_ID}
```

Cloud Buildpacks reads and writes from this GCS bucket automatically.
Cache prefix includes userId and projectId so caches are isolated per project.
Cache TTL: 7 days (lifecycle rule on the cache bucket).

### 17.3 npm Registry — Artifact Registry Proxy

All builds (private pool + NO_PUBLIC_EGRESS) use internal npm registry:

```bash
# In build step, before npm ci:
npm config set registry https://asia-south1-npm.pkg.dev/PROJECT/npm-proxy/
```

Create the proxy:
```bash
gcloud artifacts repositories create npm-proxy \
  --repository-format=npm \
  --location=asia-south1 \
  --description="npm upstream proxy for private pool builds" \
  --upstream-policy=UPSTREAM_POLICY_FILE.json
```

UPSTREAM_POLICY_FILE.json:
```json
{
  "upstreams": [{ "upstreamCredentials": {}, "priority": 1,
    "npmRepository": { "publicRepository": "NPMJS" } }]
}
```

---

## 18. Free Tier Rules

Free tier exists as a marketing/acquisition tool. Treat it as a cost centre with hard caps.

| Resource | Free Tier Limit | Paid Tier (₹299) |
|---|---|---|
| Projects | 1 | 5 |
| Builds per month | 3 | 30 |
| Build timeout | 5 minutes | 10 minutes |
| Static site storage | 100MB | 1GB |
| Dynamic app memory | 256Mi | 512Mi |
| Dynamic app CPU | 0.5 | 1 |
| Cloud Run max-instances | 2 | 10 |
| Custom domains | 0 | 3 |
| Preview URLs | Yes | Yes |
| Rollback history | 3 versions | 10 versions |
| Build log retention | 7 days | 30 days |

Free tier uses **Cloud Build default pool** (not private pool), with a reduced timeout.
This is a deliberate trade-off: free tier has lower security isolation in exchange for
keeping platform costs manageable. Add prominent disclaimer in UI.

---

## 19. Cleanup Policies

These run automatically in the Orchestrator after every deploy and on a nightly schedule.

### On Every Deploy

```
1. Keep last 5 Cloud Run revisions per service. Delete older ones.
2. Keep last 5 Artifact Registry images per project. Delete older ones.
3. Keep last 5 GCS deploy folders per project. Delete older ones.
4. Keep last 5 Firestore deployment documents per project. Archive/delete older ones.
5. Delete the build zip from gs://exovon-builds/zips/{deployId}.zip
```

### Nightly Scheduled Cleanup (1 AM IST)

```
1. Secret Manager: for every secret with >2 versions, disable and schedule deletion of all but latest 2
2. Artifact Registry: delete kaniko-cache images older than 7 days
3. Cloud Build: verify no builds running for more than 11 minutes (should be impossible with 600s timeout, but verify)
4. GCS build-logs: delete logs older than 30 days
5. Cloud Run: identify any revision with 0% traffic for >30 days → delete
6. Cloudflare: identify custom hostnames for deleted projects → delete
```

---

## 20. Firestore Data Model

```
/users/{userId}
  email: string
  plan: "free" | "starter" | "pro"
  billingPeriodStart: timestamp
  createdAt: timestamp

/projects/{userId}/projects/{projectId}
  name: string
  subdomain: string              → myapp  (resolves to myapp.exovon.host)
  customDomain: string | null    → customer.com
  cloudflareHostnameId: string | null
  type: "static" | "dynamic" | null
  cloudRunServiceId: string | null
  productionDeployId: string | null
  buildsThisMonth: number
  billingPeriodStart: timestamp
  createdAt: timestamp
  updatedAt: timestamp

/projects/{userId}/projects/{projectId}/deployments/{deployId}
  status: "awaiting_upload" | "building" | "ready" | "failed" | "rolled_back"
  type: "static" | "dynamic"
  buildId: string
  logPath: string               → gs://exovon-build-logs/{deployId}/log.txt
  gcsPath: string | null        → deploys/{deployId}  (static only)
  cloudRunRevision: string | null
  errorRate: number | null      → filled after health check window
  createdAt: timestamp
  completedAt: timestamp | null

/routing/{hostname}
  type: "static" | "dynamic"
  deployId: string
  userId: string
  projectId: string
  gcsPath: string | null
  cloudRunUrl: string | null
  cloudRunRevision: string | null
  updatedAt: timestamp

/subdomains/{subdomain}
  userId: string
  projectId: string
  claimedAt: timestamp
  (this collection acts as a uniqueness lock for subdomain allocation)

/domains/{hostname}
  status: "pending_verification" | "active" | "failed"
  cloudflareHostnameId: string
  verificationTxtName: string
  verificationTxtValue: string
  userId: string
  projectId: string
  createdAt: timestamp
  activatedAt: timestamp | null
```

---

## 21. Monthly Cost Reference

All figures in USD. Multiply by 84 for INR approximation.

| Cost Line | 0 Users | 50 Users | 200 Users | 500 Users |
|---|---|---|---|---|
| Cloud Run Router (min-instances:1) | $0.72 | $1.00 | $1.50 | $2.50 |
| Cloud Run Orchestrator | $0 | $0 | $0 | $0 |
| Cloud Run User Services | $0 | $0 | $1.20 | $4.80 |
| Cloud Build private pool | $0 | $2.91 | $11.64 | $29.10 |
| GCS storage + egress | $0 | $0.20 | $0.67 | $1.50 |
| Artifact Registry | $0 | $0.60 | $2.40 | $6.00 |
| Secret Manager | $0 | $2.64 | $11.64 | $29.64 |
| Firestore | $0 | $0 | $0 | $0 |
| Pub/Sub | $0 | $0 | $0 | $0 |
| Egress (dynamic traffic) | $0 | $0.48 | $2.40 | $7.20 |
| Cloudflare for SaaS custom domains | $0 | $0 | $0 | $15.00 |
| Cloudflare plan | $0 | $0 | $0 | $20.00 |
| 15% buffer | $0 | $1.02 | $4.72 | $17.37 |
| **Total USD** | **$0.72** | **$8.85** | **$36.17** | **$133.11** |
| **Total INR** | **₹61** | **₹743** | **₹3,038** | **₹11,181** |

**Revenue vs cost at ₹299/user:**

| Users | Revenue | Infrastructure | Gross Margin |
|---|---|---|---|
| 50 | ₹14,950 | ₹743 | 95.0% |
| 200 | ₹59,800 | ₹3,038 | 94.9% |
| 500 | ₹1,49,500 | ₹11,181 | 92.5% |

---

## 22. What Not to Build at Launch

Ship these only after you have 100+ paying users.

| Feature | Why skip at launch |
|---|---|
| Cloudflare Workers + KV routing | 302 redirect is sufficient. KV p95 latency is 50ms not 1ms. $25/month for Workers for Platforms. Add post-launch. |
| ISR (Incremental Static Regeneration) | Requires Memorystore (Redis). Adds ₹1,500–3,000/month. Needed only for Next.js ISR users. |
| Multi-GCP-project architecture | Cloud Run limit of 1,000 services is fine until 800+ active users. |
| Cloud Armor | $5/policy + usage. Cloudflare free tier DDoS is sufficient at launch. |
| Canary deployments (gradual traffic) | Full rollout + auto-rollback covers 99% of cases. Canary is a power feature. |
| Build infrastructure on owned VMs | Cloud Build private pool at $0.0097/min is fine until you hit ₹50,000/month in build costs. |
| Custom domains on free tier | Every free custom domain costs $0.10/month with Cloudflare. No free tier custom domains. |
| Analytics dashboard (BigQuery) | GCS access logs are sufficient for launch. BigQuery adds cost and complexity. |
| Wildcard custom domains (*.customer.com) | Cloudflare Enterprise only. Not worth the cost at launch. |
| Log streaming via Pub/Sub to frontend | Dashboard polls Firestore build status every 3 seconds. Good enough at launch. |

---

*End of Exovon Hosting Master Blueprint v1.0*  
*This document represents the complete, finalized architecture for the platform.*  
*All decisions here are based on verified GCP and Cloudflare pricing as of June 2026.*