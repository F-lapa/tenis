import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT = path.resolve("data/ranking.json");
const ATP_URL = "https://www.atptour.com/en/rankings/singles?rankRange=1-1000";
const TEXT_URLS = [
  "https://r.jina.ai/https://www.atptour.com/en/rankings/singles?rankRange=1-1000",
  "https://r.jina.ai/http://www.atptour.com/en/rankings/singles?rankRange=1-1000"
];

function number(value) {
  return Number(String(value ?? "").replace(/[^\d]/g, "")) || 0;
}

function clean(value) {
  return String(value ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRanking(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map(l => l.trim()).filter(Boolean);
  const players = [];
  const seen = new Set();

  for (const line of lines) {
    if (!line.includes("|")) continue;
    const cells = line.split("|").map(clean).filter(Boolean);
    if (cells.length < 3) continue;

    const rankIndex = cells.findIndex(c => /^\d{1,4}$/.test(c.replace(/[^\d]/g, "")));
    if (rankIndex < 0) continue;

    const rank = number(cells[rankIndex]);
    if (!rank || seen.has(rank)) continue;

    let name = "";
    let country = "";
    let points = 0;

    for (let i = rankIndex + 1; i < cells.length; i++) {
      const cell = cells[i];

      if (!name && /[A-Za-zÀ-ÿ]/.test(cell) && !/^(rank|player|age|official points)$/i.test(cell)) {
        name = cell;
        continue;
      }

      if (name && !country && /^[A-Z]{3}$/.test(cell)) {
        country = cell;
        continue;
      }

      if (name && /^[\d,.]+$/.test(cell)) {
        points = number(cell);
        if (points > 0) break;
      }
    }

    if (!name || !points) continue;

    seen.add(rank);
    players.push({ rank, name, country, points });
  }

  return players.sort((a, b) => a.rank - b.rank);
}

function validate(players) {
  if (!Array.isArray(players) || players.length < 50) {
    throw new Error(`Tabela incompleta: ${players?.length || 0} jogadores.`);
  }

  for (let i = 0; i < 10; i++) {
    if (!players[i] || players[i].rank !== i + 1 || !players[i].name || players[i].points <= 0) {
      throw new Error(`Top 10 inválido na posição ${i + 1}.`);
    }
  }
}

async function fetchText() {
  let lastError;

  for (const url of TEXT_URLS) {
    try {
      const response = await fetch(`${url}&_=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "text/plain,*/*", "User-Agent": "Fernando-Lapa-Dashboard/2.0" }
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();

      if (!/ATP Rankings|Official Points|PIF ATP/i.test(text)) {
        throw new Error("Resposta não reconhecida como ranking ATP");
      }

      return text;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Nenhuma fonte respondeu");
}

try {
  const text = await fetchText();
  const players = parseRanking(text);
  validate(players);

  const payload = {
    source: "ATP Tour oficial",
    sourceUrl: ATP_URL,
    updatedAt: new Date().toISOString(),
    rankingDate: new Date().toISOString(),
    count: players.length,
    players
  };

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Ranking atualizado com ${players.length} jogadores.`);
} catch (error) {
  console.error("Atualização rejeitada. O ranking anterior foi preservado.");
  console.error(error);
  process.exitCode = 1;
}
