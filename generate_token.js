
import jwt from 'jsonwebtoken';
const id = '6978f35100028474faee6ed3';
const token = jwt.sign({ id }, 'investwise_secret_key_change_me', { expiresIn: '30d' });
console.log(token);
