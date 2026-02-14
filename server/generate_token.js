import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const secret = process.env.JWT_SECRET;

if (!secret) {
    console.error('Error: JWT_SECRET environment variable not found. Please set JWT_SECRET in your .env file.');
    process.exit(1);
}

const id = '6978f35100028474faee6ed3';
const token = jwt.sign({ id }, secret, { expiresIn: '30d' });

console.log('Generated Token:');
console.log(token);
