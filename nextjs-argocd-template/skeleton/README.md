# ${{ values.componentId }}

${{ values.description }}

Next.js (App Router, TypeScript) service scaffolded with Backstage, shipped with
a complete CI/CD + security pipeline, Kubernetes manifests and Argo CD GitOps.

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts:

```bash
npm run lint       # next lint
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run build      # production build
npm start          # run the production build
```

The health endpoint used by the Kubernetes probes is available at
`GET /api/health`:

```json
{ "status": "ok", "service": "${{ values.componentId }}", "version": "0.1.0", "timestamp": "..." }
```

## Docker

The Dockerfile is a multi-stage build based on the Next.js `standalone` output
(see `next.config.js`) and runs as the non-root `nextjs` user:

```bash
docker build -t ${{ values.componentId }} .
docker run --rm -p 3000:3000 ${{ values.componentId }}
```

## Kubernetes

| File | Resource |
| ---- | -------- |
| `k8s/deployment.yaml` | `Deployment` – 1+ replicas, readiness/liveness/startup probes, resource requests/limits, non-root + read-only root filesystem, dropped capabilities |
| `k8s/service.yaml` | `Service` of type `LoadBalancer` – port `80` → container port `3000` |
| `k8s/networkpolicy.yaml` | `NetworkPolicy` – ingress to `3000`, DNS + HTTPS egress |
| `k8s/kustomization.yaml` | Kustomize entrypoint used by Argo CD (`path: k8s`) |

Render and apply locally:

```bash
kubectl kustomize k8s
kubectl apply -k k8s
```

The Deployment initially references `ghcr.io/<owner>/<repo>:latest`. The CI
pipeline replaces the tag with the immutable commit SHA after each successful
build on `main`, and Argo CD reconciles the change.

> The `Service` is a `LoadBalancer`. If your cluster has no load-balancer
> implementation (for example a local `kind` cluster without MetalLB), change
> `spec.type` to `ClusterIP` and expose the app through an Ingress/Gateway.

### Private GHCR image

If the GHCR package is private, create a pull secret in the target namespace and
pass its name as `imagePullSecret` when scaffolding (or add it to the pod spec
manually):

```bash
kubectl create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io \
  --docker-username=<github-user> \
  --docker-password=<PAT-with-read:packages> \
  --namespace ${{ values.namespace }}
```

With `imagePullSecret=ghcr-pull`, the Deployment contains:

```yaml
imagePullSecrets:
  - name: ghcr-pull
```

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

After the pull request is merged, Argo CD automatically creates/syncs the
Deployment and Service in namespace `${{ values.namespace }}` (`project:
${{ values.argocdProject }}`).

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
| `lint-test` | every push/PR | installs dependencies, runs `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` |
| `security-scan` | after `lint-test` | Snyk, OWASP Dependency-Check, Trivy (filesystem), Checkov (Kubernetes + Dockerfile), GitGuardian; uploads SARIF to the Security tab and the Dependency-Check HTML report as an artifact |
| `docker-build-push` | pushes to `main` only | builds and pushes `ghcr.io/<owner>/<repo>:{latest,<sha>}`, scans the image with Trivy, then commits the new SHA tag to `k8s/deployment.yaml` (GitOps) |
| `notify` | always | sends a Slack message with the result of every job (skipped when `SLACK_WEBHOOK_URL` is not set) |

All security scanners are **report-only** (`continue-on-error` / `soft_fail`),
so a missing token or a finding does not break the first pipeline run.

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
| `SLACK_WEBHOOK_URL` | Optional | Slack incoming webhook for notifications. Without it the notify job is a no-op. |

Create the GitGuardian API token with the **`scan`** scope. That is the only
scope required by the `ggshield-action` used here. Add `incidents:read` if you
use `--with-incident-details`, or `scan:create-incidents` if you configure a
source UUID so scans create incidents in the GitGuardian dashboard.

Create optional secrets under **Settings → Secrets and variables → Actions →
New repository secret**.

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
