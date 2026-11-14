import React from 'react';

const Card = ({ title, children, className = '', style = {}, onClick }) => {
    return (
        <div className={`card ${className}`} style={style} onClick={onClick}>
            {title && (
                <div className="card-header">
                    <span className="card-title">{title}</span>
                </div>
            )}
            {children}
        </div>
    );
};

export default Card;
