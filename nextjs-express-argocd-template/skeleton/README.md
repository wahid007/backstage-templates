# ${{ values.componentId }}

${{ values.description }}

Two microservices in one repository, scaffolded with Backstage and shipped with
a complete CI/CD + security pipeline, Argo CD GitOps and **separate Dockerfiles
and Kubernetes manifests per microservice**:

- `frontend/` – Next.js (App Router, TypeScript), served on port `3000`.
- `backend/` – Express (TypeScript) API, served on port `3001`.

## Architecture

```text
Browser
  │
  ▼
frontend Service (LoadBalancer :80)
  │
  └─ Next.js :3000
       ├─ /              → React UI
       ├─ /healthz       → frontend-local probe
       └─ /api/*         → app/api/[...path]/route.ts proxy
                              │
                              ▼
                         backend Service (ClusterIP :3001)
                              │
                              └─ Express /api/*
```

The browser only talks to the Next.js origin, so the Express backend stays
internal (`ClusterIP`) and no CORS configuration is needed. The proxy reads
`BACKEND_URL` at request time; Kubernetes sets it to
`http://${{ values.componentId }}-backend-svc:3001`.

## Getting started

Install each microservice independently (they are separate npm projects):

```bash
cd backend && npm install
cd ../frontend && npm install
```

Run the API and the UI in two terminals:

```bash
# terminal 1 – Express on http://localhost:3001
cd backend && npm run dev

# terminal 2 – Next.js on http://localhost:3000
cd frontend && npm run dev
```

The frontend defaults to `BACKEND_URL=http://localhost:3001`; override it when
the API runs elsewhere:

```bash
cd frontend && BACKEND_URL=http://localhost:4001 npm run dev
```

### Scripts

| Directory | Script | Description |
| --------- | ------ | ----------- |
| `frontend` | `npm run dev` | Next.js development server (port `3000`) |
| `frontend` | `npm run build` | Next.js production build (`output: 'standalone'`) |
| `frontend` | `npm start` | Runs the standalone build (`.next/standalone/server.js`) |
| `frontend` | `npm run lint` / `typecheck` / `test` | Next lint, `tsc --noEmit`, Vitest |
| `backend` | `npm run dev` | Express with `tsx watch` (port `3001`) |
| `backend` | `npm run build` | Compiles `src/` to `dist/` with `tsc` |
| `backend` | `npm start` | Runs `node dist/index.js` |
| `backend` | `npm run lint` / `typecheck` / `test` | ESLint, `tsc --noEmit`, Vitest + Supertest |

`npm start` in either directory requires a previous `npm run build`.

## API

The frontend proxies everything under `/api/*` to Express, so the same paths
work from the browser and from `curl http://localhost:3000`:

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/healthz` | Frontend-local health (not proxied) |
| `GET` | `/api/health` | Express health payload used by the backend probes |
| `GET` | `/api/items` | Lists the demo items |
| `POST` | `/api/items` | Creates an item (`{ "name": "..." }`) |
| `GET` | `/api/items/:id` | Returns one item |
| `DELETE` | `/api/items/:id` | Deletes one item |

```bash
# Through the frontend proxy
curl http://localhost:3000/api/health
# {"status":"ok","service":"${{ values.componentId }}-backend","version":"0.1.0","timestamp":"..."}

# Directly against Express (useful while developing the API)
curl http://localhost:3001/api/health

curl -X POST http://localhost:3000/api/items \
  -H 'Content-Type: application/json' \
  -d '{"name":"first item"}'
```

The items API is an **in-memory demo**: restarting the backend resets the list.
Replace `backend/src/routes/items.ts` with a real database client when adding
persistence. Add new routers under `backend/src/routes/` and mount them in
`backend/src/app.ts`.

## Project structure

```text
frontend/                 Next.js microservice
  app/                    App Router pages, /healthz, /api proxy route
  lib/backend.ts          BACKEND_URL normalisation + URL builder (+ tests)
  Dockerfile              Next.js standalone image
  package.json
backend/                  Express microservice
  src/
    index.ts              HTTP server bootstrap
    app.ts                Express app factory (used by tests)
    routes/               API routers (health, items)
    lib/health.ts         Probe payload helper (+ tests)
    app.test.ts           Supertest API tests
  Dockerfile              Compiled Express image
  package.json
k8s/
  kustomization.yaml      Root kustomization (Argo CD path: k8s)
  frontend/               Deployment, Service, NetworkPolicy for Next.js
  backend/                Deployment, Service, NetworkPolicy for Express
argocd/application.yaml   Standalone Argo CD Application
.github/                  CI/CD workflow + Slack notifier
catalog-info.yaml         Backstage component
```

## Docker

Each microservice has its own Dockerfile and build context:

```bash
docker build -t ${{ values.componentId }}-frontend ./frontend
docker build -t ${{ values.componentId }}-backend ./backend
```

Run them locally on a shared Docker network (the frontend reaches Express by
its container name):

```bash
docker network create ${{ values.componentId }}-net
docker run --rm -d --name ${{ values.componentId }}-backend \
  --network ${{ values.componentId }}-net -p 3001:3001 \
  ${{ values.componentId }}-backend
docker run --rm -d --name ${{ values.componentId }}-frontend \
  --network ${{ values.componentId }}-net -p 3000:3000 \
  -e BACKEND_URL=http://${{ values.componentId }}-backend:3001 \
  ${{ values.componentId }}-frontend
```

| Image | Base build | Runtime |
| ----- | ---------- | ------- |
| `frontend/Dockerfile` | `next build` → `.next/standalone` | `node server.js`, non-root `nextjs` user, port `3000` |
| `backend/Dockerfile` | `tsc` → `dist/`, then `npm prune --omit=dev` | `node dist/index.js`, non-root `express` user, port `3001` |

## Kubernetes

Each microservice owns its manifests; the root kustomization includes both and
is the directory Argo CD applies.

| File | Resource |
| ---- | -------- |
| `k8s/kustomization.yaml` | Root Kustomize entrypoint used by Argo CD (`path: k8s`) |
| `k8s/frontend/deployment.yaml` | Next.js `Deployment` – replicas, `/healthz` probes, read-only root FS, `.next/cache` volume |
| `k8s/frontend/service.yaml` | Frontend `Service`, `LoadBalancer` – port `80` → `3000` |
| `k8s/frontend/networkpolicy.yaml` | Ingress to `3000`; egress DNS, backend `3001`, HTTPS |
| `k8s/backend/deployment.yaml` | Express `Deployment` – replicas, `/api/health` probes, read-only root FS |
| `k8s/backend/service.yaml` | Backend `Service`, `ClusterIP` – port `3001` (internal only) |
| `k8s/backend/networkpolicy.yaml` | Ingress only from frontend pods; egress DNS + HTTPS |

Render and apply locally:

```bash
kubectl kustomize k8s
kubectl apply -k k8s
```

The Deployments initially reference
`ghcr.io/<owner>/<repo>/frontend:latest` and
`ghcr.io/<owner>/<repo>/backend:latest`. The CI pipeline replaces both tags with
the immutable commit SHA after each successful build on `main`, and Argo CD
reconciles the changes.

> The frontend `Service` is a `LoadBalancer`. If your cluster has no
> load-balancer implementation (for example a local `kind` cluster without
> MetalLB), change `k8s/frontend/service.yaml` to `ClusterIP` and expose the
> frontend through an Ingress/Gateway. The backend Service stays internal.

### Private GHCR images — pull secret required

GHCR packages are **private** by default, so the cluster cannot pull either
image until a `docker-registry` secret exists in the target namespace and both
Deployments reference it. Without the secret the pods never become ready:

```text
Failed to pull image "ghcr.io/<owner>/<repo>/frontend:<sha>": unauthorized
→ ErrImagePull / ImagePullBackOff
```

#### 1. Create the secret

The token needs package read access only: a classic PAT with `read:packages`, a
fine-grained PAT with **Packages: read**, or `gh auth token`.

```bash
kubectl create namespace ${{ values.namespace }} --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret docker-registry ${{ values.imagePullSecret or 'ghcr-pull' }} \
  --docker-server=ghcr.io \
  --docker-username=<github-user> \
  --docker-password=<PAT-with-read:packages> \
  --namespace ${{ values.namespace }}
```

Secrets are namespaced: create one in every namespace the app is deployed to.
Rotation is manual — recreate the secret when the token is renewed.

#### 2. Reference it from both Deployments

The template parameter `imagePullSecret` defaults to `ghcr-pull`, and both
`k8s/frontend/deployment.yaml` and `k8s/backend/deployment.yaml` already
contain:

```yaml
spec:
  template:
    spec:
      imagePullSecrets:
        - name: ${{ values.imagePullSecret or 'ghcr-pull' }}
```

If you chose a different secret name, update both manifests and let Argo CD
re-sync. Never commit credentials — use an ExternalSecrets/SealedSecrets
operator (or a `ServiceAccount` with `imagePullSecrets`) when the secret must be
managed declaratively.

> Alternatively make the package public (**Repository → Packages → package
> settings → Change visibility**) and drop `imagePullSecrets` from both
> Deployments.

#### 3. Create it before the first sync

Argo CD applies `k8s/` but does not create this secret. With
`CreateNamespace=true` the namespace is created on sync; create the secret right
afterwards (or beforehand) so the first pods can start. Until then the
`Application` is `Degraded`/`Progressing` and the pods stay in
`ImagePullBackOff`; the kubelet retries automatically once the secret exists —
use
`kubectl rollout restart deployment/${{ values.componentId }}-frontend deployment/${{ values.componentId }}-backend -n ${{ values.namespace }}`
to force a new attempt immediately.

## GitOps with Argo CD

The Backstage template opened a pull request against the configured
app-of-apps repository (`gitopsRepoUrl`) adding:

```text
apps/${{ values.componentId }}.yaml
```

That `Application` points at this repository, path `k8s`, and is discovered by
the root app-of-apps Application (`bootstrap/app-of-apps.yaml`):

```text
gitops-infra/
├── bootstrap/app-of-apps.yaml   # applied once: watches apps/
└── apps/
    └── ${{ values.componentId }}.yaml
```

After the pull request is merged, Argo CD creates/syncs the frontend and backend
Deployments, Services and NetworkPolicies in namespace `${{ values.namespace }}`
(`project: ${{ values.argocdProject }}`). The Application applies the root
`k8s/` kustomization, which includes both microservice directories.

A standalone copy of the same Application is available at
`argocd/application.yaml`:

```bash
kubectl apply -f argocd/application.yaml
```

### Private repositories

`publish:github` creates a **private** repository by default. Argo CD must be
allowed to read it. Configure repository credentials in Argo CD (a GitHub App, a
deploy key or a PAT) for:

```text
https://${{ values.destination.host }}/${{ values.destination.owner }}/${{ values.destination.repo }}.git
```

## CI/CD pipeline

`.github/workflows/ci-cd.yaml` runs on pushes and pull requests to `main`:

| Job | When | What it does |
| --- | ---- | ------------ |
| `announce` | immediately | posts the pipeline start to Slack with every stage queued |
| `lint-test` | every push/PR | installs both projects, runs lint, type-check, unit tests and build for `frontend/` and `backend/`, then posts the stage result |
| `security-scan` | after `lint-test` | Snyk (both projects), OWASP Dependency-Check, Trivy (filesystem), Checkov (Kubernetes + both Dockerfiles), GitGuardian; uploads SARIF to the Security tab and the Dependency-Check HTML report as an artifact, then posts the stage result |
| `docker-build-push` | pushes to `main` only | builds/pushes `ghcr.io/<owner>/<repo>/frontend:{latest,<sha>}` and `.../backend:{latest,<sha>}`, scans both images with Trivy, commits both SHA tags to `k8s/frontend/deployment.yaml` and `k8s/backend/deployment.yaml` (GitOps), then posts the stage result |
| `notify` | always | posts the final Slack summary (all Slack steps are skipped when `SLACK_WEBHOOK_URL` is not set) |

All security scanners are **report-only** (`continue-on-error` / `soft_fail`),
so a missing token or a finding does not break the first pipeline run.

### Slack progress notifications

`.github/scripts/slack-notify.sh` turns the incoming webhook into a live progress
timeline — no bot token required. Three kinds of messages are posted:

1. 🚀 **Pipeline started** — the three stages, all ⏳ queued.
2. **One message per stage** — the checklist is re-rendered with the result and
duration of the finished stage while later stages stay queued.
3. **Summary** — 🎉 succeeded / 🚨 failed / ⏹️ cancelled with the final
checklist.

Stage and status icons:

| Emoji | Meaning |
| ----- | ------- |
| 🧪 | Lint · Test · Build |
| 🛡️ | Security Scans |
| 🐳 | Build · Push · GitOps |
| ⏳ ✅ ❌ | queued · passed · failed |
| ⚠️ ⏭️ ⌛ | cancelled · skipped · timed out |

Every message carries the repository, branch, commit (linked), trigger type and
actor, plus buttons for the workflow run, the commit and the repository. The
message shrinks to a single line of text anywhere blocks are not supported.

Because incoming webhooks cannot edit an already posted message, progress is a
sequence of messages in the channel. Add `SLACK_WEBHOOK_URL` under **Settings →
Secrets and variables → Actions** to enable it. The notifier never fails the
pipeline: a missing webhook, missing `jq` or a Slack error only produces a
warning.

### Making scans blocking

To enforce findings, edit `.github/workflows/ci-cd.yaml`:

| Scanner | Change |
| ------- | ------ |
| Snyk | remove `continue-on-error: true`; keep `--severity-threshold=high` |
| GitGuardian | remove `continue-on-error: true` |
| OWASP Dependency-Check | remove `continue-on-error: true`; add `--failOnCVSS 7` to `args` |
| Trivy (filesystem + image) | remove `continue-on-error: true`; set `exit-code: '1'` |
| Checkov | remove `continue-on-error: true`; set `soft_fail: false` |

Example for Trivy:

```yaml
        with:
          severity: 'CRITICAL,HIGH'
          ignore-unfixed: true
          exit-code: '1'
```

Snyk and GitGuardian steps are skipped when their tokens are missing. If they
must fail instead of skip, add a preflight step:

```yaml
      - name: Require scanner credentials
        run: |
          test -n "$SNYK_TOKEN" || { echo "SNYK_TOKEN is missing"; exit 1; }
          test -n "$GITGUARDIAN_API_KEY" || { echo "GITGUARDIAN_API_KEY is missing"; exit 1; }
```

Because `docker-build-push` needs `security-scan`, a blocking finding prevents
the image push and GitOps commit. Remove `security-scan` from `needs` if you
want deploys to proceed regardless of scan results.

### Required and optional secrets

| Secret | Required | Purpose |
| ------ | -------- | ------- |
| `GITHUB_TOKEN` | Yes – automatic | Push images to GHCR, commit the GitOps manifest. The workflow requests `packages: write` and `contents: write`. |
| `SNYK_TOKEN` | Optional | Enables the Snyk scan. Without it the step is skipped. |
| `NVD_API_KEY` | Optional (recommended) | Speeds up the OWASP Dependency-Check NVD download. |
| `GITGUARDIAN_API_KEY` | Optional | Enables the GitGuardian secret scan. Without it the step is skipped. |
| `SLACK_WEBHOOK_URL` | Optional | Slack incoming webhook for the progress notifications. Without it every Slack step is a no-op. |

The four optional secrets are created automatically when the app is scaffolded:
values entered in the Backstage *CI/CD Pipeline Secrets* step are written to
this repository's Actions secrets by the scaffolder (never committed to Git).
Empty fields become empty secrets, and the pipeline treats an empty value as
"not configured". Rotate or add them later under **Settings → Secrets and
variables → Actions → New repository secret**.

> The cluster pull secret for the private GHCR image is **not** a GitHub Actions
> secret — see [Private GHCR image — pull secret required](#private-ghcr-image--pull-secret-required).

Create the GitGuardian API token with the **`scan`** scope. That is the only
scope required by the `ggshield-action` used here. Add `incidents:read` if you
use `--with-incident-details`, or `scan:create-incidents` if you configure a
source UUID so scans create incidents in the GitGuardian dashboard.

Secrets that were not set during scaffolding can be added at any time under
**Settings → Secrets and variables → Actions → New repository secret**.

Also verify **Settings → Actions → General → Workflow permissions** allows
*Read and write permissions* (the workflow declares the permissions it needs,
but organisation policies can restrict the default token).

### GitOps commit and branch protection

The `docker-build-push` job pushes a commit similar to:

```text
chore(gitops): deploy 1a2b3c4 [skip ci]
```

If `main` is protected against direct pushes, allow the GitHub Actions bot to
push (or replace the commit step with a pull request). The `[skip ci]` marker
prevents a second pipeline run; pushes made with `GITHUB_TOKEN` do not trigger
workflows anyway.

## Backstage

`catalog-info.yaml` registers this component and wires the annotations used by
the Kubernetes and Argo CD plugins:

```yaml
annotations:
  backstage.io/kubernetes-id: ${{ values.componentId }}
  backstage.io/kubernetes-namespace: ${{ values.namespace }}
  argocd/app-name: ${{ values.componentId }}
  argocd/app-namespace: ${{ values.argocdNamespace }}
  argocd/project-name: ${{ values.argocdProject }}
```
