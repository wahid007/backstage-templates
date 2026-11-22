# gitops-infra – Argo CD App-of-Apps Scaffolding

This directory contains the bootstrap pieces for the Argo CD **app-of-apps**
repository used by `nextjs-argocd-template`.

Target repository: <https://github.com/wahid007/gitops-infra>

## Layout

```text
gitops-infra/
├── bootstrap/
│   └── app-of-apps.yaml   # root Application – apply once
└── apps/
    └── <component>.yaml    # one Application per service (added by Backstage)
```

## One-time bootstrap

```bash
git clone https://github.com/wahid007/gitops-infra.git
cd gitops-infra
mkdir -p bootstrap apps
cp <path-to-this-template>/gitops-infra/bootstrap/app-of-apps.yaml bootstrap/
git add bootstrap/app-of-apps.yaml
git commit -m "feat(argocd): bootstrap app-of-apps"
git push
```

Apply the root Application to the cluster running Argo CD:

```bash
kubectl apply -f bootstrap/app-of-apps.yaml
```

The root Application watches `apps/` recursively. Any `Application` manifest
committed there is created and continuously reconciled by Argo CD.

## Onboarding a service

The Backstage template automatically opens a pull request adding:

```text
apps/<component>.yaml
```

The `Application` points at the generated service repository, path `k8s`,
revision `main`, and deploys into the requested namespace with:

```yaml
syncPolicy:
  automated:
    prune: true
    selfHeal: true
  syncOptions:
    - CreateNamespace=true
```

Merge the pull request and Argo CD takes over the rollout.

## Required Argo CD configuration

1. **Repository credentials** – Argo CD must be able to read every generated
   application repository. `publish:github` creates private repositories, so add
   a GitHub App, deploy key or PAT under **Settings → Repositories**.
2. **Destination cluster** – the generated `Application` uses
   `https://kubernetes.default.svc` (in-cluster). Change it if the workload runs
   on a remote cluster.
3. **Namespace** – `CreateNamespace=true` is set, so Argo CD creates the target
   namespace if it does not exist.

## How Argo CD authenticates to the private repositories

Argo CD reads repository credentials from Kubernetes Secrets in its own
namespace (usually `argocd`), selected by the Application's
`spec.source.repoURL`. The Backstage GitHub token is **not** used by Argo CD.

### Option A: one credential template for all `wahid007` repos (recommended)

This covers `gitops-infra` **and** every generated private application repo:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: repo-creds-wahid007
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repo-creds
stringData:
  type: git
  url: https://github.com/wahid007
  username: x-access-token
  password: <PAT with Contents: Read>
```

```bash
kubectl apply -f argocd-repo-creds.yaml
```

### Option B: one secret for only the app-of-apps repository

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: repo-gitops-infra
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repository
stringData:
  type: git
  url: https://github.com/wahid007/gitops-infra.git
  username: x-access-token
  password: <PAT with Contents: Read>
```

The `url` must exactly match the Application's `repoURL` (including `.git`).
With a `repository` secret you must add another secret for every generated
application repository.

### GitHub App instead of a PAT

```yaml
stringData:
  type: git
  url: https://github.com/wahid007
  githubAppID: "<app-id>"
  githubAppInstallationID: "<installation-id>"
  githubAppPrivateKey: |
    -----BEGIN RSA PRIVATE KEY-----
    ...
```

The GitHub App must be installed on the repositories with at least
**Contents: Read**.

### SSH deploy key instead of HTTPS

```yaml
stringData:
  type: git
  url: git@github.com:wahid007
  sshPrivateKey: |
    -----BEGIN OPENSSH PRIVATE KEY-----
    ...
```

When using SSH, change the Application `repoURL` to
`git@github.com:wahid007/gitops-infra.git` as well. Make sure `github.com` is in
the Argo CD SSH known-hosts ConfigMap.

### Verify

```bash
argocd repocreds list
argocd repo get https://github.com/wahid007/gitops-infra.git
argocd app get app-of-apps --refresh
argocd app manifests app-of-apps
```

If the repository belongs to an organization with SAML SSO enabled, authorize
the PAT for that organization.

> A separate credential is still needed for pulling private images from GHCR:
> that is the Kubernetes `imagePullSecret`, not an Argo CD repository secret.

## Known warning: finalizer name

On Kubernetes 1.31+ `kubectl apply` may print:

> metadata.finalizers: "resources-finalizer.argocd.argoproj.io": prefer a
> domain-qualified finalizer name including a path (/) to avoid accidental
> conflicts with other finalizer writers

This is expected. Argo CD uses `resources-finalizer.argocd.argoproj.io` as its
cascade-deletion finalizer, and the controller expects that exact value. The
warning is advisory and the Application is still created normally. Do not
rename the finalizer unless you intentionally want to disable Argo CD's
cascading cleanup.

## Changing the Argo CD namespace

`bootstrap/app-of-apps.yaml` assumes Argo CD runs in the `argocd` namespace. If
you installed Argo CD elsewhere, update both `metadata.namespace` and
`spec.destination.namespace` in that file, and use the same value for the
`argocdNamespace` parameter of the Backstage template.

## Changing the repository URL

The root Application in `bootstrap/app-of-apps.yaml` uses:

```yaml
source:
  repoURL: https://github.com/wahid007/gitops-infra.git
  targetRevision: main
  path: apps
```

If you use a fork or a different branch, update `repoURL` / `targetRevision`
before applying it.
