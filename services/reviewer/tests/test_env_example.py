from pathlib import Path

import pytest

from reviewer.config import Settings, load_settings

ENV_EXAMPLE = Path(__file__).resolve().parents[3] / ".env.example"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)


def documented_keys() -> set[str]:
    keys = set()
    for line in ENV_EXAMPLE.read_text(encoding="utf-8").splitlines():
        name, sep, _ = line.strip().partition("=")
        if sep and not name.startswith("#"):
            keys.add(name)
    return keys


@pytest.mark.parametrize("field", sorted(Settings.model_fields))
def test_every_setting_is_documented(field: str) -> None:
    assert field.upper() in documented_keys()


def test_example_values_are_accepted() -> None:
    settings = load_settings(env_file=str(ENV_EXAMPLE))
    assert settings.reviewer_port == 8000
