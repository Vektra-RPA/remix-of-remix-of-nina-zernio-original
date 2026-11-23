-- 23/11/2026: duas rotinas novas.
-- 1) lis-apollo-triagem: a cada 5 min (até 32 leads por vez), triagem (Claude) dos leads do Apollo marcados
--    triagem_pendente. Sem pendentes, a função só faz uma consulta e sai.
-- 2) lis-resumo-diario: resumo do dia por e-mail para DIGEST_EMAILS, de segunda a sexta
--    às 20:45 UTC (17:45 em Brasília), depois da janela de envio.
-- cron.schedule com o mesmo nome substitui o job, então reaplicar é seguro.

select cron.schedule('lis-apollo-triagem', '*/5 * * * *',
  $$select public.invoke_edge_function('apollo-lead-sync', '{"action":"triagem"}'::jsonb)$$);

select cron.schedule('lis-resumo-diario', '45 20 * * 1-5',
  $$select public.invoke_edge_function('cadence-worker', '{"action":"digest"}'::jsonb)$$);
