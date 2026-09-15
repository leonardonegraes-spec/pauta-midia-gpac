// Envia, uma vez por dia, um e-mail para cada pessoa do time com as pautas dela
// (atrasadas + desta semana) e, junto, um resumo do total do time. Rodado pelo
// GitHub Actions (.github/workflows/daily-digest.yml); nunca precisa da página
// aberta em lugar nenhum.

import admin from "firebase-admin";
import nodemailer from "nodemailer";

const TEAM = ["Bella", "Eduardo", "Anna", "Leonardo", "Rejane"];
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

function toIsoDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function startOfWeekMonday(d) {
  const wd = (d.getDay() + 6) % 7; // 0 = segunda
  const r = new Date(d);
  r.setDate(d.getDate() - wd);
  return r;
}

function endOfWeekSunday(monday) {
  const r = new Date(monday);
  r.setDate(monday.getDate() + 6);
  return r;
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

function buildIndividualHtml(person, items, planos, today) {
  if (!items.length) {
    return `<p style="color:#666B58;font-size:13px;">Nenhuma pendência sua até o fim desta semana. 🎉</p>`;
  }
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
  return `<table style="width:100%;border-collapse:collapse;">${rows}</table>`;
}

function statusBlockHtml(label, color, items, planos) {
  if (!items.length) return "";
  items.sort((a, b) => a.date.localeCompare(b.date));
  const rows = items.map((d) => {
    const campanha = campanhaLabel(d, planos);
    return `
      <tr>
        <td style="padding:4px 10px 4px 0;font-size:12px;color:#52690E;font-weight:700;white-space:nowrap;">${escapeHtml(campanha || "—")}</td>
        <td style="padding:4px 10px;font-size:12px;color:#21241B;">${escapeHtml(d.title)}</td>
        <td style="padding:4px 0;font-size:12px;color:#666B58;text-align:right;white-space:nowrap;">${formatPrazo(d.date)}</td>
      </tr>`;
  }).join("");
  return `
    <tr><td colspan="3" style="font-size:10.5px;color:${color};text-transform:uppercase;font-weight:700;letter-spacing:.3px;padding:8px 0 2px;">${label}</td></tr>
    ${rows}`;
}

function buildTeamSummaryHtml(weekDemandas, planos) {
  const byPerson = {};
  TEAM.forEach((name) => { byPerson[name] = { pendente: [], producao: [] }; });
  const unassigned = { pendente: [], producao: [] };

  weekDemandas.forEach((d) => {
    if (d.status === "concluido") return; // total do time não mostra concluído
    const bucket = d.status === "producao" ? "producao" : "pendente";
    if (d.responsavel) {
      if (!byPerson[d.responsavel]) byPerson[d.responsavel] = { pendente: [], producao: [] };
      byPerson[d.responsavel][bucket].push(d);
    } else {
      unassigned[bucket].push(d);
    }
  });
  if (unassigned.pendente.length || unassigned.producao.length) byPerson["Não atribuído"] = unassigned;

  const sections = Object.entries(byPerson).map(([name, c]) => {
    const hasItems = c.pendente.length || c.producao.length;
    const body = hasItems
      ? `<table style="width:100%;border-collapse:collapse;">${statusBlockHtml("Pendente", "#8C6208", c.pendente, planos)}${statusBlockHtml("Em produção", "#2160C4", c.producao, planos)}</table>`
      : `<p style="color:#9BA089;font-size:12px;margin:2px 0 0;">Sem pendências nesta semana.</p>`;
    return `
      <div style="margin-bottom:16px;">
        <div style="font-weight:700;color:#21241B;font-size:14px;border-bottom:2px solid #E4E6DC;padding-bottom:3px;margin-bottom:4px;">${escapeHtml(name)}</div>
        ${body}
      </div>`;
  }).join("");

  return `
    <h3 style="color:#21241B;font-size:15px;margin:22px 0 10px;">Total do time — esta semana</h3>
    ${sections}`;
}

function buildEmailHtml(person, personItems, weekDemandas, planos, today) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;">
    <h2 style="color:#21241B;font-size:18px;margin-bottom:4px;">Sua pauta de hoje, ${escapeHtml(person)}</h2>
    <p style="color:#666B58;font-size:13px;margin-top:0;">
      Atrasadas + o que vence até domingo desta semana.
    </p>
    ${buildIndividualHtml(person, personItems, planos, today)}
    ${buildTeamSummaryHtml(weekDemandas, planos)}
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
  const weekEndIso = toIsoDate(endOfWeekSunday(startOfWeekMonday(today)));
  const todayIso = toIsoDate(today);

  const allDemandas = demandasSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  // Escopo do relatório: tudo que já está atrasado, mais o que vence até o fim desta semana.
  const weekDemandas = allDemandas.filter((d) => d.date <= weekEndIso);

  const byPerson = {};
  weekDemandas.forEach((d) => {
    if (d.status === "concluido") return; // a lista individual mostra só o que precisa de ação
    if (!d.responsavel) return; // sem responsável não tem para quem mandar individualmente
    (byPerson[d.responsavel] = byPerson[d.responsavel] || []).push(d);
  });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailAppPassword },
  });

  let sent = 0;
  for (const [person, email] of Object.entries(teamEmails)) {
    const items = (byPerson[person] || []).sort((a, b) => a.date.localeCompare(b.date));
    const html = buildEmailHtml(person, items, weekDemandas, planos, today);
    await transporter.sendMail({
      from: `Pauta de Mídia GPAC <${gmailUser}>`,
      to: email,
      subject: `📋 Sua pauta da semana — ${items.length} pendente${items.length === 1 ? "" : "s"} + total do time`,
      html,
    });
    console.log(`Enviado para ${person} <${email}> — ${items.length} pauta(s) individual(is).`);
    sent++;
  }
  console.log(`Concluído. ${sent} e-mail(s) enviado(s). Escopo: até ${weekEndIso} (hoje ${todayIso}).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
