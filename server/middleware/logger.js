import morgan from 'morgan';

export const logger = process.env.NODE_ENV === 'production'
    ? morgan('combined')
    : morgan('dev');
