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

// Uma pauta pode ter mais de uma pessoa (mesma lógica do app). Docs antigos só
// tinham "responsavel" (string única) — continuam funcionando normalmente.
function getResponsaveis(d) {
  if (d.responsaveis && d.responsaveis.length) return d.responsaveis;
  if (d.responsavel) return [d.responsavel];
  return [];
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function buildIndividualHtml(items, planos, today, emptyMessage) {
  if (!items.length) {
    return `<p style="color:#666B58;font-size:13px;line-height:1.6;">${emptyMessage}</p>`;
  }
  const rows = items.map((d) => {
    const dias = daysDiff(d.date, today);
    const late = dias < 0 && d.status !== "concluido";
    const color = late ? "#B23A2F" : dias <= 1 ? "#8C6208" : "#21241B";
    const campanha = campanhaLabel(d, planos);
    const pracas = campanhaPracas(d, planos).join(", ");
    return `
      <tr>
        <td style="padding:16px 14px;border-bottom:1px solid #E4E6DC;">
          <div style="font-weight:700;color:#21241B;font-size:14px;line-height:1.4;">${escapeHtml(d.title)}</div>
          ${campanha ? `<div style="color:#52690E;font-size:12px;font-weight:700;margin-top:5px;">${escapeHtml(campanha)}</div>` : ""}
          ${pracas ? `<div style="color:#666B58;font-size:12px;margin-top:4px;line-height:1.5;">${escapeHtml(pracas)}</div>` : ""}
        </td>
        <td style="padding:16px 14px;border-bottom:1px solid #E4E6DC;text-align:right;white-space:nowrap;vertical-align:top;">
          <div style="color:${color};font-weight:700;font-size:13px;">${prazoTexto(dias)}</div>
          <div style="color:#9BA089;font-size:11px;margin-top:4px;">${formatPrazo(d.date)}</div>
          <div style="color:#666B58;font-size:11px;margin-top:4px;">${STATUS_LABEL[d.status] || "Pendente"}</div>
        </td>
      </tr>`;
  }).join("");
  return `<table style="width:100%;border-collapse:collapse;">${rows}</table>`;
}

function statusBlockHtml(label, color, bgColor, items, planos) {
  if (!items.length) return "";
  items.sort((a, b) => a.date.localeCompare(b.date));
  const rows = items.map((d) => {
    const campanha = campanhaLabel(d, planos);
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #ECEEE5;font-size:12.5px;color:#52690E;font-weight:700;white-space:nowrap;vertical-align:top;">${escapeHtml(campanha || "—")}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #ECEEE5;font-size:12.5px;color:#21241B;line-height:1.5;vertical-align:top;">${escapeHtml(d.title)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #ECEEE5;font-size:12.5px;color:#666B58;text-align:right;white-space:nowrap;vertical-align:top;">${formatPrazo(d.date)}</td>
      </tr>`;
  }).join("");
  return `
    <div style="margin-top:14px;">
      <div style="display:inline-block;background:${bgColor};color:${color};font-size:10.5px;text-transform:uppercase;font-weight:700;letter-spacing:.4px;padding:4px 10px;border-radius:10px;margin-bottom:8px;">${label}</div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
    </div>`;
}

function buildTeamSummaryHtml(title, demandas, planos) {
  const byPerson = {};
  TEAM.forEach((name) => { byPerson[name] = { pendente: [], producao: [] }; });
  const unassigned = { pendente: [], producao: [] };

  demandas.forEach((d) => {
    if (d.status === "concluido") return; // total do time não mostra concluído
    const bucket = d.status === "producao" ? "producao" : "pendente";
    const resp = getResponsaveis(d);
    if (resp.length) {
      resp.forEach((person) => {
        if (!byPerson[person]) byPerson[person] = { pendente: [], producao: [] };
        byPerson[person][bucket].push(d);
      });
    } else {
      unassigned[bucket].push(d);
    }
  });
  if (unassigned.pendente.length || unassigned.producao.length) byPerson["Não atribuído"] = unassigned;

  const sections = Object.entries(byPerson).map(([name, c]) => {
    const hasItems = c.pendente.length || c.producao.length;
    const body = hasItems
      ? `${statusBlockHtml("Pendente", "#8C6208", "#F5EED9", c.pendente, planos)}${statusBlockHtml("Em produção", "#2160C4", "#E3EDFB", c.producao, planos)}`
      : `<p style="color:#9BA089;font-size:12.5px;margin:0;">Sem pendências neste período.</p>`;
    return `
      <div style="background:#F4F5EF;border:1px solid #E4E6DC;border-radius:12px;padding:18px 20px;margin-bottom:16px;">
        <div style="font-weight:700;color:#21241B;font-size:15px;">${escapeHtml(name)}</div>
        ${body}
      </div>`;
  }).join("");

  return `
    <h3 style="color:#21241B;font-size:16px;margin:0 0 16px;">${title}</h3>
    ${sections}`;
}

const DIVIDER = `<div style="border-top:1px solid #E4E6DC;margin:28px 0 24px;"></div>`;
const DIVIDER_WIDE = `<div style="border-top:1px solid #E4E6DC;margin:32px 0 24px;"></div>`;

// recipient: { email, person: string|null, individual: bool, team: bool }
function buildEmailHtml(recipient, ctx) {
  const { byPersonWeek, byPersonFuture, weekDemandas, futureDemandas, planos, today } = ctx;
  const blocks = [];

  if (recipient.individual && recipient.person) {
    const weekItems = (byPersonWeek[recipient.person] || []).sort((a, b) => a.date.localeCompare(b.date));
    const futureItems = (byPersonFuture[recipient.person] || []).sort((a, b) => a.date.localeCompare(b.date));
    blocks.push(`
      <h2 style="color:#21241B;font-size:19px;margin:0 0 6px;">Sua pauta desta semana, ${escapeHtml(recipient.person)}</h2>
      <p style="color:#666B58;font-size:13px;margin:0 0 20px;line-height:1.6;">Atrasadas + o que vence até domingo desta semana.</p>
      ${buildIndividualHtml(weekItems, planos, today, "Nenhuma pendência sua até o fim desta semana. 🎉")}
      ${DIVIDER}
      <h2 style="color:#21241B;font-size:17px;margin:0 0 6px;">Próxima semana em diante</h2>
      <p style="color:#666B58;font-size:13px;margin:0 0 20px;line-height:1.6;">O que vem depois de domingo — ainda sem urgência.</p>
      ${buildIndividualHtml(futureItems, planos, today, "Nada agendado para depois desta semana ainda.")}
    `);
  }

  if (recipient.individual && recipient.team) blocks.push(DIVIDER_WIDE);

  if (recipient.team) {
    if (!recipient.individual) {
      blocks.push(`<h2 style="color:#21241B;font-size:19px;margin:0 0 20px;">Pauta da semana — Total do time</h2>`);
    }
    blocks.push(buildTeamSummaryHtml("Total do time — esta semana", weekDemandas, planos));
    blocks.push(DIVIDER);
    blocks.push(buildTeamSummaryHtml("Total do time — próxima semana em diante", futureDemandas, planos));
  }

  blocks.push(`
    <p style="color:#9BA089;font-size:11px;margin-top:24px;">
      Board completo: https://leonardonegraes-spec.github.io/pauta-midia-gpac/
    </p>`);
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:28px 24px;background:#FAFAF7;">${blocks.join("")}</div>`;
}

// Cron "0 21 * * *" = 18:00 em Brasília (o outro horário, "0 11 * * *" = 08h, não filtra
// ninguém). Rodadas manuais (workflow_dispatch) não têm RUN_SCHEDULE — tratadas como 08h
// (envia para todo mundo), já que são disparos avulsos de teste, não a rotina do fim de dia.
const EVENING_CRON = "0 21 * * *";

async function main() {
  const serviceAccount = JSON.parse(requireEnv("FIREBASE_SERVICE_ACCOUNT"));
  const allRecipients = JSON.parse(requireEnv("TEAM_EMAILS")); // array de {email, person, individual, team, schedule?}
  const gmailUser = requireEnv("GMAIL_USER");
  const gmailAppPassword = requireEnv("GMAIL_APP_PASSWORD");

  const isEveningRun = process.env.RUN_SCHEDULE === EVENING_CRON;
  // schedule: "morning" só recebe a rodada das 08h (ex: gestores que só querem o resumo da manhã).
  const recipients = allRecipients.filter((r) => !(isEveningRun && r.schedule === "morning"));
  console.log(`Rodada ${isEveningRun ? "da noite (18h)" : "da manhã (08h) ou manual"} — ${recipients.length} de ${allRecipients.length} destinatário(s) nesta rodada.`);

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

  // Dois recortes: "esta semana" (atrasadas + até domingo) e "próxima semana em diante".
  const weekDemandas = allDemandas.filter((d) => d.date <= weekEndIso);
  const futureDemandas = allDemandas.filter((d) => d.date > weekEndIso);

  function groupByPerson(demandas) {
    const byPerson = {};
    demandas.forEach((d) => {
      if (d.status === "concluido") return; // a lista individual mostra só o que precisa de ação
      getResponsaveis(d).forEach((person) => {
        (byPerson[person] = byPerson[person] || []).push(d);
      });
    });
    return byPerson;
  }
  const byPersonWeek = groupByPerson(weekDemandas);
  const byPersonFuture = groupByPerson(futureDemandas);

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailAppPassword },
  });

  const ctx = { byPersonWeek, byPersonFuture, weekDemandas, futureDemandas, planos, today };
  const subjectDate = String(today.getDate()).padStart(2, "0") + "/" + String(today.getMonth() + 1).padStart(2, "0");
  const subject = `ADEMICON I PAUTA DA MÍDIA - ${subjectDate}`;

  let sent = 0;
  for (const r of recipients) {
    const html = buildEmailHtml(r, ctx);
    const weekCount = r.person ? (byPersonWeek[r.person] || []).length : 0;
    const futureCount = r.person ? (byPersonFuture[r.person] || []).length : 0;
    await transporter.sendMail({
      from: `Pauta de Mídia GPAC <${gmailUser}>`,
      to: r.email,
      subject,
      html,
    });
    console.log(`Enviado para ${r.person || "(sem pessoa)"} <${r.email}> — individual:${r.individual} team:${r.team} — ${weekCount} esta semana, ${futureCount} depois.`);
    sent++;
  }
  console.log(`Concluído. ${sent} e-mail(s) enviado(s). Corte da semana: ${weekEndIso} (hoje ${todayIso}).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
