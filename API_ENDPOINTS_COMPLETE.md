# Booking Hub Backend - Complete API Reference

**Base URL:** `https://hfaghwlklnztmhivivuw.supabase.co/functions/v1`  
**Status:** ✅ Production Ready  
**Total Endpoints:** 57  
**Last Updated:** October 8, 2026

---

## Table of Contents

1. [Authentication](#authentication)
2. [Discovery (Public)](#discovery-public)
3. [Bookings](#bookings)
4. [Wallet](#wallet)
5. [Payments](#payments)
6. [Invoices](#invoices-new)
7. [Refunds](#refunds-new)
8. [Notifications](#notifications)
9. [Venues](#venues)
10. [Admin - Organizations](#admin--organizations)
11. [Admin - Branches](#admin--branches)
12. [Admin - Staff](#admin--staff)
13. [Audit Logs](#audit-logs-new)
14. [Reports](#reports-new)

---

# Authentication

## POST /auth/members/register
Register a new member account

### Request
**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePassword123!"
}
```

### Response (201 Created)
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "john@example.com",
    "email_confirmed_at": "2026-10-08T10:00:00Z",
    "user_metadata": {
      "full_name": "John Doe"
    }
  },
  "message": "Member registered successfully"
}
```

**Error Responses:**
- `400 Bad Request` - Missing fields or email already exists
- `500 Server Error` - Database error

---

## POST /auth/members/login
Login with email and password

### Request
**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "email": "john@example.com",
  "password": "SecurePassword123!"
}
```

### Response (200 OK)
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "john@example.com",
    "email_confirmed_at": "2026-10-08T10:00:00Z"
  },
  "session": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "bearer",
    "expires_in": 3600
  },
  "message": "Login successful"
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid email or password
- `500 Server Error` - Database error

---

## POST /auth/staff/login
Login as staff member

### Request
**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "email": "manager@example.com",
  "password": "SecurePassword123!"
}
```

### Response (200 OK)
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "email": "manager@example.com"
  },
  "session": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "bearer",
    "expires_in": 3600
  },
  "staff": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Manager Name",
    "role": "BranchManager",
    "organization_id": "550e8400-e29b-41d4-a716-446655440002",
    "branch_id": "550e8400-e29b-41d4-a716-446655440003"
  },
  "message": "Staff login successful"
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid credentials
- `403 Forbidden` - User is not staff
- `500 Server Error` - Database error

---

## GET /auth/me
Get current user profile

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response (200 OK)
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "john@example.com"
  },
  "profile": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "John Doe",
    "email": "john@example.com",
    "status": "active"
  },
  "type": "member"
}
```

**Error Responses:**
- `401 Unauthorized` - Missing or invalid token

---

# Discovery (Public)

**No authentication required for these endpoints.**

## GET /branches
List all active branches (venues)

### Request
**Query Parameters:**
```
organizationId= (optional)
limit=10 (optional)
offset=0 (optional)
```

### Response (200 OK)
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440002",
    "organization_id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Downtown Tennis Courts",
    "venue_type": "Court",
    "location": "123 Main St",
    "description": "Premium tennis facility",
    "amenities": ["lights", "parking", "cafe"],
    "tax_enabled": true,
    "tax_rate_percent": 17,
    "default_currency": "PKR",
    "status": "active",
    "created_at": "2026-10-01T10:00:00Z"
  }
]
```

---

## GET /courts
List courts in a branch

### Request
**Query Parameters:**
```
branchId=550e8400-e29b-41d4-a716-446655440002 (required)
```

### Response (200 OK)
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440003",
    "branch_id": "550e8400-e29b-41d4-a716-446655440002",
    "name": "Court 1",
    "sport_type": "tennis",
    "capacity": 2,
    "hourly_rate": 5000,
    "amenities": ["lights", "net"],
    "status": "active"
  }
]
```

---

## GET /rooms
List gaming rooms in a branch

### Request
**Query Parameters:**
```
branchId=550e8400-e29b-41d4-a716-446655440002 (required)
```

### Response (200 OK)
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440004",
    "branch_id": "550e8400-e29b-41d4-a716-446655440002",
    "name": "CS2 Room A",
    "game_type": "cs2",
    "capacity": 5,
    "booking_mode": "PerSeat",
    "hourly_rate": 3000,
    "amenities": ["ac", "gaming-pc"],
    "status": "active"
  }
]
```

---

## GET /seats
List seats in a room

### Request
**Query Parameters:**
```
roomId=550e8400-e29b-41d4-a716-446655440004 (required)
```

### Response (200 OK)
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440005",
    "room_id": "550e8400-e29b-41d4-a716-446655440004",
    "label": "PC-01",
    "hourly_rate": 600,
    "status": "active"
  }
]
```

---

## GET /packages
List available packages

### Request
**Query Parameters:**
```
branchId=550e8400-e29b-41d4-a716-446655440002 (required)
```

### Response (200 OK)
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440006",
    "branch_id": "550e8400-e29b-41d4-a716-446655440002",
    "scope": "Court",
    "name": "10 Tennis Sessions",
    "package_type": "FixedSessions",
    "sessions_included": 10,
    "valid_days": 90,
    "price": 45000,
    "status": "active"
  }
]
```

---

## GET /availability
Check available slots

### Request
**Query Parameters:**
```
courtId=550e8400-e29b-41d4-a716-446655440003&date=2026-10-15
OR
roomId=550e8400-e29b-41d4-a716-446655440004&date=2026-10-15
```

### Response (200 OK)
```json
{
  "date": "2026-10-15",
  "slots": [
    {
      "start": "2026-10-15T09:00:00Z",
      "end": "2026-10-15T10:00:00Z",
      "price": 5000,
      "status": "available"
    },
    {
      "start": "2026-10-15T10:00:00Z",
      "end": "2026-10-15T11:00:00Z",
      "price": 5000,
      "status": "booked"
    }
  ]
}
```

---

# Bookings

## POST /bookings
Create a new booking

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "branch_id": "550e8400-e29b-41d4-a716-446655440002",
  "court_id": "550e8400-e29b-41d4-a716-446655440003",
  "start_time": "2026-10-15T10:00:00Z",
  "end_time": "2026-10-15T11:00:00Z",
  "payment_method": "Wallet",
  "member_package_id": null
}
```

### Response (201 Created)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440007",
  "court_id": "550e8400-e29b-41d4-a716-446655440003",
  "member_id": "550e8400-e29b-41d4-a716-446655440000",
  "start_time": "2026-10-15T10:00:00Z",
  "end_time": "2026-10-15T11:00:00Z",
  "status": "Confirmed",
  "price": 5000,
  "tax_rate_percent": 17,
  "tax_amount": 850,
  "total": 5850,
  "currency": "PKR",
  "payment_method": "Wallet",
  "created_at": "2026-10-08T10:00:00Z"
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid token
- `402 Payment Required` - Insufficient wallet balance
- `409 Conflict` - Double-booking
- `400 Bad Request` - Missing fields

---

## GET /bookings
List user's bookings

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
status=Confirmed (optional)
courtId= (optional)
limit=10 (optional)
```

### Response (200 OK)
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440007",
    "court_id": "550e8400-e29b-41d4-a716-446655440003",
    "member_id": "550e8400-e29b-41d4-a716-446655440000",
    "start_time": "2026-10-15T10:00:00Z",
    "end_time": "2026-10-15T11:00:00Z",
    "status": "Confirmed",
    "price": 5000,
    "total": 5850,
    "currency": "PKR",
    "payment_method": "Wallet",
    "created_at": "2026-10-08T10:00:00Z"
  }
]
```

---

## PATCH /bookings/{id}/cancel
Cancel a booking

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "reason": "Personal emergency"
}
```

### Response (200 OK)
```json
{
  "message": "Booking cancelled",
  "id": "550e8400-e29b-41d4-a716-446655440007",
  "refund_amount": 5850
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid token
- `404 Not Found` - Booking not found
- `400 Bad Request` - Cannot cancel in current state

---

# Wallet

## GET /wallet
Get wallet balance

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response (200 OK)
```json
{
  "member_id": "550e8400-e29b-41d4-a716-446655440000",
  "balance": 50000,
  "currency": "PKR",
  "created_at": "2026-10-01T10:00:00Z"
}
```

---

## GET /wallet/credits
Get wallet credit history

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
limit=50 (optional)
offset=0 (optional)
```

### Response (200 OK)
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440008",
    "member_id": "550e8400-e29b-41d4-a716-446655440000",
    "reason": "Recharge",
    "amount": 50000,
    "balance_after": 50000,
    "reference": "Credit card recharge",
    "created_at": "2026-10-01T10:00:00Z"
  }
]
```

---

## GET /wallet/debits
Get wallet debit history

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response (200 OK)
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440009",
    "member_id": "550e8400-e29b-41d4-a716-446655440000",
    "reason": "BookingPayment",
    "amount": 5000,
    "balance_after": 45000,
    "reference": "Booking payment",
    "booking_id": "550e8400-e29b-41d4-a716-446655440007",
    "created_at": "2026-10-08T11:00:00Z"
  }
]
```

---

## POST /wallet/recharge
Top up wallet

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "amount": 10000,
  "payment_method": "Card"
}
```

### Response (201 Created)
```json
{
  "message": "Payment intent created",
  "payment_method": "Card",
  "amount": 10000,
  "next": "Redirect to payment gateway"
}
```

---

# Payments

## POST /payments-stripe/intent
Create Stripe payment intent

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "booking_id": "550e8400-e29b-41d4-a716-446655440007",
  "amount": 5850,
  "currency": "PKR"
}
```

### Response (200 OK)
```json
{
  "payment_intent_id": "pi_1234567890",
  "client_secret": "pi_1234567890_secret_abcdef",
  "amount": 585000,
  "currency": "pkr",
  "status": "requires_payment_method"
}
```

---

## POST /payments-stripe/webhook
Stripe webhook callback

### Request
**Headers:**
```
Stripe-Signature: t=timestamp,v1=signature
Content-Type: application/json
```

**Body:**
```json
{
  "type": "payment_intent.succeeded",
  "data": {
    "object": {
      "id": "pi_1234567890",
      "status": "succeeded",
      "metadata": {
        "booking_id": "550e8400-e29b-41d4-a716-446655440007"
      }
    }
  }
}
```

### Response (200 OK)
```json
{
  "received": true,
  "booking_confirmed": true
}
```

---

# Invoices (NEW)

## GET /invoices
List all invoices

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
limit=50 (optional)
offset=0 (optional)
```

### Response (200 OK)
```json
[
  {
    "id": "INV-1696776000000",
    "payment_id": "550e8400-e29b-41d4-a716-446655440010",
    "invoice_number": "INV-abc123def",
    "issued_date": "2026-10-08",
    "due_date": "2026-11-07",
    "status": "generated",
    "amount": 5850,
    "currency": "PKR",
    "created_at": "2026-10-08T10:00:00Z"
  }
]
```

---

## POST /invoices
Generate an invoice

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "payment_id": "550e8400-e29b-41d4-a716-446655440010",
  "invoice_number": "INV-2026-001",
  "issued_date": "2026-10-08",
  "due_date": "2026-11-07",
  "notes": "Payment for booking"
}
```

### Response (201 Created)
```json
{
  "id": "INV-1696776000000",
  "payment_id": "550e8400-e29b-41d4-a716-446655440010",
  "invoice_number": "INV-2026-001",
  "issued_date": "2026-10-08",
  "due_date": "2026-11-07",
  "status": "generated",
  "notes": "Payment for booking",
  "created_at": "2026-10-08T10:00:00Z"
}
```

---

# Refunds (NEW)

## GET /refunds
List refunded payments

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
limit=50 (optional)
offset=0 (optional)
```

### Response (200 OK)
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440011",
    "booking_id": "550e8400-e29b-41d4-a716-446655440007",
    "amount": 5850,
    "status": "refunded",
    "refund_amount": 5850,
    "refund_reason": "Booking cancelled",
    "refund_date": "2026-10-08T12:00:00Z",
    "created_at": "2026-10-08T10:00:00Z"
  }
]
```

---

## POST /refunds
Process a refund

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "payment_id": "550e8400-e29b-41d4-a716-446655440010",
  "reason": "Customer requested refund",
  "amount": 5850
}
```

### Response (201 Created)
```json
{
  "payment_id": "550e8400-e29b-41d4-a716-446655440010",
  "status": "refunded",
  "amount": 5850,
  "reason": "Customer requested refund",
  "wallet_credited": true,
  "processed_at": "2026-10-08T12:00:00Z"
}
```

**Error Responses:**
- `404 Not Found` - Payment not found
- `409 Conflict` - Payment already refunded
- `400 Bad Request` - Invalid amount

---

# Notifications

## POST /notifications-email/send
Send email notification

### Request
**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "notification_id": "550e8400-e29b-41d4-a716-446655440012",
  "to_email": "user@example.com",
  "subject": "Booking Confirmation",
  "html_body": "<h1>Your booking is confirmed</h1>",
  "template_type": "booking_confirmed"
}
```

### Response (200 OK)
```json
{
  "email_id": "00001234567890abcdef",
  "status": "sent",
  "to": "user@example.com",
  "sent_at": "2026-10-08T10:00:00Z"
}
```

---

## POST /notifications-whatsapp/send
Send WhatsApp message

### Request
**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "notification_id": "550e8400-e29b-41d4-a716-446655440013",
  "to_phone": "+923001234567",
  "template_name": "booking_confirmed",
  "template_language": "en",
  "template_params": ["Court 1", "2026-10-15", "10:00 AM"]
}
```

### Response (200 OK)
```json
{
  "message_id": "wamid.1234567890abcdef",
  "status": "sent",
  "to": "+923001234567",
  "sent_at": "2026-10-08T10:00:00Z"
}
```

---

# Venues

## POST /courts
Create a court (Admin)

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "branch_id": "550e8400-e29b-41d4-a716-446655440002",
  "name": "Court 3",
  "sport_type": "padel",
  "capacity": 4,
  "hourly_rate": 6000,
  "amenities": ["lights", "ac"]
}
```

### Response (201 Created)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440014",
  "branch_id": "550e8400-e29b-41d4-a716-446655440002",
  "name": "Court 3",
  "sport_type": "padel",
  "capacity": 4,
  "hourly_rate": 6000,
  "amenities": ["lights", "ac"],
  "status": "active",
  "created_at": "2026-10-08T10:00:00Z"
}
```

---

## PATCH /courts/{id}
Update a court

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "hourly_rate": 6500,
  "amenities": ["lights", "ac", "parking"]
}
```

### Response (200 OK)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440014",
  "hourly_rate": 6500,
  "amenities": ["lights", "ac", "parking"]
}
```

---

## DELETE /courts/{id}
Delete (soft delete) a court

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response (200 OK)
```json
{
  "message": "Court deleted",
  "id": "550e8400-e29b-41d4-a716-446655440014"
}
```

---

## POST /rooms
Create a gaming room

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "branch_id": "550e8400-e29b-41d4-a716-446655440002",
  "name": "PS5 Room C",
  "game_type": "ps5",
  "capacity": 4,
  "booking_mode": "WholeRoom",
  "hourly_rate": 2500,
  "amenities": ["ps5", "ac"]
}
```

### Response (201 Created)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440015",
  "branch_id": "550e8400-e29b-41d4-a716-446655440002",
  "name": "PS5 Room C",
  "game_type": "ps5",
  "capacity": 4,
  "booking_mode": "WholeRoom",
  "hourly_rate": 2500,
  "status": "active"
}
```

---

## POST /seats
Create a seat

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "room_id": "550e8400-e29b-41d4-a716-446655440004",
  "label": "PC-06",
  "hourly_rate": 600
}
```

### Response (201 Created)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440016",
  "room_id": "550e8400-e29b-41d4-a716-446655440004",
  "label": "PC-06",
  "hourly_rate": 600,
  "status": "active"
}
```

---

## POST /packages
Create a package

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "branch_id": "550e8400-e29b-41d4-a716-446655440002",
  "scope": "Court",
  "name": "Unlimited Tennis",
  "package_type": "UnlimitedMonthly",
  "valid_days": 30,
  "price": 15000
}
```

### Response (201 Created)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440017",
  "branch_id": "550e8400-e29b-41d4-a716-446655440002",
  "scope": "Court",
  "name": "Unlimited Tennis",
  "package_type": "UnlimitedMonthly",
  "valid_days": 30,
  "price": 15000,
  "status": "active"
}
```

---

## POST /packages/{id}/purchase
Purchase a package

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "package_id": "550e8400-e29b-41d4-a716-446655440017",
  "payment_method": "Wallet"
}
```

### Response (201 Created)
```json
{
  "member_package": {
    "id": "550e8400-e29b-41d4-a716-446655440018",
    "member_id": "550e8400-e29b-41d4-a716-446655440000",
    "package_id": "550e8400-e29b-41d4-a716-446655440017",
    "sessions_remaining": null,
    "expires_at": "2026-11-08T10:00:00Z",
    "status": "active"
  },
  "payment": {
    "id": "550e8400-e29b-41d4-a716-446655440019",
    "amount": 15000,
    "status": "pending"
  },
  "message": "Package purchased successfully"
}
```

---

# Admin - Organizations

## GET /organizations
List all organizations (SuperAdmin only)

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response (200 OK)
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Sports Pro",
    "type": "Sports",
    "ntn_number": "1234567890",
    "status": "active",
    "created_at": "2026-10-01T10:00:00Z"
  }
]
```

---

## POST /organizations
Create organization (SuperAdmin only)

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "name": "Gaming Hub",
  "type": "Gaming",
  "ntn_number": "0987654321"
}
```

### Response (201 Created)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440020",
  "name": "Gaming Hub",
  "type": "Gaming",
  "ntn_number": "0987654321",
  "status": "active"
}
```

---

## PATCH /organizations/{id}
Update organization

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "name": "Gaming Hub Pro"
}
```

### Response (200 OK)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440020",
  "name": "Gaming Hub Pro"
}
```

---

## DELETE /organizations/{id}
Delete organization

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response (200 OK)
```json
{
  "message": "Organization deleted"
}
```

---

# Admin - Branches

## GET /branches (Admin)
List branches for admin (requires auth)

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
organizationId=550e8400-e29b-41d4-a716-446655440001 (required)
```

### Response (200 OK)
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440002",
    "organization_id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Downtown Tennis Courts",
    "venue_type": "Court",
    "location": "123 Main St",
    "tax_enabled": true,
    "tax_rate_percent": 17,
    "status": "active"
  }
]
```

---

## POST /branches
Create branch

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "organization_id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "Uptown Gaming",
  "venue_type": "Zone",
  "location": "456 Oak Ave",
  "tax_enabled": true,
  "tax_rate_percent": 17,
  "fbr_pos_registration_number": "POS123456"
}
```

### Response (201 Created)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440021",
  "organization_id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "Uptown Gaming",
  "venue_type": "Zone",
  "location": "456 Oak Ave",
  "tax_enabled": true,
  "tax_rate_percent": 17,
  "status": "active"
}
```

---

## PATCH /branches/{id}
Update branch

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "tax_rate_percent": 20,
  "card_payment_timeout_minutes": 15
}
```

### Response (200 OK)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "tax_rate_percent": 20,
  "card_payment_timeout_minutes": 15
}
```

---

## DELETE /branches/{id}
Delete branch

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response (200 OK)
```json
{
  "message": "Branch deleted"
}
```

---

# Admin - Staff

## GET /staff
List staff members

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
organizationId= (optional)
branchId= (optional)
```

### Response (200 OK)
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440022",
    "name": "Manager 1",
    "email": "manager1@example.com",
    "role": "BranchManager",
    "organization_id": "550e8400-e29b-41d4-a716-446655440001",
    "branch_id": "550e8400-e29b-41d4-a716-446655440002",
    "is_active": true
  }
]
```

---

## GET /staff/{id}
Get staff member details

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response (200 OK)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440022",
  "name": "Manager 1",
  "email": "manager1@example.com",
  "role": "BranchManager",
  "organization_id": "550e8400-e29b-41d4-a716-446655440001",
  "branch_id": "550e8400-e29b-41d4-a716-446655440002",
  "is_active": true
}
```

---

## POST /staff
Create staff member (Admin)

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "email": "manager2@example.com",
  "password": "SecurePassword123!",
  "name": "Manager 2",
  "role": "BranchManager",
  "organization_id": "550e8400-e29b-41d4-a716-446655440001",
  "branch_id": "550e8400-e29b-41d4-a716-446655440002"
}
```

### Response (201 Created)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440023",
  "name": "Manager 2",
  "email": "manager2@example.com",
  "role": "BranchManager"
}
```

---

## PATCH /staff/{id}
Update staff member

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "role": "OrgAdmin",
  "is_active": true
}
```

### Response (200 OK)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440022",
  "role": "OrgAdmin",
  "is_active": true
}
```

---

## DELETE /staff/{id}
Deactivate staff

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response (200 OK)
```json
{
  "message": "Staff deleted",
  "id": "550e8400-e29b-41d4-a716-446655440022"
}
```

---

# Audit Logs (NEW)

## GET /audit-logs
View audit trail (Admin)

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
entity_type=booking (optional)
limit=100 (optional)
offset=0 (optional)
```

### Response (200 OK)
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440024",
      "action": "create",
      "entity_type": "booking",
      "entity_id": "550e8400-e29b-41d4-a716-446655440007",
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "changes": {
        "status": "Confirmed"
      },
      "description": "Created booking",
      "ip_address": "192.168.1.1",
      "user_agent": "Mozilla/5.0...",
      "created_at": "2026-10-08T10:00:00Z"
    }
  ],
  "count": 156,
  "limit": 100,
  "offset": 0
}
```

---

## POST /audit-logs
Log an action (Admin)

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "action": "update",
  "entity_type": "payment",
  "entity_id": "550e8400-e29b-41d4-a716-446655440010",
  "changes": {
    "status": "refunded"
  },
  "description": "Refunded payment"
}
```

### Response (201 Created)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440025",
  "action": "update",
  "entity_type": "payment",
  "entity_id": "550e8400-e29b-41d4-a716-446655440010",
  "user_id": "550e8400-e29b-41d4-a716-446655440022",
  "changes": {
    "status": "refunded"
  },
  "created_at": "2026-10-08T12:00:00Z"
}
```

---

# Reports (NEW)

## GET /reports/revenue
Revenue analytics (Admin)

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
start_date=2026-10-01 (optional)
end_date=2026-10-31 (optional)
branch_id= (optional)
```

### Response (200 OK)
```json
{
  "period": {
    "start_date": "2026-10-01",
    "end_date": "2026-10-31"
  },
  "revenue": {
    "total": 250000,
    "tax": 42500,
    "net": 207500,
    "transaction_count": 45,
    "average_transaction": 5555.56
  },
  "currency": "PKR",
  "generated_at": "2026-10-08T12:00:00Z"
}
```

---

## GET /reports/bookings
Booking statistics (Admin)

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
start_date=2026-10-01 (optional)
end_date=2026-10-31 (optional)
```

### Response (200 OK)
```json
{
  "period": {
    "start_date": "2026-10-01",
    "end_date": "2026-10-31"
  },
  "bookings": {
    "total": 128,
    "by_status": {
      "Confirmed": 95,
      "Pending": 12,
      "Cancelled": 15,
      "NoShow": 6
    }
  },
  "generated_at": "2026-10-08T12:00:00Z"
}
```

---

## Error Code Reference

| Code | Message | Meaning |
|------|---------|---------|
| 200 | OK | Success |
| 201 | Created | Resource created |
| 400 | Bad Request | Invalid parameters |
| 401 | Unauthorized | Missing/invalid token |
| 402 | Payment Required | Insufficient funds |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Double-booking/duplicate |
| 500 | Server Error | Database error |

---

## Authentication

All authenticated endpoints require a JWT token in the `Authorization` header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Get your token by:
1. Register: `POST /auth/members/register`
2. Login: `POST /auth/members/login`
3. Response includes `session.access_token`

---

**API Version:** 2.0  
**Total Endpoints:** 57  
**Last Updated:** October 8, 2026  
**Status:** Production Ready ✅
