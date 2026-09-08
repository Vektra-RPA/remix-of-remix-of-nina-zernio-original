import { useCallback, useEffect, useState } from 'react';
import { broadcastsApi, type DispatchProfile, type DispatchProfileInput } from '@/services/broadcasts';

const SEEDS: DispatchProfileInput[] = [
  { name: 'Conservador', description: 'Ritmo lento e seguro para aquecer o número.', delay_min_s: 60, delay_max_s: 120, batch_size: 10, pause_between_batches_min: 20, pause_between_batches_max: 30, is_default: true },
  { name: 'Moderado', description: 'Equilíbrio entre volume e segurança.', delay_min_s: 30, delay_max_s: 60, batch_size: 20, pause_between_batches_min: 10, pause_between_batches_max: 15 },
  { name: 'Agressivo', description: 'Alto volume — use apenas com número maduro.', delay_min_s: 12, delay_max_s: 25, batch_size: 40, pause_between_batches_min: 4, pause_between_batches_max: 8 },
];

export function useDispatchProfiles() {
  const [profiles, setProfiles] = useState<DispatchProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const list = await broadcastsApi.listProfiles();
    setProfiles(list);
    setLoading(false);
    return list;
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await reload();
        // Na primeira visita a lista está vazia: semeamos os três ritmos padrão
        // para a pessoa conseguir criar uma campanha sem configurar nada antes.
        if (active && list.length === 0) {
          for (const seed of SEEDS) await broadcastsApi.createProfile(seed);
          await reload();
        }
      } catch {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [reload]);

  return { profiles, loading, reload };
}
