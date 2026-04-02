# API Testing Guide - InvestWise

## Prerequisites
- Backend running on http://localhost:5000
- Valid JWT token (login first)

## 1. Authentication

### Login
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@investwise.com","password":"admin123"}'
```

Save the `token` from response for subsequent requests.

## 2. Members CRUD

### CREATE Member
```bash
curl -X POST http://localhost:5000/api/members \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "1234567890",
    "role": "Investor"
  }'
```

### READ All Members
```bash
curl -X GET http://localhost:5000/api/members \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### READ Single Member
```bash
curl -X GET http://localhost:5000/api/members/MEMBER_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### UPDATE Member
```bash
curl -X PUT http://localhost:5000/api/members/MEMBER_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "John Updated",
    "phone": "9876543210"
  }'
```

### DELETE Member (Admin only)
```bash
curl -X DELETE http://localhost:5000/api/members/MEMBER_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 3. Projects CRUD

### CREATE Project
```bash
curl -X POST http://localhost:5000/api/projects \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "title": "New Investment Project",
    "category": "Real Estate",
    "description": "Property investment",
    "initialInvestment": 100000,
    "totalShares": 100
  }'
```

### READ All Projects
```bash
curl -X GET http://localhost:5000/api/projects \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### UPDATE Project
```bash
curl -X PUT http://localhost:5000/api/projects/PROJECT_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "status": "In Progress",
    "currentFundBalance": 50000
  }'
```

### DELETE Project (Admin only)
```bash
curl -X DELETE http://localhost:5000/api/projects/PROJECT_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### ADD Project Update
```bash
curl -X POST http://localhost:5000/api/projects/PROJECT_ID/updates \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "type": "Earning",
    "amount": 5000,
    "description": "Monthly profit"
  }'
```

## 4. Funds CRUD

### CREATE Fund (Admin only)
```bash
curl -X POST http://localhost:5000/api/funds \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "Investment Fund A",
    "type": "Primary",
    "balance": 50000,
    "description": "Main investment fund"
  }'
```

### READ All Funds
```bash
curl -X GET http://localhost:5000/api/funds \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### UPDATE Fund (Admin only)
```bash
curl -X PUT http://localhost:5000/api/funds/FUND_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "balance": 75000,
    "description": "Updated fund"
  }'
```

## 5. Finance Operations

### ADD Deposit
```bash
curl -X POST http://localhost:5000/api/finance/deposits \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "memberId": "MEMBER_ID",
    "amount": 10000,
    "fundId": "FUND_ID",
    "description": "Monthly contribution"
  }'
```

### ADD Expense (Admin only)
```bash
curl -X POST http://localhost:5000/api/finance/expenses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "amount": 5000,
    "fundId": "FUND_ID",
    "description": "Office rent",
    "category": "Operational"
  }'
```

### GET All Transactions
```bash
curl -X GET http://localhost:5000/api/finance/transactions \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### TRANSFER Funds (Admin only)
```bash
curl -X POST http://localhost:5000/api/finance/transfer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "sourceFundId": "SOURCE_FUND_ID",
    "targetFundId": "TARGET_FUND_ID",
    "amount": 20000,
    "description": "Fund reallocation"
  }'
```

## 6. Health Check

```bash
curl http://localhost:5000/api/health
```

## Expected Responses

### Success (200/201)
```json
{
  "_id": "...",
  "name": "...",
  ...
}
```

### Validation Error (400)
```json
{
  "errors": [
    {
      "msg": "Valid email required",
      "param": "email"
    }
  ]
}
```

### Unauthorized (401)
```json
{
  "message": "Not authorized, no token"
}
```

### Not Found (404)
```json
{
  "message": "Resource not found"
}
```

## Testing Checklist

- [ ] Login works and returns token
- [ ] Create member with valid data
- [ ] Create member with invalid email (should fail)
- [ ] Read all members
- [ ] Update member
- [ ] Delete member (admin only)
- [ ] Create project
- [ ] Update project
- [ ] Add project update
- [ ] Create fund (admin only)
- [ ] Add deposit (updates fund & member)
- [ ] Add expense (deducts from fund)
- [ ] Transfer between funds
- [ ] Get all transactions
- [ ] Health check returns status

## Notes

- All routes except `/auth/login` and `/auth/register` require authentication
- Admin-only routes: Delete operations, fund management, expenses
- Validation is applied to all POST/PUT requests
- Rate limiting: 5 login attempts per 15 minutes
