# InvestWise - Project Technical Overview

## 1. Project Summary
**InvestWise** is an enterprise-grade investment management platform designed for investment firms to manage partners (members), projects (ventures), funds, and financial transactions. It features a robust **Role-Based Access Control (RBAC)** system, immutable financial ledgers, and a high-fidelity "Dark Mode" first UI/UX.

## 2. Technology Stack

### Frontend
*   **Framework**: React 18 (via Vite)
*   **Language**: TypeScript
*   **Styling**: Tailwind CSS (Custom "Brand" Theme, Glassmorphism effects)
*   **Icons**: Lucide React
*   **State Management**: React Context API (`GlobalStateContext`)
*   **API Layer**: Axios (abstracted in `services/api.ts`)

### Backend (`/server`)
*   **Runtime**: Node.js
*   **Framework**: Express.js
*   **Database**: MongoDB (via Mongoose ORM)
*   **Authentication**: JWT (JSON Web Tokens)
*   **Environment**: dotenv

## 3. Core Architecture & Workflow

### A. Client-Server Communication
The application follows a standard **REST API** architecture.
*   **Frontend**: The `GlobalStateContext` acts as the single source of truth, fetching initial data (Members, Projects, Transactions) upon login and hydrating the application state.
*   **Services**: All API calls are encapsulated in `services/api.ts` (e.g., `memberService.update()`, `projectService.create()`).
*   **Optimistic Updates**: The UI often updates immediately for perceived performance, while ensuring backend synchronization.

### B. Security & Integrity Model
1.  **Immutable Ledger Logic**:
    *   Critical financial data (like a Member's Share Count) is **locked** on the backend if *any* related transactions exist.
    *   This forces users to use proper "Deposit" or "Investment" workflows instead of manually editing numbers, ensuring audit trails are preserved.
2.  **Role-Based Access Control (RBAC)**:
    *   **Administrator**: Full WRITE access to all modules.
    *   **Manager**: Operational access, but restricted from System Settings.
    *   **Investor**: Read-Only access to specific dashboards.
    *   **Permissions Matrix**: Granular control over specific modules (e.g., specific users can be granted Read/Write access to the Dashboard or Funds).

### C. UI/UX Patterns
*   **Action Dialogs**: Critical actions (Delete, Submit, Launch Venture) are intercepted by a generic `ActionDialog` component that enforces a "Review & Confirm" step.
*   **Visual Feedback**: Extensive use of `Toast` notifications for success/error feedback.
*   **Adaptive Inputs**: Forms dynamically change based on context (e.g., "Login Password" becomes "Reset Password" when editing an existing user).

## 4. Key Modules Implementation

### 1. 👥 Member Management
*   **Model**: `Member.js`
*   **Features**:
    *   **Partner Intake**: Complex form for onboarding new investors.
    *   **System Access**: Toggleable login credentials for partners to access the portal themselves.
    *   **Profile Management**: Extended details (Nominee, National ID, Address) managed via a dedicated Admin tab.
    *   **Safety**: Shares field is visually and functionally disabled (`Locked by Ledger`) if the member has active deposits.

### 2. 🚀 Project (Venture) Management
*   **Model**: `Project.js`
*   **Features**:
    *   **Lifecycle Tracking**: Projects move through statuses (Review -> In Progress -> Completed).
    *   **Financial Events**: Recording expenses or earnings against specific projects.
    *   **Stakeholder Association**: Linking specific members (investors) to specific projects for ROI calculation.

### 3. ⚙️ System Administration
*   **Location**: `Settings.tsx`
*   **Features**:
    *   **User Management**: create/delete system users.
    *   **Access Matrix**: A visual grid to toggle `Read`/`Write`/`None` permissions for every module per user.
    *   **Security**: API Key rotation (UI mock) and Password Resets.

## 5. Directory Structure Key
```
/
├── components/          # React UI Components
│   ├── Members.tsx      # Member Management Module
│   ├── ProjectManagement.tsx
│   ├── Settings.tsx     # Admin & RBAC Module
│   ├── ActionDialog.tsx # Reusable Confirmation Modal
│   └── ...
├── context/             #/GlobalStateContext.tsx (State Store)
├── server/              # Backend Application
│   ├── controllers/     # Business Logic (memberController.js, etc.)
│   ├── models/          # Mongoose Schemas (Member.js, Project.js)
│   ├── routes/          # API Endpoints
│   └── seedData.js      # Database Population Script
└── services/            # Frontend API Connectors (api.ts)
```

## 6. How to Run
1.  **Backend**: `cd server` -> `npm run start` (Runs on Port 5000)
2.  **Frontend**: root dir -> `npm run dev` (Runs on Vite Port)

This structure ensures a scalable, secure, and maintainable enterprise application.
