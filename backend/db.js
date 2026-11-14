const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'health_monitor.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_role TEXT,
        receiver_role TEXT,
        content TEXT,
        timestamp TEXT,
        status TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        role TEXT,
        age INTEGER,
        blood_type TEXT,
        medical_history TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS vitals_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        heart_rate INTEGER,
        spo2 INTEGER,
        bp_sys INTEGER,
        bp_dia INTEGER,
        temperature REAL,
        stress_level INTEGER,
        sleep_hours REAL,
        risk_label TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT,
        completed INTEGER DEFAULT 0,
        timestamp TEXT,
        type TEXT DEFAULT 'personal'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS health_alert_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT NOT NULL UNIQUE,
        event_id TEXT NOT NULL UNIQUE,
        astronaut_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING_MEDICAL_REVIEW',
        severity TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        assigned_role TEXT NOT NULL DEFAULT 'MEDICAL_OFFICER',
        source TEXT,
        payload_json TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS incident_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        previous_status TEXT,
        new_status TEXT NOT NULL,
        actor TEXT,
        notes TEXT,
        request_id TEXT UNIQUE,
        created_at TEXT NOT NULL
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_incident_actions_incident
        ON incident_actions(incident_id, created_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_incidents_astronaut
        ON incidents(astronaut_id, created_at)`);
    db.run(`CREATE TABLE IF NOT EXISTS engine_sync_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        engine_instance_id TEXT NOT NULL,
        next_since_seq INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS engine_event_receipts (
        emission_id TEXT PRIMARY KEY,
        engine_instance_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        processed_at TEXT NOT NULL
    )`);
    // Migration for existing table
    db.run(`ALTER TABLE incidents ADD COLUMN engine_status TEXT NOT NULL DEFAULT 'ACTIVE'`, () => {});
    db.run(`ALTER TABLE tasks ADD COLUMN type TEXT DEFAULT 'personal'`, (err) => {
        // Ignore error if column already exists
    });
    });
}

module.exports = db;





