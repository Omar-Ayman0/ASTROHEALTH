import pandas as pd
from sdv.single_table import CTGANSynthesizer
from sdv.metadata import SingleTableMetadata
from utils import generate_synthetic_data
import os
import joblib

def train_ctgan_and_generate():
    print("1. Generating seed data (Rule-based)...")
    # Generate a smaller seed dataset to learn from
    seed_data = generate_synthetic_data(num_records=2000)
    
    print("2. Initializing CTGAN metadata...")
    metadata = SingleTableMetadata()
    metadata.detect_from_dataframe(seed_data)
    
    print("3. Training CTGAN model...")
    print("This may take several minutes...")
    synthesizer = CTGANSynthesizer(metadata)
    synthesizer.fit(seed_data)
    
    # Save the synthesizer
    if not os.path.exists('models'):
        os.makedirs('models')
    synthesizer.save('models/ctgan_model.pkl')
    print("CTGAN model saved to models/ctgan_model.pkl")
    
    print("4. Generating synthetic data using CTGAN...")
    # Generate a larger dataset for training the classifiers
    synthetic_data = synthesizer.sample(num_rows=50000)
    
    print("5. Saving CTGAN-generated data...")
    synthetic_data.to_csv('ctgan_training_data.csv', index=False)
    print("Data saved to ctgan_training_data.csv")

if __name__ == "__main__":
    train_ctgan_and_generate()
