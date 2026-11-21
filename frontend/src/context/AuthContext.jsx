import React, { createContext, useContext, useEffect, useState } from 'react';
import axios from 'axios';

import { API_URL } from '../config';
export { API_URL };

axios.defaults.withCredentials = true;

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        axios.get(`${API_URL}/api/auth/me`)
            .then(response => setUser(response.data.user))
            .catch(() => setUser(null))
            .finally(() => setLoading(false));
    }, []);

    const login = async (username, password) => {
        const response = await axios.post(`${API_URL}/api/auth/login`, {
            username,
            password
        });

        setUser(response.data.user);
        return response.data.user;
    };

    const logout = async () => {
        try {
            await axios.post(`${API_URL}/api/auth/logout`);
        } finally {
            setUser(null);
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used inside AuthProvider');
    return context;
}

export function getUserDestination(user) {
    if (!user) return '/login';
    if (user.role === 'admin') return '/';
    if (user.role === 'doctor') return '/doctor';
    if (user.role === 'astronaut') return `/astronaut/${user.astronaut_id}`;
    return '/login';
}
