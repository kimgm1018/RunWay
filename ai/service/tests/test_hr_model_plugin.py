"""팀원 HR 모델을 코드 수정 없이 HR_MODEL_TYPE + HR_MODEL_PLUGIN으로 끼우는 슬롯 테스트."""
from dataclasses import replace
import sys
import textwrap

import pytest

from app.config import load_settings
from app.decide.loader import load_policy
from app.models import load_model
from demo_fakes import write_margin_table

PLUGIN_SOURCE = textwrap.dedent('''
    import numpy as np
    from app.models.base import ModelInfo

    class PaceBpmModel:
        info = ModelInfo(model_type="pacebpm", model_version="pacebpm-test-1", window_sec=360, min_samples=1)

        def __init__(self, rows=3):
            self.rows = rows

        def predict(self, batch):
            n = len(batch["future_speed"])
            base = np.nan_to_num(batch["hr"][:, -1], nan=140.0)
            return np.tile(base[:, None], (1, self.rows)) + batch["future_speed"].mean(1)[:, None]

    def load(settings):
        return PaceBpmModel()

    def load_bad_shape(settings):
        return PaceBpmModel(rows=2)

    def load_wrong_type(settings):
        model = PaceBpmModel()
        model.info = ModelInfo(model_type="other", model_version="x", window_sec=60, min_samples=1)
        return model
''')


@pytest.fixture
def plugin_settings(tmp_path, monkeypatch):
    (tmp_path / "pacebpm_plugin_fixture.py").write_text(PLUGIN_SOURCE, encoding="utf-8")
    monkeypatch.setenv("HR_MODEL_TYPE", "pacebpm")
    monkeypatch.setenv("HR_MODEL_PLUGIN", "pacebpm_plugin_fixture:load")
    monkeypatch.setenv("HR_MODEL_PLUGIN_DIR", str(tmp_path))
    yield load_settings()
    sys.modules.pop("pacebpm_plugin_fixture", None)


def test_plugin_model_is_loaded_from_env_without_service_code_changes(plugin_settings):
    model = load_model(plugin_settings)

    assert model.info.model_type == "pacebpm"
    assert model.info.model_version == "pacebpm-test-1"


def test_plugin_output_must_be_n_by_three_hr_at_30_60_120(plugin_settings):
    with pytest.raises(ValueError, match=r"\[N, 3\]"):
        load_model(replace(plugin_settings, model_plugin="pacebpm_plugin_fixture:load_bad_shape"))


def test_plugin_model_type_must_match_hr_model_type(plugin_settings):
    with pytest.raises(ValueError, match="HR_MODEL_TYPE"):
        load_model(replace(plugin_settings, model_plugin="pacebpm_plugin_fixture:load_wrong_type"))


def test_non_gru_type_without_plugin_is_rejected(plugin_settings):
    with pytest.raises(ValueError, match="HR_MODEL_PLUGIN"):
        load_model(replace(plugin_settings, model_plugin=None))


def test_ai04_policy_needs_a_margin_table_of_the_same_model_family(plugin_settings, tmp_path):
    (tmp_path / "gru").mkdir()
    gru_table = write_margin_table(tmp_path / "gru", model="GRU")
    own_table = write_margin_table(tmp_path, model="PACEBPM-v1")

    assert load_policy(replace(plugin_settings, margin_table_path=gru_table)) is None
    assert load_policy(replace(plugin_settings, margin_table_path=own_table)) is not None
