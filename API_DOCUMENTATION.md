# Booking Hub Backend - Complete API Documentation

**Base URL:** `https://hfaghwlklnztmhijijuw.supabase.co/functions/v1`

**Authentication:** All endpoints require JWT token in Authorization header (except registration)
```
Authorization: Bearer <jwt_token>
```

---

## Table of Contents
1. [Authentication](#authentication)
2. [Availability](#availability)
3. [Bookings](#bookings)
4. [Courts](#courts)
5. [Rooms](#rooms)
6. [Seats](#seats)
7. [Packages](#packages)
8. [Wallet](#wallet)
9. [Payments - Stripe](#payments---stripe)
10. [Notifications - Email](#notifications---email)
11. [Notifications - WhatsApp](#notifications---whatsapp)
12. [Organizations](#organizations)
13. [Branches](#branches)
14. [Staff](#staff)

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

### Response
**Status:** 201 Created

```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "john@example.com",
    "email_confirmed_at": "2026-09-30T10:00:00Z",
    "user_metadata": {
      "full_name": "John Doe"
    }
  },
  "message": "Member registered successfully"
}
```

**Error Responses:**
```json
// 400 Bad Request
{
  "error": "Missing name, email, or password"
}

// 400 Bad Request (Email already exists)
{
  "error": "User already registered"
}
```

---

## POST /auth/staff/create
Create a new staff account (SuperAdmin/OrgAdmin only)

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "name": "Manager Name",
  "email": "manager@example.com",
  "password": "SecurePassword123!",
  "role": "BranchManager",
  "organization_id": "550e8400-e29b-41d4-a716-446655440001",
  "branch_id": "550e8400-e29b-41d4-a716-446655440002"
}
```

### Response
**Status:** 201 Created

```json
{
  "staff": {
    "id": "550e8400-e29b-41d4-a716-446655440003",
    "name": "Manager Name",
    "email": "manager@example.com",
    "role": "BranchManager"
  },
  "message": "Staff account created successfully"
}
```

**Error Responses:**
```json
// 401 Unauthorized
{
  "error": "Unauthorized"
}

// 403 Forbidden
{
  "error": "Only SuperAdmin or OrgAdmin can create staff"
}

// 400 Bad Request
{
  "error": "Missing required fields"
}
```

---

# Availability

## GET /availability
Get available time slots for a court or room on a specific date

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
courtId=550e8400-e29b-41d4-a716-446655440000  (or roomId instead)
date=2026-10-01
```

### Response
**Status:** 200 OK

**For Court (WholeRoom):**
```json
{
  "date": "2026-10-01",
  "slots": [
    {
      "start": "2026-10-01T09:00:00Z",
      "end": "2026-10-01T10:00:00Z",
      "price": 5000,
      "status": "available"
    },
    {
      "start": "2026-10-01T10:00:00Z",
      "end": "2026-10-01T11:00:00Z",
      "price": 5000,
      "status": "booked"
    }
  ]
}
```

**For Room (PerSeat):**
```json
{
  "date": "2026-10-01",
  "booking_mode": "PerSeat",
  "seats": [
    {
      "seat_id": "550e8400-e29b-41d4-a716-446655440004",
      "label": "PC-01",
      "slots": [
        {
          "start": "2026-10-01T09:00:00Z",
          "end": "2026-10-01T10:00:00Z",
          "price": 1000,
          "status": "available"
        }
      ]
    }
  ]
}
```

**Error Responses:**
```json
// 401 Unauthorized
{
  "error": "Unauthorized"
}

// 400 Bad Request
{
  "error": "Missing courtId/roomId and date"
}

// 404 Not Found
{
  "error": "Court not found"
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
  "branch_id": "550e8400-e29b-41d4-a716-446655440001",
  "court_id": "550e8400-e29b-41d4-a716-446655440000",
  "start_time": "2026-10-01T10:00:00Z",
  "end_time": "2026-10-01T11:00:00Z",
  "payment_method": "Card",
  "member_package_id": null
}
```

### Response
**Status:** 201 Created

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440005",
  "court_id": "550e8400-e29b-41d4-a716-446655440000",
  "member_id": "550e8400-e29b-41d4-a716-446655440006",
  "start_time": "2026-10-01T10:00:00Z",
  "end_time": "2026-10-01T11:00:00Z",
  "status": "Pending",
  "price": 5000,
  "tax_rate_percent": 0,
  "tax_amount": 0,
  "total": 5000,
  "currency": "PKR",
  "payment_method": "Card",
  "created_at": "2026-09-30T10:00:00Z"
}
```

**Error Responses:**
```json
// 401 Unauthorized
{
  "error": "Unauthorized"
}

// 409 Conflict (Double-booking)
{
  "error": "This time slot is already booked"
}

// 402 Payment Required (Wallet insufficient)
{
  "error": "Insufficient wallet balance"
}

// 400 Bad Request
{
  "error": "Missing start_time or end_time"
}
```

---

## GET /bookings
List bookings for the authenticated member

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
status=Confirmed  (optional: Pending, Confirmed, Completed, Cancelled, NoShow)
courtId=550e8400-e29b-41d4-a716-446655440000  (optional)
```

### Response
**Status:** 200 OK

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440005",
    "court_id": "550e8400-e29b-41d4-a716-446655440000",
    "member_id": "550e8400-e29b-41d4-a716-446655440006",
    "start_time": "2026-10-01T10:00:00Z",
    "end_time": "2026-10-01T11:00:00Z",
    "status": "Confirmed",
    "price": 5000,
    "total": 5000,
    "currency": "PKR",
    "payment_method": "Card",
    "created_at": "2026-09-30T10:00:00Z"
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

### Response
**Status:** 200 OK

```json
{
  "message": "Booking cancelled"
}
```

**Error Responses:**
```json
// 401 Unauthorized
{
  "error": "Unauthorized"
}

// 404 Not Found
{
  "error": "Booking not found"
}

// 400 Bad Request
{
  "error": "Booking cannot be cancelled in its current state"
}
```

---

# Courts

## GET /courts
List all courts in a branch

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
branchId=550e8400-e29b-41d4-a716-446655440001
```

### Response
**Status:** 200 OK

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "branch_id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Court 1",
    "sport_type": "tennis",
    "capacity": 2,
    "hourly_rate": 5000,
    "amenities": ["lights", "parking"],
    "status": "active",
    "created_at": "2026-09-30T10:00:00Z"
  }
]
```

---

## GET /courts/{id}
Get a specific court

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response
**Status:** 200 OK

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "branch_id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "Court 1",
  "sport_type": "tennis",
  "capacity": 2,
  "hourly_rate": 5000,
  "amenities": ["lights", "parking"],
  "status": "active"
}
```

---

## POST /courts
Create a new court (Admin only)

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "branch_id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "Padel Court 1",
  "sport_type": "padel",
  "capacity": 4,
  "hourly_rate": 6000,
  "amenities": ["lights", "ac", "parking"]
}
```

### Response
**Status:** 201 Created

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "branch_id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "Padel Court 1",
  "sport_type": "padel",
  "capacity": 4,
  "hourly_rate": 6000,
  "amenities": ["lights", "ac", "parking"],
  "status": "active"
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
  "hourly_rate": 5500,
  "amenities": ["lights", "parking"]
}
```

### Response
**Status:** 200 OK

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Court 1",
  "hourly_rate": 5500,
  "amenities": ["lights", "parking"]
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

### Response
**Status:** 200 OK

```json
{
  "message": "Court deleted"
}
```

---

# Rooms

## GET /rooms
List all rooms in a branch

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
branchId=550e8400-e29b-41d4-a716-446655440001
```

### Response
**Status:** 200 OK

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440007",
    "branch_id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "CS2 Room A",
    "game_type": "cs2",
    "capacity": 5,
    "booking_mode": "WholeRoom",
    "hourly_rate": 3000,
    "amenities": ["ac", "gaming-pc"],
    "status": "active"
  }
]
```

---

## POST /rooms
Create a new room

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "branch_id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "PS5 Room B",
  "game_type": "ps5",
  "capacity": 4,
  "booking_mode": "WholeRoom",
  "hourly_rate": 2000,
  "amenities": ["ac", "ps5-console"]
}
```

### Response
**Status:** 201 Created

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440008",
  "branch_id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "PS5 Room B",
  "game_type": "ps5",
  "capacity": 4,
  "booking_mode": "WholeRoom",
  "hourly_rate": 2000,
  "amenities": ["ac", "ps5-console"],
  "status": "active"
}
```

---

## PATCH /rooms/{id}
Update a room

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "hourly_rate": 2500
}
```

### Response
**Status:** 200 OK

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440007",
  "hourly_rate": 2500
}
```

---

## DELETE /rooms/{id}
Delete (soft delete) a room

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response
**Status:** 200 OK

```json
{
  "message": "Room deleted"
}
```

---

# Seats

## GET /seats
List all seats in a room

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
roomId=550e8400-e29b-41d4-a716-446655440007
```

### Response
**Status:** 200 OK

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440009",
    "room_id": "550e8400-e29b-41d4-a716-446655440007",
    "label": "PC-01",
    "hourly_rate": 500,
    "status": "active"
  }
]
```

---

## POST /seats
Create a new seat

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "room_id": "550e8400-e29b-41d4-a716-446655440007",
  "label": "PC-10",
  "hourly_rate": 500
}
```

### Response
**Status:** 201 Created

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440010",
  "room_id": "550e8400-e29b-41d4-a716-446655440007",
  "label": "PC-10",
  "hourly_rate": 500,
  "status": "active"
}
```

---

## PATCH /seats/{id}
Update a seat

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "hourly_rate": 600
}
```

### Response
**Status:** 200 OK

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440009",
  "hourly_rate": 600
}
```

---

## DELETE /seats/{id}
Delete (soft delete) a seat

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response
**Status:** 200 OK

```json
{
  "message": "Seat deleted"
}
```

---

# Packages

## GET /packages
List all packages in a branch

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
branchId=550e8400-e29b-41d4-a716-446655440001
```

### Response
**Status:** 200 OK

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440011",
    "branch_id": "550e8400-e29b-41d4-a716-446655440001",
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

## POST /packages
Create a new package

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "branch_id": "550e8400-e29b-41d4-a716-446655440001",
  "scope": "Court",
  "scope_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Unlimited Tennis",
  "package_type": "UnlimitedMonthly",
  "valid_days": 30,
  "price": 15000
}
```

### Response
**Status:** 201 Created

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440012",
  "branch_id": "550e8400-e29b-41d4-a716-446655440001",
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
  "package_id": "550e8400-e29b-41d4-a716-446655440011",
  "payment_method": "Card"
}
```

### Response
**Status:** 201 Created

```json
{
  "member_package": {
    "id": "550e8400-e29b-41d4-a716-446655440013",
    "member_id": "550e8400-e29b-41d4-a716-446655440006",
    "package_id": "550e8400-e29b-41d4-a716-446655440011",
    "sessions_remaining": 10,
    "expires_at": "2026-12-29T10:00:00Z",
    "status": "active"
  },
  "payment": {
    "id": "550e8400-e29b-41d4-a716-446655440014",
    "amount": 45000,
    "status": "pending"
  },
  "message": "Package purchased successfully"
}
```

---

## PATCH /packages/{id}
Update a package

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "price": 50000
}
```

### Response
**Status:** 200 OK

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440011",
  "price": 50000
}
```

---

## DELETE /packages/{id}
Delete (soft delete) a package

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response
**Status:** 200 OK

```json
{
  "message": "Package deleted"
}
```

---

# Wallet

## GET /wallet
Get wallet balance

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response
**Status:** 200 OK

```json
{
  "member_id": "550e8400-e29b-41d4-a716-446655440006",
  "balance": 50000,
  "currency": "PKR",
  "created_at": "2026-09-30T10:00:00Z"
}
```

---

## GET /wallet/credits
Get wallet credit history (recharges, refunds)

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response
**Status:** 200 OK

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440015",
    "member_id": "550e8400-e29b-41d4-a716-446655440006",
    "reason": "Recharge",
    "amount": 50000,
    "balance_after": 50000,
    "reference": "Credit card recharge",
    "created_at": "2026-09-30T10:00:00Z"
  }
]
```

---

## GET /wallet/debits
Get wallet debit history (bookings, purchases)

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response
**Status:** 200 OK

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440016",
    "member_id": "550e8400-e29b-41d4-a716-446655440006",
    "reason": "BookingPayment",
    "amount": 5000,
    "balance_after": 45000,
    "reference": "Booking payment",
    "booking_id": "550e8400-e29b-41d4-a716-446655440005",
    "created_at": "2026-09-30T11:00:00Z"
  }
]
```

---

## POST /wallet/recharge
Top up wallet balance

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

### Response
**Status:** 201 Created

```json
{
  "message": "Payment intent created",
  "payment_method": "Card",
  "amount": 10000,
  "next": "Redirect to payment gateway"
}
```

---

# Payments - Stripe

## POST /payments-stripe/intent
Create a payment intent for a booking or package

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "booking_id": "550e8400-e29b-41d4-a716-446655440005",
  "amount": 5000,
  "currency": "PKR"
}
```

### Response
**Status:** 200 OK

```json
{
  "payment_intent_id": "pi_1234567890",
  "client_secret": "pi_1234567890_secret_abcdef",
  "amount": 500000,
  "currency": "pkr",
  "status": "requires_payment_method"
}
```

---

## POST /payments-stripe/webhook
Webhook endpoint for Stripe callbacks

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
      "status": "succeeded"
    }
  }
}
```

### Response
**Status:** 200 OK

```json
{
  "received": true
}
```

---

# Notifications - Email

## POST /notifications-email/send
Send an email notification

### Request
**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "notification_id": "550e8400-e29b-41d4-a716-446655440017",
  "to_email": "user@example.com",
  "subject": "Booking Confirmation",
  "html_body": "<h1>Your booking is confirmed</h1>",
  "template_type": "booking_confirmed"
}
```

### Response
**Status:** 200 OK

```json
{
  "email_id": "00001234567890abcdef",
  "status": "sent"
}
```

---

## POST /notifications-email/webhook
Webhook endpoint for Resend delivery status

### Request
**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "type": "email.delivered",
  "data": {
    "id": "00001234567890abcdef"
  }
}
```

### Response
**Status:** 200 OK

```json
{
  "received": true
}
```

---

# Notifications - WhatsApp

## POST /notifications-whatsapp/send
Send a WhatsApp message

### Request
**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "notification_id": "550e8400-e29b-41d4-a716-446655440018",
  "to_phone": "+923001234567",
  "template_name": "booking_confirmed",
  "template_language": "en",
  "template_params": ["Court 1", "2026-10-01", "10:00 AM"]
}
```

### Response
**Status:** 200 OK

```json
{
  "message_id": "wamid.1234567890abcdef",
  "status": "sent"
}
```

---

## POST /notifications-whatsapp/webhook
Webhook endpoint for WhatsApp delivery status

### Request
**Headers:**
```
X-Hub-Signature-256: sha256=signature
Content-Type: application/json
```

**Body:**
```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "changes": [
        {
          "value": {
            "statuses": [
              {
                "id": "wamid.1234567890abcdef",
                "status": "delivered"
              }
            ]
          }
        }
      ]
    }
  ]
}
```

### Response
**Status:** 200 OK

```json
{
  "received": true
}
```

---

# Organizations

## GET /organizations
List all organizations (SuperAdmin only)

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response
**Status:** 200 OK

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Sports Pro",
    "type": "Sports",
    "ntn_number": "123456789",
    "status": "active",
    "created_at": "2026-09-30T10:00:00Z"
  }
]
```

---

## POST /organizations
Create a new organization (SuperAdmin only)

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
  "ntn_number": "987654321"
}
```

### Response
**Status:** 201 Created

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440019",
  "name": "Gaming Hub",
  "type": "Gaming",
  "ntn_number": "987654321",
  "status": "active"
}
```

---

## PATCH /organizations/{id}
Update an organization (SuperAdmin only)

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

### Response
**Status:** 200 OK

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440019",
  "name": "Gaming Hub Pro"
}
```

---

## DELETE /organizations/{id}
Delete (soft delete) an organization (SuperAdmin only)

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response
**Status:** 200 OK

```json
{
  "message": "Organization deleted"
}
```

---

# Branches

## GET /branches
List branches in an organization

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
organizationId=550e8400-e29b-41d4-a716-446655440001
```

### Response
**Status:** 200 OK

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440020",
    "organization_id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Downtown Sports",
    "venue_type": "Court",
    "location": "123 Main St",
    "tax_enabled": false,
    "default_currency": "PKR",
    "status": "active"
  }
]
```

---

## POST /branches
Create a new branch

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

### Response
**Status:** 201 Created

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
Update a branch

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Body:**
```json
{
  "default_currency": "USD",
  "card_payment_timeout_minutes": 15
}
```

### Response
**Status:** 200 OK

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440020",
  "default_currency": "USD",
  "card_payment_timeout_minutes": 15
}
```

---

## DELETE /branches/{id}
Delete (soft delete) a branch

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response
**Status:** 200 OK

```json
{
  "message": "Branch deleted"
}
```

---

# Staff

## GET /staff
List staff members in an organization or branch

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Query Parameters:**
```
organizationId=550e8400-e29b-41d4-a716-446655440001  (optional)
branchId=550e8400-e29b-41d4-a716-446655440020  (optional)
```

### Response
**Status:** 200 OK

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440022",
    "name": "Manager 1",
    "email": "manager1@example.com",
    "role": "BranchManager",
    "organization_id": "550e8400-e29b-41d4-a716-446655440001",
    "branch_id": "550e8400-e29b-41d4-a716-446655440020",
    "is_active": true
  }
]
```

---

## GET /staff/{id}
Get a staff member

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response
**Status:** 200 OK

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440022",
  "name": "Manager 1",
  "email": "manager1@example.com",
  "role": "BranchManager",
  "organization_id": "550e8400-e29b-41d4-a716-446655440001",
  "branch_id": "550e8400-e29b-41d4-a716-446655440020",
  "is_active": true
}
```

---

## POST /staff
Create a new staff member (OrgAdmin/SuperAdmin only)

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
  "branch_id": "550e8400-e29b-41d4-a716-446655440020"
}
```

### Response
**Status:** 201 Created

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
Update a staff member

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

### Response
**Status:** 200 OK

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440022",
  "role": "OrgAdmin",
  "is_active": true
}
```

---

## DELETE /staff/{id}
Disable a staff member

### Request
**Headers:**
```
Authorization: Bearer <jwt_token>
```

### Response
**Status:** 200 OK

```json
{
  "message": "Staff deleted"
}
```

---

## Common Error Codes

| Code | Message | Meaning |
|------|---------|---------|
| 200 | OK | Request successful |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Invalid request parameters |
| 401 | Unauthorized | Missing or invalid JWT token |
| 402 | Payment Required | Insufficient wallet balance |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Double-booking or duplicate resource |
| 500 | Internal Server Error | Server error |

---

## Authentication Header Format

All authenticated endpoints require:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Get your JWT token by calling `/auth/members/register` or `/auth/staff/create`, then calling `/auth/login`.

---

## Rate Limiting

- **Auth endpoints**: 15 requests per 15 minutes per IP
- **Other endpoints**: No rate limit (subject to Supabase quotas)

---

## Pagination

All list endpoints support optional pagination:
```
GET /endpoint?limit=10&offset=0
```

---

**API Version:** 1.0  
**Last Updated:** September 30, 2026  
**Base URL:** https://hfaghwlklnztmhijijuw.supabase.co/functions/v1
