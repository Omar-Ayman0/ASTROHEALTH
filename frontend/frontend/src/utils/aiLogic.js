export const generateSuggestions = (vitals, riskData = {}, anomalyData = {}) => {
    const suggestions = [];
    const precautions = [];

    if (!vitals) {
        return {
            suggestions: ['Waiting for the latest monitoring-engine telemetry.'],
            precautions: []
        };
    }

    const available = [
        ['Heart rate', vitals.heart_rate],
        ['Oxygen saturation', vitals.spo2],
        ['Skin temperature', vitals.temperature],
        ['Heart rate variability', vitals.hrv],
        ['Respiratory rate', vitals.respiratory_rate]
    ].filter(([, value]) => value !== null && value !== undefined);

    if (available.length === 0) {
        suggestions.push('No usable vital-sign readings are currently available.');
    } else {
        suggestions.push(`${available.length} vital-sign measurements are available from the latest telemetry.`);
    }

    if (anomalyData?.is_anomaly) {
        suggestions.push('The monitoring engine flagged an unusual pattern in the available telemetry. Review the engine findings and associated readings.');
        precautions.push('Medical officer review is recommended for the engine-flagged findings.');
    } else {
        suggestions.push('No anomaly flag was reported by the monitoring engine in the latest available tick. This does not establish that all vital signs are normal.');
    }

    if (riskData?.risk_label) {
        suggestions.push(`Engine monitoring status: ${String(riskData.risk_label).replace(/_/g, ' ')}.`);
    }

    if (riskData?.top_features?.length) {
        suggestions.push(`Engine-highlighted features: ${riskData.top_features.join(', ')}.`);
    }

    if (available.length < 5) {
        const missing = [
            ['Heart rate', vitals.heart_rate],
            ['SpO2', vitals.spo2],
            ['Skin temperature', vitals.temperature],
            ['HRV', vitals.hrv],
            ['Respiratory rate', vitals.respiratory_rate]
        ].filter(([, value]) => value === null || value === undefined)
         .map(([name]) => name);

        suggestions.push(`No current reading available for: ${missing.join(', ')}.`);
    }

    return { suggestions, precautions };
};