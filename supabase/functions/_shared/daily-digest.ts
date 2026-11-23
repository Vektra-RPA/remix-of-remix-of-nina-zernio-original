// Resumo diário da Lis por e-mail (23/11/2026). Montado pelo cadence-worker (ação
// "digest", cron lis-resumo-diario no fim do dia útil) e enviado pelo email-send em modo
// interno para DIGEST_EMAILS. Cobre o dia corrente no horário de Brasília: envios da
// sequência, respostas, saídas da lista, reuniões, buscas no Apollo, triagem e pendências.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const STEP_LABEL: Record<number, string> = { 1: 'D0 (e-mail)', 2: 'D3 (WhatsApp)', 3: 'D7 (e-mail)', 4: 'D9 (WhatsApp)', 5: 'D14 (e-mail)' };

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function esc(s: unknown): string {
  return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function clip(s: unknown, max: number): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Início do dia de hoje em Brasília (UTC-3), em ISO UTC. */
function startOfTodayBr(now = new Date()): { iso: string; label: string } {
  const br = new Date(now.getTime() - 3 * 3_600_000);
  const y = br.getUTCFullYear(), m = br.getUTCMonth(), d = br.getUTCDate();
  const start = new Date(Date.UTC(y, m, d, 3, 0, 0));
  return { iso: start.toISOString(), label: `${String(d).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}/${y}` };
}

type Section = { title: string; lines: string[]; rows?: string[][]; head?: string[] };

async function contactsById(supabase: SupabaseClient, ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return map;
  const { data } = await supabase.from('contacts').select('id, name, email, client_memory').in('id', Array.from(new Set(ids)).slice(0, 200));
  for (const c of (data ?? []) as Array<Record<string, unknown>>) map.set(String(c.id), c);
  return map;
}

function who(c: Record<string, unknown> | undefined): string {
  if (!c) return '(contato)';
  const company = rec(rec(c.client_memory).apollo).company;
  return `${c.name ?? c.email ?? '(sem nome)'}${company ? ` (${company})` : ''}`;
}

export async function buildDailyDigest(supabase: SupabaseClient): Promise<{ subject: string; text: string; html: string; counts: Record<string, number> }> {
  const { iso: start, label } = startOfTodayBr();
  const sections: Section[] = [];
  const counts: Record<string, number> = {};

  // 1) Sequência: toques enviados e pulados hoje, erros pendentes
  try {
    const { data: sent } = await supabase.from('cadence_state').select('step').eq('status', 'sent').gte('sent_at', start);
    const { data: skipped } = await supabase.from('cadence_state').select('step').eq('status', 'skipped').gte('updated_at', start);
    const { data: failing } = await supabase.from('cadence_state').select('contact_id, step, last_error').eq('status', 'pending').not('last_error', 'is', null).limit(20);
    const { count: pending } = await supabase.from('cadence_state').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    const bySent: Record<number, number> = {};
    for (const r of (sent ?? []) as Array<{ step: number }>) bySent[r.step] = (bySent[r.step] ?? 0) + 1;
    const bySkip: Record<number, number> = {};
    for (const r of (skipped ?? []) as Array<{ step: number }>) bySkip[r.step] = (bySkip[r.step] ?? 0) + 1;
    counts.enviados = (sent ?? []).length;
    const rows = Object.keys(STEP_LABEL).map(Number)
      .filter((s) => bySent[s] || bySkip[s])
      .map((s) => [STEP_LABEL[s], String(bySent[s] ?? 0), String(bySkip[s] ?? 0)]);
    const lines = [`Toques ainda na fila: ${pending ?? 0}.`];
    if (rows.length === 0) lines.unshift('Nenhum toque enviado hoje.');
    const fails = (failing ?? []) as Array<{ contact_id: string; step: number; last_error: string }>;
    if (fails.length) {
      const cmap = await contactsById(supabase, fails.map((f) => f.contact_id));
      lines.push(`Toques com erro esperando nova tentativa: ${fails.length}${fails.length === 20 ? '+' : ''}.`);
      for (const f of fails.slice(0, 5)) lines.push(`• ${STEP_LABEL[f.step] ?? `step ${f.step}`} — ${who(cmap.get(f.contact_id))}: ${clip(f.last_error, 120)}`);
    }
    sections.push({ title: 'Sequência', lines, head: ['Toque', 'Enviados', 'Pulados'], rows });
  } catch (e) { sections.push({ title: 'Sequência', lines: [`Não consegui ler: ${String(e)}`] }); }

  // 2) Respostas recebidas hoje (e-mail e WhatsApp)
  try {
    const { data: msgs } = await supabase.from('messages').select('conversation_id, content, sent_at, metadata')
      .eq('from_type', 'user').gte('sent_at', start).order('sent_at', { ascending: true }).limit(100);
    const list = (msgs ?? []) as Array<{ conversation_id: string; content: string; metadata: unknown }>;
    const { data: convs } = list.length
      ? await supabase.from('conversations').select('id, contact_id, channel, status').in('id', Array.from(new Set(list.map((m) => m.conversation_id))))
      : { data: [] };
    const convMap = new Map(((convs ?? []) as Array<Record<string, unknown>>).map((c) => [String(c.id), c]));
    const cmap = await contactsById(supabase, ((convs ?? []) as Array<Record<string, unknown>>).map((c) => String(c.contact_id)));
    // Uma linha por conversa (a última mensagem do dia).
    const last = new Map<string, { content: string; channel: string; contactId: string; status: string }>();
    for (const m of list) {
      const conv = convMap.get(m.conversation_id);
      if (!conv) continue;
      last.set(m.conversation_id, { content: m.content, channel: String(conv.channel ?? rec(m.metadata).channel ?? 'whatsapp'), contactId: String(conv.contact_id), status: String(conv.status ?? '') });
    }
    counts.respostas = last.size;
    const rows = Array.from(last.values()).map((r) => [
      who(cmap.get(r.contactId)), r.channel === 'email' ? 'E-mail' : 'WhatsApp', clip(r.content, 160), r.status === 'human' ? 'com uma pessoa' : 'com a Lis',
    ]);
    sections.push({
      title: 'Quem escreveu hoje',
      lines: rows.length ? [`${rows.length} conversa(s) com mensagem nova do lead.`] : ['Ninguém escreveu hoje.'],
      head: ['Lead', 'Canal', 'Última mensagem', 'Atendimento'], rows,
    });
  } catch (e) { sections.push({ title: 'Quem escreveu hoje', lines: [`Não consegui ler: ${String(e)}`] }); }

  // 3) Saídas da lista hoje (opt-out, e-mail devolvido, mudou de empresa)
  try {
    const sel = 'id, name, email, client_memory';
    const [{ data: optOut }, { data: bounced }, { data: left }] = await Promise.all([
      supabase.from('contacts').select(sel).gte('client_memory->>opt_out_at', start).limit(50),
      supabase.from('contacts').select(sel).gte('client_memory->>email_bounced_at', start).limit(50),
      supabase.from('contacts').select(sel).gte('client_memory->left_company->>at', start).limit(50),
    ]);
    const lines: string[] = [];
    const add = (label: string, rows: unknown) => {
      const list = (rows ?? []) as Array<Record<string, unknown>>;
      if (list.length) lines.push(`${label}: ${list.length} — ${list.slice(0, 8).map((c) => who(c)).join('; ')}`);
      return list.length;
    };
    counts.saidas = add('Pediram para sair', optOut) + add('E-mail devolvido', bounced) + add('Mudou de cargo ou empresa', left);
    sections.push({ title: 'Saídas da lista', lines: lines.length ? lines : ['Nenhuma saída hoje.'] });
  } catch (e) { sections.push({ title: 'Saídas da lista', lines: [`Não consegui ler: ${String(e)}`] }); }

  // 4) Reuniões marcadas hoje
  try {
    const { data: appts } = await supabase.from('appointments').select('contact_id, date, time, status').gte('created_at', start).limit(30);
    const list = (appts ?? []) as Array<{ contact_id: string; date: string; time: string; status: string }>;
    counts.reunioes = list.length;
    const cmap = await contactsById(supabase, list.map((a) => a.contact_id).filter(Boolean));
    sections.push({
      title: 'Reuniões marcadas hoje',
      lines: list.length ? list.map((a) => `• ${who(cmap.get(a.contact_id))} — ${a.date} ${String(a.time ?? '').slice(0, 5)} (${a.status})`) : ['Nenhuma reunião marcada hoje.'],
    });
  } catch (e) { sections.push({ title: 'Reuniões marcadas hoje', lines: [`Não consegui ler: ${String(e)}`] }); }

  // 5) Apollo: buscas e triagem do dia + dúvidas esperando decisão
  try {
    const { data: runs } = await supabase.from('apollo_search_runs').select('status, fetched, new_leads, with_phone').gte('started_at', start);
    const runList = (runs ?? []) as Array<{ status: string; fetched: number | null; new_leads: number | null }>;
    const { data: triaged } = await supabase.from('contacts').select('id, name, email, client_memory').gte('client_memory->triagem->>at', start).limit(300);
    const tri = (triaged ?? []) as Array<Record<string, unknown>>;
    const by = { OK: 0, DUVIDA: 0, FORA: 0 } as Record<string, number>;
    for (const c of tri) {
      const v = String(rec(rec(c.client_memory).triagem).veredito ?? '');
      if (v in by) by[v] += 1;
    }
    const { data: doubts } = await supabase.from('contacts').select('id, name, email, client_memory').contains('tags', ['triagem_duvida']).limit(60);
    const { count: pendingTriage } = await supabase.from('contacts').select('id', { count: 'exact', head: true }).contains('tags', ['triagem_pendente']);
    counts.triados = tri.length;
    const lines = [
      runList.length
        ? `Buscas hoje: ${runList.length} (${runList.reduce((a, r) => a + (r.new_leads ?? 0), 0)} pessoas novas consultadas).`
        : 'Nenhuma busca no Apollo hoje.',
      tri.length ? `Triagem de hoje: ${by.OK} OK, ${by.DUVIDA} em dúvida, ${by.FORA} fora.` : 'Nenhum lead triado hoje.',
    ];
    if (pendingTriage) lines.push(`Ainda na fila da triagem: ${pendingTriage}.`);
    const dlist = (doubts ?? []) as Array<Record<string, unknown>>;
    lines.push(dlist.length ? `Em dúvida esperando decisão: ${dlist.length}${dlist.length === 60 ? '+' : ''}.` : 'Nenhum lead em dúvida esperando decisão.');
    const rows = dlist.slice(0, 25).map((c) => [who(c), clip(rec(rec(c.client_memory).triagem).motivo, 200)]);
    sections.push({ title: 'Apollo e triagem', lines, head: rows.length ? ['Em dúvida', 'Motivo'] : undefined, rows });
  } catch (e) { sections.push({ title: 'Apollo e triagem', lines: [`Não consegui ler: ${String(e)}`] }); }

  const subject = `Lis · resumo de ${label} · ${counts.enviados ?? 0} toques, ${counts.respostas ?? 0} respostas, ${counts.reunioes ?? 0} reuniões`;

  // Texto puro
  const text = [`Resumo da Lis — ${label}`, ''].concat(...sections.map((s) => [
    s.title.toUpperCase(),
    ...s.lines,
    ...(s.rows && s.rows.length ? s.rows.map((r) => `• ${r.join(' | ')}`) : []),
    '',
  ])).join('\n');

  // HTML simples (tabelas com borda leve)
  const td = 'style="border:1px solid #dde3ea;padding:6px 8px;vertical-align:top;font-size:13px"';
  const th = 'style="border:1px solid #dde3ea;padding:6px 8px;background:#eef5fa;text-align:left;font-size:13px"';
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#1B2A38;max-width:760px">' +
    `<h2 style="color:#17699A;margin:0 0 4px">Resumo da Lis</h2><p style="margin:0 0 16px;color:#5f6b7a">${esc(label)} · horário de Brasília</p>` +
    sections.map((s) =>
      `<h3 style="margin:18px 0 6px;color:#17699A;font-size:15px">${esc(s.title)}</h3>` +
      s.lines.map((l) => `<p style="margin:0 0 6px;font-size:13px">${esc(l)}</p>`).join('') +
      (s.rows && s.rows.length && s.head
        ? `<table style="border-collapse:collapse;margin:6px 0 4px;width:100%"><tr>${s.head.map((h) => `<th ${th}>${esc(h)}</th>`).join('')}</tr>` +
          s.rows.map((r) => `<tr>${r.map((c) => `<td ${td}>${esc(c)}</td>`).join('')}</tr>`).join('') + '</table>'
        : ''),
    ).join('') +
    '<p style="margin:20px 0 0;color:#8a94a6;font-size:12px">Enviado automaticamente pela Nina (nina-lis.vercel.app).</p></div>';

  return { subject, text, html, counts };
}
