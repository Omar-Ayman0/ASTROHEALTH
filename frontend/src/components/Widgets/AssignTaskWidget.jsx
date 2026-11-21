import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Card from '../Common/Card';
import { API_URL } from '../../config';

const BACKEND_URL = API_URL;

const AssignTaskWidget = () => {
    const [tasks, setTasks] = useState([]);
    const [newTask, setNewTask] = useState('');

    useEffect(() => {
        fetchTasks();
    }, []);

    const fetchTasks = async () => {
        try {
            const res = await axios.get(`${BACKEND_URL}/api/tasks`);
            // Filter only medical tasks
            setTasks(res.data.filter(t => t.type === 'medical'));
        } catch (err) {
            console.error("Failed to fetch tasks", err);
        }
    };

    const addTask = async () => {
        if (!newTask.trim()) return;
        try {
            const res = await axios.post(`${BACKEND_URL}/api/tasks`, {
                text: newTask,
                type: 'medical'
            });
            setTasks([...tasks, res.data]);
            setNewTask('');
        } catch (err) {
            console.error("Failed to add task", err);
        }
    };

    const deleteTask = async (e, id) => {
        e.stopPropagation();
        try {
            await axios.delete(`${BACKEND_URL}/api/tasks/${id}`);
            setTasks(tasks.filter(t => t.id !== id));
        } catch (err) {
            console.error("Failed to delete task", err);
        }
    };

    return (
        <Card title="Assign Medical Orders">
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <input
                    type="text"
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                    placeholder="Assign new order..."
                    onKeyPress={(e) => e.key === 'Enter' && addTask()}
                    style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        flex: 1,
                        fontSize: '0.9rem',
                        marginBottom: 0
                    }}
                />
                <button
                    onClick={addTask}
                    className="btn"
                    style={{ padding: '8px 16px', fontSize: '0.9rem', background: 'var(--accent-orange)' }}
                >
                    Assign
                </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                {tasks.length === 0 && <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center', padding: '10px' }}>No active medical orders.</div>}
                {tasks.map(task => (
                    <div
                        key={task.id}
                        className="task-item"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '10px',
                            borderRadius: '8px',
                            background: '#fff7ed',
                            border: '1px solid #fed7aa',
                            position: 'relative'
                        }}
                    >
                        <div style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            background: task.completed ? 'var(--accent-green)' : 'var(--accent-orange)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            fontSize: '0.8rem',
                            flexShrink: 0
                        }}>
                            {task.completed ? '✓' : '!'}
                        </div>
                        <span style={{
                            textDecoration: task.completed ? 'line-through' : 'none',
                            color: task.completed ? 'var(--text-secondary)' : '#9a3412',
                            fontSize: '0.9rem',
                            fontWeight: 500,
                            flex: 1
                        }}>
                            {task.text}
                        </span>
                        <div style={{ fontSize: '0.75rem', color: '#9a3412', background: '#ffedd5', padding: '2px 6px', borderRadius: '4px' }}>
                            {task.completed ? 'COMPLETED' : 'PENDING'}
                        </div>
                        <button
                            onClick={(e) => deleteTask(e, task.id)}
                            style={{
                                border: 'none',
                                background: 'transparent',
                                color: 'var(--accent-red)',
                                cursor: 'pointer',
                                padding: '4px',
                                fontSize: '1.1rem',
                                lineHeight: 1,
                                marginLeft: '8px'
                            }}
                            title="Revoke Order"
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>
        </Card>
    );
};

export default AssignTaskWidget;
