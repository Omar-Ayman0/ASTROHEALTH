import React from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

const VitalsChart = ({ data, label, color, min, max }) => {
    const chartData = {
        labels: data.map(d => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date(d.timestamp))),
        datasets: [
            {
                label: label,
                data: data.map(d => d.value),
                borderColor: color,
                backgroundColor: color + '33', // Add transparency
                fill: true,
                tension: 0.4,
            },
        ],
    };

    const options = {
        responsive: true,
        scales: {
            y: {
                min: min,
                max: max,
                grid: { color: '#334155' },
                ticks: { color: '#94a3b8' }
            },
            x: {
                display: false // Hide x labels for cleanliness
            }
        },
        plugins: {
            legend: { display: false },
            tooltip: { mode: 'index', intersect: false }
        }
    };

    return <Line data={chartData} options={options} />;
};

export default VitalsChart;

