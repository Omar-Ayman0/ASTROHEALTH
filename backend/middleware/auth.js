function requireAuth(req, res, next) {
    if (!req.session?.user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    next();
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.session?.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        if (!allowedRoles.includes(req.session.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions'
            });
        }

        next();
    };
}

function requireAstronautOwnership(req, res, next) {
    if (!req.session?.user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    const user = req.session.user;

    if (user.role === 'admin' || user.role === 'doctor') {
        return next();
    }

    if (
        user.role === 'astronaut' &&
        req.params.astronaut_id === user.astronaut_id
    ) {
        return next();
    }

    return res.status(403).json({
        success: false,
        error: 'Access to this astronaut data is forbidden'
    });
}

module.exports = {
    requireAuth,
    requireRole,
    requireAstronautOwnership
};
