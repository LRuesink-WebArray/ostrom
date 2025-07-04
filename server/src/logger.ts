import winston, { format } from "winston";

const instance = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(format.splat(), winston.format.cli()),
    transports: [
        new winston.transports.Console(),
        // TODO: check in with Homey as to what loggers are used in their environment
    ]
});

export default instance;
