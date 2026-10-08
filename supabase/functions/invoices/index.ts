// supabase/functions/invoices/index.ts
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

    const { method } = req;
    const url = new URL(req.url);

    if (method === "GET") {
      return await listInvoices(url, supabase, user, corsHeaders);
    } else if (method === "POST") {
      return await createInvoice(req, supabase, user, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function listInvoices(url: URL, supabase: any, user: any, headers: any) {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function createInvoice(req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();
  const { payment_id, invoice_number, issued_date, due_date, notes } = body;

  if (!payment_id) {
    return errorResponse("Missing payment_id", 400, headers);
  }

  // Generate invoice data
  const invoiceData = {
    id: `INV-${Date.now()}`,
    payment_id,
    invoice_number: invoice_number || `INV-${Math.random().toString(36).substr(2, 9)}`,
    issued_date: issued_date || new Date().toISOString().split('T')[0],
    due_date: due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    status: "generated",
    notes,
    created_at: new Date().toISOString()
  };

  return successResponse(invoiceData, 201, headers);
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
