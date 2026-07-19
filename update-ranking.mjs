import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const OUTPUT = path.resolve("data/ranking.json");
const ATP_URL = "https://www.atptour.com/en/rankings/singles?rankRange=0-5000";

function number(value) {
  return Number(String(value ?? "").replace(/[^\d]/g, "")) || 0;
}

function cleanName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\b\d{1,3}\s*yrs?\b/gi, "")
    .trim();
}

function validPlayer(player) {
  return (
    Number.isInteger(player.rank) &&
    player.rank > 0 &&
    player.rank < 10000 &&
    player.name.length >= 3 &&
    player.name.length <= 80 &&
    Number.isFinite(player.points) &&
    player.points >= 0
  );
}

function dedupe(players) {
  const byName = new Map();
  for (const player of players) {
    const key = player.name.toLowerCase();
    const old = byName.get(key);
    if (!old || player.rank < old.rank) byName.set(key, player);
  }
  return [...byName.values()].sort((a, b) => a.rank - b.rank);
}

async function extractFromRows(page) {
  return page.evaluate(() => {
    const toNumber = value => Number(String(value ?? "").replace(/[^\d]/g, "")) || 0;
    const rows = [...document.querySelectorAll("table tbody tr, .mega-table tbody tr, [class*='rankings'] tbody tr")];
    const result = [];

    for (const row of rows) {
      const cells = [...row.querySelectorAll("td")].map(td => td.innerText.trim());
      if (cells.length < 3) continue;

      const rank = toNumber(cells[0]);
      const playerLink =
        row.querySelector("a[href*='/players/']") ||
        row.querySelector("[class*='player'] a") ||
        row.querySelector("[class*='name']");

      const name = (playerLink?.textContent || cells[1] || "").replace(/\s+/g, " ").trim();

      const countryElement =
        row.querySelector("[data-country]") ||
        row.querySelector("[class*='country']") ||
        row.querySelector("img[alt][src*='flags']");

      let country =
        countryElement?.getAttribute("data-country") ||
        countryElement?.getAttribute("alt") ||
        countryElement?.textContent ||
        "";

      country = country.replace(/[^A-Z]/g, "").slice(0, 3);

      const numericCells = cells
        .slice(2)
        .map(value => ({ raw: value, numeric: toNumber(value) }))
        .filter(item => /^[\d,.\s]+$/.test(item.raw) && item.numeric >= 0);

      const points = numericCells[0]?.numeric ?? 0;

      if (rank && name) result.push({ rank, name, country, points });
    }
    return result;
  });
}

async function extractFromBody(page) {
  const text = await page.locator("body").innerText();
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    if (!/^\d{1,4}$/.test(lines[i])) continue;

    const rank = number(lines[i]);
    let name = "";
    let country = "";
    let points = 0;

    for (let j = i + 1; j < Math.min(i + 16, lines.length); j++) {
      const line = lines[j];

      if (!name && /^[A-ZÀ-Ü][A-Za-zÀ-ÿ'’.\-]+(?:\s+[A-ZÀ-Ü][A-Za-zÀ-ÿ'’.\-]+){1,5}$/.test(line)) {
        name = cleanName(line);
        continue;
      }

      if (!country && /^[A-Z]{2,3}$/.test(line)) {
        country = line;
        continue;
      }

      if (name && /^[\d,.]+$/.test(line)) {
        const candidate = number(line);
        if (candidate >= 0) {
          points = candidate;
          break;
        }
      }
    }

    if (rank && name) result.push({ rank, name, country, points });
  }

  return result;
}

async function readPrevious() {
  try {
    return JSON.parse(await fs.readFile(OUTPUT, "utf8"));
  } catch {
    return null;
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });

  await page.goto(ATP_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(8000);

  // Accept cookies when the control is present.
  for (const label of ["Accept All", "Accept all", "I Accept", "Agree"]) {
    const button = page.getByRole("button", { name: label, exact: false });
    if (await button.count()) {
      await button.first().click().catch(() => {});
      break;
    }
  }

  await page.waitForTimeout(3000);

  let players = await extractFromRows(page);
  if (players.length < 20) players = await extractFromBody(page);

  players = dedupe(
    players
      .map(p => ({
        rank: number(p.rank),
        name: cleanName(p.name),
        country: String(p.country || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3),
        points: number(p.points),
      }))
      .filter(validPlayer)
  );

  if (players.length < 20) {
    throw new Error(`A ATP devolveu somente ${players.length} jogadores reconhecíveis.`);
  }

  const payload = {
    source: "ATP Tour oficial via GitHub Actions",
    sourceUrl: ATP_URL,
    updatedAt: new Date().toISOString(),
    count: players.length,
    players,
  };

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Ranking salvo: ${players.length} jogadores.`);
} catch (error) {
  const previous = await readPrevious();
  if (previous?.players?.length) {
    console.error("Atualização falhou; o ranking anterior foi preservado.");
  }
  throw error;
} finally {
  await browser.close();
}
