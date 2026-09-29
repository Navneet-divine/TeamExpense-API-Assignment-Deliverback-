# TeamExpense API 💳

A robust, multi-company expense tracking backend built with **Node.js, Express, TypeScript, and PostgreSQL**. 

This system allows employees from multiple companies to submit expenses and receipts, while managers review, approve/reject, and track company finances with strict tenant isolation.

---

## 🚀 Tech Stack & Design Decisions

* **Runtime & Framework**: Node.js (`v24.x` / `>=18`) & Express `4.21.2` with **TypeScript `5.7.3`**
* **Database**: **Neon Serverless PostgreSQL** (cloud-hosted on AWS with SSL connection pooling)
* **Data Access Layer**: Raw parameterized SQL with [`pg`](https://node-postgres.com/) (`v8.13.1` node-postgres)
  * *Decision*: As requested by the assignment specification, no full ORM (like Prisma or TypeORM) is used. All SQL queries use `$1, $2` parameterization to strictly prevent SQL injection while maintaining raw query performance.
* **Authentication**: JSON Web Tokens (JWT) stored in secure, `httpOnly` cookies (`token`), with constant-time password hashing via `bcryptjs`.
* **Testing**: Automated integration tests with **Jest `29.7.0`** and **Supertest `7.0.0`** covering all API endpoints against the live Neon PostgreSQL database.

---

## 🗄️ Database Model & Architecture

The database is designed with multi-tenant company isolation, foreign key constraints (`ON DELETE CASCADE`), and indexes on lookup/search columns:

```
┌──────────────────┐       ┌──────────────────────────┐
│    companies     │       │          users           │
├──────────────────┤       ├──────────────────────────┤
│ id (PK)          │◄──┐   │ id (PK)                  │
│ name             │   └───│ company_id (FK)          │
│ created_at       │       │ email (unique)           │
└──────────────────┘       │ password (hashed)        │
                           │ full_name                │
                           │ role (employee/manager)  │
                           │ total_reimbursed         │
                           │ reset_token              │
                           │ reset_token_expires_at   │
                           │ created_at               │
                           └────────────┬─────────────┘
                                        │
           ┌────────────────────────────┴───────────────────────────┐
           │                                                        │
           ▼                                                        ▼
┌─────────────────────────┐                               ┌───────────────────┐
│        expenses         │                               │     comments      │
├─────────────────────────┤                               ├───────────────────┤
│ id (PK)                 │◄──────────────────────────────│ id (PK)           │
│ company_id (FK)         │                               │ expense_id (FK)   │
│ user_id (FK)            │                               │ user_id (FK)      │
│ title                   │                               │ text              │
│ amount (NUMERIC(12,2))  │                               │ created_at        │
│ currency (VARCHAR(3))   │                               └───────────────────┘
│ category                │
│ status                  │
│ receipt_file            │
│ created_at              │
│ updated_at              │
└─────────────────────────┘
```

---

## 🛠️ Setup & Installation

### 1. Prerequisites
- **Node.js** >= 18 (Tested on Node v24)
- **PostgreSQL** instance (Neon.tech cloud URL or local)

### 2. Clone & Install
```bash
git clone <your-repo-link>
cd Deliverback_Assignment
npm install
```

### 3. Environment Variables
Create a `.env` file in the root directory (refer to `.env.example`):
```env
PORT=5001
NODE_ENV=development
DATABASE_URL=postgresql://neondb_owner:YOUR_PASSWORD@ep-billowing-king-b5bk05qe-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require
JWT_SECRET=super_secret_jwt_key_teamexpense_2026
JWT_EXPIRES_IN=24h
BASE_URL=http://localhost:5001
```

### 4. Run Migrations & Seed Data
Initialize the schema and seed initial companies, managers, and employees:
```bash
# Run PostgreSQL migrations
npm run db:migrate

# Seed database with Deliverback & Loopcv accounts
npm run db:seed
```

### 5. Start Development Server
```bash
npm run dev
```
The server will start on `http://localhost:5001`.

---

## 👥 Seed Accounts

Password for all pre-seeded accounts is **`Password123!`**:

### 🏢 Deliverback (Company ID: 1)
| Role | Name | Email |
|---|---|---|
| **Manager** | George Avgenakis | `george@deliverback.com` |
| **Employee** | Alice Jenkins | `alice@deliverback.com` |
| **Employee** | Bob Williams | `bob@deliverback.com` |

### 🏢 Loopcv (Company ID: 2)
| Role | Name | Email |
|---|---|---|
| **Manager** | Lucas Simopoulos | `lucas@loopcv.com` |
| **Employee** | Charlie Smith | `charlie@loopcv.com` |
| **Employee** | David Evans | `david@loopcv.com` |

---

## 📚 API Endpoints Documentation

All routes support both `/api/...` and root level `/...`.

### 1. Authentication

#### `POST /api/auth/register`
Creates a new user in an existing company. New users are always forced to `role = 'employee'`.
* **Request Body**:
  ```json
  {
    "company_id": 1,
    "email": "new.employee@deliverback.com",
    "password": "Password123!",
    "full_name": "New Employee"
  }
  ```
* **Response (`201 Created`)**:
  ```json
  {
    "message": "User registered successfully.",
    "user": {
      "id": 10,
      "company_id": 1,
      "email": "new.employee@deliverback.com",
      "full_name": "New Employee",
      "role": "employee",
      "total_reimbursed": "0.00",
      "created_at": "2026-09-28T21:40:00.000Z"
    }
  }
  ```

#### `POST /api/auth/login`
Authenticates user, sets `httpOnly` cookie (`token`), and returns token + profile.
* **Request Body**:
  ```json
  {
    "email": "george@deliverback.com",
    "password": "Password123!"
  }
  ```
* **Response (`200 OK`)**:
  - Header: `Set-Cookie: token=<jwt_string>; HttpOnly; Path=/`
  - Body:
  ```json
  {
    "message": "Login successful.",
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": 1,
      "company_id": 1,
      "email": "george@deliverback.com",
      "full_name": "George Avgenakis",
      "role": "manager"
    }
  }
  ```

#### `POST /api/auth/forgot-password`
Accepts an email and generates a secure reset token valid for 1 hour. Logs the reset link to the console instead of sending email. Returns `404` if the email is not registered.
* **Request Body**:
  ```json
  {
    "email": "george@deliverback.com"
  }
  ```
* **Response (`200 OK`)**:
  ```json
  {
    "message": "Password reset link has been generated and logged to the console."
  }
  ```

#### `POST /api/auth/reset-password`
Accepts the reset token and new password.
* **Request Body**:
  ```json
  {
    "token": "7b456e244bce7443af244a940a3affd3c3f0f86...",
    "new_password": "BrandNewPassword123!"
  }
  ```
* **Response (`200 OK`)**:
  ```json
  {
    "message": "Password has been reset successfully. You can now login."
  }
  ```

---

### 2. Profile

#### `GET /api/me`
Returns the currently authenticated user's profile and company details.
* **Headers**: Sent with cookie `token`
* **Response (`200 OK`)**:
  ```json
  {
    "user": {
      "id": 1,
      "company_id": 1,
      "company_name": "Deliverback",
      "email": "george@deliverback.com",
      "full_name": "George Avgenakis",
      "role": "manager",
      "total_reimbursed": "0.00"
    }
  }
  ```

#### `PATCH /api/me`
Updates user's own profile (`full_name`, `email`, or `password`). Protected fields like `role`, `company_id`, or `total_reimbursed` cannot be modified by the user. When changing `password`, `current_password` (or `old_password`) is verified first.
* **Request Body (Updating Name & Email)**:
  ```json
  {
    "full_name": "George Avgenakis (Updated)",
    "email": "george.new@deliverback.com"
  }
  ```
* **Request Body (Updating Password)**:
  ```json
  {
    "old_password": "Password123!",
    "new_password": "NewSecretPassword123!"
  }
  ```

---

### 3. Expenses

#### `POST /api/expenses`
Creates an expense defaulting to status `'pending'`.
* **Request Body**:
  ```json
  {
    "title": "Client Lunch with Deliverback Partners",
    "amount": 85.50,
    "currency": "USD",
    "category": "Meals"
  }
  ```

#### `GET /api/expenses/:id`
Retrieves single expense with role scoping (employees see only their own expenses; managers see all company expenses).

#### `PATCH /api/expenses/:id`
Edits an expense. **Only allowed while status is `pending`** (rejects with `400` if already approved or rejected).

#### `GET /api/expenses`
Lists expenses with support for query parameters:
- `search`: case-insensitive keyword match across `title` and `category` (e.g. `?search=Client`)
- `status`: filter by `pending`, `approved`, or `rejected` (e.g. `?status=pending`)
- `category`: filter by exact category name (e.g. `?category=Meals`, `?category=Travel`)
- `sort_by`: column name (`amount`, `title`, `category`, `status`, `id`, `created_at`, `updated_at`)
- `order`: `asc` or `desc` (e.g. `?sort_by=amount&order=asc`)
- `page` & `limit`: client-decided pagination (e.g. `?page=1&limit=10`)
- **Role scoping**:
  - **Employees**: see only their own expenses.
  - **Managers**: see all expenses of their company.

---

### 4. Receipts

#### `POST /api/expenses/:id/receipt`
Uploads a receipt file (multipart/form-data with field `receipt`). Supports Images (JPEG, PNG, WebP) and PDFs up to 10MB.

#### `POST /api/expenses/:id/receipt-from-url`
Downloads remote receipt from cloud storage URL and saves to server:
```json
{
  "url": "https://example.com/invoices/receipt_123.pdf"
}
```

#### `GET /api/receipts/:filename`
Downloads stored receipt with path traversal protection.

---

### 5. Approval

*Manager-only workflow for approving and rejecting submitted expenses.*

#### `POST /api/expenses/:id/approve`
Approves a pending expense (**managers only**).
- **Atomic Balance Update**: Adds the expense amount to the submitting employee's `total_reimbursed` balance using database transactions with row-level locks (`SELECT ... FOR UPDATE`).
- **Strict Guard**: An expense must **never be approved more than once** (rejects with `400` if already approved or rejected).
- **Multi-Tenant Protection**: Managers can only approve expenses from their own company.

**Response (`200 OK`):**
```json
{
  "message": "Expense approved successfully.",
  "expense": {
    "id": 1,
    "title": "Client Dinner",
    "amount": "135.00",
    "status": "approved",
    "updated_at": "2026-09-29T04:40:00.000Z"
  },
  "employee": {
    "id": 2,
    "full_name": "Alice Jenkins",
    "email": "alice@deliverback.com",
    "role": "employee",
    "total_reimbursed": "135.00"
  }
}
```

#### `POST /api/expenses/:id/reject`
Rejects a pending expense (**managers only**).
- Fails with `400` if the expense has already been approved or rejected.
- Managers can only reject expenses from their own company.

**Response (`200 OK`):**
```json
{
  "message": "Expense rejected successfully.",
  "expense": {
    "id": 2,
    "title": "Taxi Ride",
    "amount": "25.00",
    "status": "rejected",
    "updated_at": "2026-09-29T04:40:00.000Z"
  }
}
```

---

### 6. Comments & Server-Rendered HTML View

#### `POST /api/expenses/:id/comments`
Adds a discussion comment to an expense.
- **Role Scoping**: Employees can comment on their own expenses; managers can comment on all expenses of their company.
- **Request Body**:
```json
{
  "text": "Attached the hotel invoice with breakfast itemized."
}
```
- **Response (`201 Created`)**:
```json
{
  "message": "Comment added successfully.",
  "comment": {
    "id": 1,
    "expense_id": 5,
    "user_id": 2,
    "text": "Attached the hotel invoice with breakfast itemized.",
    "author_name": "Alice Jenkins",
    "author_role": "employee",
    "created_at": "2026-09-29T05:15:00.000Z"
  }
}
```

#### `GET /api/expenses/:id/view`
Returns a **server-rendered responsive HTML view** showing full expense details, submitter information, status badge, receipt download link, and all threaded comments in chronological order.
- **Designed for Email Links**: Managers can open this link directly from an email notification in their browser.
- **Flexible Auth**: Supports session cookies, standard `Authorization: Bearer <token>` headers, and email link tokens (`?token=<jwt>`).
- **Interactive UI**: Includes live comment posting form and quick Approve/Reject buttons for managers directly within the browser view.
- **XSS Protection**: All user-generated content (comments, titles, author names) is strictly HTML-escaped.

---

### 7. Export

#### `GET /reports/export.csv` (or `/api/reports/export.csv`)
Exports all company expenses within a date range as a downloadable CSV file (**managers only**).
- **Date Range Filtering**:
  - `?from=YYYY-MM-DD`: filters expenses created on or after this date.
  - `?to=YYYY-MM-DD`: filters expenses created on or before this date (up to 23:59:59.999).
  - If omitted, exports all expenses for the manager's company.
- **CSV Columns**:
  `Title,Employee Name,Amount,Category,Status,Date`
- **Excel Compatibility & Security**:
  - **UTF-8 Byte Order Mark (`\uFEFF`)**: Included at the head of the file so Microsoft Excel on Windows/macOS correctly opens and displays Unicode characters (e.g. international names and accents) without garbled text.
  - **Formula Injection Prevention**: Cells starting with `=`, `+`, `-`, or `@` are sanitized with a leading quote to safeguard Finance users opening the CSV in Excel.
  - **RFC 4180 Escaping**: Commas, double quotes, and line breaks are safely quoted and escaped.

---

### 8. Statistics

#### `GET /reports/summary` (or `/api/reports/summary`)
Calculates total expense amounts per category for the current month (**managers only**).
- **Exact to the Cent**: Computes `SUM(amount)` using PostgreSQL's `NUMERIC(12, 2)` fixed-point arithmetic formatted via `TO_CHAR(..., 'FM999999990.00')`, completely eliminating JavaScript floating-point rounding errors (e.g. `0.1 + 0.2`).
- **Multi-Currency Breakdown**: Separates totals by category and currency (e.g. `USD`, `EUR`) so distinct currencies are never improperly summed together.
- **Calendar Period**:
  - Defaults to the current calendar month.
  - Supports optional `?month=YYYY-MM` (e.g. `?month=2026-09`) to analyze historical months.
- **Company Scoping**: Managers see only statistics from their own company.

**Sample Response (`200 OK`):**
```json
{
  "period": {
    "month": "September 2026",
    "start_date": "2026-09-01T00:00:00.000Z",
    "end_date": "2026-10-01T00:00:00.000Z"
  },
  "categories": [
    {
      "category": "Meals",
      "currency": "USD",
      "expense_count": 2,
      "total_amount": "245.50"
    },
    {
      "category": "Travel",
      "currency": "USD",
      "expense_count": 1,
      "total_amount": "120.00"
    }
  ],
  "grand_totals": [
    {
      "currency": "USD",
      "total_expenses": 3,
      "total_amount": "365.50"
    }
  ]
}
```

---

## 🧪 Automated Tests

The test suite runs against the real PostgreSQL database and covers authentication, role authorization, validation, and multi-tenant scoping.

Run all tests:
```bash
npm test
```

Test coverage includes:
- Registration validation, role enforcement, and duplicate handling
- Login with password verification and `httpOnly` cookie issuance
- Forgot-password flow, console logging, token expiry, and password reset
- Profile retrieval and security restrictions on non-updatable fields
- Expense creation, role-based visibility, and editing restrictions on non-pending expenses
- File upload, URL downloads, and receipt file serving
- Manager approval and rejection workflows, atomic balance reimbursement, and strict once-only approval guards
- Comment creation, employee/manager permissions, threaded conversation loading, and server-rendered HTML email views
- CSV report generation, Excel compatibility with UTF-8 BOM, date range filters, and company isolation
- Multi-currency category statistics exact to the cent, period calculations, and tenant isolation
