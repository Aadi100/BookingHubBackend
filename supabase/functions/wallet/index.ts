// supabase/functions/wallet/index.ts
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

    // Use service role for data access — these queries are always scoped to
    // the authenticated user's own id (memberId = user.id), so bypassing RLS
    // here is safe and avoids the "own row invisible to self" RLS bug seen
    // on /auth/me and /staff.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { method } = req;
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");

    if (method === "GET" && pathParts.includes("credits")) {
      return await getWalletCredits(user.id, supabaseAdmin, corsHeaders);
    } else if (method === "GET" && pathParts.includes("debits")) {
      return await getWalletDebits(user.id, supabaseAdmin, corsHeaders);
    } else if (method === "GET") {
      return await getWallet(user.id, supabaseAdmin, corsHeaders);
    } else if (method === "POST" && pathParts.includes("recharge")) {
      return await rechargeWallet(user.id, req, supabaseAdmin, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function getWallet(memberId: string, supabase: any, headers: any) {
  const { data, error } = await supabase
    .from("wallets")
    .select("*")
    .eq("member_id", memberId)
    .single();

  if (error) {
    return errorResponse("Wallet not found", 404, headers);
  }

  return successResponse(data, 200, headers);
}

async function getWalletCredits(memberId: string, supabase: any, headers: any) {
  const { data, error } = await supabase
    .from("wallet_credits")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function getWalletDebits(memberId: string, supabase: any, headers: any) {
  const { data, error } = await supabase
    .from("wallet_debits")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function rechargeWallet(memberId: string, req: Request, supabase: any, headers: any) {
  const body = await req.json();
  const { amount, payment_method } = body;

  if (!amount || amount <= 0) {
    return errorResponse("Invalid amount", 400, headers);
  }

  if (!payment_method) {
    return errorResponse("Missing payment_method", 400, headers);
  }

  try {
    // For now, just a placeholder. Real implementation would:
    // 1. Create Payment row
    // 2. Create payment intent with gateway
    // 3. Return checkout session to client
    // 4. Credit wallet once payment webhook confirms

    // Simplified: direct credit (for testing with Card)
    if (payment_method === "Card") {
      // In production, don't credit here—wait for webhook
      return successResponse({
        message: "Payment intent created",
        payment_method,
        amount,
        next: "Redirect to payment gateway"
      }, 201, headers);
    }

    return errorResponse("Unsupported payment method", 400, headers);
  } catch (error) {
    return errorResponse(error.message, 500, headers);
  }
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
