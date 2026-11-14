"""
Pydantic models for API *requests* (and OpenAPI docs).
Responses are plain dicts validated by engine/contract.py, because the contract
contains nullable and nested blocks that are easier to keep exact as JSON.
"""
from typing import Optional

from pydantic import BaseModel, Field


class SingleVitalReading(BaseModel):
    astronaut_id: str = "ASTRO_01"
    heart_rate_bpm: float
    hrv_ms: float
    spo2_pct: float
    skin_temp_c: float
    resp_rate_bpm: float
    timestamp: Optional[str] = Field(
        default=None, description="ISO time of the reading. If given, the time-of-day baseline is applied.")
    activity_state: Optional[str] = Field(default=None, description="REST | SLEEP | ACTIVE")


class Reading(BaseModel):
    timestamp: str
    heart_rate_bpm: Optional[float] = None
    hrv_ms: Optional[float] = None
    spo2_pct: Optional[float] = None
    skin_temp_c: Optional[float] = None
    resp_rate_bpm: Optional[float] = None
    activity_state: Optional[str] = "REST"


class AnalyzeRequest(BaseModel):
    astronaut_id: str = "ASTRO_01"
    readings: list[Reading] = Field(min_length=12, description="Post-calibration window, oldest first, 5-min cadence.")


class LiveReading(BaseModel):
    """One raw reading pushed by the backend (or any telemetry source)."""
    astronaut_id: str
    timestamp: str = Field(description="ISO time, 5-minute cadence, strictly increasing per astronaut")
    heart_rate_bpm: Optional[float] = None
    hrv_ms: Optional[float] = None
    spo2_pct: Optional[float] = None
    skin_temp_c: Optional[float] = None
    resp_rate_bpm: Optional[float] = None
    activity_state: Optional[str] = Field(default="REST", description="REST | SLEEP | ACTIVE")
