#!/usr/bin/env bash
set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_DIR="$SERVICE_DIR/models"
ODE_DIR="$MODEL_DIR/ode"
mkdir -p "$ODE_DIR"

GRU_MODEL_SHA256="${GRU_MODEL_SHA256:-db59d414b8b88a6ac1140dd5bbce40475878d97a6436fb087141e25bdb3887fe}"
GRU_MODEL_URL="${GRU_MODEL_URL:-https://huggingface.co/doyeonkoo/runway-hr-gru/resolve/main/gru_final.pt}"
ODEV21_CHECKPOINT_SHA256="${ODEV21_CHECKPOINT_SHA256:-ba767a645c2b1180a3ced3cbcc533142544d3e34cc69b23aed28eba134b14061}"
ODEV21_SUMMARY_STATS_SHA256="${ODEV21_SUMMARY_STATS_SHA256:-9251e04e3dc50ecb66cbd48faa7c6882b80f16a51af0746669cd5f0545b4e066}"
ODEV21_SOURCE_CHECKPOINT="${ODEV21_SOURCE_CHECKPOINT:?Set ODEV21_SOURCE_CHECKPOINT to the ODE source checkpoint (model_epoch_020.pt)}"
ODEV21_SOURCE_STATS="${ODEV21_SOURCE_STATS:?Set ODEV21_SOURCE_STATS to the ODE source summary_stats.json}"

fetch_gru() {
  local target="$MODEL_DIR/gru_final.pt" temp="$MODEL_DIR/gru_final.pt.download"
  curl --fail --location --retry 3 --output "$temp" "$GRU_MODEL_URL"
  echo "$GRU_MODEL_SHA256  $temp" | sha256sum --check --status || { rm -f "$temp"; echo "GRU SHA-256 mismatch" >&2; exit 1; }
  mv "$temp" "$target"
}

copy_verified() {
  local source="$1" target="$2" expected="$3" temp="$target.download"
  test -r "$source" || { echo "Missing model source: $source" >&2; exit 1; }
  cp -- "$source" "$temp"
  echo "$expected  $temp" | sha256sum --check --status || { rm -f "$temp"; echo "ODE SHA-256 mismatch: $source" >&2; exit 1; }
  mv "$temp" "$target"
}

fetch_gru
copy_verified "$ODEV21_SOURCE_CHECKPOINT" "$ODE_DIR/ode_epoch_020.pt" "$ODEV21_CHECKPOINT_SHA256"
copy_verified "$ODEV21_SOURCE_STATS" "$ODE_DIR/ode_summary_stats.json" "$ODEV21_SUMMARY_STATS_SHA256"
echo "Model assets installed and verified in $MODEL_DIR"
