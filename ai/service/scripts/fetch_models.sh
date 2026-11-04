#!/usr/bin/env bash
set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_DIR="$SERVICE_DIR/models"
ODE_DIR="$MODEL_DIR/ode"

ODEV21_SOURCE_MODE="${ODEV21_SOURCE_MODE:-hf}"
if [[ "$ODEV21_SOURCE_MODE" != "hf" && "$ODEV21_SOURCE_MODE" != "local" ]]; then
  printf 'ODEV21_SOURCE_MODE must be hf or local\n' >&2
  exit 1
fi
if [[ "$ODEV21_SOURCE_MODE" == "hf" && -z "${HF_TOKEN:-}" ]]; then
  printf 'HF_TOKEN is required to download private model assets from Hugging Face\n' >&2
  exit 1
fi
if [[ "$ODEV21_SOURCE_MODE" == "local" ]]; then
  : "${ODEV21_SOURCE_CHECKPOINT:?Set ODEV21_SOURCE_CHECKPOINT to the local ODE checkpoint}"
  : "${ODEV21_SOURCE_STATS:?Set ODEV21_SOURCE_STATS to the local ODE summary stats}"
  : "${ODEV21_POPULATION_BUNDLE_SOURCE:?Set ODEV21_POPULATION_BUNDLE_SOURCE to the local population bundle}"
fi

RUNWAY_MODEL_HF_REPO="${RUNWAY_MODEL_HF_REPO:-AnSeongYun/runway-hr-models}"
RUNWAY_MODEL_HF_REVISION="${RUNWAY_MODEL_HF_REVISION:-11a3d0cce3062c84aa7ffee1740a93d204462190}"
GRU_MODEL_SHA256="${GRU_MODEL_SHA256:-db59d414b8b88a6ac1140dd5bbce40475878d97a6436fb087141e25bdb3887fe}"
ODEV21_CHECKPOINT_SHA256="${ODEV21_CHECKPOINT_SHA256:-ba767a645c2b1180a3ced3cbcc533142544d3e34cc69b23aed28eba134b14061}"
ODEV21_SUMMARY_STATS_SHA256="${ODEV21_SUMMARY_STATS_SHA256:-9251e04e3dc50ecb66cbd48faa7c6882b80f16a51af0746669cd5f0545b4e066}"
ODEV21_POPULATION_BUNDLE_SHA256="${ODEV21_POPULATION_BUNDLE_SHA256:-9dcb5f4c2aa7281de732b4a5fe64fb658f8acebc9f1b35389a71a7fe2b877ef1}"

hf_url() {
  printf 'https://huggingface.co/%s/resolve/%s/%s' \
    "$RUNWAY_MODEL_HF_REPO" "$RUNWAY_MODEL_HF_REVISION" "$1"
}

file_sha256() {
  local output
  output="$(sha256sum -- "$1")"
  printf '%s' "${output%% *}" | tr '[:upper:]' '[:lower:]'
}

download_verified() {
  local url="$1" target="$2" expected="$3" with_auth="$4"
  local temp actual
  expected="$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')"

  if [[ -f "$target" ]] && [[ "$(file_sha256 "$target")" == "$expected" ]]; then
    printf 'Already verified: %s\n' "$target"
    return
  fi

  temp="$(mktemp "${target}.download.XXXXXX")"
  if [[ "$with_auth" == "true" ]]; then
    if ! printf 'Authorization: Bearer %s\n' "$HF_TOKEN" \
      | curl --fail --location --retry 3 -H @- --output "$temp" "$url"; then
      rm -f -- "$temp"
      printf 'Model download failed: %s\n' "$url" >&2
      return 1
    fi
  elif ! curl --fail --location --retry 3 --output "$temp" "$url"; then
    rm -f -- "$temp"
    printf 'Model download failed: %s\n' "$url" >&2
    return 1
  fi

  actual="$(file_sha256 "$temp")"
  if [[ "$actual" != "$expected" ]]; then
    rm -f -- "$temp"
    printf 'Model SHA-256 mismatch: %s\n' "$target" >&2
    return 1
  fi

  mv -f -- "$temp" "$target"
  printf 'Installed: %s\n' "$target"
}

copy_verified() {
  local source="$1" target="$2" expected="$3"
  local temp actual
  expected="$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')"

  if [[ -f "$target" ]] && [[ "$(file_sha256 "$target")" == "$expected" ]]; then
    printf 'Already verified: %s\n' "$target"
    return
  fi
  if [[ ! -r "$source" ]]; then
    printf 'Missing model source: %s\n' "$source" >&2
    return 1
  fi

  temp="$(mktemp "${target}.download.XXXXXX")"
  if ! cp -- "$source" "$temp"; then
    rm -f -- "$temp"
    printf 'Model copy failed: %s\n' "$target" >&2
    return 1
  fi
  actual="$(file_sha256 "$temp")"
  if [[ "$actual" != "$expected" ]]; then
    rm -f -- "$temp"
    printf 'Model SHA-256 mismatch: %s\n' "$target" >&2
    return 1
  fi

  mv -f -- "$temp" "$target"
  printf 'Installed: %s\n' "$target"
}

mkdir -p "$ODE_DIR"

if [[ -n "${GRU_MODEL_URL:-}" ]]; then
  # 이전 공개 URL 사용자 지정 호환: 이 URL에는 HF_TOKEN을 전달하지 않는다.
  download_verified "$GRU_MODEL_URL" "$MODEL_DIR/gru_final.pt" "$GRU_MODEL_SHA256" false
elif [[ "$ODEV21_SOURCE_MODE" == "local" ]]; then
  download_verified \
    "https://huggingface.co/doyeonkoo/runway-hr-gru/resolve/main/gru_final.pt" \
    "$MODEL_DIR/gru_final.pt" "$GRU_MODEL_SHA256" false
else
  download_verified "$(hf_url gru/gru_final.pt)" "$MODEL_DIR/gru_final.pt" "$GRU_MODEL_SHA256" true
fi

if [[ "$ODEV21_SOURCE_MODE" == "local" ]]; then
  copy_verified "$ODEV21_SOURCE_CHECKPOINT" "$ODE_DIR/ode_epoch_020.pt" "$ODEV21_CHECKPOINT_SHA256"
  copy_verified "$ODEV21_SOURCE_STATS" "$ODE_DIR/ode_summary_stats.json" "$ODEV21_SUMMARY_STATS_SHA256"
  copy_verified "$ODEV21_POPULATION_BUNDLE_SOURCE" \
    "$ODE_DIR/population_bundle_v2train_median.json" "$ODEV21_POPULATION_BUNDLE_SHA256"
else
  download_verified "$(hf_url ode_v21_stage1_base/selected_model.pt)" \
    "$ODE_DIR/ode_epoch_020.pt" "$ODEV21_CHECKPOINT_SHA256" true
  download_verified "$(hf_url ode_v21_stage1_base/summary_stats.json)" \
    "$ODE_DIR/ode_summary_stats.json" "$ODEV21_SUMMARY_STATS_SHA256" true
  download_verified "$(hf_url ode_v21_stage1_base/population_bundle_v2train_median.json)" \
    "$ODE_DIR/population_bundle_v2train_median.json" "$ODEV21_POPULATION_BUNDLE_SHA256" true
fi

printf 'Model assets installed and verified in %s\n' "$MODEL_DIR"
