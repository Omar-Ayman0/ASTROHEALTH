import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomeSelection from './pages/HomeSelection';
import AstronautDashboard from './pages/AstronautDashboard';
import DoctorDashboard from './pages/DoctorDashboard';

function App() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<HomeSelection />} />
                <Route path="/astronaut/:astronautId" element={<AstronautDashboard />} />
                <Route path="/doctor" element={<DoctorDashboard />} />
            </Routes>
        </Router>
    );
}

export default App;
