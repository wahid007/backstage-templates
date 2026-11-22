#!/usr/bin/env bash
#
# Slack progress notifier for the CI/CD pipeline.
#
# Usage: slack-notify.sh <start|stage|summary>
#
# A notification is posted:
#   * start   - as soon as the pipeline starts (all stages queued)
#   * stage   - when a stage finishes, with the full progress checklist
#   * summary - once, with the overall pipeline result
#
# Values come from the GitHub Actions environment; optional overrides:
#   STAGE_LINT_TEST          result of the lint-test job
#   STAGE_SECURITY_SCAN      result of the security-scan job
#   STAGE_DOCKER_BUILD_PUSH  result of the docker-build-push job
#   STAGE_ID / STAGE_STATUS / STAGE_START   (set by the job posting `stage`)
#
# Notifications must never break a build: without a webhook, without jq or on
# a Slack error the script only writes a warning and exits 0.
#
set -uo pipefail

MODE="${1:-summary}"

if [ -z "${SLACK_WEBHOOK_URL:-}" ]; then
  echo "SLACK_WEBHOOK_URL is not set - skipping Slack notification."
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "::warning::jq is not available - skipping Slack notification."
  exit 0
fi

SERVER="${GITHUB_SERVER_URL:-https://github.com}"
REPO="${GITHUB_REPOSITORY:-unknown/repository}"
SHA="${GITHUB_SHA:-unknown}"
SHORT_SHA="${SHA:0:7}"
BRANCH="${GITHUB_REF_NAME:-main}"
ACTOR="${GITHUB_ACTOR:-unknown}"
EVENT="${GITHUB_EVENT_NAME:-push}"
RUN_ID="${GITHUB_RUN_ID:-}"
RUN_NUMBER="${GITHUB_RUN_NUMBER:-?}"
RUN_ATTEMPT="${GITHUB_RUN_ATTEMPT:-1}"

REPO_URL="${SERVER}/${REPO}"
COMMIT_URL="${SERVER}/${REPO}/commit/${SHA}"
RUN_URL=""
[ -n "$RUN_ID" ] && RUN_URL="${SERVER}/${REPO}/actions/runs/${RUN_ID}"

case "$EVENT" in
  pull_request) EVENT_LABEL="pull request" ;;
  pull_request_target) EVENT_LABEL="pull request" ;;
  workflow_dispatch) EVENT_LABEL="manual run" ;;
  push) EVENT_LABEL="push" ;;
  *) EVENT_LABEL="$EVENT" ;;
esac

# --- status helpers ---------------------------------------------------------

status_icon() {
  case "${1:-}" in
    success) printf '✅' ;;
    failure) printf '❌' ;;
    cancelled) printf '⚠️' ;;
    skipped) printf '⏭️' ;;
    timed_out) printf '⌛' ;;
    *) printf '⏳' ;;
  esac
}

status_word() {
  case "${1:-}" in
    success) printf 'passed' ;;
    failure) printf 'failed' ;;
    cancelled) printf 'cancelled' ;;
    skipped) printf 'skipped' ;;
    timed_out) printf 'timed out' ;;
    *) printf 'queued' ;;
  esac
}

stage_icon() {
  case "$1" in
    lint-test) printf '🧪' ;;
    security-scan) printf '🛡️' ;;
    docker-build-push) printf '🐳' ;;
    *) printf '•' ;;
  esac
}

stage_label() {
  case "$1" in
    lint-test) printf 'Lint · Test · Build' ;;
    security-scan) printf 'Security Scans' ;;
    docker-build-push) printf 'Build · Push · GitOps' ;;
    *) printf '%s' "$1" ;;
  esac
}

STAGES="lint-test security-scan docker-build-push"

stage_result() {
  case "$1" in
    lint-test) printf '%s' "${STAGE_LINT_TEST:-}" ;;
    security-scan) printf '%s' "${STAGE_SECURITY_SCAN:-}" ;;
    docker-build-push) printf '%s' "${STAGE_DOCKER_BUILD_PUSH:-}" ;;
    *) printf '' ;;
  esac
}

elapsed_since() { # <epoch> -> "2m 13s"
  local start="$1" now secs
  case "$start" in
    ''|*[!0-9]*) return 0 ;;
  esac
  now=$(date +%s)
  secs=$((now - start))
  [ "$secs" -lt 0 ] && secs=0
  if [ "$secs" -lt 60 ]; then
    printf '%ss' "$secs"
  else
    printf '%dm %02ds' "$((secs / 60))" "$((secs % 60))"
  fi
}

# --- message fragments ------------------------------------------------------

# Progress checklist: completed stages keep their result, stages that have not
# run yet stay queued, and the stage posting the message gets its duration.
checklist() {
  local id status line out="" duration

  for id in $STAGES; do
    status="$(stage_result "$id")"

    if [ -n "${STAGE_ID:-}" ] && [ "$id" = "$STAGE_ID" ]; then
      status="${STAGE_STATUS:-$status}"
    fi

    if [ -z "$status" ]; then
      line="$(stage_icon "$id")  *$(stage_label "$id")*  ·  ⏳ queued"
    else
      line="$(stage_icon "$id")  *$(stage_label "$id")*  ·  $(status_icon "$status") $(status_word "$status")"
      if [ -n "${STAGE_ID:-}" ] && [ "$id" = "$STAGE_ID" ] && [ "$MODE" = "stage" ]; then
        duration="$(elapsed_since "${STAGE_START:-}")"
        [ -n "$duration" ] && line="${line}  _(${duration})_"
      fi
    fi

    out="${out:+$out
}${line}"
  done

  printf '%s' "$out"
}

completed_count() {
  local id status done=0
  for id in $STAGES; do
    status="$(stage_result "$id")"
    [ -n "${STAGE_ID:-}" ] && [ "$id" = "$STAGE_ID" ] && status="${STAGE_STATUS:-$status}"
    case "$status" in
      success|failure|cancelled|skipped|timed_out) done=$((done + 1)) ;;
    esac
  done
  printf '%s' "$done"
}

overall_status() {
  local id status
  for id in $STAGES; do
    status="$(stage_result "$id")"
    [ -n "${STAGE_ID:-}" ] && [ "$id" = "$STAGE_ID" ] && status="${STAGE_STATUS:-$status}"
    case "$status" in
      failure|timed_out) printf 'failure'; return ;;
      cancelled) printf 'cancelled'; return ;;
    esac
  done
  printf 'success'
}

header=""
footer=""
case "$MODE" in
  start)
    header="🚀 CI/CD pipeline started"
    footer="Stages run in order · results are posted here as they finish"
    if [ "$EVENT" != "push" ]; then
      footer="Validation run · the deploy stage is skipped · results are posted here as they finish"
    fi
    ;;
  stage)
    header="$(stage_icon "${STAGE_ID:-}") $(stage_label "${STAGE_ID:-}") · $(status_icon "${STAGE_STATUS:-}") $(status_word "${STAGE_STATUS:-}")"
    footer="Run #${RUN_NUMBER} · attempt ${RUN_ATTEMPT} · $(completed_count) of 3 stages complete"
    ;;
  summary)
    result="$(overall_status)"
    case "$result" in
      success) header="🎉 Pipeline succeeded" ;;
      cancelled) header="⏹️ Pipeline cancelled" ;;
      *) header="🚨 Pipeline failed" ;;
    esac
    case "$result" in
      success)
        footer="Run #${RUN_NUMBER} · attempt ${RUN_ATTEMPT} · Argo CD reconciles the new image automatically"
        ;;
      *)
        footer="Run #${RUN_NUMBER} · attempt ${RUN_ATTEMPT} · open the run to inspect the failing step"
        ;;
    esac
    ;;
  *)
    echo "Unknown mode '$MODE' (expected start, stage or summary)" >&2
    exit 0
    ;;
esac

context="*${REPO}* · \`${BRANCH}\` · <${COMMIT_URL}|${SHORT_SHA}> · ${EVENT_LABEL} by @${ACTOR}"
body="$(checklist)"

payload="$(jq -n \
  --arg text "${header} — ${REPO}" \
  --arg header "$header" \
  --arg context "$context" \
  --arg body "$body" \
  --arg footer "$footer" \
  --arg run_url "$RUN_URL" \
  --arg commit_url "$COMMIT_URL" \
  --arg repo_url "$REPO_URL" \
  '{
    text: $text,
    blocks: (
      [
        { type: "header", text: { type: "plain_text", text: $header, emoji: true } },
        { type: "context", elements: [ { type: "mrkdwn", text: $context } ] },
        { type: "section", text: { type: "mrkdwn", text: $body } },
        { type: "context", elements: [ { type: "mrkdwn", text: $footer } ] }
      ]
      + (if $run_url == "" then [] else
        [ { type: "actions", elements: (
            [ { type: "button",
                text: { type: "plain_text", text: "View workflow run", emoji: true },
                url: $run_url,
                style: "primary" } ]
            + (if $commit_url == "" then [] else
                [ { type: "button",
                    text: { type: "plain_text", text: "Commit", emoji: true },
                    url: $commit_url } ] end)
            + (if $repo_url == "" then [] else
                [ { type: "button",
                    text: { type: "plain_text", text: "Repository", emoji: true },
                    url: $repo_url } ] end)
          ) } ] end)
    )
  }')"

if [ -z "$payload" ]; then
  echo "::warning::Could not build the Slack payload - skipping notification."
  exit 0
fi

body_file="$(mktemp)"
http_code="$(curl -sS --max-time 20 \
  -H 'Content-type: application/json' \
  -X POST \
  --data "$payload" \
  -o "$body_file" \
  -w '%{http_code}' \
  "$SLACK_WEBHOOK_URL" 2>/dev/null)" || http_code="000"

case "$http_code" in
  2*) echo "Slack notification sent (${MODE})." ;;
  *)  echo "::warning::Slack webhook returned HTTP ${http_code}: $(tr -d '\n' < "$body_file")" ;;
esac

rm -f "$body_file"
exit 0
