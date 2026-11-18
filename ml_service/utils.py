import pandas as pd
import numpy as np
import random
from datetime import datetime, timedelta

def generate_synthetic_data(num_records=43200):
    """
    Generates synthetic astronaut health data using a physiological random walk model.
    This ensures the training data matches the realistic live data distribution.
    Default: 43,200 records = 1 month of minute-by-minute data
    """
    print(f"Generating {num_records} synthetic records...")
    
    # Initial State
    current_state = {
        'heart_rate': 75.0,
        'spo2': 98.0,
        'bp_sys': 120.0,
        'bp_dia': 80.0,
        'temperature': 37.0,
        'stress_level': 30.0,
        'trend_stress': 0.0
    }

    data = []
    start_time = datetime.now() - timedelta(minutes=num_records)

    for i in range(num_records):
        timestamp = start_time + timedelta(minutes=i)

        # 1. Evolve Stress
        current_state['trend_stress'] += (random.random() - 0.5) * 2
        current_state['stress_level'] += current_state['trend_stress'] + (random.random() - 0.5) * 5
        current_state['stress_level'] = max(0, min(100, current_state['stress_level']))
        current_state['trend_stress'] *= 0.9

        # 2. Evolve Heart Rate
        target_hr = 60 + (current_state['stress_level'] * 0.5)
        pull = (target_hr - current_state['heart_rate']) * 0.1
        current_state['heart_rate'] += pull + (random.random() - 0.5) * 4
        current_state['heart_rate'] = max(45, min(180, current_state['heart_rate']))

        # 3. Evolve SpO2
        if random.random() > 0.99: # Occasional drop
            current_state['spo2'] -= random.random() * 2
        else:
            current_state['spo2'] += (98 - current_state['spo2']) * 0.1 + (random.random() - 0.5)
        current_state['spo2'] = max(85, min(100, current_state['spo2']))

        # 4. Evolve BP
        current_state['bp_sys'] = 100 + (current_state['heart_rate'] - 60) * 0.5 + (current_state['stress_level'] * 0.2) + (random.random() - 0.5) * 2
        current_state['bp_dia'] = 70 + (current_state['heart_rate'] - 60) * 0.3 + (current_state['stress_level'] * 0.1) + (random.random() - 0.5) * 2

        # 5. Temperature
        current_state['temperature'] += (random.random() - 0.5) * 0.05
        current_state['temperature'] = max(36.0, min(39.0, current_state['temperature']))

        # Compensation
        if current_state['spo2'] < 92:
            current_state['heart_rate'] += 2

        # Round values for storage
        hr = int(round(current_state['heart_rate']))
        spo2 = int(round(current_state['spo2']))
        bp_sys = int(round(current_state['bp_sys']))
        bp_dia = int(round(current_state['bp_dia']))
        temp = round(current_state['temperature'], 1)
        stress = int(round(current_state['stress_level']))
        
        # Static/Slow changing
        sleep_hours = round(random.normalvariate(7, 1.5), 1)
        sleep_hours = max(0, sleep_hours)
        bmi = 24.5

        # Determine Risk Label (Ground Truth Logic)
        # Determine Risk Label (Ground Truth Logic)
        risk_label = "Low"
        
        # Medium Risk Conditions (Elevated but not dangerous)
        if (hr > 90 or hr < 55) or (spo2 < 96) or (bp_sys > 135) or (temp > 37.5) or (stress > 60):
            risk_label = "Medium"

        # High Risk Conditions
        if (hr > 110 or hr < 50) or (spo2 < 94) or (bp_sys > 150) or (temp > 38.0) or (stress > 80):
            risk_label = "High"
            
        # Critical Risk Conditions
        if (hr > 150 or hr < 40) or (spo2 < 88) or (bp_sys > 180) or (temp > 39.5):
            risk_label = "Critical"

        data.append({
            "timestamp": timestamp,
            "heart_rate": hr,
            "spo2": spo2,
            "bp_sys": bp_sys,
            "bp_dia": bp_dia,
            "temperature": temp,
            "stress_level": stress,
            "sleep_hours": sleep_hours,
            "bmi": bmi,
            "risk_label": risk_label
        })

    return pd.DataFrame(data)
