const db = require('./db');

db.run("DELETE FROM vitals_log", function (err) {
    if (err) {
        console.error("Error clearing data:", err.message);
    } else {
        console.log(`Deleted ${this.changes} rows from vitals_log.`);
    }
    // Close the database connection after the operation
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed.');
    });
});
