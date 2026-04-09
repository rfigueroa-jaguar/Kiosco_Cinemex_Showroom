"""Variables de entorno y rutas base."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

APP_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(APP_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    cpi_host: str = ""
    cpi_port: int = 5000
    cpi_client_id: str = ""
    cpi_client_secret: str = ""
    cpi_username: str = ""
    cpi_password: str = ""
    # Solo desarrollo: omitir verificación de Root.cer en almacén Windows (no usar en kiosco).
    cpi_allow_without_root_verification: bool = False

    im30_host: str = "localhost"
    im30_port: int = 6000
    im30_user: str = ""
    im30_password: str = ""
    emv_bridge_token: str = ""

    mqtt_broker_url: str = ""
    mqtt_port: int = 1883
    mqtt_username: str = ""
    mqtt_password: str = ""
    mqtt_topic_base: str = ""


def load_settings() -> Settings:
    return Settings()
