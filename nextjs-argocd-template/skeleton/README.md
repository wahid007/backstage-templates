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

### Private GHCR image — pull secret required

GHCR packages are **private** by default, so the cluster cannot pull this image
until a `docker-registry` secret exists in the target namespace and the
Deployment references it. Without the secret the pod never becomes ready:

```text
Failed to pull image "ghcr.io/<owner>/<repo>:<sha>": unauthorized
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

#### 2. Reference it from the Deployment

The template parameter `imagePullSecret` defaults to `ghcr-pull`, and the
Deployment already contains:

```yaml
spec:
  template:
    spec:
      imagePullSecrets:
        - name: ${{ values.imagePullSecret or 'ghcr-pull' }}
```

If you chose a different secret name, edit `k8s/deployment.yaml` and let Argo CD
re-sync. Never commit credentials — use an ExternalSecrets/SealedSecrets
operator (or a `ServiceAccount` with `imagePullSecrets`) when the secret must be
managed declaratively.

> Alternatively make the package public (**Repository → Packages → package
> settings → Change visibility**) and drop `imagePullSecrets` from the manifest.

#### 3. Create it before the first sync

Argo CD applies `k8s/` but does not create this secret. With
`CreateNamespace=true` the namespace is created on sync; create the secret right
afterwards (or beforehand) so the first pod can start. Until then the
`Application` is `Degraded`/`Progressing` and the pod stays in
`ImagePullBackOff`; the kubelet retries automatically once the secret exists —
use `kubectl rollout restart deployment/${{ values.componentId }} -n ${{ values.namespace }}`
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
| `announce` | immediately | posts the pipeline start to Slack with every stage queued |
| `lint-test` | every push/PR | installs dependencies, runs `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then posts the stage result |
| `security-scan` | after `lint-test` | Snyk, OWASP Dependency-Check, Trivy (filesystem), Checkov (Kubernetes + Dockerfile), GitGuardian; uploads SARIF to the Security tab and the Dependency-Check HTML report as an artifact, then posts the stage result |
| `docker-build-push` | pushes to `main` only | builds and pushes `ghcr.io/<owner>/<repo>:{latest,<sha>}`, scans the image with Trivy, commits the new SHA tag to `k8s/deployment.yaml` (GitOps), then posts the stage result |
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

> The cluster pull secret for the private GHCR image is **not** a GitHub Actions
> secret — see [Private GHCR image — pull secret required](#private-ghcr-image--pull-secret-required).

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
