// Edge Function "gav-chat" — proxy sécurisé entre le widget de chat sur
// gav/video/index.html et l'API Claude.
//
// - Reçoit { conversationId, message } d'un visiteur anonyme du site.
// - Charge l'historique de la conversation depuis Postgres (pas depuis le
//   client, pour ne pas pouvoir être falsifié).
// - Appelle Claude avec le contexte des règles (rules-context.ts) comme
//   system prompt.
// - Persiste les deux messages (user + assistant) en base via la clé
//   service role (qui contourne RLS — seule cette fonction peut écrire).
//
// Déploiement : npx supabase functions deploy gav-chat
// Secret requis : npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont injectées automatiquement
// par la plateforme, pas besoin de les définir.)

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { createClient } from "npm:@supabase/supabase-js@2";
import { RULES_CONTEXT } from "./rules-context.ts";

const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 1024;
const MAX_MESSAGE_LENGTH = 500;
const MAX_MESSAGES_PER_CONVERSATION = 30; // user + assistant confondus
const MAX_CONVERSATIONS_PER_IP_PER_HOUR = 5;
const MAX_QUESTIONS_PER_IP_PER_5MIN = 15;
const HISTORY_TURNS = 20; // derniers messages relus pour le contexte multi-tours

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const SYSTEM_INSTRUCTIONS = `Tu es l'assistant de règles du jeu de société GAV, sur la page fiascogames.fr/gav/video. Tu réponds aux questions des visiteurs à partir du contexte de règles fourni ci-dessous. Réponds en français, de façon concise (2 à 4 phrases dans la majorité des cas). Ne réponds qu'à des questions sur le jeu GAV ; pour toute autre demande, dis-le poliment et renvoie vers https://fiascogames.fr/gav/#faq ou contact@fiascogames.fr. Si le contexte ne permet pas de répondre avec certitude, dis-le plutôt que d'inventer une règle.

Contexte des règles de GAV :
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Méthode non supportée." }, 405);
  }

  let body: { conversationId?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Corps de requête invalide." }, 400);
  }

  const conversationId = body.conversationId;
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) {
    return jsonResponse({ error: "Identifiant de conversation invalide." }, 400);
  }
  if (!message) {
    return jsonResponse({ error: "Message vide." }, 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return jsonResponse(
      { error: `Message trop long (max ${MAX_MESSAGE_LENGTH} caractères).` },
      400,
    );
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    console.error("ANTHROPIC_API_KEY manquante.");
    return jsonResponse({ error: "Service indisponible pour le moment." }, 500);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  const clientIp = forwardedFor.split(",")[0].trim() || null;
  const userAgent = req.headers.get("user-agent") ?? null;

  // --- Garde-fous anti-abus ---------------------------------------------
  if (clientIp) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentConversations } = await supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("client_ip", clientIp)
      .gte("created_at", oneHourAgo);
    if ((recentConversations ?? 0) >= MAX_CONVERSATIONS_PER_IP_PER_HOUR) {
      return jsonResponse(
        { error: "Trop de nouvelles conversations depuis cette adresse. Réessayez plus tard." },
        429,
      );
    }

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    // Ne compte que les questions (role "user") : chaque question insère
    // aussi une réponse "assistant", donc compter les deux rôles diviserait
    // par deux la limite réelle sans que ce soit voulu.
    const { count: recentQuestions } = await supabase
      .from("messages")
      .select("id, conversations!inner(client_ip)", { count: "exact", head: true })
      .eq("conversations.client_ip", clientIp)
      .eq("role", "user")
      .gte("created_at", fiveMinAgo);
    if ((recentQuestions ?? 0) >= MAX_QUESTIONS_PER_IP_PER_5MIN) {
      return jsonResponse(
        { error: "Trop de questions envoyées en peu de temps. Patientez quelques minutes." },
        429,
      );
    }
  }

  // --- Récupère ou crée la conversation ----------------------------------
  const { data: existing } = await supabase
    .from("conversations")
    .select("id, message_count, status")
    .eq("id", conversationId)
    .maybeSingle();

  if (existing?.status === "blocked") {
    return jsonResponse({ error: "Cette conversation n'est plus disponible." }, 403);
  }
  if ((existing?.message_count ?? 0) >= MAX_MESSAGES_PER_CONVERSATION) {
    return jsonResponse(
      { error: "Cette conversation a atteint sa limite de messages. Rechargez la page pour en démarrer une nouvelle." },
      429,
    );
  }

  if (!existing) {
    const { error: insertConvError } = await supabase.from("conversations").insert({
      id: conversationId,
      game: "gav",
      client_ip: clientIp,
      user_agent: userAgent,
    });
    if (insertConvError) {
      console.error("Erreur création conversation:", insertConvError);
      return jsonResponse({ error: "Impossible de démarrer la conversation." }, 500);
    }
  }

  // --- Historique (source de vérité = la base, pas le client) -----------
  const { data: historyRows } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(HISTORY_TURNS * 2);

  const { error: insertUserMsgError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: message,
  });
  if (insertUserMsgError) {
    console.error("Erreur insertion message user:", insertUserMsgError);
    return jsonResponse({ error: "Impossible d'enregistrer le message." }, 500);
  }

  const claudeMessages: Anthropic.MessageParam[] = [
    ...(historyRows ?? []).map((row) => ({
      role: row.role as "user" | "assistant",
      content: row.content as string,
    })),
    { role: "user", content: message },
  ];

  // --- Appel Claude --------------------------------------------------------
  const client = new Anthropic({ apiKey: anthropicKey });

  let replyText: string;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: SYSTEM_INSTRUCTIONS + RULES_CONTEXT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: claudeMessages,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    replyText = textBlock?.type === "text"
      ? textBlock.text
      : "Désolé, je n'ai pas pu formuler de réponse.";
  } catch (err) {
    console.error("Erreur appel Claude:", err);
    return jsonResponse(
      { error: "L'assistant est momentanément indisponible. Réessayez dans un instant." },
      502,
    );
  }

  const newMessageCount = (existing?.message_count ?? 0) + 2;
  const { error: insertAssistantMsgError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: replyText,
  });
  if (insertAssistantMsgError) {
    console.error("Erreur insertion message assistant:", insertAssistantMsgError);
  }

  await supabase
    .from("conversations")
    .update({
      message_count: newMessageCount,
      last_message_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  return jsonResponse({
    conversationId,
    reply: replyText,
    messageCount: newMessageCount,
  });
});
