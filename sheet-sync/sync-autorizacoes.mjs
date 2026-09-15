// Espelha diariamente a planilha de controle de autorização de mídia (PI/AP/RM/Checking)
// para a coleção "autorizacoes" no Firestore. É um sistema separado da pauta: não mexe
// em "demandas", não tem edição pela plataforma — a cada rodada apaga tudo e regrava do
// zero a partir da planilha, que é sempre a fonte da verdade.
import admin from "firebase-admin";

const SHEET_ID = "14mnEuB9Anv-uczrpHC14rOquObKZedSv4sADMgmnb7A";
const GID = "1544070047";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normalizeDate(s) {
  s = (s || "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function fetchCsv() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error("Falha ao baixar a planilha: " + res.status);
  return await res.text();
}

function parseRows(raw) {
  const rows = parseCsv(raw);
  const header = rows[1]; // linha 1 é lixo, linha 2 é o cabeçalho real
  const COL = {};
  header.forEach((h, i) => { COL[h.trim()] = i; });

  let carry = { cliente: "", centroCusto: "", campanha: "", praca: "" };
  const parsed = [];

  for (let r = 2; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c || !c.trim())) continue;

    const get = (name) => (row[COL[name]] || "").trim();

    // Forward-fill: linhas sem CLIENTE pertencem ao grupo/campanha da última linha que tinha.
    if (get("CLIENTE")) {
      carry = {
        cliente: get("CLIENTE"),
        centroCusto: get("CENTRO DE CUSTO"),
        campanha: get("CAMPANHA"),
        praca: get("PRAÇA"),
      };
    } else {
      if (get("CENTRO DE CUSTO")) carry.centroCusto = get("CENTRO DE CUSTO");
      if (get("CAMPANHA")) carry.campanha = get("CAMPANHA");
      if (get("PRAÇA")) carry.praca = get("PRAÇA");
    }
    if (!carry.cliente && !carry.campanha) continue; // linha sem nenhum contexto — lixo

    const numAp = get("N° AP");
    const numPi = get("Nº PI");
    const id = numAp ? `ap-${numAp}` : (numPi ? `pi-${numPi}-${r}` : `row-${r}`);

    parsed.push({
      id,
      cliente: carry.cliente,
      centroCusto: carry.centroCusto,
      campanha: carry.campanha,
      praca: carry.praca,
      veiculo: get("VEÍCULO"),
      contato: get("CONTATO"),
      formato: get("FORMATO"),
      veiculacao: get("VEICULAÇÃO"),
      publi: get("PUBLI"),
      numPi: numPi || null,
      piEnviado: normalizeDate(get("PI ENVIADO")),
      piRecebido: normalizeDate(get("PI RECEBIDO")),
      numAp: numAp || null,
      apEnviada: normalizeDate(get("AP ENVIADA")),
      apAssinada: normalizeDate(get("AP ASSINADA")),
      rmEnviada: normalizeDate(get("RM ENVIADA")),
      dataEnvioMaterialPlanejada: normalizeDate(get("DATA ENVIO MATERIAL PLANEJADA")),
      dataEnvioMaterialRealizada: normalizeDate(get("DATA ENVIO MATERIAL REALIZADA")),
      pp: get("PP"),
      statusMaterial: get("STATUS DE MATERIAL"),
      solicitacaoChecking: normalizeDate(get("SOLICITAÇÃO CHECKING")),
      checkingConfirmado: normalizeDate(get("CHECKING CONFIRMADO")),
      checkingFinal: normalizeDate(get("CHECKING FINAL")),
      financeiro: get("FINANCEIRO"),
      observacao: get("OBSERVAÇÃO"),
    });
  }
  return parsed;
}

async function replaceCollection(db, items) {
  const col = db.collection("autorizacoes");
  const existing = await col.listDocuments();

  for (let i = 0; i < existing.length; i += 400) {
    const batch = db.batch();
    existing.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  for (let i = 0; i < items.length; i += 400) {
    const batch = db.batch();
    items.slice(i, i + 400).forEach((item) => {
      const { id, ...data } = item;
      batch.set(col.doc(id), data);
    });
    await batch.commit();
  }
}

async function main() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const csv = await fetchCsv();
  const items = parseRows(csv);
  console.log(`Linhas parseadas da planilha: ${items.length}`);

  await replaceCollection(db, items);

  await db.collection("meta").doc("autorizacoes_sync").set({
    lastSyncAt: new Date().toISOString(),
    count: items.length,
  });

  console.log(`Sincronizado: ${items.length} autorizações de mídia.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
