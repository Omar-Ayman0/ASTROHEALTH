from fastapi import FastAPI
from pydantic import BaseModel
import numpy as np
import joblib
import os
from datetime import datetime, timedelta

app = FastAPI(title="Astronaut Health ML Service")

iso_forest = None
simulation_states = {}


class SimulationState:
    def __init__(self):
        self.current_time = datetime.now()
        self.last_vitals = None
        self.force_anomaly = False


def get_state(astronaut_id: str):
    if astronaut_id not in simulation_states:
        simulation_states[astronaut_id] = SimulationState()
    return simulation_states[astronaut_id]


@app.on_event("startup")
async def load_models():
    global iso_forest
    try:
        model_path = os.path.join(
            os.path.dirname(__file__), "models", "iso_forest.pkl"
        )
        iso_forest = joblib.load(model_path)
        print("Isolation Forest loaded successfully.")
    except Exception as e:
        print(f"Model loading error: {e}")


class VitalsInput(BaseModel):
    heart_rate: float
    spo2: float
    bp_sys: float
    bp_dia: float
    temperature: float
    stress_level: float
    sleep_hours: float
    bmi: float
    timestamp: str = None
    astronaut_id: str = "ASTRO_01"


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "models_loaded": iso_forest is not None,
        "simulation": "multi_astronaut",
        "active_astronauts": list(simulation_states.keys())
    }


@app.post("/simulation/next")
async def get_next_simulation_step(astronaut_id: str = "ASTRO_01"):
    state = get_state(astronaut_id)
    state.current_time += timedelta(minutes=1)

    if state.last_vitals is None:
        vitals = {
            "heart_rate": 75,
            "spo2": 98,
            "bp_sys": 120,
            "bp_dia": 80,
            "temperature": 37.0,
            "stress_level": 25,
            "sleep_hours": 7.5,
            "bmi": 24.5
        }
    else:
        previous = state.last_vitals
        vitals = {
            "heart_rate": int(np.clip(previous["heart_rate"] + np.random.normal(0, 2), 55, 110)),
            "spo2": round(float(np.clip(previous["spo2"] + np.random.normal(0, 0.3), 95, 100)), 1),
            "bp_sys": int(np.clip(previous["bp_sys"] + np.random.normal(0, 2), 100, 140)),
            "bp_dia": int(np.clip(previous["bp_dia"] + np.random.normal(0, 1), 60, 90)),
            "temperature": round(float(np.clip(previous["temperature"] + np.random.normal(0, 0.03), 36.3, 37.5)), 2),
            "stress_level": int(np.clip(previous["stress_level"] + np.random.normal(0, 2), 5, 60)),
            "sleep_hours": previous["sleep_hours"],
            "bmi": previous["bmi"]
        }

    if state.force_anomaly:
        vitals.update({
            "heart_rate": 180,
            "spo2": 75,
            "bp_sys": 190,
            "bp_dia": 120,
            "temperature": 40.0,
            "stress_level": 95,
            "sleep_hours": 2.0
        })
        state.force_anomaly = False

    vitals["timestamp"] = state.current_time.isoformat()
    vitals["astronaut_id"] = astronaut_id
    state.last_vitals = vitals

    return {
        "astronaut_id": astronaut_id,
        "vitals": vitals,
        "forecast": []
    }


@app.post("/simulation/trigger-anomaly")
async def trigger_anomaly(astronaut_id: str = "ASTRO_01"):
    state = get_state(astronaut_id)
    state.force_anomaly = True
    return {
        "success": True,
        "astronaut_id": astronaut_id,
        "message": f"Anomaly scheduled for {astronaut_id}"
    }


@app.post("/predict/risk")
async def predict_risk(data: VitalsInput):
    risk = "Low"
    features = []

    if data.heart_rate > 150 or data.spo2 < 85 or data.temperature > 39:
        risk = "Critical"
        features = ["critical_vital_signs"]
    elif data.heart_rate > 120 or data.spo2 < 92 or data.temperature > 38:
        risk = "High"
        features = ["elevated_vital_signs"]
    elif data.heart_rate > 100 or data.spo2 < 95 or data.stress_level > 70:
        risk = "Medium"
        features = ["moderate_vital_deviation"]

    return {
        "astronaut_id": data.astronaut_id,
        "risk_label": risk,
        "probabilities": {},
        "top_features": features
    }


@app.post("/predict/anomaly")
async def predict_anomaly(data: VitalsInput):
    if iso_forest is None:
        return {
            "astronaut_id": data.astronaut_id,
            "is_anomaly": False,
            "anomaly_score": 0.0,
            "model_loaded": False
        }

    features = np.array([[
        data.heart_rate,
        data.spo2,
        data.bp_sys,
        data.bp_dia,
        data.temperature,
        data.stress_level,
        data.sleep_hours,
        data.bmi
    ]])

    prediction = iso_forest.predict(features)[0]
    score = float(iso_forest.decision_function(features)[0])

    return {
        "astronaut_id": data.astronaut_id,
        "is_anomaly": bool(prediction == -1),
        "anomaly_score": score,
        "model_loaded": True
    }
