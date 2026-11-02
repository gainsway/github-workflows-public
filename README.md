# github-workflows-public

Reusable public GitHub Actions workflows for Gainsway repositories.

## Available Workflows

| Workflow | File | Purpose |
|---|---|---|
| Bruno Collection Sync | `.github/workflows/bruno-sync.yml` | Generate/sync Bruno collection files from an OpenAPI spec into a target repo |
| Validate Tag | `.github/workflows/job.validate-tag.yml` | Validate that a git tag matches semantic versioning (`vX.Y.Z[-pre][+meta]`) |
| NuGet CI | `.github/workflows/nuget.ci.yml` | Restore, build, and test .NET projects |
| NuGet Publish (GitHub Packages) | `.github/workflows/nuget.publish.yml` | Pack and publish NuGet packages to GitHub Packages |
| NuGet Publish (NuGet.org) | `.github/workflows/nuget.publish.nuget.org.yml` | Pack and publish NuGet packages to NuGet.org |

---

## Bruno OpenCollection YAML sync (draft PR)

Reusable workflow: `gainsway/github-workflows-public/.github/workflows/bruno-sync.yml@main`.

Call from a service repository whenever its `openapi.json` changes. The workflow
reads the source OpenAPI 3.x/Swagger 2 document, checks out `gainsway/local-dev`,
and updates the matching service subfolder **only after the OpenCollection migration
has merged**. Missing or legacy-format collection roots are rejected.

The sync matches existing endpoints by HTTP method and normalized path (including
parameter placeholders). Existing YAML filenames, authentication, environment variables,
scripts, tests, saved response examples and custom configuration are preserved.
New request parameters and JSON body properties are merged; removed endpoints
are **reported but not deleted**. New requests receive deterministic, length-safe
filenames. A draft PR is created or updated on a stable branch; no direct push
to `main`. No changes means no PR.

Inputs: `spec-path` (required), `target-collection` (required),
`local-dev-repo` (default `gainsway/local-dev`), `target-base-ref`
(default `main`), `scripts-ref` (default `main`), `node-version`
(default `24`). Secret: `GH_PAT` with Contents and Pull Requests write
permissions in the target repository. **Pin `scripts-ref` to the same
version or commit as the reusable workflow** to avoid fetching mismatched
converter code.

See [the updated example](examples/example-usage.yml). The legacy
`.bru` CLI format can still be selected explicitly, but the reusable workflow
targets OpenCollection YAML. Run the tests with
`cd scripts/bruno-sync && npm ci && npm test`.

---

---

## Validate Tag

Reusable workflow: `gainsway/github-workflows-public/.github/workflows/job.validate-tag.yml@main`

Validates `github.ref_name` against a semantic version pattern (`v1.2.3`, with optional prerelease/build metadata).

### Inputs / Secrets

None.

### Example

```yaml
jobs:
  validate-tag:
    uses: gainsway/github-workflows-public/.github/workflows/job.validate-tag.yml@main
```

---

## NuGet CI

Reusable workflow: `gainsway/github-workflows-public/.github/workflows/nuget.ci.yml@main`

Runs .NET restore/build/test and configures GitHub Packages as a NuGet source.

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `dotnet-version` | Yes | `9.0.x` | .NET SDK version |

### Secrets

| Secret | Required | Description |
|---|---|---|
| `NUGET_TOKEN` | Yes | Token used to authenticate to GitHub Packages |

### Example

```yaml
jobs:
  ci:
    uses: gainsway/github-workflows-public/.github/workflows/nuget.ci.yml@main
    with:
      dotnet-version: 9.0.x
    secrets:
      NUGET_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## NuGet Publish (GitHub Packages)

Reusable workflow: `gainsway/github-workflows-public/.github/workflows/nuget.publish.yml@main`

Builds package versions with GitVersion, validates tags when running on tag refs, and pushes `.nupkg` files to GitHub Packages.

After a successful publish, cleanup runs once per distinct package ID extracted from the generated
`.nuspec` manifests. Multi-package solutions are supported; duplicate IDs are deduplicated
case-insensitively, and symbol packages are excluded from discovery. Each package retains the
existing policy: keep 10 prerelease versions and never delete stable versions. Cleanup uses
`NUGET_TOKEN`, which must have package-deletion access. A failure for one package does not cancel
cleanup for the others; failures still fail the workflow. No cleanup runs when discovery or publish
fails. Inputs and reusable workflow outputs are unchanged.

Local discovery regression tests (no package publication/deletion):

```sh
python3 -m unittest discover -s scripts/tests -v
```

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `dotnet-version` | Yes | `9.0.x` | .NET SDK version |

### Secrets

| Secret | Required | Description |
|---|---|---|
| `NUGET_TOKEN` | Yes | Token used for pushing packages to GitHub Packages |

### Outputs

| Output | Description |
|---|---|
| `version` | `SemVer` from GitVersion |
| `commitsSinceVersionSource` | Commits since version source from GitVersion |

### Example

```yaml
on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    uses: gainsway/github-workflows-public/.github/workflows/nuget.publish.yml@main
    with:
      dotnet-version: 9.0.x
    secrets:
      NUGET_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## NuGet Publish (NuGet.org)

Reusable workflow: `gainsway/github-workflows-public/.github/workflows/nuget.publish.nuget.org.yml@main`

Builds package versions with GitVersion, validates tags when running on tag refs, and pushes `.nupkg` files to NuGet.org.

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `dotnet-version` | Yes | `9.0.x` | .NET SDK version |

### Secrets

| Secret | Required | Description |
|---|---|---|
| `NUGET_ORG_API_KEY` | Yes | API key used for publishing to NuGet.org |

### Outputs

| Output | Description |
|---|---|
| `version` | `SemVer` from GitVersion |
| `commitsSinceVersionSource` | Commits since version source from GitVersion |

### Example

```yaml
on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    uses: gainsway/github-workflows-public/.github/workflows/nuget.publish.nuget.org.yml@main
    with:
      dotnet-version: 9.0.x
    secrets:
      NUGET_ORG_API_KEY: ${{ secrets.NUGET_ORG_API_KEY }}
```
