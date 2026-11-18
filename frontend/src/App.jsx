import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import HomeSelection from './pages/HomeSelection';
import AstronautDashboard from './pages/AstronautDashboard';
import DoctorDashboard from './pages/DoctorDashboard';
import Login from './pages/Login';
import { AuthProvider, useAuth, getUserDestination } from './context/AuthContext';

function ProtectedRoute({ children, allowedRoles, astronautId }) {
    const { user, loading } = useAuth();
    const location = useLocation();

    if (loading) return <div className="login-initial-loader"><span /> Verifying mission credentials...</div>;
    if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

    if (!allowedRoles.includes(user.role)) {
        return <Navigate to={getUserDestination(user)} replace />;
    }

    if (astronautId && user.role === 'astronaut' && user.astronaut_id !== astronautId) {
        return <Navigate to={getUserDestination(user)} replace />;
    }

    return children;
}

function AppRoutes() {
    const { user, loading } = useAuth();

    if (loading) {
        return <div className="login-initial-loader"><span /> Establishing secure connection...</div>;
    }

    return (
        <Routes>
            <Route path="/login" element={<Login />} />

            <Route path="/" element={
                <ProtectedRoute allowedRoles={['admin']}>
                    <HomeSelection />
                </ProtectedRoute>
            } />

            <Route path="/onboard/:astronautId" element={
                <AstronautRoute />
            } />

            <Route path="/astronaut/:astronautId" element={
                <AstronautRoute />
            } />

            <Route path="/doctor" element={
                <ProtectedRoute allowedRoles={['doctor', 'admin']}>
                    <DoctorDashboard />
                </ProtectedRoute>
            } />

            <Route path="*" element={
                <Navigate to={getUserDestination(user)} replace />
            } />
        </Routes>
    );
}

function AstronautRoute() {
    const { user } = useAuth();
    const location = useLocation();
    const astronautId = location.pathname.split('/').pop();

    if (!/^ASTRO_0[1-4]$/.test(astronautId)) {
        return <Navigate to={getUserDestination(user)} replace />;
    }

    return (
        <ProtectedRoute allowedRoles={['astronaut', 'admin']} astronautId={astronautId}>
            <AstronautDashboard />
        </ProtectedRoute>
    );
}

function App() {
    return (
        <AuthProvider>
            <Router>
                <AppRoutes />
            </Router>
        </AuthProvider>
    );
}

export default App;

