import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const OUTPUT = path.resolve("data/ranking.json");
const ATP_URL =
  "https://www.atptour.com/en/rankings/singles?rankRange=0-5000";

function number(value) {
  return Number(String(value ?? "").replace(/[^\d]/g, "")) || 0;
}

function cleanName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidPlayer(player) {
  return (
    Number.isInteger(player.rank) &&
    player.rank > 0 &&
    player.name.length >= 3 &&
    Number.isFinite(player.points) &&
    player.points >= 0
  );
}

function removeDuplicates(players) {
  const unique = new Map();

  for (const player of players) {
    const key = player.name.toLowerCase();

    if (!unique.has(key) || player.rank < unique.get(key).rank) {
      unique.set(key, player);
    }
  }

  return [...unique.values()].sort((a, b) => a.rank - b.rank);
}

async function extractRanking(page) {
  return page.evaluate(() => {
    const toNumber = (value) =>
      Number(String(value ?? "").replace(/[^\d]/g, "")) || 0;

    const rows = [
      ...document.querySelectorAll(
        "table tbody tr, .mega-table tbody tr, [class*='ranking'] tbody tr"
      ),
    ];

    const result = [];

    for (const row of rows) {
      const cells = [...row.querySelectorAll("td")].map((td) =>
        td.innerText.trim()
      );

      if (cells.length < 3) continue;

      const rank = toNumber(cells[0]);

      const playerElement =
        row.querySelector("a[href*='/players/']") ||
        row.querySelector("[class*='player'] a") ||
        row.querySelector("[class*='name']");

      const name = (
        playerElement?.textContent ||
        cells[1] ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim();

      const countryElement =
        row.querySelector("[data-country]") ||
        row.querySelector("[class*='country']") ||
        row.querySelector("img[alt][src*='flag']");

      let country =
        countryElement?.getAttribute("data-country") ||
        countryElement?.getAttribute("alt") ||
        countryElement?.textContent ||
        "";

      country = country
        .toUpperCase()
        .replace(/[^A-Z]/g, "")
        .slice(0, 3);

      const possiblePoints = cells
        .slice(2)
        .map((cell) => ({
          text: cell,
          value: toNumber(cell),
        }))
        .filter(
          (item) =>
            /^[\d,.\s]+$/.test(item.text) &&
            item.value >= 0
        );

      const points = possiblePoints[0]?.value ?? 0;

      if (rank && name) {
        result.push({
          rank,
          name,
          country,
          points,
        });
      }
    }

    return result;
  });
}

async function readPreviousRanking() {
  try {
    return JSON.parse(await fs.readFile(OUTPUT, "utf8"));
  } catch {
    return null;
  }
}

const browser = await chromium.launch({
  headless: true,
});

try {
  const page = await browser.newPage({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/131.0.0.0 Safari/537.36",
  });

  await page.goto(ATP_URL, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });

  await page.waitForTimeout(10000);

  const cookieButtons = [
    "Accept All",
    "Accept all",
    "I Accept",
    "Agree",
  ];

  for (const label of cookieButtons) {
    const button = page.getByRole("button", {
      name: label,
      exact: false,
    });

    if (await button.count()) {
      await button.first().click().catch(() => {});
      break;
    }
  }

  await page.waitForTimeout(3000);

  let players = await extractRanking(page);

  players = removeDuplicates(
    players
      .map((player) => ({
        rank: number(player.rank),
        name: cleanName(player.name),
        country: String(player.country || "")
          .toUpperCase()
          .replace(/[^A-Z]/g, "")
          .slice(0, 3),
        points: number(player.points),
      }))
      .filter(isValidPlayer)
  );

  if (players.length < 20) {
    throw new Error(
      `A ATP devolveu apenas ${players.length} jogadores reconhecidos.`
    );
  }

  const payload = {
    source: "ATP Tour oficial via GitHub Actions",
    sourceUrl: ATP_URL,
    updatedAt: new Date().toISOString(),
    count: players.length,
    players,
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
    `Ranking atualizado com ${players.length} jogadores.`
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
} finally {
  await browser.close();
}
