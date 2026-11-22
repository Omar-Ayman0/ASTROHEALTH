import React, { useState, useRef, useEffect } from 'react';

const ChatPanel = ({ role, messages, onSendMessage, onClearMessages }) => {
    const [input, setInput] = useState('');
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim()) return;
        await onSendMessage(input);
        setInput('');
    };

    const getMessageStyle = (isOwnMessage) => ({
        alignSelf: isOwnMessage ? 'flex-end' : 'flex-start',
        background: isOwnMessage
            ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'
            : 'linear-gradient(135deg, #0f3256 0%, #0b2a4a 100%)',
        color: isOwnMessage ? '#ffffff' : '#e0f2fe',
        padding: '12px 16px',
        borderRadius: isOwnMessage ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        maxWidth: '75%',
        fontSize: '0.9rem',
        lineHeight: '1.5',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        border: isOwnMessage ? 'none' : '1px solid rgba(34, 211, 238, 0.3)'
    });

    const getHeaderStyle = (isOwnMessage) => ({
        fontSize: '0.7rem',
        opacity: 0.8,
        marginBottom: '4px',
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
    });

    return (
        <div className="card solid-panel" style={{
            height: '450px',
            display: 'flex',
            flexDirection: 'column',
            background: '#071a30'
        }}>
            <div className="card-header" style={{ borderBottom: '2px solid rgba(34, 211, 238, 0.22)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <span className="card-title" style={{
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    fontSize: '1rem',
                    fontWeight: '700'
                }}>
                    Medical Communication Channel
                </span>
                <div style={{
                    fontSize: '0.75rem',
                    color: '#a9bdd3',
                    marginTop: '4px'
                }}>
                    {role === 'Astronaut' ? 'Contact Medical Officer' : 'Crew Communication'}
                </div>
                {role === 'Doctor' && onClearMessages && (
                    <button type="button" onClick={onClearMessages}
                        style={{ padding: '8px 13px', border: '1px solid rgba(248, 113, 113, 0.55)',
                        borderRadius: '8px', background: 'rgba(239, 68, 68, 0.16)',
                        color: '#fca5a5', fontWeight: '700', cursor: 'pointer' }}>
                        Clear Chat
                    </button>
                )}
            </div>

            <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                background: '#050f1e'
            }}>
                {messages.length === 0 ? (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        color: '#a9bdd3',
                        fontSize: '0.9rem',
                        textAlign: 'center',
                        lineHeight: '1.6'
                    }}>
                        No messages yet <br />
                        <span style={{ fontSize: '0.8rem' }}>
                            {role === 'Astronaut' ? ' Report any health concerns here' : 'Send instructions or check-ins'}
                        </span>
                    </div>
                ) : (
                    messages.map((msg, idx) => {
                        const isOwnMessage = msg.sender_role === role;
                        return (
                            <div key={idx} style={getMessageStyle(isOwnMessage)}>
                                <div style={getHeaderStyle(isOwnMessage)}>
                                    {msg.sender_role} • {new Date(msg.timestamp).toLocaleTimeString()}
                                </div>
                                <div style={{ wordWrap: 'break-word' }}>
                                    {msg.content}
                                </div>
                            </div>
                        );
                    })
                )}
                <div ref={messagesEndRef} />
            </div>

            <div style={{
                padding: '16px',
                background: '#071a30',
                borderTop: '2px solid rgba(34, 211, 238, 0.22)'
            }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={role === 'Astronaut' ? "Type your message to medical officer..." : "Type your message to crew..."}
                        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                        style={{
                            flex: 1,
                            padding: '12px 16px',
                            borderRadius: '8px',
                            border: '2px solid rgba(34, 211, 238, 0.3)',
                            fontSize: '0.9rem',
                            outline: 'none',
                            transition: 'border-color 0.2s',
                        }}
                        onFocus={(e) => e.target.style.borderColor = '#22d3ee'}
                        onBlur={(e) => e.target.style.borderColor = 'rgba(34, 211, 238, 0.3)'}
                    />
                    <button
                        className="btn"
                        onClick={handleSend}
                        style={{
                            padding: '12px 24px',
                            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            transition: 'transform 0.1s',
                        }}
                        onMouseDown={(e) => e.target.style.transform = 'scale(0.95)'}
                        onMouseUp={(e) => e.target.style.transform = 'scale(1)'}
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ChatPanel;

