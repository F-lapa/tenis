import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT = path.resolve("data/ranking.json");

const ATP_PAGE =
  "https://www.atptour.com/en/rankings/singles?rankRange=1-1000";

const ATP_TEXT =
  "https://r.jina.ai/https://www.atptour.com/en/rankings/singles?rankRange=1-1000";

function number(value) {
  return Number(
    String(value ?? "").replace(/[^\d]/g, "")
  ) || 0;
}

function linkText(line) {
  const match = String(line).match(
    /\[([^\]]+)\]\([^)]+\)/
  );

  return match ? match[1].trim() : "";
}

function validName(value) {
  return (
    value.length >= 3 &&
    value.length <= 80 &&
    /[A-Za-zÀ-ÿ]/.test(value) &&
    !/ATP|Rankings|Official Points|Refresh/i.test(value)
  );
}

function parseRanking(text) {
  const lines = String(text)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const headerIndex = lines.findIndex((line) =>
    /Hidden header Rank\s+Player\s+Official Points/i.test(
      line
    )
  );

  if (headerIndex < 0) {
    throw new Error(
      "O cabeçalho do ranking ATP não foi encontrado."
    );
  }

  const players = [];
  const seenRanks = new Set();

  for (
    let index = headerIndex + 1;
    index < lines.length;
    index++
  ) {
    const rankMatch = lines[index].match(
      /^(\d{1,4})$/
    );

    if (!rankMatch) continue;

    const rank = Number(rankMatch[1]);

    if (
      rank < 1 ||
      rank > 1000 ||
      seenRanks.has(rank)
    ) {
      continue;
    }

    let name = "";
    let points = 0;

    for (
      let next = index + 1;
      next < Math.min(index + 8, lines.length);
      next++
    ) {
      const textFromLink = linkText(lines[next]);

      if (
        !name &&
        textFromLink &&
        validName(textFromLink)
      ) {
        name = textFromLink;
        continue;
      }

      if (
        name &&
        textFromLink &&
        /^[\d,.]+$/.test(textFromLink)
      ) {
        points = number(textFromLink);
        break;
      }
    }

    if (!name || points <= 0) continue;

    seenRanks.add(rank);

    players.push({
      rank,
      name,
      country: "",
      points
    });
  }

  return players.sort(
    (first, second) => first.rank - second.rank
  );
}

function validateRanking(players) {
  if (players.length < 100) {
    throw new Error(
      `Ranking incompleto: somente ${players.length} jogadores reconhecidos.`
    );
  }

  for (let index = 0; index < 10; index++) {
    const player = players[index];

    if (!player || player.rank !== index + 1) {
      throw new Error(
        `Top 10 inválido na posição ${index + 1}.`
      );
    }

    if (!player.name || player.points <= 0) {
      throw new Error(
        `Dados inválidos na posição ${index + 1}.`
      );
    }
  }
}

async function downloadRanking() {
  const response = await fetch(
    `${ATP_TEXT}&cache=${Date.now()}`,
    {
      cache: "no-store",
      headers: {
        Accept: "text/plain,*/*",
        "User-Agent":
          "Fernando-Lapa-Tennis-Dashboard/3.0"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Falha ao consultar a ATP: HTTP ${response.status}`
    );
  }

  const text = await response.text();

  if (
    !text.includes("Official Points") ||
    !text.includes("ATP Rankings")
  ) {
    throw new Error(
      "A resposta recebida não contém o ranking ATP."
    );
  }

  return text;
}

async function previousRankingExists() {
  try {
    const previous = JSON.parse(
      await fs.readFile(OUTPUT, "utf8")
    );

    return Array.isArray(previous.players) &&
      previous.players.length > 0;
  } catch {
    return false;
  }
}

try {
  console.log(
    "Consultando a classificação oficial da ATP..."
  );

  const text = await downloadRanking();
  const players = parseRanking(text);

  validateRanking(players);

  const payload = {
    source: "ATP Tour oficial",
    sourceUrl: ATP_PAGE,
    updatedAt: new Date().toISOString(),
    rankingDate: new Date().toISOString(),
    count: players.length,
    players
  };

  await fs.mkdir(
    path.dirname(OUTPUT),
    { recursive: true }
  );

  await fs.writeFile(
    OUTPUT,
    JSON.stringify(payload, null, 2) + "\n",
    "utf8"
  );

  console.log(
    `Ranking salvo com ${players.length} jogadores.`
  );

  console.log(
    `Número 1: ${players[0].name}, ` +
    `${players[0].points} pontos.`
  );
} catch (error) {
  const hasPrevious =
    await previousRankingExists();

  if (hasPrevious) {
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
