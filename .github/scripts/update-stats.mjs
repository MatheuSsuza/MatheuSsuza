import { mkdirSync, writeFileSync } from 'node:fs';

const token = process.env.GH_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
if (!token || !/^MatheuSsuza\/MatheuSsuza$/i.test(repository || '')) throw new Error('Configuração de execução inválida.');

// Only anonymous aggregate fields. Never request repository names or contents.
const query = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

async function api(endpoint, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!r.ok) throw new Error(`GitHub API: HTTP ${r.status}`);
  return r.json();
}

const result = await api('/graphql', { query, variables: { login: 'MatheuSsuza' } });
if (result.errors || !result.data?.user) throw new Error('Não foi possível consultar as contribuições agregadas.');
const collection = result.data.user.contributionsCollection;
const calendar = collection.contributionCalendar;
const total = calendar.totalContributions;
const privateCount = collection.restrictedContributionsCount;
if (![total, privateCount].every(Number.isInteger) || privateCount > total) throw new Error('Contagens inválidas.');
const publicCount = total - privateCount;
const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const days = calendar.weeks.flatMap(w => w.contributionDays);
const period = `${days[0].date} a ${days.at(-1).date}`;
const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const text = (x, y, s, size = 16, fill = '#c9d1d9', extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${escape(s)}</text>`;
const shell = (height, content, title) => `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 900 ${height}" role="img" aria-label="${escape(title)}"><style>text{font-family:Segoe UI,Arial,sans-serif}</style><rect x="1" y="1" width="898" height="${height-2}" rx="16" fill="#0d1117" stroke="#30363d"/>${content}</svg>`;
let summary = text(30, 42, 'Contribuições no GitHub', 25, '#58a6ff') + text(30, 70, 'Últimos 12 meses · atividade pública e privada anônima', 15, '#8b949e');
[[total, 'Total de contribuições', '#7dd3fc'], [publicCount, 'Contribuições públicas', '#c9d1d9'], [privateCount, 'Privadas · anônimas', '#a3e635']].forEach(([n, label, color], i) => {
  const x = 30 + i * 290;
  summary += `<rect x="${x}" y="96" width="260" height="108" rx="12" fill="#161b22"/>` + text(x+18, 145, n.toLocaleString('pt-BR'), 38, color, 'font-weight="700"') + text(x+18, 178, label, 15);
});
summary += text(30, 235, `Atualizado em ${date} · Não exibe nomes, código ou mensagens de commits.`, 13, '#8b949e');
let activity = text(30, 40, 'Calendário de contribuições', 24, '#58a6ff') + text(30, 65, 'Inclui as contribuições privadas exibidas anonimamente pelo GitHub.', 14, '#8b949e');
const max = Math.max(1, ...days.map(d => d.contributionCount));
const colors = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'];
calendar.weeks.forEach((week, wi) => week.contributionDays.forEach(day => {
  const weekday = new Date(day.date+'T12:00:00Z').getUTCDay();
  const level = day.contributionCount ? Math.max(1, Math.ceil(day.contributionCount/max*4)) : 0;
  activity += `<rect x="${30+wi*15}" y="${88+weekday*15}" width="12" height="12" rx="2" fill="${colors[level]}"><title>${day.date}: ${day.contributionCount} contribuições</title></rect>`;
}));
activity += text(30, 216, period, 13, '#8b949e') + text(600, 216, 'Menos', 12, '#8b949e');
colors.forEach((color, i) => activity += `<rect x="${650+i*18}" y="205" width="12" height="12" rx="2" fill="${color}"/>`);
activity += text(751, 216, 'Mais', 12, '#8b949e');
const files = { 'stats/summary.svg': shell(258, summary, `${total} contribuições: ${publicCount} públicas e ${privateCount} privadas anônimas`), 'stats/activity.svg': shell(240, activity, 'Calendário de contribuições públicas e privadas anônimas') };

// Publishing is restricted to two generated images in a separate output branch.
if (process.env.STATS_LOCAL_ONLY === 'true') {
  mkdirSync('stats', { recursive: true });
  for (const [file, content] of Object.entries(files)) writeFileSync(file, content);
} else {
  const base = `/repos/${repository}`;
  let parent = null;
  try { parent = (await api(base+'/git/ref/heads/profile-stats')).object.sha; }
  catch (error) { if (!error.message.endsWith('404')) throw error; }
  const tree = await api(base+'/git/trees', { tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })) });
  const commit = await api(base+'/git/commits', { message: 'Atualiza estatísticas agregadas e anônimas', tree: tree.sha, parents: parent ? [parent] : [] });
  if (parent) await api(base+'/git/refs/heads/profile-stats', { sha: commit.sha, force: false }, 'PATCH');
  else await api(base+'/git/refs', { ref: 'refs/heads/profile-stats', sha: commit.sha });
}
console.log(`Cards atualizados: total=${total}; públicas=${publicCount}; privadas anônimas=${privateCount}.`);
