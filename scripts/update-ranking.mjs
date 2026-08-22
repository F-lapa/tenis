/**
 * Atualiza data/ranking.json com o ranking ATP oficial (api-tennis.com).
 *
 * Uso local:
 *   API_TENNIS_KEY=sua_chave node scripts/update-ranking.mjs
 *
 * GitHub Actions:
 *   secret API_TENNIS_KEY + workflow .github/workflows/update-ranking.yml
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_FILE = join(ROOT, 'data', 'ranking.json');

const API_KEY = process.env.API_TENNIS_KEY || process.env.APITENNIS_KEY || '';
const API_URL = 'https://api.api-tennis.com/tennis/';

/** Nome de país (EN) → código IOC de 3 letras usado no dashboard */
const COUNTRY_TO_IOC = {
  Argentina: 'ARG', Australia: 'AUS', Austria: 'AUT', Belarus: 'BLR', Belgium: 'BEL',
  Bolivia: 'BOL', 'Bosnia and Herzegovina': 'BIH', Brazil: 'BRA', Bulgaria: 'BUL',
  Canada: 'CAN', Chile: 'CHI', China: 'CHN', Colombia: 'COL', Croatia: 'CRO',
  Cyprus: 'CYP', 'Czech Republic': 'CZE', Czechia: 'CZE', Denmark: 'DEN',
  Ecuador: 'ECU', Egypt: 'EGY', Estonia: 'EST', Finland: 'FIN', France: 'FRA',
  Georgia: 'GEO', Germany: 'GER', 'Great Britain': 'GBR', Greece: 'GRE',
  Hungary: 'HUN', India: 'IND', Indonesia: 'INA', Ireland: 'IRL', Israel: 'ISR',
  Italy: 'ITA', Japan: 'JPN', Kazakhstan: 'KAZ', Latvia: 'LAT', Lithuania: 'LTU',
  Luxembourg: 'LUX', Mexico: 'MEX', Moldova: 'MDA', Monaco: 'MON', Montenegro: 'MNE',
  Morocco: 'MAR', Netherlands: 'NED', 'New Zealand': 'NZL', Norway: 'NOR',
  Peru: 'PER', Poland: 'POL', Portugal: 'POR', Romania: 'ROU', Russia: 'RUS',
  Serbia: 'SRB', Slovakia: 'SVK', Slovenia: 'SLO', 'South Africa': 'RSA',
  'South Korea': 'KOR', Korea: 'KOR', Spain: 'ESP', Sweden: 'SWE',
  Switzerland: 'SUI', Taiwan: 'TPE', 'Chinese Taipei': 'TPE', Tunisia: 'TUN',
  Turkey: 'TUR', Türkiye: 'TUR', Ukraine: 'UKR', 'United Kingdom': 'GBR',
  'United States': 'USA', USA: 'USA', Uruguay: 'URU', Uzbekistan: 'UZB',
  Venezuela: 'VEN', 'Hong Kong': 'HKG', 'Puerto Rico': 'PUR'
};

function toIoc(country) {
  if (!country) return '';
  const raw = String(country).trim();
  if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();
  if (COUNTRY_TO_IOC[raw]) return COUNTRY_TO_IOC[raw];
  const found = Object.entries(COUNTRY_TO_IOC).find(
    ([name]) => name.toLowerCase() === raw.toLowerCase()
  );
  return found ? found[1] : raw.slice(0, 3).toUpperCase();
}

async function fetchStandings(eventType = 'ATP') {
  if (!API_KEY) {
    throw new Error(
      'API_TENNIS_KEY não definida. Configure o secret no GitHub ou exporte a variável localmente.'
    );
  }

  const url = new URL(API_URL);
  url.searchParams.set('method', 'get_standings');
  url.searchParams.set('event_type', eventType);
  url.searchParams.set('APIkey', API_KEY);

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(25000)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ao chamar api-tennis (${eventType})`);
  }

  const json = await res.json();
  if (!json || Number(json.success) !== 1 || !Array.isArray(json.result)) {
    const msg = json?.error || json?.message || JSON.stringify(json).slice(0, 200);
    throw new Error(`Resposta inválida da API: ${msg}`);
  }

  return json.result;
}

function mapPlayers(rows) {
  const players = [];
  const seen = new Set();

  for (const row of rows) {
    const name = String(row.player || row.player_name || '').trim();
    if (!name) continue;

    const rank = Number(row.place || row.rank || row.position) || 0;
    if (rank <= 0) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    players.push({
      rank,
      name,
      country: toIoc(row.country || row.country_name || ''),
      points: Number(String(row.points || '0').replace(/[^\d.-]/g, '')) || 0,
      playerId: row.player_key ? String(row.player_key) : null,
      movement: row.movement || null,
      league: row.league || 'ATP'
    });
  }

  players.sort((a, b) => a.rank - b.rank || b.points - a.points);
  return players;
}

async function main() {
  console.log('[update-ranking] Buscando standings ATP...');
  const rows = await fetchStandings('ATP');
  const players = mapPlayers(rows);

  if (players.length < 50) {
    throw new Error(
      `Ranking incompleto (${players.length} jogadores). Abortando para não sobrescrever data/ranking.json.`
    );
  }

  const now = new Date();
  const payload = {
    source: 'api-tennis.com',
    method: 'get_standings',
    eventType: 'ATP',
    rankingDate: now.toISOString().slice(0, 10),
    updatedAt: now.toISOString(),
    count: players.length,
    players
  };

  await mkdir(dirname(OUT_FILE), { recursive: true });

  // Evita commit inútil se o conteúdo relevante for idêntico
  let previous = null;
  try {
    previous = JSON.parse(await readFile(OUT_FILE, 'utf8'));
  } catch {
    previous = null;
  }

  const same =
    previous &&
    Array.isArray(previous.players) &&
    previous.players.length === players.length &&
    previous.players.every((p, i) =>
      p.rank === players[i].rank &&
      p.name === players[i].name &&
      Number(p.points) === Number(players[i].points)
    );

  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  if (same) {
    console.log(
      `[update-ranking] ranking.json regravado sem mudanças de posição/pontos (${players.length} jogadores).`
    );
  } else {
    console.log(
      `[update-ranking] OK → ${OUT_FILE} (${players.length} jogadores). Top 3: ` +
        players
          .slice(0, 3)
          .map(p => `${p.rank}. ${p.name} (${p.points})`)
          .join(' | ')
    );
  }
}

main().catch(err => {
  console.error('[update-ranking] ERRO:', err.message || err);
  process.exit(1);
});
