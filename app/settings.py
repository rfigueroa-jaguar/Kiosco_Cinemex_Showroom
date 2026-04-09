"""Variables de entorno y rutas base."""

from pathlib import Path

from pydantic import ValidationInfo, field_validator
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
    # Ruta absoluta a PEM (cadena de confianza / CA del CPI) para que httpx verifique el HTTPS del CPI.
    cpi_ca_bundle: str = ""
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

    @field_validator("cpi_port", "im30_port", "mqtt_port", mode="before")
    @classmethod
    def empty_env_port_uses_default(cls, v: object, info: ValidationInfo) -> object:
        if v == "" or v is None:
            defaults = {"cpi_port": 5000, "im30_port": 6000, "mqtt_port": 1883}
            return defaults[info.field_name]
        return v


def load_settings() -> Settings:
    return Settings()
