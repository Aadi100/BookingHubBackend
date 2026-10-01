// supabase/functions/packages/index.ts
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

    const { method } = req;
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const packageId = pathParts[pathParts.length - 1];

    // GET requests are public (no auth required)
    if (method === "GET") {
      if (packageId && packageId !== "packages" && !pathParts.includes("purchase")) {
        return await getPackage(packageId, supabase, corsHeaders);
      } else {
        return await listPackages(url, supabase, corsHeaders);
      }
    }

    // POST, PATCH, DELETE require auth
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return errorResponse("Unauthorized", 401, corsHeaders);
    }

    if (method === "POST" && pathParts.includes("purchase")) {
      return await purchasePackage(req, supabase, user, corsHeaders);
    } else if (method === "POST") {
      return await createPackage(req, supabase, user, corsHeaders);
    } else if (method === "PATCH") {
      return await updatePackage(packageId, req, supabase, user, corsHeaders);
    } else if (method === "DELETE") {
      return await deletePackage(packageId, supabase, user, corsHeaders);
    }

    return errorResponse("Method not allowed", 405, corsHeaders);
  } catch (error) {
    console.error(error);
    return errorResponse(error.message, 500, corsHeaders);
  }
});

async function listPackages(url: URL, supabase: any, headers: any) {
  const branchId = url.searchParams.get("branchId");

  if (!branchId) {
    return errorResponse("Missing branchId", 400, headers);
  }

  const { data, error } = await supabase
    .from("packages")
    .select("*")
    .eq("branch_id", branchId)
    .eq("status", "active")
    .order("name");

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function getPackage(packageId: string, supabase: any, headers: any) {
  const { data, error } = await supabase
    .from("packages")
    .select("*")
    .eq("id", packageId)
    .eq("status", "active")
    .single();

  if (error) {
    return errorResponse("Package not found", 404, headers);
  }

  return successResponse(data, 200, headers);
}

async function createPackage(req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();

  const { branch_id, scope, scope_id, name, package_type, valid_days, price } = body;
  const { sessions_included, hours_included, discount_percent } = body;

  if (!branch_id || !scope || !name || !package_type || !valid_days || !price) {
    return errorResponse("Missing required fields", 400, headers);
  }

  // Verify user can create packages in this branch
  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, branch_id")
    .eq("id", user.id)
    .single();

  if (!staff || !["SuperAdmin", "OrgAdmin", "BranchManager"].includes(staff.role)) {
    return errorResponse("Unauthorized", 403, headers);
  }

  if (staff.role === "BranchManager" && staff.branch_id !== branch_id) {
    return errorResponse("Can only create packages in your branch", 403, headers);
  }

  const { data, error } = await supabase
    .from("packages")
    .insert({
      branch_id,
      scope,
      scope_id,
      name,
      package_type,
      sessions_included,
      hours_included,
      discount_percent,
      valid_days,
      price
    })
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 201, headers);
}

async function updatePackage(packageId: string, req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();

  const { data: pkg } = await supabase
    .from("packages")
    .select("branch_id")
    .eq("id", packageId)
    .single();

  if (!pkg) {
    return errorResponse("Package not found", 404, headers);
  }

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, branch_id")
    .eq("id", user.id)
    .single();

  if (!staff || !["SuperAdmin", "OrgAdmin", "BranchManager"].includes(staff.role)) {
    return errorResponse("Unauthorized", 403, headers);
  }

  if (staff.role === "BranchManager" && staff.branch_id !== pkg.branch_id) {
    return errorResponse("Can only update packages in your branch", 403, headers);
  }

  const { data, error } = await supabase
    .from("packages")
    .update(body)
    .eq("id", packageId)
    .select()
    .single();

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse(data, 200, headers);
}

async function deletePackage(packageId: string, supabase: any, user: any, headers: any) {
  const { data: pkg } = await supabase
    .from("packages")
    .select("branch_id")
    .eq("id", packageId)
    .single();

  if (!pkg) {
    return errorResponse("Package not found", 404, headers);
  }

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, branch_id")
    .eq("id", user.id)
    .single();

  if (!staff || !["SuperAdmin", "OrgAdmin", "BranchManager"].includes(staff.role)) {
    return errorResponse("Unauthorized", 403, headers);
  }

  if (staff.role === "BranchManager" && staff.branch_id !== pkg.branch_id) {
    return errorResponse("Can only delete packages in your branch", 403, headers);
  }

  const { error } = await supabase
    .from("packages")
    .update({ status: "suspended" })
    .eq("id", packageId);

  if (error) {
    return errorResponse(error.message, 400, headers);
  }

  return successResponse({ message: "Package deleted" }, 200, headers);
}

async function purchasePackage(req: Request, supabase: any, user: any, headers: any) {
  const body = await req.json();
  const { package_id, payment_method } = body;

  if (!package_id) {
    return errorResponse("Missing package_id", 400, headers);
  }

  if (!payment_method || !["Card", "Wallet"].includes(payment_method)) {
    return errorResponse("Invalid payment_method", 400, headers);
  }

  try {
    // Get package details
    const { data: pkg } = await supabase
      .from("packages")
      .select("*")
      .eq("id", package_id)
      .eq("status", "active")
      .single();

    if (!pkg) {
      return errorResponse("Package not found", 404, headers);
    }

    // Get branch for tax calculation
    const { data: branch } = await supabase
      .from("branches")
      .select("tax_enabled, tax_rate_percent, default_currency")
      .eq("id", pkg.branch_id)
      .single();

    // Calculate tax
    const tax = calculateTax(pkg.price, branch.tax_enabled, branch.tax_rate_percent);
    const totalAmount = pkg.price + tax.amount;

    // Check wallet if payment_method is Wallet
    if (payment_method === "Wallet") {
      const { data: wallet } = await supabase
        .from("wallets")
        .select("balance")
        .eq("member_id", user.id)
        .single();

      if (!wallet || wallet.balance < totalAmount) {
        return errorResponse("Insufficient wallet balance", 402, headers);
      }

      // Debit wallet
      await supabase
        .from("wallet_debits")
        .insert({
          member_id: user.id,
          reason: "PackagePurchase",
          amount: totalAmount,
          balance_after: wallet.balance - totalAmount,
          reference: `Package purchase: ${pkg.name}`,
          member_package_id: null // Will be set after creating MemberPackage
        });

      await supabase
        .from("wallets")
        .update({ balance: wallet.balance - totalAmount })
        .eq("member_id", user.id);
    }

    // Create MemberPackage
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + pkg.valid_days);

    const { data: memberPackage, error: mpError } = await supabase
      .from("member_packages")
      .insert({
        member_id: user.id,
        package_id,
        sessions_remaining: pkg.sessions_included,
        hours_remaining: pkg.hours_included,
        expires_at: expiresAt.toISOString(),
        status: "active"
      })
      .select()
      .single();

    if (mpError) {
      return errorResponse(mpError.message, 400, headers);
    }

    // Create Payment record
    const { data: payment, error: payError } = await supabase
      .from("payments")
      .insert({
        member_package_id: memberPackage.id,
        purpose: "package_purchase",
        amount: totalAmount,
        tax_amount: tax.amount,
        currency: branch.default_currency,
        provider: payment_method === "Wallet" ? "wallet" : "card",
        status: payment_method === "Wallet" ? "paid" : "pending"
      })
      .select()
      .single();

    if (payError) {
      return errorResponse(payError.message, 400, headers);
    }

    return successResponse({
      member_package: memberPackage,
      payment: payment,
      message: "Package purchased successfully"
    }, 201, headers);
  } catch (error) {
    return errorResponse(error.message, 500, headers);
  }
}

function calculateTax(price: number, taxEnabled: boolean, taxRate: number) {
  if (!taxEnabled || price === 0) {
    return { rate_percent: 0, amount: 0 };
  }

  const taxAmount = Math.round(price * (taxRate / 100) * 100) / 100;
  return { rate_percent: taxRate, amount: taxAmount };
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
