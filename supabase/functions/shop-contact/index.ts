// Edge Function "shop-contact" — reçoit les demandes du formulaire
// "Je suis une boutique" / "Boutique" (accueil/index.html, gav/index.html).
//
// - Reçoit { nom, prenom, boutique, email, telephone } d'un visiteur anonyme.
// - Enregistre la demande en base via la clé service role (contourne RLS —
//   seule cette fonction écrit dans shop_requests).
// - Envoie un email de confirmation à la boutique, depuis galane@fiascogames.fr.
// - Envoie un email de notification interne à galane@fiascogames.fr et
//   florian@fiascogames.fr.
//
// Déploiement : npx supabase functions deploy shop-contact
// Secret requis : npx supabase secrets set RESEND_API_KEY=re_...
// (SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont injectées automatiquement
// par la plateforme, pas besoin de les définir.)

import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_FIELD_LENGTH = 200;
const MAX_REQUESTS_PER_IP_PER_HOUR = 5;

const SENDER = "Fiasco Games <galane@fiascogames.fr>";
const INTERNAL_RECIPIENTS = ["galane@fiascogames.fr", "florian@fiascogames.fr"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function cleanField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function sendEmail(resendKey: string, payload: {
  from: string;
  to: string[];
  subject: string;
  text: string;
}) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`Erreur envoi email Resend (${res.status}):`, detail);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Méthode non supportée." }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Corps de requête invalide." }, 400);
  }

  const nom = cleanField(body.nom);
  const prenom = cleanField(body.prenom);
  const boutique = cleanField(body.boutique);
  const email = cleanField(body.email);
  const telephone = cleanField(body.telephone);

  if (!nom || !prenom || !boutique || !email || !telephone) {
    return jsonResponse({ error: "Merci de renseigner tous les champs." }, 400);
  }
  if (
    nom.length > MAX_FIELD_LENGTH ||
    prenom.length > MAX_FIELD_LENGTH ||
    boutique.length > MAX_FIELD_LENGTH ||
    email.length > MAX_FIELD_LENGTH ||
    telephone.length > MAX_FIELD_LENGTH
  ) {
    return jsonResponse({ error: "Un des champs est trop long." }, 400);
  }
  if (!EMAIL_RE.test(email)) {
    return jsonResponse({ error: "Adresse email invalide." }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  const clientIp = forwardedFor.split(",")[0].trim() || null;

  // --- Garde-fou anti-abus -------------------------------------------------
  if (clientIp) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentRequests } = await supabase
      .from("shop_requests")
      .select("id", { count: "exact", head: true })
      .eq("client_ip", clientIp)
      .gte("created_at", oneHourAgo);
    if ((recentRequests ?? 0) >= MAX_REQUESTS_PER_IP_PER_HOUR) {
      return jsonResponse(
        { error: "Trop de demandes envoyées depuis cette adresse. Réessayez plus tard." },
        429,
      );
    }
  }

  const { error: insertError } = await supabase.from("shop_requests").insert({
    nom,
    prenom,
    boutique,
    email,
    telephone,
    client_ip: clientIp,
  });
  if (insertError) {
    console.error("Erreur insertion shop_requests:", insertError);
    return jsonResponse({ error: "Impossible d'enregistrer votre demande." }, 500);
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.error("RESEND_API_KEY manquante : email non envoyé.");
  } else {
    await sendEmail(resendKey, {
      from: SENDER,
      to: [email],
      subject: "Votre demande a bien été reçue - Fiasco Games",
      text:
        `Bonjour ${prenom},\n\n` +
        `Merci pour votre intérêt pour Fiasco Games ! Nous avons bien reçu votre demande pour la boutique "${boutique}".\n\n` +
        `Nous revenons vers vous très rapidement.\n\n` +
        `À bientôt,\nGalane - Fiasco Games`,
    });

    await sendEmail(resendKey, {
      from: SENDER,
      to: INTERNAL_RECIPIENTS,
      subject: `Nouvelle demande boutique : ${boutique}`,
      text:
        `Nouvelle demande reçue via le site :\n\n` +
        `Nom : ${nom}\n` +
        `Prénom : ${prenom}\n` +
        `Boutique : ${boutique}\n` +
        `Email : ${email}\n` +
        `Téléphone : ${telephone}`,
    });
  }

  return jsonResponse({ ok: true });
});
