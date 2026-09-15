// Envia, uma vez por dia, um e-mail para cada pessoa do time com as pautas
// pendentes atribuídas a ela — quantos dias faltam (ou quanto está atrasada).
// Rodado pelo GitHub Actions (.github/workflows/daily-digest.yml); nunca precisa
// da página aberta em lugar nenhum.

import admin from "firebase-admin";
import nodemailer from "nodemailer";

const STATUS_LABEL = { pendente: "Pendente", producao: "Em produção", concluido: "Concluído" };

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Variável de ambiente ausente: ${name}`); process.exit(1); }
  return v;
}

function todayAtMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysDiff(dateStr, today) {
  const d = new Date(dateStr + "T00:00:00");
  return Math.round((d - today) / 86400000);
}

function formatPrazo(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function prazoTexto(dias) {
  if (dias < 0) return `atrasada há ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? "" : "s"}`;
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  return `faltam ${dias} dias`;
}

function campanhaLabel(d, planos) {
  if (!d.planoKey) return "";
  return planos[d.planoKey] ? planos[d.planoKey].nome : d.planoKey;
}

function campanhaPracas(d, planos) {
  if (d.pracas && d.pracas.length) return d.pracas;
  if (!d.planoKey) return [];
  return planos[d.planoKey] ? planos[d.planoKey].pracas : [];
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function buildEmailHtml(person, items, planos, today) {
  const rows = items.map((d) => {
    const dias = daysDiff(d.date, today);
    const late = dias < 0 && d.status !== "concluido";
    const color = late ? "#B23A2F" : dias <= 1 ? "#8C6208" : "#21241B";
    const campanha = campanhaLabel(d, planos);
    const pracas = campanhaPracas(d, planos).join(", ");
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #E4E6DC;">
          <div style="font-weight:700;color:#21241B;font-size:14px;">${escapeHtml(d.title)}</div>
          ${campanha ? `<div style="color:#52690E;font-size:12px;font-weight:700;margin-top:2px;">${escapeHtml(campanha)}</div>` : ""}
          ${pracas ? `<div style="color:#666B58;font-size:12px;margin-top:2px;">${escapeHtml(pracas)}</div>` : ""}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #E4E6DC;text-align:right;white-space:nowrap;">
          <div style="color:${color};font-weight:700;font-size:13px;">${prazoTexto(dias)}</div>
          <div style="color:#9BA089;font-size:11px;">${formatPrazo(d.date)}</div>
          <div style="color:#666B58;font-size:11px;margin-top:2px;">${STATUS_LABEL[d.status] || "Pendente"}</div>
        </td>
      </tr>`;
  }).join("");

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;">
    <h2 style="color:#21241B;font-size:18px;">Sua pauta de hoje, ${escapeHtml(person)}</h2>
    <p style="color:#666B58;font-size:13px;">
      Você tem ${items.length} pauta${items.length === 1 ? "" : "s"} pendente${items.length === 1 ? "" : "s"}.
    </p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
    <p style="color:#9BA089;font-size:11px;margin-top:18px;">
      Board completo: https://leonardonegraes-spec.github.io/pauta-midia-gpac/
    </p>
  </div>`;
}

async function main() {
  const serviceAccount = JSON.parse(requireEnv("FIREBASE_SERVICE_ACCOUNT"));
  const teamEmails = JSON.parse(requireEnv("TEAM_EMAILS"));
  const gmailUser = requireEnv("GMAIL_USER");
  const gmailAppPassword = requireEnv("GMAIL_APP_PASSWORD");

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const [demandasSnap, planosSnap] = await Promise.all([
    db.collection("demandas").get(),
    db.collection("planos").get(),
  ]);

  const planos = {};
  planosSnap.forEach((doc) => { planos[doc.id] = doc.data(); });

  const today = todayAtMidnight();
  const byPerson = {};
  demandasSnap.forEach((doc) => {
    const d = { id: doc.id, ...doc.data() };
    if (d.status === "concluido") return; // só o que ainda precisa de atenção
    if (!d.responsavel) return; // sem responsável não tem para quem mandar
    (byPerson[d.responsavel] = byPerson[d.responsavel] || []).push(d);
  });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailAppPassword },
  });

  let sent = 0;
  for (const [person, items] of Object.entries(byPerson)) {
    const email = teamEmails[person];
    if (!email) { console.warn(`Sem e-mail cadastrado para "${person}" — pulando.`); continue; }
    items.sort((a, b) => a.date.localeCompare(b.date));
    const html = buildEmailHtml(person, items, planos, today);
    await transporter.sendMail({
      from: `Pauta de Mídia GPAC <${gmailUser}>`,
      to: email,
      subject: `📋 Sua pauta de hoje — ${items.length} pendente${items.length === 1 ? "" : "s"}`,
      html,
    });
    console.log(`Enviado para ${person} <${email}> — ${items.length} pauta(s).`);
    sent++;
  }
  console.log(`Concluído. ${sent} e-mail(s) enviado(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
