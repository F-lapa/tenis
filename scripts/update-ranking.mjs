import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT = path.resolve("data/ranking.json");
const API_KEY = process.env.API_TENNIS_KEY;

const API_URL =
  "https://api.api-tennis.com/tennis/?method=get_standings&event_type=ATP";

function toNumber(value) {
  return Number(String(value ?? "").replace(/[^\d]/g, "")) || 0;
}

function normalizeCountry(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizePlayer(item) {
  return {
    rank: toNumber(item.place),
    name: String(item.player ?? "").trim(),
    country: normalizeCountry(item.country),
    points: toNumber(item.points),
    movement: String(item.movement ?? "").trim(),
    playerKey: String(item.player_key ?? "").trim()
  };
}

function validateRanking(players) {
  if (!Array.isArray(players) || players.length < 50) {
    throw new Error(
      `Ranking incompleto: somente ${players?.length || 0} jogadores recebidos.`
    );
  }

  const ordered = [...players].sort((a, b) => a.rank - b.rank);

  for (let index = 0; index < 10; index++) {
    const player = ordered[index];

    if (!player) {
      throw new Error(`Falta jogador na posição ${index + 1}.`);
    }

    if (player.rank !== index + 1) {
      throw new Error(
        `Top 10 inválido: esperado ${index + 1}, recebido ${player.rank}.`
      );
    }

    if (!player.name || player.points <= 0) {
      throw new Error(
        `Dados inválidos na posição ${player.rank}.`
      );
    }
  }
}

async function readPreviousRanking() {
  try {
    return JSON.parse(await fs.readFile(OUTPUT, "utf8"));
  } catch {
    return null;
  }
}

async function fetchRanking() {
  if (!API_KEY) {
    throw new Error(
      "O segredo API_TENNIS_KEY não foi encontrado no GitHub."
    );
  }

  const response = await fetch(
    `${API_URL}&APIkey=${encodeURIComponent(API_KEY)}`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "Fernando-Lapa-Tennis-Dashboard/1.0"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Falha na API-Tennis: HTTP ${response.status}`);
  }

  const payload = await response.json();

  if (
    !payload ||
    String(payload.success) !== "1" ||
    !Array.isArray(payload.result)
  ) {
    const message =
      payload?.result?.[0]?.msg ||
      payload?.message ||
      "Resposta inválida da API-Tennis.";

    throw new Error(message);
  }

  const players = payload.result
    .map(normalizePlayer)
    .filter(
      player =>
        player.rank > 0 &&
        player.name &&
        player.points >= 0
    )
    .sort((a, b) => a.rank - b.rank);

  validateRanking(players);

  return players;
}

try {
  console.log("Consultando ranking ATP pela API-Tennis...");

  const players = await fetchRanking();

  const output = {
    source: "API-Tennis",
    sourceUrl:
      "https://api.api-tennis.com/tennis/?method=get_standings&event_type=ATP",
    updatedAt: new Date().toISOString(),
    rankingDate: new Date().toISOString(),
    count: players.length,
    players
  };

  await fs.mkdir(path.dirname(OUTPUT), {
    recursive: true
  });

  await fs.writeFile(
    OUTPUT,
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log(
    `Ranking ATP atualizado com ${players.length} jogadores.`
  );

  console.log(
    `Número 1: ${players[0].name} — ${players[0].points} pontos.`
  );
} catch (error) {
  const previous = await readPreviousRanking();

  if (previous?.players?.length) {
    console.error(
      "A atualização falhou, mas o ranking anterior foi preservado."
    );
  } else {
    console.error(
      "A atualização falhou e ainda não existe ranking anterior."
    );
  }

  console.error(error);
  process.exitCode = 1;
}
