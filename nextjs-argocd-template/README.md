# Next.js + Argo CD GitOps Template

Backstage golden-path template that scaffolds a Next.js (App Router,
TypeScript) service with:

- **Kubernetes manifests** – a `Deployment` (probes, resource limits, non-root,
  read-only root filesystem), a `Service` of type `LoadBalancer` and a
  restrictive `NetworkPolicy`.
- **Hardened CI/CD pipeline** – lint, type-check, unit tests, build, Snyk,
  OWASP Dependency-Check, Trivy, Checkov, GitGuardian and Slack notifications.
- **Automated GitOps** – the generated repository is registered with the Argo CD
  app-of-apps repository (`gitops-infra`) through an automatically opened pull
  request, and the pipeline commits the immutable image SHA into the Kubernetes
  manifest after every successful build.

> **Deployment prerequisite** – the image is pushed to GitHub Container Registry
> and GHCR packages are **private** by default. A `docker-registry` pull secret
> must exist in the target namespace (and the Deployment must reference it)
> before Argo CD syncs, otherwise the pod stays in `ImagePullBackOff`. See
> [Image pull secret (required)](#image-pull-secret-required).

## Repository layout

```text
nextjs-argocd-template/
├── template.yaml                    # Backstage Template (parameters + steps)
├── README.md
├── gitops-infra/
│   ├── README.md
│   └── bootstrap/
│       └── app-of-apps.yaml          # root Argo CD Application (apply once)
├── gitops-skeleton/
│   └── apps/
│       └── ${{ values.componentId }}.yaml   # rendered into the app-of-apps PR
└── skeleton/
    ├── .github/workflows/ci-cd.yaml # CI/CD + security + GitOps pipeline
    ├── .github/scripts/slack-notify.sh # Slack progress notifier
    ├── app/                         # Next.js App Router + /api/health
    ├── lib/                         # testable helpers
    ├── k8s/
    │   ├── deployment.yaml
    │   ├── service.yaml
    │   ├── networkpolicy.yaml
    │   └── kustomization.yaml
    ├── argocd/application.yaml      # standalone Argo CD Application
    ├── Dockerfile, .dockerignore
    ├── package.json, tsconfig.json, next.config.js
    ├── vitest.config.ts, .eslintrc.json
    ├── catalog-info.yaml
    └── README.md
```

## Image pull secret (required)

GHCR packages are **private** by default, so a Kubernetes pull secret is
mandatory. Without it the Deployment is created but the pod never starts:

```text
Failed to pull image "ghcr.io/<owner>/<repo>:<sha>": ...
  unauthorized: authentication required
→ ErrImagePull / ImagePullBackOff
```

GitHub does not expose an anonymous pull for private packages, so neither the
cluster nor a `docker pull` without `docker login` will work until the secret
exists.

### 1. Create the secret in the target namespace

Use a GitHub token with package read access: a classic PAT with `read:packages`,
a fine-grained PAT with **Packages: read**, or `gh auth token` from an account
that can read the package.

```bash
kubectl create namespace <namespace> --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io \
  --docker-username=<github-user> \
  --docker-password=<PAT-with-read:packages> \
  --namespace <namespace>
```

The secret is namespaced: create it in **every** namespace the app is deployed
to (and re-create it after the token expires — a rotated token does not update
an existing secret automatically).

### 2. Reference it from the Deployment

The template writes `imagePullSecrets: [{ name: <imagePullSecret> }]` into
`skeleton/k8s/deployment.yaml`. The parameter defaults to `ghcr-pull`, so the
command above is enough for a fresh scaffold. To use a different name, set the
`Image Pull Secret` field when running the template, or edit
`k8s/deployment.yaml` and re-sync the Argo CD Application.

```yaml
spec:
  template:
    spec:
      imagePullSecrets:
        - name: ghcr-pull
```

A secret committed to Git is **not** a substitute: credentials must never be
stored in the repository. Alternatives are an ExternalSecrets/SealedSecrets
operator, a `ServiceAccount` with `imagePullSecrets` referenced by the pod, or
Argo CD's image-pull-secret replication if your setup provides it.

### 3. Keep it in sync with Argo CD

Argo CD applies the `k8s/` directory, but it does not create this secret. If the
`Application` uses `CreateNamespace=true`, create the namespace and the secret
**before** the first sync. Without the secret the `Application` is reported as
`Degraded`/`Progressing` and the pod stays in `ImagePullBackOff`; the kubelet
retries on its own as soon as the secret is added, or force a new rollout with
`kubectl rollout restart deployment/<name> -n <namespace>`.

If you prefer a public image instead, make the GHCR package public
(**Repository → Packages → package settings → Change visibility**) and remove
`imagePullSecrets` from the manifest.

## Parameters

| Parameter | Default | Description |
| --------- | ------- | ----------- |
| `name` | – | Component/repository name (EntityNamePicker) |
| `owner` | – | Backstage owner (OwnerPicker) |
| `description` | Next.js application… | Component description |
| `namespace` | `default` | Kubernetes namespace for the Deployment/Service |
| `replicas` | `1` | Deployment replica count (1–10) |
| `imagePullSecret` | `ghcr-pull` | Name of the `docker-registry` secret in `namespace` used to pull the private GHCR image. Required unless the package is made public |
| `repoUrl` | – | GitHub repository to create (RepoUrlPicker) |
| `gitopsRepoUrl` | `github.com?repo=gitops-infra&owner=wahid007` | Existing app-of-apps repository (RepoUrlPicker format) |
| `gitopsRepoBranch` | `main` | Branch of `gitops-infra` that Argo CD watches |
| `argocdNamespace` | `argocd` | Namespace of the Argo CD `Application` resources |
| `argocdProject` | `default` | Argo CD `AppProject` |
| `targetRevision` | `main` | Branch of the generated repository tracked by Argo CD |

## What the scaffolder does

1. `fetch:template` renders the Next.js skeleton (`./skeleton`) with all
   parameters.
2. `publish:github` creates the repository and pushes the skeleton.
3. `fetch:template` renders the app-of-apps fragment (`./gitops-skeleton`) to
   `./gitops/apps/<component>.yaml` (after publish, so it is not committed to
   the application repository).
4. `catalog:register` registers the new component in the Backstage catalog.
5. `publish:github:pull-request` opens/updates a PR against `gitopsRepoUrl`
   adding `apps/<component>.yaml` (branch
   `backstage/argocd-<component>`, `update: true` on re-runs).

The generated repository contains `argocd/application.yaml` as a standalone
copy of the `Application`, which is useful when the app-of-apps repository is
not used.

## GitOps flow

```text
Backstage template
      │
      ├─ creates app repo ───────────────► GitHub Actions
      │                                      │ lint / test / scan / build
      │                                      │ push image :<sha>
      │                                      └ commit k8s/deployment.yaml image tag
      │
      └─ PR to gitops-infra/apps/<name>.yaml
                    │
                    ▼
        Argo CD root Application (app-of-apps)
                    │ watches gitops-infra/apps/
                    ▼
        Argo CD Application <name>
                    │ watches app repo k8s/ @ targetRevision
                    ▼
        Deployment + Service in namespace <namespace>
```

### Bootstrap the app-of-apps repository once

The expected `gitops-infra` layout:

```text
gitops-infra/
├── bootstrap/app-of-apps.yaml   # root Application, applied once
└── apps/
    └── <component>.yaml          # added by the Backstage template PR
```

Apply the root Application:

```bash
kubectl apply -f gitops-infra/bootstrap/app-of-apps.yaml
```

The root Application uses `path: apps` with `directory.recurse: true`, so every
`Application` manifest committed under `apps/` is created and kept in sync.

> The URL in `gitops-infra/bootstrap/app-of-apps.yaml` is
> `https://github.com/wahid007/gitops-infra.git`. Change it if you use a fork.

### Argo CD access to private application repositories

`publish:github` creates **private** repositories by default. Configure
credentials in Argo CD for each generated repository (GitHub App, deploy key or
PAT) under **Settings → Repositories**. Without this, the `Application` stays in
`Unknown`/`ComparisonError`.

## Pipeline details

| Job | Trigger | Steps |
| --- | ------- | ----- |
| `announce` | always (runs immediately) | posts the pipeline start to Slack with all three stages queued |
| `lint-test` | push/PR to `main` | Node 24 + npm cache → install (lockfile-tolerant) → `npm run lint` → `npm run typecheck` → `npm test` → `npm run build` → Slack progress update |
| `security-scan` | after `lint-test` | Snyk (deps), OWASP Dependency-Check (HTML artifact), Trivy fs (SARIF), Checkov (k8s + Dockerfile, SARIF), GitGuardian (secrets); SARIF uploaded to the Security tab → Slack progress update |
| `docker-build-push` | push to `main` only | GHCR login → build/push `latest` + `<sha>` → Trivy image scan → `sed` the SHA tag into `k8s/deployment.yaml` → commit `chore(gitops): deploy <sha> [skip ci]` → Slack progress update |
| `notify` | always | final Slack summary with the overall result (all Slack steps are no-ops without `SLACK_WEBHOOK_URL`) |

### Slack progress notifications

`.github/scripts/slack-notify.sh` posts a live progress checklist to the
incoming webhook: one message at start, one after each stage, and a final
summary. Emojis encode the state of every stage, so the run can be followed from
the channel without opening GitHub:

| Emoji | Meaning |
| ----- | ------- |
| 🧪 | lint, type-check, tests and build stage |
| 🛡️ | security scans stage |
| 🐳 | image build/push + GitOps manifest commit stage |
| ⏳ | queued |
| ✅ | passed |
| ❌ | failed |
| ⚠️ | cancelled |
| ⏭️ | skipped (e.g. the deploy stage on a pull request) |
| ⌛ | timed out |

Start, stage and summary messages share the same layout: header, repository /
branch / commit context, the stage checklist with the per-stage duration, and
buttons to the workflow run, the commit and the repository. The final message
switches its header to 🎉 *Pipeline succeeded*, 🚨 *Pipeline failed* or
⏹️ *Pipeline cancelled*.

Only `SLACK_WEBHOOK_URL` is required — notifications use a plain incoming
webhook (no bot token, no `chat.update`). Because webhooks cannot edit a posted
message, progress is published as a sequence of messages in the channel.

### Report-only vs blocking

By default the scans are report-only:

| Scanner | Default | Missing token |
| ------- | ------- | ------------- |
| Snyk | `continue-on-error: true` | step is skipped |
| GitGuardian | `continue-on-error: true` | step is skipped |
| OWASP Dependency-Check | `continue-on-error: true`, no `--failOnCVSS` | still runs |
| Trivy | `continue-on-error: true`, `exit-code: '0'` | no token needed |
| Checkov | `continue-on-error: true`, `soft_fail: true` | no token needed |

To make one scanner blocking, remove its `continue-on-error` and set its fail
threshold. Keep the SARIF/artifact upload steps non-blocking.

#### Snyk

```yaml
      - name: Snyk Open Source Scan
        if: env.SNYK_TOKEN != ''
        uses: snyk/actions/node@master
        # remove: continue-on-error: true
        env:
          SNYK_TOKEN: ${{ env.SNYK_TOKEN }}
        with:
          args: --all-projects --severity-threshold=high
```

`snyk test` exits non-zero when vulnerabilities are found.
`--severity-threshold=high` limits failures to high/critical issues. The step is
still skipped when `SNYK_TOKEN` is absent; see “Require tokens when blocking”
below.

#### GitGuardian

```yaml
      - name: GitGuardian Secret Scan
        if: env.GITGUARDIAN_API_KEY != ''
        uses: GitGuardian/ggshield-action@v1
        # remove: continue-on-error: true
```

The action fails when a secret is detected. It is still skipped when
`GITGUARDIAN_API_KEY` is absent.

#### OWASP Dependency-Check

```yaml
      - name: OWASP Dependency-Check
        uses: dependency-check/Dependency-Check_Action@main
        # remove: continue-on-error: true
        with:
          args: '--enableRetired --failOnCVSS 7 --exclude node_modules/** --exclude .git/** --exclude reports/**'
```

`--failOnCVSS 7` fails on CVSS >= 7. Use `9` for critical-only. Without
`--failOnCVSS`, Dependency-Check never fails the build.

#### Trivy

Filesystem scan:

```yaml
      - name: Trivy Filesystem Scan
        uses: aquasecurity/trivy-action@v0.36.0
        # remove: continue-on-error: true
        with:
          severity: 'CRITICAL,HIGH'
          ignore-unfixed: true
          exit-code: '1'
```

Image scan:

```yaml
      - name: Trivy Image Scan
        uses: aquasecurity/trivy-action@v0.36.0
        # remove: continue-on-error: true
        with:
          severity: 'CRITICAL,HIGH'
          ignore-unfixed: true
          exit-code: '1'
```

Adjust `severity` to `CRITICAL` for critical-only enforcement.

#### Checkov

```yaml
      - name: Checkov IaC Scan
        uses: bridgecrewio/checkov-action@master
        # remove: continue-on-error: true
        with:
          soft_fail: false
          # optional accepted risks:
          skip_check: CKV_K8S_21,CKV_K8S_43
```

`soft_fail: false` fails on any policy violation. Use `skip_check` for accepted
risks such as the `default` namespace or an image tag that is not a digest.

#### Require tokens when blocking

A skipped step is not a failure. If Snyk/GitGuardian must never be skipped, add
a preflight step to `security-scan`:

```yaml
      - name: Require scanner credentials
        run: |
          test -n "$SNYK_TOKEN" || { echo "SNYK_TOKEN is missing"; exit 1; }
          test -n "$GITGUARDIAN_API_KEY" || { echo "GITGUARDIAN_API_KEY is missing"; exit 1; }
```

`NVD_API_KEY` is optional; without it OWASP Dependency-Check still runs, just
slower and rate-limited.

#### Effect on deployment

`docker-build-push` declares `needs: [lint-test, security-scan]`. A blocking
scan failure therefore stops the image push and the GitOps manifest commit. If
you want deployments to continue despite findings, remove `security-scan` from
the `needs` list or make the job non-blocking with `continue-on-error: true` at
job level.

## Secrets to prepare

### In the generated application repository

| Secret | Required | Purpose |
| ------ | -------- | ------- |
| `GITHUB_TOKEN` | automatic | GHCR push + GitOps manifest commit |
| `SNYK_TOKEN` | optional | Snyk scan |
| `NVD_API_KEY` | optional (recommended) | OWASP Dependency-Check NVD updates |
| `GITGUARDIAN_API_KEY` | optional | GitGuardian secret scan |
| `SLACK_WEBHOOK_URL` | optional | Slack progress notifications (incoming webhook, no bot token) |

The Kubernetes pull secret described in
[Image pull secret (required)](#image-pull-secret-required) is **not** a GitHub
Actions secret: it lives in the cluster, in the application namespace.

For `GITGUARDIAN_API_KEY`, create a GitGuardian API token with the **`scan`**
scope. That is the only scope required by the `ggshield-action` used in this
pipeline. Add `incidents:read` only if you enable `--with-incident-details`, and
`scan:create-incidents` only if you configure a source UUID so scans create
dashboard incidents.

### In Backstage (`app-config.yaml`)

`publish:github` and `publish:github:pull-request` use the GitHub integration:

```yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}   # PAT or GitHub App with repo + pull-request access
```

The token must be able to:

- create the generated repository,
- push to it (including `.github/workflows/`, which requires the `workflow`
  scope on a classic PAT or *Workflows: write* on a fine-grained token),
- create/update pull requests in `gitops-infra` (and read its contents).

## Register the template in Backstage

Register this template directly:

```text
https://github.com/<org>/backstage-templates/blob/main/nextjs-argocd-template/template.yaml
```

Or add it to the root `catalog-info.yaml` `spec.targets`:

```yaml
    - ./nextjs-argocd-template/template.yaml
```

Then choose **Create → Next.js App with CI/CD, Security Scans and Argo CD
GitOps**.

## Notes about templating

The skeleton files are rendered with Backstage's Nunjucks engine. GitHub Actions
expressions use the same `${{ ... }}` shape, so `skeleton/.github/workflows/ci-cd.yaml`
is wrapped in `{% raw %}…{% endraw %}`. Keep those markers when editing the
workflow inside `skeleton/`.

`skeleton/.github/scripts/slack-notify.sh` only uses shell `${VAR}` expansion
(no Nunjucks expressions), so it needs no raw block. It relies on `jq` and
`curl`, both preinstalled on `ubuntu-latest`.

## Local validation

The skeleton is rendered by the Backstage scaffolder, so validate the generated
repository instead of the raw Nunjucks files. The generated app can be built
locally with:

```bash
cd <generated-repo>
npm install
npm run lint && npm run typecheck && npm test && npm run build
docker build -t nextjs-argocd-demo .
kubectl kustomize k8s
```
