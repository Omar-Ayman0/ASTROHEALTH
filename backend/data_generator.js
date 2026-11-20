require('dotenv').config();
const axios = require('axios');
const db = require('./db');

// Configuration
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

/**
 * Main loop to fetch simulation data and send to ML service.
 * @param {SocketIO.Server} io 
 */
async function startDataGeneration(io) {
    console.log("Starting PROPHET-DRIVEN SIMULATION engine...");

    setInterval(async () => {
        try {
            // 1. Get Next Simulation Step (Vitals) from ML Service
            // The ML service now acts as the "Source of Truth" driven by Prophet
            const simRes = await axios.post(`${ML_SERVICE_URL}/simulation/next`);
            const { vitals, forecast } = simRes.data;

            // 2. Get Predictions based on these vitals
            let riskData = { risk_label: "Unknown", probabilities: {}, top_features: [] };
            let anomalyData = { is_anomaly: false, anomaly_score: 0 };

            try {
                const riskRes = await axios.post(`${ML_SERVICE_URL}/predict/risk`, vitals);
                riskData = riskRes.data;

                const anomalyRes = await axios.post(`${ML_SERVICE_URL}/predict/anomaly`, vitals);
                anomalyData = anomalyRes.data;
            } catch (predError) {
                console.error("Prediction error:", predError.message);
            }

            // 3. PERSIST TO DATABASE
            const stmt = db.prepare(`INSERT INTO vitals_log (timestamp, heart_rate, spo2, bp_sys, bp_dia, temperature, stress_level, sleep_hours, risk_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(vitals.timestamp, vitals.heart_rate, vitals.spo2, vitals.bp_sys, vitals.bp_dia, vitals.temperature, vitals.stress_level, vitals.sleep_hours, riskData.risk_label);
            stmt.finalize();

            // 4. Construct Payload
            const payload = {
                vitals,
                ...riskData,
                ...anomalyData,
                forecast: forecast || []
            };

            // 5. Broadcast to Dashboards
            io.emit('vitals_update', payload);

            // 6. Check for Alerts
            if (riskData.risk_label === 'Critical' || anomalyData.is_anomaly) {
                io.emit('doctor_alert', {
                    message: `CRITICAL ALERT: Risk is ${riskData.risk_label}, Anomaly: ${anomalyData.is_anomaly}`,
                    data: payload,
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            console.error("Simulation error (ML Service might be down):", error.message);
        }

    }, process.env.VITALS_INTERVAL || 2000); // Update interval based on env or default to 2s
}

module.exports = { startDataGeneration };
