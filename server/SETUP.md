# 🚀 InvestWise - Enterprise Investment Management

<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

A modern, full-stack enterprise investment management platform with AI-powered financial advisory.

## ✨ Features

- 🔐 **Secure Authentication** - JWT-based auth with role-based access control
- 💼 **Investment Management** - Track funds, projects, and member portfolios
- 📊 **Real-time Analytics** - Interactive dashboards with financial insights
- 🤖 **AI Financial Advisor** - Gemini AI-powered investment recommendations
- 🌍 **Multi-language Support** - i18n with English and more
- 🌙 **Dark Mode** - Beautiful UI with light/dark themes
- 📱 **Responsive Design** - Works seamlessly on all devices

## 🏗️ Tech Stack

### Frontend
- **React 19** with TypeScript
- **Vite** for blazing-fast development
- **Recharts** for data visualization
- **Lucide React** for icons
- **Axios** for API calls

### Backend
- **Node.js** with Express
- **MongoDB** with Mongoose ODM
- **JWT** for authentication
- **Helmet** for security headers
- **Express Rate Limit** for DDoS protection
- **Morgan** for logging
- **Compression** for response optimization

## 🚀 Quick Start

### Prerequisites
- Node.js (v18+)
- MongoDB (local or Atlas)
- Gemini API Key

### 1. Clone & Install

```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd server
npm install
cd ..
```

### 2. Environment Setup

**Frontend (.env.local):**
```env
VITE_API_URL=http://localhost:5000/api
GEMINI_API_KEY=your_gemini_api_key_here
```

**Backend (server/.env):**
```env
MONGO_URI=mongodb://localhost:27017/investwise
PORT=5000
JWT_SECRET=your_super_secret_jwt_key_change_this
NODE_ENV=development
```

### 3. Seed Database (Optional)

```bash
cd server
node seedAdmin.js
node seedData.js
cd ..
```

### 4. Run Development Servers

**Terminal 1 - Backend:**
```bash
cd server
npm run dev
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

Visit: http://localhost:3000

## 🔒 Security Enhancements

✅ **Helmet** - Security headers  
✅ **Rate Limiting** - Prevent brute force attacks  
✅ **Input Validation** - Express-validator for sanitization  
✅ **JWT Expiration** - 30-day token expiry  
✅ **Password Hashing** - bcrypt with salt rounds  
✅ **CORS** - Configured cross-origin policies  
✅ **Error Handling** - Global error middleware  

## 📦 API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration

### Members
- `GET /api/members` - Get all members
- `POST /api/members` - Create member
- `PUT /api/members/:id` - Update member
- `DELETE /api/members/:id` - Delete member

### Projects
- `GET /api/projects` - Get all projects
- `POST /api/projects` - Create project
- `PUT /api/projects/:id` - Update project

### Funds
- `GET /api/funds` - Get all funds
- `POST /api/funds` - Create fund
- `PUT /api/funds/:id` - Update fund

### Finance
- `GET /api/finance/transactions` - Get transactions
- `POST /api/finance/deposits` - Add deposit
- `POST /api/finance/expenses` - Add expense

## 🎨 Project Structure

```
investwise/
├── components/          # React components
├── context/            # Global state management
├── services/           # API & Gemini services
├── i18n/              # Translations
├── server/
│   ├── config/        # Database config
│   ├── controllers/   # Route controllers
│   ├── middleware/    # Auth, validation, logging
│   ├── models/        # Mongoose schemas
│   ├── routes/        # API routes
│   └── utils/         # Helper functions
└── docs/              # Documentation
```

## 🛠️ Development

```bash
# Frontend dev server
npm run dev

# Backend dev server (with nodemon)
cd server && npm run dev

# Build for production
npm run build
```

## 📝 Default Credentials

After seeding:
- **Email:** admin@investwise.com
- **Password:** admin123

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 📄 License

ISC License

## 🔗 Links

- AI Studio: https://ai.studio/apps/drive/1Xe3FcuNJbr7mr-4rzNMYcx1bYgeUoZRn
- Documentation: See `/docs` folder

---

Built with ❤️ using React, Node.js, and Gemini AI
