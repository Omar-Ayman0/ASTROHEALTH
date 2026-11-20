const session = require('express-session');
const db = require('./db');

class SQLiteSessionStore extends session.Store {
    get(sid, callback) {
        db.get(
            'SELECT sess, expires FROM user_sessions WHERE sid = ?',
            [sid],
            (err, row) => {
                if (err) return callback(err);
                if (!row) return callback(null, null);

                if (row.expires <= Date.now()) {
                    return this.destroy(sid, () => callback(null, null));
                }

                try {
                    callback(null, JSON.parse(row.sess));
                } catch (parseError) {
                    callback(parseError);
                }
            }
        );
    }

    set(sid, sess, callback = () => {}) {
        const expires = sess.cookie?.expires
            ? new Date(sess.cookie.expires).getTime()
            : Date.now() + 30 * 24 * 60 * 60 * 1000;

        db.run(
            `INSERT INTO user_sessions (sid, sess, expires)
             VALUES (?, ?, ?)
             ON CONFLICT(sid) DO UPDATE SET
                sess = excluded.sess,
                expires = excluded.expires`,
            [sid, JSON.stringify(sess), expires],
            callback
        );
    }

    destroy(sid, callback = () => {}) {
        db.run(
            'DELETE FROM user_sessions WHERE sid = ?',
            [sid],
            callback
        );
    }

    touch(sid, sess, callback = () => {}) {
        this.set(sid, sess, callback);
    }
}

module.exports = SQLiteSessionStore;
