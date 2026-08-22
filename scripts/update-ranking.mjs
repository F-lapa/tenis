/**
 * Atualiza data/ranking.json com ranking ATP — 100% GRATUITO (sem API paga).
 *
 * Fontes (em ordem):
 *  1) TennisExplorer  – ranking oficial semanal (HTML público)
 *  2) Wikipedia Module:ATP rankings – fallback
 *
 * Uso:
 *   node scripts/update-ranking.mjs
 *
 * GitHub Actions: não precisa de secret.
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_FILE = join(ROOT, 'data', 'ranking.json');

const UA =
  'FernandoLapaDashboard/1.0 (github.com/F-lapa/tenis; ranking-bot; +https://github.com/F-lapa/tenis)';

const COUNTRY_SLUG_TO_IOC = {
  afghanistan: 'AFG', albania: 'ALB', algeria: 'ALG', andorra: 'AND', angola: 'ANG',
  argentina: 'ARG', armenia: 'ARM', australia: 'AUS', austria: 'AUT', azerbaijan: 'AZE',
  bahamas: 'BAH', bahrain: 'BRN', bangladesh: 'BAN', barbados: 'BAR', belarus: 'BLR',
  belgium: 'BEL', belize: 'BIZ', bolivia: 'BOL', 'bosnia-and-herzegovina': 'BIH',
  botswana: 'BOT', brazil: 'BRA', bulgaria: 'BUL', cambodia: 'CAM', cameroon: 'CMR',
  canada: 'CAN', chile: 'CHI', china: 'CHN', colombia: 'COL', 'costa-rica': 'CRC',
  croatia: 'CRO', cuba: 'CUB', cyprus: 'CYP', 'czech-republic': 'CZE', czechia: 'CZE',
  denmark: 'DEN', 'dominican-republic': 'DOM', ecuador: 'ECU', egypt: 'EGY',
  'el-salvador': 'ESA', estonia: 'EST', finland: 'FIN', france: 'FRA', georgia: 'GEO',
  germany: 'GER', ghana: 'GHA', 'great-britain': 'GBR', greece: 'GRE', guatemala: 'GUA',
  honduras: 'HON', 'hong-kong': 'HKG', hungary: 'HUN', india: 'IND', indonesia: 'INA',
  iran: 'IRI', iraq: 'IRQ', ireland: 'IRL', israel: 'ISR', italy: 'ITA', jamaica: 'JAM',
  japan: 'JPN', kazakhstan: 'KAZ', kenya: 'KEN', kuwait: 'KUW', latvia: 'LAT',
  lebanon: 'LIB', lithuania: 'LTU', luxembourg: 'LUX', malaysia: 'MAS', mexico: 'MEX',
  moldova: 'MDA', monaco: 'MON', mongolia: 'MGL', montenegro: 'MNE', morocco: 'MAR',
  netherlands: 'NED', 'new-zealand': 'NZL', nigeria: 'NGR', 'north-macedonia': 'MKD',
  norway: 'NOR', pakistan: 'PAK', paraguay: 'PAR', peru: 'PER', philippines: 'PHI',
  poland: 'POL', portugal: 'POR', 'puerto-rico': 'PUR', qatar: 'QAT', romania: 'ROU',
  russia: 'RUS', 'saudi-arabia': 'KSA', serbia: 'SRB', singapore: 'SGP', slovakia: 'SVK',
  slovenia: 'SLO', 'south-africa': 'RSA', 'south-korea': 'KOR', spain: 'ESP',
  sweden: 'SWE', switzerland: 'SUI', taiwan: 'TPE', thailand: 'THA', tunisia: 'TUN',
  turkey: 'TUR', ukraine: 'UKR', 'united-arab-emirates': 'UAE',
  'united-kingdom': 'GBR', 'united-states': 'USA', usa: 'USA', uruguay: 'URU',
  uzbekistan: 'UZB', venezuela: 'VEN', vietnam: 'VIE', zimbabwe: 'ZIM'
};

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/json,*/*',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    signal: AbortSignal.timeout(45000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.text();
}

/** "Sinner Jannik" → "Jannik Sinner" */
function normalizeName(raw) {
  const parts = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (parts.length < 2) return parts.join(' ');
  // Último token como primeiro nome (padrão TennisExplorer: sobrenome + nome)
  const first = parts[parts.length - 1];
  const last = parts.slice(0, -1).join(' ');
  return `${first} ${last}`.replace(/\s+/g, ' ').trim();
}

function slugToIoc(slug) {
  const s = String(slug || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-');
  return COUNTRY_SLUG_TO_IOC[s] || s.slice(0, 3).toUpperCase();
}

// ─── Fonte 1: TennisExplorer ───────────────────────────────────────────────
async function fetchFromTennisExplorer() {
  const players = [];
  const seen = new Set();
  let rankingDate = null;

  for (let page = 1; page <= 10; page++) {
    const url =
      page === 1
        ? 'https://www.tennisexplorer.com/ranking/atp-men/'
        : `https://www.tennisexplorer.com/ranking/atp-men/?page=${page}`;

    console.log(`[TE] página ${page}…`);
    const html = await fetchText(url);

    if (!rankingDate) {
      const dm = html.match(/rankings on\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
      if (dm) {
        rankingDate = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
      }
    }

    const rowRe =
      /<td class="rank first">(\d+)\.<\/td>\s*<td class="prevrank">[\s\S]*?<\/td>\s*<td class="t-name"><a href="([^"]+)">([^<]+)<\/a><\/td>\s*<td class="tl"><a href="[^"]*country=([^"&]+)[^"]*">[\s\S]*?<\/a><\/td>\s*<td class="long-point">([\d\s]+)<\/td>/gi;

    let match;
    let found = 0;
    while ((match = rowRe.exec(html)) !== null) {
      const rank = Number(match[1]);
      const href = match[2];
      const rawName = match[3].trim();
      const countrySlug = match[4].trim();
      const points = Number(String(match[5]).replace(/\s/g, '')) || 0;
      const name = normalizeName(rawName);
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      found++;

      const playerId = (href.match(/\/player\/([^/]+)/) || [])[1] || null;

      players.push({
        rank,
        name,
        country: slugToIoc(countrySlug),
        countryName: countrySlug.replace(/-/g, ' '),
        points,
        movement: null,
        playerKey: playerId,
        playerId,
        league: 'ATP'
      });
    }

    console.log(`[TE] página ${page}: +${found} (total ${players.length})`);
    if (found === 0) break;
    // Pausa leve entre páginas
    await new Promise(r => setTimeout(r, 400));
  }

  if (players.length < 40) {
    throw new Error(`TennisExplorer retornou só ${players.length} jogadores`);
  }

  players.sort((a, b) => a.rank - b.rank || b.points - a.points);
  return {
    source: 'tennisexplorer.com',
    rankingDate: rankingDate || new Date().toISOString().slice(0, 10),
    players
  };
}

// ─── Fonte 2: Wikipedia (fallback) ─────────────────────────────────────────
async function fetchFromWikipedia() {
  console.log('[Wiki] Module:ATP rankings/data/singles.json…');
  const api =
    'https://en.wikipedia.org/w/api.php?action=parse&page=Module:ATP_rankings/data/singles.json&prop=wikitext&format=json';
  const text = await fetchText(api);
  const parsed = JSON.parse(text);
  const wikitext = parsed?.parse?.wikitext?.['*'];
  if (!wikitext) throw new Error('Wikipedia: wikitext vazio');

  const data = JSON.parse(wikitext);
  const current = data.current || data;
  const asOf = current['as-of'] || current.asOf || null;
  const perCountry = current['per-country'] || current.perCountry || {};

  const players = [];
  const seen = new Set();

  for (const [ioc, list] of Object.entries(perCountry)) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      const rawName = String(row.name || '').trim();
      if (!rawName) continue;
      // Wiki: "Sinner, Jannik" → "Jannik Sinner"
      let name = rawName;
      if (rawName.includes(',')) {
        const [last, first] = rawName.split(',').map(s => s.trim());
        name = `${first} ${last}`.replace(/\s+/g, ' ').trim();
      }
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      players.push({
        rank: Number(row.rank) || 0,
        name,
        country: String(ioc || '').toUpperCase(),
        points: Number(row.points) || 0,
        movement: null,
        playerKey: null,
        playerId: null,
        league: 'ATP'
      });
    }
  }

  players.sort((a, b) => a.rank - b.rank || b.points - a.points);
  if (players.length < 40) {
    throw new Error(`Wikipedia retornou só ${players.length} jogadores`);
  }

  // Converte "Aug 13, 2026" → ISO se possível
  let rankingDate = new Date().toISOString().slice(0, 10);
  if (asOf) {
    const d = new Date(asOf);
    if (!Number.isNaN(d.getTime())) rankingDate = d.toISOString().slice(0, 10);
  }

  return {
    source: 'wikipedia.org/Module:ATP_rankings',
    rankingDate,
    players
  };
}

async function main() {
  console.log('[update-ranking] Fonte gratuita (sem API paga)…');

  let result;
  try {
    result = await fetchFromTennisExplorer();
  } catch (err) {
    console.warn('[update-ranking] TennisExplorer falhou:', err.message);
    console.warn('[update-ranking] Tentando Wikipedia…');
    result = await fetchFromWikipedia();
  }

  const { source, rankingDate, players } = result;
  const now = new Date();

  const payload = {
    source,
    sourceUrl:
      source.includes('tennisexplorer')
        ? 'https://www.tennisexplorer.com/ranking/atp-men/'
        : 'https://en.wikipedia.org/wiki/Module:ATP_rankings/data/singles.json',
    rankingDate,
    updatedAt: now.toISOString(),
    count: players.length,
    players
  };

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  console.log(
    `[update-ranking] OK → ${OUT_FILE} (${players.length} jogadores, fonte: ${source})`
  );
  console.log(
    'Top 5: ' +
      players
        .slice(0, 5)
        .map(p => `${p.rank}. ${p.name} (${p.points})`)
        .join(' | ')
  );
}

main().catch(err => {
  console.error('[update-ranking] ERRO:', err.message || err);
  process.exit(1);
});
