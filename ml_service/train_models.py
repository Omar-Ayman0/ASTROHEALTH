import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from prophet import Prophet
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import joblib
import os
from utils import generate_synthetic_data

def train_and_save_models():
    data_file = 'ctgan_training_data.csv'
    
    if not os.path.exists(data_file):
        print(f"{data_file} not found. Running CTGAN training first...")
        from train_ctgan import train_ctgan_and_generate
        train_ctgan_and_generate()
        
    print(f"Loading training data from {data_file}...")
    df = pd.read_csv(data_file)
    print("Data loaded successfully.")
    
    # Features for Risk Classification
    X = df[['heart_rate', 'spo2', 'bp_sys', 'bp_dia', 'temperature', 'stress_level', 'sleep_hours', 'bmi']]
    y = df['risk_label']

    # 1. Train RandomForest for Risk Classification
    print("Training RandomForestClassifier...")
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    rf_model = RandomForestClassifier(n_estimators=100, random_state=42)
    rf_model.fit(X_train, y_train)
    
    print("RandomForest Performance:")
    print(classification_report(y_test, rf_model.predict(X_test)))

    # 2. Train IsolationForest for Anomaly Detection
    print("Training IsolationForest...")
    # We use the same features but unsupervised
    iso_forest = IsolationForest(n_estimators=100, contamination=0.05, random_state=42)
    iso_forest.fit(X)

    # 3. Train Prophet Models for all vitals
    print("Training Prophet models for all vitals...")
    vitals_to_forecast = ['heart_rate', 'spo2', 'bp_sys', 'bp_dia', 'temperature', 'stress_level']
    
    if not os.path.exists('models'):
        os.makedirs('models')

    for vital in vitals_to_forecast:
        print(f"Training Prophet model for {vital}...")
        # Prepare data for Prophet
        prophet_df = df[['timestamp', vital]].rename(columns={'timestamp': 'ds', vital: 'y'})
        prophet_df['ds'] = pd.to_datetime(prophet_df['ds'])
        
        # Train model
        m = Prophet(daily_seasonality=False, weekly_seasonality=False, yearly_seasonality=False)
        m.fit(prophet_df)
        
        # Save model
        joblib.dump(m, f'models/prophet_{vital}.pkl')

    # Save other models
    joblib.dump(rf_model, 'models/rf_model.pkl')
    joblib.dump(iso_forest, 'models/iso_forest.pkl')
    print("All models saved to ml_service/models/")

if __name__ == "__main__":
    train_and_save_models()
