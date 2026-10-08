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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // This disables email confirmation requirement in auth schema
    const { error } = await supabase.rpc('set_email_confirmation_disabled', {
      disabled: true
    }).single();

    if (error) {
      return new Response(JSON.stringify({
        message: "Email confirmation already disabled or setting not available",
        note: "See Supabase Dashboard > Authentication > Providers > Email"
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      message: "Email confirmation disabled successfully"
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({
      message: "Email confirmation cannot be disabled via API",
      solution: "Please disable in Supabase Dashboard: Authentication > Providers > Email > Require email confirmation (toggle OFF)"
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
