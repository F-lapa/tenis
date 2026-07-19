import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT = path.resolve("data/ranking.json");

const RANKINGS_URL =
  "https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_rankings_current.csv";

const PLAYERS_URL =
  "https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_players.csv";

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function onlyNumber(value) {
  return Number(String(value ?? "").replace(/[^\d]/g, "")) || 0;
}

async function downloadText(url) {
  const response = await fetch(`${url}?v=${Date.now()}`, {
    headers: {
      "User-Agent": "Fernando-Lapa-Tennis-Dashboard/1.0",
      Accept: "text/csv,text/plain,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`Falha ao baixar ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

function parsePlayers(text) {
  const map = new Map();
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);

  for (let index = 0; index < lines.length; index++) {
    const cells = parseCsvLine(lines[index]);

    if (cells.length < 6) continue;
    if (index === 0 && /player_id/i.test(cells[0])) continue;

    const playerId = String(cells[0] || "").trim();
    const firstName = String(cells[1] || "").trim();
    const lastName = String(cells[2] || "").trim();
    const country = String(cells[5] || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 3);

    const name = `${firstName} ${lastName}`
      .replace(/\s+/g, " ")
      .trim();

    if (!playerId || !name) continue;

    map.set(playerId, {
      name,
      country,
    });
  }

  return map;
}

function parseRankings(text, playerMap) {
  const rows = [];
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  let latestDate = 0;

  for (let index = 0; index < lines.length; index++) {
    const cells = parseCsvLine(lines[index]);

    if (cells.length < 4) continue;
    if (index === 0 && /ranking_date/i.test(cells[0])) continue;

    const rankingDate = onlyNumber(cells[0]);
    const rank = onlyNumber(cells[1]);
    const playerId = String(cells[2] || "").trim();
    const points = onlyNumber(cells[3]);

    if (!rankingDate || !rank || !playerId) continue;

    latestDate = Math.max(latestDate, rankingDate);

    rows.push({
      rankingDate,
      rank,
      playerId,
      points,
    });
  }

  const players = rows
    .filter((row) => row.rankingDate === latestDate)
    .sort((a, b) => a.rank - b.rank)
    .map((row) => {
      const player = playerMap.get(row.playerId);

      return {
        rank: row.rank,
        name: player?.name || `Jogador ${row.playerId}`,
        country: player?.country || "",
        points: row.points,
      };
    })
    .filter(
      (player) =>
        Number.isInteger(player.rank) &&
        player.rank > 0 &&
        player.name &&
        Number.isFinite(player.points)
    );

  return {
    latestDate,
    players,
  };
}

function formatRankingDate(value) {
  const text = String(value || "");

  if (text.length !== 8) {
    return new Date().toISOString();
  }

  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(
    6,
    8
  )}T00:00:00.000Z`;
}

async function readPreviousRanking() {
  try {
    return JSON.parse(await fs.readFile(OUTPUT, "utf8"));
  } catch {
    return null;
  }
}

try {
  console.log("Baixando cadastro de jogadores...");
  const playersText = await downloadText(PLAYERS_URL);

  console.log("Baixando ranking atual...");
  const rankingsText = await downloadText(RANKINGS_URL);

  const playerMap = parsePlayers(playersText);
  const ranking = parseRankings(rankingsText, playerMap);

  if (playerMap.size < 1000) {
    throw new Error(
      `Cadastro de jogadores inválido: somente ${playerMap.size} registros.`
    );
  }

  if (ranking.players.length < 20) {
    throw new Error(
      `Ranking inválido: somente ${ranking.players.length} jogadores reconhecidos.`
    );
  }

  const payload = {
    source: "Jeff Sackmann / Tennis Abstract",
    sourceUrl: "https://github.com/JeffSackmann/tennis_atp",
    updatedAt: formatRankingDate(ranking.latestDate),
    generatedAt: new Date().toISOString(),
    count: ranking.players.length,
    players: ranking.players,
  };

  await fs.mkdir(path.dirname(OUTPUT), {
    recursive: true,
  });

  await fs.writeFile(
    OUTPUT,
    JSON.stringify(payload, null, 2) + "\n",
    "utf8"
  );

  console.log(
    `Ranking atualizado: ${ranking.players.length} jogadores.`
  );

  console.log(
    `Data do ranking: ${payload.updatedAt}`
  );
} catch (error) {
  const previous = await readPreviousRanking();

  if (previous?.players?.length) {
    console.error(
      "A atualização falhou, mas o ranking anterior foi preservado."
    );
  }

  console.error(error);
  process.exitCode = 1;
}
