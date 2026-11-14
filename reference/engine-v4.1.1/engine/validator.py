"""
Telemetry validation.

Design choices (changed from v1):
  * NO imputation. v1 linearly interpolated, which (a) hides long outages and
    (b) uses *future* samples, so it could not run in a live stream.
    Invalid readings are set to NaN, the row is flagged, and the detector
    simply ignores flagged rows.
  * Everything here is causal (a row's flag depends only on that row and the
    rows before it), so batch analysis and streaming give identical results.
  * Reasons accumulate: a row with two problems reports both.
  * Checks: missing value, out-of-bounds (sensor fault), flatline (stuck sensor).
"""
import numpy as np
import pandas as pd

from engine.config import (
    VITAL_COLUMNS, PLAUSIBILITY_BOUNDS, FLATLINE_STEPS, MAX_GAP_STEPS,
    RECENT_QUALITY_STEPS, RECENT_INVALID_FRACTION,
)


class TelemetryValidator:
    def validate(self, df: pd.DataFrame) -> pd.DataFrame:
        """Return a copy with `is_corrupted_detected`, `corruption_reason`, `activity_state`."""
        out = df.copy()
        out["timestamp"] = pd.to_datetime(out["timestamp"])
        if "activity_state" not in out.columns:
            out["activity_state"] = "UNKNOWN"
        out["activity_state"] = out["activity_state"].fillna("UNKNOWN").astype(str)

        reasons = [[] for _ in range(len(out))]
        corrupted = np.zeros(len(out), dtype=bool)

        for col in VITAL_COLUMNS:
            lo, hi = PLAUSIBILITY_BOUNDS[col]
            s = pd.to_numeric(out[col], errors="coerce")

            missing = s.isna().to_numpy()
            oob = ((s < lo) | (s > hi)).fillna(False).to_numpy()
            s = s.mask(oob)                       # sensor fault -> unknown, never imputed

            # stuck sensor: identical value repeated FLATLINE_STEPS times in a row
            grp = (s != s.shift()).cumsum()
            run_len = s.groupby(grp).cumcount() + 1
            flat = ((run_len >= FLATLINE_STEPS) & s.notna()).to_numpy()

            out[col] = s
            for i in np.flatnonzero(missing):
                reasons[i].append(f"MISSING_{col.upper()}")
            for i in np.flatnonzero(oob):
                reasons[i].append(f"OUT_OF_BOUNDS_{col.upper()}")
            for i in np.flatnonzero(flat):
                reasons[i].append(f"FLATLINE_{col.upper()}")
            corrupted |= missing | oob | flat

        out["is_corrupted_detected"] = corrupted.astype(int)
        out["corruption_reason"] = [";".join(r) if r else "VALID" for r in reasons]
        return out

    # ------------------------------------------------------------------
    @staticmethod
    def longest_invalid_run(flags: pd.Series) -> int:
        f = flags.to_numpy().astype(int)
        best = cur = 0
        for v in f:
            cur = cur + 1 if v else 0
            best = max(best, cur)
        return best

    def quality_report(self, validated: pd.DataFrame) -> dict:
        total = len(validated)
        bad = int(validated["is_corrupted_detected"].sum())
        reasons = validated["corruption_reason"]
        score = round((1.0 - bad / total) * 100.0, 2) if total else 0.0

        recent = validated.tail(RECENT_QUALITY_STEPS)
        recent_bad_frac = float(recent["is_corrupted_detected"].mean()) if len(recent) else 1.0
        current_run = self._current_invalid_run(validated["is_corrupted_detected"])
        stream_usable = (current_run <= MAX_GAP_STEPS) and (recent_bad_frac <= RECENT_INVALID_FRACTION)

        if not stream_usable:
            status = "INSUFFICIENT_DATA"
        elif score >= 95.0:
            status = "HEALTHY_STREAM"
        else:
            status = "DEGRADED_STREAM"

        return {
            "total_records": total,
            "corrupted_records": bad,
            "missing_values_detected": int(reasons.str.count("MISSING_").sum()),
            "out_of_bounds_detected": int(reasons.str.count("OUT_OF_BOUNDS_").sum()),
            "flatline_detected": int(reasons.str.count("FLATLINE_").sum()),
            "longest_invalid_run_steps": self.longest_invalid_run(validated["is_corrupted_detected"]),
            "current_invalid_run_steps": int(current_run),
            "recent_invalid_fraction": round(recent_bad_frac, 3),
            "data_quality_score_pct": score,
            "status": status,
        }

    @staticmethod
    def _current_invalid_run(flags: pd.Series) -> int:
        f = flags.to_numpy().astype(int)
        n = 0
        for v in f[::-1]:
            if v:
                n += 1
            else:
                break
        return n

    # backwards-compatible helper used by notebooks / older code
    def validate_and_clean(self, df: pd.DataFrame):
        v = self.validate(df)
        return v, self.quality_report(v)
