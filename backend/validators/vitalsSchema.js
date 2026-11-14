// Simple validation schema (could use Joi or Zod, but keeping it simple as per prompt)
const validateVitals = (data) => {
    const requiredFields = [
        'heart_rate', 'spo2', 'bp_sys', 'bp_dia',
        'temperature', 'stress_level', 'bmi', 'timestamp'
    ];

    for (const field of requiredFields) {
        if (data[field] === undefined || data[field] === null) {
            return { valid: false, error: `Missing field: ${field}` };
        }
    }

    return { valid: true };
};

module.exports = { validateVitals };
