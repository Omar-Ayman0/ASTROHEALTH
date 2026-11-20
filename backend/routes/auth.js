const express = require('express');
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('../db');

const router = express.Router();
const scrypt = promisify(crypto.scrypt);

async function verifyPassword(password, salt, storedHash) {
    const derived = await scrypt(password, salt, 64);
    const expected = Buffer.from(storedHash, 'hex');

    return expected.length === derived.length &&
        crypto.timingSafeEqual(derived, expected);
}

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body || {};

        if (typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ message: 'Username and password are required.' });
        }

        db.get(
            `SELECT id, username, password_salt, password_hash,
                    role, astronaut_id, active
             FROM users WHERE username = ?`,
            [username.trim()],
            async (err, user) => {
                if (err) {
                    console.error('Login database error:', err.message);
                    return res.status(500).json({ message: 'Login failed.' });
                }

                if (!user) {
                    return res.status(401).json({ message: 'Username not found.' });
                }

                if (!user.active) {
                    return res.status(403).json({ message: 'This account is disabled.' });
                }

                try {
                    const valid = await verifyPassword(
                        password,
                        user.password_salt,
                        user.password_hash
                    );

                    if (!valid) {
                        return res.status(401).json({ message: 'Incorrect password.' });
                    }

                    req.session.regenerate((sessionError) => {
                        if (sessionError) {
                            console.error('Session error:', sessionError.message);
                            return res.status(500).json({ message: 'Could not create session.' });
                        }

                        req.session.user = {
                            id: user.id,
                            username: user.username,
                            role: user.role,
                            astronaut_id: user.astronaut_id
                        };

                        req.session.save((saveError) => {
                            if (saveError) {
                                console.error('Session save error:', saveError.message);
                                return res.status(500).json({ message: 'Could not save session.' });
                            }

                            return res.json({
                                message: 'Login successful.',
                                user: req.session.user
                            });
                        });
                    });
                } catch (verifyError) {
                    console.error('Password verification error:', verifyError.message);
                    return res.status(500).json({ message: 'Login failed.' });
                }
            }
        );
    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({ message: 'Login failed.' });
    }
});

router.post('/logout', (req, res) => {
    if (!req.session) {
        return res.json({ message: 'Logged out.' });
    }

    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ message: 'Logout failed.' });
        }

        res.clearCookie('astrohealth.sid');
        return res.json({ message: 'Logged out.' });
    });
});

router.get('/me', (req, res) => {
    if (!req.session?.user) {
        return res.status(401).json({ message: 'Not authenticated.' });
    }

    return res.json({ user: req.session.user });
});

module.exports = router;
