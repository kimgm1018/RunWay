# Model assets

Model weights are fetched at deploy time and must stay out of Git.

| Role | Artifact | Source | SHA-256 (2026-11-01 default) | Installed path |
| --- | --- | --- | --- | --- |
| AI03/AI04 HR forecast | `gru_final.pt` | Hugging Face `doyeonkoo/runway-hr-gru` | `db59d414b8b88a6ac1140dd5bbce40475878d97a6436fb087141e25bdb3887fe` | `ai/service/models/gru_final.pt` |
| AI04/AI05/AI06 ODE | `ode_epoch_020.pt` (source file `model_epoch_020.pt`) | GPU workspace `<SERVER_WORKSPACE>/ode_v21_20261101/runs/full_base_20261101T101637/checkpoints/` | `ba767a645c2b1180a3ced3cbcc533142544d3e34cc69b23aed28eba134b14061` | `ai/service/models/ode/ode_epoch_020.pt` |
| ODE normalization metadata | `ode_summary_stats.json` (source file `summary_stats.json`) | Same ODE run, `runs/full_base_20261101T101637/` | `9251e04e3dc50ecb66cbd48faa7c6882b80f16a51af0746669cd5f0545b4e066` | `ai/service/models/ode/ode_summary_stats.json` |

The policy table lives at `../app/policy/data/margin_gru.json` and is committed configuration data (not a learned checkpoint). Its values are the prototype policy v0.3 defaults. The ODE source locations and source-file checksums are recorded in [`SOURCES.json`](../app/models/ode/SOURCES.json). Startup verifies both model hashes before loading. The selected checkpoint is epoch 20 and has 27 summary features with no HR0 head. In that mode, the service initializes from the median support-session start HR, or 85 bpm when support is unavailable.

Run `scripts/fetch_models.sh` on the GPU workspace or `scripts/fetch_models.ps1` on Windows. `ODEV21_SOURCE_CHECKPOINT` and `ODEV21_SOURCE_STATS` are required (the script stops if they are unset); set the expected SHA variables too when moving to a later checkpoint. The installed service paths can be changed separately with `ODEV21_CHECKPOINT_PATH` and `ODEV21_SUMMARY_STATS_PATH`. Installed names match the deployment names in `infra/ai/.env.example` (`/models/ode/ode_epoch_020.pt`, `/models/ode/ode_summary_stats.json`). When those env values are unset and the new names are missing, the service still reads an older local install named `model_epoch_020.pt` / `summary_stats.json`.

GRU predictor code is supplied by the team repository at `ai/workspace/doyeon/gru/src/`. The service image build copies that existing source directory; it is not duplicated here.
