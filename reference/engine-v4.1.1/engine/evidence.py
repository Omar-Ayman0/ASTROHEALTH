"""
Scientific Evidence Layer (v2.1).

One place that says, for every monitored signal: what the field means, its unit, which
sensor site / definition is ASSUMED, what the engine may infer from it and what it may NOT,
and how strong the supporting evidence is.  It changes no analysis result and no JSON
contract field; it feeds (a) human-readable text in explanations / key findings, (b) the
optional `GET /api/v1/evidence` endpoint, (c) docs/signal_definitions.json for the dashboard
and the AI assistant, so they explain the numbers instead of guessing.

Evidence levels (be honest about them in front of the committee):
  SOURCED         a collected NASA / peer-reviewed source supports the choice of the signal
  SOURCED_PARTIAL signal is used in spaceflight wearable studies, exact link to our metric still to be read
  ASSUMPTION      design choice of this team, no source collected yet
Scientific foundation (why this signal is a sensible thing to watch) is NOT clinical validation
(proof that this system detects real medical conditions). This project has the first, not the second.
"""
from engine.config import SKIN_TEMP_SITE, HRV_METRIC

SIGNALS = {
    "heart_rate_bpm": {
        "label": "Heart rate", "unit": "bpm", "role": "core",
        "meaning": "Beats per minute from a wearable optical/ECG sensor.",
        "can_infer": ["deviation from this astronaut's own time-of-day / sleep-aware normal",
                      "sustained elevation (drift) over hours"],
        "cannot_infer": ["cause of a deviation", "any cardiac diagnosis"],
        "evidence": "SOURCED",
        "evidence_note": "Cardiovascular adaptation is a NASA HRP risk; HR was recorded by wearables in Inspiration4 (team research report). Public in-flight HR numbers found are single-astronaut Holter data (N=1): see outputs/evidence_table.*",
    },
    "hrv_ms": {
        "label": "Heart rate variability", "unit": "ms", "role": "supporting",
        "meaning": f"Beat-to-beat variability, ASSUMED to be {HRV_METRIC} over short windows. "
                   "The field name does not say which metric: RMSSD and SDNN are NOT interchangeable.",
        "can_infer": ["change relative to the same astronaut, same metric, same device"],
        "cannot_infer": ["comparison with published HRV values unless the metric and window match",
                         "any diagnosis"],
        "evidence": "SOURCED_PARTIAL",
        "evidence_note": "24 h HRV rhythm persisting in long-duration flight (Otsuka et al.); metric used there must be checked before quoting numbers.",
    },
    "spo2_pct": {
        "label": "Blood oxygen saturation", "unit": "%", "role": "supporting",
        "meaning": "Peripheral oxygen saturation from a wearable pulse oximeter.",
        "can_infer": ["drop or sustained shift from personal normal (still scored during exercise)"],
        "cannot_infer": ["hypoxaemia diagnosis", "reliability under motion/poor perfusion without the data-quality flags"],
        "evidence": "SOURCED_PARTIAL",
        "evidence_note": "Measured by wearables in Inspiration4 (team research report). The only public figure collected (outputs/evidence_table.*) is ~97% in 8 astronauts under a hypoxic challenge, NOT resting in-flight. Measurement quality caveats apply.",
    },
    "skin_temp_c": {
        "label": "Skin temperature", "unit": "degC", "role": "supporting",
        "meaning": f"{SKIN_TEMP_SITE}. Typically several degrees below core temperature and "
                   "influenced by ambient temperature and sensor contact.",
        "can_infer": ["shift relative to the astronaut's own skin-temperature normal"],
        "cannot_infer": ["core body temperature or fever", "numbers from core-temperature studies do not apply"],
        "evidence": "ASSUMPTION",
        "evidence_note": "No skin-temperature source collected. Published spaceflight temperature results (Stahn 2017) are core temperature: not direct evidence for this field.",
    },
    "resp_rate_bpm": {
        "label": "Respiratory rate", "unit": "breaths/min", "role": "supporting",
        "meaning": "Breaths per minute, derived by the wearable.",
        "can_infer": ["change in breathing rate relative to personal normal"],
        "cannot_infer": ["respiratory disease or its cause"],
        "evidence": "ASSUMPTION",
        "evidence_note": "No source for respiratory rate itself; only end-tidal CO2 was found and it has no engine field.",
    },
    "sleep_hours": {
        "label": "Sleep duration", "unit": "h/night", "role": "core",
        "meaning": "DERIVED, not a raw sensor field: hours with activity_state == SLEEP per night. "
                   "Real datasets that give one value per night must be mapped through engine/adapter.py.",
        "can_infer": ["restriction trend over consecutive nights vs personal baseline"],
        "cannot_infer": ["sleep quality / stages", "circadian phase"],
        "evidence": "SOURCED",
        "evidence_note": "Sleep loss and circadian misalignment are a named NASA HRP risk and documented on the ISS.",
    },
}

OUT_OF_SCOPE = [
    {"area": "Radiation exposure", "reason": "needs a radiation dosimeter; none of the five vitals measures it"},
    {"area": "Bone and muscle loss", "reason": "needs imaging / strength / biochemical measurements, not wearable vitals"},
]

DISCLAIMER_SCOPE = ("Scientific foundation, not clinical validation: the engine reports deviations from a "
                    "person's own baseline for human medical review. It does not diagnose.")

# short tags appended to free-text only (never to contract field names such as `vital`)
_TAGS = {
    "skin_temp_c": "peripheral skin temperature, not core",
    "hrv_ms": HRV_METRIC,
}


def label(col: str) -> str:
    """Field name with its meaning tag, for human-readable strings only."""
    tag = _TAGS.get(col)
    return f"{col} ({tag})" if tag else col


def describe() -> dict:
    return {"signals": SIGNALS, "out_of_scope": OUT_OF_SCOPE, "scope_note": DISCLAIMER_SCOPE,
            "evidence_table": "outputs/evidence_table.json"}
