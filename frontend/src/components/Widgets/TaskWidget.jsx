import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Card from '../Common/Card';
import { API_URL } from '../../config';

const BACKEND_URL = API_URL;

const TaskWidget = () => {
    const [tasks, setTasks] = useState([]);
    const [newTask, setNewTask] = useState('');

    useEffect(() => {
        fetchTasks();
    }, []);

    const fetchTasks = async () => {
        try {
            const res = await axios.get(`${BACKEND_URL}/api/tasks`);
            setTasks(res.data);
        } catch (err) {
            console.error("Failed to fetch tasks", err);
        }
    };

    const toggleTask = async (id, currentStatus) => {
        try {
            await axios.put(`${BACKEND_URL}/api/tasks/${id}`, { completed: !currentStatus });
            setTasks(tasks.map(t =>
                t.id === id ? { ...t, completed: !currentStatus } : t
            ));
        } catch (err) {
            console.error("Failed to update task", err);
        }
    };

    const addTask = async () => {
        if (!newTask.trim()) return;
        try {
            const res = await axios.post(`${BACKEND_URL}/api/tasks`, {
                text: newTask,
                type: 'personal'
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
        <Card title="Daily Tasks">
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <input
                    type="text"
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                    placeholder="Add personal task..."
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
                    style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                >
                    +
                </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                {tasks.map(task => (
                    <div
                        key={task.id}
                        onClick={() => toggleTask(task.id, task.completed)}
                        className="task-item"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '8px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            background: task.completed ? '#f0fdf4' : 'transparent',
                            border: task.completed ? '1px solid #bbf7d0' : '1px solid transparent',
                            position: 'relative'
                        }}
                        onMouseEnter={(e) => {
                            if (!task.completed) e.currentTarget.style.background = '#f8fafc';
                            const deleteBtn = e.currentTarget.querySelector('.delete-btn');
                            if (deleteBtn) deleteBtn.style.opacity = '1';
                        }}
                        onMouseLeave={(e) => {
                            if (!task.completed) e.currentTarget.style.background = 'transparent';
                            const deleteBtn = e.currentTarget.querySelector('.delete-btn');
                            if (deleteBtn) deleteBtn.style.opacity = '0';
                        }}
                    >
                        <div style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '6px',
                            border: task.completed ? 'none' : '2px solid #cbd5e1',
                            background: task.completed ? 'var(--accent-green)' : 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            fontSize: '0.8rem',
                            flexShrink: 0
                        }}>
                            {task.completed && '✓'}
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                            <span style={{
                                textDecoration: task.completed ? 'line-through' : 'none',
                                color: task.completed ? 'var(--text-secondary)' : 'var(--text-primary)',
                                fontSize: '0.9rem',
                                fontWeight: 500
                            }}>
                                {task.text}
                            </span>
                            <span style={{
                                fontSize: '0.7rem',
                                color: task.type === 'medical' ? '#ea580c' : 'var(--accent-blue)',
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                marginTop: '2px'
                            }}>
                                {task.type === 'medical' ? 'MEDICAL ORDER' : 'PERSONAL'}
                            </span>
                        </div>
                        <button
                            className="delete-btn"
                            onClick={(e) => deleteTask(e, task.id)}
                            style={{
                                border: 'none',
                                background: 'transparent',
                                color: 'var(--accent-red)',
                                cursor: 'pointer',
                                opacity: 0,
                                transition: 'opacity 0.2s',
                                padding: '4px',
                                fontSize: '1.1rem',
                                lineHeight: 1
                            }}
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>
            <div style={{
                marginTop: '16px',
                paddingTop: '16px',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.8rem',
                color: 'var(--text-secondary)'
            }}>
                <span>Progress</span>
                <span>{tasks.length > 0 ? Math.round((tasks.filter(t => t.completed).length / tasks.length) * 100) : 0}% Complete</span>
            </div>
            <div style={{
                height: '4px',
                background: '#e2e8f0',
                borderRadius: '2px',
                marginTop: '8px',
                overflow: 'hidden'
            }}>
                <div style={{
                    height: '100%',
                    background: 'var(--accent-green)',
                    width: `${tasks.length > 0 ? (tasks.filter(t => t.completed).length / tasks.length) * 100 : 0}%`,
                    transition: 'width 0.3s ease'
                }} />
            </div>
        </Card>
    );
};

export default TaskWidget;
