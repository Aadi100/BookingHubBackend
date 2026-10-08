// supabase/functions/reports/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return errorResponse("Unauthorized", 401, corsHeaders);
    }

    const url = new URL(req.url);
    const reportType = url.pathname.split("/").pop();

    if (reportType === "revenue" || reportType === "index.ts") {
      return await revenueReport(url, supabase, user, corsHeaders);
    } else if (reportType === "bookings") {
      return await bookingsReport(url, supabase, user, corsHeaders);
    } else if (reportType === "branch-performance") {
      return await branchPerformanceReport(url, supabase, user, corsHeaders);
    } else if (reportType === "utilization") {
      return await utilizationReport(url, supabase, user, corsHeaders);
    } else if (reportType === "tax-summary") {
      return await taxSummaryReport(url, supabase, user, corsHeaders);
    } else if (reportType === "bookings-summary") {
      return await bookingsSummaryReport(url, supabase, user, corsHeaders);
    }

    return errorResponse("Report not found", 404, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function revenueReport(url: URL, supabase: any, user: any, headers: any) {
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");
  const branchId = url.searchParams.get("branch_id");

  // Get revenue from payments
  let query = supabase
    .from("payments")
    .select("amount, tax_amount, status, created_at")
    .eq("status", "paid");

  if (startDate) {
    query = query.gte("created_at", `${startDate}T00:00:00Z`);
  }

  if (endDate) {
    query = query.lte("created_at", `${endDate}T23:59:59Z`);
  }

  const { data: payments, error } = await query;

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  // Calculate totals
  const totalRevenue = payments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
  const totalTax = payments.reduce((sum: number, p: any) => sum + (p.tax_amount || 0), 0);
  const totalAfterTax = totalRevenue - totalTax;
  const transactionCount = payments.length;

  return successResponse({
    period: {
      start_date: startDate || "all",
      end_date: endDate || "all"
    },
    revenue: {
      total: totalRevenue,
      tax: totalTax,
      net: totalAfterTax,
      transaction_count: transactionCount,
      average_transaction: transactionCount > 0 ? totalRevenue / transactionCount : 0
    },
    currency: "PKR",
    generated_at: new Date().toISOString()
  }, 200, headers);
}

async function bookingsReport(url: URL, supabase: any, user: any, headers: any) {
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");

  let query = supabase.from("bookings").select("*");

  if (startDate) {
    query = query.gte("created_at", `${startDate}T00:00:00Z`);
  }

  if (endDate) {
    query = query.lte("created_at", `${endDate}T23:59:59Z`);
  }

  const { data: bookings, error } = await query;

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  const statusCounts: any = {};
  bookings.forEach((b: any) => {
    statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
  });

  return successResponse({
    period: {
      start_date: startDate || "all",
      end_date: endDate || "all"
    },
    bookings: {
      total: bookings.length,
      by_status: statusCounts
    },
    generated_at: new Date().toISOString()
  }, 200, headers);
}

async function branchPerformanceReport(url: URL, supabase: any, user: any, headers: any) {
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");
  const branchId = url.searchParams.get("branch_id");

  let query = supabase
    .from("bookings")
    .select("id, branch_id, status, total, created_at");

  if (startDate) {
    query = query.gte("created_at", `${startDate}T00:00:00Z`);
  }
  if (endDate) {
    query = query.lte("created_at", `${endDate}T23:59:59Z`);
  }
  if (branchId) {
    query = query.eq("branch_id", branchId);
  }

  const { data: bookings, error } = await query;

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  const branchStats: any = {};
  bookings.forEach((b: any) => {
    if (!branchStats[b.branch_id]) {
      branchStats[b.branch_id] = {
        total_bookings: 0,
        completed: 0,
        cancelled: 0,
        revenue: 0,
      };
    }
    branchStats[b.branch_id].total_bookings++;
    if (b.status === "Confirmed") branchStats[b.branch_id].completed++;
    if (b.status === "Cancelled") branchStats[b.branch_id].cancelled++;
    branchStats[b.branch_id].revenue += b.total || 0;
  });

  return successResponse({
    period: {
      start_date: startDate || "all",
      end_date: endDate || "all",
    },
    branches: branchStats,
    generated_at: new Date().toISOString(),
  }, 200, headers);
}

async function utilizationReport(url: URL, supabase: any, user: any, headers: any) {
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");
  const branchId = url.searchParams.get("branch_id");

  let query = supabase
    .from("bookings")
    .select("id, court_id, room_id, start_time, end_time, status");

  if (startDate) {
    query = query.gte("start_time", `${startDate}T00:00:00Z`);
  }
  if (endDate) {
    query = query.lte("start_time", `${endDate}T23:59:59Z`);
  }

  const { data: bookings, error } = await query;

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  const totalHours = bookings.length * 1; // Assuming 1-hour bookings
  const confirmedHours = bookings.filter((b: any) => b.status === "Confirmed").length;
  const utilizationRate = totalHours > 0 ? (confirmedHours / totalHours) * 100 : 0;

  return successResponse({
    period: {
      start_date: startDate || "all",
      end_date: endDate || "all",
    },
    utilization: {
      total_slots: totalHours,
      booked_slots: confirmedHours,
      available_slots: totalHours - confirmedHours,
      utilization_rate: utilizationRate.toFixed(2) + "%",
    },
    generated_at: new Date().toISOString(),
  }, 200, headers);
}

async function taxSummaryReport(url: URL, supabase: any, user: any, headers: any) {
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");

  let query = supabase
    .from("payments")
    .select("amount, tax_amount, status");

  if (startDate) {
    query = query.gte("created_at", `${startDate}T00:00:00Z`);
  }
  if (endDate) {
    query = query.lte("created_at", `${endDate}T23:59:59Z`);
  }

  const { data: payments, error } = await query;

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  const totalRevenue = payments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
  const totalTax = payments.reduce((sum: number, p: any) => sum + (p.tax_amount || 0), 0);
  const taxRate = totalRevenue > 0 ? (totalTax / totalRevenue) * 100 : 0;

  return successResponse({
    period: {
      start_date: startDate || "all",
      end_date: endDate || "all",
    },
    tax: {
      total_revenue: totalRevenue,
      total_tax: totalTax,
      tax_rate_percent: taxRate.toFixed(2),
      net_revenue: totalRevenue - totalTax,
      currency: "PKR",
    },
    generated_at: new Date().toISOString(),
  }, 200, headers);
}

async function bookingsSummaryReport(url: URL, supabase: any, user: any, headers: any) {
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");

  let query = supabase.from("bookings").select("*");

  if (startDate) {
    query = query.gte("created_at", `${startDate}T00:00:00Z`);
  }
  if (endDate) {
    query = query.lte("created_at", `${endDate}T23:59:59Z`);
  }

  const { data: bookings, error } = await query;

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  const statusCounts: any = {};
  let totalRevenue = 0;
  bookings.forEach((b: any) => {
    statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
    totalRevenue += b.total || 0;
  });

  return successResponse({
    period: {
      start_date: startDate || "all",
      end_date: endDate || "all",
    },
    summary: {
      total_bookings: bookings.length,
      by_status: statusCounts,
      total_revenue: totalRevenue,
      average_booking_value: bookings.length > 0 ? (totalRevenue / bookings.length).toFixed(2) : 0,
    },
    generated_at: new Date().toISOString(),
  }, 200, headers);
}

function successResponse(data: any, statusCode = 200, headers: any = {}) {
  return new Response(JSON.stringify(data), {
    status: statusCode,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, statusCode = 400, headers: any = {}) {
  console.error(`[${statusCode}] ${message}`);
  return new Response(JSON.stringify({ error: message }), {
    status: statusCode,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
